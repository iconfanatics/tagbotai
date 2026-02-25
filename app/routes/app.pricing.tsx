import { Page, Layout, Card, Text, BlockStack, Button, InlineStack, Box, Divider, List, Badge, Icon } from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import { authenticate, MONTHLY_PLAN } from "../shopify.server";
import { useLoaderData, useSubmit, useActionData } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
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
    const url = new URL(request.url);

    if (plan === "Growth Plan" || plan === "Pro Plan" || plan === "Elite Plan") {
        try {
            await billing.require({
                plans: [plan],
                isTest: true,
                onFailure: async () => billing.request({
                    plan: plan,
                    isTest: true,
                    returnUrl: `https://${url.host}/app/pricing`,
                }),
            });
        } catch (error: any) {
            // If the error is a redirect Response from billing.request, throw it so React Router handles it
            if (error instanceof Response) {
                throw error;
            }
            // Otherwise, it's a genuine API error from Shopify (e.g. cannot use isTest=true on live store)
            console.error("[BILLING_ERROR]", error);
            return { success: false, message: `Billing Error: ${error.message || String(error)}` };
        }

        // If Shopify says they ALREADY have the plan, update the local DB
        await db.store.update({
            where: { shop: session.shop },
            data: { planName: plan }
        });
        invalidateStoreCache(session.shop);
        return { success: true, message: `Successfully upgraded to ${plan}.` };
    } else if (plan === "Free") {
        // This block handles downgrading to the Free plan
        await db.store.update({
            where: { shop: session.shop },
            data: { planName: "Free" }
        });
        invalidateStoreCache(session.shop);
        return { success: true, message: "Successfully downgraded to Free Plan." };
    }

    return { success: false, message: "Invalid plan selection." };
}

