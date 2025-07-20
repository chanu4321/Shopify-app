import {
  BlockStack,
  reactExtension,
  TextBlock,
  Banner,
  useApi,
  Spinner,
  Heading,
  Button,
  TextField,
  InlineStack,
} from "@shopify/ui-extensions-react/customer-account";
import { useEffect, useState } from 'react'

export default reactExtension(
  "customer-account.profile.block.render",
  () => <LoyaltyPoints />
);
interface domainData {
  shop: {
    primaryDomain: {
      url: string;
    };
  };
}
function LoyaltyPoints() {
  const { query, sessionToken, authenticatedAccount } = useApi();
  // const [shopDomain, setShopDomain] = useState(''); // No longer needed

  const backendUrl = "https://shopify-app-ten-pi.vercel.app";

  console.log("DEBUG: Full UI Extension API object:", { query, sessionToken, authenticatedAccount });
  console.log("DEBUG: api.customer object:", authenticatedAccount.customer);
  console.log("DEBUG: api.customer?.current?.id:", authenticatedAccount.customer.current.id);
  console

  const [points, setPoints] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [schemeMessage, setSchemeMessage] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [otpFlag, setOtpFlag] = useState("n");
  const [customerPhone, setCustomerPhone] = useState("");
  
  // Redemption states (keeping all existing fields)
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [redemptionStep, setRedemptionStep] = useState("idle"); // idle, otp-sent, redeeming, success
  const [otpCode, setOtpCode] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [discountAmount, setDiscountAmount] = useState(0);
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    const fetchPoints = async () => {
      try {
        // The logic to fetch shop domain has been removed as we are using a static backend URL.
        
        // Now, fetch loyalty points
        if (!authenticatedAccount.customer.current.id) {
          setErrorMessage("Customer ID not available.");
          setIsLoading(false);
          return;
        }

        const customerGid = authenticatedAccount.customer.current.id;
        const loyaltyUrl = `${backendUrl}/api/loyalty/points`;
        const token = await sessionToken.get();
        const requestUrl = `${loyaltyUrl}?customer_id=${customerGid}`;

        const response = await fetch(requestUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const text = await response.text();
          let errorPayload: { error?: string; scheme_message?: string } = {};
          try {
            errorPayload = JSON.parse(text);
          } catch {
            /* not JSON */
          }
          const message = errorPayload.error || text || `HTTP ${response.status}`;
          throw new Error(message);
        }

        const responseData = await response.json();
        console.log("DEBUG: Data received from backend:", responseData);

        if (responseData.error) {
          setErrorMessage(responseData.error);
          setSchemeMessage(responseData.scheme_message || '');
        } else {
          setPoints(responseData.balance);
          setSchemeMessage(responseData.scheme_message || '');
          setOtpFlag(responseData.otpFlag || "n");
          setCustomerPhone(responseData.customerMobileNumber || "");
        }
      } catch (error) {
        console.error("Error during setup:", error);
        setErrorMessage(`Could not load loyalty points. ${error.message}`);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPoints();
  }, [query, sessionToken, authenticatedAccount]);

  // Handler for sending OTP
  const handleSendOTP = async () => {
    setIsRedeeming(true);
    try {
      const token = await sessionToken.get();
      const response = await fetch(`${backendUrl}/api/send-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          user_phone: customerPhone
        })
      });
      
      const data = await response.json();
      if (response.ok) {
        setRedemptionStep("otp-sent");
      } else {
        setErrorMessage(data.error || 'Failed to send OTP');
      }
    } catch (error) {
      setErrorMessage('Network error while sending OTP');
    } finally {
      setIsRedeeming(false);
    }
  };

  // Handler for direct redemption (no OTP)
  const handleDirectRedeem = async () => {
    setIsRedeeming(true);
    try {
      const token = await sessionToken.get();
      const response = await fetch(`${backendUrl}/api/loyalty/redeem-points`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          customer_id: authenticatedAccount.customer.current.id,
          bill_amt: billAmount
        })
      });
      
      const data = await response.json();
      if (response.ok && data.success) {
        setDiscountCode(data.discountCode);
        setDiscountAmount(data.discountAmount);
        setSuccessMessage(data.message);
        setRedemptionStep("success");
        // Refresh points
        setPoints(prevPoints => Math.max(0, prevPoints - data.pointsRedeemed || 0));
      } else {
        setErrorMessage(data.error || 'Failed to redeem points');
      }
    } catch (error) {
      setErrorMessage('Network error while redeeming points');
    } finally {
      setIsRedeeming(false);
    }
  };

  // Handler for OTP verification and redemption
  const handleVerifyOTPAndRedeem = async () => {
    setIsRedeeming(true);
    try {
      const token = await sessionToken.get();
      const response = await fetch(`${backendUrl}/api/loyalty/redeem-points`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          customer_id: authenticatedAccount.customer.current.id,
          bill_amt: billAmount,
          otp_code: otpCode
        })
      });
      
      const data = await response.json();
      if (response.ok && data.success) {
        setDiscountCode(data.discountCode);
        setDiscountAmount(data.discountAmount);
        setSuccessMessage(data.message);
        setRedemptionStep("success");
        setOtpCode(""); // Clear OTP
        // Refresh points
        setPoints(prevPoints => Math.max(0, prevPoints - data.pointsRedeemed || 0));
      } else {
        setErrorMessage(data.error || 'Failed to verify OTP or redeem points');
      }
    } catch (error) {
      setErrorMessage('Network error while verifying OTP');
    } finally {
      setIsRedeeming(false);
    }
  };

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
      
      {/* Redemption Section */}
      {points > 0 && !errorMessage && (
        <BlockStack spacing="base">
          <Heading level={4}>Redeem Points</Heading>
          
          {redemptionStep === "idle" && (
            <BlockStack spacing="base">
              <TextField
                label="Cart Amount (₹)"
                value={billAmount}
                onChange={setBillAmount}
                
              />
              {otpFlag === "y" ? (
                <Button
                  onPress={handleSendOTP}
                  disabled={!billAmount || isRedeeming}
                  loading={isRedeeming}
                >
                  Send OTP to Redeem
                </Button>
              ) : (
                <Button
                  onPress={handleDirectRedeem}
                  disabled={!billAmount || isRedeeming}
                  loading={isRedeeming}
                >
                  Redeem Points
                </Button>
              )}
            </BlockStack>
          )}
          
          {redemptionStep === "otp-sent" && (
            <BlockStack spacing="base">
              <Banner status="info" title="OTP Sent">
                <TextBlock>Please enter the OTP sent to {customerPhone}</TextBlock>
              </Banner>
              <TextField
                label="Enter OTP"
                value={otpCode}
                onChange={setOtpCode}
                
              />
              <InlineStack spacing="base">
                <Button
                  onPress={handleVerifyOTPAndRedeem}
                  disabled={!otpCode || isRedeeming}
                  loading={isRedeeming}
                >
                  Verify & Redeem
                </Button>
                <Button
                  onPress={() => setRedemptionStep("idle")}
                  disabled={isRedeeming}
                >
                  Cancel
                </Button>
              </InlineStack>
            </BlockStack>
          )}
          
          {redemptionStep === "success" && (
            <BlockStack spacing="base">
              <Banner status="success" title="Redemption Successful!">
                <TextBlock>{successMessage}</TextBlock>
                <TextBlock emphasis="bold">Discount Code: {discountCode}</TextBlock>
                <TextBlock>Discount Amount: ₹{discountAmount}</TextBlock>
                <TextBlock size="small">Copy this code and use it at checkout!</TextBlock>
              </Banner>
              <Button onPress={() => setRedemptionStep("idle")}>
                Redeem More Points
              </Button>
            </BlockStack>
          )}
        </BlockStack>
      )}
    </BlockStack>
  );
}