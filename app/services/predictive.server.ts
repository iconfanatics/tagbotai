/**
 * predictive.server.ts
 *
 * Predictive Segmentation Engine (Additive Module — reads existing Customer records,
 * applies tags via the existing manageCustomerTags pipeline)
 *
 * Rules (deterministic, no LLM overhead):
 *   VIP       → orderCount ≥ 3 AND totalSpent ≥ 200 AND last order within 60 days
 *   At-Risk   → orderCount ≥ 2 AND last order > 90 days ago
 *
 * Idempotent: customers already carrying the target tag are skipped.
 */
import db from "../db.server";
import { manageCustomerTags } from "./tags.server";

export interface PredictiveRunResult {
    vipTagged: number;
    atRiskTagged: number;
    skipped: number;
    errors: number;
    durationMs: number;
}

const VIP_TAG = "VIP";
const AT_RISK_TAG = "At-Risk";

export async function runPredictiveSegmentation(
    storeId: string,
    admin: any
): Promise<PredictiveRunResult> {
    const start = Date.now();
    const now = new Date();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    let vipTagged = 0;
    let atRiskTagged = 0;
    let skipped = 0;
    let errors = 0;

    // Fetch all tracked customers for this store — use select to keep memory low
    const customers = await db.customer.findMany({
        where: { storeId },
        select: {
            id: true,
            tags: true,
            totalSpent: true,
            orderCount: true,
            lastOrderDate: true
        }
    });

    for (const customer of customers) {
        try {
            const currentTags = customer.tags
                ? customer.tags.split(",").map(t => t.trim()).filter(Boolean)
                : [];

            const lastOrder = customer.lastOrderDate ? new Date(customer.lastOrderDate) : null;

            const tagsToAdd: string[] = [];
            const tagsToRemove: string[] = [];

            // ── VIP Scoring ──────────────────────────────────────────────────
            const isVipCandidate =
                customer.orderCount >= 3 &&
                customer.totalSpent >= 200 &&
                lastOrder !== null &&
                lastOrder >= sixtyDaysAgo;

            const hasVipTag = currentTags.includes(VIP_TAG);

            if (isVipCandidate && !hasVipTag) {
                tagsToAdd.push(VIP_TAG);
                vipTagged++;
            } else if (!isVipCandidate && hasVipTag) {
                // Demote from VIP if they no longer qualify
                tagsToRemove.push(VIP_TAG);
            }

            // ── At-Risk Scoring ──────────────────────────────────────────────
            const isAtRiskCandidate =
                customer.orderCount >= 2 &&
                lastOrder !== null &&
                lastOrder < ninetyDaysAgo;

            const hasAtRiskTag = currentTags.includes(AT_RISK_TAG);

            if (isAtRiskCandidate && !hasAtRiskTag) {
                tagsToAdd.push(AT_RISK_TAG);
                atRiskTagged++;
            } else if (!isAtRiskCandidate && hasAtRiskTag) {
                tagsToRemove.push(AT_RISK_TAG);
            }

            if (tagsToAdd.length === 0 && tagsToRemove.length === 0) {
                skipped++;
                continue;
            }

            // Use the existing pipeline — fully backward compatible
            await manageCustomerTags(admin, storeId, customer.id, tagsToAdd, tagsToRemove);
        } catch (err: any) {
            console.error(`[PREDICTIVE] Error on customer ${customer.id}:`, err.message);
            errors++;
        }
    }

    return {
        vipTagged,
        atRiskTagged,
        skipped,
        errors,
        durationMs: Date.now() - start
    };
}
