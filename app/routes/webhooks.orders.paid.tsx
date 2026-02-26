import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { calculateCustomerTags } from "../services/rule.server";
import { manageCustomerTags, sendVipDiscount } from "../services/tags.server";
import { getCachedStore } from "../services/cache.server";
import { analyzeSentiment } from "../services/ai.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, shop, payload, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);
    if (!admin) return new Response();

    // Find the active store via cache
    const store = await getCachedStore(shop);
    if (!store || !store.isActive) {
        return new Response();
    }

    // Typecast payload based on webhook topic
    const order = payload as any;

    // Extract customer data from the order
    const customerData = order.customer;
    if (!customerData) {
        return new Response();
    }

    const customerId = customerData.id.toString();

    // Upsert the customer with the latest total spent and order count
    await db.customer.upsert({
        where: {
            id_storeId: {
                id: customerId,
                storeId: store.id,
            }
        },
        create: {
            id: customerId,
            storeId: store.id,
            email: customerData.email,
            firstName: customerData.first_name,
            lastName: customerData.last_name,
            totalSpent: parseFloat(customerData.state === 'disabled' ? "0" : customerData.total_spent || "0"),
            orderCount: customerData.orders_count || 1,
            lastOrderDate: new Date(order.created_at),
            tags: customerData.tags
        },
        update: {
            totalSpent: parseFloat(customerData.total_spent || "0"),
            orderCount: customerData.orders_count || 1,
            lastOrderDate: new Date(order.created_at),
            tags: customerData.tags
            // We'll update the name/email as well just in case they changed
        }
    });

    // Trigger rule evaluation for this customer based on the new data
    const customer = await db.customer.findUnique({
        where: { id_storeId: { id: customerId, storeId: store.id } }
    });

    const activeRules = await db.rule.findMany({
        where: { storeId: store.id, isActive: true }
    });

    let addTagNames: string[] = [];
    let removeTagNames: string[] = [];
    let tagsToAddLog: { tag: string, reason: string }[] = [];
    let tagsToRemoveLog: { tag: string, reason: string }[] = [];

    if (customer && activeRules.length > 0) {
        const standardRules = activeRules.filter(r => !r.collectionId);
        const collectionRules = activeRules.filter(r => r.collectionId);

        // 1. Evaluate standard rules (Total Spent, Order Count, etc)
        const { tagsToAdd, tagsToRemove } = await calculateCustomerTags(customer, standardRules);
        addTagNames = tagsToAdd.map(t => t.tag);
        removeTagNames = tagsToRemove.map(t => t.tag);
        tagsToAddLog = [...tagsToAdd];
        tagsToRemoveLog = [...tagsToRemove];

        // 2. Evaluate Collection-Specific Rules
        if (collectionRules.length > 0 && order.line_items && order.line_items.length > 0) {
            // Extract unique product IDs from the order
            const productIds = [...new Set(order.line_items.map((item: any) => item.product_id).filter(Boolean))];

            if (productIds.length > 0) {
                // Fetch the collections for these products
                const productGids = productIds.map(id => `gid://shopify/Product/${id}`);
                try {
                    const productsResponse = await admin.graphql(
                        `#graphql
                          query getProductCollections($ids: [ID!]!) {
                            nodes(ids: $ids) {
                              ... on Product {
                                id
                                collections(first: 50) {
                                  edges {
                                    node {
                                      id
                                    }
                                  }
                                }
                              }
                            }
                          }
                        `,
                        {
                            variables: {
                                ids: productGids
                            }
                        }
                    );

                    const productsData = await productsResponse.json();
                    const purchasedCollectionIds = new Set<string>();

                    // Extract all unique collection IDs this customer bought from in this order
                    if (productsData?.data?.nodes) {
                        for (const node of productsData.data.nodes) {
                            if (node && node.collections) {
                                for (const edge of node.collections.edges) {
                                    purchasedCollectionIds.add(edge.node.id);
                                }
                            }
                        }
                    }

                    // Compare against collection rules
                    const existingTags = customer.tags ? customer.tags.split(",").map(t => t.trim()) : [];
                    for (const rule of collectionRules) {
                        const targetCollectionGid = `gid://shopify/Collection/${rule.collectionId}`;

                        if (purchasedCollectionIds.has(targetCollectionGid)) {
                            if (!existingTags.includes(rule.targetTag) && !addTagNames.includes(rule.targetTag)) {
                                addTagNames.push(rule.targetTag);
                                tagsToAddLog.push({ tag: rule.targetTag, reason: `Purchased from Collection "${rule.collectionName}"` });
                            }
                        }
                    }
                } catch (err) {
                    console.error("Failed to evaluate collection rules:", err);
                }
            }
        }

        // 3. Evaluate AI Sentiment Analysis on the Order Note
        if (store.enableSentimentAnalysis && order.note) {
            try {
                const sentimentTag = await analyzeSentiment(order.note);
                if (sentimentTag) {
                    const normalizedExisting = existingTags.map(t => t.toLowerCase());
                    const normalizedAdd = addTagNames.map(t => t.toLowerCase());
                    const targetTagLower = sentimentTag.toLowerCase();

                    if (!normalizedExisting.includes(targetTagLower) && !normalizedAdd.includes(targetTagLower)) {
                        addTagNames.push(sentimentTag);
                        tagsToAddLog.push({ tag: sentimentTag, reason: `AI Detected intent from note: "${order.note.substring(0, 30)}..."` });
                    }
                }
            } catch (err) {
                console.error("Failed to execute AI Sentiment analysis on order notes:", err);
            }
        }

        // Asynchronously update tags in Shopify if there are changes
        if (addTagNames.length > 0 || removeTagNames.length > 0) {
            try {
                await manageCustomerTags(admin, store.id, customerId, addTagNames, removeTagNames);

                // Check for VIP Discount triggers
                for (const item of tagsToAddLog) {
                    const normalizedTag = item.tag.toLowerCase();
                    if (normalizedTag.includes("vip") || normalizedTag.includes("high spender")) {
                        await sendVipDiscount(admin, store.id, customerId, customer.email || "");
                    }
                }

                // Log the actions
                for (const item of tagsToAddLog) {
                    await db.activityLog.create({
                        data: { storeId: store.id, customerId, action: "TAG_ADDED", tagContext: item.tag, reason: item.reason }
                    });
                }
                for (const item of tagsToRemoveLog) {
                    await db.activityLog.create({
                        data: { storeId: store.id, customerId, action: "TAG_REMOVED", tagContext: item.tag, reason: item.reason }
                    });
                }
            } catch (err) {
                console.error("Failed to manage tags", err);
            }
        }
    }

    return new Response();
};
