/**
 * POST /app/cleanup-process
 *
 * Processes ONE customer's tag update synchronously and returns.
 * Called repeatedly by the client in a loop — one call per customer.
 * This pattern works within Vercel's 10-second serverless timeout.
 */
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;

    const formData = await request.formData();
    const shopifyCustomerId = formData.get("shopifyCustomerId") as string; // "gid://shopify/Customer/123"
    const tagsToAdd: string[] = JSON.parse(formData.get("tagsToAdd") as string || "[]");
    const tagsToRemove: string[] = JSON.parse(formData.get("tagsToRemove") as string || "[]");
    const storeId = formData.get("storeId") as string;
    const completedSoFar = parseInt(formData.get("completedSoFar") as string || "0");
    const totalTarget = parseInt(formData.get("totalTarget") as string || "1");

    if (!shopifyCustomerId || !storeId) {
        return data({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    try {
        // Build the Shopify GraphQL tag mutation
        const currentTagsRaw = await admin.graphql(`
            #graphql
            query GetCustomerTags($id: ID!) {
                customer(id: $id) {
                    tags
                }
            }
        `, { variables: { id: shopifyCustomerId } });

        const currentData = await currentTagsRaw.json();
        const currentTags: string[] = currentData.data?.customer?.tags || [];

        // Apply removals and additions
        let newTags = currentTags.filter(t => !tagsToRemove.includes(t));
        for (const tag of tagsToAdd) {
            if (!newTags.includes(tag)) newTags.push(tag);
        }

        // Push updated tags to Shopify
        await admin.graphql(`
            #graphql
            mutation UpdateCustomerTags($input: CustomerInput!) {
                customerUpdate(input: $input) {
                    customer { id tags }
                    userErrors { field message }
                }
            }
        `, { variables: { input: { id: shopifyCustomerId, tags: newTags } } });

        // Update our local DB cache
        const localId = shopifyCustomerId.split('/').pop()!;
        await db.customer.update({
            where: { id_storeId: { id: localId, storeId } },
            data: { tags: newTags.join(",") }
        });

        // Update progress in DB
        const newCompleted = completedSoFar + 1;
        const isDone = newCompleted >= totalTarget;

        await db.store.update({
            where: { id: storeId },
            data: {
                syncCompleted: newCompleted,
                ...(isDone ? { isSyncing: false, syncMessage: null } : {})
            }
        });

        return data({ success: true, completed: newCompleted, isDone });
    } catch (err: any) {
        console.error("[CLEANUP_PROCESS] Error:", err.message);

        // On error, reset the sync state
        try {
            await db.store.update({
                where: { id: storeId },
                data: { isSyncing: false, syncMessage: null }
            });
        } catch (e) { }

        return data({ success: false, error: err.message }, { status: 500 });
    }
};
