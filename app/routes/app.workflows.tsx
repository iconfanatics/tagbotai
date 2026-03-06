/**
 * app.workflows.tsx
 * Feature: Action-based Workflows
 *
 * Merchants can create rules like:
 *   "When tag VIP is applied → POST to https://my-crm.com/hook"
 */
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useNavigation, useSubmit } from "react-router";
import {
    Page, Layout, Card, Text, BlockStack, InlineStack, Button,
    ResourceList, ResourceItem, Badge, TextField, Select, Banner, Box, Divider, Icon
} from "@shopify/polaris";
import { AutomationIcon, DeleteIcon, PlusIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    if (!store) throw new Error("Store not found");

    const actions = await db.workflowAction.findMany({
        where: { storeId: store.id },
        orderBy: { createdAt: "desc" }
    });

    return { actions, storeId: store.id, planName: store.planName };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    if (!store) return { success: false };

    const form = await request.formData();
    const intent = form.get("intent") as string;

    if (intent === "create") {
        await db.workflowAction.create({
            data: {
                storeId: store.id,
                name: form.get("name") as string,
                triggerTag: form.get("triggerTag") as string,
                triggerOn: form.get("triggerOn") as string,
                actionType: form.get("actionType") as string,
                webhookUrl: (form.get("webhookUrl") as string) || null,
                isActive: true
            }
        });
        return { success: true, message: "Workflow created!" };
    }

    if (intent === "delete") {
        await db.workflowAction.delete({ where: { id: form.get("id") as string } });
        return { success: true };
    }

    if (intent === "toggle") {
        const wa = await db.workflowAction.findUnique({ where: { id: form.get("id") as string } });
        if (wa) await db.workflowAction.update({ where: { id: wa.id }, data: { isActive: !wa.isActive } });
        return { success: true };
    }

    return { success: false };
};

const ACTION_TYPES = [
    { label: "Webhook (POST to URL)", value: "WEBHOOK" },
    { label: "Structured Log (Vercel logs)", value: "LOG" },
    { label: "Email Prep (queue for notifications)", value: "EMAIL_PREP" }
];

const TRIGGER_OPTIONS = [
    { label: "When tag is ADDED", value: "TAG_ADDED" },
    { label: "When tag is REMOVED", value: "TAG_REMOVED" }
];

export default function WorkflowsPage() {
    const { actions, planName } = useLoaderData<typeof loader>();
    const navigation = useNavigation();
    const submit = useSubmit();
    const isSubmitting = navigation.state === "submitting";

    const isFree = !planName || planName === "Free";

    const [name, setName] = useState("");
    const [triggerTag, setTriggerTag] = useState("");
    const [triggerOn, setTriggerOn] = useState("TAG_ADDED");
    const [actionType, setActionType] = useState("WEBHOOK");
    const [webhookUrl, setWebhookUrl] = useState("");

    const handleCreate = () => {
        if (!name.trim() || !triggerTag.trim()) return;
        submit({ intent: "create", name, triggerTag, triggerOn, actionType, webhookUrl }, { method: "post" });
        setName(""); setTriggerTag(""); setWebhookUrl("");
    };

    return (
        <Page
            title="Action Workflows"
            subtitle="Trigger automated actions whenever a tag is applied or removed."
            backAction={{ content: "Dashboard", url: "/app" }}
        >
            <Layout>
                {isFree && (
                    <Layout.Section>
                        <Banner tone="warning" title="Growth plan or higher required">
                            Workflow automation is available on Growth, Pro, and Elite plans.
                        </Banner>
                    </Layout.Section>
                )}

                {/* Create new workflow */}
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <InlineStack gap="200" blockAlign="center">
                                <Icon source={AutomationIcon} tone="magic" />
                                <Text variant="headingMd" as="h3">New Workflow</Text>
                            </InlineStack>
                            <Divider />
                            <InlineStack gap="300" wrap={false}>
                                <div style={{ flex: 2 }}>
                                    <TextField label="Workflow Name" value={name} onChange={setName} autoComplete="off" placeholder="Notify CRM when VIP tagged" />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <TextField label="Trigger Tag" value={triggerTag} onChange={setTriggerTag} autoComplete="off" placeholder="VIP" />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <Select label="Trigger On" options={TRIGGER_OPTIONS} value={triggerOn} onChange={setTriggerOn} />
                                </div>
                            </InlineStack>
                            <InlineStack gap="300" wrap={false}>
                                <div style={{ flex: 1 }}>
                                    <Select label="Action Type" options={ACTION_TYPES} value={actionType} onChange={setActionType} />
                                </div>
                                {actionType === "WEBHOOK" && (
                                    <div style={{ flex: 2 }}>
                                        <TextField label="Webhook URL" value={webhookUrl} onChange={setWebhookUrl} autoComplete="off" placeholder="https://your-crm.com/endpoint" type="url" />
                                    </div>
                                )}
                            </InlineStack>
                            <InlineStack>
                                <Button
                                    variant="primary"
                                    icon={PlusIcon}
                                    disabled={isFree || isSubmitting || !name.trim() || !triggerTag.trim()}
                                    onClick={handleCreate}
                                    loading={isSubmitting}
                                >
                                    Create Workflow
                                </Button>
                            </InlineStack>
                        </BlockStack>
                    </Card>
                </Layout.Section>

                {/* Existing workflows */}
                <Layout.Section>
                    <Card padding="0">
                        <Box padding="400">
                            <Text variant="headingMd" as="h3">Active Workflows ({actions.length})</Text>
                        </Box>
                        {actions.length === 0 ? (
                            <Box padding="400">
                                <Text as="p" tone="subdued">No workflows yet. Create one above to get started.</Text>
                            </Box>
                        ) : (
                            <ResourceList
                                resourceName={{ singular: "workflow", plural: "workflows" }}
                                items={actions}
                                renderItem={(item) => (
                                    <ResourceItem id={item.id} onClick={() => { }}>
                                        <InlineStack align="space-between" blockAlign="center">
                                            <BlockStack gap="100">
                                                <InlineStack gap="200" blockAlign="center">
                                                    <Text variant="bodyMd" fontWeight="bold" as="h3">{item.name}</Text>
                                                    {/* @ts-ignore */}
                                                    <Badge tone={item.isActive ? "success" : "subdued"}>{item.isActive ? "Active" : "Paused"}</Badge>
                                                    {/* @ts-ignore */}
                                                    <Badge tone="info">{item.actionType}</Badge>
                                                </InlineStack>
                                                <Text variant="bodySm" tone="subdued" as="span">
                                                    {item.triggerOn === "TAG_ADDED" ? "When tag added:" : "When tag removed:"} <strong>{item.triggerTag}</strong>
                                                    {item.webhookUrl ? ` → ${item.webhookUrl}` : ""}
                                                </Text>
                                            </BlockStack>
                                            <InlineStack gap="200">
                                                {/* @ts-ignore */}
                                                <Button size="micro" onClick={() => submit({ intent: "toggle", id: item.id }, { method: "post" })}>
                                                    {item.isActive ? "Pause" : "Resume"}
                                                </Button>
                                                {/* @ts-ignore */}
                                                <Button size="micro" tone="critical" icon={DeleteIcon} onClick={() => submit({ intent: "delete", id: item.id }, { method: "post" })}>Delete</Button>
                                            </InlineStack>
                                        </InlineStack>
                                    </ResourceItem>
                                )}
                            />
                        )}
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
