import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { calculateCustomerTags } from "../services/rule.server";
import { manageCustomerTags, manageOrderTags } from "../services/tags.server";
import { getCachedStore } from "../services/cache.server";
import { evaluateOrderRules } from "../services/order-rules.server";
import { incrementUsage } from "../services/usage.server";

/**
 * orders/create webhook
 *
 * Fires immediately when any new order is created — including COD orders
 * that won't ever trigger orders/paid since they're paid in cash later.
 *
 * We intentionally only run order-based rules here (traffic source, payment
 * method, location, etc). Customer metric rules (totalSpent, orderCount) rely
 * on accurate cumulative totals that Shopify only finalises after payment, so
 * those are still handled by webhooks.orders.paid.tsx.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, shop, payload, topic } = await authenticate.webhook(request);
    console.log(`[WEBHOOK] ${topic} received for ${shop}`);
    if (!admin) return new Response();

    const store = await getCachedStore(shop);
    if (!store || !store.isActive) return new Response();

    const order = payload as any;
    const customerData = order.customer;
    if (!customerData) return new Response();

    const customerId = customerData.id.toString();

    // Upsert the customer record so we have a DB entry
    await db.customer.upsert({
        where: { id_storeId: { id: customerId, storeId: store.id } },
        create: {
            id: customerId,
            storeId: store.id,
            email: customerData.email,
            firstName: customerData.first_name,
            lastName: customerData.last_name,
            totalSpent: parseFloat(customerData.total_spent || "0"),
            orderCount: customerData.orders_count || 1,
            lastOrderDate: new Date(order.created_at),
            tags: customerData.tags
        },
        update: {
            totalSpent: parseFloat(customerData.total_spent || "0"),
            orderCount: customerData.orders_count || 1,
            lastOrderDate: new Date(order.created_at),
            tags: customerData.tags
        }
    });

    const customer = await db.customer.findUnique({
        where: { id_storeId: { id: customerId, storeId: store.id } }
    });
    if (!customer) return new Response();

    const activeRules = await db.rule.findMany({
        where: { storeId: store.id, isActive: true }
    });
    if (activeRules.length === 0) return new Response();

    const existingTags = customer.tags ? customer.tags.split(",").map((t: string) => t.trim()) : [];

    let addTagNames: string[] = [];
    let tagsToAddLog: { tag: string; reason: string; targetEntity?: string }[] = [];

    // Evaluate Order-Based Rules only (not customer metric rules)
    try {
        const orderTagResults = evaluateOrderRules(order, customer, activeRules, existingTags);
        for (const item of orderTagResults) {
            if (item.targetEntity === "order") {
                tagsToAddLog.push({ tag: item.tag, reason: item.reason, targetEntity: "order" });
            } else {
                if (!addTagNames.includes(item.tag)) {
                    addTagNames.push(item.tag);
                    tagsToAddLog.push({ tag: item.tag, reason: item.reason, targetEntity: "customer" });
                }
            }
        }
    } catch (err) {
        console.error("[ORDER_RULES] orders/create evaluation failed:", err);
    }

    const actualOrderTagsToAdd = tagsToAddLog.filter(t => t.targetEntity === "order").map(t => t.tag);

    if (addTagNames.length > 0 || actualOrderTagsToAdd.length > 0) {
        try {
            if (addTagNames.length > 0) {
                const allowedAdd = await incrementUsage(store.shop, "customer_tag", addTagNames.length);
                if (allowedAdd) {
                    await manageCustomerTags(admin, store.id, customerId, addTagNames, []);
                }
            }

            if (actualOrderTagsToAdd.length > 0) {
                const allowedOrderTag = await incrementUsage(store.shop, "order_tag", actualOrderTagsToAdd.length);
                if (allowedOrderTag) {
                    const orderId = order.admin_graphql_api_id ? order.admin_graphql_api_id.split('/').pop() : order.id.toString();
                    await manageOrderTags(admin, store.id, orderId, customerId, actualOrderTagsToAdd, []);
                }
            }

            for (const item of tagsToAddLog) {
                await db.activityLog.create({
                    data: {
                        storeId: store.id,
                        customerId,
                        action: "TAG_ADDED",
                        tagContext: item.tag,
                        reason: `[orders/create] ${item.reason}`
                    }
                });
            }

            // IMPORTANT: Update the local Prisma cache so the Dashboard "Matching Customers" count
            // immediately reflects these newly added tags for order-based rules.
            const dbCustomer = await db.customer.findUnique({
                where: { id_storeId: { id: customerId, storeId: store.id } }
            });
            if (dbCustomer) {
                let currentTags = dbCustomer.tags ? dbCustomer.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
                currentTags = [...currentTags, ...addTagNames];

                await db.customer.update({
                    where: { id_storeId: { id: customerId, storeId: store.id } },
                    data: { tags: Array.from(new Set(currentTags)).join(", ") }
                });
            }

            console.log(`[ORDER_RULES] orders/create triggers: Customer Tags (${addTagNames.join(", ")}) | Order Tags (${actualOrderTagsToAdd.join(", ")})`);
        } catch (err) {
            console.error("[ORDER_RULES] Failed to apply order-create tags:", err);
        }
    }

    return new Response();
};
