import { createHmac, timingSafeEqual } from "crypto";
import { json } from "@remix-run/node";

const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;

/**
 * Verifies the HMAC signature of a Shopify Flow Action request.
 *
 * @param request The Remix Request object.
 * @returns true if HMAC is valid, false otherwise.
 */
export async function verifyFlowActionHmac(request: Request): Promise<boolean> {
  if (!SHOPIFY_API_SECRET) {
    console.error("SHOPIFY_API_SECRET is not set. HMAC verification skipped.");
    // In production, you would throw an error or return false here.
    return false; // Or throw new Error("Missing Shopify API secret for HMAC verification");
  }

  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");
  if (!hmacHeader) {
    console.warn("HMAC header is missing from Flow Action request.");
    return false;
  }

  // Clone the request to read the body without consuming it for subsequent parsing
  const requestBody = await request.clone().text();

  const generatedHash = createHmac("sha256", SHOPIFY_API_SECRET)
    .update(requestBody)
    .digest("base64");

  // Use timingSafeEqual to prevent timing attacks
  const hmacBuffer = Buffer.from(hmacHeader);
  const generatedBuffer = Buffer.from(generatedHash);

  if (hmacBuffer.length !== generatedBuffer.length) {
    console.warn("HMAC buffer length mismatch.");
    return false;
  }

  const isValid = timingSafeEqual(hmacBuffer, generatedBuffer);

  if (!isValid) {
    console.warn("HMAC verification failed for Flow Action request.");
  }

  return isValid;
}