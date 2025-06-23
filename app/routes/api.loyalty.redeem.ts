// app/routes/api.loyalty.redeem.ts

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
// Assuming you have a database utility/client set up for auth_token lookup
// import { db } from "~/db.server"; // Adjust path as per your project

// Define interfaces for the request from Shopify Function
interface RedeemRequestFromFunction {
  user_phone: string;
  inv_no: string;
  bill_date: string;
  bill_amt: string;
}

// Define interfaces for your Billfree API request/response for apply_redemption
interface BillfreeRedeemRequest {
  auth_token: string;
  user_phone: string;
  dial_code: string; // Assuming fixed "91"
  inv_no: string;
  bill_date: string;
  bill_amt: string;
}

interface BillfreeRedeemResponse {
  error: boolean; // Assuming Billfree might return an 'error' flag
  response: string; // Additional message from Billfree (e.g., "Success")
  discount_value_rupees: number;
  // Add other properties if your API #2 returns them.
}

/**
 * Action function to proxy redemption requests to Billfree API.
 * This route is called by the Shopify Function for automatic redemptions (when OTP is not required).
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, { status: 405 });
  }

  // Authenticate that the request is coming from your Shopify Function/App.
  const { session } = await authenticate.admin(request);
  if (!session || !session.shop) {
    console.error("[Redeem Proxy] Authentication failed for incoming request.");
    return json({ error: "Unauthorized access to redemption proxy." }, { status: 401 });
  }

  const payload: RedeemRequestFromFunction = await request.json();
  const { user_phone, inv_no, bill_date, bill_amt } = payload;

  if (!user_phone || !inv_no || !bill_date || !bill_amt) {
    return json({ error: "Missing required parameters for loyalty redemption." }, { status: 400 });
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

  } catch (dbError: any) {
    console.error(`Database error fetching auth token for shop ${session.shop}:`, dbError);
    return json({ error: `Failed to retrieve authentication token: ${dbError.message}` }, { status: 500 });
  }

  const billfreePayload: BillfreeRedeemRequest = {
    auth_token: auth_token, // Use the retrieved token or a hardcoded one for testing
    user_phone: user_phone,
    dial_code: "91", // Assuming this is fixed for India
    inv_no: inv_no,
    bill_date: bill_date,
    bill_amt: bill_amt,
  };

  try {
    // Call the Billfree API #2 (apply_redemption)
    const billfreeResponse = await fetch(`${process.env.BILLFREE_API_REDEEM_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(billfreePayload)
    });

    if (!billfreeResponse.ok) {
      const errorText = await billfreeResponse.text();
      console.error(`Billfree API (apply_redemption) error: ${billfreeResponse.status} - ${errorText}`);
      throw new Error(`Billfree API (redemption) failed: ${billfreeResponse.statusText}. Error: ${errorText}`);
    }

    const data: BillfreeRedeemResponse = await billfreeResponse.json();

    // If Billfree API returns its own error flag, handle it here
    if (data.error) {
        console.error(`Billfree apply_redemption API returned an error: ${data.response}`);
        // Return an error to the Shopify Function
        return json({ error: data.response, discount_value_rupees: 0 }, { status: 400 });
    }

    // Success: Return the discount value to the Shopify Function
    return json(data);
  } catch (error: any) {
    console.error("Error applying loyalty redemption via Billfree proxy:", error);
    // Return a generic error if something unexpected happened during the proxy call
    return json({ error: `Failed to apply loyalty redemption: ${error.message}`, discount_value_rupees: 0 }, { status: 500 });
  }
}