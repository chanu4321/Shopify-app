// app/routes/api.loyalty.verify-otp.ts

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate, shopify_api } from "../shopify.server";
import db from "../db.server"; // Adjust the import path as per your project structure
// import { db } from "~/db.server"; // for fetching auth_token and potentially storing/retrieving customer's loyalty state

interface VerifyOtpRequestPayload {
  user_phone: string;
  otp: string;
  cart_total: string;
  customer_gid: string;
}

interface BillfreeVerifyOtpResponse {
  error: boolean;
  response: string;
  // Add other properties Billfree's verify OTP API returns
}

interface BillfreeRedeemResponseAfterOtp {
  error: boolean;
  response: string; // e.g., "l5" or "Redemption Successful"
  maxRedeemablePts: number;
  maxRedeemableAmt: number; // This is the discount value in Rupees
  net_payable: number;
  otpFlag: string; // "y" or "n"
  scheme_message: string;
}

// NEW INTERFACE: For Shopify Admin GraphQL priceRuleCreate mutation response
interface PriceRuleCreateResponseData {
  priceRuleCreate?: {
    priceRule?: {
      id: string;
      title: string;
      codes: {
        edges: Array<{
          node: {
            code: string;
          };
        }>;
      };
    };
    userErrors: Array<{
      field: string[];
      message: string;
    }>;
  };
}

// And the full response body structure for the GraphQL client
interface GraphqlResponseBody<T> {
  data?: T;
  errors?: any[]; // Array of GraphQL errors if any
}


