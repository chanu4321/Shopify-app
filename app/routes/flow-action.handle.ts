import { ActionFunctionArgs, json } from "@remix-run/node";
import { FlowActionPayloadSchema, FlowActionPayload } from "../utils/flow-action.schemas.server"; // Import your Zod schema
import { verifyFlowActionHmac } from "../utils/hmac.server"; // Import your HMAC verification utility
import { ZodError } from "zod"; // Import ZodError for handling validation errors
// import { authenticate } from "../shopify.server"; // You might need this if you interact with the Admin API later

export async function action({ request }: ActionFunctionArgs) {
  console.log("-----------------------------------------------");
  console.log("Incoming Flow Action request received.");

  // 1. Verify HMAC Signature (Crucial for security)
  const isHmacValid = await verifyFlowActionHmac(request);
  if (!isHmacValid) {
    console.error("HMAC verification failed. Request denied.");
    return json({ message: "Unauthorized: Invalid HMAC signature" }, { status: 401 });
  }

  let payload: FlowActionPayload;
  try {
    const rawBody = await request.text(); // Get raw body for Zod parsing
    const parsedBody = JSON.parse(rawBody); // Parse as JSON
    payload = FlowActionPayloadSchema.parse(parsedBody); // Validate with Zod
    console.log("Payload successfully validated with Zod.");
    // console.log("Validated Payload:", JSON.stringify(payload, null, 2)); // Log validated payload for debugging
  } catch (error) {
    if (error instanceof ZodError) {
      console.error("Validation error:", error.errors);
      return json(
        { message: "Bad Request: Invalid payload structure", errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Failed to parse request body or unknown validation error:", error);
    return json({ message: "Bad Request: Invalid JSON or unexpected error" }, { status: 400 });
  }

  // 2. Process the Flow Action (Your NestJS service logic goes here)
  try {
    // This is where you would place the core logic from your NestJS FlowActionService.
    // Example: Accessing order ID, customer ID, or settings from the validated payload
    const orderGid = payload.orderId || payload.order?.id;
    const shopDomain = payload.shopDomain || payload.shop?.myshopifyDomain;
    const customSetting = payload.settings?.yourFieldKey;

    console.log(`Processing Flow Action for Order GID: ${orderGid}`);
    console.log(`From Shop Domain: ${shopDomain}`);
    console.log(`Custom Setting: ${customSetting}`);

    // Call your actual business logic (e.g., update a database, make an Admin API call)
    // If your original service method was `flowActionService.handleFlowAction(payload)`,
    // you would put that equivalent logic here or in a separate helper function.

    // Example of calling Shopify Admin API (if needed in your service logic):
    // const { admin } = await authenticate.admin(request);
    // const response = await admin.graphql(`... GraphQL query here ...`);
    // const data = await response.json();


    const result = {
      message: "Flow Action processed and logic executed successfully in Remix!",
      orderId: orderGid,
      shopDomain: shopDomain,
      customSettingReceived: customSetting,
      timestamp: new Date().toISOString(),
      // Add any specific data you want to return to Shopify Flow here
    };

    console.log("Flow Action processed successfully. Sending response.");
    return json(result, { status: 200 }); // Shopify Flow expects a 2xx response for success

  } catch (error) {
    console.error(`Error processing Flow Action logic: ${error.message}`, error.stack);
    // Return a 4xx or 5xx response for failures so Shopify Flow can retry or mark as failed
    return json(
      {
        message: 'Failed to process Flow Action',
        details: error.message,
        error: true,
      },
      { status: error.status || 500 } // Use error status if available, else 500
    );
  } finally {
    console.log("-----------------------------------------------");
  }
}

// Optional: Prevent direct GET requests to this action endpoint
export async function loader() {
  return json({ message: "This endpoint is for POST requests only." }, { status: 405 }); // Method Not Allowed
}