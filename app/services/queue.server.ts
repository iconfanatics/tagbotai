import { unauthenticated } from "../shopify.server";
import db from "../db.server";
import { calculateCustomerTags } from "./rule.server";
import { manageCustomerTags, manageOrderTags, sendVipDiscount } from "./tags.server";

interface SyncJobPayload {
    shop: string;
    storeId: string;
    customersToSync?: any[];
    syncType?: "RULES" | "CLEANUP";
    syncMessage?: string;
    tagsToAdd?: string[];
    tagsToRemove?: string[];
}

import { evaluateOrderRules } from "./order-rules.server";
import { fetchAllCustomers } from "./shopify-helpers.server";

const BATCH_SIZE = 5;  // Process 5 customers in parallel at a time

/**
 * Fire-and-forget sync job.
 * Processes customers in parallel batches of BATCH_SIZE for speed.
 */
export async function enqueueSyncJob(payload: SyncJobPayload) {
    processSyncJob(payload).catch(err => {
        console.error("[QUEUE_WORKER] Unhandled error during sync job:", err);
    });
}

export async function processOneCustomer(
    admin: any,
    storeId: string,
    edge: any,
    activeRules: any[],
    payload: SyncJobPayload
) {
    const c = edge.node;
    const customerId = c.id.split("/").pop();

    const upsertedCustomer = await db.customer.upsert({
        where: { id_storeId: { id: customerId, storeId } },
        create: {
            id: customerId,
            storeId,
            email: c.email,
            firstName: c.firstName,
            lastName: c.lastName,
            totalSpent: parseFloat(c.amountSpent?.amount || "0"),
            orderCount: parseInt(c.numberOfOrders || "0"),
            tags: Array.isArray(c.tags) ? c.tags.join(",") : (c.tags || "")
        },
        update: {
            totalSpent: parseFloat(c.amountSpent?.amount || "0"),
            orderCount: parseInt(c.numberOfOrders || "0"),
            tags: Array.isArray(c.tags) ? c.tags.join(",") : (c.tags || "")
        }
    });

    if (payload.syncType === "CLEANUP") {
        const addTagNames = payload.tagsToAdd || [];
        const removeTagNames = payload.tagsToRemove || [];

        if (addTagNames.length > 0 || removeTagNames.length > 0) {
            await manageCustomerTags(admin, storeId, customerId, addTagNames, removeTagNames);
            for (const tag of addTagNames) {
                await db.activityLog.create({
                    data: { storeId, customerId, action: "TAG_ADDED", tagContext: tag, reason: "Manual Tag Cleanup (Merge)" }
                });
            }
            for (const tag of removeTagNames) {
                await db.activityLog.create({
                    data: { storeId, customerId, action: "TAG_REMOVED", tagContext: tag, reason: "Manual Tag Cleanup" }
                });
            }
        }
    } else if (activeRules.length > 0) {
        // 1. Evaluate standard metric rules
        const { tagsToAdd, tagsToRemove } = await calculateCustomerTags(upsertedCustomer, activeRules);
        let addTagNames = tagsToAdd.map(t => t.tag);
        let removeTagNames = tagsToRemove.map(t => t.tag);
        const tagsToAddLog: { tag: string, reason: string, targetEntity?: string, orderId?: string }[] = [...tagsToAdd];
        const tagsToRemoveLog: { tag: string, reason: string, targetEntity?: string, orderId?: string }[] = [...tagsToRemove];

        // 2. Evaluate order-based rules (if any exist)
        const hasOrderRules = activeRules.some(r => {
            try { return JSON.parse(r.conditions).some((c: any) => c.ruleCategory === "order"); }
            catch { return false; }
        });

        if (hasOrderRules) {
            // Fetch ALL orders for this customer to check historical rule matches
            let hasNextPage = true;
            let cursor: string | null = null;
            let allOrderEdges: any[] = [];

            while (hasNextPage) {
                const orderRes = await admin.graphql(`#graphql
                    query getCustomerOrders($id: ID!, $cursor: String) {
                        customer(id: $id) {
                            orders(first: 50, after: $cursor, sortKey: CREATED_AT, reverse: true) {
                                pageInfo {
                                    hasNextPage
                                    endCursor
                                }
                                edges {
                                    node {
                                        id
                                        createdAt
                                        subtotalPriceSet { shopMoney { amount } }
                                        totalDiscountsSet { shopMoney { amount } }
                                        discountCodes
                                        paymentGatewayNames
                                        sourceIdentifier
                                        channel { name }
                                        shippingAddress { city countryCode }
                                        lineItems(first: 50) {
                                            edges {
                                                node {
                                                    quantity
                                                    customAttributes { key value }
                                                    product { tags }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `, { variables: { id: `gid://shopify/Customer/${customerId}`, cursor } });

                const orderData: any = await orderRes.json();
                const ordersConnection: any = orderData.data?.customer?.orders;
                
                if (!ordersConnection) break;

                allOrderEdges = allOrderEdges.concat(ordersConnection.edges || []);
                hasNextPage = ordersConnection.pageInfo?.hasNextPage || false;
                cursor = ordersConnection.pageInfo?.endCursor || null;

                // Simple rate-limit respect
                if (hasNextPage) await new Promise(r => setTimeout(r, 250));
            }

            const existingTags = tagsToAdd.map(t => t.tag).concat(upsertedCustomer.tags ? upsertedCustomer.tags.split(",").map(t => t.trim()) : []);

            for (const orderEdge of allOrderEdges) {
                // Map the graphql order payload to match the REST webhook shape that evaluateOrderRules expects
                const o = orderEdge.node;
                const mappedOrder = {
                    subtotal_price: o.subtotalPriceSet?.shopMoney?.amount || "0",
                    total_discounts: o.totalDiscountsSet?.shopMoney?.amount || "0",
                    discount_codes: o.discountCodes ? o.discountCodes.map((c: string) => ({ code: c })) : [],
                    payment_gateway_names: o.paymentGatewayNames,
                    source_name: o.channel?.name || o.sourceIdentifier,
                    referring_site: "", // GraphQL limits this
                    landing_site: "",
                    shipping_address: { city: o.shippingAddress?.city, country_code: o.shippingAddress?.countryCode },
                    line_items: o.lineItems.edges.map((le: any) => ({
                        quantity: le.node.quantity,
                        properties: le.node.customAttributes ? le.node.customAttributes.map((ca: any) => ({ name: ca.key, value: ca.value })) : []
                    }))
                };

                const orderTagResults = evaluateOrderRules(mappedOrder, upsertedCustomer, activeRules, existingTags);
                for (const item of orderTagResults) {
                    if (item.targetEntity === "order") {
                        // Tagging an order is unique to the order itself, no need to deduplicate against the customer's history
                        tagsToAddLog.push({ tag: item.tag, reason: item.reason, targetEntity: "order", orderId: o.id });
                    } else {
                        if (!addTagNames.includes(item.tag)) {
                            addTagNames.push(item.tag);
                            tagsToAddLog.push({ ...item, targetEntity: "customer" });
                            existingTags.push(item.tag);
                        }
                    }
                }
            }
        }

        // 3. Apply the combined results
        const actualOrderTagsToAdd = tagsToAddLog.filter(t => t.targetEntity === "order");

        if (addTagNames.length > 0 || removeTagNames.length > 0 || actualOrderTagsToAdd.length > 0) {
            
            if (addTagNames.length > 0 || removeTagNames.length > 0) {
                await manageCustomerTags(admin, storeId, customerId, addTagNames, removeTagNames);
            }

            // Sync tags exactly to their historical orders individually
            if (actualOrderTagsToAdd.length > 0) {
                // Group by order ID to avoid spamming Shopify API for multi-rule matches on the same order
                const tagsByOrder: Record<string, string[]> = {};
                for (const item of actualOrderTagsToAdd as any[]) {
                    if (!tagsByOrder[item.orderId]) tagsByOrder[item.orderId] = [];
                    tagsByOrder[item.orderId].push(item.tag);
                }

                for (const [orderGid, tags] of Object.entries(tagsByOrder)) {
                    // Extract ID number from gid://shopify/Order/12345
                    const cleanOrderId = orderGid.split('/').pop() || "";
                    if (cleanOrderId) {
                        await manageOrderTags(admin, storeId, cleanOrderId, customerId, tags, []);
                    }
                }
            }

            for (const item of tagsToAddLog) {
                const normalizedTag = item.tag.toLowerCase();
                if (normalizedTag.includes("vip") || normalizedTag.includes("high spender")) {
                    await sendVipDiscount(admin, storeId, customerId, upsertedCustomer.email || "");
                }
            }

            for (const item of tagsToAddLog) {
                if (item.targetEntity === "order") continue; // Handled below
                await db.activityLog.create({
                    data: { storeId, customerId, action: "TAG_ADDED", tagContext: item.tag, reason: `[Historical Sync] ${item.reason}` }
                });
            }

            for (const item of tagsToAddLog) {
                if (item.targetEntity !== "order") continue;
                await db.activityLog.create({
                    data: { storeId, customerId, action: "TAG_ADDED", tagContext: item.tag, reason: `[Historical Sync] ${item.reason}` }
                });
            }

            for (const item of tagsToRemoveLog) {
                await db.activityLog.create({
                    data: { storeId, customerId, action: "TAG_REMOVED", tagContext: item.tag, reason: `[Historical Sync] ${item.reason}` }
                });
            }
        }
    }
}

