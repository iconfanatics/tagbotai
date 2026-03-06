/**
 * app.predict.tsx
 * Feature: Predictive Segmentation
 *
 * On-demand UI to trigger the predictive segmentation engine.
 * Applies VIP / At-Risk tags based on deterministic rules against local Customer data.
 */
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigation, useSubmit, useNavigate } from "react-router";
import {
    Page, Layout, Card, Text, BlockStack, InlineStack, Button,
    Banner, Box, Badge, ProgressBar, List, Icon, Divider
} from "@shopify/polaris";
import { MagicIcon, RefreshIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";
import { runPredictiveSegmentation } from "../services/predictive.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    if (!store) throw new Error("Store not found");

    // Summary stats from current Customer data for display
    const now = new Date();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [totalCustomers, currentVipCount, currentAtRiskCount, vipCandidates, atRiskCandidates] = await Promise.all([
        db.customer.count({ where: { storeId: store.id } }),
        db.customer.count({ where: { storeId: store.id, tags: { contains: "VIP" } } }),
        db.customer.count({ where: { storeId: store.id, tags: { contains: "At-Risk" } } }),
        db.customer.count({
            where: {
                storeId: store.id,
                orderCount: { gte: 3 },
                totalSpent: { gte: 200 },
                lastOrderDate: { gte: sixtyDaysAgo },
                NOT: { tags: { contains: "VIP" } }
            }
        }),
        db.customer.count({
            where: {
                storeId: store.id,
                orderCount: { gte: 2 },
                lastOrderDate: { lt: ninetyDaysAgo },
                NOT: { tags: { contains: "At-Risk" } }
            }
        })
    ]);

    return {
        totalCustomers,
        currentVipCount,
        currentAtRiskCount,
        vipCandidates,  // customers who WOULD be tagged VIP if run now
        atRiskCandidates,
        planName: store.planName
    };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    if (!store) return { success: false, message: "Store not found." };

    if (store.planName === "Free") {
        return { success: false, message: "Predictive Segmentation requires a Growth, Pro, or Elite plan." };
    }

    const result = await runPredictiveSegmentation(store.id, admin);

    return {
        success: true,
        message: `Segmentation complete! ${result.vipTagged} customers tagged VIP, ${result.atRiskTagged} tagged At-Risk. (${result.durationMs}ms)`,
        ...result
    };
};

