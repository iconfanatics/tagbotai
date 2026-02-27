import { unauthenticated } from "../shopify.server";
import db from "../db.server";
import { calculateCustomerTags } from "./rule.server";
import { manageCustomerTags, sendVipDiscount } from "./tags.server";

interface SyncJobPayload {
    shop: string;
    storeId: string;
    customersToSync: any[];
    syncType?: "RULES" | "CLEANUP";
    syncMessage?: string;
    tagsToAdd?: string[];
    tagsToRemove?: string[];
}

/**
 * Why: Historical syncs can exceed Remix/Vercel serverless timeout limits if processed synchronously. 
 * By offloading the DB upserts and Shopify Tag Mutations to an asynchronous loop, we keep the UI responsive.
 */
export async function enqueueSyncJob(payload: SyncJobPayload) {
    // Fire and forget - do not await this function's execution in the caller
    processSyncJob(payload).catch(err => {
        console.error("[QUEUE_WORKER] Unhandled error during sync job:", err);
    });
}

async function processSyncJob(payload: SyncJobPayload) {
    const { shop, storeId, customersToSync } = payload;
    console.log(`[QUEUE_WORKER] Started processing ${customersToSync.length} customers for shop: ${shop}`);

    try {
        const { admin } = await unauthenticated.admin(shop);

        const activeRules = await db.rule.findMany({
            where: { storeId: storeId, isActive: true }
        });

        // Initialize sync progress 
        await db.store.update({
            where: { id: storeId },
            data: {
                isSyncing: true,
                syncTarget: customersToSync.length,
                syncCompleted: 0,
                syncMessage: payload.syncMessage || "TagBot AI is evaluating past customers against your active rules. This runs in the background, minimizing impact on your store's performance."
            }
        });

        let completed = 0;

        for (const edge of customersToSync) {
            const c = edge.node;
            const customerId = c.id.split('/').pop();

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
                    tags: c.tags.join(",")
                },
                update: {
                    totalSpent: parseFloat(c.amountSpent?.amount || "0"),
                    orderCount: parseInt(c.numberOfOrders || "0"),
                    tags: c.tags.join(",")
                }
            });

            if (payload.syncType === "CLEANUP") {
                const addTagNames = payload.tagsToAdd || [];
                const removeTagNames = payload.tagsToRemove || [];

                if (addTagNames.length > 0 || removeTagNames.length > 0) {
                    await manageCustomerTags(admin, storeId, customerId, addTagNames, removeTagNames);

                    // Log activities
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
                const { tagsToAdd, tagsToRemove } = await calculateCustomerTags(upsertedCustomer, activeRules);

                const addTagNames = tagsToAdd.map(t => t.tag);
                const removeTagNames = tagsToRemove.map(t => t.tag);

                if (addTagNames.length > 0 || removeTagNames.length > 0) {
                    await manageCustomerTags(admin, storeId, customerId, addTagNames, removeTagNames);

                    // Check for VIP Discount triggers
                    for (const item of tagsToAdd) {
                        const normalizedTag = item.tag.toLowerCase();
                        if (normalizedTag.includes("vip") || normalizedTag.includes("high spender")) {
                            await sendVipDiscount(admin, storeId, customerId, upsertedCustomer.email || "");
                        }
                    }

                    // Log activities
                    for (const item of tagsToAdd) {
                        await db.activityLog.create({
                            data: { storeId, customerId, action: "TAG_ADDED", tagContext: item.tag, reason: item.reason }
                        });
                    }
                    for (const item of tagsToRemove) {
                        await db.activityLog.create({
                            data: { storeId, customerId, action: "TAG_REMOVED", tagContext: item.tag, reason: item.reason }
                        });
                    }
                }
            }

            completed++;
            // Update database progress every 10 iterations to prevent write locks, or on the final item
            if (completed % 10 === 0 || completed === customersToSync.length) {
                await db.store.update({
                    where: { id: storeId },
                    data: { syncCompleted: completed }
                });
            }
        }

        // Complete job — always runs even if processing had partial errors
        console.log(`[QUEUE_WORKER] Finished processing ${customersToSync.length} customers for shop: ${shop}`);
    } catch (err: any) {
        console.error(`[QUEUE_WORKER] Failed to process sync job for ${shop}:`, err.message);
    } finally {
        // CRITICAL: always reset the sync flag, even on crash or Vercel serverless timeout
        // Without this, the UI progress bar gets stuck infinitely.
        try {
            await db.store.update({
                where: { id: storeId },
                data: { isSyncing: false, syncMessage: null }
            });
        } catch (e) {
            console.error(`[QUEUE_WORKER] Failed to reset isSyncing flag for store ${storeId}:`, e);
        }
    }
}
