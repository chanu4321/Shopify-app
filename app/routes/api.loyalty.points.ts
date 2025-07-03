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
    phone?: string | null;
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

export async function loader({ request }: LoaderFunctionArgs) {
  // Manually handle preflight requests
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*", // You may want to restrict this to your shop's domain in production
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  // Authenticate the actual request
  const { cors } = await authenticate.public.customerAccount(request);

  const url = new URL(request.url);
  const customerGid = url.searchParams.get("customer_id");

  if (!customerGid) {
    return cors(json({ error: "Customer ID missing." }, { status: 400 }));
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return cors(json({ error: "Missing or invalid authorization token." }, { status: 401 }));
  }
  const token = authHeader.substring(7);

  try {
    const session = await shopify_api.session.decodeSessionToken(token);
    const shopDomain = session.dest.replace("https://", "");
    const response = await handleLoyaltyPoints(customerGid, shopDomain);
    return cors(response);
  } catch (error: any) {
    console.error("Error decoding session token:", error);
    return cors(json({ error: `Invalid session token: ${error.message}` }, { status: 401 }));
  }
}

async function handleLoyaltyPoints(customerGid: string, shopDomain: string) {
  const customerShopifyId = customerGid.split('/').pop();
  if (!customerShopifyId) {
    return json({ error: "Invalid Customer GID format." }, { status: 400 });
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
      return json({ message: "BillFree integration not fully configured." }, { status: 400 });
    }

    auth_token = shopSession.billFreeAuthToken;
    offlineAccessToken = shopSession.accessToken;
    shopDomainFromSession = shopSession.shop;
    offlineSessionid = offlineSessionId;

  } catch (error) {
    console.error("DB Error:", error);
    return json({ error: "Failed to retrieve BillFree auth token." }, { status: 500 });
  }

  try {
    const query = `
      query GetCustomerPhone($id: ID!) {
        customer(id: $id) {
          phone
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
        variables: { id: customerGid },
      },
    });

    const responseBody = response.body as unknown as GraphqlResponseBody<GetCustomerPhoneResponseData>;
    if (responseBody.errors?.length) {
      throw new Error(responseBody.errors.map(e => e.message).join(', '));
    }
    customerMobileNumber = responseBody.data?.customer?.phone ?? undefined;

  } catch (e: any) {
    console.error("Shopify API Error:", e);
    return json({ error: "Failed to fetch customer phone number from Shopify." }, { status: 500 });
  }

  if (!customerMobileNumber) {
    return json({
      error: "Customer phone number not available on Shopify profile.",
      balance: 0,
      scheme_message: "Please add a phone number to your profile to check loyalty points.",
      otpFlag: "y",
      customerMobileNumber: undefined
    } as ProxyPointsResponse, { status: 200 });
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
      } as ProxyPointsResponse, { status: 500 });
    }

    const proxyResponse: ProxyPointsResponse = {
      balance: billfreeData.balance,
      scheme_message: billfreeData.scheme_message,
      otpFlag: billfreeData.otpFlag,
      customerMobileNumber: customerMobileNumber,
    };

    return json(proxyResponse);

  } catch (error: any) {
    console.error("BillFree API Error:", error);
    return json({ error: `Failed to fetch loyalty points: ${error.message}` }, { status: 500 });
  }
}
