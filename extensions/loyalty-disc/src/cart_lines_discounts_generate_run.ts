// Import necessary types from generated/api.
import {
  CurrencyCode,
  OrderDiscountSelectionStrategy,
  type CartInput, // Will now include cart, buyerIdentity, discountNode
  type CartLinesDiscountsGenerateRunResult, // The new main output type
  type OrderDiscountsAddOperation, // For adding order-level fixed amounts
  type OrderSubtotalTarget, // To specify applying to orderSubtotal
  type FixedAmount,
    // For selecting order discount strategy
   // For the discount value
  // DiscountApplicationStrategy is NOT imported as it's not applicable for 'run' targets
} from "../generated/api";


// --- Your Proxy Response Interfaces ---
interface GetPointsProxyResponse {
  balance: number;
  scheme_message: string;
  otpFlag: "y" | "n";
  customerMobileNumber: string;
  error?: string;
}

interface RedeemProxyResponse {
  discount_value_rupees: number;
  error?: string;
}


// --- The Main Shopify Function Entry Point ---
async function cartLinesDiscountsGenerateRun(input: CartInput): Promise<CartLinesDiscountsGenerateRunResult> {
  const customer = input.cart.buyerIdentity?.customer;
  if (!customer) {
    return { operations: [] }; // No customer, no operations
  }

  const customerGid = customer.id;
  const proxyBaseUrlMetafield = input.discount?.metafield;
  if (!proxyBaseUrlMetafield || !proxyBaseUrlMetafield.value) {
    console.error("Proxy base URL metafield not configured for loyalty function.");
    return { operations: [] };
  }
  const proxyBaseUrl = proxyBaseUrlMetafield.value;

  let customerMobileNumber: string | null = null;
  let availablePoints = 0;
  let otpRequired = false;

  // --- Step 1: Call your proxy to get Mobile Number and Points Balance (Billfree API #1 via proxy) ---
  try {
    const getPointsResponse = await fetch(`${proxyBaseUrl}/api/loyalty/points?customer_gid=${customerGid}`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!getPointsResponse.ok) {
      const errorText = await getPointsResponse.text();
      console.error(`Proxy (getPoints) error: ${getPointsResponse.status} - ${errorText}`);
      return { operations: [] };
    }

    const pointsData: GetPointsProxyResponse = await getPointsResponse.json();

    if (pointsData.error) {
        console.warn(`Proxy returned an error for points lookup: ${pointsData.error}`);
        return { operations: [] };
    }

    availablePoints = pointsData.balance || 0;
    customerMobileNumber = pointsData.customerMobileNumber || null;
    otpRequired = pointsData.otpFlag === "y";

    if (!customerMobileNumber || availablePoints <= 0) {
      console.log(`No eligible mobile number or points for customer GID: ${customerGid}. Points: ${availablePoints}`);
      return { operations: [] };
    }

  } catch (error) {
    console.error("Error fetching loyalty points/mobile number via proxy:", error);
    return { operations: [] };
  }

  // --- CRUCIAL LOGIC: Check if OTP is required for automatic redemption ---
  if (otpRequired) {
    console.log(`OTP is required for loyalty redemption for customer ${customerGid}. Automatic discount cannot be applied at checkout.`);
    return { operations: [] };
  }

  const cartSubtotal = parseFloat(input.cart.cost.subtotalAmount.amount);
  const currencyCode = input.cart.cost.subtotalAmount.currencyCode as CurrencyCode;

  const inv_no = `CHECKOUT_AUTO_${input.cart.buyerIdentity?.customer?.id}_${Date.now()}`;
  const today = new Date();
  const bill_date = today.toISOString().split('T')[0];
  const bill_amt = cartSubtotal.toFixed(2);

  let discountValueRupees = 0;
  // --- Step 2: Call your proxy to apply redemption and get discount value (Billfree API #2 via proxy) ---
  try {
    const redeemResponse = await fetch(`${proxyBaseUrl}/api/loyalty/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_phone: customerMobileNumber,
        inv_no: inv_no,
        bill_date: bill_date,
        bill_amt: bill_amt,
      }),
    });

    if (!redeemResponse.ok) {
      const errorText = await redeemResponse.text();
      console.error(`Proxy (redeem) error: ${redeemResponse.status} - ${errorText}`);
      return { operations: [] };
    }

    const redeemData: RedeemProxyResponse = await redeemResponse.json();

    if (redeemData.error) {
        console.error(`Proxy returned an error during redemption: ${redeemData.error}`);
        return { operations: [] };
    }

    discountValueRupees = redeemData.discount_value_rupees || 0;

  } catch (error) {
    console.error("Error applying loyalty redemption via proxy:", error);
    return { operations: [] };
  }

  const finalDiscountAmount = Math.min(discountValueRupees, cartSubtotal);

  if (finalDiscountAmount > 0) {
    return {
      operations: [{
        orderDiscountsAdd: { // This operation adds an order-level discount
          candidates: [ // The actual discount objects go into 'candidates' array
            {
              message: `Loyalty Points Discount: ${currencyCode} ${finalDiscountAmount.toFixed(2)}`,
              value: {
                fixedAmount: {
                  amount: finalDiscountAmount.toFixed(2), // Amount must be a string
                  appliesToEachLineItem: false, // Applies to the order subtotal
                } as FixedAmount, // Assert type
                },
                targets: [{
                    orderSubtotal: {
                      excludedCartLineIds: [], // Apply to the entire subtotal
                    } as OrderSubtotalTarget
                }], // Assert type
            } // Each item in candidates is an OrderDiscount
            ],
            selectionStrategy: OrderDiscountSelectionStrategy.First, // Specify selection strategy for this group
            // message: "Optional group message for this order discount operation" // Optional group message
          } as OrderDiscountsAddOperation, // Assert type for the entire 'orderDiscountsAdd' object
        },
      ],
    };
  }

  // No discount to apply
  return { operations: [] };
}

export { cartLinesDiscountsGenerateRun };