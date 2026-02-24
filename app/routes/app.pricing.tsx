import { Page, Layout, Card, Text, BlockStack, Button, InlineStack, Box, Divider, List, Icon } from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import { authenticate, MONTHLY_PLAN } from "../shopify.server";
import { useLoaderData, useSubmit, useNavigation } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { getCachedStore, invalidateStoreCache } from "../services/cache.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);

    // Check current plan directly from our database instead of Shopify API
    const store = await getCachedStore(session.shop);

    return {
        currentPlanName: store?.planName || "Free",
        shop: session.shop
    };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { billing, session } = await authenticate.admin(request);
    const formData = await request.formData();
    const plan = formData.get("plan") as string;

    if (plan === "Growth Plan" || plan === "Pro Plan" || plan === "Elite Plan") {
        await billing.require({
            plans: [plan],
            isTest: true,
            onFailure: async () => billing.request({
                plan: plan,
                isTest: true,
                returnUrl: `https://${process.env.SHOP_CUSTOM_DOMAIN || "admin.shopify.com"}/store/app/pricing`,
            }),
        });

        // If they already had the plan, billing.require passes and we do nothing (or redirect).
        // The actual plan update in the DB should happen via webhook after successful payment.
        // However, if we are simulating an immediate update for testing or specific flow,
        // we would update the DB here and invalidate the cache.
        // For now, we assume the billing.require handles the redirect or success.
        return null;
    } else if (plan === "Free") {
        // This block handles downgrading to the Free plan
        await db.store.update({
            where: { shop: session.shop },
            data: { planName: "Free" }
        });
        invalidateStoreCache(session.shop);
        return { success: true, message: "Successfully downgraded to Free Plan." };
    }

    return null;
}

