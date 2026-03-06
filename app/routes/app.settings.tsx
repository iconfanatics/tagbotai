import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useActionData, useNavigation, useNavigate } from "react-router";
import { Page, Layout, Text, BlockStack, InlineStack, Checkbox, Box, Icon, Modal } from "@shopify/polaris";
import { SettingsIcon, CheckIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCachedStore, invalidateStoreCache } from "../services/cache.server";
import "../styles/app-design-system.css";

// ... (loader and action remain unchanged above line 56, so I will replace the main UI)
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const store = await getCachedStore(shop);

    if (!store) {
        throw new Response("Store not found", { status: 404 });
    }

    return {
        syncTagsToNotes: store.syncTagsToNotes,
        enableSentimentAnalysis: store.enableSentimentAnalysis,
        currentPlanName: store.planName
    };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const formData = await request.formData();
    const actionType = formData.get("action");

    if (actionType === "save_settings") {
        const syncTagsToNotes = formData.get("syncTagsToNotes") === "true";
        const enableSentimentAnalysis = formData.get("enableSentimentAnalysis") === "true";

        await db.store.update({
            where: { shop },
            data: {
                syncTagsToNotes,
                enableSentimentAnalysis,
            }
        });

        invalidateStoreCache(shop);

        return { success: true, message: "Settings saved successfully." };
    }

    return { success: false, message: "Unknown action" };
};

export default function Settings() {
    const { syncTagsToNotes: initialSyncTagsToNotes, enableSentimentAnalysis: initialEnableSentimentAnalysis, currentPlanName } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const navigate = useNavigate();

    const isSaving = navigation.state === "submitting";

    const [syncTagsToNotes, setSyncTagsToNotes] = useState(initialSyncTagsToNotes);
    const [enableSentimentAnalysis, setEnableSentimentAnalysis] = useState(initialEnableSentimentAnalysis);
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);

    const isFreePlan = currentPlanName === "Free" || currentPlanName === "";

    const handleToggle = (newChecked: boolean) => {
        if (isFreePlan) {
            setIsUpgradeModalOpen(true);
        } else {
            setSyncTagsToNotes(newChecked);
        }
    };

    const handleSentimentToggle = (newChecked: boolean) => {
        if (isFreePlan) {
            setIsUpgradeModalOpen(true);
        } else {
            setEnableSentimentAnalysis(newChecked);
        }
    };

    const handleSave = () => {
        submit({
            action: "save_settings",
            syncTagsToNotes: syncTagsToNotes ? "true" : "false",
            enableSentimentAnalysis: enableSentimentAnalysis ? "true" : "false"
        }, { method: "post" });
    };

    return (
        <Page backAction={{ content: "Dashboard", url: "/app" }}>
            <div className="ds-page" style={{ maxWidth: 800, margin: '0 auto', paddingBottom: 60 }}>
                
                <div style={{ padding: '24px 0' }}>
                    <h1 style={{ fontSize: 26, fontWeight: 800, color: '#1a1a2e', margin: '0 0 6px', letterSpacing: '-0.5px' }}>
                        ⚙️ App Settings
                    </h1>
                    <p style={{ fontSize: 14, color: '#9ca3af', margin: 0 }}>Configure TagBot AI automation preferences.</p>
                </div>

                <Modal
                    open={isUpgradeModalOpen}
                    onClose={() => setIsUpgradeModalOpen(false)}
                    title="Upgrade to Pro"
                    primaryAction={{
                        content: 'View Plans',
                        onAction: () => navigate('/app/pricing'),
                    }}
                    secondaryActions={[{ content: 'Cancel', onAction: () => setIsUpgradeModalOpen(false) }]}
                >
                    <Modal.Section>
                        <BlockStack gap="300">
                            <Text as="p">
                                The <strong>Automated Customer Note Sync</strong> feature is available on our <strong>Pro</strong> and <strong>Elite</strong> plans.
                                Upgrade your subscription to unlock AI-powered CRM insights.
                            </Text>
                        </BlockStack>
                    </Modal.Section>
                </Modal>

                {actionData?.message && (
                    <div className={`ds-alert ${actionData.success ? 'success' : 'error'}`} style={{ marginBottom: 24 }}>
                        {actionData.message}
                    </div>
                )}

                <div className="ds-card">
                    <div className="ds-card-header" style={{ marginBottom: 24 }}>
                        <InlineStack gap="200" align="start" blockAlign="center">
                            <div style={{ color: '#1a1a2e', display: 'flex' }}><Icon source={SettingsIcon} /></div>
                            <div className="ds-card-title" style={{ fontSize: 18 }}>General Preferences</div>
                        </InlineStack>
                    </div>

                    <BlockStack gap="500">
                        <Checkbox
                            label="Sync Tags to Customer Notes"
                            helpText="When an automated rule is triggered, append a contextual insight directly into the Shopify Customer Note field (e.g., 'TagBot AI Alert: Applied VIP tag due to rule match')."
                            checked={syncTagsToNotes}
                            onChange={handleToggle}
                        />

                        <Checkbox
                            label="AI Order Note Sentiment Analysis"
                            helpText="Automatically scan incoming Shopify Order Notes using Natural Language Processing to detect intent and instantly apply labels like 'Gifting' or 'Frustrated'."
                            checked={enableSentimentAnalysis}
                            onChange={handleSentimentToggle}
                        />
                    </BlockStack>

                    <div className="ds-divider" style={{ margin: '24px 0' }} />

                    <InlineStack align="end">
                        <button 
                            className="ds-btn primary lg" 
                            disabled={isSaving} 
                            onClick={handleSave}
                        >
                            {isSaving ? "Saving..." : "Save Settings"}
                        </button>
                    </InlineStack>
                </div>
            </div>
        </Page>
    );
}
