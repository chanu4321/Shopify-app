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
import { AppProvider } from "@shopify/shopify-app-remix/react";
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
  const { shopifyApiKey } = useLoaderData<typeof loader>();

  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        <AppProvider apiKey={shopifyApiKey} i18n={enTranslations}>
          <Outlet />
        </AppProvider>
        <ScrollRestoration />
        <Scripts />
        <LiveReload />
      </body>
    </html>
);
}
