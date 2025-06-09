import { z } from "zod"; // Required for inferring types if you use them here
import { FlowActionPayload } from "./flow-action.schemas.server"; // Import the type for the payload
import { authenticate } from "../shopify.server"; // Remix's Shopify auth utility
import { gql } from "graphql-tag"; // For your GraphQL query

// --- Helper to extract numeric ID from Shopify GID (e.g., "gid://shopify/Order/12345" -> "12345")
function extractIdFromGid(gid: string | undefined | null): string | null {
  if (!gid) return null;
  const parts = gid.split('/');
  return parts[parts.length - 1];
}

// Define the GraphQL query to fetch detailed order and customer information
const GET_ORDER_DETAILS_QUERY = gql`
  query GetOrderDetails($orderId: ID!) {
    order(id: $orderId) {
      id
      name
      createdAt
      currentTotalDiscountsSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      totalPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      totalTaxSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      subtotalPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      lineItems(first: 250) {
        edges {
          node {
            id
            name
            sku
            quantity
            variantTitle
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            discountedTotalSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            taxLines {
              priceSet {
                shopMoney {
                  amount
                }
              }
              rate
              title
            }
            product {
              id
              metafield(key: "hsn_code", namespace: "custom") {
                value
              }
            }
            variant {
              id
              metafield(key: "hsn_code", namespace: "custom") {
                value
              }
            }
          }
        }
      }
      customer {
        id
        email
        phone
        firstName
        lastName
        acceptsMarketing
        # *** CHANGED: Query metafields as a connection for robust access ***
        metafields(first: 10, namespace: "custom") { # Fetch up to 10 custom metafields
          nodes {
            key
            namespace
            value
          }
        }
      }
      transactions(first: 1) {
        edges {
          node {
            kind
            gateway
            amount
            currency
            status
          }
        }
      }
    }
  }
`;

// Define an interface for the expected GraphQL response structure for easier typing
interface OrderDetailsResponse {
  data?: {
    order?: {
      id: string;
      name?: string;
      createdAt?: string;
      currentTotalDiscountsSet?: { shopMoney?: { amount: string; currencyCode: string; } };
      totalPriceSet?: { shopMoney?: { amount: string; currencyCode: string; } };
      totalTaxSet?: { shopMoney?: { amount: string; currencyCode: string; } };
      subtotalPriceSet?: { shopMoney?: { amount: string; currencyCode: string; } };
      lineItems?: { edges?: { node: any }[] };
      customer?: {
        id: string;
        email?: string;
        phone?: string;
        firstName?: string;
        lastName?: string;
        acceptsMarketing?: boolean;
        metafields?: {
          nodes: {
            key: string;
            namespace: string;
            value?: string;
          }[];
        };
      };
      transactions?: { edges?: { node: any }[] };
    };
  };
  errors?: any[]; // GraphQL errors
}

