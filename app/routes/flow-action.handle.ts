// app/routes/app.flow-action.handle.ts

// This log should appear first if the module loads successfully.
// If you don't see this, the issue is with Vercel's deployment/runtime loading the file.
console.log("--- FLOW ACTION HANDLER MODULE LOADED ---");

// CORRECTED: Import statement syntax
import { ActionFunctionArgs, json } from "@remix-run/node";
// Assuming these utility files exist and are correct
import { FlowActionPayloadSchema, FlowActionPayload } from "../utils/flow-action.schemas.server";
import { verifyRequestAndGetBody } from "../utils/hmac.server";
import { ZodError } from "zod";
import { authenticate, sessionStorage, apiVersion } from "../shopify.server";
import { GraphqlClient } from "@shopify/shopify-api";

// CORRECTED: Moved environment variable access inside the action function
// These lines are now removed from global scope
// const BILLING_API_AUTH_TOKEN = process.env.BILLING_API_AUTH_TOKEN;
// const BILLING_API_BASE_URL = process.env.BILLING_API_BASE_URL;

// CORRECTED: Consolidated and fixed action function definition
export async function action({ request }: ActionFunctionArgs) {
  console.log("-----------------------------------------------");
  console.log("--- FLOW ACTION HANDLER FUNCTION STARTED ---");
  console.log("DEBUG_ENV_VAR_VALUE:", process.env.DEBUG); // Keep this for now for debug confirmation
  console.log("Incoming Flow Action request received.");

  const BILLING_API_AUTH_TOKEN = process.env.BILLING_API_AUTH_TOKEN;
  const BILLING_API_BASE_URL = process.env.BILLING_API_BASE_URL;

  let rawBody: string; // Declare rawBody here to use it later
  let payload: FlowActionPayload;
  
  // 1. Verify HMAC Signature and get the raw body
  try {
    rawBody = await verifyRequestAndGetBody(request); // Call the new function
    console.log("[HMAC Verify] HMAC successfully verified in handle.ts."); // Confirm success
    console.log("this is the rawBody:", rawBody); // Log the raw body for debugging
    // 2. Validate Payload with Zod (using the rawBody obtained from HMAC verification)
    const parsedBody = JSON.parse(rawBody);
    payload = FlowActionPayloadSchema.parse(parsedBody);
    console.log("Payload successfully validated with Zod.");
    console.log("Parsed Payload:", JSON.stringify(payload, null, 2)); // Log the parsed payload for debugging
  } catch (error) {
    // If verifyRequestAndGetBody throws a Response (from json()), re-throw it directly
    if (error instanceof Response) {
      console.error("HMAC or Body parsing failed:", error.status, await error.text()); // Log for debugging
      throw error;
    }
    // Handle Zod errors or any other parsing errors
    if (error instanceof ZodError) {
      console.error("Validation error:", error.errors);
      throw json(
        { message: "Bad Request: Invalid payload structure", errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Failed to parse request body or unknown validation error:", error);
    throw json({ message: "Bad Request: Invalid JSON or unexpected error" }, { status: 400 });
  }


  // 2. Extract core IDs and custom setting from Flow payload
  const shopId = payload.shop_id;
  const orderGid = payload.properties.order_id;
  const customerGid = payload.properties.customer_id;
  // REMINDER: Make sure 'your-field-key' matches the actual key in your Shopify Flow custom properties
  const customSetting = payload.properties['your-field-key'];

  console.log(`Processing Flow Action for Shop ID: ${shopId}`);
  console.log(`Processing Flow Action for Order GID: ${orderGid}`);
  console.log(`Processing Flow Action for Customer GID: ${customerGid}`);
  console.log(`Custom Setting: ${customSetting}`);

  console.log("Request Headers (for authenticate.admin):");
  try {
      const headersObject = Object.fromEntries(request.headers.entries());
      console.log(JSON.stringify(headersObject, null, 2));
  } catch (e) {
      console.error("Failed to log headers:", e);
  }

  console.log("error starts from here");

  try {
    // 3. Authenticate with Shopify Admin API to fetch additional data
    const session = await sessionStorage.loadSession(String(shopId));

    if (!session || !session.accessToken) {
      console.error(`[Flow Action] No active session found for shop ID: ${shopId}. App needs to be installed/re-authenticated.`);
      // If no session, you cannot make API calls. Return an appropriate error.
      throw json({ message: "Internal Server Error: No valid session found for shop. App may need re-installation." }, { status: 500 });
    }

    // 2. Create the Admin API client using the loaded session.
    // This correctly authenticates your Admin API calls.
    const admin = new GraphqlClient({
      session,
      apiVersion: apiVersion, // Use the API version defined in your shopify.server.ts
    });
    // Your GraphQL query (already updated in your message, copy it here)
    const ORDER_AND_CUSTOMER_QUERY = `
      query GetOrderAndCustomerDetails($orderId: ID!, $customerId: ID!) {
        order(id: $orderId) {
          id
          name
          createdAt
          totalPriceSet {
            shopMoney { amount currencyCode }
          }
          totalDiscountsSet {
            shopMoney { amount currencyCode }
          }
          totalCashRoundingAdjustment {
            paymentSet {
              shopMoney { amount currencyCode }
            }
          }
          discountCodes
          discountApplications(first: 10) {
            edges {
              node {
                allocationMethod
                targetSelection
                targetType
                value {
                  __typename
                }
              }
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
                originalUnitPriceSet {
                  shopMoney { amount currencyCode }
                }
                totalDiscountSet {
                  shopMoney { amount currencyCode }
                }
                taxLines {
                  priceSet {
                    shopMoney { amount currencyCode }
                  }
                  rate
                  title
                }
                product {
                  id
                  hsncode: metafield(namespace: "custom", key: "hsn_code") {
                    value
                  }
                }
                variant {
                  id
                  barcode: metafield(namespace: "custom", key: "barcode") {
                    value
                  }
                }
              }
            }
          }
          transactions(first: 5) {
              id
              kind
              gateway
              amountSet {
                  shopMoney { amount currencyCode }
              }
              status
          }
        }
        customer(id: $customerId) {
          id
          firstName
          lastName
          defaultPhoneNumber {
            phoneNumber
          }
          defaultEmailAddress {
            emailAddress
          }
          custBdayMetafield: metafield(namespace: "custom", key: "cust_bday") { value }
          custAnnivMetafield: metafield(namespace: "custom", key: "cust_anniv") { value }
          referrerPhoneMetafield: metafield(namespace: "custom", key: "referrer_phone") { value }
        }
      }
    `;

    // Extract raw IDs from GIDs
    const orderId = orderGid;
    const customerId = customerGid;

    if (!orderGid || !customerGid) {
        console.error("Failed to extract ID from Order GID or Customer GID.");
        throw new Response("Bad Request: Invalid Order or Customer GID format", { status: 400 });
    }

    const response = await admin.query({
      data: {
        query:     ORDER_AND_CUSTOMER_QUERY,
        variables: { orderId, customerId }
      }
    });
    if (!response.body) {
      console.error("Shopify GraphQL response missing body");
      throw new Response("Internal Server Error: no data from Shopify", { status: 500 });
    }

    const orderData = response.body.data.order;
    const customerData = response.body.data.customer;
    console.log("Response from Shopify GraphQL API:", JSON.stringify(response.body, null, 2));
    console.log("Order Data:", JSON.stringify(orderData, null, 2));
    console.log("Customer Data:", JSON.stringify(customerData, null, 2));
    
    if (!orderData || !customerData) {
      console.error("Failed to fetch order or customer data:", response.body.errors);
      throw new Response("Failed to fetch order or customer data from Shopify", { status: 500 });
    }

    // --- BillFree Payload Construction ---

    const orderCreatedAt = new Date(orderData.createdAt);
    const billDate = orderCreatedAt.toISOString().split('T')[0];
    const billTime = orderCreatedAt.toTimeString().split(' ')[0];

    const custName = `${customerData.firstName || ""} ${customerData.lastName || ""}`.trim();
    const userPhone = customerData.defaultPhoneNumber?.phoneNumber || "";

    const custBday = customerData.custBdayMetafield?.value || "";
    const custAnniv = customerData.custAnnivMetafield?.value || "";
    const referrerPhone = customerData.referrerPhoneMetafield?.value || "";

    const particulars = orderData.lineItems.edges.map((edge: any) => {
      const item = edge.node;
      const originalUnitPrice = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount || "0");
      const totalLineItemDiscount = parseFloat(item.totalDiscountSet?.shopMoney?.amount || "0");
      const quantity = item.quantity;
      const itemAmount = (originalUnitPrice * quantity - totalLineItemDiscount).toFixed(2);
      const hsnCode = item.product?.metafield?.value || "";
      const barcode = item.variant?.metafield?.value || "";
      const gstRate = item.taxLines?.[0]?.rate ? (item.taxLines[0].rate * 100).toFixed(2) : "0.00";
      return {
        sku_id: item.sku || "",
        description: item.name || "",
        hsn: hsnCode,
        gst: gstRate,
        qty: quantity.toString(),
        rate: originalUnitPrice.toFixed(2),
        amount: itemAmount,
      };
    });

    const subtotal = orderData.lineItems.edges.reduce((sum: number, edge: any) => {
      const item = edge.node;
      const originalUnitPrice = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount || "0");
      return sum + (originalUnitPrice * item.quantity);
    }, 0).toFixed(2);

    const totalDiscountAmount = parseFloat(orderData.totalDiscountsSet?.shopMoney?.amount || "0").toFixed(2);

    const additionalInfo = [
      { text: "SUBTOTAL", value: subtotal },
      { text: "Discount", value: totalDiscountAmount },
      { text: "Total", value: parseFloat(orderData.totalPriceSet?.shopMoney?.amount || "0").toFixed(2) }
    ];

    const gstSummaryMap = new Map<string, { rate: number, taxable: number, cgst: number, sgst: number, igst: number, total: number }>();
    orderData.lineItems.edges.forEach((edge: any) => {
      const item = edge.node;
      const itemSalesPrice = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount || "0") * item.quantity - parseFloat(item.totalDiscountSet?.shopMoney?.amount || "0");
      item.taxLines.forEach((taxLine: any) => {
        const rateKey = taxLine.rate.toFixed(2);
        const taxAmount = parseFloat(taxLine.priceSet?.shopMoney?.amount || "0");
        let taxableAmountForTaxLine = 0;
        if (taxLine.rate > 0) {
          taxableAmountForTaxLine = taxAmount / taxLine.rate;
        } else {
          taxableAmountForTaxLine = itemSalesPrice;
        }
        if (!gstSummaryMap.has(rateKey)) {
          gstSummaryMap.set(rateKey, { rate: parseFloat(rateKey) * 100, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 });
        }
        const currentSummary = gstSummaryMap.get(rateKey)!;
        currentSummary.taxable += taxableAmountForTaxLine;
        currentSummary.total += taxAmount;
        const taxTitle = taxLine.title?.toUpperCase();
        if (taxTitle === "CGST") {
          currentSummary.cgst += taxAmount;
        } else if (taxTitle === "SGST") {
          currentSummary.sgst += taxAmount;
        } else if (taxTitle === "IGST") {
          currentSummary.igst += taxAmount;
        }
      });
    });

    const gstSummary = Array.from(gstSummaryMap.values()).map(summary => ({
      gst: summary.rate.toFixed(2),
      taxable: summary.taxable.toFixed(2),
      cgst: summary.cgst.toFixed(2),
      sgst: summary.sgst.toFixed(2),
      igst: summary.igst.toFixed(2),
      total: summary.total.toFixed(2)
    }));

    const totalTaxableSummary = gstSummary.reduce((sum, entry) => sum + parseFloat(entry.taxable), 0).toFixed(2);
    const totalCGSTSummary = gstSummary.reduce((sum, entry) => sum + parseFloat(entry.cgst), 0).toFixed(2);
    const totalSGSTSummary = gstSummary.reduce((sum, entry) => sum + parseFloat(entry.sgst), 0).toFixed(2);
    const totalIGSTSummary = gstSummary.reduce((sum, entry) => sum + parseFloat(entry.igst), 0).toFixed(2);
    const totalGSTTotalSummary = gstSummary.reduce((sum, entry) => sum + parseFloat(entry.total), 0).toFixed(2);

    gstSummary.push({
      gst: "",
      taxable: totalTaxableSummary,
      cgst: totalCGSTSummary,
      sgst: totalSGSTSummary,
      igst: totalIGSTSummary,
      total: totalGSTTotalSummary,
    });

    const paymentInfo: { text: string; value: string }[] = [];
    let cashPaidAmount = "0.00";

    orderData.transactions.forEach((transaction: any) => {
      let paymentModeText = transaction.gateway || "Other";
      if (transaction.gateway === "bogus") {
        paymentModeText = "Cash";
      } else if (transaction.gateway === "shopify_payments") {
        paymentModeText = "Credit Card";
      }

      paymentInfo.push({
        text: "Payment Mode",
        value: paymentModeText,
      });
      paymentInfo.push({
        text: "Amount",
        value: parseFloat(transaction.amountSet?.shopMoney?.amount || "0").toFixed(2),
      });

      if (transaction.kind === "SALE" && transaction.gateway === "bogus" && transaction.status === "SUCCESS") {
        cashPaidAmount = parseFloat(transaction.amountSet?.shopMoney?.amount || "0").toFixed(2);
      }
    });

    const billFreePayload = {
      auth_token: BILLING_API_AUTH_TOKEN || "", // Use directly from const
      inv_no: orderData.name,
      bill_type: "sale",
      user_phone: userPhone,
      dial_code: "91",
      cust_name: custName,
      cust_bday: custBday,
      cust_anniv: custAnniv,
      bill_date: billDate,
      bill_time: billTime,
      store_identifier: process.env.BILLFREE_STORE_IDENTIFIER || "", // From env var or fixed
      is_printed: "n",
      pts_redeemed: "",
      coupon_redeemed: orderData.discountCodes?.[0] || "",
      bill_amount: parseFloat(orderData.totalPriceSet?.shopMoney?.amount || "0").toFixed(2),
      discount_amount: totalDiscountAmount,
      referrer_phone: referrerPhone,
      pts_balance: "",
      change_return: "",
      cash_paid: cashPaidAmount,
      net_payable: parseFloat(orderData.totalPriceSet?.shopMoney?.amount || "0").toFixed(2),
      round_off: parseFloat(orderData.totalCashRoundingAdjustment?.paymentSet?.shopMoney?.amount || "0").toFixed(2),
      cashier_name: "",
      remarks: orderData.note || "",
      allow_points_accrual: "y",
      particulars: particulars,
      additional_info: additionalInfo,
      gst_summary: gstSummary,
      payment_info: paymentInfo,
    };

    // These logs are critical for debugging.
    console.log("Generated BillFree Payload:", JSON.stringify(billFreePayload, null, 2));
    console.log("DEBUG: About to make BillFree API call.");
    console.log("DEBUG: BILLING_API_BASE_URL:", BILLING_API_BASE_URL); // Using BASE_URL
    console.log("DEBUG: BILLING_API_AUTH_TOKEN (first 5 chars):", BILLING_API_AUTH_TOKEN?.substring(0, 5) + '...');
    console.log("DEBUG: BillFree Payload (partial):", JSON.stringify(billFreePayload, null, 2).substring(0, 500) + '...');

    // --- Make the actual API call to BillFree ---
    // Added a more robust check for the base URL.
    if (!BILLING_API_BASE_URL || !BILLING_API_AUTH_TOKEN) {
      console.error("ERROR: BILLING_API_BASE_URL or BILLING_API_AUTH_TOKEN environment variable is not set!");
      // Throw an error that your outer catch block can handle
      throw new Error("Missing BillFree API configuration environment variables.");
    }

    const billFreeApiResponse = await fetch(BILLING_API_BASE_URL, { // Using BASE_URL
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // No Authorization header, as per your confirmation.
      },
      body: JSON.stringify(billFreePayload),
    });

    const billFreeResponseData = await billFreeApiResponse.json();

    if (!billFreeApiResponse.ok) {
      console.error("BillFree API Error:", billFreeApiResponse.status, billFreeResponseData);
      throw new Response(
        `BillFree API Integration Failed (Status: ${billFreeApiResponse.status}): ${JSON.stringify(billFreeResponseData)}`,
        { status: billFreeApiResponse.status }
      );
    }

    console.log("BillFree API Success:", billFreeResponseData);

    return json({
      message: "Flow Action executed successfully and BillFree payload sent.",
      billFreeResponse: billFreeResponseData,
      payloadSent: billFreePayload
    });

  } 
  catch (error) {
    console.error("Error during Flow Action execution:", error);
    // Ensure this throws a proper HTTP response that Shopify Flow can understand.
    // If it's a generic Error, return 500. If it's a Response object, re-throw it.
    if (error instanceof Response) {
      throw error; // Re-throw the Response object
    }
    throw new Response(`Internal Server Error during BillFree API call: ${error instanceof Error ? error.message : String(error)}`, { status: 500 });
  }
} // End of action function