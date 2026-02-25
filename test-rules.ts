import { calculateCustomerTags } from "./app/services/rule.server";

async function runTest() {
    console.log("==========================================");
    console.log("    TAGBOT AI - RULE ENGINE TESTER");
    console.log("==========================================\n");

    // 1. Simulate a Customer who just made their 5th order, putting their lifetime spend at $1,200
    const mockCustomer: any = {
        id: "gid://shopify/Customer/123456",
        storeId: "test-store-id",
        email: "john.doe@test.com",
        firstName: "John",
        lastName: "Doe",
        totalSpent: 1200,   // Customer Lifetime Spend
        orderCount: 5,      // Customer Lifetime Orders
        lastOrderDate: new Date(),
        tags: ""            // Customer currently has no tags
    };

    console.log(`[CUSTOMER DATA]`);
    console.log(`- Lifetime Total Spent: $${mockCustomer.totalSpent}`);
    console.log(`- Lifetime Order Count: ${mockCustomer.orderCount}`);
    console.log(`- Existing Shopify Tags: None\n`);

    // 2. Simulate the two active rules the merchant created in the database
    const mockRules: any[] = [
        {
            id: "rule-1",
            name: "High Spender VIP",
            conditions: JSON.stringify([{ field: "totalSpent", operator: "greaterThan", value: 1000 }]),
            targetTag: "VIP",
            isActive: true
        },
        {
            id: "rule-2",
            name: "Frequent Buyer",
            conditions: JSON.stringify([{ field: "orderCount", operator: "greaterThan", value: 4 }]), // 4 means 5 or more
            targetTag: "T2T",
            isActive: true
        }
    ];

    console.log(`[ACTIVE STORE RULES]`);
    console.log(`1. IF Total Spent > $1000 --> TAG: "VIP"`);
    console.log(`2. IF Order Count > 4 --> TAG: "T2T"\n`);

    // 3. Run the backend engine exactly as it runs during a Shopify Webhook
    console.log(`[ENGINE] Evaluating Customer against Rules...\n`);

    const result = await calculateCustomerTags(mockCustomer, mockRules);

    // 4. Print the exact output the engine sends back to Shopify
    console.log("==========================================");
    console.log("           ENGINE OUTPUT");
    console.log("==========================================\n");
    console.log(`Tags to Add: `, result.tagsToAdd.map(t => t.tag));
    console.log(`\nReasons array generated for Activity Log:`);
    result.tagsToAdd.forEach(t => console.log(` - ${t.reason}`));
    console.log("\n==========================================");
}

runTest().catch(console.error);
