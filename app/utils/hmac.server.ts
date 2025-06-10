import { createHmac, timingSafeEqual } from "crypto";

const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;

export async function verifyFlowActionHmac(request: Request): Promise<boolean> {
  if (!SHOPIFY_API_SECRET) {
    console.error("[HMAC Verify] SHOPIFY_API_SECRET is not set. Returning false.");
    return false;
  }

  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");
  if (!hmacHeader) {
    console.warn("[HMAC Verify] HMAC header is missing. Returning false.");
    return false;
  }
  console.log(`[HMAC Verify] HMAC Header received: ${hmacHeader}`);


  const requestBody = await request.clone().text();
  console.log(`[HMAC Verify] Request body length: ${requestBody.length}`);
  // console.log(`[HMAC Verify] Request body (first 200 chars): ${requestBody.substring(0, 200)}...`); // Uncomment for more detail if needed

  const generatedHash = createHmac("sha256", SHOPIFY_API_SECRET)
    .update(requestBody)
    .digest("base64");
  console.log(`[HMAC Verify] Generated hash: ${generatedHash}`);


  const hmacBuffer = Buffer.from(hmacHeader);
  const generatedBuffer = Buffer.from(generatedHash);

  if (hmacBuffer.length !== generatedBuffer.length) {
    console.warn("[HMAC Verify] HMAC buffer length mismatch. Returning false.");
    console.log(`[HMAC Verify] Expected length: ${generatedBuffer.length}, Received length: ${hmacBuffer.length}`);
    return false;
  }

  const isValid = timingSafeEqual(hmacBuffer, generatedBuffer);

  if (!isValid) {
    console.warn("[HMAC Verify] HMAC verification failed. Hashes do not match. Returning false.");
  } else {
    console.log("[HMAC Verify] HMAC successfully verified.");
  }

  return isValid;
}