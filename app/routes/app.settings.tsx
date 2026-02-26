import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useActionData, useNavigation, useNavigate } from "react-router";
import { Page, Layout, Card, BlockStack, Text, InlineStack, Banner, Checkbox, Button, Box, Icon, Modal } from "@shopify/polaris";
import { SettingsIcon, CheckIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCachedStore, invalidateStoreCache } from "../services/cache.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const store = await getCachedStore(shop);

    if (!store) {
        throw new Response("Store not found", { status: 404 });
    }

    return {
        syncTagsToNotes: store.syncTagsToNotes,
        enableSentimentAnalysis: store.enableSentimentAnalysis, // Added this line
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
        const enableSentimentAnalysis = formData.get("enableSentimentAnalysis") === "true"; // Added this line
        const klaviyoApiKey = formData.get("klaviyoApiKey") as string;

        await db.store.update({
            where: { shop },
            data: {
                syncTagsToNotes,
                enableSentimentAnalysis, // Added this line
                klaviyoApiKey: klaviyoApiKey.trim() === "" ? null : klaviyoApiKey.trim()
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

    // State definitions
    const [syncTagsToNotes, setSyncTagsToNotes] = useState(initialSyncTagsToNotes);
    const [enableSentimentAnalysis, setEnableSentimentAnalysis] = useState(initialEnableSentimentAnalysis); // Added this line
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
        <Page
            title="App Settings"
            subtitle="Configure your TagBot AI preferences."
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
                                The <strong>Automated Customer Note Sync</strong> feature is available on our <strong>Pro</strong> and <strong>Elite</strong> plans.
                                Upgrade your subscription to unlock AI-powered CRM insights.
                            </Text>
                        </BlockStack>
                    </Modal.Section>
                </Modal>

                <Layout.Section>
                    {actionData?.success && (
                        <Box paddingBlockEnd="400">
                            <Banner tone="success" title={actionData.message} />
                        </Box>
                    )}
                    {actionData?.success === false && actionData.message && (
                        <Box paddingBlockEnd="400">
                            <Banner tone="critical" title={actionData.message} />
                        </Box>
                    )}

                    <Card>
                        <BlockStack gap="400">
                            <InlineStack gap="200" align="start" blockAlign="center">
                                <Icon source={SettingsIcon} tone="base" />
                                <Text variant="headingMd" as="h3">General Preferences</Text>
                            </InlineStack>

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

                            <Box paddingBlockStart="400">
                                <Button size="large" variant="primary" icon={CheckIcon} loading={isSaving} onClick={handleSave}>
                                    Save Settings
                                </Button>
                            </Box>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
