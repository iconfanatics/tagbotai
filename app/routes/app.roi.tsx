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

    const tableRows = segments.map((s, i) => {
        const pct = totalRevenue > 0 ? ((s.revenue / totalRevenue) * 100).toFixed(1) : "0";
        const barWidth = totalRevenue > 0 ? Math.round((s.revenue / (segments[0]?.revenue || 1)) * 100) : 0;
        return [
            <div key={s.tag} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span style={{ fontWeight: 600 }}>{s.tag}</span>
            </div>,
            <div key={`bar-${s.tag}`} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 100, height: 6, background: "rgba(0,0,0,0.06)", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${barWidth}%`, height: "100%", background: CHART_COLORS[i % CHART_COLORS.length], borderRadius: 3 }} />
                </div>
                <span>{`$${s.revenue.toLocaleString()}`}</span>
            </div>,
            s.customers.toLocaleString(),
            s.orders.toLocaleString(),
            `$${s.avgOrderValue.toLocaleString()}`,
            <span key={`pct-${s.tag}`} className="ds-tag green">{`${pct}%`}</span>
        ];
    });

    return (
        <Page backAction={{ content: "Dashboard", url: "/app" }}>
            <div className="ds-page" style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 60 }}>
                
                <div style={{ padding: '24px 0 32px' }}>
                    <h1 className="ds-section-title" style={{ fontSize: 26, letterSpacing: '-0.5px' }}>
                        📈 Revenue ROI
                    </h1>
                    <p style={{ fontSize: 14, color: '#9ca3af', margin: 0 }}>Revenue attributed to each customer tag segment.</p>
                </div>

                {isFree && (
                    <div className="ds-alert warning" style={{ marginBottom: 24 }}>
                        <div style={{ flex: 1 }}>Revenue analytics are available on <strong>Growth</strong> plan and above.</div>
                        <button className="ds-btn sm" style={{ background: '#fff', border: '1px solid #e5e7eb' }} onClick={() => navigate("/app/pricing")}>View Plans</button>
                    </div>
                )}

                {/* KPI Row */}
                <div className="ds-kpi-grid">
                    <div className="ds-kpi accent">
                        <div className="ds-kpi-label">Total Revenue</div>
                        <div className="ds-kpi-value">${totalRevenue.toLocaleString()}</div>
                        <div className="ds-kpi-sub">{totalCustomers.toLocaleString()} customers tracked</div>
                    </div>
                    <div className="ds-kpi">
                        <div className="ds-kpi-label">Top Segment</div>
                        <div className="ds-kpi-value" style={{ color: '#16a34a' }}>{segments[0]?.tag ?? "—"}</div>
                        <div className="ds-kpi-sub">{segments[0] ? `$${segments[0].revenue.toLocaleString()} revenue` : "No data"}</div>
                    </div>
                    <div className="ds-kpi">
                        <div className="ds-kpi-label">Unique Segments</div>
                        <div className="ds-kpi-value" style={{ color: '#6366f1' }}>{segments.length}</div>
                        <div className="ds-kpi-sub">Tag-based segments</div>
                    </div>
                    <div className="ds-kpi">
                        <div className="ds-kpi-label">Avg Order Value</div>
                        <div className="ds-kpi-value">${avgOV}</div>
                        <div className="ds-kpi-sub">{totalOrders.toLocaleString()} total orders</div>
                    </div>
                </div>

                {/* Charts Row */}
                {segments.length > 0 && (
                    <div className="ds-grid-2" style={{ marginBottom: 24 }}>
                        <div className="ds-card">
                            <div className="ds-card-header">
                                <div className="ds-card-title">Revenue by Segment</div>
                                <span className="ds-tag gray" style={{ fontWeight: 500 }}>{top8.length} shown</span>
                            </div>
                            <div className="ds-divider" style={{ margin: '14px 0' }} />
                            <div style={{ height: 280 }}>
                                <React.Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}><Spinner size="large" /></div>}>
                                    <DashboardChart chartData={barChartData} type="bar" height={280} />
                                </React.Suspense>
                            </div>
                        </div>

                        <div className="ds-card">
                            <div className="ds-card-header">
                                <div className="ds-card-title">Revenue Share</div>
                                <span className="ds-tag purple" style={{ fontWeight: 500 }}>${totalRevenue.toLocaleString()} total</span>
                            </div>
                            <div className="ds-divider" style={{ margin: '14px 0' }} />
                            <div style={{ height: 280 }}>
                                <React.Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}><Spinner size="large" /></div>}>
                                    <DashboardChart chartData={donutChartData} type="donut" height={280} />
                                </React.Suspense>
                            </div>
                        </div>
                    </div>
                )}

                {/* Detail Table */}
                <div className="ds-card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f3f4f6' }}>
                        <div className="ds-card-title" style={{ margin: 0 }}>All Segments</div>
                        <span className="ds-tag gray" style={{ fontWeight: 500 }}>{segments.length} segments</span>
                    </div>

                    {segments.length === 0 ? (
                        <div className="ds-empty">
                            <div className="ds-empty-icon" style={{ background: '#f3f4f6' }}>📊</div>
                            <div className="ds-empty-title">No Revenue Data</div>
                            <div className="ds-empty-body">Sync your customers and wait for new orders to see revenue attribution by segment.</div>
                            <button className="ds-btn ghost" style={{ marginTop: 8 }} onClick={() => navigate("/app")}>Go to Dashboard</button>
                        </div>
                    ) : (
                        <DataTable
                            columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "text"]}
                            headings={["Segment", "Revenue", "Customers", "Orders", "Avg. Order", "Share"]}
                            rows={tableRows}
                            hasZebraStripingOnData
                            sortable={[false, false, true, true, true, false]}
                        />
                    )}
                </div>

            </div>
        </Page>
    );
}
