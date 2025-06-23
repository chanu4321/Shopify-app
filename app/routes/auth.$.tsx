import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server"; // Assuming your Prisma DB client
import { shopify_api } from "../shopify.server"; // Ensure you import shopify_api
import { resolve } from "path";

// interface SetShopMetafieldResponse {
//   shopUpdate: {
//     shop: { id: string };
//     userErrors: Array<{ field?: string[]; message?: string }>;
//   };
// }

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request); // This authenticate works here!

//   if (!session?.accessToken || !session?.shop) {
//     throw redirect("/app"); // Or handle error
//   }

//   // Save/update the offline session in your DB (this likely already happens here)
//   const offlineSessionId = `offline_${session.shop}`;
//   await db.session.upsert({
//     where: { id: offlineSessionId },
//     update: {
//       accessToken: session.accessToken, // Save the offline token
//       // ... other session data
//     },
//     create: {
//       id: offlineSessionId,
//       shop: session.shop, // Save the myshopify.com domain
//       accessToken: session.accessToken,
//       isOnline: false,
//       state: session.state, // Save the state if needed
//       // ... other session data
//     },
//   });

//   // --- START OF STEP 4 IMPLEMENTATION ---
//   // Now, create or update a metafield on the DiscountAutomaticApp or Shop resource
//   // to store the shop's myshopify.com domain.

//   // 1. Get a Shopify GraphQL client using the authenticated session
//   const client = new shopify_api.clients.Graphql({ session });

//   try {
//     // For simplicity, let's assume you're setting it on the SHOP resource
//     // (This requires 'write_online_store_pages' or 'write_products' scope if metafields are associated with them)
//     // Or, if linked to a specific discount: gid://shopify/DiscountAutomaticApp/YOUR_DISCOUNT_ID
//     // You'll need to know your Discount ID, or fetch it. For now, let's target the Shop directly.

//     // Fetch the Shop's GID first, as metafields are often set on GIDs
//     const shopData = await client.query({
//       data:{
//     query: `
//       query GetShopId {
//         shop { id }
//       }
//     `,
//     // no variables here
//   }
//     });

//     if (!shopData.body) {
//       console.error("Failed to fetch shop ID for metafield setting.");
//       throw new Error("Shop ID not found.");
//     }
//     const shopGid = shopData.body;

//     // Mutation to set the metafield on the Shop
//     const response = await client.query<SetShopMetafieldResponse>({
//       data: {
//         query: `mutation SetShopDomainMetafield($id: ID!, $key: String!, $namespace: String!, $value: String!, $type: String!) {
//           shopUpdate(
//             id: $id
//             metafields: [
//               {
//                 key: $key
//                 namespace: $namespace
//                 value: $value
//                 type: $type
//               }
//             ]
//           ) {
//             shop {
//               id
//             }
//             userErrors {
//               field
//               message
//             }
//           }
//         }`,
//         variables: {
//           id: shopGid,
//           key: "shop_domain_key", // This is the key your Function will query
//           namespace: "loyalty_app", // Must match the namespace in run.graphql
//           value: session.shop,       // The myshopify.com domain
//           type: "single_line_text_field", // Or 'string' depending on API version and type
//         },
//       }}
//     );
//     if (!response.body?.shopUpdate.shop.id) {
//       throw new Error("Shop update response missing");
//     }

// // 2) Pull out the payload
// const { shopUpdate } = response.body;

// // 3) Check for errors
// if (shopUpdate.userErrors.length) {
//   console.error("Error setting shop domain metafield:", shopUpdate.userErrors);
// } else {
//   console.log(`Shop domain metafield set for shop ID: ${shopUpdate.shop.id}`);
// }

//   } catch (error) {
//     console.error("Failed to set shop domain metafield during installation:", error);
//     // You might still redirect, but log the error
//   }
//   // --- END OF STEP 4 IMPLEMENTATION ---

//   // Finally, redirect to your app's main page
//   throw redirect("/app");
}