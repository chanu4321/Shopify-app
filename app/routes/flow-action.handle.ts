// app/routes/app.flow-action.handle.ts

// This log should appear first if the module loads successfully.
// If you don't see this, the issue is with Vercel's deployment/runtime loading the file.
console.log("--- FLOW ACTION HANDLER MODULE LOADED ---");

import { ActionFunction, json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action: ActionFunction = async ({ request }) => {
  // This log should appear if the 'action' function is invoked.
  // If you don't see this but see the module loaded log, the issue might be in how Remix invokes the action or an early synchronous error.
  console.log("--- FLOW ACTION HANDLER FUNCTION STARTED ---");

  // This is a critical step. If 'authenticate.admin' fails or throws synchronously,
  // subsequent logs won't appear. However, it usually throws an async error.
  const { admin } = await authenticate.admin(request);
  const body = await request.json(); // If the request body is malformed JSON, this could throw synchronously.

  const orderId = body.orderId;
  const customerId = body.customerId;

  if (!orderId || !customerId) {
    // This throws a 400. If you get a 410, it means this condition is NOT met,
    // or the error is happening before this point.
    throw new Response("Missing orderId or customerId in Flow Action payload", { status: 400 });
  }

  // Your GraphQL query - this part is mostly static string, unlikely to cause runtime errors
  const ORDER_AND_CUSTOMER_QUERY = `#graphql
    query GetOrderAndCustomerDetails($orderId: ID!, $customerId: ID!) {
      order(id: $orderId) {
        id
        name # For inv_no
        createdAt # For bill_date, bill_time
        totalPriceSet { # For bill_amount (total price including taxes and discounts)
          shopMoney { amount currencyCode }
        }
        totalDiscountsSet { # For discount_amount (total order discount before returns)
          shopMoney { amount currencyCode }
        }
        totalCashRoundingAdjustment { # For round_off
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
                metafield(namespace: "custom", key: "hsn_code") {
                  value
                }
              }
              variant {
                id
                metafield(namespace: "custom", key: "barcode") {
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

  const response = await admin.graphql(ORDER_AND_CUSTOMER_QUERY, {
    variables: {
      orderId: orderId,
      customerId: customerId,
    },
  });

  const responseJson = await response.json();
  const orderData = responseJson.data?.order;
  const customerData = responseJson.data?.customer;

  if (!orderData || !customerData) {
    // This throws a 500. If you get a 410, it means this condition is NOT met,
    // or the error is happening before this point.
    console.error("Failed to fetch order or customer data:", responseJson.errors);
    throw new Response("Failed to fetch order or customer data", { status: 500 });
  }

  // --- BillFree Payload Construction ---
  // This section involves a lot of data processing.
  // Errors here (e.g., trying to access a property on 'undefined' if orderData/customerData is malformed)
  // could cause synchronous runtime errors that stop execution.
  // However, the optional chaining (`?.`) and default "0" or `""` mitigate many of these.

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
    auth_token: process.env.BILLFREE_AUTH_TOKEN || "", // MANDATORY: Set as env var
    inv_no: orderData.name,
    bill_type: "sale",
    user_phone: userPhone,
    dial_code: "91",
    cust_name: custName,
    cust_bday: custBday,
    cust_anniv: custAnniv,
    bill_date: billDate,
    bill_time: billTime,
    store_identifier: process.env.BILLFREE_STORE_IDENTIFIER || "",
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
  // If you don't see them, execution is stopping before this point.
  console.log("Generated BillFree Payload:", JSON.stringify(billFreePayload, null, 2));
  console.log("DEBUG: About to make BillFree API call.");
  console.log("DEBUG: BILLING_API_URL:", process.env.BILLING_API_URL);
  console.log("DEBUG: BILLING_API_AUTH_TOKEN (first 5 chars):", process.env.BILLING_API_AUTH_TOKEN?.substring(0, 5) + '...');
  console.log("DEBUG: BillFree Payload (partial):", JSON.stringify(billFreePayload, null, 2).substring(0, 500) + '...');

  // --- Make the actual API call to BillFree ---
  try {
    // *** POTENTIAL ISSUE HERE ***
    // The '!' (non-null assertion operator) tells TypeScript that you are certain
    // process.env.BILLING_API_URL will not be null or undefined.
    // However, at runtime, if it IS null/undefined, this will throw a synchronous error
    // before the fetch request is even initiated. This could cause the "no logs" behavior.
    if (!process.env.BILLING_API_URL) {
      console.error("ERROR: BILLING_API_URL environment variable is not set!");
      // Throw a specific error that your outer catch block can handle
      throw new Error("BILLING_API_URL environment variable is not set.");
    }

    const billFreeApiResponse = await fetch(process.env.BILLING_API_URL, { // Removed '!' for safety
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

  } catch (error) {
    // This catch block should capture any errors, including the one if BILLING_API_URL is missing.
    console.error("Error during BillFree API call:", error);
    // Ensure this throws a proper HTTP response that Shopify Flow can understand.
    throw new Response(`Internal Server Error during BillFree API call: ${error.message || String(error)}`, { status: 500 });
  }

};