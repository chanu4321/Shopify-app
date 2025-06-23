// app/routes/api.loyalty.send-otp.ts

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server"; // Adjust the import path as per your project structure
// Assuming you have a database utility/client set up
// import { db } from "~/db.server"; // for fetching auth_token

interface SendOtpRequestPayload {
  user_phone: string; // Customer's phone number to send OTP to
  // You might need other parameters for Billfree's send OTP API
}

interface BillfreeSendOtpResponse {
  error: boolean;
  response: string;
  message: string;
  token?: string; // e.g., "OTP Sent Successfully" or an error message
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
    // **IMPORTANT:** Replace '/send_otp_endpoint' with the actual Billfree API endpoint
    // and adjust payload based on Billfree's documentation for sending OTP.
    const billfreeResponse = await fetch(`${process.env.BILLFREE_API_COTP_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', // Assuming OTP API also uses auth_token
      },
      body: JSON.stringify({
        auth_token: auth_token, // Often, auth_token is in body too for Billfree
        user_phone: user_phone,
        purpose: "custVerify",
        data: {"auth_token": auth_token}, // Include auth_token in data if required by Billfree
        dial_code: "91", // Assuming this is fixed for India, adjust as needed
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
        return json({ error: false, message: data.response }, { status: 400 });
    }

    return json({ error: true, message: data.response, token: data.token, response: data.response }); // e.g., "OTP Sent Successfully"
  } catch (error: any) {
    console.error("Error sending OTP via Billfree proxy:", error);
    return json({ error: false, message: `Failed to send OTP: ${error.message}` }, { status: 500 });
  }
}