import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server"; // Assuming your Prisma DB client
import { shopify_api } from "../shopify.server"; // Ensure you import shopify_api
import { resolve } from "path";

interface GetShopIdResponseData {
  shop: { id: string };
}

// Full type for the GraphQL response body
interface GraphqlResponseBody<T> {
    data?: T;
    errors?: any[];
}

interface SetShopMetafieldResponseData {
  shopUpdate: {
    shop?: { id: string }; // shop can be null if userErrors exist
    userErrors: Array<{ field?: string[]; message?: string }>;
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, redirect } = await authenticate.admin(request); // This authenticate works here!

  if (!session?.accessToken || !session?.shop) {
    throw redirect("/app"); // Or handle error
  }

  // Save/update the offline session in your DB (this likely already happens here)
const offlineSessionId = `offline_${session.shop}`;
  try {
    // 1. Save/update the offline session in your DB
    await db.session.upsert({
      where: { id: offlineSessionId },
      update: {
        accessToken: session.accessToken,
        state: session.state,
        scope: session.scope, // Ensure 'scope' is saved if you need it for re-authentication checks
      },
      create: {
        id: offlineSessionId,
        shop: session.shop,
        accessToken: session.accessToken,
        isOnline: false, // Assuming this is for your offline token
        state: session.state,
        scope: session.scope,
      },
    });

    // 2. Get a Shopify GraphQL client using the authenticated session
    // Pass the full session object to the client constructor
    const client = new shopify_api.clients.Graphql({ session });

    // 3. Fetch the Shop's GID (Corrected access to GraphQL response data)
    const shopGidResponse = await client.query<GraphqlResponseBody<GetShopIdResponseData>>({
      data: {
        query: `query GetShopId { shop { id } }`,
      },
    });

    if (!shopGidResponse.body?.data?.shop?.id) { // More robust check
      console.error("Failed to fetch shop ID for metafield setting:", shopGidResponse.body?.errors || "No data/ID in response.");
      throw new Error("Shop ID not found or GraphQL error during shop ID fetch.");
    }
    const shopGid = shopGidResponse.body.data.shop.id; // Corrected access to the ID

    // 4. Mutation to set the metafields on the Shop
    //    We will set BOTH 'shop_domain_key' and 'proxy_base_url' here.
    const appUrl = process.env.SHOPIFY_APP_URL; // Get your deployed app URL from env

    if (!appUrl) {
      console.error("SHOPIFY_APP_URL environment variable is not set. Cannot set proxy_base_url metafield.");
      // Decide if this should stop the installation or just log a warning
    }

    const metafieldsToSet = [
      {
        key: "shop_domain_key",
        namespace: "loyalty_app",
        value: session.shop, // The myshopify.com domain
        type: "single_line_text_field",
      },
      // *** Add the proxy_base_url metafield here ***
      {
        key: "proxy_base_url",
        namespace: "loyalty_app",
        value: appUrl || "", // Your app's deployed URL
        type: "single_line_text_field", // Use 'url' type for URLs, or 'single_line_text_field'
      },
    ];

    const setMetafieldsResponse = await client.query<GraphqlResponseBody<SetShopMetafieldResponseData>>({
      data: {
        query: `mutation SetShopMetafields($id: ID!, $metafields: [MetafieldsSetInput!]!) {
          shopUpdate(
            id: $id
            metafields: $metafields
          ) {
            shop { id }
            userErrors { field message }
          }
        }`,
        variables: {
          id: shopGid,
          metafields: metafieldsToSet,
        },
      },
    });

    if (!setMetafieldsResponse.body?.data) {
      console.error("Metafield setting response missing body data.");
      throw new Error("Metafield setting response missing data.");
    }

    const { shopUpdate } = setMetafieldsResponse.body.data;

    if (shopUpdate.userErrors && shopUpdate.userErrors.length > 0) {
      console.error("[Auth.$.tsx Loader] Error setting shop domain/proxy_base_url metafields:", shopUpdate.userErrors);
      // Decide if this error should block the app or just be logged
    } else {
      console.log(`[Auth.$.tsx Loader] Shop domain and proxy_base_url metafields set for shop ID: ${shopGid}`);
    }

  } catch (error) {
    console.error("[Auth.$.tsx Loader] Failed to set metafields during installation/callback:", error);
  }
  // --- END OF METAFUNCTION IMPLEMENTATION ---

  // Finally, redirect to your app's main page after successful setup
  throw redirect("/app");
}