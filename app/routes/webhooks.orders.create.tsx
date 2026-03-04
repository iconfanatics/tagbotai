import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { calculateCustomerTags } from "../services/rule.server";
import { manageCustomerTags } from "../services/tags.server";
import { getCachedStore } from "../services/cache.server";
import { evaluateOrderRules } from "../services/order-rules.server";

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
    let tagsToAddLog: { tag: string; reason: string }[] = [];

    // Evaluate Order-Based Rules only (not customer metric rules)
    try {
        const orderTagResults = evaluateOrderRules(order, customer, activeRules, existingTags);
        for (const item of orderTagResults) {
            if (!addTagNames.includes(item.tag)) {
                addTagNames.push(item.tag);
                tagsToAddLog.push(item);
            }
        }
    } catch (err) {
        console.error("[ORDER_RULES] orders/create evaluation failed:", err);
    }

    if (addTagNames.length > 0) {
        try {
            await manageCustomerTags(admin, store.id, customerId, addTagNames, []);

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

            console.log(`[ORDER_RULES] Tagged customer ${customerId} with: ${addTagNames.join(", ")}`);
        } catch (err) {
            console.error("[ORDER_RULES] Failed to apply order-create tags:", err);
        }
    }

    return new Response();
};
