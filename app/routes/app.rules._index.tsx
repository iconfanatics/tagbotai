import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSubmit, useActionData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";
import { Page, Layout, Card, Text, BlockStack, IndexTable, Badge, Button, EmptyState, InlineStack, Tooltip, Modal, Box } from "@shopify/polaris";
import { DeleteIcon, AutomationIcon, ExportIcon, RefreshIcon } from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useState, useEffect } from "react";
import { enqueueSyncJob } from "../services/queue.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const store = await getCachedStore(shop);

    if (!store) {
        return { rules: [] };
    }

    const rules = await db.rule.findMany({
        where: { storeId: store.id },
        orderBy: { createdAt: "desc" }
    });

    // 1. Get all Activity Logs for these tags grouped by tagContext (O(1) query)
    const activeTags = rules.map(r => r.targetTag);
    const logsGroups = await db.activityLog.groupBy({
        by: ['tagContext'],
        where: { storeId: store.id, action: "TAG_ADDED", tagContext: { in: activeTags } },
        _count: { id: true }
    });

    const logsMap = new Map(logsGroups.filter(g => g.tagContext).map(g => [g.tagContext!, g._count.id]));

    // 2. Customers are a bit tricky because they are comma-separated string `contains` checks, 
    //    so we just fetch all tagged customers once and tally them in JS (O(1) query)
    const allTaggedCustomers = await db.customer.findMany({
        where: { storeId: store.id, tags: { not: null } },
        select: { tags: true }
    });

    const rulesWithMetrics = rules.map(rule => {
        let matchingCustomerCount = 0;
        for (const customer of allTaggedCustomers) {
            if (customer.tags?.includes(rule.targetTag)) {
                matchingCustomerCount++;
            }
        }

        return {
            ...rule,
            matchingCustomers: matchingCustomerCount,
            timesFired: logsMap.get(rule.targetTag) || 0
        };
    });

    return {
        rules: rulesWithMetrics,
        currentPlanName: store.planName
    };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    const formData = await request.formData();

    const actionType = formData.get("action");
    const ruleId = formData.get("ruleId") as string;

    if (actionType === "delete" && ruleId) {
        await db.rule.delete({ where: { id: ruleId } });
        return { success: true };
    }

    if (actionType === "sync") {
        const store = await getCachedStore(session.shop);
        if (store) {
            await enqueueSyncJob({
                shop: session.shop,
                storeId: store.id,
                syncType: "RULES",
            });
            // Also reset DB syncing flags locally so they don't block old UI
            await db.store.update({
                where: { id: store.id },
                data: { isSyncing: false, syncMessage: null }
            });
        }
        return { success: true, message: "Started evaluating historical data. This runs in the background and may take a few minutes." };
    }

    return null;
}

