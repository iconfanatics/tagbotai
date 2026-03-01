/**
 * app.roi.tsx — Revenue ROI Dashboard
 *
 * Shows revenue attributed to each tag segment using:
 *  - KPI cards (total revenue, top segment, segment count, avg order value)
 *  - Recharts bar chart (revenue by tag)
 *  - Recharts donut chart (revenue share %)
 *  - Sortable DataTable with all segment details
 */
import React from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import {
    Page, Layout, Card, Text, BlockStack, InlineStack, DataTable,
    Box, Badge, Divider, Icon, Grid, Spinner, Banner, Button
} from "@shopify/polaris";
import { MoneyIcon, ChartVerticalIcon, HashtagIcon, OrderIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";

const DashboardChart = React.lazy(() => import("../components/DashboardChart"));

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    if (!store) throw new Error("Store not found");

    const customers = await db.customer.findMany({
        where: { storeId: store.id },
        select: { id: true, tags: true, totalSpent: true, orderCount: true }
    });

    // Build tag → aggregated metrics
    const tagMetrics: Record<string, { revenue: number; customers: number; orders: number }> = {};
    for (const c of customers) {
        if (!c.tags) continue;
        const tags = [...new Set(c.tags.split(",").map(t => t.trim()).filter(Boolean))];
        for (const tag of tags) {
            if (!tagMetrics[tag]) tagMetrics[tag] = { revenue: 0, customers: 0, orders: 0 };
            tagMetrics[tag].revenue += c.totalSpent;
            tagMetrics[tag].customers += 1;
            tagMetrics[tag].orders += c.orderCount;
        }
    }

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
    const totalOrders = customers.reduce((s, c) => s + c.orderCount, 0);

    return {
        segments: sorted,
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        totalCustomers: customers.length,
        totalOrders,
        planName: store.planName
    };
};

// ─── Colors ───────────────────────────────────────────────────────────────────