async function processSyncJob(payload: SyncJobPayload) {
    const { shop, storeId } = payload;
    console.log(`[QUEUE_WORKER] Started sync job for shop: ${shop}`);

    try {
        const { admin } = await unauthenticated.admin(shop);

        // Fetch customers in the background to unblock UI
        const store = await db.store.findUnique({ where: { id: storeId } });
        const isFree = store?.planName === "Free" || store?.planName === "";

        let customersToSync = payload.customersToSync;
        if (!customersToSync) {
            customersToSync = await fetchAllCustomers(admin, isFree);
        }

        const activeRules = await db.rule.findMany({
            where: { storeId, isActive: true }
        });

        await db.store.update({
            where: { id: storeId },
            data: {
                isSyncing: true,
                syncTarget: customersToSync.length,
                syncCompleted: 0,
                syncMessage: payload.syncMessage || "Evaluating customers against active rules…"
            }
        });

        let completed = 0;

        // Process in parallel batches for speed
        for (let i = 0; i < customersToSync.length; i += BATCH_SIZE) {
            const batch = customersToSync.slice(i, i + BATCH_SIZE);

            await Promise.all(
                batch.map(edge =>
                    processOneCustomer(admin, storeId, edge, activeRules, payload)
                        .catch(err => console.error(`[QUEUE_WORKER] Error processing customer:`, err.message))
                )
            );

            completed += batch.length;
            // Update progress after each batch
            await db.store.update({
                where: { id: storeId },
                data: { syncCompleted: completed }
            });
        }

        console.log(`[QUEUE_WORKER] Finished processing ${customersToSync.length} customers for shop: ${shop}`);
    } catch (err: any) {
        console.error(`[QUEUE_WORKER] Failed to process sync job for ${shop}:`, err.message);
    } finally {
        try {
            await db.store.update({
                where: { id: storeId },
                data: { isSyncing: false, syncMessage: null }
            });
        } catch (e) {
            console.error(`[QUEUE_WORKER] Failed to reset isSyncing flag:`, e);
        }
    }
}
