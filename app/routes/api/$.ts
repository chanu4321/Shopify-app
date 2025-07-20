
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// This loader handles all OPTIONS requests for /api/* routes
export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // For any other method, we tell the client this is not a valid endpoint.
  // The actual GET/POST logic is in the specific route files.
  return json({ error: "Method not allowed on this catch-all route." }, { status: 405, headers: corsHeaders });
}
