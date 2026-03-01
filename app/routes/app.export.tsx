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
 *   tag    — export all customers with this exact tag
 *   ruleId — export customers whose tags include the rule's targetTag
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
    let queryArgs: any = { where: { storeId: store.id }, orderBy: { totalSpent: "desc" } };

    if (tag) {
        queryArgs.where.tags = { contains: tag };
    } else if (ruleId) {
        const rule = await db.rule.findUnique({
            where: { id: ruleId },
            select: { targetTag: true }
        });
        if (rule?.targetTag) {
            queryArgs.where.tags = { contains: rule.targetTag };
        } else {
            return new Response("Rule not found or has no target tag.", { status: 404 });
        }
    }

    const customers = await db.customer.findMany(queryArgs);

    const escapeCSV = (val: any) => {
        if (val === null || val === undefined) return '""';
        const str = String(val);
        if (str.includes('"') || str.includes(',') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const headers = ["Shopify ID", "Email", "First Name", "Last Name", "Total Spent ($)", "Order Count", "Tags"];
    const rows = customers.map(c =>
        [c.id, c.email, c.firstName, c.lastName, c.totalSpent, c.orderCount, c.tags]
            .map(escapeCSV).join(",")
    );

    const csvContent = [headers.join(","), ...rows].join("\n");

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
