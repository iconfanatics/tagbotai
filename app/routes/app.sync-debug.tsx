import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import {
    Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Button,
    Box, Banner, DataTable, Select, Divider
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";
import { fetchAllOrders } from "../services/shopify-helpers.server";
import { evaluateOrderRules } from "../services/order-rules.server";
import { useState } from "react";

// ─── Action: Run diagnostic scan for a specific tag ──────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const selectedTag = formData.get("selectedTag") as string;

    const store = await getCachedStore(session.shop);
    if (!store) return { error: "Store not found" };

    const activeRules = await db.rule.findMany({ where: { storeId: store.id, isActive: true } });
    const orderRules = activeRules.filter(r => {
        try { return JSON.parse(r.conditions).some((c: any) => c.ruleCategory === "order"); }
        catch { return false; }
    });

    // Filter to only the rule for the selected tag (if provided)
    const rulesToScan = selectedTag
        ? orderRules.filter(r => r.targetTag === selectedTag)
        : orderRules;

    if (rulesToScan.length === 0) return { error: `No active order rule found for tag: ${selectedTag || "(any)"}` };

    const allOrders = await fetchAllOrders(admin);
    const results: any[] = [];

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

        for (const rule of rulesToScan) {
            const allResults = evaluateOrderRules(mappedOrder, customerData, [rule], []);
            const matched = allResults.filter((r: any) => r.targetEntity === "order");
            const hasTag = existingTags.includes(rule.targetTag);
            const qualifies = matched.length > 0;

            let status: string;
            let skipReason = "";

            if (!qualifies) {
                status = "no_match";
                // Build human-readable reason
                try {
                    const conditions = JSON.parse(rule.conditions);
                    skipReason = conditions.map((c: any) => {
                        const actualVal = c.field === "order_subtotal" ? subtotal : "?";
                        return `${c.field} ${c.operator} ${c.value} (actual: ${actualVal})`;
                    }).join(" AND ");
                } catch { skipReason = "Could not parse conditions"; }
            } else if (hasTag) {
                status = "already_tagged";
            } else {
                status = "needs_tag";
            }

            results.push({
                orderId: o.id.split("/").pop(),
                orderGid: o.id,
                subtotal,
                existingTags,
                tag: rule.targetTag,
                ruleName: rule.name,
                qualifies,
                status,
                skipReason,
            });
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
            total: allOrders.length,
            qualifies: rows.filter(r => r.qualifies).length,
            needsTag: rows.filter(r => r.status === "needs_tag").length,
            alreadyTagged: rows.filter(r => r.status === "already_tagged").length,
            noMatch: rows.filter(r => r.status === "no_match").length,
        };
    }

    return { results, byTag, summaryByTag, totalOrders: allOrders.length };
};

// ─── Loader ───────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    if (!store) throw new Error("Store not found");

    const orderRules = await db.rule.findMany({
        where: { storeId: store.id, isActive: true },
    });
    const orderOnlyRules = orderRules.filter(r => {
        try { return JSON.parse(r.conditions).some((c: any) => c.ruleCategory === "order"); }
        catch { return false; }
    });

    const recentLogs = await db.activityLog.findMany({
        where: { storeId: store.id, action: "TAG_ADDED", reason: { contains: "[Order Sync]" } },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { rule: { select: { name: true, targetTag: true } } }
    });

    return { orderRules: orderOnlyRules, recentLogs };
};

