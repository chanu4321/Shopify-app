// app/routes/app.field-mapping.tsx

import { json, ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Layout, Card, Text, Select, Button, FormLayout, Box, Toast, Frame } from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { Mappings } from "app/utils/types";
// --- Type Definitions ---
interface FieldOption {
  label: string;
  value: string;
}

interface LoaderData {
  shopifyOrderFields: FieldOption[];
  billFreeAppFields: FieldOption[];
  existingMappings: Mappings;
  shop: string;
}

interface ActionData {
  success: boolean;
  message: string;
}

// --- Loader Function (GET request) ---
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Add the new 'article' field to BillFree App Fields
  const billFreeAppFields: FieldOption[] = [
    { label: "BillFree Coupon Redeemed", value: "coupon_redeemed" },
    { label: "BillFree Article", value: "article" }, // New field added
  ];

  // Add relevant Shopify fields that 'article' could map to
  const shopifyOrderFields: FieldOption[] = [
    { label: "Select Shopify Field", value: "" }, // Placeholder
    { label: "Order Discount Code (First String)", value: "order.discountCodes.0.code" }, // Changed path for consistency with GQL
    { label: "Line Items (Aggregated Product Info)", value: "AGGREGATE_LINE_ITEMS_PRODUCT_INFO" },
    // You can add more Shopify fields here as needed
  ];

  // Fetch existing mappings from your database
  const shopSettings = await db.session.findUnique({
    where: { id: `offline_${shopDomain}` },
    select: { fieldMappings: true }, // Assuming 'fieldMappings' column in your Session model
  });
  const existingMappings: Mappings = (shopSettings?.fieldMappings as Mappings) || {};

  return json<LoaderData>({ shopifyOrderFields, billFreeAppFields, existingMappings, shop: shopDomain });
}

// --- Action Function (POST request to save data) ---
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const formData = await request.formData();
  const mappingsString = formData.get("mappings");

  if (!mappingsString || typeof mappingsString !== 'string') {
    return json<ActionData>({ success: false, message: "No mappings data provided." }, { status: 400 });
  }

  let submittedMappings: Mappings;
  try {
    submittedMappings = JSON.parse(mappingsString);
  } catch (e) {
    console.error("Failed to parse mappings JSON:", e);
    return json<ActionData>({ success: false, message: "Invalid mappings data format." }, { status: 400 });
  }

  try {
    submittedMappings = JSON.parse(mappingsString);
  } catch (e) {
    console.error("Failed to parse mappings JSON:", e);
    return json<ActionData>({ success: false, message: "Invalid mappings data format." }, { status: 400 });
  }

  // Save ONLY the relevant mappings to your database
  try {
    // Only update the 'coupon_redeemed' mapping if it's present in the submission
    const currentMappings = await db.session.findUnique({
      where: { id: `offline_${shopDomain}` },
      select: { fieldMappings: true },
    });
    const updatedMappings = {
      ...(currentMappings?.fieldMappings as Mappings || {}),
      coupon_redeemed: submittedMappings.coupon_redeemed || "", // Ensure it's set, even if empty
      article: submittedMappings.article || "", // Ensure article is set
    };

    await db.session.update({
      where: { id: `offline_${shopDomain}` },
      data: {
        fieldMappings: updatedMappings,
      },
    });
    console.log(`Updated 'coupon_redeemed' mapping for ${shopDomain}:`, updatedMappings.coupon_redeemed);
    console.log(`Updated 'article' mapping for ${shopDomain}:`, updatedMappings.article);
    return json<ActionData>({ success: true, message: "Field mappings saved successfully!" });
  } catch (error) {
    console.error(`Error saving field mapping for ${shopDomain}:`, error);
    return json<ActionData>({ success: false, message: "Failed to save field mappings." }, { status: 500 });
  }
}

