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
    ResourceList, ResourceItem, Badge, TextField, Select, Banner, Box, Divider, Icon, EmptyState
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
                <Layout.Section>
                    <Card>
                        <EmptyState
                            heading="Automated Workflows are Coming Soon"
                            action={{ content: "Return to Dashboard", url: "/app" }}
                            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                        >
                            <p>We are currently putting the finishing touches on our advanced workflow engine. Soon, you will be able to automatically trigger external webhooks, slack messages, and CRM updates the moment a customer is tagged. Stay tuned!</p>
                        </EmptyState>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
