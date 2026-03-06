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
        <Page backAction={{ content: "Dashboard", url: "/app" }}>
            <div className="ds-page" style={{ maxWidth: 1000, margin: '0 auto', paddingBottom: 60 }}>
                
                <div style={{ padding: '24px 0 32px' }}>
                    <h1 className="ds-section-title" style={{ fontSize: 26, letterSpacing: '-0.5px' }}>
                        ⚡ Action Workflows
                    </h1>
                    <p style={{ fontSize: 14, color: '#9ca3af', margin: 0 }}>Trigger automated actions whenever a tag is applied or removed.</p>
                </div>

                {isFree && (
                    <div className="ds-alert warning" style={{ marginBottom: 24 }}>
                        <div style={{ flex: 1 }}>Workflow automation is available on <strong>Growth</strong>, <strong>Pro</strong>, and <strong>Elite</strong> plans.</div>
                        <a href="/app/pricing" className="ds-btn sm" style={{ background: '#fff', border: '1px solid #e5e7eb', textDecoration: 'none', color: '#374151' }}>View Plans</a>
                    </div>
                )}

                <div className="ds-grid-2" style={{ alignItems: 'start' }}>
                    {/* Create Form */}
                    <div className="ds-card">
                        <div className="ds-card-header">
                            <div className="ds-card-title">New Workflow</div>
                        </div>
                        <div className="ds-divider" style={{ margin: '14px 0 20px' }} />

                        <BlockStack gap="400">
                            <TextField label="Workflow Name" value={name} onChange={setName} autoComplete="off" placeholder="Notify CRM when VIP tagged" />
                            
                            <InlineStack gap="300" wrap={false}>
                                <div style={{ flex: 1 }}>
                                    <TextField label="Trigger Tag" value={triggerTag} onChange={setTriggerTag} autoComplete="off" placeholder="VIP" />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <Select label="Trigger On" options={TRIGGER_OPTIONS} value={triggerOn} onChange={setTriggerOn} />
                                </div>
                            </InlineStack>

                            <Select label="Action Type" options={ACTION_TYPES} value={actionType} onChange={setActionType} />
                            
                            {actionType === "WEBHOOK" && (
                                <TextField label="Webhook URL" value={webhookUrl} onChange={setWebhookUrl} autoComplete="off" placeholder="https://your-crm.com/endpoint" type="url" />
                            )}

                            <div style={{ paddingTop: 8 }}>
                                <button 
                                    className="ds-btn primary" 
                                    style={{ width: '100%' }}
                                    disabled={isFree || isSubmitting || !name.trim() || !triggerTag.trim()}
                                    onClick={handleCreate}
                                >
                                    {isSubmitting ? "Creating..." : "Create Workflow"}
                                </button>
                            </div>
                        </BlockStack>
                    </div>

                    {/* Active Workflows */}
                    <div className="ds-card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f3f4f6' }}>
                            <div className="ds-card-title" style={{ margin: 0 }}>Active Workflows</div>
                            <span className="ds-tag gray" style={{ fontWeight: 500 }}>{actions.length} workflows</span>
                        </div>

                        {actions.length === 0 ? (
                            <div className="ds-empty">
                                <div className="ds-empty-icon" style={{ background: '#f5f3ff', color: '#8b5cf6' }}>⚡</div>
                                <div className="ds-empty-title">No Workflows</div>
                                <div className="ds-empty-body">Create a workflow to automate tag-based actions.</div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {actions.map((item, idx) => (
                                    <div key={item.id} style={{ padding: '20px 24px', borderBottom: idx < actions.length - 1 ? '1px solid #f9fafb' : 'none' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                                            <div>
                                                <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a2e', marginBottom: 4 }}>{item.name}</div>
                                                <div style={{ display: 'flex', gap: 8 }}>
                                                    <span className={`ds-tag ${item.isActive ? 'green' : 'gray'}`}>{item.isActive ? "Active" : "Paused"}</span>
                                                    <span className="ds-tag purple">{item.actionType}</span>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <button 
                                                    className="ds-btn ghost sm"
                                                    onClick={() => submit({ intent: "toggle", id: item.id }, { method: "post" })}
                                                >
                                                    {item.isActive ? "Pause" : "Resume"}
                                                </button>
                                                <button 
                                                    className="ds-btn danger sm"
                                                    onClick={() => submit({ intent: "delete", id: item.id }, { method: "post" })}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                        <div style={{ fontSize: 13, color: '#6b7280', background: '#f9fafb', padding: '10px 14px', borderRadius: 8 }}>
                                            {item.triggerOn === "TAG_ADDED" ? "When tag added:" : "When tag removed:"} <strong style={{ color: '#374151' }}>{item.triggerTag}</strong>
                                            {item.webhookUrl && <span style={{ wordBreak: 'break-all' }}> → {item.webhookUrl}</span>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </Page>
    );
}
