import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import {
    Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Button,
    Box, Banner, DataTable, Select, Divider
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";
import { fetchAllOrders, fetchAllCustomers } from "../services/shopify-helpers.server";
import { evaluateOrderRules } from "../services/order-rules.server";
import { calculateCustomerTags } from "../services/rule.server";
import { useState } from "react";

// ─── Action: Run diagnostic scan ──────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const selectedId = formData.get("selectedId") as string;

    const store = await getCachedStore(session.shop);
    if (!store) return { error: "Store not found" };

    const activeRules = await db.rule.findMany({ where: { storeId: store.id, isActive: true } });

    // Separate order rules from customer rules
    const orderRules = activeRules.filter(r => {
        try { return JSON.parse(r.conditions).some((c: any) => c.ruleCategory === "order"); }
        catch { return false; }
    });
    const customerRules = activeRules.filter(r => !orderRules.some(or => or.id === r.id));

    let rulesToScanOrder: any[] = [];
    let rulesToScanCustomer: any[] = [];

    if (selectedId === "__all_orders__") rulesToScanOrder = orderRules;
    else if (selectedId === "__all_customers__") rulesToScanCustomer = customerRules;
    else {
        const r = activeRules.find(x => x.id === selectedId);
        if (r) {
            if (orderRules.some(or => or.id === r.id)) rulesToScanOrder.push(r);
            else rulesToScanCustomer.push(r);
        }
    }

    if (rulesToScanOrder.length === 0 && rulesToScanCustomer.length === 0) {
        return { error: `No active rules found for selection.` };
    }

    const results: any[] = [];
    let totalItems = 0;

    // --- Order Rules Evaluation ---
    if (rulesToScanOrder.length > 0) {
        const allOrders = await fetchAllOrders(admin);
        totalItems += allOrders.length;

        for (const edge of allOrders) {
            const o = edge.node;
            const subtotal = parseFloat(o.subtotalPriceSet?.shopMoney?.amount || "0");
            const existingTags: string[] = o.tags || [];

            const mappedOrder = {
                subtotal_price: String(subtotal),
                total_discounts: o.totalDiscountsSet?.shopMoney?.amount || "0",
                discount_codes: o.discountCodes ? o.discountCodes.map((c: string) => ({ code: c })) : [],
                payment_gateway_names: o.paymentGatewayNames || [],
                source_name: o.channel?.name || o.sourceIdentifier || "",
                referring_site: "", landing_site: "",
                shipping_address: { city: o.shippingAddress?.city, country_code: o.shippingAddress?.countryCode },
                tags: existingTags,
                line_items: (o.lineItems?.edges || []).map((le: any) => ({
                    quantity: le.node.quantity,
                    properties: le.node.customAttributes?.map((ca: any) => ({ name: ca.key, value: ca.value })) || []
                }))
            };

            const customerData = {
                id: o.customer?.id?.split("/").pop() || "guest",
                totalSpent: parseFloat(o.customer?.amountSpent?.amount || "0"),
                orderCount: parseInt(o.customer?.numberOfOrders || "0"),
                tags: (o.customer?.tags || []).join(", "),
            };

            for (const rule of rulesToScanOrder) {
                const hasTag = existingTags.includes(rule.targetTag);

                if (hasTag) {
                    results.push({
                        type: "order", id: o.id.split("/").pop(), itemContext: `Subtotal: $${subtotal.toFixed(2)}`,
                        existingTags, tag: rule.targetTag, ruleName: rule.name, qualifies: true, status: "already_tagged", skipReason: ""
                    });
                    continue;
                }

                const mappedOrderForEval = { ...mappedOrder, tags: [] };
                const matched = evaluateOrderRules(mappedOrderForEval, customerData, [rule], []).filter((r: any) => r.targetEntity === "order");
                const qualifies = matched.length > 0;

                let status: string = qualifies ? "needs_tag" : "no_match";
                let skipReason = "";

                if (!qualifies) {
                    try {
                        const conditions = JSON.parse(rule.conditions);
                        const actualValues: Record<string, any> = {
                            order_subtotal: subtotal,
                            payment_method: Array.isArray(o.paymentGatewayNames) ? o.paymentGatewayNames.join(", ") || "(none)" : "(none)",
                            order_source: o.channel?.name || o.sourceIdentifier || "(none)",
                            shipping_city: o.shippingAddress?.city || "(none)",
                            shipping_country: o.shippingAddress?.countryCode || "(none)",
                            discount_code_used: (o.discountCodes && o.discountCodes.length > 0) ? "true" : "false",
                        };
                        skipReason = conditions.filter((c: any) => c.ruleCategory === "order").map((c: any) => `${c.field} ${c.operator} "${c.value}" (actual: "${actualValues[c.field] ?? "?"}")`).join(" AND ");
                    } catch { skipReason = "Could not parse conditions"; }
                }

                results.push({ type: "order", id: o.id.split("/").pop(), itemContext: `Subtotal: $${subtotal.toFixed(2)}`, existingTags, tag: rule.targetTag, ruleName: rule.name, qualifies, status, skipReason });
            }
        }
    }

    // --- Customer Rules Evaluation ---
    if (rulesToScanCustomer.length > 0) {
        const isFree = store.planName === "" || store.planName.toLowerCase() === "free plan" || store.planName === "Free";
        const allCustomers = await fetchAllCustomers(admin, isFree);
        totalItems += allCustomers.length;

        for (const edge of allCustomers) {
            const c = edge.node;
            const existingTags: string[] = c.tags ? c.tags.split(",").map((t: string) => t.trim()) : [];

            // Mock prisma customer shape expected by evaluateRule
            const customerMock: any = {
                id: c.id.split("/").pop(), storeId: store.id, shop: session.shop, tags: c.tags || "", firstName: c.firstName, lastName: c.lastName, email: c.email,
                totalSpent: parseFloat(c.amountSpent?.amount || "0"),
                orderCount: parseInt(c.numberOfOrders || "0"),
                lastOrderDate: new Date(), // Shopify Customers api doesn't directly expose last_order_date without orders nested
                createdAt: new Date(), updatedAt: new Date()
            };

            for (const rule of rulesToScanCustomer) {
                const hasTag = existingTags.includes(rule.targetTag);

                if (hasTag) {
                    results.push({
                        type: "customer", id: customerMock.id, itemContext: `Spent: $${customerMock.totalSpent} (${customerMock.orderCount} ord)`,
                        existingTags, tag: rule.targetTag, ruleName: rule.name, qualifies: true, status: "already_tagged", skipReason: ""
                    });
                    continue;
                }

                // Call the actual calculation logic
                const tagsData = await calculateCustomerTags(customerMock, [rule]);
                const qualifies = tagsData.tagsToAdd.some(t => t.tag === rule.targetTag);

                let status: string = qualifies ? "needs_tag" : "no_match";
                let skipReason = "";

                if (!qualifies) {
                    try {
                        const conditions = JSON.parse(rule.conditions);
                        const actualValues: Record<string, any> = {
                            totalSpent: customerMock.totalSpent,
                            orderCount: customerMock.orderCount,
                            lastOrderDate: "Skipped (API limitation)",
                        };
                        skipReason = conditions.map((c: any) => `${c.field} ${c.operator} "${c.value}" (actual: "${actualValues[c.field] ?? "?"}")`).join(" AND ");
                    } catch { skipReason = "Could not parse conditions"; }
                }

                results.push({ type: "customer", id: customerMock.id, itemContext: `Spent: $${customerMock.totalSpent} (${customerMock.orderCount} ord)`, existingTags, tag: rule.targetTag, ruleName: rule.name, qualifies, status, skipReason });
            }
        }
    }

    const byTag: Record<string, any[]> = {};
    for (const r of results) {
        if (!byTag[r.tag]) byTag[r.tag] = [];
        byTag[r.tag].push(r);
    }

    const summaryByTag: Record<string, any> = {};
    for (const [tag, rows] of Object.entries(byTag)) {
        summaryByTag[tag] = {
            total: rows.length, // Total items evaluated for this tag
            qualifies: rows.filter(r => r.qualifies).length,
            needsTag: rows.filter(r => r.status === "needs_tag").length,
            alreadyTagged: rows.filter(r => r.status === "already_tagged").length,
            noMatch: rows.filter(r => r.status === "no_match").length,
            type: rows[0]?.type || "unknown"
        };
    }

    return { results, byTag, summaryByTag, totalItems };
};