const CHART_COLORS = ["#818cf8", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#38bdf8", "#fb923c", "#4ade80", "#f472b6", "#22d3ee"];

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon, tone, bg }: {
    label: string; value: string; sub?: string; icon: any;
    tone?: "base" | "magic" | "critical" | "success"; bg?: string;
}) {
    return (
        <Card roundedAbove="sm" background={bg as any}>
            <Box padding="400">
                <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                        <Text variant="bodySm" as="span" tone="subdued" fontWeight="medium">{label}</Text>
                        <Icon source={icon} tone={tone || "base"} />
                    </InlineStack>
                    <Text variant="heading2xl" as="h2" tone={tone as any}>{value}</Text>
                    {sub && <Text as="p" variant="bodySm" tone="subdued">{sub}</Text>}
                </BlockStack>
            </Box>
        </Card>
    );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ROIDashboard() {
    const { segments, totalRevenue, totalCustomers, totalOrders, planName } = useLoaderData<typeof loader>();
    const navigate = useNavigate();
    const isFree = !planName || planName === "Free";

    // Chart data — top 8 for readability
    const top8 = segments.slice(0, 8);
    const barChartData = top8.map((s, i) => ({
        name: s.tag.length > 12 ? s.tag.slice(0, 11) + "…" : s.tag,
        value: s.revenue,
        fill: CHART_COLORS[i % CHART_COLORS.length]
    }));

    const donutChartData = top8.map((s, i) => ({
        name: s.tag,
        value: s.revenue,
        fill: CHART_COLORS[i % CHART_COLORS.length]
    }));

    const avgOV = totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : "0";

    // Table rows
    const tableRows = segments.map((s, i) => {
        const pct = totalRevenue > 0 ? ((s.revenue / totalRevenue) * 100).toFixed(1) : "0";
        const barWidth = totalRevenue > 0 ? Math.round((s.revenue / (segments[0]?.revenue || 1)) * 100) : 0;
        return [
            <InlineStack key={s.tag} gap="200" blockAlign="center" wrap={false}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                <Text variant="bodyMd" fontWeight="semibold" as="span">{s.tag}</Text>
            </InlineStack>,
            <div key={`bar-${s.tag}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 100, height: 6, background: "rgba(0,0,0,0.06)", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${barWidth}%`, height: "100%", background: CHART_COLORS[i % CHART_COLORS.length], borderRadius: 3, transition: "width 0.4s ease" }} />
                </div>
                <Text variant="bodyMd" as="span">{`$${s.revenue.toLocaleString()}`}</Text>
            </div>,
            s.customers.toLocaleString(),
            s.orders.toLocaleString(),
            `$${s.avgOrderValue.toLocaleString()}`,
            <Badge key={`pct-${s.tag}`} tone="success">{`${pct}%`}</Badge>
        ];
    });

    return (
        <Page
            title="Revenue ROI"
            subtitle="Revenue attributed to each customer tag segment."
            backAction={{ content: "Dashboard", url: "/app" }}
        >
            <Layout>
                {isFree && (
                    <Layout.Section>
                        <Banner tone="warning">
                            <Text as="p">Revenue analytics are available on <strong>Growth</strong> plan and above.</Text>
                            <Box paddingBlockStart="200">
                                <Button onClick={() => navigate("/app/pricing")}>Upgrade Now</Button>
                            </Box>
                        </Banner>
                    </Layout.Section>
                )}

                {/* ── KPI Row ────────────────────────────────── */}
                <Layout.Section>
                    <Grid>
                        <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                            <KpiCard
                                label="Total Revenue"
                                value={`$${totalRevenue.toLocaleString()}`}
                                sub={`${totalCustomers.toLocaleString()} customers tracked`}
                                icon={MoneyIcon}
                                tone="magic"
                                bg="bg-surface-magic"
                            />
                        </Grid.Cell>
                        <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                            <KpiCard
                                label="Top Segment"
                                value={segments[0]?.tag ?? "—"}
                                sub={segments[0] ? `$${segments[0].revenue.toLocaleString()} revenue` : "No data"}
                                icon={ChartVerticalIcon}
                                tone="success"
                            />
                        </Grid.Cell>
                        <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                            <KpiCard
                                label="Unique Segments"
                                value={segments.length.toString()}
                                sub="Tag-based segments"
                                icon={HashtagIcon}
                            />
                        </Grid.Cell>
                        <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                            <KpiCard
                                label="Avg Order Value"
                                value={`$${avgOV}`}
                                sub={`${totalOrders.toLocaleString()} total orders`}
                                icon={OrderIcon}
                            />
                        </Grid.Cell>
                    </Grid>
                </Layout.Section>

                {/* ── Charts Row ──────────────────────────────── */}
                {segments.length > 0 && (
                    <Layout.Section>
                        <Grid>
                            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                                <Card roundedAbove="sm">
                                    <BlockStack gap="300">
                                        <InlineStack align="space-between" blockAlign="center">
                                            <Text variant="headingMd" as="h3">Revenue by Segment</Text>
                                            <Badge>{`${top8.length} shown`}</Badge>
                                        </InlineStack>
                                        <Divider />
                                        <div style={{ height: 280 }}>
                                            <React.Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}><Spinner size="large" /></div>}>
                                                <DashboardChart chartData={barChartData} type="bar" height={280} />
                                            </React.Suspense>
                                        </div>
                                    </BlockStack>
                                </Card>
                            </Grid.Cell>

                            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                                <Card roundedAbove="sm">
                                    <BlockStack gap="300">
                                        <InlineStack align="space-between" blockAlign="center">
                                            <Text variant="headingMd" as="h3">Revenue Share</Text>
                                            <Badge tone="info">{`$${totalRevenue.toLocaleString()} total`}</Badge>
                                        </InlineStack>
                                        <Divider />
                                        <div style={{ height: 280 }}>
                                            <React.Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}><Spinner size="large" /></div>}>
                                                <DashboardChart chartData={donutChartData} type="donut" height={280} />
                                            </React.Suspense>
                                        </div>
                                    </BlockStack>
                                </Card>
                            </Grid.Cell>
                        </Grid>
                    </Layout.Section>
                )}

                {/* ── Detail Table ────────────────────────────── */}
                <Layout.Section>
                    <Card padding="0">
                        <Box padding="400">
                            <InlineStack align="space-between" blockAlign="center">
                                <Text variant="headingMd" as="h3">All Segments</Text>
                                <Badge>{`${segments.length} segments`}</Badge>
                            </InlineStack>
                        </Box>
                        <Divider />
                        {segments.length === 0 ? (
                            <Box padding="500">
                                <BlockStack gap="200" inlineAlign="center">
                                    <Text as="p" tone="subdued" alignment="center">No customer data yet. Sync your customers to see revenue attribution.</Text>
                                    <Button onClick={() => navigate("/app")}>Go to Dashboard</Button>
                                </BlockStack>
                            </Box>
                        ) : (
                            <DataTable
                                columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "text"]}
                                headings={["Segment", "Revenue", "Customers", "Orders", "Avg. Order", "Share"]}
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
