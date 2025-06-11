// app/routes/app.qgl.tsx
import { LoaderFunctionArgs, json } from "@remix-run/node";
import { authenticate } from "../shopify.server"; // Make sure this path is correct

export async function loader({ request }: LoaderFunctionArgs) {
  // This call to authenticate.admin is sufficient.
  // The Shopify App Bridge context will internally handle serving the GraphiQL UI
  // if the incoming request URL matches the configured GraphiQL route in shopify.server.ts.
  // If it doesn't render GraphiQL, it will simply return the admin client.
  const { admin } = await authenticate.admin(request);

  // Returning null here is the expected behavior if authenticate.admin handles the response
  // directly for the GraphiQL UI. If it doesn't, Remix will try to render a component.
  return json({
    admin: admin, // Return the whole admin object for inspection
    // You can remove the default export below if this works
  }); 
}

// You *must* have a default export (React component) for a Remix route.
// Even if authenticate.admin handles the response, Remix still expects a component.
export default function GraphiQLRoute() {
  // This component will likely not be rendered if authenticate.admin successfully serves GraphiQL.
  // However, Remix requires it.
  return (
    <div>
      <p>Attempting to load GraphiQL...</p>
      <p>If you don't see GraphiQL, ensure your `shopify.server.ts` correctly enables it for this route.</p>
    </div>
  );
}