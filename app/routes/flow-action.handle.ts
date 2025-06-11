// app/routes/app.flow-action.handle.ts
import { ActionFunction, json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action: ActionFunction = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const body = await request.json();

  const orderId = body.orderId;
  const customerId = body.customerId;

  if (!orderId || !customerId) {
    throw new Response("Missing orderId or customerId in Flow Action payload", { status: 400 });
  }

  // Your GraphQL query (already updated in your message, copy it here)
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
        # CORRECTED: Use totalCashRoundingAdjustment instead of amountRoundingSet
        totalCashRoundingAdjustment { # For round_off
          paymentSet { # CORRECTED: Changed from amountSet to paymentSet
            shopMoney { amount currencyCode }
          }
        }
        # Use discountCodes on Order directly for coupon_redeemed
        discountCodes # Provides an array of discount codes used

        # CORRECTED: Adjust fields selected on DiscountApplication
        # For now, we fetch basic info. If more detailed coupon info is needed,
        # we'd need to use inline fragments (e.g., ... on DiscountCodeApplication { discountCode })
        discountApplications(first: 10) { # To get specific discount application details if needed
          edges {
            node {
              allocationMethod
              targetSelection
              targetType
              value { # Value is an interface, might need inline fragment for specific types
                __typename # To know the type of pricing value
                # Example: ... on PricingValueFixedAmount { amount { shopMoney { amount currencyCode } } }
                # For simplicity, we'll try to access generic amount or assume it's available
                # Or get it from the discount code itself.
                # Let's rely on totalDiscountsSet for the final amount.
              }
              # You might need to add inline fragments here if you need more specific details, e.g.:
              # ... on DiscountCodeApplication {
              #   discountCode
              # }
            }
          }
        }
        lineItems(first: 250) { # For particulars
          edges {
            node {
              id
              name # For particulars.description
              sku # For particulars.sku_id
              quantity # For particulars.qty
              variantTitle
              originalUnitPriceSet { # For particulars.rate
                shopMoney { amount currencyCode }
              }
              totalDiscountSet { # Line item specific discount for item_disc calculation
                shopMoney { amount currencyCode }
              }
              taxLines { # For particulars.gst and gst_summary
                priceSet {
                  shopMoney { amount currencyCode }
                }
                rate # For particulars.gst
                title # For gst_summary (CGST, SGST, IGST)
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
        transactions(first: 5) { # For payment_info and cash_paid
            id
            kind
            gateway # For payment_info.text (Payment Mode)
            amountSet { # For payment_info.Amount
                shopMoney { amount currencyCode }
            }
            status
        }
      }
      customer(id: $customerId) {
        id
        firstName # For cust_name
        lastName # For cust_name
        defaultPhoneNumber { # For user_phone
          phoneNumber
        }
        defaultEmailAddress { # Assuming this might be used for other purposes
          emailAddress
        }
        # Aliased metafields for distinct retrieval
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
    console.error("Failed to fetch order or customer data:", responseJson.errors);
    throw new Response("Failed to fetch order or customer data", { status: 500 });
  }

  // --- BillFree Payload Construction ---

  // Date and Time Formatting
  const orderCreatedAt = new Date(orderData.createdAt);
  const billDate = orderCreatedAt.toISOString().split('T')[0]; // YYYY-MM-DD
  const billTime = orderCreatedAt.toTimeString().split(' ')[0]; // HH:MM:SS

  // Customer Details
  const custName = `${customerData.firstName || ""} ${customerData.lastName || ""}`.trim();
  const userPhone = customerData.defaultPhoneNumber?.phoneNumber || "";

  // Customer Metafields (using aliases from query)
  const custBday = customerData.custBdayMetafield?.value || "";
  const custAnniv = customerData.custAnnivMetafield?.value || "";
  const referrerPhone = customerData.referrerPhoneMetafield?.value || "";

  // Line Items (Particulars)
  const particulars = orderData.lineItems.edges.map((edge: any) => {
    const item = edge.node;
    const originalUnitPrice = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount || "0");
    const totalLineItemDiscount = parseFloat(item.totalDiscountSet?.shopMoney?.amount || "0");
    const quantity = item.quantity;

    // amount: (Original Unit Price * Quantity) - Total Line Item Discount for this particular item
    const itemAmount = (originalUnitPrice * quantity - totalLineItemDiscount).toFixed(2);

    // HSN code and Barcode from metafields (will be empty string if metafield not set)
    const hsnCode = item.product?.metafield?.value || "";
    const barcode = item.variant?.metafield?.value || ""; // assuming variant metafield

    // GST rate for the particular item (from taxLines)
    // BillFree expects a single 'gst' rate per item. We'll take the first one if multiple.
    const gstRate = item.taxLines?.[0]?.rate ? (item.taxLines[0].rate * 100).toFixed(2) : "0.00";

    return {
      sku_id: item.sku || "",
      description: item.name || "",
      hsn: hsnCode,
      gst: gstRate,
      qty: quantity.toString(), // BillFree expects string for qty
      rate: originalUnitPrice.toFixed(2), // Original unit price
      amount: itemAmount, // Net amount for this line item
    };
  });

  // Additional Info
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

  // GST Summary
  const gstSummaryMap = new Map<string, { rate: number, taxable: number, cgst: number, sgst: number, igst: number, total: number }>();

  orderData.lineItems.edges.forEach((edge: any) => {
    const item = edge.node;
    const itemSalesPrice = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount || "0") * item.quantity - parseFloat(item.totalDiscountSet?.shopMoney?.amount || "0");

    item.taxLines.forEach((taxLine: any) => {
      const rateKey = taxLine.rate.toFixed(2); // Use rate as key
      const taxAmount = parseFloat(taxLine.priceSet?.shopMoney?.amount || "0");

      let taxableAmountForTaxLine = 0;
      if (taxLine.rate > 0) {
        taxableAmountForTaxLine = taxAmount / taxLine.rate;
      } else {
        // If tax rate is 0, the entire item's sales price (without other taxes) could be considered taxable for 0%
        taxableAmountForTaxLine = itemSalesPrice; // Simplified: if no tax, then the whole item's sales price is taxable at 0%
      }

      if (!gstSummaryMap.has(rateKey)) {
        gstSummaryMap.set(rateKey, { rate: parseFloat(rateKey) * 100, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 });
      }

      const currentSummary = gstSummaryMap.get(rateKey)!;
      currentSummary.taxable += taxableAmountForTaxLine;
      currentSummary.total += taxAmount;

      // Distribute tax amount to CGST, SGST, IGST based on title
      const taxTitle = taxLine.title?.toUpperCase();
      if (taxTitle === "CGST") {
        currentSummary.cgst += taxAmount;
      } else if (taxTitle === "SGST") {
        currentSummary.sgst += taxAmount;
      } else if (taxTitle === "IGST") {
        currentSummary.igst += taxAmount;
      }
      // Add more conditions for other tax titles if necessary
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

  // Add the isTotal entry for GST summary
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


  // Payment Info
  const paymentInfo: { text: string; value: string }[] = [];
  let cashPaidAmount = "0.00";

  orderData.transactions.forEach((transaction: any) => {
    let paymentModeText = transaction.gateway || "Other";
    // Customize gateway names if BillFree expects specific strings
    if (transaction.gateway === "bogus") {
      paymentModeText = "Cash"; // Example: Map "bogus" to "Cash" for testing
    } else if (transaction.gateway === "shopify_payments") {
      paymentModeText = "Credit Card";
    }
    // Add more gateway mappings as needed

    paymentInfo.push({
      text: "Payment Mode",
      value: paymentModeText,
    });
    paymentInfo.push({
      text: "Amount",
      value: parseFloat(transaction.amountSet?.shopMoney?.amount || "0").toFixed(2),
    });

    // Determine cash_paid
    if (transaction.kind === "SALE" && transaction.gateway === "bogus" && transaction.status === "SUCCESS") {
      cashPaidAmount = parseFloat(transaction.amountSet?.shopMoney?.amount || "0").toFixed(2);
    }
  });


  // Final BillFree Payload
  const billFreePayload = {
    auth_token: process.env.BILLFREE_AUTH_TOKEN || "", // MANDATORY: Set as env var
    inv_no: orderData.name, // MANDATORY
    bill_type: "sale", // MANDATORY: Fixed value
    user_phone: userPhone, // MANDATORY
    dial_code: "91", // Fixed, adjust if your store serves other countries
    cust_name: custName, // MANDATORY
    cust_bday: custBday, // From customer metafield
    cust_anniv: custAnniv, // From customer metafield
    bill_date: billDate, // MANDATORY
    bill_time: billTime, // MANDATORY
    store_identifier: process.env.BILLFREE_STORE_IDENTIFIER || "", // From env var or fixed
    is_printed: "n", // MANDATORY: Fixed value
    pts_redeemed: "", // Not directly from Shopify, leave empty or populate if you have a source
    // For coupon_redeemed, take the first discount code if available
    coupon_redeemed: orderData.discountCodes?.[0] || "",
    bill_amount: parseFloat(orderData.totalPriceSet?.shopMoney?.amount || "0").toFixed(2), // MANDATORY
    discount_amount: totalDiscountAmount,
    referrer_phone: referrerPhone, // From customer metafield
    pts_balance: "", // Not directly from Shopify, leave empty or populate if you have a source
    change_return: "", // Not directly from Shopify, leave empty
    cash_paid: cashPaidAmount, // MANDATORY (derived from transactions)
    net_payable: parseFloat(orderData.totalPriceSet?.shopMoney?.amount || "0").toFixed(2), // Typically bill_amount
    // CORRECTED: Access paymentSet for round_off
    round_off: parseFloat(orderData.totalCashRoundingAdjustment?.paymentSet?.shopMoney?.amount || "0").toFixed(2),
    cashier_name: "", // Not directly from Shopify, leave empty
    remarks: orderData.note || "", // From order.note, or empty
    allow_points_accrual: "y", // Fixed value
    particulars: particulars, // MANDATORY
    additional_info: additionalInfo, // MANDATORY
    gst_summary: gstSummary, // MANDATORY
    payment_info: paymentInfo, // MANDATORY
  };

  console.log("Generated BillFree Payload:", JSON.stringify(billFreePayload, null, 2));

  //-- Make the actual API call to BillFree here
 try {
    // Make the actual API call to BillFree
    const billFreeApiResponse = await fetch(process.env.BILLING_API_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Ensure this Authorization header format is correct for BillFree
        // Some APIs use "Token" instead of "Bearer", or a custom header.
        // Check BillFree's API documentation.
        "Authorization": `Bearer ${process.env.BILLING_API_AUTH_TOKEN}`
      },
      body: JSON.stringify(billFreePayload),
    });

    const billFreeResponseData = await billFreeApiResponse.json();

    if (!billFreeApiResponse.ok) {
      // Log the full error response from BillFree for detailed debugging
      console.error("BillFree API Error:", billFreeApiResponse.status, billFreeResponseData);

      // Throw a specific error to Shopify Flow for clearer debugging in the Flow UI
      throw new Response(
        `BillFree API Integration Failed (Status: ${billFreeApiResponse.status}): ${JSON.stringify(billFreeResponseData)}`,
        { status: billFreeApiResponse.status }
      );
    }

    console.log("BillFree API Success:", billFreeResponseData);

    // You can return the success response from BillFree back to Shopify Flow if needed
    return json({
      message: "Flow Action executed successfully and BillFree payload sent.",
      billFreeResponse: billFreeResponseData, // Include BillFree's response for traceability
      payloadSent: billFreePayload // For debugging, remove or limit in production
    });

  } catch (error) {
    // Catch any network errors or errors thrown before the fetch call
    console.error("Error during BillFree API call:", error);
    throw new Response(`Internal Server Error during BillFree API call: ${error.message || error}`, { status: 500 });
  }


  return json({
    message: "Flow Action executed successfully and BillFree payload generated.",
    payload: billFreePayload, // For debugging, remove or limit in production
  });
};