// Main function to handle the Flow Action logic
export async function processFlowActionLogic(
  request: Request, // Pass the request for Shopify Admin API authentication
  payload: FlowActionPayload // The validated payload from the Remix action
) {
  console.log(`Processing Flow Action for store ID: ${payload.storeId || payload.shop?.id}, Flow ID: ${payload.flowId}`);
  console.log(`Raw payload data from Flow: ${JSON.stringify(payload, null, 2)}`);

  const BILLING_API_URL = process.env.BILLING_API_URL;
  const BILLING_API_AUTH_TOKEN = process.env.BILLING_API_AUTH_TOKEN;
  const APP_HANDLE = process.env.APP_HANDLE || 'send-invoice'; // Default if not set

  if (!BILLING_API_URL || !BILLING_API_AUTH_TOKEN) {
    console.error('Missing required environment variables for billing API.');
    throw new Error('Server configuration error: Required billing API credentials missing.');
  }

  const shopifyShopDomain = payload.shopDomain || payload.shop?.myshopifyDomain;
  const shopifyOrderGid = payload.orderId;

  const customFieldName = payload.settings?.yourFieldKey || 'N/A';

  if (!shopifyOrderGid) {
    console.error('Order ID (GID) missing from Flow trigger payload. Ensure your Flow trigger provides order data.');
    throw new Error('Order ID missing from trigger payload. Ensure your Flow trigger provides order data.');
  }
  if (!shopifyShopDomain) {
    console.error('Shop domain missing from Flow trigger payload. Cannot load Shopify session.');
    throw new Error('Shop domain missing. Ensure your Flow trigger provides shop data.');
  }

  // --- Authenticate with Shopify Admin API using Remix's built-in authenticator ---
  let adminClient;
  try {
    const { admin } = await authenticate.admin(request);
    if (!admin) {
        console.error(`Shopify Admin API client not available for shop: ${shopifyShopDomain}.`);
        throw new Error(`App not installed or session expired for shop: ${shopifyShopDomain}. Please reinstall the app via https://${shopifyShopDomain}/admin/apps/${APP_HANDLE}.`);
    }
    adminClient = admin;
    console.log(`Successfully authenticated Shopify Admin API client for ${shopifyShopDomain}`);
  } catch (error) {
    console.error(`Error authenticating with Shopify for ${shopifyShopDomain}: ${error.message}`, error.stack);
    throw new Error(`Failed to load Shopify session: ${error.message}. Ensure the app is installed.`);
  }

  // *** Corrected: orderDetails type is now explicitly OrderDetailsResponse['data']['order'] ***
  let orderDetails: OrderDetailsResponse['data']['order'];
  try {
    console.log(`Querying Shopify GraphQL Admin API for order details: ${shopifyOrderGid} for shop: ${shopifyShopDomain}`);
    const response = await adminClient.graphql(GET_ORDER_DETAILS_QUERY, { orderId: shopifyOrderGid });

    const responseData: OrderDetailsResponse = await response.json();
    // *** Corrected: Access the `order` property directly from `responseData.data` ***
    orderDetails = responseData.data?.order;

    if (responseData.errors) {
        console.error(`GraphQL errors fetching order details: ${JSON.stringify(responseData.errors)}`);
        throw new Error(`GraphQL API errors: ${responseData.errors.map(e => e.message).join(', ')}`);
    }

    if (!orderDetails) {
      console.error(`Order with GID ${shopifyOrderGid} not found via GraphQL for shop ${shopifyShopDomain}.`);
      throw new Error(`Order with ID ${shopifyOrderGid} not found in Shopify.`);
    }
    console.log(`Received order details from Shopify GraphQL: ${JSON.stringify(orderDetails, null, 2)}`);

  } catch (error) {
    console.error(`Failed to fetch order details from Shopify GraphQL for ${shopifyShopDomain}: ${error.message}`, error.stack);
    throw new Error(`Failed to retrieve order details from Shopify: ${error.message}`);
  }

  // --- Extract and prepare data from GraphQL response to match billing API payload ---
  const customer = orderDetails.customer;
  const customerPhone = customer?.phone || "N/A";
  const customerEmail = customer?.email || "N/A";
  const customerName = (customer?.firstName && customer?.lastName) ? `${customer.firstName} ${customer.lastName}` : (customer?.firstName || customer?.lastName || 'N/A');

  // *** CHANGED: Access metafields from the `metafields.nodes` array ***
  const customerBirthDate = customer?.metafields?.nodes?.find(m => m.key === 'birth_date' && m.namespace === 'custom')?.value || "";
  const customerAnniversary = customer?.metafields?.nodes?.find(m => m.key === 'anniversary_date' && m.namespace === 'custom')?.value || "";

  const orderTotalAmount = parseFloat(orderDetails.totalPriceSet?.shopMoney?.amount || "0.00").toFixed(2);
  const orderDiscountAmount = parseFloat(orderDetails.currentTotalDiscountsSet?.shopMoney?.amount || "0.00").toFixed(2);
  const orderTotalTax = parseFloat(orderDetails.totalTaxSet?.shopMoney?.amount || "0.00").toFixed(2);
  const orderSubtotalAmount = parseFloat(orderDetails.subtotalPriceSet?.shopMoney?.amount || "0.00").toFixed(2);

  const now = new Date();
  // Setting IST timezone (UTC+5:30) for bill_date and bill_time
  const offsetMinutes = 330; // 5 hours 30 minutes
  const istDate = new Date(now.getTime() + offsetMinutes * 60 * 1000 + (now.getTimezoneOffset() * 60 * 1000));

  const billDate = istDate.toISOString().split('T')[0];
  const billTime = istDate.toTimeString().split(' ')[0]; // HH:MM:SS

  // Map Shopify Line Items to Billing API Particulars
  const particulars: any[] = [];
  if (orderDetails.lineItems && orderDetails.lineItems.edges) {
    orderDetails.lineItems.edges.forEach(edge => {
      const item = edge.node;
      const quantity = item.quantity && typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1;
      const rate = parseFloat(item.totalPriceSet?.shopMoney?.amount || "0.00") / quantity;
      const amount = parseFloat(item.totalPriceSet?.shopMoney?.amount || "0.00");

      const hsn = item.variant?.metafield?.value || item.product?.metafield?.value || "N/A";

      let itemGST = "0";
      if (item.taxLines && item.taxLines.length > 0) {
        itemGST = (item.taxLines.reduce((sum, tl) => sum + (tl.rate || 0), 0) * 100).toFixed(2);
      }

      particulars.push({
        sku_id: item.sku || extractIdFromGid(item.id) || 'N/A',
        description: item.name || item.variantTitle || 'N/A',
        hsn: hsn,
        gst: itemGST,
        qty: quantity.toString(),
        rate: rate.toFixed(2),
        amount: amount.toFixed(2),
      });
    });
  }

  // Calculate GST Summary
  const gstSummary: any[] = [];
  const taxRatesMap = new Map<string, { taxable: number, cgst: number, sgst: number, igst: number, total: number }>();

  if (orderDetails.lineItems && orderDetails.lineItems.edges) {
    orderDetails.lineItems.edges.forEach(edge => {
      if (edge.node && edge.node.taxLines) {
        edge.node.taxLines.forEach(taxLine => {
          const rate = taxLine.rate !== undefined && taxLine.rate !== null ? taxLine.rate : 0;
          const ratePercentage = (rate * 100).toFixed(2);

          const taxAmount = parseFloat(taxLine.priceSet?.shopMoney?.amount || "0.00");

          let summaryEntry = taxRatesMap.get(ratePercentage);
          if (!summaryEntry) {
            summaryEntry = { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
            taxRatesMap.set(ratePercentage, summaryEntry);
          }

          const taxableAmountForLine = rate > 0 ? taxAmount / rate : 0;

          summaryEntry.taxable += taxableAmountForLine;
          summaryEntry.total += taxAmount;
          if (summaryEntry.total > 0) {
            summaryEntry.cgst = summaryEntry.total / 2;
            summaryEntry.sgst = summaryEntry.total / 2;
          }
          // Add logic for IGST if applicable based on location/tax rules (same as your original)
        });
      }
    });
  }

  taxRatesMap.forEach((summaryEntry, rate) => {
    gstSummary.push({
      gst: rate,
      taxable: summaryEntry.taxable.toFixed(2),
      cgst: summaryEntry.cgst.toFixed(2),
      sgst: summaryEntry.sgst.toFixed(2),
      igst: summaryEntry.igst.toFixed(2) === "0.00" ? "" : summaryEntry.igst.toFixed(2),
      total: summaryEntry.total.toFixed(2),
    });
  });

  // Add total row for GST summary
  if (gstSummary.length > 0) {
    const totalTaxable = gstSummary.reduce((sum, item) => sum + parseFloat(item.taxable), 0);
    const totalCGST = gstSummary.reduce((sum, item) => sum + parseFloat(item.cgst), 0);
    const totalSGST = gstSummary.reduce((sum, item) => sum + parseFloat(item.sgst), 0);
    const totalIGST = gstSummary.reduce((sum, item) => sum + parseFloat(item.igst === "" ? "0.00" : item.igst), 0);
    const totalGST = gstSummary.reduce((sum, item) => sum + parseFloat(item.total), 0);

    gstSummary.push({
      isTotal: "true",
      gst: "",
      taxable: totalTaxable.toFixed(2),
      cgst: totalCGST.toFixed(2),
      sgst: totalSGST.toFixed(2),
      igst: totalIGST.toFixed(2) === "0.00" ? "" : totalIGST.toFixed(2),
      total: totalGST.toFixed(2),
    });
  } else {
      gstSummary.push({
          isTotal: "true",
          gst: "",
          taxable: (parseFloat(orderTotalAmount) - parseFloat(orderTotalTax) + parseFloat(orderDiscountAmount)).toFixed(2),
          cgst: "0.00",
          sgst: "0.00",
          igst: "",
          total: orderTotalTax
      });
  }

  const additionalInfo = [
    { "text": "SUBTOTAL", "value": orderSubtotalAmount },
    { "text": "Loyalty Discount", "value": orderDiscountAmount },
    { "text": "Total", "value": orderTotalAmount },
    { "text": "Shopify Order Name", "value": orderDetails.name },
    { "text": "Shopify Order GID", "value": orderDetails.id },
    { "text": "Shopify Store Domain", "value": shopifyShopDomain },
    { "text": "Customer Email", "value": customerEmail },
    { "text": "Action Setting: Your Field Key", "value": customFieldName }
  ];

  const firstTransaction = orderDetails.transactions?.edges[0]?.node;
  const paymentMode = firstTransaction?.gateway || firstTransaction?.kind || "Online Payment";
  const paymentAmount = firstTransaction?.amount ? parseFloat(firstTransaction.amount).toFixed(2) : orderTotalAmount;

  const paymentInfo = [
    { "text": "Payment Mode", "value": paymentMode },
    { "text": "Voucher", "value": "" },
    { "text": "Amount", "value": paymentAmount }
  ];

  const finalBillingData: any = {
    "auth_token": BILLING_API_AUTH_TOKEN,
    "inv_no": `SHOPIFY_${extractIdFromGid(shopifyOrderGid)}`,
    "bill_type": "sale",
    "user_phone": customerPhone,
    "dial_code": "91",
    "cust_name": customerName,
    "cust_bday": customerBirthDate,
    "cust_anniv": customerAnniversary,
    "bill_date": billDate,
    "bill_time": billTime,
    "store_identifier": extractIdFromGid(payload.shop?.id!),
    "is_printed": "n",
    "pts_redeemed": "0",
    "coupon_redeemed": "",
    "bill_amount": orderTotalAmount,
    "discount_amount": orderDiscountAmount,
    "referrer_phone": "",
    "pts_balance": "",
    "change_return": "0.00",
    "cash_paid": orderTotalAmount,
    "net_payable": orderTotalAmount,
    "round_off": "0.00",
    "cashier_name": "Shopify Flow Automation",
    "remarks": `Generated via Shopify Flow for order ${orderDetails.name} (${shopifyOrderGid}). Action Setting 'Your Field Key' Value: ${customFieldName}.`,
    "allow_points_accrual": "y",
    "particulars": particulars,
    "additional_info": additionalInfo,
    "gst_summary": gstSummary,
    "payment_info": paymentInfo,
  };

  console.log(`Sending constructed invoice data to external API.`);
  console.log(`Billing API request body: ${JSON.stringify(finalBillingData, null, 2)}`);

  try {
    const response = await fetch(BILLING_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(finalBillingData),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error(`Billing API Error Response Status: ${response.status}`);
      console.error(`Billing API Error Response Data: ${JSON.stringify(errorData)}`);
      throw new Error(`Billing API request failed with status ${response.status}: ${JSON.stringify(errorData)}`);
    }

    const responseData = await response.json();
    console.log(`Successfully received response from billing API. Status: ${response.status}`);
    console.log(`Billing API raw response data: ${JSON.stringify(responseData, null, 2)}`);

    return {
      success: true,
      message: 'Invoice generation request successfully sent to external API.',
      billing_api_response_status: response.status,
      billing_api_response_data: responseData,
    };

  } catch (error) {
    console.error(`Error communicating with external billing API: ${error.message}`, error.stack);
    throw new Error(`Failed to generate invoice: ${error.message}.`);
  }
}