export interface Mappings {
  [billFreeFieldKey: string]: string; // Key is BillFree field, value is Shopify path
}

export interface GetOrderAndCustomerDetailsResponse {
  data: {
    order: {
      id: string;
      name: string;
      createdAt: string;
      totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
      totalDiscountsSet: { shopMoney: { amount: string; currencyCode: string } };
      totalCashRoundingAdjustment?: { paymentSet: { shopMoney: { amount: string; currencyCode: string } } };
      discountCodes: string[];
      discountApplications: {
        edges: { node: { allocationMethod: string; targetSelection: string; targetType: string; value: { __typename: string } } }[];
      };
      lineItems: {
        edges: {
          node: {
            id: string;
            name: string;
            sku?: string;
            quantity: number;
            variantTitle?: string;
            productType?: string; // Add this if you want to use it for 'article' mapping
            originalUnitPriceSet: { shopMoney: { amount: string; currencyCode: string } };
            totalDiscountSet: { shopMoney: { amount: string; currencyCode: string } };
            taxLines: { priceSet: { shopMoney: { amount: string; currencyCode: string } }; rate: number; title: string }[];
            product?: { id: string; hsncode?: { value: string }; productType?: string; title?: string }; // Added productType and title to product
            variant?: { id: string; barcode?: { value: string }; title?: string }; // Added title to variant
          };
        }[];
      };
      transactions: { id: string; kind: string; gateway: string; amountSet: { shopMoney: { amount: string; currencyCode: string } }; status: string }[];
      note?: string; // Added 'note' property
    };
    customer: {
      id: string;
      firstName?: string;
      lastName?: string;
      defaultPhoneNumber?: { phoneNumber: string };
      defaultEmailAddress?: { emailAddress: string };
      custBdayMetafield?: { value: string };
      custAnnivMetafield?: { value: string };
      referrerPhoneMetafield?: { value: string };
    };
  };
  errors?: any[]; // To capture GraphQL errors if any
}