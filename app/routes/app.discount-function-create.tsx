// app/routes/app.discount-function-create.tsx

import { Page, Layout, Card, Text, Button, Link } from "@shopify/polaris";
import { json } from "@remix-run/node";
// Import 'type' for typing the loader arguments
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Redirect } from "@shopify/app-bridge/actions";
import type { ClientApplication } from "@shopify/app-bridge";
import type { AppBridgeState } from "@shopify/app-bridge";

// 1. Define an interface for the shape of the data returned by your loader
interface LoaderData {
  message: string;
  functionId: string | null;
}

// Update the loader function with explicit typing for 'request' and its return value
export async function loader({ request }: LoaderFunctionArgs) { // Type 'request' here
  const url = new URL(request.url);
  const functionId = url.searchParams.get("function_id");
  console.log("Discount Function Create Page Loaded for Function ID:", functionId);

  return json<LoaderData>({ // Type the return of json() to match LoaderData
    message: "Your Loyalty Discount Function is being set up!",
    functionId: functionId,
  });
}

export default function DiscountFunctionCreatePage() {
  // 2. Use the LoaderData interface to explicitly type the result of useLoaderData()
  const { message, functionId } = useLoaderData<LoaderData>();
  const appRaw = useAppBridge();
  const app = appRaw as unknown as ClientApplication<AppBridgeState>;

  // Function to handle clicking 'Confirm' - redirects back to the main discounts list
   const handleConfirmAndGoToDiscounts = () => {
    Redirect.create(app).dispatch(
      Redirect.Action.ADMIN_PATH,
      { path: "/discounts" }
    );
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
              This function (ID: {functionId || 'N/A'}) dynamically applies loyalty discounts.
              Its logic is fully managed by your backend.
            </p>
            <p>
              **Important:** Ensure your `loyalty_app.proxy_base_url` metafield is correctly configured for this Function's configuration (e.g., via the Shopify Partner Dashboard under your app settings or through an API call), so it can communicate with your proxy server.
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