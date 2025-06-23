// app/routes/api.loyalty.send-otp.ts

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
// Assuming you have a database utility/client set up
// import { db } from "~/db.server"; // for fetching auth_token

interface SendOtpRequestPayload {
  user_phone: string; // Customer's phone number to send OTP to
  // You might need other parameters for Billfree's send OTP API
}

interface BillfreeSendOtpResponse {
  error: boolean;
  response: string; // e.g., "OTP Sent Successfully" or an error message
  // Add other properties Billfree's send OTP API returns, like a transaction ID if any
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request); // Authenticate the request from the UI Extension
  if (!session || !session.shop) {
    console.error("[Send OTP Proxy] Authentication failed.");
    return json({ error: "Unauthorized access." }, { status: 401 });
  }

  const payload: SendOtpRequestPayload = await request.json();
  const { user_phone } = payload;

  if (!user_phone) {
    return json({ error: "Customer phone number is required to send OTP." }, { status: 400 });
  }

  let auth_token: string;
  try {
    // --- Fetch AUTH_TOKEN from your database using session.shop ---
    // (Same logic as in api.loyalty.redeem.ts)
    auth_token = process.env.BILLFREE_AUTH_TOKEN_FROM_DB || "DEMO_HARDCODED_AUTH_TOKEN_FROM_DB";
    if (!auth_token || auth_token === "DEMO_HARDCODED_AUTH_TOKEN_FROM_DB") {
      console.warn(`[Send OTP Proxy] Using temporary/hardcoded auth token for ${session.shop}. Please configure database lookup.`);
    }
  } catch (dbError: any) {
    console.error(`Database error fetching auth token for shop ${session.shop}:`, dbError);
    return json({ error: `Failed to retrieve authentication token: ${dbError.message}` }, { status: 500 });
  }

  try {
    // **IMPORTANT:** Replace '/send_otp_endpoint' with the actual Billfree API endpoint
    // and adjust payload based on Billfree's documentation for sending OTP.
    const billfreeResponse = await fetch(`${process.env.BILLFREE_API_BASE_URL}/send_otp_endpoint`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth_token}` // Assuming OTP API also uses auth_token
      },
      body: JSON.stringify({
        auth_token: auth_token, // Often, auth_token is in body too for Billfree
        mobile: user_phone,
        // Add any other required parameters for OTP sending (e.g., template_id, purpose)
      })
    });

    if (!billfreeResponse.ok) {
      const errorText = await billfreeResponse.text();
      console.error(`Billfree API (send_otp) error: ${billfreeResponse.status} - ${errorText}`);
      throw new Error(`Billfree API (send_otp) failed: ${billfreeResponse.statusText}. Error: ${errorText}`);
    }

    const data: BillfreeSendOtpResponse = await billfreeResponse.json();

    if (data.error) {
        console.error(`Billfree OTP Send API returned error: ${data.response}`);
        return json({ success: false, message: data.response }, { status: 400 });
    }

    return json({ success: true, message: data.response }); // e.g., "OTP Sent Successfully"
  } catch (error: any) {
    console.error("Error sending OTP via Billfree proxy:", error);
    return json({ success: false, message: `Failed to send OTP: ${error.message}` }, { status: 500 });
  }
}