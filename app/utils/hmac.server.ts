// app/utils/hmac.server.ts

import { createHmac, timingSafeEqual } from "crypto";
import { json } from "@remix-run/node"; // CORRECTED: Import 'json' for throwing JSON responses

const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;

/**
 * Verifies the Shopify HMAC signature from an incoming request.
 * If verification is successful, it returns the raw request body.
 * If verification fails for any reason, it throws a Response object with the appropriate error status.
 * This pattern ensures the request body is read only once and centralizes auth logic.
 *
 * @param request The incoming Request object from the action/loader.
 * @returns A Promise that resolves with the raw request body string if the HMAC is valid.
 * @throws {Response} Throws a Response object (e.g., status 401 or 500) if verification fails.
 */
export async function verifyRequestAndGetBody(request: Request): Promise<string> {
  if (!SHOPIFY_API_SECRET) {
    console.error("[HMAC Verify] Critical Error: SHOPIFY_API_SECRET environment variable is not set.");
    // CORRECTED: Use json() for throwing
    throw json({ message: "Internal Server Error: App is not configured correctly." }, { status: 500 });
  }

  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
  if (!hmacHeader) {
    console.warn("[HMAC Verify] Request rejected: HMAC header is missing.");
    // CORRECTED: Use json() for throwing
    throw json({ message: "Unauthorized: Missing required HMAC header." }, { status: 401 });
  }

  // Read the body ONCE. No more cloning needed here.
  const requestBody = await request.text();

  // If the body is empty, something is wrong. Shopify always sends a body for webhooks.
  if (!requestBody) {
    console.warn("[HMAC Verify] Request rejected: Request body is empty.");
    // CORRECTED: Use json() for throwing
    throw json({ message: "Bad Request: Request body is missing." }, { status: 400 });
  }

  const generatedHash = createHmac("sha256", SHOPIFY_API_SECRET)
    .update(requestBody, "utf8") // Specify encoding for consistency
    .digest("base64");

  // Use Buffer for timing-safe comparison
  try {
    const hmacBuffer = Buffer.from(hmacHeader, "base64");
    const generatedBuffer = Buffer.from(generatedHash, "base64");

    if (hmacBuffer.length !== generatedBuffer.length) {
      console.warn("[HMAC Verify] Verification failed: HMAC length mismatch.");
      // CORRECTED: Use json() for throwing
      throw json({ message: "Unauthorized: Invalid HMAC signature." }, { status: 401 });
    }

    if (!timingSafeEqual(hmacBuffer, generatedBuffer)) {
      console.warn("[HMAC Verify] Verification failed: Hashes do not match.");
      console.log(`[HMAC Verify] Received:    ${hmacHeader}`);
      console.log(`[HMAC Verify] Generated:   ${generatedHash}`);
      // CORRECTED: Use json() for throwing
      throw json({ message: "Unauthorized: Invalid HMAC signature." }, { status: 401 });
    }
  } catch (error) {
    console.warn("[HMAC Verify] Error during HMAC comparison (likely invalid base64 header):", error);
    // CORRECTED: Use json() for throwing
    throw json({ message: "Bad Request: Invalid HMAC header format." }, { status: 400 });
  }

  console.log("[HMAC Verify] HMAC successfully verified.");
  // On success, this function returns the raw body string, not a JSON response,
  // because the calling function (flow-action.handle.ts) needs to parse it.
  return requestBody;
}