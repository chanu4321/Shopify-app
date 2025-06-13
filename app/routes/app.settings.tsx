// app/routes/app.settings.tsx
import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData, useActionData } from "@remix-run/react";
import { Page, Layout, Card, Text, TextField, Button, Banner, BlockStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import shopify from "../shopify.server";
import db from "../db.server"; // Your Prisma client instance

// --- LOADER FUNCTION ---
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await shopify.authenticate.admin(request);

  // Fetch the current BillFree configuration from your database
  const shopSession = await db.session.findUnique({
    where: { id: session.id },
    select: { billFreeAuthToken: true, isBillFreeConfigured: true },
  });

  return json({
    shop: session.shop,
    billFreeAuthToken: shopSession?.billFreeAuthToken || '',
    isBillFreeConfigured: shopSession?.isBillFreeConfigured || false,
  });
}

// --- ACTION FUNCTION ---
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await shopify.authenticate.admin(request);
  const formData = await request.formData();
  const billFreeAuthToken = formData.get("billFreeAuthToken")?.toString();

  if (!billFreeAuthToken || billFreeAuthToken.trim() === '') {
    return json({ success: false, message: "BillFree Auth Token cannot be empty." }, { status: 400 });
  }

  try {
    await db.session.update({
      where: { id: session.id },
      data: {
        billFreeAuthToken: billFreeAuthToken.trim(),
        isBillFreeConfigured: true,
      },
    });
    return json({ success: true, message: "BillFree Auth Token saved successfully!" });
  } catch (error) {
    console.error("Error saving BillFree Auth Token:", error);
    return json({ success: false, message: "Failed to save BillFree Auth Token. Please try again." }, { status: 500 });
  }
}

// --- UI COMPONENT ---
export default function BillFreeSettings() {
  const { billFreeAuthToken, isBillFreeConfigured } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <Page>
      <TitleBar title="BillFree Integration Settings" />
      <Layout>
        <Layout.Section>
          <Card>
            <Text variant="headingMd" as="h2">
              BillFree Authentication
            </Text>
            <Text variant="bodyMd" as="p">
              Enter your unique BillFree API Authentication Token to connect your Shopify store. You can find this token in your BillFree account settings.
            </Text>
            <Form method="post" style={{ marginTop: 'var(--p-space-400)' }}>
              <BlockStack gap="400"> {/* Use BlockStack for vertical spacing, with a standard gap */}
                <TextField
                  label="BillFree Auth Token"
                  name="billFreeAuthToken"
                  value={billFreeAuthToken}
                  onChange={() => { /* React controlled component onChange handler */ }}
                  autoComplete="off"
                  helpText="Your secret token for BillFree API calls."
                />
                <Button
                  submit
                  variant="primary"
                >
                  Save Settings
                </Button>
              </BlockStack>
            </Form>
          </Card>
        </Layout.Section>
        {actionData && (
          <Layout.Section>
            <Banner
              tone={actionData.success ? "success" : "critical"}
              onDismiss={() => { /* Handle dismissal if needed, otherwise remove onDismiss */ }}
            >
              <p>{actionData.message}</p>
            </Banner>
          </Layout.Section>
        )}
        {isBillFreeConfigured && actionData?.success === undefined && (
            <Layout.Section>
              <Banner tone="success">
                <p>BillFree integration is currently configured.</p>
              </Banner>
            </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}