export default function Pricing() {
    const { currentPlanName } = useLoaderData<typeof loader>();
    const submit = useSubmit();
    const navigation = useNavigation();

    const handleSubscribe = (plan: string) => {
        submit({ plan }, { method: "post" });
    }

    return (
        <Page title="Upgrade Your Plan" backAction={{ content: "Dashboard", url: "/app" }}>
            <Layout>
                <Layout.Section>
                    <BlockStack gap="400" align="center">
                        <Box paddingBlockEnd="400">
                            <Text variant="headingXl" as="h1" alignment="center">
                                Unlock Smart Segmentation Power
                            </Text>
                            <Text variant="bodyLg" as="p" alignment="center" tone="subdued">
                                Choose the plan that fits your store's growth.
                            </Text>
                        </Box>

                        <InlineStack gap="400" align="center" blockAlign="stretch">

                            {/* Free Plan */}
                            <div style={{ flex: '1 1 250px', display: 'flex' }}>
                                <Card>
                                    <BlockStack gap="400">
                                        <Text variant="headingLg" as="h2">Free</Text>
                                        <Text variant="heading3xl" as="h3">$0<Text as="span" variant="bodyMd" tone="subdued">/mo</Text></Text>
                                        <Text as="p" variant="bodyMd" tone="subdued">Everything you need to try out automation.</Text>
                                        <Divider />
                                        <List>
                                            <List.Item>100 tags applied per month</List.Item>
                                            <List.Item>Basic Dashboard Analytics</List.Item>
                                        </List>
                                        <Box paddingBlockStart="400">
                                            <Button
                                                fullWidth
                                                disabled={currentPlanName === "Free" || currentPlanName === ""}
                                                onClick={() => handleSubscribe("Free")} // Added onClick for downgrade
                                            >
                                                {currentPlanName === "Free" || currentPlanName === "" ? "Current Plan" : "Downgrade"}
                                            </Button>
                                        </Box>
                                    </BlockStack>
                                </Card>
                            </div>

                            {/* Growth Plan */}
                            <div style={{ flex: '1 1 250px', display: 'flex' }}>
                                <Card>
                                    <BlockStack gap="400">
                                        <Text variant="headingLg" as="h2" tone="magic">Growth</Text>
                                        <Text variant="heading3xl" as="h3">$14.99<Text as="span" variant="bodyMd" tone="subdued">/mo</Text></Text>
                                        <Text as="p" variant="bodyMd" tone="subdued">For growing stores that need more volume.</Text>
                                        <Divider />
                                        <List>
                                            <List.Item>1,000 tags applied per month</List.Item>
                                            <List.Item>Basic Dashboard Analytics</List.Item>
                                            <List.Item>Email Support</List.Item>
                                        </List>
                                        <Box paddingBlockStart="400">
                                            <Button
                                                fullWidth
                                                variant={currentPlanName === "Growth Plan" ? "tertiary" : "primary"}
                                                disabled={currentPlanName === "Growth Plan"}
                                                onClick={() => handleSubscribe("Growth Plan")}
                                                loading={navigation.state === "submitting"}
                                            >
                                                {currentPlanName === "Growth Plan" ? "Current Plan" : "Upgrade to Growth"}
                                            </Button>
                                        </Box>
                                    </BlockStack>
                                </Card>
                            </div>

                            {/* Pro Plan */}
                            <div style={{ flex: '1 1 250px', display: 'flex', transform: 'scale(1.05)', zIndex: 1 }}>
                                <Card background="bg-surface-magic">
                                    <BlockStack gap="400">
                                        <InlineStack align="space-between">
                                            <Text variant="headingLg" as="h2" tone="magic">Pro</Text>
                                            <Box padding="100" background="bg-surface-brand" borderRadius="100">
                                                <Text as="span" variant="bodySm" tone="text-inverse">Most Popular</Text>
                                            </Box>
                                        </InlineStack>
                                        <Text variant="heading3xl" as="h3">$29.99<Text as="span" variant="bodyMd" tone="subdued">/mo</Text></Text>
                                        <Text as="p" variant="bodyMd" tone="subdued">Unlimited tagging with advanced insights.</Text>
                                        <Divider />
                                        <List>
                                            <List.Item><strong>Unlimited tags applied per month</strong></List.Item>
                                            <List.Item>AI Insights Engine</List.Item>
                                            <List.Item>CSV Data Export</List.Item>
                                        </List>
                                        <Box paddingBlockStart="400">
                                            <Button
                                                fullWidth
                                                variant={currentPlanName === "Pro Plan" ? "tertiary" : "primary"}
                                                tone="success"
                                                disabled={currentPlanName === "Pro Plan"}
                                                onClick={() => handleSubscribe("Pro Plan")}
                                                loading={navigation.state === "submitting"}
                                            >
                                                {currentPlanName === "Pro Plan" ? "Current Plan" : "Upgrade to Pro"}
                                            </Button>
                                        </Box>
                                    </BlockStack>
                                </Card>
                            </div>

                            {/* Elite Plan */}
                            <div style={{ flex: '1 1 250px', display: 'flex' }}>
                                <Card>
                                    <BlockStack gap="400">
                                        <Text variant="headingLg" as="h2">Elite</Text>
                                        <Text variant="heading3xl" as="h3">$49.99<Text as="span" variant="bodyMd" tone="subdued">/mo</Text></Text>
                                        <Text as="p" variant="bodyMd" tone="subdued">Enterprise features & external integrations.</Text>
                                        <Divider />
                                        <List>
                                            <List.Item><strong>Unlimited tags applied per month</strong></List.Item>
                                            <List.Item>Priority 24/7 Support</List.Item>
                                            <List.Item>Klaviyo / Mailchimp Sync (Coming Soon)</List.Item>
                                        </List>
                                        <Box paddingBlockStart="400">
                                            <Button
                                                fullWidth
                                                variant={currentPlanName === "Elite Plan" ? "tertiary" : "primary"}
                                                disabled={currentPlanName === "Elite Plan"}
                                                onClick={() => handleSubscribe("Elite Plan")}
                                                loading={navigation.state === "submitting"}
                                            >
                                                {currentPlanName === "Elite Plan" ? "Current Plan" : "Upgrade to Elite"}
                                            </Button>
                                        </Box>
                                    </BlockStack>
                                </Card>
                            </div>

                        </InlineStack>
                    </BlockStack>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
