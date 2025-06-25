import {
  BlockStack,
  reactExtension,
  TextBlock,
  Banner,
  useApi,
  Spinner,
  Heading,
} from "@shopify/ui-extensions-react/customer-account";
import { useEffect, useState } from 'react';

export default reactExtension(
  "customer-account.profile.block.render",
  () => <LoyaltyPoints />
);

function LoyaltyPoints() {
  const api = useApi<"customer-account.profile.block.render">();
  console.log("DEBUG: Full UI Extension API object:", api);
  console.log("DEBUG: api.customer object:", api.authenticatedAccount.customer);
  console.log("DEBUG: api.customer?.current?.id:", api.authenticatedAccount.customer.current.id); // Check nested value with optional chaining

  const [points, setPoints] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [schemeMessage, setSchemeMessage] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchLoyaltyPoints() {
      if (!api.authenticatedAccount.customer.current.id) {
        setErrorMessage("Customer ID or Shop Domain not available.");
        setIsLoading(false);
        return;
      }

      const customerGid = api.authenticatedAccount.customer.current.id; // Correct way to get customer GID in UI Extensions
        // Correct way to get shop domain in UI Extensions

      // **IMPORTANT: Your App Proxy path, confirmed from previous steps**
      // This is relative to the storefront domain (e.g., my-shop.myshopify.com)
      const appProxyPath = '/apps/api/loyalty/points';

      try {
        // Construct the URL. window.location.origin refers to the storefront domain
        const response = await fetch(`${window.location.origin}${appProxyPath}?customer_id=${customerGid}`);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error', scheme_message: '' }));
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
          setErrorMessage(data.error);
          setSchemeMessage(data.scheme_message || '');
        } else {
          setPoints(data.balance);
          setSchemeMessage(data.scheme_message || '');
        }
      } catch (error) {
        console.error("Error fetching loyalty points:", error);
        setErrorMessage(`Could not load loyalty points. ${error.message}`);
      } finally {
        setIsLoading(false);
      }
    }

    fetchLoyaltyPoints();
  }, [api]); // Re-run if customer or shop data changes (though unlikely for these)

  return (
    <BlockStack inlineAlignment="center" padding="base">
      <Heading level={3}>Your Loyalty Points</Heading>
      {isLoading ? (
        <Spinner accessibilityLabel="Loading loyalty points" />
      ) : errorMessage ? (
        <Banner status="critical" title="Error loading loyalty points">
          <TextBlock>{errorMessage}</TextBlock>
          {schemeMessage && <TextBlock>{schemeMessage}</TextBlock>}
        </Banner>
      ) : (
        <TextBlock size="extraLarge" emphasis="bold">
          {points !== null ? points : 'N/A'}
        </TextBlock>
      )}
      {schemeMessage && !errorMessage && (
        <TextBlock size="small" inlineAlignment="center">{schemeMessage}</TextBlock>
      )}
    </BlockStack>
  );
}