// --- React Component ---
export default function FieldMappingPage() {
  const { shopifyOrderFields, billFreeAppFields, existingMappings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();

  // Initialize mappings state for all BillFree fields managed by this page
  const [mappings, setMappings] = useState<Mappings>(() => ({
    coupon_redeemed: existingMappings.coupon_redeemed || "",
    article: existingMappings.article || "", // Initialize new 'article' field
  }));

  const [toastActive, setToastActive] = useState(false);
  const [toastContent, setToastContent] = useState('');
  const [toastError, setToastError] = useState(false);

  const toggleToastActive = useCallback(() => setToastActive((active) => !active), []);

  const handleMappingChange = useCallback((billFreeFieldKey: string, shopifyFieldValue: string) => {
    setMappings((prev) => ({
      ...prev,
      [billFreeFieldKey]: shopifyFieldValue,
    }));
  }, []);

  const handleSubmit = useCallback(() => {
    fetcher.submit(
      { mappings: JSON.stringify(mappings) },
      { method: "post" }
    );
  }, [mappings, fetcher]);

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data) {
      setToastContent(fetcher.data.message);
      setToastError(!fetcher.data.success);
      setToastActive(true);
    }
  }, [fetcher.state, fetcher.data]);

  const toastMarkup = toastActive ? (
    <Toast content={toastContent} error={toastError} onDismiss={toggleToastActive} duration={3000} />
  ) : null;

  return (
    <Frame>
      <Page>
        <Layout>
          <Layout.Section>
            <Card>
              <FormLayout>
                <Text variant="headingMd" as="h6">Map BillFree Fields to Shopify Order Fields</Text>
                <Text variant="bodyMd" as="p">
                  Select which Shopify Order fields provide the data for BillFree. Once a Shopify field is mapped, it will not be available for other mappings.
                </Text>

                <Box paddingBlockStart="400">
                  {/* Loop through each BillFree field to create a mapping row */}
                  {billFreeAppFields.map((billFreeField) => {
                    const currentBillFreeFieldKey = billFreeField.value;
                    const currentSelectedShopifyField = mappings[currentBillFreeFieldKey];

                    // Filter Shopify options:
                    // 1. Always include the "Select Shopify Field" placeholder.
                    // 2. Always include the currently selected option for THIS BillFree field.
                    // 3. Exclude any Shopify options that are ALREADY selected for *other* BillFree fields.
                    const availableShopifyOptions = shopifyOrderFields.filter(option => {
                      if (option.value === "") return true; // Keep placeholder
                      if (option.value === currentSelectedShopifyField) return true; // Keep current selection

                      // Check if this option is selected by any OTHER BillFree field
                      const isSelectedByOtherField = Object.entries(mappings).some(([key, value]) =>
                        key !== currentBillFreeFieldKey && value === option.value
                      );
                      return !isSelectedByOtherField;
                    });

                    return (
                      <div key={billFreeField.value} style={{ marginBottom: '24px' }}>
                        <FormLayout.Group condensed> {/* Use condensed for tighter spacing if desired */}
                          {/* Use Text instead of Select for the BillFree Field for clarity and static display */}
                           <Select
                            label="BillFree Field"
                            options={[{ label: billFreeField.label, value: billFreeField.value }]}
                            onChange={() => {}} // Disabling direct change for this dropdown, as each row is a fixed BillFree field
                            value={billFreeField.value}
                            disabled // Keep this disabled as the row corresponds to a specific BillFree field
                            // Polaris's FormLayout.Group will try to distribute space.
                            // Adding specific styles for equal width might be necessary if default doesn't suffice.
                            // For Polaris Select, 'flexGrow: 1' within a flex container helps it take available space.
                            // Ensures it takes available space and has a minimum width
                          />
                          {/* Right dropdown for Shopify field mapping */}
                          <Select
                            label="" // Label is now handled by the Text component
                            labelHidden // Hide default label as Text component provides it
                            options={availableShopifyOptions}
                            onChange={(selectedValue) =>
                              handleMappingChange(currentBillFreeFieldKey, selectedValue)
                            }
                            value={currentSelectedShopifyField}
                            placeholder="Select a Shopify field"
                            // Adding width utility to ensure consistent size // Ensures it takes available space and has a minimum width
                          />
                        </FormLayout.Group>
                      </div>
                    );
                  })}
                </Box>

                <Button
                  onClick={handleSubmit}
                  loading={fetcher.state === 'submitting'}
                >
                  Save Mappings
                </Button>
              </FormLayout>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
      {toastMarkup}
    </Frame>
  );
}

