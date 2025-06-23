// app/routes/api.loyalty.points.ts

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, } from "@remix-run/node";
import { shopify_api } from "../shopify.server";
import db from "../db.server"; // Adjust the import path as per your project structure

// Define interfaces for your Billfree API response
interface BillfreePointsResponse {
  error: boolean;
  response: string; // e.g., "l2"
  balance: number; // Renamed from 'points' to 'balance' as per your example
  otpFlag: "y" | "n"; // Add otpFlag
  scheme_message: string; // Add scheme_message
  // Add any other relevant data from your Billfree API #1
}

// Define the expected structure of the GraphQL response data for clarity
interface GetCustomerPhoneResponseData {
  customer?: {
    phone?: string | null;
  };
}

// Define the full GraphQL response body structure
interface GraphqlResponseBody<T> {
  data?: T;
  errors?: any[]; // Array of GraphQL errors if any
}

// New interface for the proxy's return value (what the Function/UI Extension receives)
interface ProxyPointsResponse {
  balance: number; // Renamed for consistency
  scheme_message: string;
  otpFlag: "y" | "n";
  customerMobileNumber?: string;
  error?: string; // For proxy-specific errors
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const customerGid = url.searchParams.get("customer_gid");
  const shopDomain = url.searchParams.get("shop_domain");

  if (!customerGid) {
    return json({ error: "Customer GID missing in request parameters." }, { status: 400 });
  }

  // Extract Shopify Customer ID from GID
  const customerShopifyId = customerGid.split('/').pop();
  if (!customerShopifyId) {
    return json({ error: "Invalid Customer GID format." }, { status: 400 });
  }

  let customerMobileNumber: string | undefined;
  let auth_token: string;
  let offlineAccessToken: string; // For Shopify Admin API calls
  try {
    const offlineSessionId = `offline_${shopDomain}`;
    const shopSession = await db.session.findUnique({
        where: { id: offlineSessionId },
        select: { billFreeAuthToken: true, isBillFreeConfigured: true, accessToken: true }, // Select accessToken too
      });

    if (!shopSession || !shopSession.isBillFreeConfigured || !shopSession.billFreeAuthToken || !shopSession.accessToken) {
        console.error(`BillFree not configured, tokens missing, or access token missing for shop: ${shopDomain}`);
        return json({ message: "BillFree integration not fully configured for this shop." }, { status: 400 });
    }

    auth_token = shopSession.billFreeAuthToken;
    offlineAccessToken = shopSession.accessToken; // Use this for Shopify Admin API calls


  if (!offlineAccessToken || !shopDomain) {
    console.error(`[Loyalty Points Loader] No active session found. App needs to be installed/re-authenticated.`);
    return json({ message: "Authentication required. App may need re-installation." }, { status: 401 });
  }
  
  } catch (error) {
    console.error("Error retrieving Billfree auth token from database:", error);
    return json({ error: "Failed to retrieve Billfree auth token from database." }, { status: 500 });
  }

  try {
    // Step 1: Fetch customer phone number from Shopify Admin API
    const query = `
      query GetCustomerPhone($id: ID!) {
        customer(id: $id) {
          phone
        }
      }
    `;

    const client = new shopify_api.clients.Graphql({ session: { shop: shopDomain, accessToken: offlineAccessToken } as any });

    const response = await client.query({
      data: {
        query: query,
        variables: { id: customerGid },
      },
    });

    if (!response.body) {
      console.error("Shopify GraphQL response missing body (no data received).");
      throw new Response("Internal Server Error: No data received from Shopify.", { status: 500 });
    }

    const responseBody = response.body as GraphqlResponseBody<GetCustomerPhoneResponseData>;
    const data = responseBody.data;

    if (responseBody.errors && responseBody.errors.length > 0) {
      console.error("Shopify Admin API GraphQL errors:", responseBody.errors);
      responseBody.errors.forEach((err: any) => console.error(err.message));
      return json({ error: "Failed to fetch customer phone number from Shopify due to API errors." }, { status: 500 });
    }

    if (!data) {
      console.error("Shopify GraphQL response 'data' object is missing.");
      return json({ error: "Failed to retrieve customer data from Shopify." }, { status: 500 });
    }

    customerMobileNumber = data.customer?.phone ?? undefined;

  } catch (e: any) {
    console.error("Error fetching customer phone number from Shopify Admin API:", e);
    let errorMessage = "Server error during phone number lookup from Shopify.";
    if (e instanceof Response) {
      return e;
    } else if (e.response?.body?.errors) {
      errorMessage = `Shopify API Error: ${JSON.stringify(e.response.body.errors)}`;
    } else if (e.message) {
      errorMessage = `Error: ${e.message}`;
    }
    return json({ error: errorMessage }, { status: 500 });
  }

  if (!customerMobileNumber) {
    // If no mobile number, cannot query Billfree, provide default values
    return json({
      error: "Customer phone number not available on Shopify profile. Cannot fetch loyalty points.",
      balance: 0,
      scheme_message: "Please add a phone number to your profile to check loyalty points.",
      otpFlag: "y",
      customerMobileNumber: undefined
    } as ProxyPointsResponse, { status: 200 });
  }

  // Step 2: Call your Billfree API #1 to get points balance
  try {
    const billfreeResponse = await fetch(`${process.env.BILLFREE_API_POINTS_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(
        {
          "auth_token": auth_token, // Use the retrieved token
          "user_phone": `${customerMobileNumber}`,
          "dial_code": "91"
        }
      )
    });

    if (!billfreeResponse.ok) {
      const errorText = await billfreeResponse.text();
      console.error(`Billfree API (get_points_balance) error: ${billfreeResponse.status} - ${errorText}`);
      throw new Error(`Billfree API (get_points_balance) failed: ${billfreeResponse.statusText}`);
    }

    const billfreeData: BillfreePointsResponse = await billfreeResponse.json();

    if (billfreeData.error) {
      console.error(`Billfree API returned error: ${JSON.stringify(billfreeData)}`);
      // You might want to return an error status or specific error message here
      return json({
        error: `Billfree API reported an error: ${billfreeData.response}`,
        balance: 0,
        scheme_message: billfreeData.scheme_message,
        otpFlag: billfreeData.otpFlag,
        customerMobileNumber: customerMobileNumber
      } as ProxyPointsResponse, { status: 500 });
    }

    // Prepare response for Shopify Function/UI Extension
    const proxyResponse: ProxyPointsResponse = {
      balance: billfreeData.balance,
      scheme_message: billfreeData.scheme_message,
      otpFlag: billfreeData.otpFlag,
      customerMobileNumber: customerMobileNumber,
    };

    return json(proxyResponse); // Forward all relevant data
  } catch (error: any) {
    console.error("Error fetching loyalty points from Billfree:", error);
    return json({ error: `Failed to fetch loyalty points from external service: ${error.message}` }, { status: 500 });
  }
}