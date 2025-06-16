// app/routes/app.field-mapping.tsx

import { json, ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Layout, Card, Text, Select, Button, FormLayout, Box, Toast, Frame } from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { Mappings } from "../utils/types"; // Import Mappings from shared types file
import { DeleteIcon, PlusIcon } from '@shopify/polaris-icons'; // Import icons for removal and addition

// --- Type Definitions ---
type BillFreeCategory = "item" | "additional_info" | "payment_info";

interface FieldOption {
  label: string;
  value: string;
}

interface FieldOptionWithCategory extends FieldOption {
  category: BillFreeCategory;
}

interface LoaderData {
  shopifyOrderFields: FieldOption[];
  allPossibleBillFreeFields: FieldOptionWithCategory[]; // All BillFree fields with categories
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

  // All BillFree App Fields your application *can* map to, categorized.
  const allPossibleBillFreeFields: FieldOptionWithCategory[] = [
    { label: "BillFree Coupon Redeemed", value: "coupon_redeemed", category: "item" },
    { label: "BillFree Article", value: "article", category: "item" },
    { label: "BillFree Total Bill Amount", value: "total_bill_amount", category: "additional_info" },
    { label: "BillFree Order Note", value: "order_note", category: "additional_info" }, // Example new field
    { label: "BillFree Payment Mode", value: "payment_mode", category: "payment_info" },
    { label: "BillFree Cash Paid Amount", value: "cash_paid_amount", category: "payment_info" }, // Example new field
  ];

  // All Shopify Order Fields that can be mapped. This array is global.
  const shopifyOrderFields: FieldOption[] = [
    { label: "Select Shopify Field", value: "" }, // Placeholder
    { label: "Order Discount Code (First String)", value: "order.discountCodes.0.code" },
    { label: "Line Items (Aggregated Product Info)", value: "AGGREGATE_LINE_ITEMS_PRODUCT_INFO" },
    { label: "Order Total Price", value: "order.totalPriceSet.shopMoney.amount" }, // For total_bill_amount
    { label: "Order Note", value: "order.note" }, // For order_note
    { label: "First Transaction Gateway", value: "order.transactions.0.gateway" }, // For payment_mode
    { label: "Total Cash Paid (First Transaction)", value: "order.transactions.0.amountSet.shopMoney.amount" }, // For cash_paid_amount
    // You can add more Shopify fields here as needed
  ];

  // Fetch existing mappings from your database
  const shopSettings = await db.session.findUnique({
    where: { id: `offline_${shopDomain}` },
    select: { fieldMappings: true }, // Assuming 'fieldMappings' column in your Session model
  });
  const existingMappings: Mappings = (shopSettings?.fieldMappings as Mappings) || {};

  return json<LoaderData>({ shopifyOrderFields, allPossibleBillFreeFields, existingMappings, shop: shopDomain });
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
    // Fetch current mappings to compare and update
    const currentSettings = await db.session.findUnique({
      where: { id: `offline_${shopDomain}` },
      select: { fieldMappings: true },
    });
    const existingDbMappings = (currentSettings?.fieldMappings as Mappings) || {};

    const updatedMappings: Mappings = { ...submittedMappings }; // Start with submitted mappings

