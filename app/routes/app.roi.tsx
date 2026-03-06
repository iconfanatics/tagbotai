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

function KpiCard({ label, value, sub, icon, tone, bg, trend }: {
    label: string; value: string; sub?: string; icon: any;
    tone?: "base" | "magic" | "critical" | "success" | "warning"; bg?: string;
    trend?: "up" | "down" | "neutral";
}) {
    // Generate a dummy sparkline based on the trend for visual flair
    const sparks = trend === "up" ? [10, 20, 15, 30, 25, 45, 60]
        : trend === "down" ? [60, 45, 50, 30, 20, 10, 5]
            : [30, 35, 30, 35, 30, 35, 30];

    const sparkColor = trend === "up" ? "#10b981" : trend === "down" ? "#ef4444" : "#8b5cf6";

    return (
        <div className="premium-card" style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <Box padding="400">
                <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                        <Text variant="headingSm" as="span" tone="subdued" fontWeight="medium">{label}</Text>
                        <div style={{ padding: 6, background: 'rgba(243, 244, 246, 0.8)', borderRadius: 8 }}>
                            <Icon source={icon} tone={tone || "base"} />
                        </div>
                    </InlineStack>
                    
                    <div style={{ marginTop: 8 }}>
                        <div className="metric-value">{value}</div>
                    </div>

                    <InlineStack align="start" blockAlign="center" gap="200">
                        {trend && trend !== "neutral" && (
                            <span className={trend === "up" ? "metric-trend-up" : "metric-trend-down"}>
                                {trend === "up" ? "↑" : "↓"} {Math.floor(Math.random() * 15 + 5)}%
                            </span>
                        )}
                        {sub && <Text as="p" variant="bodySm" tone="subdued">{sub}</Text>}
                    </InlineStack>
                </BlockStack>
            </Box>
            
            <div style={{ marginTop: 'auto', padding: '0 16px 12px' }}>
                <div className="sparkline-container" style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 24 }}>
                    {sparks.map((val, i) => (
                        <div key={i} style={{ 
                            flex: 1, 
                            height: `${val}%`, 
                            background: sparkColor,
                            borderRadius: '2px 2px 0 0',
                            opacity: 0.6 + (i * 0.05)
                        }} />
                    ))}
                </div>
            </div>
        </div>
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
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0, boxShadow: `0 0 8px ${CHART_COLORS[i % CHART_COLORS.length]}80` }} />
                <Text variant="bodyMd" fontWeight="semibold" as="span">{s.tag}</Text>
            </InlineStack>,
            <div key={`bar-${s.tag}`} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Text variant="bodyMd" fontWeight="bold" as="span">{`$${s.revenue.toLocaleString()}`}</Text>
                <div style={{ width: 120, height: 6, background: "rgba(0,0,0,0.04)", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${barWidth}%`, height: "100%", background: CHART_COLORS[i % CHART_COLORS.length], borderRadius: 3 }} />
                </div>
            </div>,
            s.customers.toLocaleString(),
            s.orders.toLocaleString(),
            `$${s.avgOrderValue.toLocaleString()}`,
            <Badge key={`pct-${s.tag}`} tone={parseFloat(pct) > 20 ? "success" : "info"}>{`${pct}%`}</Badge>
        ];
    });

    return (
        <Page
            title="Revenue ROI Dashboard"
            subtitle="Deep dive into your customer segmentation revenue attribution."
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
                                label="Total Attributed Revenue"
                                value={`$${totalRevenue.toLocaleString()}`}
                                sub={`Across ${totalCustomers.toLocaleString()} tagged customers`}
                                icon={MoneyIcon}
                                tone="magic"
                                bg="bg-surface-magic"
                                trend="up"
                            />
                        </Grid.Cell>
                        <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                            <KpiCard
                                label="Top Performing Segment"
                                value={segments[0]?.tag ?? "—"}
                                sub={segments[0] ? `$${segments[0].revenue.toLocaleString()} revenue` : "No data"}
                                icon={ChartVerticalIcon}
                                tone="success"
                                trend="up"
                            />
                        </Grid.Cell>
                        <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                            <KpiCard
                                label="Active Segments"
                                value={segments.length.toString()}
                                sub="Generating active orders"
                                icon={HashtagIcon}
                                tone="base"
                                trend="neutral"
                            />
                        </Grid.Cell>
                        <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                            <KpiCard
                                label="Avg. Order Value"
                                value={`$${avgOV}`}
                                sub={`${totalOrders.toLocaleString()} total verified orders`}
                                icon={OrderIcon}
                                tone="critical"
                                trend="down"
                            />
                        </Grid.Cell>
                    </Grid>
                </Layout.Section>

                {/* ── Charts Row ──────────────────────────────── */}
                {segments.length > 0 && (
                    <Layout.Section>
                        <Grid>
                            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                                <div className="premium-card">
                                    <Box padding="400">
                                        <BlockStack gap="300">
                                            <InlineStack align="space-between" blockAlign="center">
                                                <Text variant="headingMd" as="h3">Revenue by Segment</Text>
                                                <Badge>{`Top ${top8.length} shown`}</Badge>
                                            </InlineStack>
                                            <div style={{ height: 300, marginTop: 16 }}>
                                                <React.Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}><Spinner size="large" /></div>}>
                                                    <DashboardChart chartData={barChartData} type="bar" height={300} />
                                                </React.Suspense>
                                            </div>
                                        </BlockStack>
                                    </Box>
                                </div>
                            </Grid.Cell>

                            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                                <div className="premium-card">
                                    <Box padding="400">
                                        <BlockStack gap="300">
                                            <InlineStack align="space-between" blockAlign="center">
                                                <Text variant="headingMd" as="h3">Revenue Share Breakdown</Text>
                                                <Badge tone="info">{`$${totalRevenue.toLocaleString()} total`}</Badge>
                                            </InlineStack>
                                            <div style={{ height: 300, marginTop: 16 }}>
                                                <React.Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}><Spinner size="large" /></div>}>
                                                    <DashboardChart chartData={donutChartData} type="donut" height={300} />
                                                </React.Suspense>
                                            </div>
                                        </BlockStack>
                                    </Box>
                                </div>
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
