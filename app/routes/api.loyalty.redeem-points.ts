import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate, shopify_api } from "../shopify.server";
import db from "../db.server";

// Define interfaces for the data structures used in this route
interface RedeemRequest {
  customer_id: string;
  otp_code?: string;
  bill_amt: string;
}

interface BillfreeRedeemResponse {
  error: boolean;
  response: string;
  discount_value_rupees: number;
  maxRedeemablePts: number;
  maxRedeemableAmt: number;
  net_payable: number;
  otpFlag: string;
  scheme_message: string;
}

export async function action({ request }: ActionFunctionArgs) {
  // Manually handle preflight requests
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*", // You may want to restrict this to your shop's domain in production
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }
  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, { status: 405 });
  }

  const { cors } = await authenticate.public.customerAccount(request);

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return cors(json({ error: "Missing or invalid authorization token." }, { status: 401 }));
  }
  const token = authHeader.substring(7);

  let shopDomain: string;
  try {
    const session = await shopify_api.session.decodeSessionToken(token);
    shopDomain = session.dest.replace("https://", "");
  } catch (error: any) {
    console.error("Error decoding session token:", error);
    return cors(json({ error: `Invalid session token: ${error.message}` }, { status: 401 }));
  }

  const payload: RedeemRequest = await request.json();
  const { customer_id, otp_code, bill_amt } = payload;

  if (!customer_id || !bill_amt) {
    return cors(json({ error: "Missing required parameters." }, { status: 400 }));
  }

  try {
    const offlineSessionId = `offline_${shopDomain}`;
    const shopSession = await db.session.findUnique({
      where: { id: offlineSessionId },
      select: {
        billFreeAuthToken: true,
        isBillFreeConfigured: true,
        accessToken: true,
        shop: true,
      },
    });

    if (!shopSession?.isBillFreeConfigured || !shopSession.billFreeAuthToken || !shopSession.accessToken) {
      return cors(json({ error: "BillFree not configured for this shop." }, { status: 400 }));
    }

    const client = new shopify_api.clients.Graphql({
      session: {
        id: offlineSessionId,
        shop: shopSession.shop,
        accessToken: shopSession.accessToken,
        isOnline: false,
      } as any,
    });

    const customerQuery = `
      query GetCustomer($id: ID!) {
        customer(id: $id) {
          phone
        }
      }
    `;

    const customerResponse = await client.query({
      data: {
        query: customerQuery,
        variables: { id: customer_id },
      },
    });

    const customerData = (customerResponse.body as any)?.data?.customer;
    if (!customerData?.phone) {
      return cors(json({ error: "Customer phone number not found." }, { status: 400 }));
    }

    if (otp_code) {
      const otpResponse = await fetch(process.env.BILLFREE_API_VOTP_URL!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: shopSession.billFreeAuthToken,
          user_phone: customerData.phone,
          dial_code: "91",
          otp_code: otp_code,
        }),
      });

      if (!otpResponse.ok) {
        return cors(json({ error: "OTP verification failed." }, { status: 400 }));
      }
      const otpData = await otpResponse.json();
      if (otpData.error) {
        return cors(json({ error: "Invalid OTP." }, { status: 400 }));
      }
    }

    const redeemResponse = await fetch(process.env.BILLFREE_API_REDEEM_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: shopSession.billFreeAuthToken,
        user_phone: customerData.phone,
        dial_code: "91",
        inv_no: `LOYALTY_${customer_id.split('/').pop()}_${Date.now()}`,
        bill_date: new Date().toISOString().split('T')[0],
        bill_amt: bill_amt,
      }),
    });

    if (!redeemResponse.ok) {
      return cors(json({ error: "Redemption failed." }, { status: 500 }));
    }

    const redeemData: BillfreeRedeemResponse = await redeemResponse.json();
    if (redeemData.error || !redeemData.maxRedeemableAmt) {
      return cors(json({ error: redeemData.response || "No discount available." }, { status: 400 }));
    }

    const discountAmount = redeemData.maxRedeemableAmt;
    const discountCode = `BILLFREE${Date.now()}`;

    const createDiscountMutation = `
      mutation CreateCodeDiscount($codeDiscount: DiscountCodeAppInput!) {
        discountCodeAppCreate(codeDiscount: $codeDiscount) {
          codeAppDiscount {
            discountCode
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const discountResponse = await client.query({
      data: {
        query: createDiscountMutation,
        variables: {
          codeDiscount: {
            title: `Loyalty Points Discount - ${discountCode}`,
            code: discountCode,
            startsAt: new Date().toISOString(),
            endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            usageLimit: 1,
            appliesOncePerCustomer: true,
            customerSelection: {
              customers: {
                add: [customer_id],
              },
            },
            value: {
              fixedAmountValue: {
                amount: discountAmount.toFixed(2),
              },
            },
          },
        },
      },
    });

    const discountResult = (discountResponse.body as any)?.data?.discountCodeAppCreate;
    if (discountResult?.userErrors?.length > 0) {
      console.error("Discount creation errors:", discountResult.userErrors);
      return cors(json({ error: "Failed to create discount code." }, { status: 500 }));
    }

    return cors(json({
      success: true,
      discountCode: discountCode,
      discountAmount: discountAmount,
      pointsRedeemed: redeemData.maxRedeemablePts,
      message: `₹${discountAmount} discount code created successfully!`,
    }));

  } catch (error: any) {
    console.error("Error in loyalty redemption:", error);
    return cors(json({ error: `Redemption failed: ${error.message}` }, { status: 500 }));
  }
}
