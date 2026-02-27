/**
 * app.roi.tsx
 * Feature: Revenue ROI Dashboard
 *
 * Calculates revenue attributed to each tag segment by:
 *   1. Getting all unique tag→customer mappings from local Customer records
 *   2. Summing totalSpent per tag
 *   3. Rendering a sorted DataTable with an inline CSS bar chart — zero new dependencies
 */
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { Page, Layout, Card, Text, BlockStack, InlineStack, DataTable, Box, Badge, Divider, Icon } from "@shopify/polaris";
import { MoneyIcon, ChartVerticalIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    if (!store) throw new Error("Store not found");

    // Fetch all customers with their spend and tags
    const customers = await db.customer.findMany({
        where: { storeId: store.id },
        select: { id: true, tags: true, totalSpent: true, orderCount: true }
    });

    // Build tag → aggregated metrics map
    const tagMetrics: Record<string, { revenue: number; customers: number; orders: number }> = {};

    for (const c of customers) {
        if (!c.tags) continue;
        const tags = c.tags.split(",").map(t => t.trim()).filter(Boolean);
        const uniqueTags = Array.from(new Set(tags));

        for (const tag of uniqueTags) {
            if (!tagMetrics[tag]) tagMetrics[tag] = { revenue: 0, customers: 0, orders: 0 };
            tagMetrics[tag].revenue += c.totalSpent;
            tagMetrics[tag].customers += 1;
            tagMetrics[tag].orders += c.orderCount;
        }
    }

    // Sort by revenue desc and find max for bar scaling
    const sorted = Object.entries(tagMetrics)
        .sort(([, a], [, b]) => b.revenue - a.revenue)
        .map(([tag, m]) => ({
            tag,
            revenue: parseFloat(m.revenue.toFixed(2)),
            customers: m.customers,
            orders: m.orders,
            avgOrderValue: m.orders > 0 ? parseFloat((m.revenue / m.orders).toFixed(2)) : 0
        }));

    const totalRevenue = customers.reduce((s, c) => s + c.totalSpent, 0);
    const maxTagRevenue = sorted[0]?.revenue ?? 1;

    return {
        segments: sorted,
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        totalCustomers: customers.length,
        maxTagRevenue,
        planName: store.planName
    };
};

export default function ROIDashboard() {
    const { segments, totalRevenue, totalCustomers, maxTagRevenue, planName } = useLoaderData<typeof loader>();

    const isFree = !planName || planName === "Free";

    const tableRows = segments.map(s => [
        <InlineStack key={s.tag} gap="200" blockAlign="center">
            <Text variant="bodyMd" fontWeight="bold" as="span">{s.tag}</Text>
        </InlineStack>,
        /* Revenue bar */
        <div key={`bar-${s.tag}`} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "120px", height: "8px", background: "#f0f0f0", borderRadius: "4px", overflow: "hidden" }}>
                <div style={{
                    width: `${Math.round((s.revenue / maxTagRevenue) * 100)}%`,
                    height: "100%",
                    background: "var(--p-color-bg-fill-magic)",
                    borderRadius: "4px"
                }} />
            </div>
            <Text variant="bodyMd" as="span">${s.revenue.toLocaleString()}</Text>
        </div>,
        s.customers.toLocaleString(),
        s.orders.toLocaleString(),
        `$${s.avgOrderValue.toLocaleString()}`,
        /* Revenue share */
        <Text key={`pct-${s.tag}`} variant="bodyMd" tone="success" as="span">
            {totalRevenue > 0 ? `${((s.revenue / totalRevenue) * 100).toFixed(1)}%` : "—"}
        </Text>
    ]);

    return (
        <Page
            title="Revenue ROI Dashboard"
            subtitle="See which customer segments drive the most revenue."
            backAction={{ content: "Dashboard", url: "/app" }}
        >
            <Layout>
                {isFree && (
                    <Layout.Section>
                        <Card>
                            <Text as="p" tone="subdued">Upgrade to Growth or higher to unlock revenue attribution analytics.</Text>
                        </Card>
                    </Layout.Section>
                )}

                {/* KPI Cards */}
                <Layout.Section>
                    <InlineStack gap="400" wrap={false}>
                        <div style={{ flex: 1 }}>
                            <Card>
                                <BlockStack gap="200">
                                    <InlineStack gap="200" blockAlign="center">
                                        <Icon source={MoneyIcon} tone="magic" />
                                        <Text variant="headingSm" as="h3" tone="subdued">Total Tracked Revenue</Text>
                                    </InlineStack>
                                    <Text variant="heading3xl" as="h2">${totalRevenue.toLocaleString()}</Text>
                                    <Text as="p" tone="subdued" variant="bodySm">Across {totalCustomers.toLocaleString()} synced customers</Text>
                                </BlockStack>
                            </Card>
                        </div>
                        <div style={{ flex: 1 }}>
                            <Card>
                                <BlockStack gap="200">
                                    <InlineStack gap="200" blockAlign="center">
                                        <Icon source={ChartVerticalIcon} tone="success" />
                                        <Text variant="headingSm" as="h3" tone="subdued">Top Revenue Segment</Text>
                                    </InlineStack>
                                    <Text variant="heading3xl" as="h2">{segments[0]?.tag ?? "—"}</Text>
                                    <Text as="p" tone="subdued" variant="bodySm">
                                        {segments[0] ? `$${segments[0].revenue.toLocaleString()} from ${segments[0].customers} customers` : "No data yet"}
                                    </Text>
                                </BlockStack>
                            </Card>
                        </div>
                        <div style={{ flex: 1 }}>
                            <Card>
                                <BlockStack gap="200">
                                    <InlineStack gap="200" blockAlign="center">
                                        {/* @ts-ignore */}
                                        <Badge tone="info">Segments</Badge>
                                    </InlineStack>
                                    <Text variant="heading3xl" as="h2">{segments.length}</Text>
                                    <Text as="p" tone="subdued" variant="bodySm">Unique tag segments tracked</Text>
                                </BlockStack>
                            </Card>
                        </div>
                    </InlineStack>
                </Layout.Section>

                {/* Segment Table */}
                <Layout.Section>
                    <Card padding="0">
                        <Box padding="400">
                            <Text variant="headingMd" as="h3">Revenue by Tag Segment</Text>
                        </Box>
                        <Divider />
                        {segments.length === 0 ? (
                            <Box padding="400">
                                <Text as="p" tone="subdued">No customer data available yet. Sync your customers to see revenue attribution.</Text>
                            </Box>
                        ) : (
                            <DataTable
                                columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "text"]}
                                headings={["Tag / Segment", "Revenue (w/ bar)", "Customers", "Orders", "Avg. Order Value", "Revenue Share"]}
                                rows={tableRows}
                                hasZebraStripingOnData
                                sortable={[false, false, true, true, true, false]}
                            />
                        )}
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
