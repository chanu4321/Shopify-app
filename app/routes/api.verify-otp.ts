// app/routes/api.loyalty.verify-otp.ts

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate, shopify_api } from "../shopify.server";
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
  discount_value_rupees: number;
  error: boolean;
  response: string;
  // ... other properties from apply_redemption after successful OTP
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
    // --- Fetch AUTH_TOKEN from your database using session.shop ---
    // This is a placeholder. In production, securely fetch this from your database.
    auth_token = process.env.BILLFREE_AUTH_TOKEN_FROM_DB || "DEMO_HARDCODED_AUTH_TOKEN_FROM_DB";
    if (!auth_token || auth_token === "DEMO_HARDCODED_AUTH_TOKEN_FROM_DB") {
      console.warn(`[Verify OTP Proxy] Using temporary/hardcoded auth token for ${session.shop}. Please configure database lookup.`);
    }
  } catch (dbError: any) {
    console.error(`Database error fetching auth token for shop ${session.shop}:`, dbError);
    return json({ error: `Failed to retrieve authentication token: ${dbError.message}` }, { status: 500 });
  }

  try {
    // Step 1: Call Billfree's OTP verification API
    // IMPORTANT: Replace '/verify_otp_endpoint' with the actual Billfree API endpoint
    // and adjust payload based on Billfree's documentation for OTP verification.
    const verifyOtpResponse = await fetch(`${process.env.BILLFREE_API_BASE_URL}/verify_otp_endpoint`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth_token}`
      },
      body: JSON.stringify({
        auth_token: auth_token,
        mobile: user_phone,
        otp: otp,
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

    const applyRedemptionResponse = await fetch(`${process.env.BILLFREE_API_BASE_URL}/apply_redemption`, {
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

    if (redeemData.error) {
      console.error(`Billfree redemption API after OTP returned error: ${redeemData.response}`);
      return json({ success: false, message: `Redemption failed: ${redeemData.response}`, discountCode: null }, { status: 400 });
    }

    const discountValueRupees = redeemData.discount_value_rupees || 0;

    if (discountValueRupees <= 0) {
      return json({ success: false, message: "No discount value received from redemption.", discountCode: null }, { status: 200 });
    }

    // Step 3: Create a single-use Shopify Discount Code
    const uniqueDiscountCode = `LOYALTY-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    const discountAmount = discountValueRupees;

    const discountCreationPayload = {
      priceRule: {
        title: `Loyalty Redemption for ${user_phone} (${new Date().toLocaleDateString('en-IN')})`, // Used en-IN for date format
        target_type: "line_item", // You might adjust this based on how the discount applies
        target_selection: "all",
        allocation_method: "across",
        value_type: "fixed_amount",
        value: `-${discountAmount.toFixed(2)}`,
        customer_selection: "prerequisite",
        prerequisite_customer_ids: [customer_gid.split('/').pop()],
        once_per_customer: true,
        usage_limit: 1,
        starts_at: new Date().toISOString(),
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

    // Type assert the response body
    const createDiscountResponse = await client.query({
      data: {
        query: createDiscountMutation,
        variables: discountCreationPayload,
      },
    });

    // Check for network/client errors first
    if (!createDiscountResponse.body) {
      console.error("Shopify GraphQL response missing body (no data received).");
      return json({ success: false, message: "Failed to create Shopify discount: No data received from Shopify.", discountCode: null }, { status: 500 });
    }

    // Type assert the data part of the response body
    const graphqlResponseData = createDiscountResponse.body as PriceRuleCreateResponseData;

    if (graphqlResponseData?.priceRuleCreate?.userErrors && graphqlResponseData.priceRuleCreate.userErrors.length > 0) {
      console.error("Shopify Discount Creation Errors:", graphqlResponseData.priceRuleCreate.userErrors);
      return json({ success: false, message: `Failed to create Shopify discount: ${JSON.stringify(graphqlResponseData.priceRuleCreate.userErrors)}`, discountCode: null }, { status: 500 });
    }

    const createdDiscountCode = graphqlResponseData?.priceRuleCreate?.priceRule?.codes?.edges[0]?.node?.code;

    if (!createdDiscountCode) {
      console.error("Shopify did not return the created discount code.");
      return json({ success: false, message: "Failed to create Shopify discount code.", discountCode: null }, { status: 500 });
    }

    return json({ success: true, message: "OTP Verified and Discount Code Generated!", discountCode: createdDiscountCode });

  } catch (error: any) {
    console.error("Error verifying OTP or creating discount:", error);
    return json({ success: false, message: `Failed to complete redemption: ${error.message}`, discountCode: null }, { status: 500 });
  }
}