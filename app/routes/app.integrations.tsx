import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useActionData, useNavigation, useNavigate } from "react-router";
import { Page, Layout, Card, BlockStack, Text, InlineStack, Banner, Button, Box, Icon, Modal, TextField, Divider, Badge } from "@shopify/polaris";
import { AppsIcon, CheckCircleIcon, XSmallIcon, SaveIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const store = await db.store.findUnique({ where: { shop } });

    if (!store) {
        throw new Response("Store not found", { status: 404 });
    }

    return {
        klaviyoApiKey: store.klaviyoApiKey || "",
        mailchimpApiKey: store.mailchimpApiKey || "",
        mailchimpServerPrefix: store.mailchimpServerPrefix || "",
        mailchimpListId: store.mailchimpListId || "",
        currentPlanName: store.planName
    };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const formData = await request.formData();
    const actionType = formData.get("action");

    if (actionType === "save_klaviyo") {
        const klaviyoApiKey = formData.get("klaviyoApiKey") as string;
        await db.store.update({
            where: { shop },
            data: { klaviyoApiKey: klaviyoApiKey.trim() === "" ? null : klaviyoApiKey.trim() }
        });
        return { success: true, message: "Klaviyo settings saved." };
    }

    if (actionType === "save_mailchimp") {
        const mailchimpApiKey = formData.get("mailchimpApiKey") as string;
        const mailchimpServerPrefix = formData.get("mailchimpServerPrefix") as string;
        const mailchimpListId = formData.get("mailchimpListId") as string;

        await db.store.update({
            where: { shop },
            data: {
                mailchimpApiKey: mailchimpApiKey.trim() === "" ? null : mailchimpApiKey.trim(),
                mailchimpServerPrefix: mailchimpServerPrefix.trim() === "" ? null : mailchimpServerPrefix.trim(),
                mailchimpListId: mailchimpListId.trim() === "" ? null : mailchimpListId.trim()
            }
        });
        return { success: true, message: "Mailchimp settings saved." };
    }

    return { success: false, message: "Unknown action" };
};

