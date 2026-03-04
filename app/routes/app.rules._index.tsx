import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";
import { Page, Layout, Card, Text, BlockStack, IndexTable, Badge, Button, EmptyState, InlineStack, Icon, Box, Tooltip, Modal, ProgressBar } from "@shopify/polaris";
import { DeleteIcon, AutomationIcon, ExportIcon, RefreshIcon } from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useState, useEffect } from "react";
import { useRevalidator } from "react-router";
import { fetchAllCustomers } from "../services/shopify-helpers.server";
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

    const rulesWithMetrics = await Promise.all(
        rules.map(async (rule) => {
            const matchingCustomers = await db.customer.count({
                where: { storeId: store.id, tags: { contains: rule.targetTag } }
            });

            const timesFired = await db.activityLog.count({
                where: { storeId: store.id, tagContext: rule.targetTag, action: "TAG_ADDED" }
            });

            return {
                ...rule,
                matchingCustomers,
                timesFired
            };
        })
    );

    return {
        rules: rulesWithMetrics,
        currentPlanName: store.planName,
        isSyncing: store.isSyncing,
        syncCompleted: store.syncCompleted,
        syncTarget: store.syncTarget,
        syncMessage: store.syncMessage
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

    if (actionType === "start_sync") {
        const store = await getCachedStore(session.shop);
        if (store) {
            const dbCount = await db.customer.count({ where: { storeId: store.id } });
            await db.store.update({
                where: { id: store.id },
                data: {
                    isSyncing: true,
                    syncTarget: Math.max(1, dbCount),
                    syncCompleted: 0,
                    syncMessage: "Evaluating customers against active rules…"
                }
            });
        }
        return { success: true };
    }

    if (actionType === "sync_batch") {
        const cursor = formData.get("cursor") as string;
        const store = await getCachedStore(session.shop);
        if (!store) return { success: false };

        const afterClause = cursor ? `, after: "${cursor}"` : "";
        const res = await admin.graphql(`
            #graphql
            query fetchCustomers {
                customers(first: 5${afterClause}) {
                    edges { cursor node { id email firstName lastName amountSpent { amount } numberOfOrders tags } }
                    pageInfo { hasNextPage }
                }
            }
        `);

        const data = await res.json();
        const edges = data.data?.customers?.edges || [];
        const pageInfo = data.data?.customers?.pageInfo;

        const activeRules = await db.rule.findMany({ where: { storeId: store.id, isActive: true } });

        // Dynamically import processOneCustomer to avoid circular dependency
        const { processOneCustomer } = await import("../services/queue.server");

        await Promise.all(edges.map((edge: any) =>
            processOneCustomer(admin, store.id, edge, activeRules, { shop: session.shop, storeId: store.id } as any)
                .catch(err => console.error("[SYNC_BATCH] Error:", err))
        ));

        await db.store.update({
            where: { id: store.id },
            data: { syncCompleted: { increment: edges.length } }
        });

        const nextCursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
        return { success: true, cursor: nextCursor, hasNextPage: pageInfo?.hasNextPage ?? false };
    }

    if (actionType === "end_sync") {
        const store = await getCachedStore(session.shop);
        if (store) {
            await db.store.update({
                where: { id: store.id },
                data: { isSyncing: false, syncCompleted: store.syncTarget, syncMessage: "Sync Complete!" }
            });
        }
        return { success: true };
    }

    return null;
}

export default function RulesManagement() {
    const shopify = useAppBridge();
    const { rules, currentPlanName, isSyncing, syncCompleted, syncTarget, syncMessage } = useLoaderData<typeof loader>();
    const navigate = useNavigate();
    const submit = useSubmit();
    const { revalidate } = useRevalidator();

    // Client-side batch processor loop
    useEffect(() => {
        let isCancelled = false;

        const runBatch = async (cursor: string) => {
            const formData = new FormData();
            formData.append("action", "sync_batch");
            formData.append("cursor", cursor);

            try {
                // Use native fetch to bypass form submission state management
                const res = await fetch("?index", { method: "POST", body: formData });
                const data = await res.json();

                if (isCancelled) return;

                if (data.success) {
                    // Update loader values natively so Progress Bar moves
                    revalidate();

                    if (data.hasNextPage) {
                        runBatch(data.cursor);
                    } else {
                        submit({ action: "end_sync" }, { method: "post" });
                    }
                }
            } catch (err) {
                console.error("Batch failed, retrying in 2s...", err);
                setTimeout(() => { if (!isCancelled) runBatch(cursor); }, 2000);
            }
        };

        if (isSyncing) {
            runBatch("");
        }

        return () => { isCancelled = true; };
    }, [isSyncing, revalidate, submit]);

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
                        <Card padding="0">
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
                        </Card>
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
                    content: isSyncing ? 'Syncing...' : 'Sync Historical Data',
                    icon: RefreshIcon,
                    onAction: () => submit({ action: "start_sync" }, { method: "post" }),
                    loading: isSyncing,
                    disabled: isSyncing
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
                    {isSyncing && (
                        <Box paddingBlockEnd="400">
                            <Card padding="400">
                                <BlockStack gap="200">
                                    <InlineStack align="space-between">
                                        <Text variant="headingSm" as="h3">
                                            {syncMessage || "Syncing historical data..."}
                                        </Text>
                                        <Text variant="bodySm" as="span" tone="subdued">
                                            {syncCompleted} of {syncTarget} completed
                                        </Text>
                                    </InlineStack>
                                    <ProgressBar
                                        progress={(syncCompleted / Math.max(1, syncTarget)) * 100}
                                        size="small"
                                        tone="primary"
                                    />
                                </BlockStack>
                            </Card>
                        </Box>
                    )}
                    <Card padding="0">
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
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