export default function PredictPage() {
    const { totalCustomers, currentVipCount, currentAtRiskCount, vipCandidates, atRiskCandidates, planName } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const submit = useSubmit();
    const navigate = useNavigate();

    const isRunning = navigation.state === "submitting";
    const isFree = !planName || planName === "Free";

    const handleRun = () => submit({}, { method: "post" });

    const totalActionable = vipCandidates + atRiskCandidates;

    return (
        <Page
            title="Predictive Engine"
            subtitle="Autonomous customer segmentation control panel."
            backAction={{ content: "Dashboard", url: "/app" }}
        >
            <Layout>
                {isFree && (
                    <Layout.Section>
                        <Banner tone="warning">
                            <Text as="p">The automated Predictive Engine is available on <strong>Growth</strong> plan and above.</Text>
                            <Box paddingBlockStart="200">
                                <Button onClick={() => navigate("/app/pricing")}>Upgrade Now</Button>
                            </Box>
                        </Banner>
                    </Layout.Section>
                )}

                {/* Split Pane Control Panel */}
                <Layout.Section>
                    <div className="split-pane">
                        
                        {/* LEFT PANE: Analytics & Status */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            <div className="premium-card">
                                <Box padding="500">
                                    <BlockStack gap="400">
                                        <InlineStack align="space-between" blockAlign="center">
                                            <Text variant="headingLg" as="h2">Database Overview</Text>
                                            <Badge tone="info">{`${totalCustomers.toLocaleString()} Indexed`}</Badge>
                                        </InlineStack>
                                        <Divider />
                                        
                                        <InlineStack gap="600" align="space-between" wrap={false}>
                                            <BlockStack gap="200">
                                                <Text variant="headingSm" as="h3" tone="subdued">VIP Segment</Text>
                                                <div className="metric-value">{currentVipCount.toLocaleString()}</div>
                                                {vipCandidates > 0 ? (
                                                    <span className="metric-trend-up">↑ {vipCandidates} pending</span>
                                                ) : (
                                                    <span className="metric-trend-neutral" style={{ color: '#6b7280', fontSize: '0.85rem' }}>Up to date</span>
                                                )}
                                            </BlockStack>
                                            
                                            <div style={{ width: '1px', background: '#e5e7eb', height: '60px', alignSelf: 'center' }} />
                                            
                                            <BlockStack gap="200">
                                                <Text variant="headingSm" as="h3" tone="subdued">At-Risk Segment</Text>
                                                <div className="metric-value">{currentAtRiskCount.toLocaleString()}</div>
                                                {atRiskCandidates > 0 ? (
                                                    <span className="metric-trend-down">↓ {atRiskCandidates} pending</span>
                                                ) : (
                                                    <span className="metric-trend-neutral" style={{ color: '#6b7280', fontSize: '0.85rem' }}>Up to date</span>
                                                )}
                                            </BlockStack>
                                        </InlineStack>
                                    </BlockStack>
                                </Box>
                            </div>

                            <Card roundedAbove="sm">
                                <BlockStack gap="400">
                                    <InlineStack gap="200" blockAlign="center">
                                        <Icon source={MagicIcon} tone="magic" />
                                        <Text variant="headingMd" as="h3">Engine Parameters</Text>
                                    </InlineStack>
                                    <Divider />
                                    <InlineStack gap="400" wrap={false}>
                                        <div style={{ flex: 1 }}>
                                            <BlockStack gap="200">
                                                {/* @ts-ignore */}
                                                <Badge tone="success">VIP Ruleset</Badge>
                                                <List type="bullet">
                                                    <List.Item>≥ 3 orders</List.Item>
                                                    <List.Item>≥ $200 LTV</List.Item>
                                                    <List.Item>Active &lt; 60 days</List.Item>
                                                </List>
                                            </BlockStack>
                                        </div>
                                        <div style={{ width: '1px', background: '#e5e7eb' }} />
                                        <div style={{ flex: 1 }}>
                                            <BlockStack gap="200">
                                                {/* @ts-ignore */}
                                                <Badge tone="critical">Attrition Ruleset</Badge>
                                                <List type="bullet">
                                                    <List.Item>≥ 2 orders</List.Item>
                                                    <List.Item>Inactive &gt; 90 days</List.Item>
                                                </List>
                                            </BlockStack>
                                        </div>
                                    </InlineStack>
                                </BlockStack>
                            </Card>
                        </div>

                        {/* RIGHT PANE: Action Engine */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            <div className="premium-card premium-card-glass" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                                <Box padding="500">
                                    <BlockStack gap="500">
                                        <div>
                                            <h2 className="text-gradient" style={{ fontSize: '1.5rem', marginBottom: '8px' }}>Action Center</h2>
                                            <Text as="p" tone="subdued">Execute deterministic tagging across your entire customer database instantly.</Text>
                                        </div>

                                        <div style={{ background: '#fef3c7', padding: '16px', borderRadius: '12px', border: '1px solid #fde68a' }}>
                                            <BlockStack gap="200" inlineAlign="center">
                                                <Text variant="headingXl" as="h2" tone="caution">{totalActionable.toLocaleString()}</Text>
                                                <Text variant="bodyMd" as="p" fontWeight="medium">Customers Requiring Tag Updates</Text>
                                            </BlockStack>
                                        </div>

                                        {isRunning ? (
                                            <div style={{ padding: '24px 0', textAlign: 'center' }}>
                                                <BlockStack gap="300" inlineAlign="center">
                                                    <div style={{ color: '#4f46e5' }}><Icon source={RefreshIcon} /></div>
                                                    <Text variant="headingSm" as="h3">Processing Database...</Text>
                                                    <div style={{ width: '100%', maxWidth: 200 }}>
                                                        {/* @ts-ignore */}
                                                        <ProgressBar progress={undefined} size="small" tone="highlight" />
                                                    </div>
                                                </BlockStack>
                                            </div>
                                        ) : (
                                            <div className="btn-premium">
                                                <Button
                                                    size="large"
                                                    disabled={isFree || totalActionable === 0}
                                                    onClick={handleRun}
                                                    fullWidth
                                                >
                                                    {isFree ? "Upgrade required" : totalActionable === 0 ? "Database is synchronized" : "Run Synchronization Engine"}
                                                </Button>
                                            </div>
                                        )}
                                        
                                        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                                            Operations are completely idempotent and safe to run multiple times. Demotions happen automatically.
                                        </Text>

                                        {actionData?.message && (
                                            <Banner tone={actionData.success ? "success" : "critical"}>
                                                {actionData.message}
                                            </Banner>
                                        )}
                                    </BlockStack>
                                </Box>
                            </div>
                        </div>

                    </div>
                </Layout.Section>

            </Layout>
        </Page>
    );
}
