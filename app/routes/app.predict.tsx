/**
 * app.predict.tsx
 * Feature: Predictive Segmentation
 *
 * On-demand UI to trigger the predictive segmentation engine.
 * Applies VIP / At-Risk tags based on deterministic rules against local Customer data.
 */
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigation, useSubmit } from "react-router";
import {
    Page, Layout, Card, Text, BlockStack, InlineStack, Button,
    Banner, Box, Badge, ProgressBar, List, Icon, Divider
} from "@shopify/polaris";
import { MagicIcon, RefreshIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";
import { runPredictiveSegmentation } from "../services/predictive.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    if (!store) throw new Error("Store not found");

    // Summary stats from current Customer data for display
    const now = new Date();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [totalCustomers, currentVipCount, currentAtRiskCount, vipCandidates, atRiskCandidates] = await Promise.all([
        db.customer.count({ where: { storeId: store.id } }),
        db.customer.count({ where: { storeId: store.id, tags: { contains: "VIP" } } }),
        db.customer.count({ where: { storeId: store.id, tags: { contains: "At-Risk" } } }),
        db.customer.count({
            where: {
                storeId: store.id,
                orderCount: { gte: 3 },
                totalSpent: { gte: 200 },
                lastOrderDate: { gte: sixtyDaysAgo },
                NOT: { tags: { contains: "VIP" } }
            }
        }),
        db.customer.count({
            where: {
                storeId: store.id,
                orderCount: { gte: 2 },
                lastOrderDate: { lt: ninetyDaysAgo },
                NOT: { tags: { contains: "At-Risk" } }
            }
        })
    ]);

    return {
        totalCustomers,
        currentVipCount,
        currentAtRiskCount,
        vipCandidates,  // customers who WOULD be tagged VIP if run now
        atRiskCandidates,
        planName: store.planName
    };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    if (!store) return { success: false, message: "Store not found." };

    if (store.planName === "Free") {
        return { success: false, message: "Predictive Segmentation requires a Growth, Pro, or Elite plan." };
    }

    const result = await runPredictiveSegmentation(store.id, admin);

    return {
        success: true,
        message: `Segmentation complete! ${result.vipTagged} customers tagged VIP, ${result.atRiskTagged} tagged At-Risk. (${result.durationMs}ms)`,
        ...result
    };
};

