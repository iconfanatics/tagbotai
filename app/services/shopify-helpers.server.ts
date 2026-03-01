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
        const remaining: number = hardCap - allEdges.length;
        const batchSize: number = Math.min(pageSize, remaining);

        const afterClause: string = cursor ? `, after: "${cursor}"` : "";

        const res: any = await admin.graphql(`#graphql
            query fetchCustomers {
                customers(first: ${batchSize}${afterClause}) {
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
                    }
                }
            }
        `);

        const data: any = await res.json();
        const edges: any[] = data.data?.customers?.edges || [];
        const pageInfo: any = data.data?.customers?.pageInfo;

        allEdges.push(...edges);

        hasNextPage = pageInfo?.hasNextPage ?? false;
        if (edges.length > 0) {
            cursor = edges[edges.length - 1].cursor;
        } else {
            hasNextPage = false;
        }
    }

    console.log(`[SHOPIFY_HELPERS] Fetched ${allEdges.length} customers (isFree=${isFree})`);
    return allEdges;
}
