import { unauthenticated } from "../shopify.server";

const FIRST_NAMES = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Charlie", "Sam", "Jamie", "Avery", "Blake", "Drew", "Logan", "Cameron", "Quinn"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson"];
const CITIES = ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego", "Dallas", "San Jose", "Austin", "Jacksonville", "Fort Worth", "Columbus", "San Francisco"];
const COUNTRIES = ["US", "CA", "GB", "AU", "DE", "FR"];
const SOURCES = ["facebook", "tiktok", "instagram", "google", "direct", "email", "pinterest"];
const PAYMENT_METHODS = ["stripe", "paypal", "credit_card", "cash_on_delivery", "klarna", "afterpay"];
const DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"];

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomItem = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randomBoolean = (probability = 0.5) => Math.random() < probability;

/**
 * Generates test customers and draft orders using an offline access token.
 */
export async function generateTestData(shop: string) {
    try {
        console.log(`[TEST DATA] Starting generation for ${shop}...`);
        const { admin } = await unauthenticated.admin(shop);

        // Create 10 diverse customers, each with up to 3 real orders, to stay within 10s serverless lambda timeouts
        for (let i = 0; i < 10; i++) {
            const firstName = randomItem(FIRST_NAMES);
            const lastName = randomItem(LAST_NAMES);
            const domain = randomItem(DOMAINS);
            const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${Date.now() + i}@${domain}`;
            const city = randomItem(CITIES);
            const country = randomItem(COUNTRIES);
            const orderCount = randomInt(0, 3);
            const totalSpent = (randomInt(0, 500000) / 100).toFixed(2); // $0 to $5000.00

            const isVIP = randomBoolean(0.15);
            const tags = isVIP ? "Test Data, VIP" : "Test Data";

            try {
                const res = await admin.graphql(`
                    mutation customerCreate($input: CustomerInput!) {
                        customerCreate(input: $input) {
                            customer { id }
                            userErrors { field message }
                        }
                    }
                `, {
                    variables: {
                        input: {
                            firstName, lastName, email, tags, taxExempt: false,
                            addresses: [{
                                address1: `${randomInt(100, 9999)} Main St`,
                                city, countryCode: country, zip: `${randomInt(10000, 99999)}`,
                                firstName, lastName
                            }]
                        }
                    }
                });

                const data = await res.json();
                if (data.data?.customerCreate?.userErrors?.length) {
                    console.error(`[TEST DATA] Customer Error (${email}):`, data.data.customerCreate.userErrors);
                    continue; // Skip order if customer fails
                }
                const customerId = data.data?.customerCreate?.customer?.id;

                for (let j = 0; j < orderCount; j++) {
                    const source = randomItem(SOURCES);
                    const payment = randomItem(PAYMENT_METHODS);
                    const itemCount = randomInt(1, 4);

                    const draftRes = await admin.graphql(`
                        mutation draftOrderCreate($input: DraftOrderInput!) {
                            draftOrderCreate(input: $input) {
                                draftOrder { id }
                                userErrors { field message }
                            }
                        }
                    `, {
                        variables: {
                            input: {
                                purchasingEntity: { customerId },
                                email, tags: `${source}, ${payment}`,
                                lineItems: Array.from({ length: itemCount }).map(() => ({
                                    title: `Dummy Product ${randomInt(1, 100)}`,
                                    originalUnitPrice: (randomInt(1000, 10000) / 100).toFixed(2),
                                    quantity: randomInt(1, 3)
                                })),
                                customAttributes: [
                                    { key: "order_source", value: source },
                                    { key: "payment_method", value: payment }
                                ],
                                shippingLine: { title: "Standard Shipping", price: "5.00" }
                            }
                        }
                    });

                    const draftData = await draftRes.json();
                    if (draftData.data?.draftOrderCreate?.userErrors?.length) {
                        console.error(`[TEST DATA] Draft Order Error (${email}):`, draftData.data.draftOrderCreate.userErrors);
                        continue;
                    }

                    // Complete the draft order to create a REAL order in the store (updates customer lifetime value, counts, etc)
                    const draftOrderId = draftData.data?.draftOrderCreate?.draftOrder?.id;
                    if (draftOrderId) {
                        const completeRes = await admin.graphql(`
                            mutation draftOrderComplete($id: ID!) {
                                draftOrderComplete(id: $id, paymentPending: false) {
                                    draftOrder { id }
                                    userErrors { field message }
                                }
                            }
                        `, {
                            variables: { id: draftOrderId }
                        });
                        const completeData = await completeRes.json();
                        if (completeData.data?.draftOrderComplete?.userErrors?.length) {
                            console.error(`[TEST DATA] Complete Order Error (${email}):`, completeData.data.draftOrderComplete.userErrors);
                        }
                    }
                }

                console.log(`[TEST DATA] ${i + 1}/10 created: ${email}`);
                // Small sleep to ensure we don't max the 1000 point GraphQL bucket, but keep it fast enough for serverless limits
                await new Promise(res => setTimeout(res, 50));
            } catch (err: any) {
                console.error(`[TEST DATA] GraphQL throws on ${i}:`, err.message);
                await new Promise(res => setTimeout(res, 500));
            }
        }

        console.log(`[TEST DATA] 10 customers generated successfully.`);
        return 10;
    } catch (error) {
        console.error("[TEST DATA ERROR]", error);
        throw error;
    }
}
