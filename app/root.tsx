import { json } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { AppProvider as PolarisProvider } from "@shopify/polaris"; // Ensure this is imported!
import { LoaderFunctionArgs } from "@remix-run/node";
import enTranslations from "@shopify/polaris/locales/en.json";
import '@shopify/polaris/build/esm/styles.css'; // Import Polaris translations
// import other styles if you have them, e.g., import appStyles from "./app.css";

// This is the loader for your root route, providing necessary data to AppProvider
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const host = url.searchParams.get("host"); // Shopify passes 'host' in the URL
  const shop = url.searchParams.get("shop"); // Shopify passes 'shop' in the URL
  const shopifyApiKey = process.env.SHOPIFY_API_KEY; // Make sure this env var is set!

  // Basic validation (you might have more robust auth/session handling)
  if (!host || !shop || !shopifyApiKey) {
    throw new Response("Missing required parameters for App Bridge setup (host, shop, or API key).", { status: 400 });
  }

  // Return the data for AppProvider
  return json({
    shopifyApiKey,
    shop,
    host,
  });
}

// Ensure your links function includes Polaris styles if you're using them
export function links() {
  return [{ rel: "stylesheet", href : "@shopify/polaris/build/esm/styles.css" }]; // Polaris styles
  // Add your app's custom styles here too, e.g., { rel: "stylesheet", href: appStyles }
}

export default function App() {
  // Use useLoaderData to get the data provided by the loader
  const { shopifyApiKey, shop, host } = useLoaderData<typeof loader>(); // Type it with typeof loader

  return (
    // Wrap your entire app content with AppProvider and PolarisProvider
    <AppProvider apiKey={shopifyApiKey}>
      <PolarisProvider i18n={enTranslations}>
        {/* The <Outlet /> component renders the content of nested routes */}
        <Outlet />
      </PolarisProvider>
    </AppProvider>
  );
}