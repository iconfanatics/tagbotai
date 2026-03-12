import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useNavigation, Form } from "react-router";
import {
    Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Button,
    Box, Banner, DataTable, Spinner, EmptyState
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";
import { enqueueSyncJob } from "../services/queue.server";
import { fetchAllOrders } from "../services/shopify-helpers.server";
import { evaluateOrderRules } from "../services/order-rules.server";

// ─── Action: Run the diagnostic scan ─────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    if (!store) return { error: "Store not found" };

    const activeRules = await db.rule.findMany({ where: { storeId: store.id, isActive: true } });
    const orderRules = activeRules.filter(r => {
        try { return JSON.parse(r.conditions).some((c: any) => c.ruleCategory === "order"); }
        catch { return false; }
    });

    if (orderRules.length === 0) return { error: "No active order rules found." };

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

        const evalResults = evaluateOrderRules(mappedOrder, customerData, orderRules, []);
        const orderTagResults = evalResults.filter((r: any) => r.targetEntity === "order");
        const newTags = orderTagResults.map((r: any) => r.tag).filter((t: string) => !existingTags.includes(t));
        const alreadyTagged = orderTagResults.map((r: any) => r.tag).filter((t: string) => existingTags.includes(t));

        results.push({
            orderId: o.id.split("/").pop(),
            name: o.name || `#${o.id.split("/").pop()}`,
            subtotal,
            existingTags,
            qualifies: orderTagResults.length > 0,
            newTags,
            alreadyTagged,
            status: orderTagResults.length === 0
                ? "no_match"
                : newTags.length > 0
                    ? "needs_tag"
                    : "already_tagged"
        });
    }

    const summary = {
        total: results.length,
        qualifies: results.filter(r => r.qualifies).length,
        needsTag: results.filter(r => r.status === "needs_tag").length,
        alreadyTagged: results.filter(r => r.status === "already_tagged").length,
        noMatch: results.filter(r => r.status === "no_match").length,
    };

    return { results, summary, orderRulesCount: orderRules.length };
};

// ─── Loader ───────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    if (!store) throw new Error("Store not found");

    const recentLogs = await db.activityLog.findMany({
        where: { storeId: store.id, action: "TAG_ADDED", reason: { contains: "[Order Sync]" } },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { rule: { select: { name: true, targetTag: true } } }
    });

    return { recentLogs };
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function SyncDebugPage() {
    const { recentLogs } = useLoaderData<typeof loader>();
    const actionData = useLoaderData<any>();
    const nav = useNavigation();
    const isScanning = nav.state === "submitting";

    // The action data comes from Form submission
    const scanResults = (actionData as any)?.results;
    const summary = (actionData as any)?.summary;
    const scanError = (actionData as any)?.error;

    const statusBadge = (status: string) => {
        if (status === "needs_tag") return <Badge tone="warning">Needs Tag</Badge>;
        if (status === "already_tagged") return <Badge tone="success">Already Tagged</Badge>;
        return <Badge>No Match</Badge>;
    };

    return (
        <Page
            title="Order Sync Diagnostics"
            subtitle="Scan all your Shopify orders against active order rules to see which qualify and why."
            backAction={{ url: "/app/rules", content: "Rules" }}
        >
            <Layout>
                {/* ── Scan trigger ── */}
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text as="h2" variant="headingMd">Run Diagnostic Scan</Text>
                            <Text as="p" variant="bodyMd" tone="subdued">
                                This will fetch every order from your Shopify store, evaluate it against your active order rules,
                                and show you exactly which ones qualify, which are already tagged, and which don't match.
                                No tags will be applied — this is read-only.
                            </Text>
                            <Form method="post">
                                <Button submit loading={isScanning} variant="primary" size="large">
                                    {isScanning ? "Scanning orders..." : "🔍 Run Diagnostic Scan"}
                                </Button>
                            </Form>
                        </BlockStack>
                    </Card>
                </Layout.Section>

                {/* ── Error ── */}
                {scanError && (
                    <Layout.Section>
                        <Banner tone="critical">{scanError}</Banner>
                    </Layout.Section>
                )}

                {/* ── Summary ── */}
                {summary && (
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="400">
                                <Text as="h2" variant="headingMd">Scan Summary</Text>
                                <InlineStack gap="600" wrap>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="headingXl">{summary.total}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">Total Orders</Text>
                                    </BlockStack>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="headingXl">{summary.qualifies}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">Qualify for Rule</Text>
                                    </BlockStack>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="headingXl">{summary.needsTag}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">Need Tagging Now</Text>
                                    </BlockStack>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="headingXl">{summary.alreadyTagged}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">Already Tagged ✓</Text>
                                    </BlockStack>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="headingXl">{summary.noMatch}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">Don't Qualify</Text>
                                    </BlockStack>
                                </InlineStack>
                                {summary.needsTag > 0 && (
                                    <Banner tone="warning">
                                        {summary.needsTag} orders need tagging. Go to <strong>Active Rules → Sync</strong> to apply them.
                                    </Banner>
                                )}
                                {summary.needsTag === 0 && summary.qualifies > 0 && (
                                    <Banner tone="success">
                                        All {summary.qualifies} qualifying orders are already tagged! ✅
                                    </Banner>
                                )}
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                )}

                {/* ── Per-order results ── */}
                {scanResults && scanResults.length > 0 && (
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="400">
                                <Text as="h2" variant="headingMd">Order Details</Text>
                                <DataTable
                                    columnContentTypes={["text", "numeric", "text", "text", "text"]}
                                    headings={["Order ID", "Subtotal (USD)", "Status", "Tag to Apply", "Already Has Tags"]}
                                    rows={scanResults.map((r: any) => [
                                        `#${r.orderId}`,
                                        `$${r.subtotal.toFixed(2)}`,
                                        statusBadge(r.status),
                                        r.newTags.join(", ") || "—",
                                        r.alreadyTagged.join(", ") || "—",
                                    ])}
                                />
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                )}

                {/* ── Recent sync log ── */}
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text as="h2" variant="headingMd">Recent Order Sync History</Text>
                            <Text as="p" variant="bodyMd" tone="subdued">Orders tagged by the sync engine (from ActivityLog).</Text>
                            {recentLogs.length === 0 ? (
                                <Box padding="400">
                                    <Text as="p" tone="subdued">No order sync activity recorded yet. Run a sync from Active Rules first.</Text>
                                </Box>
                            ) : (
                                <DataTable
                                    columnContentTypes={["text", "text", "text", "text"]}
                                    headings={["Customer", "Tag Applied", "Rule", "When"]}
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
