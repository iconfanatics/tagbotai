import { unauthenticated } from "../shopify.server";
import db from "../db.server";
import { calculateCustomerTags } from "./rule.server";
import { getCachedStoreById } from "./cache.server";
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
import { fetchAllCustomers, fetchAllOrders } from "./shopify-helpers.server";
import { incrementUsage } from "./usage.server";

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
            const allowedAdd = addTagNames.length > 0 ? await incrementUsage(payload.shop, "customer_tag", addTagNames.length) : true;
            const allowedRemove = removeTagNames.length > 0 ? await incrementUsage(payload.shop, "removal", removeTagNames.length) : true;

            if (allowedAdd || allowedRemove) {
                await manageCustomerTags(admin, storeId, customerId, allowedAdd ? addTagNames : [], allowedRemove ? removeTagNames : []);
                for (const tag of (allowedAdd ? addTagNames : [])) {
                    await db.activityLog.create({
                        data: { storeId, customerId, action: "TAG_ADDED", tagContext: tag, reason: "Manual Tag Cleanup (Merge)" }
                    });
                }
                for (const tag of (allowedRemove ? removeTagNames : [])) {
                    await db.activityLog.create({
                        data: { storeId, customerId, action: "TAG_REMOVED", tagContext: tag, reason: "Manual Tag Cleanup" }
                    });
                }
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
                            orders(first: 50, after: $cursor) {
                                pageInfo {
                                    hasNextPage
                                    endCursor
                                }
                                edges {
                                    node {
                                        id
                                        createdAt
                                        tags
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
                `, { variables: { id: `gid://shopify/Customer/${customerId}`, cursor: cursor || null } });

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
                    tags: o.tags || [],
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
                const allowedAdd = addTagNames.length > 0 ? await incrementUsage(payload.shop, "customer_tag", addTagNames.length) : true;
                const allowedRemove = removeTagNames.length > 0 ? await incrementUsage(payload.shop, "removal", removeTagNames.length) : true;

                if (allowedAdd || allowedRemove) {
                    await manageCustomerTags(admin, storeId, customerId, allowedAdd ? addTagNames : [], allowedRemove ? removeTagNames : [], true);
                }
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
                    const cleanOrderId = orderGid.split('/').pop() || "";
                    if (cleanOrderId) {
                        const allowed = await incrementUsage(payload.shop, "order_tag", tags.length);
                        if (allowed) {
                            await manageOrderTags(admin, storeId, cleanOrderId, customerId, tags, [], true);
                        }
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
                
                // Fetch the rule ID to properly attribute the activity
                const rule = await db.rule.findFirst({ where: { storeId, targetTag: item.tag } });
                
                await db.activityLog.create({
                    data: { storeId, customerId, action: "TAG_ADDED", tagContext: item.tag, reason: `[Historical Sync] ${item.reason}`, ruleId: rule?.id }
                });
            }

            const uniqueOrderTags = new Set<string>();
            for (const item of tagsToAddLog) {
                if (item.targetEntity !== "order") continue;
                if (uniqueOrderTags.has(item.tag)) continue;
                uniqueOrderTags.add(item.tag);
                
                // Fetch the rule ID to properly attribute the activity
                const rule = await db.rule.findFirst({ where: { storeId, targetTag: item.tag, targetEntity: "order" } });

                await db.activityLog.create({
                    data: { storeId, customerId, action: "TAG_ADDED", tagContext: item.tag, reason: `[Historical Sync] ${item.reason}`, ruleId: rule?.id }
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

        const store = await getCachedStoreById(storeId);
        const isFree = store?.planName === "Free" || store?.planName === "";

        let customersToSync = payload.customersToSync;
        if (!customersToSync) {
            customersToSync = await fetchAllCustomers(admin, isFree);
        }

        const activeRules = await db.rule.findMany({
            where: { storeId, isActive: true }
        });

        // Separate customer rules from order rules
        const orderRules = activeRules.filter(r => {
            try { return JSON.parse(r.conditions).some((c: any) => c.ruleCategory === "order"); }
            catch { return false; }
        });
        const customerOnlyRules = activeRules.filter(r => {
            try { return !JSON.parse(r.conditions).some((c: any) => c.ruleCategory === "order"); }
            catch { return false; }
        });

        const totalWork = customersToSync.length + (orderRules.length > 0 ? 1 : 0);

        await db.store.update({
            where: { id: storeId },
            data: {
                isSyncing: true,
                syncTarget: totalWork,
                syncCompleted: 0,
                syncMessage: payload.syncMessage || "Evaluating customers and orders against active rules…"
            }
        });

        let completed = 0;

        // ─── Phase 1: Customer Rules ────────────────────────────────────────────
        // Use the original per-customer processing for customer-based rules
        if (customerOnlyRules.length > 0 || activeRules.length === 0) {
            for (let i = 0; i < customersToSync.length; i += BATCH_SIZE) {
                const batch = customersToSync.slice(i, i + BATCH_SIZE);

                await Promise.all(
                    batch.map(edge =>
                        processOneCustomer(admin, storeId, edge, customerOnlyRules.length > 0 ? customerOnlyRules : activeRules, payload)
                            .catch(err => console.error(`[QUEUE_WORKER] Error processing customer:`, err.message))
                    )
                );

                completed += batch.length;
                await db.store.update({
                    where: { id: storeId },
                    data: { syncCompleted: completed }
                });
            }
        } else {
            completed += customersToSync.length;
        }

        // ─── Phase 2: Order Rules ────────────────────────────────────────────────
        // Fetch ALL orders directly from Shopify and tag every qualifying one.
        if (orderRules.length > 0) {
            console.log(`[ORDER_SYNC] Starting order scan. ${orderRules.length} order rule(s) active.`);
            const allOrders = await fetchAllOrders(admin);
            console.log(`[ORDER_SYNC] Fetched ${allOrders.length} total orders from Shopify.`);

            let ordersEvaluated = 0;
            let ordersAlreadyTagged = 0;
            let ordersQualified = 0;
            let ordersTagged = 0;
            let ordersFailed = 0;

            for (const orderEdge of allOrders) {
                const o = orderEdge.node;
                ordersEvaluated++;

                try {
                    const subtotal = parseFloat(o.subtotalPriceSet?.shopMoney?.amount || "0");
                    const existingOrderTags: string[] = o.tags || [];

                    const mappedOrder = {
                        subtotal_price: String(subtotal),
                        total_discounts: o.totalDiscountsSet?.shopMoney?.amount || "0",
                        discount_codes: o.discountCodes ? o.discountCodes.map((c: string) => ({ code: c })) : [],
                        payment_gateway_names: o.paymentGatewayNames || [],
                        source_name: o.channel?.name || o.sourceIdentifier || "",
                        referring_site: "",
                        landing_site: "",
                        shipping_address: { city: o.shippingAddress?.city, country_code: o.shippingAddress?.countryCode },
                        tags: existingOrderTags,
                        line_items: (o.lineItems?.edges || []).map((le: any) => ({
                            quantity: le.node.quantity,
                            properties: le.node.customAttributes ? le.node.customAttributes.map((ca: any) => ({ name: ca.key, value: ca.value })) : []
                        }))
                    };

                    const customerData = {
                        id: o.customer?.id?.split("/").pop() || "guest",
                        totalSpent: parseFloat(o.customer?.amountSpent?.amount || "0"),
                        orderCount: parseInt(o.customer?.numberOfOrders || "0"),
                        tags: (o.customer?.tags || []).join(", "),
                    };

                    const results = evaluateOrderRules(mappedOrder, customerData, orderRules, []);
                    const orderTagResults = results.filter(r => r.targetEntity === "order");
                    const tagsToApply = orderTagResults.map(r => r.tag).filter(tag => !existingOrderTags.includes(tag));

                    if (orderTagResults.length > 0 && tagsToApply.length === 0) {
                        // Qualified but already tagged
                        ordersAlreadyTagged++;
                        console.log(`[ORDER_SYNC] Order ${o.id} SKIPPED (already has tags: ${orderTagResults.map(r => r.tag).join(", ")})`);
                        continue;
                    }

                    if (tagsToApply.length === 0) continue;

                    ordersQualified++;
                    console.log(`[ORDER_SYNC] Order ${o.id} QUALIFIES. subtotal=${subtotal}. Tags to apply: ${tagsToApply.join(", ")}`);

                    // Apply tags directly via Shopify GraphQL
                    const tagRes = await admin.graphql(`#graphql
                        mutation tagsAdd($id: ID!, $tags: [String!]!) {
                            tagsAdd(id: $id, tags: $tags) {
                                node { id }
                                userErrors { field message }
                            }
                        }
                    `, { variables: { id: o.id, tags: tagsToApply } });

                    const tagData = await tagRes.json();
                    const userErrors = tagData.data?.tagsAdd?.userErrors || [];

                    if (userErrors.length > 0) {
                        ordersFailed++;
                        console.error(`[ORDER_SYNC] FAILED to tag order ${o.id}:`, JSON.stringify(userErrors));
                    } else {
                        // Increment usage for order tags
                        await incrementUsage(shop, "order_tag", tagsToApply.length);
                        ordersTagged++;
                        console.log(`[ORDER_SYNC] ✓ Tagged order ${o.id} with ${tagsToApply.join(", ")}`);

                        // Log to ActivityLog (only for non-guest customers)
                        if (customerData.id !== "guest") {
                            await db.customer.upsert({
                                where: { id_storeId: { id: customerData.id, storeId } },
                                create: {
                                    id: customerData.id,
                                    storeId,
                                    email: o.customer?.email || null,
                                    totalSpent: customerData.totalSpent,
                                    orderCount: customerData.orderCount,
                                    tags: customerData.tags || null,
                                },
                                update: {}
                            });

                            for (const result of orderTagResults) {
                                if (!tagsToApply.includes(result.tag)) continue;
                                const rule = await db.rule.findFirst({ where: { storeId, targetTag: result.tag, targetEntity: "order" } });
                                await db.activityLog.create({
                                    data: {
                                        storeId,
                                        customerId: customerData.id,
                                        action: "TAG_ADDED",
                                        tagContext: result.tag,
                                        reason: `[Order Sync] ${result.reason}`,
                                        ruleId: rule?.id
                                    }
                                });
                            }
                        }
                    }
                } catch (err: any) {
                    ordersFailed++;
                    console.error(`[ORDER_SYNC] Exception on order ${o.id}:`, err.message);
                }
            }

            console.log(`[ORDER_SYNC] ════════════════════════════════════════`);
            console.log(`[ORDER_SYNC] Total orders fetched  : ${allOrders.length}`);
            console.log(`[ORDER_SYNC] Evaluated             : ${ordersEvaluated}`);
            console.log(`[ORDER_SYNC] Qualified (new)       : ${ordersQualified}`);
            console.log(`[ORDER_SYNC] Already tagged (skip) : ${ordersAlreadyTagged}`);
            console.log(`[ORDER_SYNC] Successfully tagged   : ${ordersTagged}`);
            console.log(`[ORDER_SYNC] Failed                : ${ordersFailed}`);
            console.log(`[ORDER_SYNC] ════════════════════════════════════════`);

            completed++;
            await db.store.update({ where: { id: storeId }, data: { syncCompleted: completed } });
        }

        console.log(`[QUEUE_WORKER] Finished sync job for shop: ${shop}`);
    } catch (err: any) {
        console.error(`[QUEUE_WORKER] Failed to process sync job for ${shop}:`, err.message);
    } finally {
        try {
            // Update timestamp on all active rules to signify this sync finished
            await db.rule.updateMany({
                where: { storeId },
                data: { lastSyncCompletedAt: new Date() }
            });

            await db.store.update({
                where: { id: storeId },
                data: { isSyncing: false, syncMessage: null }
            });
        } catch (e) {
            console.error(`[QUEUE_WORKER] Failed to reset isSyncing flag:`, e);
        }
    }
}

export async function enqueueMarketingBulkSyncJob(payload: { shop: string, storeId: string, platform: "klaviyo" | "mailchimp", ruleId?: string }) {
    try {
        await processMarketingBulkSyncJob(payload);
    } catch (err) {
        console.error(`[QUEUE_WORKER] Unhandled error during ${payload.platform} sync job:`, err);
    }
}

async function processMarketingBulkSyncJob(payload: { shop: string, storeId: string, platform: "klaviyo" | "mailchimp", ruleId?: string }) {
    const { shop, storeId, platform, ruleId } = payload;
    console.log(`[QUEUE_WORKER] Started ${platform} bulk sync job for shop: ${shop}`);

    try {
        const store = await getCachedStoreById(storeId);
        if (!store) throw new Error("Store not found");

        const isKlaviyo = platform === "klaviyo";
        const isMailchimp = platform === "mailchimp";

        const syncedRules = await db.rule.findMany({
            where: { 
                storeId, 
                isActive: true, 
                ...(ruleId ? { id: ruleId } : {}),
                ...(isKlaviyo ? { syncToKlaviyo: true } : { syncToMailchimp: true }) 
            },
            select: { targetTag: true }
        });

        const targetTags = syncedRules.map(r => r.targetTag);

        if (targetTags.length === 0) {
            console.log(`[QUEUE_WORKER] No active synced segments for ${platform}, aborting.`);
            return;
        }

        const validCustomers = await db.customer.findMany({
            where: {
                storeId,
                email: { not: null },
                tags: { not: null }
            },
            select: { id: true, email: true, tags: true }
        });

        let syncCount = 0;
        
        // Dynamically import API functions to avoid circular dependencies
        const { syncTagsToKlaviyo } = await import("./klaviyo.server");
        const { syncTagsToMailchimp } = await import("./mailchimp.server");

        let authErrorCount = 0;
        let lastErrorMsg = "";

        for (const c of validCustomers) {
            if (!c.email) continue;
            
            const currentTags = c.tags ? c.tags.split(",").map(t => t.trim().toLowerCase()) : [];
            const overlappingTags = targetTags.filter(t => currentTags.includes(t.toLowerCase()));

            if (overlappingTags.length > 0) {
                try {
                    if (isKlaviyo) {
                        const tokenToUse = store.klaviyoAccessToken || store.klaviyoApiKey;
                        const canSync = store.klaviyoAccessToken ? store.klaviyoIsActive : !!store.klaviyoApiKey;

                        if (tokenToUse && canSync) {
                            const res = await syncTagsToKlaviyo(tokenToUse, c.email, overlappingTags);
                            if (res.success) {
                                syncCount++;
                            } else {
                                authErrorCount++;
                                lastErrorMsg = res.message || "Unknown Error";
                            }
                            // Basic rate limit respect (approx 6/sec)
                            await new Promise(r => setTimeout(r, 150)); 
                        }
                    } else if (isMailchimp && store.mailchimpApiKey && store.mailchimpServerPrefix && store.mailchimpListId) {
                        const res = await syncTagsToMailchimp(store.mailchimpApiKey, store.mailchimpServerPrefix, store.mailchimpListId, c.email, overlappingTags);
                        if (res.success) {
                            syncCount++;
                        } else {
                            authErrorCount++;
                            lastErrorMsg = res.message || "Unknown Error";
                        }
                        // Basic rate limit respect (approx 6/sec)
                        await new Promise(r => setTimeout(r, 150)); 
                    }
                } catch (apiErr: any) {
                    console.error(`[QUEUE_WORKER] Bulk sync API fail for ${c.email}:`, apiErr);
                    authErrorCount++;
                    lastErrorMsg = apiErr.message;
                }
            }
        }

        let finalMessage = `Successfully pushed ${syncCount} qualifying profiles.`;
        if (authErrorCount > 0) {
            finalMessage = `Pushed ${syncCount} profiles. Failed ${authErrorCount} due to API errors (e.g., ${lastErrorMsg}). Check Integrations page.`;
        }

        console.log(`[QUEUE_WORKER] Finished ${platform} bulk sync. ` + finalMessage);
        
        await db.store.update({
            where: { id: storeId },
            data: { syncMessage: finalMessage }
        });
        
    } catch (err: any) {
        console.error(`[QUEUE_WORKER] Failed to process ${platform} bulk sync for ${shop}:`, err.message);
        try {
            await db.store.update({
                where: { id: storeId },
                data: { syncMessage: `Bulk Sync Failed: ${err.message}` }
            });
        } catch (dbErr) { /* ignore */ }
    } finally {
        try {
            const isKlaviyo = platform === "klaviyo";
            await db.store.update({
                where: { id: storeId },
                data: isKlaviyo ? { klaviyoSyncInProgress: false } : { mailchimpSyncInProgress: false }
            });
        } catch (e) {
            console.error(`[QUEUE_WORKER] Failed to reset sync flag:`, e);
        }
    }
}

