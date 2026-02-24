import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";
import { Page, Layout, Card, Text, BlockStack, IndexTable, Badge, Button, EmptyState, InlineStack, Icon, Box, Tooltip, Modal } from "@shopify/polaris";
import { DeleteIcon, AutomationIcon, ExportIcon } from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useState } from "react";

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

    return { rules, currentPlanName: store.planName };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();

    const actionType = formData.get("action");
    const ruleId = formData.get("ruleId") as string;

    if (actionType === "delete" && ruleId) {
        await db.rule.delete({ where: { id: ruleId } });
        return { success: true };
    }

    return null;
}

export default function RulesManagement() {
    const shopify = useAppBridge();
    const { rules, currentPlanName } = useLoaderData<typeof loader>();
    const navigate = useNavigate();
    const submit = useSubmit();

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
            shopify.toast.show(`CSV Export Started for segment: ${ruleName}...`);
            let url = `/app/export${window.location.search}`;
            url += url.includes("?") ? `&ruleId=${ruleId}` : `?ruleId=${ruleId}`;
            window.open(url, "_blank");
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
            secondaryActions={[{ content: 'Back to Analytics', onAction: () => navigate('/app') }]}
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