    // Identify fields that were present in DB but removed in submission
    for (const key in existingDbMappings) {
      if (existingDbMappings.hasOwnProperty(key) && !submittedMappings.hasOwnProperty(key)) {
        // If a field was in DB but not in submitted (meaning it was removed), delete it.
        delete updatedMappings[key];
      }
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
  const { shopifyOrderFields, allPossibleBillFreeFields, existingMappings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();

  // State to hold the current mappings (dynamically added/removed)
  const [mappings, setMappings] = useState<Mappings>(existingMappings || {});

  const [toastActive, setToastActive] = useState(false);
  const [toastContent, setToastContent] = useState('');
  const [toastError, setToastError] = useState(false);
  
  // State to manage the temporary new field selected in the 'Add' dropdown for each section
  const [newFieldSelection, setNewFieldSelection] = useState<Record<BillFreeCategory, string>>({
    item: "",
    additional_info: "",
    payment_info: "",
  });

  const toggleToastActive = useCallback(() => setToastActive((active) => !active), []);

  const handleMappingChange = useCallback((billFreeFieldKey: string, shopifyFieldValue: string) => {
    setMappings((prev) => ({
      ...prev,
      [billFreeFieldKey]: shopifyFieldValue,
    }));
  }, []);

  const handleAddField = useCallback((sectionCategory: BillFreeCategory) => {
    const fieldToAdd = newFieldSelection[sectionCategory];
    if (fieldToAdd && !mappings.hasOwnProperty(fieldToAdd)) {
      setMappings((prev) => ({
        ...prev,
        [fieldToAdd]: "", // Add with an empty Shopify mapping
      }));
      setNewFieldSelection((prev) => ({ // Reset the specific section's add dropdown
        ...prev,
        [sectionCategory]: "",
      }));
    }
  }, [newFieldSelection, mappings]);

  const handleRemoveField = useCallback((billFreeFieldKey: string) => {
    setMappings((prev) => {
      const newMappings = { ...prev };
      delete newMappings[billFreeFieldKey]; // Remove the field from mappings
      return newMappings;
    });
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

  // Helper function to render a mapping section
  const renderMappingSection = (
    title: string,
    description: string,
    sectionCategory: BillFreeCategory
  ) => {
    // Filter BillFree fields that belong to this section's category and are currently mapped
    const displayedFields = allPossibleBillFreeFields.filter(
      (bfField) => bfField.category === sectionCategory && mappings.hasOwnProperty(bfField.value)
    );

    // Filter BillFree fields that belong to this section's category and are NOT yet mapped
    const availableToAddFields = allPossibleBillFreeFields.filter(
      (bfField) => bfField.category === sectionCategory && !mappings.hasOwnProperty(bfField.value)
    );

    // Options for the "Add Field" dropdown for this specific section
    const addFieldOptions = [
      { label: "Add a field...", value: "" }, // Placeholder
      ...availableToAddFields.map((field) => ({
        label: field.label,
        value: field.value,
      })),
    ];

    return (
      <Layout.Section>
        <Card>
          <FormLayout>
            <Text variant="headingMd" as="h6">{title}</Text>
            <Text variant="bodyMd" as="p">
              {description}
            </Text>

            <Box paddingBlockStart="400">
              {displayedFields.length === 0 && availableToAddFields.length === 0 && (
                <Text variant="bodySm" as="p">All possible fields in this section are currently mapped.</Text>
              )}
              {displayedFields.length === 0 && availableToAddFields.length > 0 && (
                <Text variant="bodySm" as="p">No fields mapped in this section yet. Use the "Add a field" option below.</Text>
              )}

              {displayedFields.map((billFreeField) => {
                const currentBillFreeFieldKey = billFreeField.value;
                const currentSelectedShopifyField = mappings[currentBillFreeFieldKey];

                // Filter Shopify options:
                // 1. Always include the "Select Shopify Field" placeholder.
                // 2. Always include the currently selected option for THIS BillFree field.
                // 3. Exclude any Shopify options that are ALREADY selected for *other* BillFree fields.
                const availableShopifyOptions = shopifyOrderFields.filter(option => {
                  if (option.value === "") return true; // Keep placeholder
                  if (option.value === currentSelectedShopifyField) return true; // Keep current selection

                  const isSelectedByOtherField = Object.entries(mappings).some(([key, value]) =>
                    key !== currentBillFreeFieldKey && value === option.value
                  );
                  return !isSelectedByOtherField;
                });

                return (
                  <div key={billFreeField.value} style={{ marginBottom: '24px' }}>
                    <FormLayout.Group>
                      <Select
                        label="BillFree Field"
                        options={[{ label: billFreeField.label, value: billFreeField.value }]}
                        onChange={() => {}} // Disabled as the BillFree field is fixed for this row
                        value={billFreeField.value}
                        disabled
                      />
                      <Select
                        label="Maps To Shopify Field"
                        options={availableShopifyOptions}
                        onChange={(selectedValue) => 
                          handleMappingChange(currentBillFreeFieldKey, selectedValue)
                        }
                        value={currentSelectedShopifyField}
                        placeholder="Select a Shopify field"
                      />
                      {/* Minus button for removal */}
                      <Box paddingBlockStart="200" paddingBlockEnd="200"> {/* Adjust padding as needed */}
                        <Button
                          onClick={() => handleRemoveField(currentBillFreeFieldKey)}
                          icon={DeleteIcon} // Use DeleteIcon as a component
                          accessibilityLabel={`Remove ${billFreeField.label} mapping`}
                         />
                      </Box>
                    </FormLayout.Group>
                  </div>
                );
              })}

              {/* Dynamic Add Field Row */}
              {availableToAddFields.length > 0 && (
                <div style={{ marginTop: '20px' }}>
                  <FormLayout.Group condensed>
                    <Select
                      label="Add a new BillFree field"
                      labelHidden // Hide default label as the context makes it clear
                      options={addFieldOptions}
                      onChange={(value) => setNewFieldSelection((prev) => ({
                          ...prev,
                          [sectionCategory]: value,
                      }))}
                      value={newFieldSelection[sectionCategory]}
                      placeholder="Choose field to add"
                    />
                    <Button
                      onClick={() => handleAddField(sectionCategory)}
                      disabled={!newFieldSelection[sectionCategory]}
                      icon={PlusIcon} // Plus icon for adding
                      accessibilityLabel="Add selected field"
                    >
                      Add
                    </Button>
                  </FormLayout.Group>
                </div>
              )}
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
    );
  };

  return (
    <Frame>
      <Page>
        <Layout>
          {renderMappingSection(
            "Items",
            "Configure mappings for item-related information in BillFree.",
            "item"
          )}

          {renderMappingSection(
            "Additional Info",
            "Configure mappings for general order information.",
            "additional_info"
          )}

          {renderMappingSection(
            "Payment Info",
            "Configure mappings for payment-related details.",
            "payment_info"
          )}
        </Layout>
      </Page>
      {toastMarkup}
    </Frame>
  );
}
