import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    // Basic Auth Check
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");

    if (!shop) {
        return new Response("Missing shop parameter.", { status: 400 });
    }

    const store = await db.store.findUnique({ where: { shop: shop as string } });
    if (!store) {
        return new Response("Store not found.", { status: 404 });
    }

    // Plan Fencing
    const plan = store.planName.toLowerCase();
    if (!plan.includes("pro") && !plan.includes("elite")) {
        return new Response("Unauthorized. Please upgrade to Pro or Elite to access CSV exports.", { status: 403 });
    }

    const tag = url.searchParams.get("tag");
    const ruleId = url.searchParams.get("ruleId");

    // Fetch Target Data securely filtered by storeId
    let queryArgs: any = { where: { storeId: store.id }, orderBy: { totalSpent: "desc" } };

    if (tag) {
        queryArgs.where.tags = { contains: tag };
    } else if (ruleId) {
        // Query the rule to find its target tag, then export all customers with that tag
        const rule = await db.rule.findUnique({
            where: { id: ruleId as string },
            select: { targetTag: true }
        });

        if (rule && rule.targetTag) {
            queryArgs.where.tags = { contains: rule.targetTag };
        } else {
            return new Response("Rule not found or lacks a target tag.", { status: 404 });
        }
    }

    const customers = await db.customer.findMany(queryArgs);

    // Build standard CSV
    // ID, Email, First Name, Last Name, Total Spent, Order Count, Tags
    const headers = ["Shopify ID", "Email", "First Name", "Last Name", "Total Spent", "Orders", "Tags"];

    // We escape commas and quotes according to RFC 4180
    const escapeCSV = (val: any) => {
        if (val === null || val === undefined) return '""';
        const str = String(val);
        // If the string contains quotes, commas, or newlines, wrap in quotes and escape inner quotes
        if (str.includes('"') || str.includes(',') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const rows = customers.map(c => [
        c.id,
        c.email,
        c.firstName,
        c.lastName,
        c.totalSpent,
        c.orderCount,
        c.tags
    ].map(escapeCSV).join(","));

    const csvContent = [headers.join(","), ...rows].join("\n");

    let filename = "smart-segments-export";
    if (tag) filename = `segment-tag-${tag}`;
    if (ruleId) filename = `segment-rule-${ruleId}`;

    // Serve as file attachment
    return new Response(csvContent, {
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}-${new Date().toISOString().split("T")[0]}.csv"`
        }
    });
};