export default function RulesManagement() {
    const shopify = useAppBridge();
    const { rules, currentPlanName } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigate = useNavigate();
    const submit = useSubmit();
    const navigation = useNavigation();

    const isSubmitting = navigation.state === "submitting" && navigation.formData?.get("action") === "sync";

    useEffect(() => {
        if (actionData?.message) {
            shopify.toast.show(actionData.message, { duration: 5000 });
        }
    }, [actionData, shopify]);

    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);

    const handleDelete = (id: string, name: string) => {
        if (confirm(`Are you sure you want to delete the rule "${name}"? This will stop future matching but will not remove tags already applied.`)) {
            submit({ action: "delete", ruleId: id }, { method: "post" });
        }
    }

    const handleExportSegment = (ruleId: string, ruleName: string) => {
        if (currentPlanName === "Free" || currentPlanName === "") {
            setIsUpgradeModalOpen(true);
        } else {
            shopify.toast.show(`Preparing CSV export for: ${ruleName}…`);
            // Build the URL preserving the Shopify session query params (host, shop, etc.)
            const params = new URLSearchParams(window.location.search);
            params.set("ruleId", ruleId);
            const exportUrl = `/app/export?${params.toString()}`;

            window.fetch(exportUrl)
                .then(async (response) => {
                    if (!response.ok) throw new Error("Export failed");
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `export-${ruleName.replace(/\\s+/g, '-')}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                })
                .catch(() => shopify.toast.show("Failed to export", { isError: true }));
        }
    };

    const resourceName = {
        singular: 'rule',
        plural: 'rules',
    };

    if (rules.length === 0) {
        return (
            <Page
                title="Segmentation Rules"
                secondaryActions={[{ content: 'Back to Analytics', onAction: () => navigate('/app') }]}
            >
                <Layout>
                    <Layout.Section>
                        <div className="premium-card">
                            <Box padding="500">
                                <EmptyState
                                    heading="Automate your customer segmentation"
                                    action={{
                                        content: 'Create your first rule',
                                        onAction: () => navigate('/app/rules/new'),
                                        icon: AutomationIcon
                                    }}
                                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                                >
                                    <p>Create smart rules to automatically tag customers based on their purchase behavior as soon as they interact with your store.</p>
                                </EmptyState>
                            </Box>
                        </div>
                    </Layout.Section>
                </Layout>
            </Page>
        );
    }

    const rowMarkup = rules.map(
        (rule, index) => {
            let conditionPreview = "Complex Logic";
            try {
                const parsed = JSON.parse(rule.conditions);
                if (parsed.length > 0) {
                    const opSymbol = parsed[0].operator === 'greaterThan' ? '>' :
                        parsed[0].operator === 'lessThan' ? '<' :
                            parsed[0].operator === 'equals' ? '=' :
                                parsed[0].operator;
                    conditionPreview = `${parsed[0].field} ${opSymbol} ${parsed[0].value}`;
                }
            } catch (e) { }

            return (
                <IndexTable.Row
                    id={rule.id}
                    key={rule.id}
                    position={index}
                >
                    <IndexTable.Cell>
                        <Text variant="bodyMd" fontWeight="bold" as="span">
                            {rule.name}
                        </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                        <Box paddingBlockStart="100" paddingBlockEnd="100">
                            <Text variant="bodySm" as="span" tone="subdued"><code>{conditionPreview}</code></Text>
                        </Box>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                        <Badge tone="info" progress="complete">{rule.targetTag}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                        <Text variant="bodyMd" fontWeight="semibold" as="span">
                            {rule.matchingCustomers.toLocaleString()}
                        </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                        <Text variant="bodyMd" fontWeight="semibold" as="span" tone="subdued">
                            {rule.timesFired.toLocaleString()}
                        </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                        {rule.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="critical">Inactive</Badge>}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                        <InlineStack wrap={false} gap="200" align="end">
                            <Tooltip content="Export Segment CSV (Pro)">
                                <Button
                                    icon={ExportIcon}
                                    onClick={() => handleExportSegment(rule.id, rule.name)}
                                    accessibilityLabel={`Export segment for ${rule.name}`}
                                />
                            </Tooltip>
                            <Button
                                icon={DeleteIcon}
                                tone="critical"
                                variant="tertiary"
                                onClick={() => handleDelete(rule.id, rule.name)}
                                accessibilityLabel={`Delete ${rule.name}`}
                            />
                        </InlineStack>
                    </IndexTable.Cell>
                </IndexTable.Row>
            )
        }
    );

    return (
        <Page
            title="Segmentation Rules"
            primaryAction={{ content: 'Add New Automation', icon: AutomationIcon, onAction: () => navigate('/app/rules/new') }}
            secondaryActions={[
                {
                    content: 'Sync Historical Data',
                    icon: RefreshIcon,
                    onAction: () => submit({ action: "sync" }, { method: "post" }),
                    loading: isSubmitting,
                    disabled: isSubmitting
                },
                { content: 'Back to Analytics', onAction: () => navigate('/app') }
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
                                Segmented data export functionality is available on our <strong>Pro</strong> and <strong>Elite</strong> plans.
                                Upgrade your subscription to unlock targeted CSV exports for specific automation rules.
                            </Text>
                        </BlockStack>
                    </Modal.Section>
                </Modal>

                <Layout.Section>
                    <div className="premium-card">
                        <Box padding="400">
                            <BlockStack gap="200">
                                <Text variant="headingMd" as="h3">Active Smart Rules</Text>
                                <Text as="p" tone="subdued">Rules are evaluated automatically whenever a new customer is created or an order is paid.</Text>
                            </BlockStack>
                        </Box>
                        <IndexTable
                            resourceName={resourceName}
                            itemCount={rules.length}
                            headings={[
                                { title: 'Rule Name' },
                                { title: 'Condition Logic' },
                                { title: 'Target Tag' },
                                { title: 'Matching Customers' },
                                { title: 'Times Fired' },
                                { title: 'Status' },
                                { title: '' }, // Actions
                            ]}
                            selectable={false}
                        >
                            {rowMarkup}
                        </IndexTable>
                    </div>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
