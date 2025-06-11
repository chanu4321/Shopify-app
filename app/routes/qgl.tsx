// app/routes/app.qgl.tsx
import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server"; // Make sure this path is correct

export async function loader({ request }: LoaderFunctionArgs) {
  const response = await authenticate.admin(request); // Authenticate the admin session

  // This is the key part: the Shopify Remix app template's authenticate.admin utility
  // is designed to respond with the GraphiQL UI if the request path matches.
  // By simply calling authenticate.admin here, it handles the rendering.
  // If you manually visit this route, and the admin context is valid, it will render GraphiQL.

  return response; // Return a redirect or null if GraphiQL doesn't auto-render for some reason
                               // The idea is authenticate.admin itself handles the response for /qgl
}

// You typically don't need a default export (React component) for this route
// as authenticate.admin will handle the response (rendering HTML for GraphiQL).
// If you do get an error that a default export is missing, you can add:
// export default function GraphiQLRoute() {
//   return <div>Loading GraphiQL...</div>; // This will likely be replaced by the GraphiQL HTML
// }