import React, { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSubmit, useNavigation, useActionData, Await, redirect } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";
import { enqueueSyncJob } from "../services/queue.server";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack, Badge, DataTable,
  Button, Banner, Icon, Box, Modal, Spinner, Divider, Grid,
  SkeletonBodyText, SkeletonDisplayText
} from "@shopify/polaris";
import {
  HashtagIcon, PersonIcon, AlertCircleIcon, MagicIcon, RefreshIcon,
  PlusIcon, ViewIcon, OrderIcon, ExportIcon, DiscountIcon, PaymentIcon
} from "@shopify/polaris-icons";

const DashboardChart = React.lazy(() => import("../components/DashboardChart"));
const MemoizedDataTable = React.memo(DataTable);

const DashboardSkeleton = () => (
  <>
    <Layout.Section>
      <Grid>
        {[1, 2, 3, 4].map(i => (
          <Grid.Cell key={i} columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
            <Card roundedAbove="sm"><Box padding="400"><BlockStack gap="400"><SkeletonDisplayText size="small" /><SkeletonBodyText lines={2} /></BlockStack></Box></Card>
          </Grid.Cell>
        ))}
      </Grid>
    </Layout.Section>
    <Layout.Section>
      <Card roundedAbove="sm"><Box padding="400"><SkeletonBodyText lines={8} /></Box></Card>
    </Layout.Section>
  </>
);

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getCachedStore(session.shop);

  if (!store) {
    return {
      currentPlanName: "Free",
      monthlyTagCount: 0,
      dashboardDataPromise: Promise.resolve({
        metrics: [0, 0, 0, 0, 0, 0, []],
        churningCustomers: [],
        orderRuleCount: 0,
        orderTagsFired: 0,
        topOrderTags: [] as { tag: string; count: number }[]
      })
    };
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  // Reset stuck sync
  if (store.isSyncing && store.updatedAt) {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    if (store.updatedAt < tenMinutesAgo) {
      await db.store.update({ where: { id: store.id }, data: { isSyncing: false, syncMessage: null } });
      store.isSyncing = false;
      store.syncMessage = null;
    }
  }

  const isProOrElite = store.planName === "Pro Plan" || store.planName === "Elite Plan";

  const dashboardDataPromise = (async () => {
    const [metrics, churningCustomers] = await Promise.all([
      Promise.all([
        db.activityLog.count({ where: { storeId: store.id, action: "TAG_ADDED" } }),
        db.customer.count({ where: { storeId: store.id, tags: { contains: "VIP" } } }),
        db.customer.count({ where: { storeId: store.id, lastOrderDate: { lt: thirtyDaysAgo } } }),
        db.customer.count({ where: { storeId: store.id, orderCount: { gt: 1 }, NOT: { tags: { contains: "VIP" } } } }),
        db.customer.count({ where: { storeId: store.id, orderCount: { lte: 1 }, NOT: { tags: { contains: "VIP" } } } }),
        db.customer.count({ where: { storeId: store.id } }),
        db.activityLog.findMany({
          where: { storeId: store.id },
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { customer: true, rule: true }
        })
      ]),
      isProOrElite ? db.customer.findMany({
        where: { storeId: store.id, orderCount: { gt: 3 }, lastOrderDate: { lt: sixtyDaysAgo } },
        take: 5,
        orderBy: { lastOrderDate: "asc" }
      }) : Promise.resolve([])
    ]);

    // Order-tag metrics
    const allRules = await db.rule.findMany({ where: { storeId: store.id } });
    const orderRules = allRules.filter(r => {
      try {
        const conds = JSON.parse(r.conditions);
        return conds.some((c: any) => c.ruleCategory === "order");
      } catch { return false; }
    });

    const orderRuleCount = orderRules.length;

    // Count tags fired by order rules
    const orderTagNames = orderRules.map(r => r.targetTag);
    let orderTagsFired = 0;
    const topOrderTagMap: Record<string, number> = {};

    if (orderTagNames.length > 0) {
      const logs = await db.activityLog.findMany({
        where: {
          storeId: store.id,
          action: "TAG_ADDED",
          tagContext: { in: orderTagNames }
        },
        select: { tagContext: true }
      });
      orderTagsFired = logs.length;
      for (const log of logs) {
        if (log.tagContext) {
          topOrderTagMap[log.tagContext] = (topOrderTagMap[log.tagContext] || 0) + 1;
        }
      }
    }

    const topOrderTags = Object.entries(topOrderTagMap)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    return { metrics, churningCustomers, orderRuleCount, orderTagsFired, topOrderTags };
  })();

  return {
    currentPlanName: store.planName,
    monthlyTagCount: store.monthlyTagCount,
    dashboardDataPromise
  };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const store = await getCachedStore(shop);
  if (!store) return { success: false, message: "Store not found" };

  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "send_winback_offer") {
    const customerId = formData.get("customerId") as string;
    if (customerId) {
      await db.activityLog.create({
        data: { storeId: store.id, customerId, action: "EMAIL_SENT", tagContext: "Win-back Campaign Simulated", reason: "Manual trigger from Dashboard" }
      });
      return { success: true, message: "Simulated Email Sent Successfully!" };
    }
  }

  if (actionType === "auto_tag_churn") {
    try {
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
      const activeVips = await db.customer.findMany({
        where: { storeId: store.id, totalSpent: { gt: 50 }, orderCount: { gt: 3 }, lastOrderDate: { lt: sixtyDaysAgo }, NOT: { tags: { contains: "At-Risk" } } },
        select: { id: true, email: true, firstName: true, lastName: true, tags: true }
      });
      if (activeVips.length > 0) {
        enqueueSyncJob({
          shop,
          storeId: store.id,
          customersToSync: activeVips.map(vip => ({
            node: {
              id: `gid://shopify/Customer/${vip.id}`,
              firstName: vip.firstName || "", lastName: vip.lastName || "",
              email: vip.email || "", amountSpent: { amount: "0" }, numberOfOrders: "0",
              tags: vip.tags ? vip.tags.split(",").map(t => t.trim()) : []
            }
          }))
        });
        for (const vip of activeVips) {
          await db.activityLog.create({
            data: { storeId: store.id, customerId: vip.id, action: "TAG_ADDED", tagContext: "At-Risk", reason: "AI Churn Auto-Tag Triggered" }
          });
        }
        return { success: true, message: `Dispatched job to tag ${activeVips.length} churning VIPs.` };
      }
      return { success: true, message: "All churning VIPs are already tagged." };
    } catch (e: any) {
      return { success: false, message: e.message || "Failed to tag churning customers" };
    }
  }

  if (actionType === "sync_customers") {
    try {
      const isFree = store.planName === "Free" || store.planName === "";
      const { fetchAllCustomers } = await import("../services/shopify-helpers.server");
      const customersToSync = await fetchAllCustomers(admin, isFree);
      if (customersToSync.length > 0) {
        enqueueSyncJob({ shop, storeId: store.id, customersToSync });
      }
      return { success: true, message: `Queued ${customersToSync.length} customers for syncing.` };
    } catch (e: any) {
      return { success: false, message: e.message || "Failed to sync customers" };
    }
  }

  return { success: false };
};

