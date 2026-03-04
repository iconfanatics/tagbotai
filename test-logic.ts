import { evaluateOrderRules } from './app/services/order-rules.server';

// ─── Mock: A plain COD order (no Facebook, no social media) ──────────────────
const codOrder = {
    id: 111111111,
    subtotal_price: "120.00",
    total_discounts: "0.00",
    referring_site: "",         // No traffic source
    source_name: "web",
    payment_gateway: "",
    payment_gateway_names: ["Cash on Delivery (COD)"],  // <- Shopify's real field
    shipping_address: { city: "Dhaka", country_code: "BD" },
    line_items: [{ quantity: 2, properties: [] }],
    discount_codes: []
};

// ─── Mock: A Facebook COD order ───────────────────────────────────────────────
const facebookCodOrder = {
    id: 222222222,
    subtotal_price: "250.00",
    total_discounts: "0.00",
    referring_site: "https://l.facebook.com/redirect?link=mystore.com",
    source_name: "web",
    payment_gateway: "",
    payment_gateway_names: ["Cash on Delivery (COD)"],
    shipping_address: { city: "Dhaka", country_code: "BD" },
    line_items: [{ quantity: 1, properties: [] }],
    discount_codes: []
};

// ─── Mock: A Stripe/card payment, Facebook order ──────────────────────────────
const facebookStripeOrder = {
    id: 333333333,
    subtotal_price: "75.00",
    total_discounts: "0.00",
    referring_site: "https://l.facebook.com/redirect?link=mystore.com",
    source_name: "web",
    payment_gateway: "stripe",
    payment_gateway_names: ["Stripe"],
    shipping_address: { city: "New York", country_code: "US" },
    line_items: [{ quantity: 1, properties: [] }],
    discount_codes: []
};

// ─── Rules we are testing against ─────────────────────────────────────────────
const rules = [
    {
        id: "r1", name: "COD Customers", targetTag: "COD-Customer", matchType: "ALL",
        conditions: JSON.stringify([
            { ruleCategory: "order", field: "payment_method", operator: "contains", value: "cash_on_delivery" }
        ])
    },
    {
        id: "r2", name: "Facebook Campaign Orders", targetTag: "Social-FB", matchType: "ALL",
        conditions: JSON.stringify([
            { ruleCategory: "order", field: "order_source", operator: "contains", value: "facebook" }
        ])
    },
    {
        id: "r3", name: "Facebook Cash On Delivery", targetTag: "Social-FB-COD", matchType: "ALL",
        conditions: JSON.stringify([
            { ruleCategory: "order", field: "order_source", operator: "contains", value: "facebook" },
            { ruleCategory: "order", field: "payment_method", operator: "contains", value: "cash_on_delivery" }
        ])
    },
    {
        id: "r4", name: "High Value FB Orders", targetTag: "FB-Whale", matchType: "ALL",
        conditions: JSON.stringify([
            { ruleCategory: "order", field: "order_source", operator: "contains", value: "facebook" },
            { ruleCategory: "order", field: "order_subtotal", operator: "greaterThan", value: "200" }
        ])
    },
] as any[];

const mockCustomer = {
    id: "cust1", storeId: "store1", totalSpent: 500, orderCount: 3,
    lastOrderDate: new Date(), email: "test@example.com",
    firstName: "Test", lastName: "User", tags: null,
    createdAt: new Date(), updatedAt: new Date()
};

function printResults(label: string, order: any) {
    const tags = evaluateOrderRules(order, mockCustomer, rules, []);
    console.log(`\n📦 ${label}`);
    console.log(`   Payment: ${order.payment_gateway_names?.join(", ") || order.payment_gateway || "none"}`);
    console.log(`   Traffic: ${order.referring_site || "(direct)"}`);
    if (tags.length === 0) {
        console.log("   ❌ No tags matched.");
    } else {
        tags.forEach(t => console.log(`   ✅ Tag: [${t.tag}] — ${t.reason}`));
    }
}

console.log("=".repeat(60));
console.log("  TAGBOT AI — COD Order Rule Evaluation Test");
console.log("=".repeat(60));

printResults("Scenario 1: Plain COD Order (no social media)", codOrder);
printResults("Scenario 2: Facebook + COD Order", facebookCodOrder);
printResults("Scenario 3: Facebook + Stripe (no COD)", facebookStripeOrder);

console.log("\n" + "=".repeat(60));
