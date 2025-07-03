// app/routes/app.discount-function-create.tsx

import { Page, Layout, Card, Text, Button, Link } from "@shopify/polaris";
import { json } from "@remix-run/node";
// Import 'type' for typing the loader arguments
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Redirect } from "@shopify/app-bridge/actions";
import createApp from '@shopify/app-bridge';
import { useAppBridge } from "@shopify/app-bridge-react";
import { StringValidation } from "zod";

// 1. Define an interface for the shape of the data returned by your loader
interface LoaderData {
  message: string;
  functionId: string;
  host: string; // Add host
  shopifyApiKey: string; 
}

// Update the loader function with explicit typing for 'request' and its return value
export async function loader({ request }: LoaderFunctionArgs) { // Type 'request' here
  const url = new URL(request.url);
  const functionId = "e8bcbb77-d4fa-4d6a-ada3-e7096901ffc6";
  console.log("Discount Function Create Page Loaded for Function ID:", functionId);
  const host = url.searchParams.get("host")!; // Host should always be present in embedded apps
  const shopifyApiKey = process.env.SHOPIFY_API_KEY!;

  return json<LoaderData>({ // Type the return of json() to match LoaderData
    message: "Your Loyalty Discount Function is being set up!",
    functionId: functionId,
    host: host, // Pass host from loader
    shopifyApiKey: shopifyApiKey,
  });
}
export default function DiscountFunctionCreatePage() {
  const { message, functionId } = useLoaderData<LoaderData>();
  // Use the useAppBridge hook to get the app instance
  const app = useAppBridge(); // This hook ensures 'app' is only available on client-side after hydration

  const handleConfirmAndGoToDiscounts = () => {
    if (app) { // App will be available here only on client-side, and only after App Bridge initializes
      Redirect.create(app).dispatch(
        Redirect.Action.ADMIN_PATH,
        { path: "/discounts" }
      );
    }  else {
      console.error("Shopify App Bridge 'app' instance is not available. Cannot redirect.");
      // Optional: Add a fallback here, e.g., a simple window.location.href,
      // though App Bridge redirect is preferred for embedded apps.
      // window.location.href = "/admin/discounts";
    }
  };

  return (
    <Page>
      <Layout>
        <Layout.Section>
          <Card>
            <Text as="h1" variant="headingMd">
              Loyalty Discount Function Setup
            </Text>
            <p>{message}</p>
            <p>
              This function (ID: {functionId}) dynamically applies loyalty discounts.
              Its logic is fully managed by your backend.
            </p>
            <p>
              Once you confirm, you can go to the Discounts page to see and manage your loyalty discounts.
            </p>
            <Layout.Section>
              <Button onClick={handleConfirmAndGoToDiscounts}>
                Confirm and Go to Discounts
              </Button>
            </Layout.Section>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}