export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  if (!session || !session.shop) {
    console.error("[Verify OTP Proxy] Authentication failed.");
    return json({ error: "Unauthorized access." }, { status: 401 });
  }

  const payload: VerifyOtpRequestPayload = await request.json();
  const { user_phone, otp, cart_total, customer_gid } = payload;

  if (!user_phone || !otp || !cart_total || !customer_gid) {
    return json({ error: "Missing required parameters for OTP verification or redemption." }, { status: 400 });
  }

  let auth_token: string;
  try {
    const offlineSessionId = `offline_${session.shop}`;
    const shopSession = await db.session.findUnique({
        where: { id: offlineSessionId }, // This correctly looks up the offline session
        select: { billFreeAuthToken: true, isBillFreeConfigured: true, fieldMappings: true },
      });

      if (!shopSession || !shopSession.isBillFreeConfigured || !shopSession.billFreeAuthToken) {
        console.error(`BillFree not configured or token missing for shop: ${session.shop} (Session ID: ${offlineSessionId})`);
        return json({ message: "BillFree integration not configured for this shop." }, { status: 400 });
      }

      const billFreeAuthToken = shopSession.billFreeAuthToken;

      auth_token = billFreeAuthToken;
    if (!auth_token) {
        console.warn(`[Redeem Proxy] Using temporary/hardcoded auth token for ${session.shop}. Please configure database lookup.`);
        // In production, you'd likely throw an error here:
        // throw new Error("Billfree Auth Token not securely retrieved from database.");
    }
  } catch (error) {
    console.error("Error retrieving Billfree auth token from database:", error);
    return json({ error: "Failed to retrieve Billfree auth token from database." }, { status: 500 });
  }

  try {
    const { user_phone, otp, token } = await request.json();
    if (!user_phone || !otp || !token) {
        return json({ success: false, message: 'Missing user_phone, otp, or token' }, { status: 400 });
    }
    // Step 1: Call Billfree's OTP verification API
    // IMPORTANT: Replace '/verify_otp_endpoint' with the actual Billfree API endpoint
    // and adjust payload based on Billfree's documentation for OTP verification.
    const verifyOtpResponse = await fetch(`${process.env.BILLFREE_API_VOTP_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        
      },
      body: JSON.stringify({
        auth_token: auth_token,
        user_phone: user_phone,
        otp: otp,
        dial_code: "91", // Assuming fixed for India
        token: token, // Include auth_token in body if required by Billfree
        // Add any other required parameters (e.g., transaction_id if from send_otp)
      })
    });

    if (!verifyOtpResponse.ok) {
      const errorText = await verifyOtpResponse.text();
      console.error(`Billfree API (verify_otp) error: ${verifyOtpResponse.status} - ${errorText}`);
      throw new Error(`Billfree API (verify_otp) failed: ${verifyOtpResponse.statusText}. Error: ${errorText}`);
    }

    const verifyData: BillfreeVerifyOtpResponse = await verifyOtpResponse.json();

    if (verifyData.error) {
        console.error(`Billfree OTP Verify API returned error: ${verifyData.response}`);
        return json({ success: false, message: verifyData.response, discountCode: null }, { status: 400 });
    }

    // OTP verified successfully. Now, proceed to redeem points and create a discount code.

    // Step 2: Call Billfree's apply_redemption API (API #2) to get the discount value
    // Assuming apply_redemption is called AFTER successful OTP verification
    // You might need to get customer's current cart total for bill_amt
    const inv_no = `CUST_ACC_REDEMPTION_${customer_gid.split('/').pop()}_${Date.now()}`;
    const today = new Date();
    const bill_date = today.toISOString().split('T')[0];

    const redemptionPayload = {
      auth_token: auth_token,
      user_phone: user_phone,
      dial_code: "91", // Assuming fixed
      inv_no: inv_no,
      bill_date: bill_date,
      bill_amt: cart_total, // Use the cart_total passed from the UI Extension
    };

    const applyRedemptionResponse = await fetch(`${process.env.BILLFREE_API_REDEEM_URL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(redemptionPayload)
    });

    if (!applyRedemptionResponse.ok) {
      const errorText = await applyRedemptionResponse.text();
      console.error(`Billfree API (apply_redemption after OTP) error: ${applyRedemptionResponse.status} - ${errorText}`);
      throw new Error(`Billfree API (redemption) failed after OTP: ${applyRedemptionResponse.statusText}. Error: ${errorText}`);
    }

    const redeemData: BillfreeRedeemResponseAfterOtp = await applyRedemptionResponse.json();

    // Check for Billfree's internal error flag or successful response
    // The example redeem response showed "response: 'l5'" on success, so we check for 'error' flag.
    if (redeemData.error) { // Assuming 'error: true' indicates a failure state from Billfree
      console.error(`Billfree redemption API after OTP returned error: ${redeemData.response}`);
      return json({ success: false, message: `Redemption failed: ${redeemData.response}`, discountCode: null }, { status: 400 });
    }

    const discountValueRupees = redeemData.maxRedeemableAmt || 0; // Use maxRedeemableAmt

    if (discountValueRupees <= 0) {
      // It's possible to have 0 redeemable amount, which isn't an error but means no discount
      return json({ success: false, message: "No redeemable discount value received from Billfree.", discountCode: null }, { status: 200 });
    }

    console.log(`Billfree confirmed redeemable amount: ${discountValueRupees} INR`);

    // Step 3: Create a single-use Shopify Discount Code with the value from Billfree
    const uniqueDiscountCode = `LOYALTY-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    const discountAmount = discountValueRupees;

    const discountCreationPayload = {
      priceRule: {
        title: `Loyalty Redemption for ${user_phone} (${new Date().toLocaleDateString('en-IN')})`,
        targetType: "LINE_ITEM", // Use enum values for GraphQL
        targetSelection: "ALL", // Use enum values for GraphQL
        allocationMethod: "ACROSS", // Use enum values for GraphQL
        valueType: "FIXED_AMOUNT", // Use enum values for GraphQL
        value: `${discountAmount.toFixed(2)}`, // Shopify expects positive for value
        customerSelection: "PREREQUISITE", // Use enum values for GraphQL
        prerequisiteCustomerIds: [customer_gid], // Pass the full GID here
        oncePerCustomer: true,
        usageLimit: 1,
        startsAt: new Date().toISOString(),
        // Add a short endsAt to clean up old codes, e.g., 24 hours from now
        endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
      discountCode: {
        code: uniqueDiscountCode
      }
    };

    const client = new shopify_api.clients.Graphql({ session });

    const createDiscountMutation = `
      mutation priceRuleCreate($priceRule: PriceRuleInput!, $discountCode: DiscountCodeInput) {
        priceRuleCreate(priceRule: $priceRule, discountCode: $discountCode) {
          priceRule {
            id
            title
            codes(first: 1) {
              edges {
                node {
                  code
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const createDiscountResponse = await client.query({
      data: {
        query: createDiscountMutation,
        variables: discountCreationPayload,
      },
    });

    if (!createDiscountResponse.body) {
      console.error("Shopify GraphQL response missing body (no data received).");
      return json({ success: false, message: "Failed to create Shopify discount: No data received from Shopify.", discountCode: null }, { status: 500 });
    }

    const graphqlResponseData = createDiscountResponse.body as { data?: PriceRuleCreateResponseData, errors?: any[] };

    // Check for GraphQL errors from Shopify API itself (e.g., syntax errors in query)
    if (graphqlResponseData.errors && graphqlResponseData.errors.length > 0) {
        console.error("Shopify GraphQL client errors:", graphqlResponseData.errors);
        return json({ success: false, message: `Shopify GraphQL client errors: ${JSON.stringify(graphqlResponseData.errors)}`, discountCode: null }, { status: 500 });
    }


    if (graphqlResponseData?.data?.priceRuleCreate?.userErrors && graphqlResponseData.data.priceRuleCreate.userErrors.length > 0) {
      console.error("Shopify Discount Creation Errors (userErrors):", graphqlResponseData.data.priceRuleCreate.userErrors);
      return json({ success: false, message: `Failed to create Shopify discount: ${JSON.stringify(graphqlResponseData.data.priceRuleCreate.userErrors)}`, discountCode: null }, { status: 500 });
    }

    const createdDiscountCode = graphqlResponseData?.data?.priceRuleCreate?.priceRule?.codes?.edges[0]?.node?.code;

    if (!createdDiscountCode) {
      console.error("Shopify did not return the created discount code (Price Rule or Code not created).");
      return json({ success: false, message: "Failed to create Shopify discount code (code not returned).", discountCode: null }, { status: 500 });
    }

    console.log(`Successfully created Shopify discount code: ${createdDiscountCode}`);
    return json({ success: true, message: "OTP Verified, Redemption Processed, and Shopify Discount Code Generated!", discountCode: createdDiscountCode });

  } catch (error: any) {
    console.error("Error verifying OTP, redeeming points, or creating discount:", error);
    return json({ success: false, message: `Failed to complete redemption: ${error.message}`, discountCode: null }, { status: 500 });
  }
}