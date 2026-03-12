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

/**
 * Fetch ALL paid orders from the store directly (not per-customer).
 * This is the correct approach for order-based rules — it catches every order
 * including guest checkouts and orders from customers beyond the customer cap.
 *
 * @param admin       – Shopify admin API client
 * @param maxOrders   – Maximum number of orders to process (default 5000)
 */
export async function fetchAllOrders(admin: any, maxOrders = 5000): Promise<any[]> {
    const pageSize = 250; // Shopify max per page
    const allEdges: any[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage && allEdges.length < maxOrders) {
        const remaining = maxOrders - allEdges.length;
        const batchSize = Math.min(pageSize, remaining);

        try {
            const res = await admin.graphql(`#graphql
                query FetchAllOrders($first: Int!, $after: String) {
                    orders(first: $first, after: $after) {
                        edges {
                            node {
                                id
                                tags
                                createdAt
                                subtotalPriceSet { shopMoney { amount } }
                                totalDiscountsSet { shopMoney { amount } }
                                discountCodes
                                paymentGatewayNames
                                sourceIdentifier
                                channel { name }
                                shippingAddress { city countryCode }
                                customer {
                                    id
                                    email
                                    amountSpent { amount }
                                    numberOfOrders
                                    tags
                                }
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
                        pageInfo {
                            hasNextPage
                            endCursor
                        }
                    }
                }
            `, {
                variables: { first: batchSize, after: cursor }
            });

            const data: any = await res.json();

            if (data.errors) {
                console.error("[SHOPIFY_HELPERS] GraphQL Error fetching orders:", JSON.stringify(data.errors, null, 2));
                break;
            }

            const edges = data.data?.orders?.edges || [];
            const pageInfo = data.data?.orders?.pageInfo;

            allEdges.push(...edges);
            hasNextPage = pageInfo?.hasNextPage ?? false;
            cursor = pageInfo?.endCursor || null;

            if (edges.length === 0) hasNextPage = false;

            // Respect Shopify rate limits
            if (hasNextPage) await new Promise(r => setTimeout(r, 300));

        } catch (err: any) {
            console.error("[SHOPIFY_HELPERS] Network/Parse Error fetching orders:", err.message);
            break;
        }
    }

    console.log(`[SHOPIFY_HELPERS] Fetched ${allEdges.length} orders total`);
    return allEdges;
}

