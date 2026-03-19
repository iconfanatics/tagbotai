import { useState, useEffect } from "react";
import crypto from "crypto";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useActionData, useNavigation, useNavigate } from "react-router";
import { Page, Layout, Card, BlockStack, Text, InlineStack, Banner, Button, Box, Icon, Modal, TextField, Divider, Badge, List } from "@shopify/polaris";
import { AppsIcon, CheckCircleIcon, XSmallIcon, SaveIcon, LinkIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { enqueueMarketingBulkSyncJob } from "../services/queue.server";
import { generatePKCE, getKlaviyoAuthUrl, klaviyoSessionStorage } from "../services/klaviyo.server";
import { redirect } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const store = await db.store.findUnique({ where: { shop } });

    if (!store) {
        throw new Response("Store not found", { status: 404 });
    }

    const klaviyoRules = await db.rule.findMany({
        where: { storeId: store.id, isActive: true, syncToKlaviyo: true },
        select: { id: true, name: true, targetTag: true }
    });

    const mailchimpRules = await db.rule.findMany({
        where: { storeId: store.id, isActive: true, syncToMailchimp: true },
        select: { id: true, name: true, targetTag: true }
    });

    return {
        storeId: store.id,
        klaviyoApiKey: store.klaviyoApiKey || "",
        klaviyoIsActive: store.klaviyoIsActive,
        klaviyoAccessToken: store.klaviyoAccessToken,
        mailchimpApiKey: store.mailchimpApiKey || "",
        mailchimpServerPrefix: store.mailchimpServerPrefix || "",
        mailchimpListId: store.mailchimpListId || "",
        currentPlanName: store.planName,
        klaviyoSyncInProgress: store.klaviyoSyncInProgress,
        mailchimpSyncInProgress: store.mailchimpSyncInProgress,
        klaviyoRules,
        mailchimpRules
    };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const formData = await request.formData();
    const actionType = formData.get("action");

    if (actionType === "init_klaviyo_oauth") {
        const { verifier, challenge } = generatePKCE();
        const state = `${shop}:${crypto.randomUUID()}`;
        const clientId = process.env.KLAVIYO_CLIENT_ID;
        const appUrl = process.env.SHOPIFY_APP_URL || `https://${new URL(request.url).host}`;
        const redirectUri = `${appUrl}/app/integrations/klaviyo/callback`;
        const scope = "accounts:read profiles:read profiles:write";

        if (!clientId) return { success: false, message: "Klaviyo Client ID not configured in Vercel." };

        const authUrl = getKlaviyoAuthUrl(clientId, redirectUri, scope, state, challenge);

        const kSession = await klaviyoSessionStorage.getSession();
        kSession.set("state", state);
        kSession.set("verifier", verifier);
        kSession.set("shop", shop);

        return new Response(JSON.stringify({ authUrl }), {
            headers: {
                "Set-Cookie": await klaviyoSessionStorage.commitSession(kSession),
                "Content-Type": "application/json"
            }
        });
    }

    if (actionType === "disconnect_klaviyo") {
        await db.store.update({
            where: { shop },
            data: {
                klaviyoAccessToken: null,
                klaviyoRefreshToken: null,
                klaviyoIsActive: false,
                klaviyoApiKey: null
            }
        });
        return { success: true, message: "Klaviyo disconnected successfully." };
    }

    if (actionType === "toggle_klaviyo") {
        const store = await db.store.findUnique({ where: { shop } });
        await db.store.update({
            where: { shop },
            data: { klaviyoIsActive: !store?.klaviyoIsActive }
        });
        return { success: true, message: `Klaviyo integration ${!store?.klaviyoIsActive ? 'activated' : 'deactivated'}.` };
    }

    if (actionType === "reset_sync_klaviyo") {
        await db.store.update({
            where: { shop },
            data: { klaviyoSyncInProgress: false }
        });
        return { success: true, message: "Klaviyo sync status reset." };
    }

    if (actionType === "reset_sync_mailchimp") {
        await db.store.update({
            where: { shop },
            data: { mailchimpSyncInProgress: false }
        });
        return { success: true, message: "Mailchimp sync status reset." };
    }

    if (actionType === "save_klaviyo") {
        const klaviyoApiKey = formData.get("klaviyoApiKey") as string;
        await db.store.update({
            where: { shop },
            data: { klaviyoApiKey: klaviyoApiKey.trim() === "" ? null : klaviyoApiKey.trim() }
        });
        return { success: true, message: "Klaviyo settings saved." };
    }

    if (actionType === "disconnect_mailchimp") {
        await db.store.update({
            where: { shop },
            data: {
                mailchimpApiKey: null,
                mailchimpServerPrefix: null,
                mailchimpListId: null
            }
        });
        return { success: true, message: "Mailchimp disconnected successfully." };
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

    if (actionType === "bulk_sync_klaviyo") {
        const storeId = formData.get("storeId") as string;
        // Fix for infinite spinner: ensure we wrap in a try-catch and set flag to true
        await db.store.update({ where: { shop }, data: { klaviyoSyncInProgress: true } });
        try {
            await enqueueMarketingBulkSyncJob({ shop, storeId, platform: "klaviyo" });
        } catch (e) {
            await db.store.update({ where: { shop }, data: { klaviyoSyncInProgress: false } });
            throw e;
        }
        return { success: true, message: "Klaviyo Bulk Sync Started. This runs in the background." };
    }

    if (actionType === "bulk_sync_mailchimp") {
        const storeId = formData.get("storeId") as string;
        await db.store.update({ where: { shop }, data: { mailchimpSyncInProgress: true } });
        try {
            await enqueueMarketingBulkSyncJob({ shop, storeId, platform: "mailchimp" });
        } catch (e) {
            await db.store.update({ where: { shop }, data: { mailchimpSyncInProgress: false } });
            throw e;
        }
        return { success: true, message: "Mailchimp Bulk Sync Started. This runs in the background." };
    }

    return { success: false, message: "Unknown action" };
};

export default function Integrations() {
    const {
        storeId,
        klaviyoApiKey: initialKlaviyo,
        mailchimpApiKey: initialMailchimp,
        mailchimpServerPrefix: initialServer,
        mailchimpListId: initialListId,
        currentPlanName,
        klaviyoIsActive,
        klaviyoAccessToken,
        klaviyoSyncInProgress,
        mailchimpSyncInProgress,
        klaviyoRules,
        mailchimpRules
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

    // Handle Top-Level Redirect for OAuth out of the iframe
    useEffect(() => {
        if (actionData && "authUrl" in actionData && typeof actionData.authUrl === "string") {
            window.open(actionData.authUrl, "_top");
        }
    }, [actionData]);

    const handleConnectKlaviyo = () => {
        submit({ action: "init_klaviyo_oauth" }, { method: "post" });
    };

    const handleDisconnectKlaviyo = () => {
        if (confirm("Are you sure you want to disconnect Klaviyo? This will clear your credentials.")) {
            submit({ action: "disconnect_klaviyo" }, { method: "post" });
        }
    };

    const handleToggleKlaviyo = () => {
        submit({ action: "toggle_klaviyo" }, { method: "post" });
    };

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

    const triggerBulkSync = (platform: "klaviyo" | "mailchimp") => {
        submit({ action: platform === "klaviyo" ? "bulk_sync_klaviyo" : "bulk_sync_mailchimp", storeId }, { method: "post" });
    };

    const handleDisconnectMailchimp = () => {
        if (confirm("Are you sure you want to disconnect Mailchimp? This will clear your API key and Audience ID.")) {
            submit({ action: "disconnect_mailchimp" }, { method: "post" });
        }
    };

    const handleResetSync = (platform: "klaviyo" | "mailchimp") => {
        submit({ action: platform === "klaviyo" ? "reset_sync_klaviyo" : "reset_sync_mailchimp" }, { method: "post" });
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
                            <Banner
                                tone="warning"
                                title="Elite Plan Required"
                                action={{ content: 'Upgrade Plan', onAction: () => navigate('/app/pricing') }}
                            >
                                <Text as="p">You must be on the Elite plan to activate external marketing integrations.</Text>
                            </Banner>
                        </Box>
                    )}
                </Layout.Section>

                {/* Klaviyo Section */}
                <Layout.AnnotatedSection
                    id="klaviyo-integration"
                    title="Klaviyo Sync"
                    description="Automatically push TagBot AI segments into Klaviyo Profile Properties to trigger highly targeted email and SMS campaigns."
                >
                    <div className="premium-card">
                        <Box padding="500">
                            <BlockStack gap="400">
                                <InlineStack align="space-between" blockAlign="center">
                                    <InlineStack gap="200" align="start" blockAlign="center">
                                        <Icon source={AppsIcon} tone="base" />
                                        <Text variant="headingMd" as="h3">Klaviyo Configuration</Text>
                                    </InlineStack>
                                    <Box>
                                        {klaviyoAccessToken ? (
                                            klaviyoIsActive ? (
                                                <Badge tone="success" icon={CheckCircleIcon}>Active</Badge>
                                            ) : (
                                                <Badge tone="attention">Paused</Badge>
                                            )
                                        ) : initialKlaviyo ? (
                                            <Badge tone="info">Connected (Legacy)</Badge>
                                        ) : (
                                            <Badge tone="critical" icon={XSmallIcon}>Not Connected</Badge>
                                        )}
                                    </Box>
                                </InlineStack>

                                <Divider />

                                <div onClick={() => !isElitePlan && setIsEliteModalOpen(true)}>
                                    <BlockStack gap="400">
                                        {!klaviyoAccessToken ? (
                                            <Box paddingBlock="200">
                                                <BlockStack gap="300">
                                                    <Text as="p">Connect your Klaviyo account via OAuth for the best experience. Legacy API keys are still supported in the background if configured.</Text>
                                                    <div style={{ maxWidth: "200px" }}>
                                                        <Button 
                                                            variant="primary" 
                                                            onClick={handleConnectKlaviyo} 
                                                            disabled={!isElitePlan}
                                                            loading={isSaving}
                                                            icon={AppsIcon}
                                                        >
                                                            Connect Klaviyo
                                                        </Button>
                                                    </div>
                                                </BlockStack>
                                            </Box>
                                        ) : (
                                            <Box paddingBlock="200">
                                                <BlockStack gap="300">
                                                    <InlineStack gap="400" align="start" blockAlign="center">
                                                        <Text as="p" fontWeight="bold">Status: {klaviyoIsActive ? "Currently Syncing" : "Syncing Paused"}</Text>
                                                        <Button 
                                                            tone={klaviyoIsActive ? "critical" : "success"}
                                                            onClick={handleToggleKlaviyo}
                                                            variant="secondary"
                                                        >
                                                            {klaviyoIsActive ? "Deactivate Sync" : "Activate Sync"}
                                                        </Button>
                                                        <Button 
                                                            tone="critical" 
                                                            variant="tertiary" 
                                                            onClick={handleDisconnectKlaviyo}
                                                        >
                                                            Disconnect Account
                                                        </Button>
                                                    </InlineStack>
                                                    
                                                    {!klaviyoIsActive && (
                                                        <Banner tone="info">
                                                            <p>Your connection is active, but real-time syncing is paused. Reactivate to resume pushing tags.</p>
                                                        </Banner>
                                                    )}
                                                </BlockStack>
                                            </Box>
                                        )}
                                        
                                        {/* Hidden Legacy Section - Only visible if merchant specifically has an API key but no OAuth */}
                                        {initialKlaviyo && !klaviyoAccessToken && (
                                            <Box paddingBlockStart="200">
                                                <Divider />
                                                <Box paddingBlock="200">
                                                    <BlockStack gap="200">
                                                        <Text variant="headingSm" as="h4">Legacy Configuration Detected</Text>
                                                        <Text as="p" tone="subdued">You are currently using a manual API key. We recommend switching to the "Connect Klaviyo" button above for a more secure connection.</Text>
                                                        <div style={{ maxWidth: "200px" }}>
                                                            <Button 
                                                                tone="critical" 
                                                                variant="secondary" 
                                                                onClick={handleDisconnectKlaviyo}
                                                                icon={XSmallIcon}
                                                            >
                                                                Disconnect Legacy API
                                                            </Button>
                                                        </div>
                                                    </BlockStack>
                                                </Box>
                                            </Box>
                                        )}
                                    </BlockStack>
                                </div>

                                {klaviyoRules.length > 0 && (klaviyoAccessToken || initialKlaviyo) && (
                                    <Box paddingBlockStart="200">
                                        <Text variant="headingSm" as="h4">Active Synced Segments</Text>
                                        <Text as="p" tone="subdued">The following Tags are currently configured to push to Klaviyo. Use the Bulk Sync button to push all existing historical customers that match these tags.</Text>
                                        <div style={{ marginTop: "10px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                            {klaviyoRules.map(r => (
                                                <Badge key={r.id} tone="info">{`${r.name} (${r.targetTag})`}</Badge>
                                            ))}
                                        </div>
                                    </Box>
                                )}

                                <Box paddingBlockStart="200">
                                    <InlineStack align="start" gap="300">
                                        {(klaviyoAccessToken || initialKlaviyo) && klaviyoRules.length > 0 && (
                                            <InlineStack gap="200">
                                                <Button disabled={!isElitePlan || klaviyoSyncInProgress} loading={klaviyoSyncInProgress} onClick={() => triggerBulkSync("klaviyo")}>
                                                    {klaviyoSyncInProgress ? "Syncing..." : "Bulk Sync Historical Data"}
                                                </Button>
                                                {klaviyoSyncInProgress && (
                                                    <Button variant="tertiary" tone="critical" onClick={() => handleResetSync("klaviyo")}>
                                                        Force Stop / Reset Status
                                                    </Button>
                                                )}
                                            </InlineStack>
                                        )}
                                    </InlineStack>
                                </Box>
                                
                                {/* Tutorial Section */}
                                <Box paddingBlockStart="400">
                                    <Divider />
                                    <Box paddingBlockStart="400">
                                        <BlockStack gap="300">
                                            <Text variant="headingSm" as="h4">How to Use TagBot Segments in Klaviyo</Text>
                                            <Text as="p">TagBot AI pushes your tags into Klaviyo as a Custom Property called <Text as="span" fontWeight="bold">TagBot_Segments</Text>. Follow these steps to use them in your campaigns:</Text>
                                            <List type="number">
                                                <List.Item>In your Klaviyo dashboard, go to <b>Audience &gt; Lists &amp; Segments</b>.</List.Item>
                                                <List.Item>Click <b>Create List / Segment</b> and choose <b>Segment</b>.</List.Item>
                                                <List.Item>Select <b>Properties about someone</b>, choose <b>TagBot_Segments</b> as the Dimension, and set the condition to <b>contains</b>.</List.Item>
                                                <List.Item>Type the exact name of the tag (e.g., <Text as="span" tone="subdued" fontWeight="bold">vip</Text>) and click <b>Create Segment</b>.</List.Item>
                                            </List>
                                            <Text as="p" tone="subdued">You can now use this dynamically updating Segment to select recipients for Campaigns or to trigger automated Flows!</Text>
                                        </BlockStack>
                                    </Box>
                                </Box>
                            </BlockStack>
                        </Box>
                    </div>
                </Layout.AnnotatedSection>

                {/* Mailchimp Section */}
                <Layout.AnnotatedSection
                    id="mailchimp-integration"
                    title="Mailchimp Sync"
                    description="Automatically push customers and apply tags within your Mailchimp Audiences based on intelligent TagBot Rules."
                >
                    <div className="premium-card">
                        <Box padding="500">
                            <BlockStack gap="400">
                                <InlineStack align="space-between" blockAlign="center">
                                    <InlineStack gap="200" align="start" blockAlign="center">
                                        <Icon source={AppsIcon} tone="base" />
                                        <Text variant="headingMd" as="h3">Mailchimp Configuration</Text>
                                    </InlineStack>
                                    <Box>
                                        {initialMailchimp ? (
                                            <Badge tone="success" icon={CheckCircleIcon}>Connected</Badge>
                                        ) : (
                                            <Badge tone="critical" icon={XSmallIcon}>Disconnected</Badge>
                                        )}
                                    </Box>
                                </InlineStack>

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

                                    {mailchimpRules.length > 0 && initialMailchimp && (
                                        <Box paddingBlockStart="200">
                                            <Text variant="headingSm" as="h4">Active Synced Segments</Text>
                                            <Text as="p" tone="subdued">The following Tags are currently configured to push to Mailchimp. Use the Bulk Sync button to push all existing historical customers that match these tags.</Text>
                                            <div style={{ marginTop: "10px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                                {mailchimpRules.map(r => (
                                                    <Badge key={r.id} tone="info">{`${r.name} (${r.targetTag})`}</Badge>
                                                ))}
                                            </div>
                                        </Box>
                                    )}

                                    <Box paddingBlockStart="200">
                                        <InlineStack align="start" gap="300">
                                            <div className="btn-premium">
                                                <InlineStack gap="200">
                                                    <Button disabled={!isElitePlan} loading={isSaving} icon={SaveIcon} onClick={handleSaveMailchimp} variant="primary">
                                                        Save Settings
                                                    </Button>
                                                    {initialMailchimp && (
                                                        <Button tone="critical" onClick={handleDisconnectMailchimp} variant="secondary">
                                                            Disconnect
                                                        </Button>
                                                    )}
                                                </InlineStack>
                                            </div>
                                            {initialMailchimp && mailchimpRules.length > 0 && (
                                                <Button disabled={!isElitePlan || mailchimpSyncInProgress} loading={mailchimpSyncInProgress} onClick={() => triggerBulkSync("mailchimp")}>
                                                    {mailchimpSyncInProgress ? "Syncing..." : "Bulk Sync Historical Data"}
                                                </Button>
                                            )}
                                        </InlineStack>
                                    </Box>
                            </BlockStack>
                        </Box>
                    </div>
                </Layout.AnnotatedSection>

            </Layout>
        </Page>
    );
}
