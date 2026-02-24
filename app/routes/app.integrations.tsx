import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useActionData, useNavigation, useNavigate } from "react-router";
import { Page, Layout, Card, BlockStack, Text, InlineStack, Banner, Button, Box, Icon, Modal, TextField, Divider, Badge } from "@shopify/polaris";
import { AppsIcon, CheckCircleIcon, XSmallIcon } from "@shopify/polaris-icons";
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
        <Page
            title="Marketing Integrations"
            subtitle="Connect your external platforms to auto-sync TagBot AI segments."
        >
            <Layout>
                <Modal
                    open={isEliteModalOpen}
                    onClose={() => setIsEliteModalOpen(false)}
                    title="Upgrade to Elite"
                    primaryAction={{
                        content: 'View Plans',
                        onAction: () => navigate('/app/pricing'),
                    }}
                    secondaryActions={[
                        {
                            content: 'Cancel',
                            onAction: () => setIsEliteModalOpen(false),
                        },
                    ]}
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

                <Layout.Section>
                    {actionData?.success && (
                        <Box paddingBlockEnd="400">
                            <Banner tone="success" title={actionData.message} />
                        </Box>
                    )}

                    {!isElitePlan && (
                        <Box paddingBlockEnd="400">
                            <Banner tone="warning" title="Elite Plan Required">
                                <Text as="p">You must be on the Elite plan to activate external marketing integrations.</Text>
                            </Banner>
                        </Box>
                    )}

                    {/* Klaviyo Section */}
                    <Box paddingBlockEnd="400">
                        <Card>
                            <BlockStack gap="400">
                                <InlineStack gap="200" align="start" blockAlign="center" wrap={false}>
                                    <div style={{ flexGrow: 1 }}>
                                        <InlineStack gap="200" align="start" blockAlign="center">
                                            <Icon source={AppsIcon} tone="base" />
                                            <Text variant="headingMd" as="h3">Klaviyo Sync</Text>
                                        </InlineStack>
                                    </div>
                                    <Box>
                                        {initialKlaviyo ? (
                                            <Badge tone="success" icon={CheckCircleIcon}>Connected</Badge>
                                        ) : (
                                            <Badge tone="critical" icon={XSmallIcon}>Disconnected</Badge>
                                        )}
                                    </Box>
                                </InlineStack>

                                <Text as="p" tone="subdued">Automatically push TagBot AI segments into Klaviyo Profile Properties.</Text>
                                <Divider />

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

                                <Box paddingBlockStart="200">
                                    <InlineStack align="start">
                                        <Button disabled={!isElitePlan} loading={isSaving} onClick={handleSaveKlaviyo}>
                                            Save Klaviyo Settings
                                        </Button>
                                    </InlineStack>
                                </Box>
                            </BlockStack>
                        </Card>
                    </Box>

                    {/* Mailchimp Section */}
                    <Box paddingBlockEnd="400">
                        <Card>
                            <BlockStack gap="400">
                                <InlineStack gap="200" align="start" blockAlign="center" wrap={false}>
                                    <div style={{ flexGrow: 1 }}>
                                        <InlineStack gap="200" align="start" blockAlign="center">
                                            <Icon source={AppsIcon} tone="base" />
                                            <Text variant="headingMd" as="h3">Mailchimp Sync</Text>
                                        </InlineStack>
                                    </div>
                                    <Box>
                                        {initialMailchimp ? (
                                            <Badge tone="success" icon={CheckCircleIcon}>Connected</Badge>
                                        ) : (
                                            <Badge tone="critical" icon={XSmallIcon}>Disconnected</Badge>
                                        )}
                                    </Box>
                                </InlineStack>

                                <Text as="p" tone="subdued">Automatically push customers and apply tags within your Mailchimp Audiences.</Text>
                                <Divider />

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
                                        <TextField
                                            label="Server Prefix (Data Center)"
                                            value={mailchimpServerPrefix}
                                            onChange={setMailchimpServerPrefix}
                                            autoComplete="off"
                                            placeholder="us14"
                                            helpText="The final segment of your API key (e.g. if key is xxx-us14, prefix is us14)."
                                            disabled={!isElitePlan}
                                        />
                                        <TextField
                                            label="Audience List ID"
                                            value={mailchimpListId}
                                            onChange={setMailchimpListId}
                                            autoComplete="off"
                                            placeholder="e.g. 8d3a1fb"
                                            helpText="The specific Audience ID to sync to. Found in Mailchimp Audience Settings."
                                            disabled={!isElitePlan}
                                        />
                                    </BlockStack>
                                </div>

                                <Box paddingBlockStart="200">
                                    <InlineStack align="start">
                                        <Button disabled={!isElitePlan} loading={isSaving} onClick={handleSaveMailchimp}>
                                            Save Mailchimp Settings
                                        </Button>
                                    </InlineStack>
                                </Box>
                            </BlockStack>
                        </Card>
                    </Box>

                </Layout.Section>
            </Layout>
        </Page>
    );
}