export default function PredictPage() {
    const { totalCustomers, currentVipCount, currentAtRiskCount, vipCandidates, atRiskCandidates, planName } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const submit = useSubmit();

    const isRunning = navigation.state === "submitting";
    const isFree = !planName || planName === "Free";
    const handleRun = () => submit({}, { method: "post" });

    return (
        <Page backAction={{ content: "Dashboard", url: "/app" }}>
            <style>{`
                .pred-wrap { max-width: 900px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
                .pred-hero { padding: 28px 0 24px; }
                .pred-hero h1 { font-size: 26px; font-weight: 800; color: #1a1a2e; margin: 0 0 6px; letter-spacing: -0.5px; }
                .pred-hero p  { font-size: 14px; color: #9ca3af; margin: 0; }
                .pred-kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
                .pred-kpi { background: #fff; border: 1.5px solid #e5e7eb; border-radius: 16px; padding: 20px 22px; transition: box-shadow 0.2s, transform 0.2s; }
                .pred-kpi:hover { box-shadow: 0 6px 24px rgba(0,0,0,0.06); transform: translateY(-1px); }
                .pred-kpi-label { font-size: 11px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 8px; }
                .pred-kpi-value { font-size: 34px; font-weight: 800; color: #1a1a2e; letter-spacing: -1px; line-height: 1; }
                .pred-kpi-sub { font-size: 12px; margin-top: 6px; }
                .pred-kpi-sub.green { color: #16a34a; } .pred-kpi-sub.orange { color: #d97706; }
                .pred-criteria { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
                .pred-rule-card { background: #fff; border: 1.5px solid #e5e7eb; border-radius: 16px; padding: 22px; }
                .pred-rule-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
                .pred-rule-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
                .pred-rule-dot.gold { background: #f59e0b; } .pred-rule-dot.amber { background: #e11d48; }
                .pred-rule-title { font-size: 14px; font-weight: 700; color: #1a1a2e; }
                .pred-rule-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
                .pred-rule-item { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #374151; }
                .pred-rule-item::before { content: '→'; color: #9ca3af; flex-shrink: 0; }
                .pred-action-card { background: #fff; border: 1.5px solid #e5e7eb; border-radius: 16px; padding: 24px; }
                .pred-action-title { font-size: 16px; font-weight: 700; color: #1a1a2e; margin: 0 0 8px; }
                .pred-action-body { font-size: 14px; color: #6b7280; margin: 0 0 20px; line-height: 1.6; }
                .pred-progress { background: #f3f4f6; border-radius: 99px; height: 6px; overflow: hidden; margin-bottom: 8px; }
                .pred-progress-bar { height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); border-radius: 99px; animation: prog 1.5s ease-in-out infinite; }
                @keyframes prog { 0%,100%{width:30%} 50%{width:80%} }
                .pred-progress-label { font-size: 12px; color: #9ca3af; margin-bottom: 16px; }
                .pred-run-btn { border: none; border-radius: 12px; font-size: 15px; font-weight: 700; padding: 14px 32px; cursor: pointer; transition: all 0.2s; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; box-shadow: 0 4px 16px rgba(99,102,241,0.35); }
                .pred-run-btn:hover:not(:disabled) { background: linear-gradient(135deg, #4f46e5, #7c3aed); box-shadow: 0 6px 22px rgba(99,102,241,0.45); transform: translateY(-1px); }
                .pred-run-btn:disabled { opacity: 0.55; cursor: not-allowed; }
                .pred-run-btn.ghost { background: #f3f4f6; color: #374151; box-shadow: none; }
                .pred-alert { padding: 14px 18px; border-radius: 12px; font-size: 14px; font-weight: 500; margin-bottom: 20px; }
                .pred-alert.success { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
                .pred-alert.error   { background: #fff1f2; color: #9f1239; border: 1px solid #fecdd3; }
                .pred-upgrade { background: linear-gradient(135deg, #1a1a2e, #0f3460); border-radius: 16px; padding: 28px; text-align: center; color: #fff; }
                .pred-upgrade h3 { font-size: 18px; font-weight: 700; margin: 0 0 8px; }
                .pred-upgrade p  { font-size: 14px; color: rgba(255,255,255,0.6); margin: 0 0 20px; }
            `}</style>

            <div className="pred-wrap">
                {/* Hero */}
                <div className="pred-hero">
                    <h1>✨ Predictive Segmentation</h1>
                    <p>Auto-label customers as VIP or At-Risk based on deterministic purchase behavior rules.</p>
                </div>

                {/* KPI Grid */}
                <div className="pred-kpi-grid">
                    <div className="pred-kpi">
                        <div className="pred-kpi-label">Total Customers</div>
                        <div className="pred-kpi-value">{totalCustomers.toLocaleString()}</div>
                        <div className="pred-kpi-sub" style={{ color: '#9ca3af' }}>In your database</div>
                    </div>
                    <div className="pred-kpi">
                        <div className="pred-kpi-label">Currently VIP</div>
                        <div className="pred-kpi-value" style={{ color: '#d97706' }}>{currentVipCount.toLocaleString()}</div>
                        {vipCandidates > 0
                            ? <div className="pred-kpi-sub green">+{vipCandidates} new candidates ready</div>
                            : <div className="pred-kpi-sub" style={{ color: '#9ca3af' }}>All tagged</div>
                        }
                    </div>
                    <div className="pred-kpi">
                        <div className="pred-kpi-label">Currently At-Risk</div>
                        <div className="pred-kpi-value" style={{ color: '#e11d48' }}>{currentAtRiskCount.toLocaleString()}</div>
                        {atRiskCandidates > 0
                            ? <div className="pred-kpi-sub orange">+{atRiskCandidates} new candidates</div>
                            : <div className="pred-kpi-sub" style={{ color: '#9ca3af' }}>All tagged</div>
                        }
                    </div>
                </div>

                {/* Criteria */}
                <div className="pred-criteria">
                    <div className="pred-rule-card">
                        <div className="pred-rule-header">
                            <span className="pred-rule-dot gold" />
                            <span className="pred-rule-title">VIP Criteria</span>
                        </div>
                        <ul className="pred-rule-list">
                            <li className="pred-rule-item">3 or more orders placed</li>
                            <li className="pred-rule-item">$200+ lifetime spend</li>
                            <li className="pred-rule-item">Ordered within last 60 days</li>
                        </ul>
                    </div>
                    <div className="pred-rule-card">
                        <div className="pred-rule-header">
                            <span className="pred-rule-dot amber" />
                            <span className="pred-rule-title">At-Risk Criteria</span>
                        </div>
                        <ul className="pred-rule-list">
                            <li className="pred-rule-item">2 or more orders placed</li>
                            <li className="pred-rule-item">Last order more than 90 days ago</li>
                            <li className="pred-rule-item">Already tagged customers skipped</li>
                        </ul>
                    </div>
                </div>

                {/* Result banner */}
                {actionData?.message && (
                    <div className={`pred-alert ${actionData.success ? "success" : "error"}`}>
                        {actionData.message}
                    </div>
                )}

                {/* Run card */}
                {isFree ? (
                    <div className="pred-upgrade">
                        <h3>Requires Growth Plan or higher</h3>
                        <p>Upgrade to unlock Predictive Segmentation and automatically identify your best and most at-risk customers.</p>
                        <a href="/app/pricing" style={{ display: 'inline-block', background: '#fff', color: '#4f46e5', borderRadius: 10, padding: '11px 28px', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>View Plans</a>
                    </div>
                ) : (
                    <div className="pred-action-card">
                        <p className="pred-action-title">Run Segmentation Now</p>
                        <p className="pred-action-body">
                            Processes all {totalCustomers.toLocaleString()} customers and applies VIP / At-Risk tags.
                            {vipCandidates + atRiskCandidates > 0
                                ? ` ${vipCandidates + atRiskCandidates} customers are ready to be tagged.`
                                : " All customers are already correctly tagged."}
                            {" "}The engine is fully idempotent — no duplicate tags.
                        </p>
                        {isRunning && (
                            <>
                                <div className="pred-progress"><div className="pred-progress-bar" /></div>
                                <p className="pred-progress-label">Processing… keep this page open.</p>
                            </>
                        )}
                        <button className="pred-run-btn" disabled={isRunning} onClick={handleRun}>
                            {isRunning ? "Processing…" : "Run Predictive Segmentation"}
                        </button>
                    </div>
                )}
            </div>
        </Page>
    );
}
