import { Page, Layout, Card, Text, BlockStack, Button, InlineStack, Box, Divider, List, Badge, Icon } from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { useLoaderData, useSubmit, useActionData } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import db from "../db.server";
import { getCachedStore, invalidateStoreCache } from "../services/cache.server";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function calcYearly(monthly: number, discountPct: number) {
    return parseFloat((monthly * 12 * (1 - discountPct / 100)).toFixed(2));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);

    // Load pricing config (or defaults if not set yet)
    let config = await db.pricingConfig.findUnique({ where: { key: "default" } });
    if (!config) {
        config = await db.pricingConfig.create({
            data: { key: "default", yearlyDiscount: 15, growthMonthly: 14.99, proMonthly: 29.99, eliteMonthly: 49.99 }
        });
    }

    return {
        currentPlanName: store?.planName || "Free",
        pricing: {
            yearlyDiscount: config.yearlyDiscount,
            growthMonthly: config.growthMonthly,
            proMonthly: config.proMonthly,
            eliteMonthly: config.eliteMonthly,
        }
    };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { billing, session } = await authenticate.admin(request);
    const formData = await request.formData();
    const plan = formData.get("plan") as string;
    const url = new URL(request.url);

    const paidPlans = ["Growth Plan", "Growth Plan Yearly", "Pro Plan", "Pro Plan Yearly", "Elite Plan", "Elite Plan Yearly"];

    if (paidPlans.includes(plan)) {
        try {
            await billing.require({
                plans: [plan] as any,
                isTest: true,
                onFailure: async () => billing.request({
                    plan: plan as any,
                    isTest: true,
                    returnUrl: `https://${url.host}/app/pricing`,
                }),
            });
        } catch (error: any) {
            if (error instanceof Response) throw error;
            console.error("[BILLING_ERROR]", error);
            return { success: false, message: `Billing Error: ${error.message || String(error)}` };
        }

        // Map yearly plan names → base plan name for our DB
        const basePlan = plan.replace(" Yearly", "");
        await db.store.update({ where: { shop: session.shop }, data: { planName: basePlan } });
        invalidateStoreCache(session.shop);
        return { success: true, message: `Successfully upgraded to ${plan}.` };
    } else if (plan === "Free") {
        await db.store.update({ where: { shop: session.shop }, data: { planName: "Free" } });
        invalidateStoreCache(session.shop);
        return { success: true, message: "Successfully downgraded to Free Plan." };
    }

    return { success: false, message: "Invalid plan selection." };
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function Pricing() {
    const shopify = useAppBridge();
    const { currentPlanName, pricing } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();

    const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
    const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

    const { yearlyDiscount, growthMonthly, proMonthly, eliteMonthly } = pricing;
    const growthYearly = calcYearly(growthMonthly, yearlyDiscount);
    const proYearly = calcYearly(proMonthly, yearlyDiscount);
    const eliteYearly = calcYearly(eliteMonthly, yearlyDiscount);

    useEffect(() => {
        if (actionData?.message) {
            shopify.toast.show(actionData.message, { isError: !actionData.success });
        }
    }, [actionData]);

    const handleSubscribe = (baseName: string) => {
        const planName = billing === "yearly" ? `${baseName} Yearly` : baseName;
        setLoadingPlan(planName);
        submit({ plan: planName }, { method: "post" });
    };

    // Normalise current plan for comparison (strip "Yearly" suffix stored in DB)
    const baseCurrent = currentPlanName.replace(" Yearly", "");

    const plans = [
        {
            name: "Free",
            monthly: 0,
            yearly: 0,
            description: "Start automating for free.",
            features: ["100 tags per month", "Basic Dashboard"],
            tone: undefined,
            popular: false,
        },
        {
            name: "Growth Plan",
            monthly: growthMonthly,
            yearly: growthYearly,
            description: "For growing stores that need more volume.",
            features: ["1,000 tags per month", "Basic Dashboard", "Email Support"],
            tone: "magic" as const,
            popular: false,
        },
        {
            name: "Pro Plan",
            monthly: proMonthly,
            yearly: proYearly,
            description: "Unlimited tagging with advanced AI insights.",
            features: ["Unlimited tags", "AI Insights Engine", "CSV Data Export"],
            tone: "magic" as const,
            popular: true,
        },
        {
            name: "Elite Plan",
            monthly: eliteMonthly,
            yearly: eliteYearly,
            description: "Enterprise features & external integrations.",
            features: ["Unlimited tags", "Klaviyo / Mailchimp", "Priority 24/7 Support"],
            tone: undefined,
            popular: false,
        },
    ];

    return (
        <Page title="Plans & Pricing" backAction={{ content: "Dashboard", url: "/app" }}>
            <style>{`
                .pricing-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                    gap: 16px;
                    align-items: stretch;
                }
                .pricing-card { display: flex; flex-direction: column; height: 100%; }
                .pricing-card-content { flex-grow: 1; display: flex; flex-direction: column; }
                .pricing-features { flex-grow: 1; padding-top: 12px; }
                .pricing-action { margin-top: auto; padding-top: 24px; }
                .billing-toggle {
                    display: inline-flex;
                    border: 1px solid var(--p-color-border);
                    border-radius: 8px;
                    overflow: hidden;
                    margin-bottom: 32px;
                }
                .billing-toggle button {
                    padding: 8px 24px;
                    border: none;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                    transition: all 0.2s;
                    background: transparent;
                    color: var(--p-color-text-secondary);
                }
                .billing-toggle button.active {
                    background: var(--p-color-bg-fill-magic);
                    color: white;
                }
                .yearly-badge {
                    display: inline-block;
                    background: #00A0AC22;
                    color: #00A0AC;
                    font-size: 12px;
                    font-weight: 600;
                    padding: 2px 8px;
                    border-radius: 10px;
                    margin-left: 8px;
                }
                .pro-card .Polaris-Card {
                    border: 2px solid var(--p-color-border-magic);
                    box-shadow: var(--p-shadow-300);
                }
                .strike {
                    text-decoration: line-through;
                    color: var(--p-color-text-secondary);
                    font-size: 14px;
                    margin-right: 4px;
                }
            `}</style>

            <Layout>
                <Layout.Section>
                    <BlockStack gap="400" align="center">
                        <Box paddingBlockEnd="200">
                            <Text variant="headingXl" as="h1" alignment="center">
                                Unlock Smart Segmentation Power
                            </Text>
                            <Text variant="bodyLg" as="p" alignment="center" tone="subdued">
                                Choose the plan that fits your store's growth.
                            </Text>
                        </Box>

                        {/* ── Billing Toggle ── */}
                        <div style={{ textAlign: "center" }}>
                            <div className="billing-toggle">
                                <button
                                    className={billing === "monthly" ? "active" : ""}
                                    onClick={() => setBilling("monthly")}
                                >
                                    Monthly
                                </button>
                                <button
                                    className={billing === "yearly" ? "active" : ""}
                                    onClick={() => setBilling("yearly")}
                                >
                                    Yearly
                                    <span className="yearly-badge">Save {yearlyDiscount}%</span>
                                </button>
                            </div>
                        </div>

                        {/* ── Plan Cards ── */}
                        <div className="pricing-grid">
                            {plans.map((plan) => {
                                const isCurrent = plan.name === "Free"
                                    ? baseCurrent === "Free" || baseCurrent === ""
                                    : baseCurrent === plan.name;
                                const price = billing === "yearly" ? plan.yearly : plan.monthly;
                                const monthlyEquiv = billing === "yearly" && plan.monthly > 0
                                    ? (plan.yearly / 12).toFixed(2)
                                    : null;

                                return (
                                    <div key={plan.name} className={`pricing-card${plan.popular ? " pro-card" : ""}`}>
                                        <Card background={plan.popular ? "bg-surface-magic" : undefined}>
                                            <div className="pricing-card-content">
                                                <BlockStack gap="400">
                                                    <InlineStack align="space-between" blockAlign="center">
                                                        <Text variant="headingLg" as="h2" tone={plan.tone}>
                                                            {plan.name.replace(" Plan", "")}
                                                        </Text>
                                                        {plan.popular && <Badge tone="magic">Most Popular</Badge>}
                                                    </InlineStack>

                                                    {plan.monthly === 0 ? (
                                                        <Text variant="heading3xl" as="h3">$0<Text as="span" variant="bodyMd" tone="subdued">/mo</Text></Text>
                                                    ) : billing === "yearly" ? (
                                                        <BlockStack gap="100">
                                                            <Text variant="heading3xl" as="h3">
                                                                ${price.toFixed(2)}
                                                                <Text as="span" variant="bodyMd" tone="subdued">/yr</Text>
                                                            </Text>
                                                            <InlineStack gap="100" blockAlign="center">
                                                                <span className="strike">${(plan.monthly * 12).toFixed(2)}/yr</span>
                                                                <Text as="span" variant="bodySm" tone="success">{yearlyDiscount}% off</Text>
                                                            </InlineStack>
                                                            <Text as="span" variant="bodySm" tone="subdued">
                                                                ≈ ${monthlyEquiv}/mo
                                                            </Text>
                                                        </BlockStack>
                                                    ) : (
                                                        <Text variant="heading3xl" as="h3">
                                                            ${price.toFixed(2)}
                                                            <Text as="span" variant="bodyMd" tone="subdued">/mo</Text>
                                                        </Text>
                                                    )}

                                                    <Text as="p" variant="bodyMd" tone="subdued">{plan.description}</Text>
                                                    <Divider />
                                                    <div className="pricing-features">
                                                        <List>
                                                            {plan.features.map(f => (
                                                                <List.Item key={f}>{f}</List.Item>
                                                            ))}
                                                        </List>
                                                    </div>
                                                </BlockStack>

                                                <div className="pricing-action">
                                                    <Button
                                                        fullWidth
                                                        variant={isCurrent ? "tertiary" : "primary"}
                                                        tone={plan.popular ? "success" : undefined}
                                                        disabled={isCurrent}
                                                        loading={loadingPlan === plan.name || loadingPlan === `${plan.name} Yearly`}
                                                        onClick={() => plan.name === "Free" ? submit({ plan: "Free" }, { method: "post" }) : handleSubscribe(plan.name)}
                                                    >
                                                        {isCurrent ? "Current Plan" : plan.name === "Free" ? "Downgrade" : `Upgrade to ${plan.name.replace(" Plan", "")}`}
                                                    </Button>
                                                </div>
                                            </div>
                                        </Card>
                                    </div>
                                );
                            })}
                        </div>
                    </BlockStack>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