export default function Integrations() {
    const {
        klaviyoApiKey: initialKlaviyo,
        mailchimpApiKey: initialMailchimp,
        mailchimpServerPrefix: initialServer,
        mailchimpListId: initialListId,
        currentPlanName
    } = useLoaderData<typeof loader>();

    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const navigate = useNavigate();

    const isSaving = navigation.state === "submitting";

    const [klaviyoApiKey, setKlaviyoApiKey] = useState(initialKlaviyo);
    const [mailchimpApiKey, setMailchimpApiKey] = useState(initialMailchimp);
    const [mailchimpServerPrefix, setMailchimpServerPrefix] = useState(initialServer);
    const [mailchimpListId, setMailchimpListId] = useState(initialListId);

    const [isEliteModalOpen, setIsEliteModalOpen] = useState(false);

    const isElitePlan = currentPlanName === "Elite Plan";

    const handleSaveKlaviyo = () => {
        submit({ action: "save_klaviyo", klaviyoApiKey }, { method: "post" });
    };

    const handleSaveMailchimp = () => {
        submit({
            action: "save_mailchimp",
            mailchimpApiKey,
            mailchimpServerPrefix,
            mailchimpListId
        }, { method: "post" });
    };

    return (
        <Page backAction={{ content: "Dashboard", url: "/app" }}>
            <div className="ds-page" style={{ maxWidth: 840, margin: '0 auto', paddingBottom: 60 }}>
                
                <div style={{ padding: '24px 0 32px' }}>
                    <h1 className="ds-section-title" style={{ fontSize: 26, letterSpacing: '-0.5px' }}>
                        🔗 Marketing Integrations
                    </h1>
                    <p style={{ fontSize: 14, color: '#9ca3af', margin: 0 }}>Connect external platforms to auto-sync TagBot AI segments.</p>
                </div>

                <Modal
                    open={isEliteModalOpen}
                    onClose={() => setIsEliteModalOpen(false)}
                    title="Upgrade to Elite"
                    primaryAction={{ content: 'View Plans', onAction: () => navigate('/app/pricing') }}
                    secondaryActions={[{ content: 'Cancel', onAction: () => setIsEliteModalOpen(false) }]}
                >
                    <Modal.Section>
                        <BlockStack gap="300">
                            <Text as="p">
                                <strong>Marketing Sync</strong> integrations are exclusively available on our <strong>Elite</strong> plan.
                                Upgrade your subscription to unlock real-time CRM syncing.
                            </Text>
                        </BlockStack>
                    </Modal.Section>
                </Modal>

                {actionData?.message && (
                    <div className={`ds-alert ${actionData.success ? 'success' : 'error'}`} style={{ marginBottom: 24 }}>
                        {actionData.message}
                    </div>
                )}

                {!isElitePlan && (
                    <div className="ds-alert warning" style={{ marginBottom: 24 }}>
                        <div style={{ flex: 1 }}>You must be on the <strong>Elite</strong> plan to activate external marketing integrations.</div>
                        <button className="ds-btn sm" style={{ background: '#fff', border: '1px solid #e5e7eb' }} onClick={() => navigate("/app/pricing")}>Upgrade Plan</button>
                    </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                    
                    {/* Klaviyo Section */}
                    <div className="ds-card">
                        <div className="ds-card-header" style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ color: '#6366f1', display: 'flex' }}><Icon source={AppsIcon} /></div>
                                <div className="ds-card-title">Klaviyo Sync</div>
                            </div>
                            <span className={`ds-tag ${initialKlaviyo ? 'green' : 'red'}`}>
                                {initialKlaviyo ? "Connected" : "Disconnected"}
                            </span>
                        </div>
                        <p className="ds-card-subtitle" style={{ marginBottom: 24 }}>Automatically push TagBot AI segments into Klaviyo Profile Properties.</p>
                        <div className="ds-divider" style={{ margin: '0 0 20px' }} />

                        <div onClick={() => !isElitePlan && setIsEliteModalOpen(true)}>
                            <TextField
                                label="Klaviyo Private API Key"
                                value={klaviyoApiKey}
                                onChange={setKlaviyoApiKey}
                                autoComplete="off"
                                placeholder="pk_..."
                                helpText="Found in Klaviyo -> Settings -> API Keys. Requires 'Profiles' read/write scope."
                                disabled={!isElitePlan}
                                type="password"
                            />
                        </div>

                        <div style={{ marginTop: 20 }}>
                            <button 
                                className="ds-btn primary" 
                                disabled={!isElitePlan || isSaving} 
                                onClick={handleSaveKlaviyo}
                            >
                                {isSaving ? "Saving..." : "Save Klaviyo Settings"}
                            </button>
                        </div>
                    </div>

                    {/* Mailchimp Section */}
                    <div className="ds-card">
                        <div className="ds-card-header" style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ color: '#fbbf24', display: 'flex' }}><Icon source={AppsIcon} /></div>
                                <div className="ds-card-title">Mailchimp Sync</div>
                            </div>
                            <span className={`ds-tag ${initialMailchimp ? 'green' : 'red'}`}>
                                {initialMailchimp ? "Connected" : "Disconnected"}
                            </span>
                        </div>
                        <p className="ds-card-subtitle" style={{ marginBottom: 24 }}>Automatically push customers and tags into your Mailchimp Audiences.</p>
                        <div className="ds-divider" style={{ margin: '0 0 20px' }} />

                        <div onClick={() => !isElitePlan && setIsEliteModalOpen(true)}>
                            <BlockStack gap="400">
                                <TextField
                                    label="Mailchimp API Key"
                                    value={mailchimpApiKey}
                                    onChange={setMailchimpApiKey}
                                    autoComplete="off"
                                    placeholder="..."
                                    helpText="Your Mailchimp API key, generated in Account Settings."
                                    disabled={!isElitePlan}
                                    type="password"
                                />
                                <div className="ds-grid-2">
                                    <TextField
                                        label="Server Prefix"
                                        value={mailchimpServerPrefix}
                                        onChange={setMailchimpServerPrefix}
                                        autoComplete="off"
                                        placeholder="us14"
                                        helpText="The final segment of your API key."
                                        disabled={!isElitePlan}
                                    />
                                    <TextField
                                        label="Audience List ID"
                                        value={mailchimpListId}
                                        onChange={setMailchimpListId}
                                        autoComplete="off"
                                        placeholder="e.g. 8d3a1fb"
                                        helpText="Found in Mailchimp Audience Settings."
                                        disabled={!isElitePlan}
                                    />
                                </div>
                            </BlockStack>
                        </div>

                        <div style={{ marginTop: 24 }}>
                            <button 
                                className="ds-btn primary" 
                                disabled={!isElitePlan || isSaving} 
                                onClick={handleSaveMailchimp}
                            >
                                {isSaving ? "Saving..." : "Save Mailchimp Settings"}
                            </button>
                        </div>
                    </div>

                </div>
            </div>
        </Page>
    );
}
