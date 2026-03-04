import { evaluateOrderRules } from './app/services/order-rules.server';

// 1. This is the raw data Shopify sends us when an order is paid
const mockShopifyWebhookPayload = {
    id: 987654321,
    subtotal_price: "85.00",
    total_discounts: "0.00",

    // 👇 THIS IS HOW WE DETECT FACEBOOK TRAFFIC
    referring_site: "https://l.facebook.com/",
    source_name: "web",

    // 👇 THIS IS HOW WE DETECT CASH ON DELIVERY
    payment_gateway: "Cash on Delivery (COD)",

    shipping_address: {
        city: "Dhaka",
        country_code: "BD"
    },
    line_items: [
        { quantity: 1, properties: [] }
    ]
};

async function runDemo() {
    console.log("==================================================");
    console.log("   TAGBOT AI: FACEBOOK & COD DETECTOR DEMO");
    console.log("==================================================\n");

    console.log("📦 1. Fake Shopify Order Received:");
    console.log(JSON.stringify({
        Traffic_Source: mockShopifyWebhookPayload.referring_site,
        Payment_Method: mockShopifyWebhookPayload.payment_gateway,
        Total_Value: "$" + mockShopifyWebhookPayload.subtotal_price
    }, null, 2));

    // 2. This is what the AI generates when you type: "Tag Facebook COD orders"
    const mySmartRule = {
        id: "r_demo",
        name: "Facebook COD Buyers",
        targetTag: "Social-FB-COD",
        conditions: JSON.stringify([
            { ruleCategory: "order", field: "order_source", operator: "contains", value: "facebook" },
            { ruleCategory: "order", field: "payment_method", operator: "contains", value: "cash on delivery" }
        ])
    } as any;

    console.log("\n⚙️ 2. Evaluating against AI Smart Rule:");
    console.log(`   Rule Name: "${mySmartRule.name}"`);
    console.log(`   Applying Tag: [${mySmartRule.targetTag}]`);

    // 3. Run our matching engine
    const mockCustomer = { id: "c1", storeId: "s1", totalSpent: 85, orderCount: 1, lastOrderDate: new Date(), email: null, firstName: null, lastName: null, tags: null, createdAt: new Date(), updatedAt: new Date() };
    const orderEval = evaluateOrderRules(mockShopifyWebhookPayload, mockCustomer, [mySmartRule], []);

    console.log("\n📊 3. Result:");
    if (orderEval.length > 0) {
        console.log(`   ✅ MATCH SUCCESSFUL!`);
        console.log(`   🏷️ Tag To Apply: [${orderEval[0].tag}]`);
        console.log(`   📝 Engine Reason: ${orderEval[0].reason}`);
    } else {
        console.log("   ❌ No match found.");
    }
    console.log("\n==================================================");
}

runDemo().catch(console.error);
