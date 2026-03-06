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
    const { session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);

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

    // isTest should be true only in development. Set BILLING_TEST_MODE=true in local .env.
    // In production (Vercel), leave BILLING_TEST_MODE unset — real charges apply.
    const isTestMode = process.env.BILLING_TEST_MODE === "true";

    if (paidPlans.includes(plan)) {
        try {
            await billing.require({
                plans: [plan] as any,
                isTest: isTestMode,
                onFailure: async () => billing.request({
                    plan: plan as any,
                    isTest: isTestMode,
                    returnUrl: `https://${url.host}/app/pricing`,
                }),
            });
        } catch (error: any) {
            if (error instanceof Response) throw error;
            console.error("[BILLING_ERROR]", error);
            return { success: false, message: `Billing Error: ${error.message || String(error)}` };
        }

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

    const baseCurrent = currentPlanName.replace(" Yearly", "");

    const plans = [
        {
            name: "Free",
            monthly: 0,
            yearly: 0,
            tagline: "Get started for free",
            features: [
                "100 customer tags / month",
                "Basic metric rules",
                "Manual sync dashboard",
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
                "1,000 customer tags / month",
                "Order-based rules (FB, TikTok…)",
                "All automation templates",
                "Predictive Segmentation",
                "Email support",
            ],
            cta: "Upgrade to Growth",
            highlighted: false,
            badge: null,
        },
        {
            name: "Pro Plan",
            monthly: proMonthly,
            yearly: proYearly,
            tagline: "Unlimited AI-powered tagging",
            features: [
                "Unlimited customer tags",
                "✨ AI Natural Language Rules",
                "CSV segment export",
                "Revenue ROI dashboard",
                "Priority support",
            ],
            cta: "Upgrade to Pro",
            highlighted: true,
            badge: "Most Popular",
        },
        {
            name: "Elite Plan",
            monthly: eliteMonthly,
            yearly: eliteYearly,
            tagline: "Enterprise-grade automation",
            features: [
                "Everything in Pro",
                "Klaviyo & Mailchimp sync",
                "Action-based Workflows",
                "Dedicated account manager",
                "Custom feature requests",
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
