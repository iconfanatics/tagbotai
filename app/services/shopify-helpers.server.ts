/**
 * shopify-helpers.server.ts
 * 
 * Shared Shopify GraphQL helpers used by the dashboard sync,
 * rule-creation auto-sync, and any other place that needs
 * ALL customers from a store (not just the first page).
 */

/**
 * Fetch ALL customers from Shopify using cursor-based pagination.
 * Free plans are capped at 50 total; paid plans fetch everything.
 * 
 * @param admin   – Shopify admin API client
 * @param isFree  – whether the store is on the free plan (caps at 50)
 * @returns        array of customer edge objects ready for enqueueSyncJob
 */
export async function fetchAllCustomers(admin: any, isFree: boolean) {
    const pageSize = 250;  // Shopify max per page
    const hardCap = isFree ? 50 : 10000;  // Safety limit
    const allEdges: any[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage && allEdges.length < hardCap) {
        const remaining = hardCap - allEdges.length;
        const batchSize = Math.min(pageSize, remaining);

        try {
            const res = await admin.graphql(`#graphql
                query fetchCustomers($first: Int!, $after: String) {
                    customers(first: $first, after: $after) {
                        edges {
                            cursor
                            node {
                                id
                                email
                                firstName
                                lastName
                                amountSpent { amount }
                                numberOfOrders
                                tags
                            }
                        }
                        pageInfo {
                            hasNextPage
                            endCursor
                        }
                    }
                }
            `, {
                variables: {
                    first: batchSize,
                    after: cursor
                }
            });

            const data: any = await res.json();
            
            if (data.errors) {
                console.error("[SHOPIFY_HELPERS] GraphQL Error:", JSON.stringify(data.errors, null, 2));
                break;
            }

            const edges = data.data?.customers?.edges || [];
            const pageInfo = data.data?.customers?.pageInfo;

            allEdges.push(...edges);

            hasNextPage = pageInfo?.hasNextPage ?? false;
            cursor = pageInfo?.endCursor || null;

            if (edges.length === 0) hasNextPage = false;

        } catch (err: any) {
            console.error("[SHOPIFY_HELPERS] Network/Parse Error fetching customers:", err.message);
            break;
        }
    }

    console.log(`[SHOPIFY_HELPERS] Fetched ${allEdges.length} customers (isFree=${isFree})`);
    return allEdges;
}