export default function Pricing() {
    const shopify = useAppBridge();
    const { currentPlanName } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

    useEffect(() => {
        if (actionData?.message) {
            shopify.toast.show(actionData.message, { isError: !actionData.success });
        }
    }, [actionData]);

    const handleSubscribe = (plan: string) => {
        setLoadingPlan(plan);
        submit({ plan }, { method: "post" });
    }

    return (
        <Page title="Upgrade Your Plan" backAction={{ content: "Dashboard", url: "/app" }}>
            <style>{`
                .pricing-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                    gap: 16px;
                    align-items: stretch;
                }
                .pricing-card {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                }
                .pricing-card .Polaris-Card {
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                }
                .pricing-card-content {
                    flex-grow: 1;
                    display: flex;
                    flex-direction: column;
                }
                .pricing-features {
                    flex-grow: 1;
                    padding-top: 12px;
                }
                .pricing-action {
                    margin-top: auto;
                    padding-top: 24px;
                }
                .pro-card .Polaris-Card {
                    border: 2px solid var(--p-color-border-magic);
                    box-shadow: var(--p-shadow-300);
                }
            `}</style>
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

                        <div className="pricing-grid">

                            {/* Free Plan */}
                            <div className="pricing-card">
                                <Card>
                                    <div className="pricing-card-content">
                                        <BlockStack gap="400">
                                            <Text variant="headingLg" as="h2">Free</Text>
                                            <Text variant="heading3xl" as="h3">$0<Text as="span" variant="bodyMd" tone="subdued">/mo</Text></Text>
                                            <Text as="p" variant="bodyMd" tone="subdued">Everything you need to try out automation.</Text>
                                            <Divider />
                                            <div className="pricing-features">
                                                <List>
                                                    <List.Item>100 tags applied per month</List.Item>
                                                    <List.Item>Basic Dashboard Analytics</List.Item>
                                                </List>
                                            </div>
                                        </BlockStack>
                                        <div className="pricing-action">
                                            <Button
                                                fullWidth
                                                disabled={currentPlanName === "Free" || currentPlanName === ""}
                                                onClick={() => handleSubscribe("Free")}
                                                loading={loadingPlan === "Free"}
                                            >
                                                {currentPlanName === "Free" || currentPlanName === "" ? "Current Plan" : "Downgrade"}
                                            </Button>
                                        </div>
                                    </div>
                                </Card>
                            </div>

                            {/* Growth Plan */}
                            <div className="pricing-card">
                                <Card>
                                    <div className="pricing-card-content">
                                        <BlockStack gap="400">
                                            <Text variant="headingLg" as="h2" tone="magic">Growth</Text>
                                            <Text variant="heading3xl" as="h3">$14.99<Text as="span" variant="bodyMd" tone="subdued">/mo</Text></Text>
                                            <Text as="p" variant="bodyMd" tone="subdued">For growing stores that need more volume.</Text>
                                            <Divider />
                                            <div className="pricing-features">
                                                <List>
                                                    <List.Item>1,000 tags applied per month</List.Item>
                                                    <List.Item>Basic Dashboard Analytics</List.Item>
                                                    <List.Item>Email Support</List.Item>
                                                </List>
                                            </div>
                                        </BlockStack>
                                        <div className="pricing-action">
                                            <Button
                                                fullWidth
                                                variant={currentPlanName === "Growth Plan" ? "tertiary" : "primary"}
                                                disabled={currentPlanName === "Growth Plan"}
                                                onClick={() => handleSubscribe("Growth Plan")}
                                                loading={loadingPlan === "Growth Plan"}
                                            >
                                                {currentPlanName === "Growth Plan" ? "Current Plan" : "Upgrade to Growth"}
                                            </Button>
                                        </div>
                                    </div>
                                </Card>
                            </div>

                            {/* Pro Plan */}
                            <div className="pricing-card pro-card">
                                <Card background="bg-surface-magic">
                                    <div className="pricing-card-content">
                                        <BlockStack gap="400">
                                            <InlineStack align="space-between" blockAlign="center">
                                                <Text variant="headingLg" as="h2" tone="magic">Pro</Text>
                                                <Badge tone="magic">Most Popular</Badge>
                                            </InlineStack>
                                            <Text variant="heading3xl" as="h3">$29.99<Text as="span" variant="bodyMd" tone="subdued">/mo</Text></Text>
                                            <Text as="p" variant="bodyMd" tone="subdued">Unlimited tagging with advanced insights.</Text>
                                            <Divider />
                                            <div className="pricing-features">
                                                <List>
                                                    <List.Item><strong>Unlimited tags applied</strong></List.Item>
                                                    <List.Item>AI Insights Engine</List.Item>
                                                    <List.Item>CSV Data Export</List.Item>
                                                </List>
                                            </div>
                                        </BlockStack>
                                        <div className="pricing-action">
                                            <Button
                                                fullWidth
                                                variant={currentPlanName === "Pro Plan" ? "tertiary" : "primary"}
                                                tone="success"
                                                disabled={currentPlanName === "Pro Plan"}
                                                onClick={() => handleSubscribe("Pro Plan")}
                                                loading={loadingPlan === "Pro Plan"}
                                            >
                                                {currentPlanName === "Pro Plan" ? "Current Plan" : "Upgrade to Pro"}
                                            </Button>
                                        </div>
                                    </div>
                                </Card>
                            </div>

                            {/* Elite Plan */}
                            <div className="pricing-card">
                                <Card>
                                    <div className="pricing-card-content">
                                        <BlockStack gap="400">
                                            <Text variant="headingLg" as="h2">Elite</Text>
                                            <Text variant="heading3xl" as="h3">$49.99<Text as="span" variant="bodyMd" tone="subdued">/mo</Text></Text>
                                            <Text as="p" variant="bodyMd" tone="subdued">Enterprise features & external integrations.</Text>
                                            <Divider />
                                            <div className="pricing-features">
                                                <List>
                                                    <List.Item><strong>Unlimited tags applied</strong></List.Item>
                                                    <List.Item>Priority 24/7 Support</List.Item>
                                                    <List.Item>Klaviyo / Mailchimp Setup</List.Item>
                                                </List>
                                            </div>
                                        </BlockStack>
                                        <div className="pricing-action">
                                            <Button
                                                fullWidth
                                                variant={currentPlanName === "Elite Plan" ? "tertiary" : "primary"}
                                                disabled={currentPlanName === "Elite Plan"}
                                                onClick={() => handleSubscribe("Elite Plan")}
                                                loading={loadingPlan === "Elite Plan"}
                                            >
                                                {currentPlanName === "Elite Plan" ? "Current Plan" : "Upgrade to Elite"}
                                            </Button>
                                        </div>
                                    </div>
                                </Card>
                            </div>

                        </div>
                    </BlockStack>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
