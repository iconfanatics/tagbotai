import { Page, Layout, Text, BlockStack, Button, InlineStack, Badge } from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { useLoaderData, useSubmit, useActionData } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import db from "../db.server";
import { getCachedStore, invalidateStoreCache } from "../services/cache.server";

function calcYearly(monthly: number, discountPct: number) {
    return parseFloat((monthly * 12 * (1 - discountPct / 100)).toFixed(2));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, billing } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);

    let config = await db.pricingConfig.findUnique({ where: { key: "default" } });
    if (!config) {
        config = await db.pricingConfig.create({
            data: { key: "default", yearlyDiscount: 15, growthMonthly: 14.99, proMonthly: 29.99, eliteMonthly: 49.99 }
        });
    }

    const paidPlans = ["Growth Plan", "Growth Plan Yearly", "Pro Plan", "Pro Plan Yearly", "Elite Plan", "Elite Plan Yearly"];
    const isTestMode = process.env.BILLING_TEST_MODE === "true";

    let currentPlanName = "Free";
    try {
        const billingCheck = await billing.check({
            plans: paidPlans as any,
            isTest: isTestMode,
        });

        const activeSub = billingCheck.appSubscriptions.find(sub => sub.name);
        if (billingCheck.hasActivePayment && activeSub) {
             currentPlanName = activeSub.name;
        }
    } catch(err) {
        console.error("Billing check error", err);
        currentPlanName = store?.planName || "Free";
    }

    const basePlan = currentPlanName.replace(" Yearly", "");
    if (store && store.planName !== basePlan) {
        await db.store.update({ where: { shop: session.shop }, data: { planName: basePlan } });
        invalidateStoreCache(session.shop);
    }

    return {
        currentPlanName: currentPlanName,
        pricing: {
            yearlyDiscount: config.yearlyDiscount,
            growthMonthly: config.growthMonthly,
            proMonthly: config.proMonthly,
            eliteMonthly: config.eliteMonthly,
        }
    };
};