// ─── KPI Card component ──────────────────────────────────────────────────────

function KpiCard({ label, value, icon, tone, bg }: {
  label: string; value: string | number; icon: any;
  tone?: "base" | "magic" | "critical" | "success" | "subdued";
  bg?: string;
}) {
  return (
    <Card roundedAbove="sm" background={bg as any}>
      <Box padding="400">
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="bodySm" as="span" tone="subdued" fontWeight="medium">{label}</Text>
            <Icon source={icon} tone={tone || "base"} />
          </InlineStack>
          <Text variant="heading2xl" as="h2" tone={tone as any}>{typeof value === "number" ? value.toLocaleString() : value}</Text>
        </BlockStack>
      </Box>
    </Card>
  );
}

// ─── Dashboard Component ──────────────────────────────────────────────────────

export default function Index() {
  const shopify = useAppBridge();
  const { currentPlanName, monthlyTagCount, dashboardDataPromise } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSyncing = navigation.state === "submitting";
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);

  const handleSync = () => submit({ action: "sync_customers" }, { method: "post" });

  const handleExport = (tag?: string) => {
    if (currentPlanName === "Free" || currentPlanName === "") {
      setIsUpgradeModalOpen(true);
    } else {
      shopify.toast.show(`Preparing CSV export${tag ? ` for ${tag}` : ""}…`);
      const params = new URLSearchParams(window.location.search);
      if (tag) params.set("tag", tag);
      const anchor = document.createElement("a");
      anchor.href = `/app/export?${params.toString()}`;
      anchor.download = "";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    }
  };

  // Tag limits
  let tagLimit = Infinity;
  if (currentPlanName === "Free" || currentPlanName === "") tagLimit = 100;
  else if (currentPlanName === "Growth Plan") tagLimit = 1000;
  const currentMonthlyTags = monthlyTagCount || 0;

  let limitBanner = null;
  if (tagLimit !== Infinity) {
    if (currentMonthlyTags >= tagLimit) {
      limitBanner = (
        <Layout.Section>
          <Banner tone="critical" title="Monthly Tagging Limit Reached">
            <BlockStack gap="200">
              <Text as="p">You've used all {tagLimit} automated tags this billing cycle. Upgrade to resume.</Text>
              <Button onClick={() => navigate('/app/pricing')} tone="critical">Upgrade Plan</Button>
            </BlockStack>
          </Banner>
        </Layout.Section>
      );
    } else if (currentMonthlyTags >= tagLimit * 0.9) {
      limitBanner = (
        <Layout.Section>
          <Banner tone="warning" title="Approaching Tagging Limit">
            <Text as="p">{monthlyTagCount} of {tagLimit} tags used this cycle.</Text>
          </Banner>
        </Layout.Section>
      );
    }
  }

  return (
    <Page
      title="TagBot AI Dashboard"
      primaryAction={{ content: "Sync Customers", icon: RefreshIcon, onAction: handleSync, loading: isSyncing }}
      actionGroups={[
        {
          title: "Export",
          icon: ExportIcon,
          actions: [
            { content: "All Segments (CSV)", onAction: () => handleExport() },
            { content: "VIPs (CSV)", onAction: () => handleExport("VIP") },
            { content: "At-Risk (CSV)", onAction: () => handleExport("At-Risk") }
          ]
        }
      ]}
      secondaryActions={[
        { content: "View Rules", icon: ViewIcon, onAction: () => navigate("/app/rules") },
        { content: "New Rule", icon: PlusIcon, onAction: () => navigate("/app/rules/new") }
      ]}
    >
      <style>{`
        .dashboard-section-title { display: flex; align-items: center; gap: 8px; padding: 4px 0 8px; }
        .dashboard-section-title .icon { width: 20px; height: 20px; color: var(--p-color-icon-secondary); }
      `}</style>

      <Layout>
        {/* Upgrade Modal */}
        <Modal
          open={isUpgradeModalOpen}
          onClose={() => setIsUpgradeModalOpen(false)}
          title="Upgrade to Export"
          primaryAction={{ content: "View Plans", onAction: () => navigate("/app/pricing") }}
          secondaryActions={[{ content: "Cancel", onAction: () => setIsUpgradeModalOpen(false) }]}
        >
          <Modal.Section>
            <Text as="p">CSV exports are available on <strong>Pro</strong> and <strong>Elite</strong> plans.</Text>
          </Modal.Section>
        </Modal>

        {actionData?.message && (
          <Layout.Section>
            <Banner tone={actionData.success ? "success" : "critical"}>{actionData.message}</Banner>
          </Layout.Section>
        )}

        {limitBanner}

        <React.Suspense fallback={<DashboardSkeleton />}>
          <Await resolve={dashboardDataPromise}>
            {(resolved) => {
              const { metrics, churningCustomers, orderRuleCount, orderTagsFired, topOrderTags } = resolved as any;
              const [tagsAppliedCount, activeVipsCount, atRiskCount, returningCount, newCount, totalCustomers, recentLogs] = metrics;

              // ── Chart data ────────────────────────────────────
              const segmentChartData = [
                { name: "New", value: newCount, fill: "#818cf8" },
                { name: "Returning", value: returningCount, fill: "#fbbf24" },
                { name: "VIP", value: activeVipsCount, fill: "#34d399" },
                { name: "At-Risk", value: atRiskCount, fill: "#f87171" },
              ].filter(d => d.value > 0);

              const orderTagChartData = topOrderTags.map((t: any, i: number) => ({
                name: t.tag,
                value: t.count,
                fill: ["#818cf8", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#38bdf8"][i % 6]
              }));

              // ── AI Insight ────────────────────────────────────
              const atRiskPct = totalCustomers > 0 ? Math.round((atRiskCount / totalCustomers) * 100) : 0;
              let aiInsight = "Start syncing customers to generate insights.";
              if (atRiskPct > 30) aiInsight = `⚠️ ${atRiskPct}% of your customers are at-risk — consider a re-engagement campaign.`;
              else if (activeVipsCount > 0 && atRiskCount > 0) aiInsight = `${activeVipsCount} VIPs are active. ${atRiskCount} customers haven't ordered in 30 days — target them with a win-back offer.`;
              else if (totalCustomers > 0) aiInsight = "Your customer base looks healthy! Keep the momentum going.";
              if (orderRuleCount > 0 && orderTagsFired > 0) aiInsight += ` Your ${orderRuleCount} order rules have fired ${orderTagsFired} times.`;

              // ── Log rows ──────────────────────────────────────
              const logRows = recentLogs.map((log: any) => [
                log.customer?.firstName ? `${log.customer.firstName} ${log.customer.lastName || ""}` : "Guest",
                log.customer?.email || `ID: ${log.customerId}`,
                log.action === "TAG_ADDED"
                  ? <Badge tone="success">{log.tagContext}</Badge>
                  : <Badge tone="critical">{`${log.tagContext} ✕`}</Badge>,
                <Text as="span" variant="bodySm">{log.reason || (log.rule?.name || "Manual / Deleted Rule")}</Text>,
                new Date(log.createdAt).toLocaleString()
              ]);

              const churningRows = churningCustomers.map((c: any) => [
                c.firstName ? `${c.firstName} ${c.lastName || ""}` : c.email || c.id,
                c.lastOrderDate ? new Date(c.lastOrderDate).toLocaleDateString() : "N/A",
                c.orderCount.toString(),
                <Button size="micro" onClick={() => submit({ action: "send_winback_offer", customerId: c.id }, { method: "post" })}>
                  Send Win-back
                </Button>
              ]);

              return (
                <>
                  {/* ── Row 1: Customer KPIs ──────────────────── */}
                  <Layout.Section>
                    <Box paddingBlockEnd="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Icon source={PersonIcon} tone="subdued" />
                        <Text variant="headingSm" as="h3" tone="subdued">Customer Overview</Text>
                      </InlineStack>
                    </Box>
                    <Grid>
                      <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                        <KpiCard label="Total Customers" value={totalCustomers} icon={PersonIcon} />
                      </Grid.Cell>
                      <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                        <KpiCard label="Tags Applied" value={tagsAppliedCount} icon={HashtagIcon} />
                      </Grid.Cell>
                      <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                        <KpiCard label="Active VIPs" value={activeVipsCount} icon={PersonIcon} tone="magic" bg="bg-surface-magic" />
                      </Grid.Cell>
                      <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                        <KpiCard label="At-Risk" value={atRiskCount} icon={AlertCircleIcon} tone="critical" bg="bg-surface-critical-active" />
                      </Grid.Cell>
                    </Grid>
                  </Layout.Section>

                  {/* ── Row 2: Order Tag KPIs ─────────────────── */}
                  <Layout.Section>
                    <Box paddingBlockEnd="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Icon source={OrderIcon} tone="magic" />
                        <Text variant="headingSm" as="h3" tone="subdued">Order-Based Tags</Text>
                        <Badge tone="magic">New</Badge>
                      </InlineStack>
                    </Box>
                    <Grid>
                      <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                        <KpiCard label="Order Rules Active" value={orderRuleCount} icon={OrderIcon} tone="magic" />
                      </Grid.Cell>
                      <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                        <KpiCard label="Order Tags Fired" value={orderTagsFired} icon={HashtagIcon} tone="success" />
                      </Grid.Cell>
                      <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                        <KpiCard label="Top Order Tag" value={topOrderTags[0]?.tag || "—"} icon={DiscountIcon} />
                      </Grid.Cell>
                      <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                        <Card roundedAbove="sm">
                          <Box padding="400">
                            <BlockStack gap="200">
                              <Text variant="bodySm" as="span" tone="subdued" fontWeight="medium">Quick Actions</Text>
                              <InlineStack gap="200" wrap>
                                <Button size="micro" icon={PlusIcon} onClick={() => navigate("/app/rules/new")}>New Order Rule</Button>
                                <Button size="micro" icon={ViewIcon} onClick={() => navigate("/app/rules")} variant="plain">View All</Button>
                              </InlineStack>
                            </BlockStack>
                          </Box>
                        </Card>
                      </Grid.Cell>
                    </Grid>
                  </Layout.Section>

                  {/* ── Row 3: Charts side by side ────────────── */}
                  <Layout.Section>
                    <Grid>
                      <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                        <Card roundedAbove="sm">
                          <BlockStack gap="300">
                            <InlineStack align="space-between" blockAlign="center">
                              <Text variant="headingMd" as="h3">Customer Segments</Text>
                              <Badge tone="info">{`${totalCustomers} total`}</Badge>
                            </InlineStack>
                            <Divider />
                            <div style={{ height: 260 }}>
                              <React.Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}><Spinner size="large" /></div>}>
                                <DashboardChart chartData={segmentChartData} type="donut" height={260} />
                              </React.Suspense>
                            </div>
                          </BlockStack>
                        </Card>
                      </Grid.Cell>

                      <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                        <Card roundedAbove="sm">
                          <BlockStack gap="300">
                            <InlineStack align="space-between" blockAlign="center">
                              <InlineStack gap="200" blockAlign="center">
                                <Text variant="headingMd" as="h3">Order Tags Breakdown</Text>
                                <Badge tone="magic">New</Badge>
                              </InlineStack>
                              <Badge>{`${orderTagsFired} fired`}</Badge>
                            </InlineStack>
                            <Divider />
                            <div style={{ height: 260 }}>
                              <React.Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}><Spinner size="large" /></div>}>
                                <DashboardChart chartData={orderTagChartData} type="bar" height={260} />
                              </React.Suspense>
                            </div>
                          </BlockStack>
                        </Card>
                      </Grid.Cell>
                    </Grid>
                  </Layout.Section>

                  {/* ── Row 4: AI Insights ────────────────────── */}
                  <Layout.Section>
                    <Card roundedAbove="sm" background="bg-surface-magic">
                      <BlockStack gap="300">
                        <InlineStack gap="200" blockAlign="center">
                          <Icon source={MagicIcon} tone="magic" />
                          <Text variant="headingMd" as="h3">AI Insights</Text>
                          <Badge tone="magic" icon={MagicIcon}>Auto-generated</Badge>
                        </InlineStack>
                        <Text as="p" variant="bodyMd">{aiInsight}</Text>
                        <InlineStack gap="200">
                          <Button size="micro" onClick={() => navigate("/app/rules/new")}>Create Rule</Button>
                          <Button size="micro" variant="plain" onClick={() => navigate("/app/predict")}>Run Segmentation</Button>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  </Layout.Section>

                  {/* ── Row 5: Retention Alerts ───────────────── */}
                  {currentPlanName !== "Pro Plan" && currentPlanName !== "Elite Plan" ? (
                    <Layout.Section>
                      <Card>
                        <BlockStack gap="300">
                          <InlineStack gap="200" blockAlign="center">
                            <Icon source={AlertCircleIcon} tone="critical" />
                            <Text variant="headingMd" as="h3" tone="critical">Retention Alerts</Text>
                            <Badge tone="warning">Pro</Badge>
                          </InlineStack>
                          <Text as="p" tone="subdued">Identify VIP customers who haven't purchased in 60+ days. Upgrade to unlock.</Text>
                          <Button onClick={() => navigate("/app/pricing")}>Unlock Retention Alerts</Button>
                        </BlockStack>
                      </Card>
                    </Layout.Section>
                  ) : churningCustomers.length > 0 && (
                    <Layout.Section>
                      <Card padding="0">
                        <Box padding="400">
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200" blockAlign="center">
                              <Icon source={AlertCircleIcon} tone="critical" />
                              <Text variant="headingMd" as="h3" tone="critical">Retention Alerts</Text>
                            </InlineStack>
                            <Button
                              variant="primary" tone="critical" size="micro"
                              loading={navigation.state === "submitting"}
                              onClick={() => submit({ action: "auto_tag_churn" }, { method: "post" })}
                            >
                              Auto-Tag "At-Risk"
                            </Button>
                          </InlineStack>
                        </Box>
                        <MemoizedDataTable
                          columnContentTypes={["text", "text", "numeric", "text"]}
                          headings={["Customer", "Last Order", "Orders", "Action"]}
                          rows={churningRows}
                          hasZebraStripingOnData
                        />
                      </Card>
                    </Layout.Section>
                  )}

                  {/* ── Row 6: Recent Activity ────────────────── */}
                  <Layout.Section>
                    <Card padding="0">
                      <Box padding="400">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text variant="headingMd" as="h3">Recent Activity</Text>
                          <Button size="micro" onClick={() => navigate("/app/rules")}>Manage Rules</Button>
                        </InlineStack>
                      </Box>
                      <Divider />
                      {recentLogs.length > 0 ? (
                        <MemoizedDataTable
                          columnContentTypes={["text", "text", "text", "text", "text"]}
                          headings={["Customer", "Email", "Tag", "Source", "Time"]}
                          rows={logRows}
                          hasZebraStripingOnData
                        />
                      ) : (
                        <Box padding="500">
                          <BlockStack gap="200" inlineAlign="center">
                            <Text as="p" tone="subdued" alignment="center">No tagging activity yet. Create a rule and sync customers to get started.</Text>
                            <InlineStack align="center" gap="200">
                              <Button onClick={() => navigate("/app/rules/new")}>Create First Rule</Button>
                            </InlineStack>
                          </BlockStack>
                        </Box>
                      )}
                    </Card>
                  </Layout.Section>
                </>
              );
            }}
          </Await>
        </React.Suspense>
      </Layout>
    </Page>
  );
}

export const headers = (headersArgs: any) => boundary.headers(headersArgs);
