import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate, shopify_api } from "../shopify.server";
import db from "../db.server";

interface SendOtpRequestPayload {
  user_phone: string;
}

interface BillfreeSendOtpResponse {
  error: boolean;
  response: string;
  message: string;
  token?: string;
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

  const payload: SendOtpRequestPayload = await request.json();
  const { user_phone } = payload;

  if (!user_phone) {
    return cors(json({ error: "Customer phone number is required." }, { status: 400 }));
  }

  let auth_token: string;
  try {
    const offlineSessionId = `offline_${shopDomain}`;
    const shopSession = await db.session.findUnique({
      where: { id: offlineSessionId },
      select: { billFreeAuthToken: true, isBillFreeConfigured: true },
    });

    if (!shopSession?.isBillFreeConfigured || !shopSession.billFreeAuthToken) {
      console.error(`BillFree not configured or token missing for shop: ${shopDomain}`);
      return cors(json({ message: "BillFree integration not configured." }, { status: 400 }));
    }
    auth_token = shopSession.billFreeAuthToken;

  } catch (error) {
    console.error("DB Error:", error);
    return cors(json({ error: "Failed to retrieve BillFree auth token." }, { status: 500 }));
  }

  try {
    const billfreeResponse = await fetch(`${process.env.BILLFREE_API_COTP_URL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: auth_token,
        user_phone: user_phone,
        purpose: "custVerify",
        data: { "auth_token": auth_token },
        dial_code: "91",
      })
    });

    if (!billfreeResponse.ok) {
      const errorText = await billfreeResponse.text();
      throw new Error(`BillFree API failed: ${billfreeResponse.statusText}. Details: ${errorText}`);
    }

    const data: BillfreeSendOtpResponse = await billfreeResponse.json();

    if (data.error) {
      return cors(json({ error: false, message: data.response }, { status: 400 }));
    }

    return cors(json({ error: true, message: data.response, token: data.token, response: data.response }));

  } catch (error: any) {
    console.error("Error sending OTP:", error);
    return cors(json({ error: false, message: `Failed to send OTP: ${error.message}` }, { status: 500 }));
  }
}
