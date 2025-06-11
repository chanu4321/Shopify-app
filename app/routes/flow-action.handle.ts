import { ActionFunctionArgs, json } from "@remix-run/node";
import { FlowActionPayloadSchema, FlowActionPayload } from "../utils/flow-action.schemas.server";
import { verifyFlowActionHmac } from "../utils/hmac.server";
import { ZodError } from "zod";
import { authenticate } from "../shopify.server"; // IMPORTANT: UNCOMMENT THIS LINE

// Define environment variables for your billing API
const BILLFREE_AUTH_TOKEN = process.env.BILLFREE_AUTH_TOKEN; // Your unique token
const BILLING_API_BASE_URL = process.env.BILLING_API_BASE_URL; // e.g., "https://your.billingapi.com/api"

export async function action({ request }: ActionFunctionArgs) {
  console.log("-----------------------------------------------");
  console.log("Incoming Flow Action request received.");

  // 1. Verify HMAC Signature
  const isHmacValid = await verifyFlowActionHmac(request);
  if (!isHmacValid) {
    console.error("HMAC verification failed. Request denied.");
    return json({ message: "Unauthorized: Invalid HMAC signature" }, { status: 401 });
  }

  let payload: FlowActionPayload;
  try {
    const rawBody = await request.text();
    const parsedBody = JSON.parse(rawBody);
    payload = FlowActionPayloadSchema.parse(parsedBody);
    console.log("Payload successfully validated with Zod.");
  } catch (error) {
    if (error instanceof ZodError) {
      console.error("Validation error:", error.errors);
      return json(
        { message: "Bad Request: Invalid payload structure", errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Failed to parse request body or unknown validation error:", error);
    return json({ message: "Bad Request: Invalid JSON or unexpected error" }, { status: 400 });
  }

  // 2. Extract core IDs and custom setting from Flow payload
  const shopId = payload.shop_id;
  const orderGid = payload.properties.order_id;
  const customerGid = payload.properties.customer_id;
  const customSetting = payload.properties['your-field-key'];

  console.log(`Processing Flow Action for Shop ID: ${shopId}`);
  console.log(`Processing Flow Action for Order GID: ${orderGid}`);
  console.log(`Processing Flow Action for Customer GID: ${customerGid}`);
  console.log(`Custom Setting: ${customSetting}`);

  try {
    // 3. Authenticate with Shopify Admin API to fetch additional data
    const { admin } = await authenticate.admin(request);
    if (!admin) {
      console.error("Shopify Admin authentication failed. Cannot fetch order/customer data.");
      return json({ message: "Internal Server Error: Admin API authentication failed" }, { status: 500 });
    }

    // GraphQL Query to fetch comprehensive Order and Customer data
    // This query is designed to get all fields required by your billing API
    const ORDER_AND_CUSTOMER_QUERY = `
      query GetOrderAndCustomerDetails($orderId: ID!, $customerId: ID!) {
        order(id: $orderId) {
          id
          name
          createdAt
          totalPriceSet {
            shopMoney { amount currencyCode }
          }
          lineItems(first: 250) { # Adjust 'first' if you expect more line items
            edges {
              node {
                id
                name
                sku
                quantity
                variantTitle
                totalPriceSet {
                  shopMoney { amount currencyCode }
                }
                taxLines {
                  priceSet { shopMoney { amount currencyCode } }
                  rate
                  title
                }
              }
            }
          }
          transactions(first: 5) { # Adjust 'first' as needed
            edges {
              node {
                kind
                gateway
                amountV2 { amount currencyCode }
                status
              }
            }
          }
        }
        customer(id: $customerId) {
          id
          firstName
          lastName
          phone
          email
        }
      }
    `;

    const dataResponse = await admin.graphql(ORDER_AND_CUSTOMER_QUERY, {
      variables: {
        orderId: orderGid,
        customerId: customerGid,
      },
    });

    const { data, errors: graphqlErrors } = await dataResponse.json();

    if (graphqlErrors && graphqlErrors.length > 0) {
      console.error("GraphQL errors:", graphqlErrors);
      return json({ message: "Failed to fetch Shopify data via GraphQL", errors: graphqlErrors }, { status: 500 });
    }

    const orderData = data?.order;
    const customerData = data?.customer;

    if (!orderData || !customerData) {
      console.error("Could not retrieve full order or customer data from Shopify.");
      return json({ message: "Failed to retrieve required Shopify data", details: "Order or Customer data missing" }, { status: 404 });
    }

    // 4. Prepare data for your BillFree API based on its specific requirements
    const now = new Date();
    const bill_date = now.toISOString().split('T')[0]; // "yyyy-mm-dd"
    const bill_time = now.toTimeString().split(' ')[0]; // "HH:mm:ss"

    const lineItemsForBilling = orderData.lineItems.edges.map((edge: any) => {
      const item = edge.node;
      return {
        item_name: item.name,
        item_qty: item.quantity,
        item_mrp: item.totalPriceSet?.shopMoney?.amount || "0", // Assuming this is unit price or subtotal
        item_disc: "0", // Derive if available, else default
        item_tax: item.taxLines?.[0]?.priceSet?.shopMoney?.amount || "0", // Simple, might need sum
        item_sales_price: item.totalPriceSet?.shopMoney?.amount || "0", // Adjust as per your billing API
        item_sku: item.sku,
        item_hsn_code: "", // Fetch from product metafields if available
        item_barcode: "", // Fetch from product metafields if available
      };
    });

    // Dummy/Placeholder for GST Summary and Payment Info
    // You would extract these from orderData.transactions and orderData.taxLines if available
    const gst_summary = orderData.taxLines?.map((tax: any) => ({
      gst_rate: tax.rate,
      gst_amount: tax.priceSet?.shopMoney?.amount,
      gst_name: tax.title,
    })) || [];
    
    const payment_info = orderData.transactions?.edges.map((edge: any) => ({
        text: edge.node.gateway, // e.g., "Cash", "Card"
        value: edge.node.amountV2?.amount,
    })) || [];


    const billFreePayload = {
      auth_token: BILLFREE_AUTH_TOKEN, // MANDATORY
      user_phone: customerData.phone || "N/A", // MANDATORY - Ensure phone is captured
      dial_code: "91", // Assuming Indian customers, adjust if global
      cust_name: `${customerData.firstName || ''} ${customerData.lastName || ''}`.trim() || "Guest Customer",
      bill_date: bill_date, // MANDATORY
      bill_time: bill_time, // MANDATORY
      store_identifier: String(shopId), // MANDATORY (assuming shopId is your identifier)
      is_printed: "y", // MANDATORY (adjust as needed)
      pts_redeemed: 0, // Placeholder, adjust if you have loyalty integration
      coupon_redeemed: "", // Placeholder, extract from order discounts if available
      bill_amount: orderData.totalPriceSet?.shopMoney?.amount || "0", // MANDATORY
      particulars: lineItemsForBilling, // MANDATORY
      additional_info: [], // MANDATORY - Populate if needed from metafields or order notes
      gst_summary: gst_summary, // MANDATORY
      payment_info: payment_info, // MANDATORY
      inv_no: orderData.name || `INV-${orderData.id.split('/').pop()}`, // MANDATORY - Use order name or derive from GID
      cust_bday: "", // Populate from customer metafields if available
      cust_anniv: "", // Populate from customer metafields if available
      referrer_phone: "", // Populate from customer metafields if available
      bill_type: "sale", // Default, adjust as needed
      pts_balance: "0", // Placeholder
      change_return: "0", // Placeholder
      cash_paid: orderData.transactions?.edges?.[0]?.node?.amountV2?.amount || "0", // Simple take first transaction
      net_payable: orderData.totalPriceSet?.shopMoney?.amount || "0",
      round_off: "0",
      cashier_name: "ShopifyFlow", // Placeholder, adjust as needed
      remarks: customSetting, // Using your custom setting as a remark
      allow_points_accrual: "y", // Default, adjust as needed
    };

    console.log("Sending payload to BillFree API:", JSON.stringify(billFreePayload, null, 2));

    if (!BILLING_API_BASE_URL || !BILLFREE_AUTH_TOKEN) {
      console.error("BillFree API URL or Auth Token is not configured.");
      return json({ message: "Server configuration error: BillFree API credentials missing" }, { status: 500 });
    }

    const response = await fetch(`${BILLING_API_BASE_URL}/invoice`, { // Assuming an /invoice endpoint
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 'Authorization': `Bearer ${BILLFREE_AUTH_TOKEN}`, // If auth_token is an Authorization header
      },
      body: JSON.stringify(billFreePayload),
    });

    if (response.ok) {
      console.log("Successfully sent data to BillFree API!");
      const responseData = await response.json().catch(() => ({}));
      console.log("BillFree API response:", responseData);
      return json({
        message: "Flow Action completed and BillFree API called successfully!",
        billFreeApiStatus: response.status,
        billFreeApiResponse: responseData
      }, { status: 200 });
    } else {
      const errorText = await response.text();
      console.error(`Error from BillFree API: Status ${response.status} - ${errorText}`);
      return json(
        {
          message: `Failed to send data to BillFree API. Status: ${response.status}`,
          details: errorText,
        },
        { status: response.status || 500 }
      );
    }

  } catch (error: any) {
    console.error(`Error in BillFree API integration: ${error.message}`, error.stack);
    return json(
      {
        message: 'Failed to process Flow Action due to internal integration error',
        details: error.message,
        error: true,
      },
      { status: error.status || 500 }
    );
  } finally {
    console.log("-----------------------------------------------");
  }
}

export async function loader() {
  return json({ message: "This endpoint is for POST requests only." }, { status: 405 });
}