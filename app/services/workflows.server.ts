/**
 * workflows.server.ts
 *
 * Action-based Workflow Engine (Additive Module — does NOT modify existing tagging logic)
 *
 * Called AFTER a tag is applied/removed. Queries active WorkflowAction records for the store
 * and dispatches configured actions (WEBHOOK, LOG, EMAIL_PREP) asynchronously.
 *
 * Integration: called from the END of manageCustomerTags() in tags.server.ts via
 *   dispatchWorkflowActions(...).catch(err => console.error('[WORKFLOW]', err));
 */
import db from "../db.server";

export type WorkflowTrigger = "TAG_ADDED" | "TAG_REMOVED";

interface WorkflowEvent {
    storeId: string;
    customerId: string;
    tags: string[];
    triggerOn: WorkflowTrigger;
    timestamp: string;
}

/**
 * Dispatch post-tag workflow actions for any active rules that match the applied tags.
 * Fire-and-forget safe: caller should .catch() errors to avoid blocking the tagging pipeline.
 */
export async function dispatchWorkflowActions(
    storeId: string,
    customerId: string,
    tagsAdded: string[],
    tagsRemoved: string[]
): Promise<void> {
    // Fetch all active workflow actions for this store in one query
    const allActions = await db.workflowAction.findMany({
        where: { storeId, isActive: true }
    });

    if (allActions.length === 0) return;

    const tasks: Promise<void>[] = [];

    for (const action of allActions) {
        const relevantTags = action.triggerOn === "TAG_ADDED" ? tagsAdded : tagsRemoved;
        if (!relevantTags.includes(action.triggerTag)) continue;

        const event: WorkflowEvent = {
            storeId,
            customerId,
            tags: relevantTags,
            triggerOn: action.triggerOn as WorkflowTrigger,
            timestamp: new Date().toISOString()
        };

        switch (action.actionType) {
            case "WEBHOOK":
                if (action.webhookUrl) {
                    tasks.push(dispatchWebhook(action.webhookUrl, event));
                }
                break;

            case "LOG":
                tasks.push(logWorkflowEvent(action.name, event));
                break;

            case "EMAIL_PREP":
                tasks.push(prepareEmailNotification(action.name, event, action.triggerTag));
                break;
        }
    }

    // Run all actions in parallel — failures of one don't block others
    await Promise.allSettled(tasks);
}

// ─── Action Handlers ─────────────────────────────────────────────────────────

async function dispatchWebhook(url: string, event: WorkflowEvent): Promise<void> {
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-TagBot-Event": event.triggerOn },
            body: JSON.stringify(event),
            signal: AbortSignal.timeout(5000) // 5s hard timeout
        });
        console.log(`[WORKFLOW_WEBHOOK] POST ${url} → ${res.status}`);
    } catch (err: any) {
        console.error(`[WORKFLOW_WEBHOOK] Failed to POST ${url}:`, err.message);
    }
}

async function logWorkflowEvent(actionName: string, event: WorkflowEvent): Promise<void> {
    // Structured log — visible in Vercel function logs
    console.log(JSON.stringify({
        type: "WORKFLOW_LOG",
        actionName,
        storeId: event.storeId,
        customerId: event.customerId,
        trigger: event.triggerOn,
        tags: event.tags,
        timestamp: event.timestamp
    }));
}

async function prepareEmailNotification(
    actionName: string,
    event: WorkflowEvent,
    tag: string
): Promise<void> {
    // Persist to ActivityLog as a workflow event marker so future email providers can query it
    await db.activityLog.create({
        data: {
            storeId: event.storeId,
            customerId: event.customerId,
            action: "WORKFLOW_EMAIL_PREP",
            tagContext: tag,
            reason: `Workflow "${actionName}" queued email notification`
        }
    }).catch(err => console.error("[WORKFLOW_EMAIL_PREP] DB error:", err));
}