// ─── Status badge helper ──────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
    if (status === "needs_tag") return <Badge tone="warning">Needs Tag</Badge>;
    if (status === "already_tagged") return <Badge tone="success">Already Tagged ✓</Badge>;
    return <Badge>No Match</Badge>;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SyncDebugPage() {
    const { orderRules, recentLogs } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const nav = useNavigation();
    const isScanning = nav.state === "submitting";

    const [selectedTag, setSelectedTag] = useState<string>("__all__");

    const tagOptions = [
        { label: "All Order Rules", value: "__all__" },
        ...orderRules.map(r => ({ label: `${r.targetTag}  (${r.name})`, value: r.targetTag }))
    ];

    const scanError = (actionData as any)?.error;
    const summaryByTag = (actionData as any)?.summaryByTag || {};
    const byTag = (actionData as any)?.byTag || {};
    const totalOrders = (actionData as any)?.totalOrders || 0;

    // Which tags to show after scan
    const tagsToShow = selectedTag === "__all__" ? Object.keys(byTag) : (byTag[selectedTag] ? [selectedTag] : []);

    return (
        <Page
            title="Sync Diagnostics"
            subtitle="Select a tag to scan all orders and see exactly which qualify, which are already tagged, and which don't match."
            backAction={{ url: "/app/rules", content: "Rules" }}
        >
            <Layout>
                {/* ── Scan form ── */}
                <Layout.Section>
                    <Card>
                        <Form method="post">
                            <BlockStack gap="400">
                                <Text as="h2" variant="headingMd">Diagnostic Scan</Text>
                                <Select
                                    label="Tag / Rule to scan"
                                    options={tagOptions}
                                    value={selectedTag}
                                    onChange={val => setSelectedTag(val)}
                                    name="selectedTag"
                                />
                                <input type="hidden" name="selectedTag" value={selectedTag === "__all__" ? "" : selectedTag} />
                                <InlineStack>
                                    <Button submit loading={isScanning} variant="primary">
                                        {isScanning ? "Scanning all orders…" : "🔍 Run Diagnostic Scan"}
                                    </Button>
                                </InlineStack>
                                <Text as="p" variant="bodySm" tone="subdued">
                                    Read-only — no tags will be applied. Fetches every order from Shopify and evaluates conditions.
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

                {/* ── Results per tag ── */}
                {tagsToShow.map(tag => {
                    const summary = summaryByTag[tag];
                    const rows: any[] = byTag[tag] || [];
                    return (
                        <Layout.Section key={tag}>
                            <Card>
                                <BlockStack gap="500">
                                    {/* Summary row */}
                                    <InlineStack align="space-between" blockAlign="center">
                                        <Text as="h2" variant="headingMd">Tag: <strong>{tag}</strong></Text>
                                        <Badge tone={summary.needsTag > 0 ? "warning" : "success"}>
                                            {summary.needsTag > 0 ? `${summary.needsTag} need tagging` : "All caught up ✓"}
                                        </Badge>
                                    </InlineStack>

                                    <InlineStack gap="600" wrap>
                                        {[
                                            { label: "Total Orders", val: totalOrders },
                                            { label: "Qualify for Rule", val: summary.qualifies },
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

                                    {summary.needsTag > 0 && (
                                        <Banner tone="warning">
                                            {summary.needsTag} order(s) qualify but don't have the tag yet. Go to <strong>Active Rules → Sync</strong> to apply them.
                                        </Banner>
                                    )}
                                    {summary.needsTag === 0 && summary.qualifies > 0 && (
                                        <Banner tone="success">All {summary.qualifies} qualifying orders already have this tag! ✅</Banner>
                                    )}

                                    <Divider />

                                    {/* Per-order table */}
                                    <DataTable
                                        columnContentTypes={["text", "numeric", "text", "text"]}
                                        headings={["Order #", "Subtotal (USD)", "Status", "Notes"]}
                                        rows={rows.map((r: any) => [
                                            `#${r.orderId}`,
                                            `$${r.subtotal.toFixed(2)}`,
                                            <StatusBadge status={r.status} key={r.orderId} />,
                                            r.status === "no_match"
                                                ? `Didn't match: ${r.skipReason}`
                                                : r.status === "already_tagged"
                                                    ? `Has tags: ${r.existingTags.join(", ")}`
                                                    : `Will be tagged: ${r.tag}`
                                        ])}
                                    />
                                </BlockStack>
                            </Card>
                        </Layout.Section>
                    );
                })}

                {/* ── Recent sync log ── */}
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text as="h2" variant="headingMd">Recent Order Sync History</Text>
                            {recentLogs.length === 0 ? (
                                <Box padding="400">
                                    <Text as="p" tone="subdued">No order sync activity yet. Run a sync from Active Rules first.</Text>
                                </Box>
                            ) : (
                                <DataTable
                                    columnContentTypes={["text", "text", "text", "text"]}
                                    headings={["Order Owner (Customer ID)", "Tag Applied", "Rule", "When"]}
                                    rows={recentLogs.map((log: any) => [
                                        log.customerId,
                                        log.tagContext,
                                        log.rule?.name || "—",
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
