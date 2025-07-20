import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate, shopify_api } from "../shopify.server";
import db from "../db.server";

// Define interfaces for the data structures used in this route
interface BillfreePointsResponse {
  error: boolean;
  response: string;
  balance: number;
  otpFlag: "y" | "n";
  scheme_message: string;
}

interface GetCustomerPhoneResponseData {
  customer?: {
    defaultPhoneNumber?: {
      phoneNumber: string | null;
    } | null;
  };
}

interface GraphqlResponseBody<T> {
  data?: T;
  errors?: any[];
}

interface ProxyPointsResponse {
  balance: number;
  scheme_message: string;
  otpFlag: "y" | "n";
  customerMobileNumber?: string;
  error?: string;
}

const corsHeaders = { "Access-Control-Allow-Origin": "*" };

export async function loader({ request }: LoaderFunctionArgs) {

  // Authenticate the actual request
  await authenticate.public.customerAccount(request);

  const url = new URL(request.url);
  const customerid = url.searchParams.get("customer_id");

  if (!customerid) {
    return json({ error: "Customer ID missing." }, { status: 400, headers: corsHeaders });
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return json({ error: "Missing or invalid authorization token." }, { status: 401, headers: corsHeaders });
  }
  const token = authHeader.substring(7);

  try {
    const session = await shopify_api.session.decodeSessionToken(token);
    const shopDomain = session.dest.replace("https://", "");
    console.log("Shop Domain:", shopDomain);
    const response = await handleLoyaltyPoints(customerid, shopDomain);
    
    return response;

  } catch (error: any) {
    console.error("Error decoding session token:", error);
    return json({ error: `Invalid session token: ${error.message}` }, { status: 401, headers: corsHeaders });
  }
}

async function handleLoyaltyPoints(customerid: string, shopDomain: string) {
  const customerShopifyId = customerid.split('/').pop();
  if (!customerShopifyId) {
    return json({ error: "Invalid Customer GID format." }, { status: 400, headers: corsHeaders });
  }

  let customerMobileNumber: string | undefined;
  let auth_token: string;
  let offlineAccessToken: string;
  let shopDomainFromSession: string;
  let offlineSessionid: string;

  try {
    const offlineSessionId = `offline_${shopDomain}`;
    const shopSession = await db.session.findUnique({
      where: { id: offlineSessionId },
      select: { billFreeAuthToken: true, isBillFreeConfigured: true, accessToken: true, shop: true },
    });

    if (!shopSession?.isBillFreeConfigured || !shopSession.billFreeAuthToken || !shopSession.accessToken) {
      console.error(`BillFree not configured or tokens missing for shop: ${shopDomain}`);
      return json({ message: "BillFree integration not fully configured." }, { status: 400, headers: corsHeaders });
    }

    auth_token = shopSession.billFreeAuthToken;
    offlineAccessToken = shopSession.accessToken;
    shopDomainFromSession = shopSession.shop;
    offlineSessionid = offlineSessionId;

  } catch (error) {
    console.error("DB Error:", error);
    return json({ error: "Failed to retrieve BillFree auth token." }, { status: 500, headers: corsHeaders });
  }

  try {
    const query = `
      query GetCustomerPhone($id: ID!) {
        customer(id: $id) {
          defaultPhoneNumber {
            phoneNumber
      }
    }
  }
    `;

    const client = new shopify_api.clients.Graphql({
      session: {
        id: offlineSessionid,
        shop: shopDomainFromSession,
        accessToken: offlineAccessToken,
        isOnline: false,
      } as any,
    });

    const response = await client.query({
      data: {
        query: query,
        variables: { id: `"gid://shopify/Customer/${customerid}"` },
      },
    });

    const responseBody = response as GraphqlResponseBody<GetCustomerPhoneResponseData>;
    if (responseBody.errors?.length) {
      throw new Error(responseBody.errors.map(e => e.message).join(', '));
    }
    customerMobileNumber = responseBody.data?.customer?.defaultPhoneNumber?.phoneNumber ?? undefined;

  } catch (e: any) {
    console.error("Shopify API Error:", e);
    return json({ error: "Failed to fetch customer phone number from Shopify." }, { status: 500, headers: corsHeaders });
  }

  if (!customerMobileNumber) {
    return json({
      error: "Customer phone number not available on Shopify profile.",
      balance: 0,
      scheme_message: "Please add a phone number to your profile to check loyalty points.",
      otpFlag: "y",
      customerMobileNumber: undefined
    } as ProxyPointsResponse, { status: 200, headers: corsHeaders });
  }

  try {
    const billfreeResponse = await fetch(`${process.env.BILLFREE_API_POINTS_URL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        "auth_token": auth_token,
        "user_phone": customerMobileNumber,
        "dial_code": "91"
      })
    });

    if (!billfreeResponse.ok) {
      throw new Error(`BillFree API failed: ${billfreeResponse.statusText}`);
    }

    const billfreeData: BillfreePointsResponse = await billfreeResponse.json();

    if (billfreeData.error) {
      return json({
        error: `BillFree API Error: ${billfreeData.response}`,
        balance: 0,
        scheme_message: billfreeData.scheme_message,
        otpFlag: billfreeData.otpFlag,
        customerMobileNumber: customerMobileNumber
      } as ProxyPointsResponse, { status: 500, headers: corsHeaders });
    }

    const proxyResponse: ProxyPointsResponse = {
      balance: billfreeData.balance,
      scheme_message: billfreeData.scheme_message,
      otpFlag: billfreeData.otpFlag,
      customerMobileNumber: customerMobileNumber,
    };

    return json(proxyResponse, { headers: corsHeaders });

  } catch (error: any) {
    console.error("BillFree API Error:", error);
    return json({ error: `Failed to fetch loyalty points: ${error.message}` }, { status: 500, headers: corsHeaders });
  }
}
