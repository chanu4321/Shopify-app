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
    { label: "Line Item Product Type (First Item)", value: "order.lineItems.0.productType" }, // Potential for 'article'
    { label: "Line Item Variant Title (First Item)", value: "order.lineItems.0.variant.title" }, // Potential for 'article'
    { label: "Line Item Product Title (First Item)", value: "order.lineItems.0.title" }, // Main product title
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
    // Fetch current mappings to preserve any fields not included in the submission
    const currentSettings = await db.session.findUnique({
      where: { id: `offline_${shopDomain}` },
      select: { fieldMappings: true },
    });
    const existingDbMappings = (currentSettings?.fieldMappings as Mappings) || {};

    // Define all BillFree fields that this page manages
    const managedBillFreeFields = ["coupon_redeemed", "article"];

    const updatedMappings: Mappings = { ...existingDbMappings };

    // Update mappings only for the fields managed by this page
    for (const fieldKey of managedBillFreeFields) {
      // If the field exists in the submitted data, use its value (or empty string if null/undefined)
      // Otherwise, keep its existing value from the DB or an empty string
      updatedMappings[fieldKey] = submittedMappings.hasOwnProperty(fieldKey)
        ? submittedMappings[fieldKey] || ""
        : existingDbMappings[fieldKey] || "";
    }

    await db.session.update({
      where: { id: `offline_${shopDomain}` },
      data: {
        fieldMappings: updatedMappings,
      },
    });
    console.log(`Updated mappings for ${shopDomain}:`, updatedMappings);
    return json<ActionData>({ success: true, message: "Field mappings saved successfully!" });
  } catch (error) {
    console.error(`Error saving field mappings for ${shopDomain}:`, error);
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
                        <FormLayout.Group>
                          {/* Left dropdown/label for BillFree field - now a static label for clarity */}
                          <Select
                            label="BillFree Field"
                            options={[{ label: billFreeField.label, value: billFreeField.value }]}
                            value={billFreeField.value}
                            onChange={() => {}} // No change allowed for this dropdown, it's fixed
                            disabled // Disable selection as per the new vertical layout interpretation
                          />
                          {/* Right dropdown for Shopify field mapping */}
                          <Select
                            label="Maps To Shopify Field"
                            options={availableShopifyOptions}
                            onChange={(selectedValue) =>
                              handleMappingChange(currentBillFreeFieldKey, selectedValue)
                            }
                            value={currentSelectedShopifyField}
                            placeholder="Select a Shopify field"
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

