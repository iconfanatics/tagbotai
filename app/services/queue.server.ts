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

async function processOneCustomer(
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
        const { tagsToAdd, tagsToRemove } = await calculateCustomerTags(upsertedCustomer, activeRules);
        const addTagNames = tagsToAdd.map(t => t.tag);
        const removeTagNames = tagsToRemove.map(t => t.tag);

        if (addTagNames.length > 0 || removeTagNames.length > 0) {
            await manageCustomerTags(admin, storeId, customerId, addTagNames, removeTagNames);

            for (const item of tagsToAdd) {
                const normalizedTag = item.tag.toLowerCase();
                if (normalizedTag.includes("vip") || normalizedTag.includes("high spender")) {
                    await sendVipDiscount(admin, storeId, customerId, upsertedCustomer.email || "");
                }
            }

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
}

async function processSyncJob(payload: SyncJobPayload) {
    const { shop, storeId, customersToSync } = payload;
    console.log(`[QUEUE_WORKER] Started processing ${customersToSync.length} customers for shop: ${shop}`);

    try {
        const { admin } = await unauthenticated.admin(shop);

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
