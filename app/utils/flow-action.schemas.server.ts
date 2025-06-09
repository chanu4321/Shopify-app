import { z } from "zod";

// --- Sub-Schemas for Shopify Data within the Flow Payload ---

// Represents MoneyV2 from Shopify GraphQL (e.g., in totalPriceSet)
const MoneyV2Schema = z.object({
  amount: z.string().min(1, { message: "Amount is required" }),
  currencyCode: z.string().min(1, { message: "Currency code is required" }),
});

// Represents MoneyBag from Shopify GraphQL (e.g., in priceSet, shopMoney)
const MoneyBagSchema = z.object({
  shopMoney: MoneyV2Schema.optional(),
  presentmentMoney: MoneyV2Schema.optional(),
});

// For tax lines within line items
const TaxLineTriggerPayloadSchema = z.object({
  priceSet: MoneyBagSchema.optional(),
  rate: z.number().optional(),
  title: z.string().optional(),
});

// For individual line items in order
const LineItemTriggerPayloadSchema = z.object({
  id: z.string().min(1, { message: "Line item ID is required" }),
  name: z.string().optional(),
  sku: z.string().optional(),
  quantity: z.number().optional(),
  variantTitle: z.string().optional(),
  totalPriceSet: MoneyBagSchema.optional(),
  discountedTotalSet: MoneyBagSchema.optional(),
  taxLines: z.array(TaxLineTriggerPayloadSchema).optional(),
  product: z.object({
    id: z.string().optional(),
    metafield: z.object({ value: z.string().optional() }).optional(),
  }).optional(),
  variant: z.object({
    id: z.string().optional(),
    metafield: z.object({ value: z.string().optional() }).optional(),
  }).optional(),
});

// For customer data
const CustomerDataPayloadSchema = z.object({
  id: z.string().min(1, { message: "Customer ID is required" }),
  email: z.string().email("Invalid email format").optional(),
  phone: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  acceptsMarketing: z.boolean().optional(),
  metafield: z.object({ value: z.string().optional() }).optional(),
});

// For transaction data
const TransactionTriggerPayloadSchema = z.object({
  kind: z.string().optional(),
  gateway: z.string().optional(),
  amount: z.string().optional(),
  currency: z.string().optional(),
  status: z.string().optional(),
});

// For order data (top-level trigger output)
const OrderDataPayloadSchema = z.object({
  id: z.string().min(1, { message: "Order ID is required" }),
  name: z.string().optional(),
  createdAt: z.string().datetime().optional(), // Assumes ISO 8601 string
  currentTotalDiscountsSet: MoneyBagSchema.optional(),
  totalPriceSet: MoneyBagSchema.optional(),
  totalTaxSet: MoneyBagSchema.optional(),
  subtotalPriceSet: MoneyBagSchema.optional(),
  lineItems: z.object({
    edges: z.array(z.object({ node: LineItemTriggerPayloadSchema })).optional(),
  }).optional(),
  customer: CustomerDataPayloadSchema.optional(),
  transactions: z.object({
    edges: z.array(z.object({ node: TransactionTriggerPayloadSchema })).optional(),
  }).optional(),
});

// For shop data (from trigger)
const ShopTriggerPayloadSchema = z.object({
  myshopifyDomain: z.string().optional(),
  id: z.string().optional(),
});

// Schema for the custom fields defined in shopify.extension.toml
export const FlowActionSettingsSchema = z.object({
  customerGid: z.string().optional(),
  yourFieldKey: z.string().optional(),
});

// --- Main Flow Action Payload Schema ---
export const FlowActionPayloadSchema = z.object({
  apiVersion: z.string().optional(),
  id: z.string().optional(),
  storeId: z.string().optional(),
  flowId: z.string().optional(),
  flowActionId: z.string().optional(),
  shop: ShopTriggerPayloadSchema.optional(),
  order: OrderDataPayloadSchema.optional(),
  shopDomain: z.string().optional(),
  orderId: z.string().optional(), // gid://shopify/Order/6418174705883 (This is the crucial Order GID)
  settings: FlowActionSettingsSchema.optional(), // Your custom action settings
  'shopify::properties': z.record(z.any()).optional(), // Placeholder for any other properties Flow might send
});

// Optional: Infer TypeScript types from Zod schemas for strong typing
export type FlowActionPayload = z.infer<typeof FlowActionPayloadSchema>;
export type FlowActionSettings = z.infer<typeof FlowActionSettingsSchema>;