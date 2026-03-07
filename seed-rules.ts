import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function seedRules() {
    console.log("Seeding rules...");
    // Attempt to find the dev store (or any active store) to attach the rules to.
    const store = await db.store.findFirst();
    if (!store) {
        console.error("No store found to attach rules to.");
        return;
    }

    const rules = [
        // PREBUILT RULES
        {
            storeId: store.id,
            name: "VIP Big Spenders",
            description: "Customers who have spent more than $1,000 in their lifetime",
            targetTag: "VIP-Gold",
            conditions: JSON.stringify([{ field: "totalSpent", operator: "greaterThan", value: "1000", ruleCategory: "metric" }]),
            isActive: true
        },
        {
            storeId: store.id,
            name: "Loyal Shoppers",
            description: "Customers who have placed 5 or more orders",
            targetTag: "Loyalist",
            conditions: JSON.stringify([{ field: "orderCount", operator: "greaterThan", value: "4", ruleCategory: "metric" }]),
            isActive: true
        },
        {
            storeId: store.id,
            name: "Churn Risk",
            description: "Customers who haven't ordered recently but have ordered before",
            targetTag: "At-Risk",
            conditions: JSON.stringify([
                { field: "orderCount", operator: "greaterThan", value: "1", ruleCategory: "metric" },
                { field: "lastOrderDate", operator: "isBefore", value: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], ruleCategory: "metric" }
            ]),
            isActive: true
        },
        // CUSTOM ORDER RULES
        {
            storeId: store.id,
            name: "Facebook Cash On Delivery",
            description: "Orders placed via Facebook using Cash Delivery",
            targetTag: "Social-FB-COD",
            conditions: JSON.stringify([
                { ruleCategory: "order", field: "order_source", operator: "contains", value: "facebook" },
                { ruleCategory: "order", field: "payment_method", operator: "contains", value: "cash on delivery" }
            ]),
            isActive: true
        },
        {
            storeId: store.id,
            name: "TikTok Pre-orders",
            description: "Customers buying Pre-order items from TikTok Ads",
            targetTag: "TikTok-Preorder",
            conditions: JSON.stringify([
                { ruleCategory: "order", field: "order_source", operator: "contains", value: "tiktok" },
                { ruleCategory: "order", field: "is_preorder", operator: "equals", value: "true" }
            ]),
            isActive: true
        },
        {
            storeId: store.id,
            name: "High Value FB Orders",
            description: "Facebook orders with a total value over $500",
            targetTag: "FB-Whale",
            conditions: JSON.stringify([
                { ruleCategory: "order", field: "order_source", operator: "contains", value: "facebook" },
                { ruleCategory: "order", field: "order_subtotal", operator: "greaterThan", value: "500" }
            ]),
            isActive: true
        }
    ];

    for (const rule of rules) {
        await db.rule.create({ data: rule });
        console.log(`Created rule: ${rule.name}`);
    }

    console.log("Finished seeding rules!");
}

seedRules().catch(console.error).finally(() => db.$disconnect());
