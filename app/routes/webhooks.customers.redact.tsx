/**
 * webhooks.customers.redact.tsx
 * GDPR: customers/redact
 *
 * When a merchant deletes a customer in Shopify, Shopify sends this webhook
 * requiring us to permanently delete all stored PII for that customer.
 *
 * We delete: Customer record (cascades to ActivityLogs via FK constraint).
 * Required: Must respond 200 within 5 seconds.
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { shop, payload } = await authenticate.webhook(request);

    const shopifyCustomerId = payload?.customer?.id
        ? String(payload.customer.id)
        : null;

    if (shopifyCustomerId) {
        // Find the store
        const store = await db.store.findUnique({ where: { shop } });

        if (store) {
            // Delete customer by their Shopify ID (our Customer.id stores the Shopify GID or numeric ID)
            // ActivityLogs cascade-delete automatically via FK ON DELETE CASCADE
            await db.customer.deleteMany({
                where: {
                    storeId: store.id,
                    id: shopifyCustomerId,
                },
            }).catch(() => {
                // Customer may not exist in our DB — that's fine, still 200
            });
        }
    }

    return new Response(null, { status: 200 });
};
