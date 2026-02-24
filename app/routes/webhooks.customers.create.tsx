import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { calculateCustomerTags } from "../services/rule.server";
import { manageCustomerTags } from "../services/tags.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, shop, payload, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    // Find the active store.
    const store = await db.store.findUnique({ where: { shop } });
    if (!store || !store.isActive) {
        return new Response();
    }

    const customerData = payload as any;
    const customerId = customerData.id.toString();

    // Create or Update the customer
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
            totalSpent: parseFloat(customerData.total_spent || "0"),
            orderCount: customerData.orders_count || 0,
            tags: customerData.tags
        },
        update: {
            email: customerData.email,
            firstName: customerData.first_name,
            lastName: customerData.last_name,
            totalSpent: parseFloat(customerData.total_spent || "0"),
            orderCount: customerData.orders_count || 0,
            tags: customerData.tags
        }
    });

    const customer = await db.customer.findUnique({
        where: { id_storeId: { id: customerId, storeId: store.id } }
    });

    const activeRules = await db.rule.findMany({
        where: { storeId: store.id, isActive: true }
    });

    if (customer && activeRules.length > 0) {
        const { tagsToAdd, tagsToRemove } = await calculateCustomerTags(customer, activeRules);

        const addTagNames = tagsToAdd.map(t => t.tag);
        const removeTagNames = tagsToRemove.map(t => t.tag);

        if (addTagNames.length > 0 || removeTagNames.length > 0) {
            try {
                await manageCustomerTags(admin, store.id, customerId, addTagNames, removeTagNames);

                for (const item of tagsToAdd) {
                    await db.activityLog.create({
                        data: { storeId: store.id, customerId, action: "TAG_ADDED", tagContext: item.tag, reason: item.reason }
                    });
                }
                for (const item of tagsToRemove) {
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
