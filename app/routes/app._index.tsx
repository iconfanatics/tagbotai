import React, { useEffect, useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSubmit, useNavigation, useActionData, useRevalidator, Await } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";
import { enqueueSyncJob } from "../services/queue.server";
import { calculateCustomerTags } from "../services/rule.server";
import { manageCustomerTags, sendVipDiscount } from "../services/tags.server";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Badge, DataTable, Button, Banner, Icon, Box, Modal, Spinner, CalloutCard, Divider, Grid, SkeletonBodyText, SkeletonDisplayText } from "@shopify/polaris";
import { HashtagIcon, PersonIcon, AlertCircleIcon, MagicIcon, RefreshIcon, PlusIcon, AutomationIcon, ExportIcon, ViewIcon, OrderIcon } from "@shopify/polaris-icons";

// Lazy-load the heavy Recharts library
const DashboardChart = React.lazy(() => import("../components/DashboardChart"));

// Memoize the polaris DataTable to prevent re-renders when parent state (like syncing) changes
const MemoizedDataTable = React.memo(DataTable);

const DashboardSkeleton = () => (
  <>
    <Layout.Section>
      <Grid>
        {[1, 2, 3, 4].map((i) => (
          <Grid.Cell key={i} columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
            <Card roundedAbove="sm">
              <Box padding="400">
                <BlockStack gap="400">
                  <SkeletonDisplayText size="small" />
                  <SkeletonBodyText lines={2} />
                </BlockStack>
              </Box>
            </Card>
          </Grid.Cell>
        ))}
      </Grid>
    </Layout.Section>
    <Layout.Section>
      <Card roundedAbove="sm">
        <Box padding="400">
          <SkeletonBodyText lines={6} />
        </Box>
      </Card>
    </Layout.Section>
  </>
);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const store = await getCachedStore(shop);

  if (!store) {
    return {
      currentPlanName: "Free",
      monthlyTagCount: 0,
      syncProgress: null,
      dashboardDataPromise: Promise.resolve({ metrics: [0, 0, 0, 0, 0, 0, []], churningCustomers: [] })
    };
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  // Safety net: if isSyncing has been true for > 10 minutes, the Vercel function was likely killed
  // mid-job without triggering the finally block. Force-reset so the UI doesn't spin forever.
  if (store.isSyncing && store.updatedAt) {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    if (store.updatedAt < tenMinutesAgo) {
      await db.store.update({
        where: { id: store.id },
        data: { isSyncing: false, syncMessage: null }
      });
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
        db.customer.count({ where: { storeId: store.id } }), // Total customers
        db.activityLog.findMany({
          where: { storeId: store.id },
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { customer: true, rule: true }
        })
      ]),
      isProOrElite ? db.customer.findMany({
        where: {
          storeId: store.id,
          orderCount: { gt: 3 },
          lastOrderDate: { lt: sixtyDaysAgo }
        },
        take: 5,
        orderBy: { lastOrderDate: 'asc' }
      }) : Promise.resolve([])
    ]);

    return { metrics, churningCustomers };
  })();

  return {
    currentPlanName: store.planName,
    monthlyTagCount: store.monthlyTagCount,
    dashboardDataPromise
  };
};

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
        data: {
          storeId: store.id,
          customerId,
          action: "EMAIL_SENT",
          tagContext: "Win-back Campaign Simulated",
          reason: "Manual trigger from Retention Dashboard"
        }
      });
      return { success: true, message: "Simulated Email Sent Successfully!" };
    }
  }

  if (actionType === "auto_tag_churn") {
    try {
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

      const activeVips = await db.customer.findMany({
        where: {
          storeId: store.id,
          totalSpent: { gt: 50 },
          orderCount: { gt: 3 },
          lastOrderDate: { lt: sixtyDaysAgo },
          NOT: { tags: { contains: "At-Risk" } }
        },
        select: { id: true, email: true, firstName: true, lastName: true, tags: true }
      });

      if (activeVips.length > 0) {
        // Send to background queue to iteratively apply the "At-Risk" tag in Shopify
        // We convert the Prisma Customer objects to match the API signature the Sync queue expects
        enqueueSyncJob({
          shop,
          storeId: store.id,
          customersToSync: activeVips.map(vip => ({
            node: {
              id: `gid://shopify/Customer/${vip.id}`,
              firstName: vip.firstName || "",
              lastName: vip.lastName || "",
              email: vip.email || "",
              amountSpent: { amount: "0" }, // The background rule engine will just see "At-Risk" if we build a rule
              numberOfOrders: "0",
              tags: vip.tags ? vip.tags.split(",").map(t => t.trim()) : []
            }
          }))
        });

        // Pre-log for fast UI feedback
        for (const vip of activeVips) {
          await db.activityLog.create({
            data: { storeId: store.id, customerId: vip.id, action: "TAG_ADDED", tagContext: "At-Risk", reason: "AI Churn Auto-Tag Triggered" }
          });
        }
        return { success: true, message: `Dispatched background job to tag ${activeVips.length} churning VIPs correctly.` };
      }
      return { success: true, message: "All churning VIPs are already tagged." };

    } catch (e: any) {
      console.error("Failed to enqueue auto-tag churn job", e);
      return { success: false, message: e.message || "Failed to tag churning customers" };
    }
  }

  if (actionType === "sync_customers") {
    try {
      const isFree = store.planName === "Free" || store.planName === "";
      const fetchLimit = isFree ? 50 : 250;

      const response = await admin.graphql(
        `#graphql
              query getCustomers {
                customers(first: ${fetchLimit}) {
                  edges {
                    node {
                      id
                      email
                      firstName
                      lastName
                      amountSpent {
                        amount
                      }
                      numberOfOrders
                      tags
                    }
                  }
                }
              }
            `
      );

      const data = await response.json();
      const customersToSync = data.data?.customers?.edges || [];

      if (customersToSync.length > 0) {
        enqueueSyncJob({
          shop,
          storeId: store.id,
          customersToSync
        });
      }

      return { success: true, message: `Successfully queued ${customersToSync.length} customers for background syncing.` };
    } catch (e: any) {
      console.error(e);
      return { success: false, message: e.message || "Failed to sync customers" };
    }
  }

  return { success: false };
}

