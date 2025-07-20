import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
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

const corsHeaders = { "Access-Control-Allow-Origin": "*" };



export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, { status: 405, headers: corsHeaders });
  }

  await authenticate.public.customerAccount(request);

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return json({ error: "Missing or invalid authorization token." }, { status: 401, headers: corsHeaders });
  }
  const token = authHeader.substring(7);

  let shopDomain: string;
  try {
    const session = await shopify_api.session.decodeSessionToken(token);
    shopDomain = session.dest.replace("https://", "");
  } catch (error: any) {
    console.error("Error decoding session token:", error);
    return json({ error: `Invalid session token: ${error.message}` }, { status: 401, headers: corsHeaders });
  }

  const payload: RedeemRequest = await request.json();
  const { customer_id, otp_code, bill_amt } = payload;

  if (!customer_id || !bill_amt) {
    return json({ error: "Missing required parameters." }, { status: 400, headers: corsHeaders });
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
      return json({ error: "BillFree not configured for this shop." }, { status: 400, headers: corsHeaders });
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
      return json({ error: "Customer phone number not found." }, { status: 400, headers: corsHeaders });
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
        return json({ error: "OTP verification failed." }, { status: 400, headers: corsHeaders });
      }
      const otpData = await otpResponse.json();
      if (otpData.error) {
        return json({ error: "Invalid OTP." }, { status: 400, headers: corsHeaders });
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
      return json({ error: "Redemption failed." }, { status: 500, headers: corsHeaders });
    }

    const redeemData: BillfreeRedeemResponse = await redeemResponse.json();
    if (redeemData.error || !redeemData.maxRedeemableAmt) {
      return json({ error: redeemData.response || "No discount available." }, { status: 400, headers: corsHeaders });
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
      return json({ error: "Failed to create discount code." }, { status: 500, headers: corsHeaders });
    }

    return json({
      success: true,
      discountCode: discountCode,
      discountAmount: discountAmount,
      pointsRedeemed: redeemData.maxRedeemablePts,
      message: `₹${discountAmount} discount code created successfully!`,
    }, { headers: corsHeaders });

  } catch (error: any) {
    console.error("Error in loyalty redemption:", error);
    return json({ error: `Redemption failed: ${error.message}` }, { status: 500, headers: corsHeaders });
  }
}
