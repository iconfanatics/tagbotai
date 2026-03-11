import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";

/**
 * CSV Export Route
 * Authenticates via the standard Shopify session (same as every other app route).
 * The shop is derived from the session — never from a query param — so it works
 * reliably inside the Shopify Admin iframe.
 *
 * Query params:
 *   tag    — export all customers/orders with this exact tag
 *   ruleId — export customers/orders whose tags include the rule's targetTag
 *   entity — "customer" (default) or "order"
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
    // Standard Shopify auth — same as every other route in the app
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const store = await getCachedStore(shop);
    if (!store) {
        return new Response("Store not found.", { status: 404 });
    }

    // Plan fencing
    const plan = (store.planName || "").toLowerCase();
    if (!plan.includes("pro") && !plan.includes("elite")) {
        return new Response("Please upgrade to Pro or Elite to access CSV exports.", { status: 403 });
    }

    const url = new URL(request.url);
    const tag = url.searchParams.get("tag");
    const ruleId = url.searchParams.get("ruleId");

    // Build query
    let targetTag = tag;
    let targetEntity = url.searchParams.get("entity") || "customer";

    if (ruleId) {
        const rule = await db.rule.findUnique({
            where: { id: ruleId },
            select: { targetTag: true, targetEntity: true }
        });
        if (rule?.targetTag) {
            targetTag = rule.targetTag;
            targetEntity = rule.targetEntity;
        } else {
            return new Response("Rule not found or has no target tag.", { status: 404 });
        }
    }

    if (!targetTag) {
        return new Response("No tag or ruleId provided.", { status: 400 });
    }

    const escapeCSV = (val: any) => {
        if (val === null || val === undefined) return '""';
        const str = String(val);
        if (str.includes('"') || str.includes(',') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    let csvContent = "";

    if (targetEntity === "order") {
        // =============== EXPORT ORDERS (Directly from Shopify via GraphQL) =============== 
        // We do not store order history in our DB, so we must fetch it natively.
        const { admin } = await authenticate.admin(request);
        let hasNextPage = true;
        let cursor: string | null = null;
        let allOrders: any[] = [];

        // Max out at 5000 records to prevent extreme API timeouts on exports
        const MAX_ORDERS = 5000;

        while (hasNextPage && allOrders.length < MAX_ORDERS) {
            const query = `
                query FetchOrdersByTag($query: String!, $cursor: String) {
                    orders(first: 50, query: $query, after: $cursor) {
                        pageInfo {
                            hasNextPage
                            endCursor
                        }
                        edges {
                            node {
                                id
                                name
                                email
                                createdAt
                                fullyPaid
                                subtotalPriceSet { shopMoney { amount } }
                                customer { firstName lastName }
                                tags
                            }
                        }
                    }
                }
            `;
            
            const variables = {
                query: `tag:'${targetTag}'`,
                cursor: cursor
            };

            const response = await admin.graphql(query, { variables });
            const data: any = await response.json();

            if (!data.data?.orders) {
                break;
            }

            const orders = data.data.orders.edges.map((e: any) => e.node);
            allOrders = allOrders.concat(orders);

            hasNextPage = data.data.orders.pageInfo.hasNextPage;
            cursor = data.data.orders.pageInfo.endCursor;
            
            // Artificial delay to play nice with Shopify's GraphQL cost limiter
            if (hasNextPage) await new Promise(r => setTimeout(r, 500));
        }

        const headers = ["Order ID", "Order Name", "Customer Name", "Email", "Date", "Subtotal ($)", "Fully Paid", "Tags"];
        const rows = allOrders.map(o => {
            const customerName = o.customer ? `${o.customer.firstName || ""} ${o.customer.lastName || ""}` : "";
            return [
                o.id.split("/").pop(),
                o.name,
                customerName.trim(),
                o.email || "",
                new Date(o.createdAt).toLocaleString(),
                o.subtotalPriceSet?.shopMoney?.amount || "0",
                o.fullyPaid ? "Yes" : "No",
                o.tags.join(", ")
            ].map(escapeCSV).join(",");
        });

        const bom = "\uFEFF"; // UTF-8 BOM
        csvContent = bom + [headers.join(","), ...rows].join("\n");

    } else {
        // =============== EXPORT CUSTOMERS (From Local DB Cache) =============== 
        const customers = await db.customer.findMany({
            where: { storeId: store.id, tags: { contains: targetTag } },
            orderBy: { totalSpent: "desc" }
        });

        const headers = ["Shopify ID", "Email", "First Name", "Last Name", "Total Spent ($)", "Order Count", "Tags"];
        const rows = customers.map(c =>
            [c.id, c.email, c.firstName, c.lastName, c.totalSpent, c.orderCount, c.tags]
                .map(escapeCSV).join(",")
        );

        const bom = "\uFEFF"; // UTF-8 BOM
        csvContent = bom + [headers.join(","), ...rows].join("\n");
    }

    let filename = "smart-segments-export";
    if (tag) filename = `segment-tag-${tag}`;
    if (ruleId) filename = `segment-rule-${ruleId}`;
    const dateStr = new Date().toISOString().split("T")[0];

    return new Response(csvContent, {
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}-${dateStr}.csv"`
        }
    });
};