export default function Index() {
  const shopify = useAppBridge();
  const { currentPlanName, monthlyTagCount, dashboardDataPromise } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const isSyncing = navigation.state === "submitting";

  // Remove old sync polling — it now lives on the Cleanup page
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);

  const handleSync = () => {
    submit({ action: "sync_customers" }, { method: "post" });
  };

  const handleExport = (tag?: string) => {
    if (currentPlanName === "Free" || currentPlanName === "") {
      setIsUpgradeModalOpen(true);
    } else {
      shopify.toast.show(`CSV Export Started${tag ? ` for ${tag}s` : ''}...`);
      let url = `/app/export${window.location.search}`;
      if (tag) {
        url += url.includes("?") ? `&tag=${tag}` : `?tag=${tag}`;
      }
      window.open(url, "_blank");
    }
  };

  // Tag Limit Checking Logic
  let tagLimit = Infinity;
  if (currentPlanName === "Free" || currentPlanName === "") tagLimit = 100;
  else if (currentPlanName === "Growth Plan") tagLimit = 1000;

  let limitBanner = null;
  const currentMonthlyTags = monthlyTagCount || 0;
  if (tagLimit !== Infinity) {
    if (currentMonthlyTags >= tagLimit) {
      limitBanner = (
        <Layout.Section>
          <Banner tone="critical" title="Monthly Tagging Limit Reached">
            <BlockStack gap="200">
              <Text as="p">
                You have reached your limit of {tagLimit} automated tags for this billing cycle. TagBot AI has paused applying new tags to avoid overage charges.
              </Text>
              <Text as="p" fontWeight="bold">
                Please upgrade to a premium plan to instantly resume automation.
              </Text>
              <Box paddingBlockStart="200">
                <Button onClick={() => navigate('/app/pricing')} tone="critical">Upgrade Plan</Button>
              </Box>
            </BlockStack>
          </Banner>
        </Layout.Section>
      );
    } else if (currentMonthlyTags >= tagLimit * 0.9) {
      limitBanner = (
        <Layout.Section>
          <Banner tone="warning" title="Approaching Tagging Limit">
            <BlockStack gap="200">
              <Text as="p">
                You have used {monthlyTagCount} out of {tagLimit} automated tags for this billing cycle. Consider upgrading your plan to ensure uninterrupted automation when the limit is reached.
              </Text>
              <Box paddingBlockStart="200">
                <Button onClick={() => navigate('/app/pricing')}>View Plans</Button>
              </Box>
            </BlockStack>
          </Banner>
        </Layout.Section>
      );
    }
  }


  return (
    <Page
      title="TagBot AI: Smart Segmentation"
      primaryAction={{ content: 'Sync Customers', icon: RefreshIcon, onAction: handleSync, loading: isSyncing }}
      actionGroups={[
        {
          title: 'Export Customers',
          icon: ExportIcon,
          actions: [
            { content: 'All Segments (CSV)', onAction: () => handleExport() },
            { content: 'Active VIPs (CSV)', onAction: () => handleExport("VIP") },
            { content: 'At-Risk (CSV)', onAction: () => handleExport("At-Risk") }
          ]
        }
      ]}
      secondaryActions={[
        { content: 'View Automations', icon: ViewIcon, onAction: () => navigate('/app/rules') },
        { content: 'New Rule', icon: PlusIcon, onAction: () => navigate('/app/rules/new') }
      ]}
    >
      <Layout>
        {/* Upgrade Modal */}
        <Modal
          open={isUpgradeModalOpen}
          onClose={() => setIsUpgradeModalOpen(false)}
          title="Upgrade to Pro"
          primaryAction={{
            content: 'View Plans',
            onAction: () => navigate('/app/pricing'),
          }}
          secondaryActions={[
            {
              content: 'Cancel',
              onAction: () => setIsUpgradeModalOpen(false),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p">
                Data export functionality is available on our <strong>Pro</strong> and <strong>Elite</strong> plans.
                Upgrade your subscription to unlock CSV exports, AI insights, and unlimited monthly tagging.
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>

        {actionData?.message && (
          <Layout.Section>
            <Banner tone={actionData.success ? "success" : "critical"}>
              {actionData.message}
            </Banner>
          </Layout.Section>
        )}

        {limitBanner}

        <React.Suspense fallback={<DashboardSkeleton />}>
          <Await resolve={dashboardDataPromise}>
            {(resolvedData) => {
              const { metrics, churningCustomers } = resolvedData as any;
              const [tagsAppliedCount, activeVipsCount, atRiskCount, returningCount, newCount, totalCustomers, recentLogs] = metrics;

              // AI message logic
              const atRiskPercentage = totalCustomers > 0 ? Math.round((atRiskCount / totalCustomers) * 100) : 0;
              let aiInsightMessage = "You don't have many active customers yet. Start running campaigns to gather data!";
              if (atRiskPercentage > 30) {
                aiInsightMessage = `Warning: ${atRiskPercentage}% of your total customers haven't purchased in the last 30 days. Consider creating a high-discount Re-engagement rule.`;
              } else if (activeVipsCount > 0 && atRiskCount > 0) {
                aiInsightMessage = `Good job retaining VIPs! However, you have ${atRiskCount} at-risk customers. Grouping them helps you target a re-engagement email campaign.`;
              } else if (totalCustomers > 0) {
                aiInsightMessage = "Your customer base is highly active! Keep engaging them with new product drops.";
              }

              const chartData = [
                { name: 'New Customers', value: newCount, fill: '#E6BDE5' },
                { name: 'Returning', value: returningCount, fill: '#FFB800' },
                { name: 'VIP', value: activeVipsCount, fill: '#00A0AC' }
              ].filter((item: any) => item.value > 0);

              const logRows = recentLogs.map((log: any) => [
                log.customer?.firstName ? `${log.customer.firstName} ${log.customer.lastName || ''}` : "Guest",
                log.customer?.email || `ID: ${log.customerId}`,
                log.action === "TAG_ADDED" ? <Badge tone="success">{log.tagContext}</Badge> : <Badge tone="critical">{`${log.tagContext} Removed`}</Badge>,
                <Text as="span">{log.reason || (log.rule?.name || "Manual/Deleted Rule")}</Text>,
                new Date(log.createdAt).toLocaleString()
              ]);

              const churningRows = churningCustomers.map((c: any) => [
                c.firstName ? `${c.firstName} ${c.lastName || ''}` : c.email || c.id,
                c.lastOrderDate ? new Date(c.lastOrderDate).toLocaleDateString() : 'N/A',
                c.orderCount.toString(),
                <Button size="micro" onClick={() => submit({ action: 'send_winback_offer', customerId: c.id }, { method: 'post' })}>
                  Send Win-back Offer
                </Button>
              ]);

              return (
                <>
                  {/* Top Row KPI Cards */}
                  <Layout.Section>
                    <Grid>
                      <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                        <Card roundedAbove="sm">
                          <Box padding="400">
                            <BlockStack gap="200">
                              <InlineStack align="space-between">
                                <Text variant="headingSm" as="h6" tone="subdued">Total Customers</Text>
                                <Icon source={OrderIcon} tone="base" />
                              </InlineStack>
                              <Text variant="heading3xl" as="h2">{totalCustomers.toLocaleString()}</Text>
                            </BlockStack>
                          </Box>
                        </Card>
                      </Grid.Cell>

                      <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                        <Card roundedAbove="sm">
                          <Box padding="400">
                            <BlockStack gap="200">
                              <InlineStack align="space-between">
                                <Text variant="headingSm" as="h6" tone="subdued">Total Tags Applied</Text>
                                <Icon source={HashtagIcon} tone="base" />
                              </InlineStack>
                              <Text variant="heading3xl" as="h2">{tagsAppliedCount.toLocaleString()}</Text>
                            </BlockStack>
                          </Box>
                        </Card>
                      </Grid.Cell>

                      <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                        <Card roundedAbove="sm" background="bg-surface-magic">
                          <Box padding="400">
                            <BlockStack gap="200">
                              <InlineStack align="space-between">
                                <Text variant="headingSm" as="h6" tone="magic">Active VIPs</Text>
                                <Icon source={PersonIcon} tone="magic" />
                              </InlineStack>
                              <Text variant="heading3xl" as="h2" tone="magic">{activeVipsCount.toLocaleString()}</Text>
                            </BlockStack>
                          </Box>
                        </Card>
                      </Grid.Cell>

                      <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                        <Card roundedAbove="sm" background="bg-surface-critical-active">
                          <Box padding="400">
                            <BlockStack gap="200">
                              <InlineStack align="space-between">
                                <Text variant="headingSm" as="h6" tone="critical">At-Risk Customers</Text>
                                <Icon source={AlertCircleIcon} tone="critical" />
                              </InlineStack>
                              <Text variant="heading3xl" as="h2" tone="critical">{atRiskCount.toLocaleString()}</Text>
                            </BlockStack>
                          </Box>
                        </Card>
                      </Grid.Cell>
                    </Grid>
                  </Layout.Section>

                  {/* Middle Section: Chart & Insights */}
                  <Layout.Section>
                    <Grid>
                      {/* Left Column: Segment Distribution */}
                      <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 6, xl: 6 }}>
                        <Card roundedAbove="sm">
                          <BlockStack gap="400">
                            <Text variant="headingMd" as="h3">Audience Segments</Text>
                            <Divider />
                            <div style={{ height: '240px', width: '100%', display: 'flex', justifyContent: 'center' }}>
                              <React.Suspense fallback={
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                  <Spinner accessibilityLabel="Loading chart" size="large" />
                                </div>
                              }>
                                <DashboardChart chartData={chartData} />
                              </React.Suspense>
                            </div>
                          </BlockStack>
                        </Card>
                      </Grid.Cell>

                      {/* Right Column: AI Insights */}
                      <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 6, xl: 6 }}>
                        <CalloutCard
                          title="TagBot AI Insights"
                          illustration="https://cdn.shopify.com/s/assets/admin/checkout/settings-customizecart-705f57c725ac05be5a34ec20c05b94298cb8afd10bf5ac5a56767eb215a77f0a.svg"
                          primaryAction={{
                            content: 'Create "VIP-At-Risk" Rule',
                            onAction: () => navigate('/app/rules/new'),
                          }}
                        >
                          <BlockStack gap="400">
                            <Text as="p" variant="bodyMd">
                              {aiInsightMessage}
                            </Text>
                            <InlineStack align="start">
                              <Badge tone="magic" icon={MagicIcon}>AI Generated Recommendation</Badge>
                            </InlineStack>
                          </BlockStack>
                        </CalloutCard>
                      </Grid.Cell>
                    </Grid>
                  </Layout.Section>

                  {/* Retention Alerts */}
                  {currentPlanName !== "Pro Plan" && currentPlanName !== "Elite Plan" ? (
                    <Layout.Section>
                      <Card padding="0">
                        <Box padding="400">
                          <BlockStack gap="400">
                            <InlineStack gap="200" align="start" blockAlign="center">
                              <Icon source={AlertCircleIcon} tone="critical" />
                              <Text variant="headingMd" as="h3" tone="critical">AI Retention Alerts (High Value Churn)</Text>
                            </InlineStack>
                            <Text as="p" tone="subdued">Identify VIP customers who haven't purchased in over 60 days. <Text as="strong">Upgrade to Pro</Text> to unlock this AI capability.</Text>
                            <Box paddingBlockStart="200">
                              <Button onClick={() => navigate('/app/pricing')}>Unlock AI Insights</Button>
                            </Box>
                          </BlockStack>
                        </Box>
                      </Card>
                    </Layout.Section>
                  ) : churningCustomers.length > 0 && (
                    <Layout.Section>
                      <Card padding="0">
                        <Box padding="400">
                          <BlockStack gap="400">
                            <InlineStack gap="200" align="start" blockAlign="center">
                              <Icon source={AlertCircleIcon} tone="critical" />
                              <Text variant="headingMd" as="h3" tone="critical">Action Required: Retention Alerts (High Value Churn)</Text>
                            </InlineStack>

                            <InlineStack align="space-between" blockAlign="center">
                              <Text as="p" tone="subdued">These VIP customers have &gt; 3 orders but haven't purchased in over 60 days. Don't lose them!</Text>
                              <Button
                                variant="primary"
                                tone="critical"
                                size="micro"
                                loading={navigation.state === "submitting"}
                                onClick={() => submit({ action: 'auto_tag_churn' }, { method: 'post' })}
                              >
                                Auto-Tag as "At-Risk"
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </Box>
                        <MemoizedDataTable
                          columnContentTypes={['text', 'text', 'numeric', 'text']}
                          headings={['Customer', 'Last Order Date', 'Total Orders', 'Action']}
                          rows={churningRows}
                          hasZebraStripingOnData
                        />
                      </Card>
                    </Layout.Section>
                  )}

                  {/* Bottom Section: Activity Log */}
                  <Layout.Section>
                    <Card padding="0">
                      <Box padding="400">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text variant="headingMd" as="h3">Recent Automation Activity</Text>
                          <Button size="micro" onClick={() => navigate('/app/rules')}>Manage Rules</Button>
                        </InlineStack>
                      </Box>
                      <Divider />
                      {recentLogs.length > 0 ? (
                        <MemoizedDataTable
                          columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                          headings={['Customer Name', 'Email', 'Tag Action', 'Attributed To', 'Timestamp']}
                          rows={logRows}
                        />
                      ) : (
                        <Box padding="400">
                          <Text as="p" tone="subdued">No automated tagging activity yet. Create a rule and sync customers to see historical evaluations.</Text>
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

export const headers = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};
