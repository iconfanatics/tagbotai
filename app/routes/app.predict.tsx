/**
 * app.predict.tsx
 * Feature: Predictive Segmentation
 *
 * On-demand UI to trigger the predictive segmentation engine.
 * Applies VIP / At-Risk tags based on deterministic rules against local Customer data.
 */
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigation, useSubmit } from "react-router";
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

    const isRunning = navigation.state === "submitting";
    const isFree = !planName || planName === "Free";

    const handleRun = () => submit({}, { method: "post" });

    return (
        <Page
            title="Predictive Segmentation"
            subtitle="Automatically label customers as VIP or At-Risk based on purchase behavior."
            backAction={{ content: "Dashboard", url: "/app" }}
        >
            <Layout>
                {/* How it works */}
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <InlineStack gap="200" blockAlign="center">
                                <Icon source={MagicIcon} tone="magic" />
                                <Text variant="headingMd" as="h3">How It Works</Text>
                            </InlineStack>
                            <Divider />
                            <InlineStack gap="600" wrap={false}>
                                <BlockStack gap="200">
                                    {/* @ts-ignore */}
                                    <Badge tone="success">VIP Criteria</Badge>
                                    <List>
                                        <List.Item>3+ orders placed</List.Item>
                                        <List.Item>$200+ lifetime spend</List.Item>
                                        <List.Item>Ordered within last 60 days</List.Item>
                                    </List>
                                </BlockStack>
                                <BlockStack gap="200">
                                    {/* @ts-ignore */}
                                    <Badge tone="warning">At-Risk Criteria</Badge>
                                    <List>
                                        <List.Item>2+ orders placed</List.Item>
                                        <List.Item>Last order more than 90 days ago</List.Item>
                                    </List>
                                </BlockStack>
                            </InlineStack>
                            <Text as="p" tone="subdued" variant="bodySm">
                                The engine is idempotent — customers who already have the correct tag are skipped. It demotes VIPs who no longer qualify.
                            </Text>
                        </BlockStack>
                    </Card>
                </Layout.Section>

                {/* Current coverage stats */}
                <Layout.Section>
                    <InlineStack gap="400" wrap={false}>
                        <div style={{ flex: 1 }}>
                            <Card>
                                <BlockStack gap="300">
                                    <Text variant="headingSm" as="h3" tone="subdued">Total Customers</Text>
                                    <Text variant="heading3xl" as="h2">{totalCustomers.toLocaleString()}</Text>
                                </BlockStack>
                            </Card>
                        </div>
                        <div style={{ flex: 1 }}>
                            <Card>
                                <BlockStack gap="300">
                                    <Text variant="headingSm" as="h3" tone="subdued">Currently Tagged VIP</Text>
                                    <Text variant="heading3xl" as="h2">{currentVipCount.toLocaleString()}</Text>
                                    {vipCandidates > 0 && (
                                        <Text as="p" tone="success" variant="bodySm">+{vipCandidates} new candidates ready</Text>
                                    )}
                                </BlockStack>
                            </Card>
                        </div>
                        <div style={{ flex: 1 }}>
                            <Card>
                                <BlockStack gap="300">
                                    <Text variant="headingSm" as="h3" tone="subdued">Currently Tagged At-Risk</Text>
                                    <Text variant="heading3xl" as="h2">{currentAtRiskCount.toLocaleString()}</Text>
                                    {atRiskCandidates > 0 && (
                                        <Text as="p" tone="caution" variant="bodySm">+{atRiskCandidates} new candidates ready</Text>
                                    )}
                                </BlockStack>
                            </Card>
                        </div>
                    </InlineStack>
                </Layout.Section>

                {/* Action result */}
                {actionData?.message && (
                    <Layout.Section>
                        <Banner tone={actionData.success ? "success" : "critical"}>
                            {actionData.message}
                        </Banner>
                    </Layout.Section>
                )}

                {/* Run button */}
                <Layout.Section>
                    <Card>
                        <BlockStack gap="300">
                            <Text variant="headingMd" as="h3">Run Segmentation Now</Text>
                            <Text as="p" tone="subdued">
                                This will process all {totalCustomers.toLocaleString()} customers synchronously and apply VIP / At-Risk tags where applicable.
                                {vipCandidates + atRiskCandidates > 0
                                    ? ` ${vipCandidates + atRiskCandidates} customers are candidates for tagging.`
                                    : " All customers are already correctly tagged."}
                            </Text>
                            {isRunning && (
                                <Box paddingBlockStart="200">
                                    <ProgressBar progress={undefined} size="small" tone="highlight" />
                                    <Text as="p" tone="subdued" variant="bodySm">Processing customers... please keep this page open.</Text>
                                </Box>
                            )}
                            <InlineStack>
                                <Button
                                    variant="primary"
                                    icon={RefreshIcon}
                                    disabled={isFree || isRunning}
                                    loading={isRunning}
                                    onClick={handleRun}
                                >
                                    {isFree ? "Upgrade to Use" : "Run Predictive Segmentation"}
                                </Button>
                            </InlineStack>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
