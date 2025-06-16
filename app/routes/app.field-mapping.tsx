// app/routes/app.field-mapping.tsx

import { json, ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Layout, Card, Text, Select, Button, FormLayout, Box, Toast, Frame } from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// --- Type Definitions ---
interface FieldOption {
  label: string;
  value: string;
}

interface Mappings {
  [billFreeFieldKey: string]: string; // Key is BillFree field, value is Shopify path
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

  // ONLY include the BillFree field for coupon_redeemed
  const billFreeAppFields: FieldOption[] = [
    { label: "BillFree Coupon Redeemed", value: "coupon_redeemed" },
  ];

  // ONLY include the relevant Shopify field for discount code (from your GQL query)
  const shopifyOrderFields: FieldOption[] = [
    { label: "Select Shopify Field", value: "" },
    { label: "Order Discount Code (First String)", value: "order.discountCodes.0" },
    // You could also offer the discountApplication path if needed, but discountCodes.0 is simpler.
    // { label: "Order Discount Application (First Code)", value: "order.discountApplications.0.node.value.code" },
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

  let mappings: Mappings;
  try {
    mappings = JSON.parse(mappingsString);
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
      coupon_redeemed: mappings.coupon_redeemed || "", // Ensure it's set, even if empty
    };

    await db.session.update({
      where: { id: `offline_${shopDomain}` },
      data: {
        fieldMappings: updatedMappings,
      },
    });
    console.log(`Updated 'coupon_redeemed' mapping for ${shopDomain}:`, updatedMappings.coupon_redeemed);
    return json<ActionData>({ success: true, message: "Coupon code mapping saved successfully!" });
  } catch (error) {
    console.error(`Error saving coupon code mapping for ${shopDomain}:`, error);
    return json<ActionData>({ success: false, message: "Failed to save coupon code mapping." }, { status: 500 });
  }
}

// --- React Component ---
export default function FieldMappingPage() {
  const { shopifyOrderFields, billFreeAppFields, existingMappings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();

  // Initialize mappings state with only the 'coupon_redeemed' value
  const [mappings, setMappings] = useState<Mappings>(() => ({
    coupon_redeemed: existingMappings.coupon_redeemed || "",
  }));

  const [toastActive, setToastActive] = useState(false);
  const [toastContent, setToastContent] = useState('');
  const [toastError, setToastError] = useState(false);

  const toggleToastActive = useCallback(() => setToastActive((active) => !active), []);

  const handleMappingChange = useCallback((billFreeFieldKey: string, shopifyFieldValue: string) => {
    // This will only ever be called for 'coupon_redeemed' based on current billFreeAppFields
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
                <Text variant="headingMd" as="h6">Map BillFree Coupon Code Field</Text>
                <Text variant="bodyMd" as="p">
                  Select which Shopify Order field provides the coupon/discount code.
                </Text>

                <Box paddingBlockStart="400">
                  {/* This loop will only render one Select component for coupon_redeemed */}
                  {billFreeAppFields.map((billFreeField) => (
                    <div key={billFreeField.value} style={{ marginBottom: '24px' }}>
                      <Select
                        label={billFreeField.label}
                        options={shopifyOrderFields}
                        onChange={(selectedValue) =>
                          handleMappingChange(billFreeField.value, selectedValue)
                        }
                        value={mappings[billFreeField.value]}
                        placeholder="Select a Shopify field"
                      />
                    </div>
                  ))}
                </Box>

                <Button
                  onClick={handleSubmit}
                  loading={fetcher.state === 'submitting'}
                >
                  Save Mapping
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