/**
 * webhooks.customers.data_request.tsx
 * GDPR: customers/data_request
 *
 * When a merchant's customer requests their personal data, Shopify sends this
 * webhook. We must log the request. Since we store minimal PII (email, name,
 * orderCount, totalSpent), we acknowledge it here.
 *
 * Required: Must respond 200 within 5 seconds.
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { shop, payload } = await authenticate.webhook(request);

    const customerId = payload?.customer?.id
        ? String(payload.customer.id)
        : null;

    const shopifyCustomerId = payload?.customer?.id;

    if (customerId && shopifyCustomerId) {
        // Look up the store to find our internal storeId
        const store = await db.store.findUnique({ where: { shop } });

        if (store) {
            // Log the data request in ActivityLog for audit trail
            await db.activityLog.create({
                data: {
                    storeId: store.id,
                    customerId: customerId,
                    action: "GDPR_DATA_REQUEST",
                    tagContext: "gdpr",
                    reason: `Customer data request received for Shopify customer ID: ${shopifyCustomerId}`,
                },
            }).catch(() => {
                // Customer may not exist in our DB yet — that's fine, still 200
            });
        }
    }

    // Per Shopify GDPR requirements: respond 200 immediately.
    // The actual data export (if your app sends data to the customer) 
    // must be handled out-of-band within 30 days of the request.
    return new Response(null, { status: 200 });
};
