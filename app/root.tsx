// app/root.tsx
import type { MetaFunction, LinksFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Meta,
  Links,
  Scripts,
  ScrollRestoration,
  LiveReload,
  Outlet,
  useLoaderData,
} from "@remix-run/react";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-remix/react";
import { AppProvider as PolarisProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import polarisStylesUrl from "@shopify/polaris/build/esm/styles.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: polarisStylesUrl },
];

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const host = url.searchParams.get("host")!;
  const shop = url.searchParams.get("shop")!;
  const shopifyApiKey = process.env.SHOPIFY_API_KEY!;
  return json({ host, shop, shopifyApiKey });
}

export default function App() {
  const { host, shop, shopifyApiKey } = useLoaderData<typeof loader>();

  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        <ShopifyAppProvider apiKey={shopifyApiKey}>
          <PolarisProvider i18n={enTranslations}>
            <Outlet />
          </PolarisProvider>
        </ShopifyAppProvider>
        <ScrollRestoration />
        <Scripts />
        <LiveReload />
      </body>
    </html>
);
}