// ─── Loader ───────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    if (!store) throw new Error("Store not found");

    const activeRules = await db.rule.findMany({
        where: { storeId: store.id, isActive: true },
    });

    const recentLogs = await db.activityLog.findMany({
        where: { storeId: store.id, action: "TAG_ADDED" },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { rule: { select: { name: true, targetTag: true } } }
    });

    return { activeRules, recentLogs };
};

// ─── Status badge helper ──────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
    if (status === "needs_tag") return <Badge tone="warning">Needs Tag</Badge>;
    if (status === "already_tagged") return <Badge tone="success">Already Tagged ✓</Badge>;
    return <Badge>No Match</Badge>;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SyncDebugPage() {
    const { activeRules, recentLogs } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const nav = useNavigation();
    const isScanning = nav.state === "submitting";

    const [selectedId, setSelectedId] = useState<string>("__all_orders__");

    const orderRules = activeRules.filter(r => {
        try { return JSON.parse(r.conditions).some((c: any) => c.ruleCategory === "order"); } catch { return false; }
    });
    const customerRules = activeRules.filter(r => !orderRules.some(or => or.id === r.id));

    const tagOptions = [
        { label: "ALL Order Rules (Scan Orders)", value: "__all_orders__" },
        { label: "ALL Customer Rules (Scan Customers)", value: "__all_customers__" },
        { label: "--- ORDER RULES ---", value: "x_order", disabled: true },
        ...orderRules.map(r => ({ label: `[Order] ${r.name} -> ${r.targetTag}`, value: r.id })),
        { label: "--- CUSTOMER RULES ---", value: "x_customer", disabled: true },
        ...customerRules.map(r => ({ label: `[Customer] ${r.name} -> ${r.targetTag}`, value: r.id }))
    ];

    const scanError = (actionData as any)?.error;
    const summaryByTag = (actionData as any)?.summaryByTag || {};
    const byTag = (actionData as any)?.byTag || {};

    const tagsToShow = Object.keys(byTag);

    return (
        <Page
            title="Sync Diagnostics"
            subtitle="Scan customers or orders explicitly to see exactly which ones match your active rules."
            backAction={{ url: "/app/rules", content: "Rules" }}
        >
            <Layout>
                <Layout.Section>
                    <Card>
                        <Form method="post">
                            <BlockStack gap="400">
                                <Text as="h2" variant="headingMd">Diagnostic Scan</Text>
                                <Select
                                    label="Rule to Scan"
                                    options={tagOptions}
                                    value={selectedId}
                                    onChange={val => setSelectedId(val)}
                                    name="selectedId"
                                />
                                <InlineStack>
                                    <Button submit loading={isScanning} variant="primary">
                                        {isScanning ? "Scanning Database…" : "🔍 Run Diagnostic Scan"}
                                    </Button>
                                </InlineStack>
                                <Text as="p" variant="bodySm" tone="subdued">
                                    Read-only. Scans either Customers (Total Spent, etc) or Orders (City, Subtotal, COD) depending on rule type.
                                </Text>
                            </BlockStack>
                        </Form>
                    </Card>
                </Layout.Section>

                {scanError && (
                    <Layout.Section>
                        <Banner tone="critical">{scanError}</Banner>
                    </Layout.Section>
                )}

                {tagsToShow.map(tag => {
                    const summary = summaryByTag[tag];
                    const rows: any[] = byTag[tag] || [];
                    const isGroupCustomer = summary.type === "customer";
                    
                    return (
                        <Layout.Section key={tag}>
                            <Card>
                                <BlockStack gap="500">
                                    <InlineStack align="space-between" blockAlign="center">
                                        <Text as="h2" variant="headingMd">Result for: <strong>{tag}</strong></Text>
                                        <Badge tone={summary.needsTag > 0 ? "warning" : "success"}>
                                            {summary.needsTag > 0 ? `${summary.needsTag} missing` : "Perfect ✓"}
                                        </Badge>
                                    </InlineStack>

                                    <InlineStack gap="600" wrap>
                                        {[
                                            { label: `Total ${isGroupCustomer ? "Customers" : "Orders"}`, val: summary.total },
                                            { label: "Matched Rule", val: summary.qualifies },
                                            { label: "Need Tag NOW", val: summary.needsTag },
                                            { label: "Already Tagged", val: summary.alreadyTagged },
                                            { label: "Don't Qualify", val: summary.noMatch },
                                        ].map(({ label, val }) => (
                                            <BlockStack gap="100" key={label}>
                                                <Text as="p" variant="headingLg">{val}</Text>
                                                <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
                                            </BlockStack>
                                        ))}
                                    </InlineStack>

                                    <Divider />

                                    <DataTable
                                        columnContentTypes={["text", "text", "text", "text"]}
                                        headings={[`${isGroupCustomer ? "Customer" : "Order"} ID`, isGroupCustomer ? "Metrics" : "Subtotal", "Status", "Insight"]}
                                        rows={rows.slice(0, 100).map((r: any) => [
                                            `#${r.id}`,
                                            r.itemContext,
                                            <StatusBadge status={r.status} key={r.id} />,
                                            r.status === "no_match" ? r.skipReason : r.status === "already_tagged" ? `Tags: ${r.existingTags.join(", ")}` : `Will be tagged ${r.tag}`
                                        ])}
                                    />
                                    {rows.length > 100 && (
                                        <Text as="p" tone="subdued" alignment="center">Showing first 100 results.</Text>
                                    )}
                                </BlockStack>
                            </Card>
                        </Layout.Section>
                    );
                })}

                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text as="h2" variant="headingMd">Recent Log Activity</Text>
                            {recentLogs.length === 0 ? (
                                <Text as="p" tone="subdued">No recent activity.</Text>
                            ) : (
                                <DataTable
                                    columnContentTypes={["text", "text", "text", "text"]}
                                    headings={["Customer", "Action", "Rule", "When"]}
                                    rows={recentLogs.map((log: any) => [
                                        `Cus #${log.customerId}`,
                                        `${log.action} ${log.tagContext}`,
                                        log.rule?.name || log.reason,
                                        new Date(log.createdAt).toLocaleString(),
                                    ])}
                                />
                            )}
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