// Plan pricing config (must match shopify.server.ts)
const PLAN_CONFIG: Record<string, { amount: number; interval: string }> = {
    "Growth Plan":        { amount: 14.99,  interval: "EVERY_30_DAYS" },
    "Growth Plan Yearly": { amount: 152.90, interval: "ANNUAL" },
    "Pro Plan":           { amount: 29.99,  interval: "EVERY_30_DAYS" },
    "Pro Plan Yearly":    { amount: 305.90, interval: "ANNUAL" },
    "Elite Plan":         { amount: 49.99,  interval: "EVERY_30_DAYS" },
    "Elite Plan Yearly":  { amount: 509.90, interval: "ANNUAL" },
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, billing, session } = await authenticate.admin(request);
    const formData = await request.formData();
    const plan = formData.get("plan") as string;

    const paidPlans = Object.keys(PLAN_CONFIG);

    // Detect dev/partner stores so test charges are used during review
    let isTestMode = process.env.BILLING_TEST_MODE === "true";
    try {
        const response = await admin.graphql(`
            #graphql
            query { shop { plan { partnerDevelopment } } }
        `);
        const { data } = await response.json();
        if (data?.shop?.plan?.partnerDevelopment) {
            isTestMode = true;
            console.log(`[BILLING] Partner dev store — isTestMode = true`);
        }
    } catch (e) {
        console.error("Failed to fetch shop plan", e);
    }

    const appUrl = process.env.SHOPIFY_APP_URL || "";

    if (paidPlans.includes(plan)) {
        const config = PLAN_CONFIG[plan];
        // Use GraphQL directly so we get the confirmationUrl as JSON.
        // We CANNOT throw a server-side redirect in an embedded app — it causes
        // a 401 because useSubmit() is fetch-based and fetch can't cross Shopify's
        // charge approval auth boundary. Instead, return the URL and let the
        // frontend do a top-level window redirect to break out of the iframe.
        try {
            const result = await admin.graphql(`
                #graphql
                mutation appSubscriptionCreate(
                    $name: String!
                    $lineItems: [AppSubscriptionLineItemInput!]!
                    $returnUrl: URL!
                    $test: Boolean
                ) {
                    appSubscriptionCreate(
                        name: $name
                        lineItems: $lineItems
                        returnUrl: $returnUrl
                        test: $test
                        trialDays: 0
                    ) {
                        confirmationUrl
                        userErrors { field message }
                    }
                }
            `, {
                variables: {
                    name: plan,
                    returnUrl: `${appUrl}/app/pricing`,
                    test: isTestMode,
                    lineItems: [{
                        plan: {
                            appRecurringPricingDetails: {
                                price: { amount: config.amount, currencyCode: "USD" },
                                interval: config.interval,
                            }
                        }
                    }]
                }
            });

            const { data } = await result.json() as any;
            const confirmationUrl = data?.appSubscriptionCreate?.confirmationUrl;
            const userErrors: { message: string }[] = data?.appSubscriptionCreate?.userErrors || [];

            if (userErrors.length > 0) {
                return { success: false, message: userErrors[0].message };
            }
            if (confirmationUrl) {
                return { checkoutUrl: confirmationUrl };
            }
            return { success: false, message: "Failed to create subscription. No confirmation URL." };
        } catch (err: any) {
            console.error("[BILLING_ERROR]", err);
            return { success: false, message: `Billing Error: ${err.message || String(err)}` };
        }
    } else if (plan === "Free") {
        try {
            const billingCheck = await billing.check({
                plans: paidPlans as any,
                isTest: isTestMode,
            });
            const activeSub = billingCheck.appSubscriptions.find(sub => sub.name);
            if (activeSub && activeSub.id) {
                await billing.cancel({
                    subscriptionId: activeSub.id,
                    isTest: isTestMode,
                    prorate: true
                });
            }
        } catch (err) {
            console.error("Failed to cancel subscription", err);
        }

        await db.store.update({ where: { shop: session.shop }, data: { planName: "Free" } });
        invalidateStoreCache(session.shop);
        return { success: true, message: "Successfully downgraded to Free Plan." };
    }

    return { success: false, message: "Invalid plan selection." };
};

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
        if ((actionData as any)?.checkoutUrl) {
            // Embedded apps run in an iframe — must use window.top to break out
            // and navigate the full browser to Shopify's charge approval page.
            if (window.top) {
                window.top.location.href = (actionData as any).checkoutUrl;
            } else {
                window.location.href = (actionData as any).checkoutUrl;
            }
        } else if (actionData?.message) {
            setLoadingPlan(null);
            shopify.toast.show(actionData.message, { isError: !(actionData as any).success });
        }
    }, [actionData]);

    const handleSubscribe = (baseName: string) => {
        const planName = billing === "yearly" ? `${baseName} Yearly` : baseName;
        setLoadingPlan(planName);
        submit({ plan: planName }, { method: "post" });
    };

    const baseCurrent = currentPlanName.replace(" Yearly", "");

    const plans = [
        {
            name: "Free",
            monthly: 0,
            yearly: 0,
            tagline: "Get started for free",
            features: [
                "100 order tags / month",
                "100 customer tags / month",
                "100 tag removals / month",
                "Basic conditional rules",
                "Standard Smart Segments",
                "Manual tagging dashboard",
                "Community support",
            ],
            cta: "Current Plan",
            highlighted: false,
            badge: null,
        },
        {
            name: "Growth Plan",
            monthly: growthMonthly,
            yearly: growthYearly,
            tagline: "Scale your tagging",
            features: [
                "1,000 order tags / month",
                "1,000 customer tags / month",
                "1,000 tag removals / month",
                "Advanced order & traffic rules",
                "Predictive Re-engagement AI",
                "Revenue ROI analytics",
                "Priority email support",
            ],
            cta: "Upgrade to Growth",
            highlighted: false,
            badge: null,
        },
        {
            name: "Pro Plan",
            monthly: proMonthly,
            yearly: proYearly,
            tagline: "Unlimited AI automation",
            features: [
                "Unlimited order & customer tags",
                "Unlimited tag removals",
                "✨ AI Natural Language Rules",
                "Order Note Sentiment NLP",
                "Automated Customer Note Sync",
                "CSV Bulk Segment Exporting",
            ],
            cta: "Upgrade to Pro",
            highlighted: true,
            badge: "Most Popular",
        },
        {
            name: "Elite Plan",
            monthly: eliteMonthly,
            yearly: eliteYearly,
            tagline: "Enterprise-grade ecosystem",
            features: [
                "Everything in Pro",
                "Klaviyo & Mailchimp Integrations",
                "Action-based Webhook Workflows",
                "Real-time Automated Syncing",
                "Dedicated Account Manager",
            ],
            cta: "Upgrade to Elite",
            highlighted: false,
            badge: null,
        },
    ];

    return (
        <Page backAction={{ content: "Dashboard", url: "/app" }}>
            <style>{`
                /* ── Reset & base ────────────────────────────────────────── */
                .pg-wrap {
                    max-width: 1100px;
                    margin: 0 auto;
                    padding: 0 16px 48px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                }

                /* ── Hero header ─────────────────────────────────────────── */
                .pg-hero {
                    text-align: center;
                    padding: 40px 0 32px;
                }
                .pg-hero h1 {
                    font-size: 32px;
                    font-weight: 700;
                    color: #1a1a2e;
                    margin: 0 0 10px;
                    letter-spacing: -0.5px;
                }
                .pg-hero p {
                    font-size: 16px;
                    color: #6b7280;
                    margin: 0;
                }

                /* ── Billing toggle ──────────────────────────────────────── */
                .pg-toggle-wrap {
                    display: flex;
                    justify-content: center;
                    margin-bottom: 40px;
                }
                .pg-toggle {
                    display: inline-flex;
                    background: #f3f4f6;
                    border-radius: 50px;
                    padding: 4px;
                    gap: 4px;
                }
                .pg-toggle button {
                    border: none;
                    background: transparent;
                    padding: 8px 24px;
                    border-radius: 50px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    color: #6b7280;
                    transition: all 0.2s ease;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .pg-toggle button.active {
                    background: #fff;
                    color: #1a1a2e;
                    box-shadow: 0 1px 4px rgba(0,0,0,0.12);
                }
                .pg-save-badge {
                    background: linear-gradient(135deg, #6366f1, #8b5cf6);
                    color: white;
                    font-size: 11px;
                    font-weight: 700;
                    padding: 2px 8px;
                    border-radius: 20px;
                    letter-spacing: 0.3px;
                }

                /* ── Grid ────────────────────────────────────────────────── */
                .pg-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 16px;
                    align-items: start;
                }
                @media (max-width: 900px) {
                    .pg-grid { grid-template-columns: repeat(2, 1fr); }
                }
                @media (max-width: 560px) {
                    .pg-grid { grid-template-columns: 1fr; }
                }

                /* ── Card ────────────────────────────────────────────────── */
                .pg-card {
                    background: #fff;
                    border: 1.5px solid #e5e7eb;
                    border-radius: 16px;
                    padding: 28px 24px 24px;
                    display: flex;
                    flex-direction: column;
                    position: relative;
                    transition: box-shadow 0.2s, transform 0.2s;
                }
                .pg-card:hover {
                    box-shadow: 0 8px 32px rgba(0,0,0,0.08);
                    transform: translateY(-2px);
                }
                .pg-card.pro {
                    background: linear-gradient(160deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%);
                    border-color: transparent;
                    box-shadow: 0 12px 40px rgba(99,102,241,0.3);
                    transform: scale(1.03);
                }
                .pg-card.pro:hover {
                    transform: scale(1.03) translateY(-2px);
                    box-shadow: 0 20px 50px rgba(99,102,241,0.4);
                }

                /* ── Badge ───────────────────────────────────────────────── */
                .pg-plan-badge {
                    position: absolute;
                    top: -13px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: linear-gradient(135deg, #6366f1, #8b5cf6);
                    color: white;
                    font-size: 12px;
                    font-weight: 700;
                    padding: 4px 16px;
                    border-radius: 20px;
                    white-space: nowrap;
                    letter-spacing: 0.3px;
                }

                /* ── Plan name & tagline ─────────────────────────────────── */
                .pg-plan-name {
                    font-size: 18px;
                    font-weight: 700;
                    color: #1a1a2e;
                    margin: 0 0 4px;
                }
                .pg-card.pro .pg-plan-name { color: #fff; }
                .pg-plan-tagline {
                    font-size: 13px;
                    color: #9ca3af;
                    margin: 0 0 20px;
                }
                .pg-card.pro .pg-plan-tagline { color: rgba(255,255,255,0.6); }

                /* ── Price ───────────────────────────────────────────────── */
                .pg-price-block { margin-bottom: 20px; }
                .pg-price {
                    font-size: 36px;
                    font-weight: 800;
                    color: #1a1a2e;
                    line-height: 1;
                    letter-spacing: -1px;
                }
                .pg-card.pro .pg-price { color: #fff; }
                .pg-price span {
                    font-size: 16px;
                    font-weight: 500;
                    color: #9ca3af;
                    letter-spacing: 0;
                }
                .pg-card.pro .pg-price span { color: rgba(255,255,255,0.5); }
                .pg-price-sub {
                    font-size: 12px;
                    color: #9ca3af;
                    margin-top: 4px;
                }
                .pg-card.pro .pg-price-sub { color: rgba(255,255,255,0.5); }
                .pg-strike {
                    text-decoration: line-through;
                    color: #d1d5db;
                    font-size: 13px;
                }
                .pg-yearly-save {
                    display: inline-block;
                    background: rgba(99,102,241,0.12);
                    color: #6366f1;
                    font-size: 11px;
                    font-weight: 700;
                    padding: 2px 8px;
                    border-radius: 10px;
                    margin-left: 6px;
                }
                .pg-card.pro .pg-yearly-save {
                    background: rgba(255,255,255,0.15);
                    color: #a5b4fc;
                }

                /* ── Divider ─────────────────────────────────────────────── */
                .pg-divider {
                    height: 1px;
                    background: #f3f4f6;
                    margin: 0 0 20px;
                }
                .pg-card.pro .pg-divider { background: rgba(255,255,255,0.1); }

                /* ── Features ────────────────────────────────────────────── */
                .pg-features {
                    list-style: none;
                    margin: 0 0 24px;
                    padding: 0;
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }
                .pg-feature {
                    display: flex;
                    align-items: flex-start;
                    gap: 10px;
                    font-size: 13.5px;
                    color: #374151;
                }
                .pg-card.pro .pg-feature { color: rgba(255,255,255,0.85); }
                .pg-check {
                    width: 18px;
                    height: 18px;
                    border-radius: 50%;
                    background: #f0fdf4;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                    margin-top: 1px;
                }
                .pg-card.pro .pg-check {
                    background: rgba(99,102,241,0.25);
                }
                .pg-check::before {
                    content: '';
                    width: 8px;
                    height: 5px;
                    border-left: 2px solid #16a34a;
                    border-bottom: 2px solid #16a34a;
                    transform: rotate(-45deg) translateY(-1px);
                }
                .pg-card.pro .pg-check::before {
                    border-color: #a5b4fc;
                }

                /* ── CTA button ──────────────────────────────────────────── */
                .pg-cta {
                    width: 100%;
                    padding: 12px;
                    border: none;
                    border-radius: 10px;
                    font-size: 14px;
                    font-weight: 700;
                    cursor: pointer;
                    transition: all 0.2s;
                    letter-spacing: 0.2px;
                }
                .pg-cta:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
                .pg-cta.default {
                    background: #f3f4f6;
                    color: #374151;
                }
                .pg-cta.default:hover:not(:disabled) {
                    background: #e5e7eb;
                }
                .pg-cta.current {
                    background: #f3f4f6;
                    color: #9ca3af;
                    cursor: default;
                }
                .pg-cta.primary {
                    background: linear-gradient(135deg, #6366f1, #8b5cf6);
                    color: white;
                    box-shadow: 0 4px 14px rgba(99,102,241,0.35);
                }
                .pg-cta.primary:hover:not(:disabled) {
                    background: linear-gradient(135deg, #4f46e5, #7c3aed);
                    box-shadow: 0 6px 20px rgba(99,102,241,0.45);
                    transform: translateY(-1px);
                }
                .pg-cta.white {
                    background: #fff;
                    color: #4f46e5;
                    box-shadow: 0 4px 14px rgba(0,0,0,0.12);
                }
                .pg-cta.white:hover:not(:disabled) {
                    background: #f5f3ff;
                    box-shadow: 0 6px 20px rgba(0,0,0,0.16);
                    transform: translateY(-1px);
                }
                .pg-cta.white-current {
                    background: rgba(255,255,255,0.15);
                    color: rgba(255,255,255,0.7);
                    cursor: default;
                }
            `}</style>

            <div className="pg-wrap">
                {/* Hero */}
                <div className="pg-hero">
                    <h1>Simple, transparent pricing</h1>
                    <p>Start free. Upgrade as your store grows. No hidden fees.</p>
                </div>

                {/* Toggle */}
                <div className="pg-toggle-wrap">
                    <div className="pg-toggle">
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
                            <span className="pg-save-badge">Save {yearlyDiscount}%</span>
                        </button>
                    </div>
                </div>

                {/* Cards */}
                <div className="pg-grid">
                    {plans.map((plan) => {
                        const isPro = plan.name === "Pro Plan";
                        const price = plan.monthly === 0
                            ? 0
                            : billing === "yearly"
                                ? plan.yearly
                                : plan.monthly;
                        const monthlyEquiv = billing === "yearly" && plan.monthly > 0
                            ? (plan.yearly / 12).toFixed(2)
                            : null;
                        const isCurrent = plan.name === "Free"
                            ? baseCurrent === "Free" || baseCurrent === ""
                            : baseCurrent === plan.name;

                        // CTA style
                        let ctaClass = "pg-cta";
                        if (isCurrent) {
                            ctaClass += isPro ? " white-current" : " current";
                        } else if (isPro) {
                            ctaClass += " white";
                        } else if (plan.monthly === 0) {
                            ctaClass += " default";
                        } else {
                            ctaClass += " primary";
                        }

                        const isLoading = loadingPlan === plan.name || loadingPlan === `${plan.name} Yearly`;

                        return (
                            <div key={plan.name} className={`pg-card${isPro ? " pro" : ""}`}>
                                {plan.badge && (
                                    <div className="pg-plan-badge">{plan.badge}</div>
                                )}

                                <p className="pg-plan-name">{plan.name.replace(" Plan", "")}</p>
                                <p className="pg-plan-tagline">{plan.tagline}</p>

                                {/* Price */}
                                <div className="pg-price-block">
                                    {plan.monthly === 0 ? (
                                        <p className="pg-price">$0<span>/mo</span></p>
                                    ) : billing === "yearly" ? (
                                        <>
                                            <p className="pg-price">
                                                ${price.toFixed(2)}<span>/yr</span>
                                                <span className="pg-yearly-save">{yearlyDiscount}% off</span>
                                            </p>
                                            <p className="pg-price-sub">
                                                <span className="pg-strike">${(plan.monthly * 12).toFixed(2)}/yr</span>
                                                {" "}· ≈ ${monthlyEquiv}/mo
                                            </p>
                                        </>
                                    ) : (
                                        <p className="pg-price">${price.toFixed(2)}<span>/mo</span></p>
                                    )}
                                </div>

                                <div className="pg-divider" />

                                {/* Features */}
                                <ul className="pg-features">
                                    {plan.features.map((f) => (
                                        <li key={f} className="pg-feature">
                                            <span className="pg-check" />
                                            {f}
                                        </li>
                                    ))}
                                </ul>

                                {/* CTA */}
                                <button
                                    className={ctaClass}
                                    disabled={isCurrent || isLoading}
                                    onClick={() => {
                                        if (plan.name === "Free") {
                                            submit({ plan: "Free" }, { method: "post" });
                                        } else {
                                            handleSubscribe(plan.name);
                                        }
                                    }}
                                >
                                    {isLoading ? "Processing…" : isCurrent ? "Current Plan" : plan.cta}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
        </Page>
    );
}
