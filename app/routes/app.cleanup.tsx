import { data } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigate } from "react-router";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Button, ResourceList, ResourceItem, Box, TextField, Modal, Icon, Banner } from "@shopify/polaris";
import { MagicIcon, DeleteIcon, ReplaceIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";
import { useState, useCallback } from "react";

// Shape of what the action returns when a delete/merge is initiated
interface ActionData {
    success: boolean;
    message?: string;
    // When a cleanup is ready to start, the action returns the customer list for client-side processing
    cleanupJob?: {
        storeId: string;
        customerIds: string[]; // Shopify GIDs: "gid://shopify/Customer/123"
        tagsToAdd: string[];
        tagsToRemove: string[];
        label: string;
    };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;
    const store = await getCachedStore(shop);
    if (!store) throw new Error("Store not found");

    const customers = await db.customer.findMany({
        where: { storeId: store.id },
        select: { tags: true }
    });

    const tagCounts: Record<string, number> = {};
    for (const c of customers) {
        if (c.tags) {
            for (const tag of c.tags.split(",").map(t => t.trim()).filter(Boolean)) {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            }
        }
    }

    const sortedTags = Object.entries(tagCounts)
        .map(([name, count]) => ({ id: name, name, count }))
        .sort((a, b) => b.count - a.count);

    return data({ sortedTags, planName: store.planName, storeId: store.id });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;
    const store = await getCachedStore(shop);
    if (!store) return data({ success: false, message: "Store not found" });

    if (store.planName === "Free") {
        return data({ success: false, message: "Advanced Smart Cleanup is only available on Growth, Pro, and Elite plans." });
    }

    const formData = await request.formData();
    const actionType = formData.get("action");

    if (actionType === "delete_tag") {
        const targetTag = formData.get("targetTag") as string;
        const affected = await db.customer.findMany({
            where: { storeId: store.id, tags: { contains: targetTag } },
            select: { id: true }
        });
        if (affected.length === 0) return data({ success: true, message: "Tag is not applied anywhere — nothing to delete." });

        return data({
            success: true,
            cleanupJob: {
                storeId: store.id,
                customerIds: affected.map(c => `gid://shopify/Customer/${c.id}`),
                tagsToRemove: [targetTag],
                tagsToAdd: [],
                label: `Deleting "${targetTag}" from ${affected.length} customers`
            }
        });
    }

    if (actionType === "merge_tag") {
        const sourceTag = formData.get("sourceTag") as string;
        const destinationTag = formData.get("destinationTag") as string;
        if (!sourceTag || !destinationTag || sourceTag === destinationTag) {
            return data({ success: false, message: "Invalid source or destination tag." });
        }
        const affected = await db.customer.findMany({
            where: { storeId: store.id, tags: { contains: sourceTag } },
            select: { id: true }
        });
        if (affected.length === 0) return data({ success: true, message: "Source tag is not applied anywhere — nothing to merge." });

        return data({
            success: true,
            cleanupJob: {
                storeId: store.id,
                customerIds: affected.map(c => `gid://shopify/Customer/${c.id}`),
                tagsToRemove: [sourceTag],
                tagsToAdd: [destinationTag],
                label: `Merging "${sourceTag}" → "${destinationTag}" for ${affected.length} customers`
            }
        });
    }

    return data({ success: false });
};

export default function SmartCleanup() {
    const { sortedTags, planName, storeId } = useLoaderData<typeof loader>();
    const actionData = useActionData() as ActionData | undefined;
    const navigate = useNavigate();

    const isFree = planName === "Free" || planName === "";

    // ── Client-side batch processing state ──────────────────────────────────
    const [job, setJob] = useState<{
        label: string;
        total: number;
        completed: number;
        status: "idle" | "running" | "done" | "error";
        errorMsg?: string;
    }>({ label: "", total: 0, completed: 0, status: "idle" });

    // Trigger the client-side loop when the action returns a cleanup job
    const runCleanup = useCallback(async (cleanupJob: NonNullable<ActionData["cleanupJob"]>) => {
        const { customerIds, tagsToAdd, tagsToRemove, label } = cleanupJob;
        const total = customerIds.length;

        setJob({ label, total, completed: 0, status: "running" });

        for (let i = 0; i < customerIds.length; i++) {
            try {
                const fd = new FormData();
                fd.set("shopifyCustomerId", customerIds[i]);
                fd.set("tagsToAdd", JSON.stringify(tagsToAdd));
                fd.set("tagsToRemove", JSON.stringify(tagsToRemove));
                fd.set("storeId", storeId);
                fd.set("completedSoFar", String(i));
                fd.set("totalTarget", String(total));

                const res = await fetch("/app/cleanup-process", { method: "POST", body: fd });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
            } catch (err: any) {
                setJob(prev => ({ ...prev, status: "error", errorMsg: err.message }));
                return;
            }
            setJob(prev => ({ ...prev, completed: i + 1 }));
        }

        setJob(prev => ({ ...prev, status: "done" }));
    }, [storeId]);

    // When actionData arrives with a cleanupJob, kick off the loop
    const [lastProcessedJob, setLastProcessedJob] = useState<string | null>(null);
    if (actionData?.cleanupJob && job.status === "idle") {
        const jobKey = JSON.stringify(actionData.cleanupJob.customerIds);
        if (jobKey !== lastProcessedJob) {
            setLastProcessedJob(jobKey);
            // Use setTimeout to avoid calling setState during render
            setTimeout(() => runCleanup(actionData.cleanupJob!), 0);
        }
    }

    // ── Progress helpers ────────────────────────────────────────────────────
    const isRunning = job.status === "running";
    const isDone = job.status === "done";
    const isError = job.status === "error";
    const percentage = job.total > 0 ? Math.round((job.completed / job.total) * 100) : 0;

    // ── Merge modal state ───────────────────────────────────────────────────
    const [mergeModalOpen, setMergeModalOpen] = useState(false);
    const [selectedSourceTag, setSelectedSourceTag] = useState("");
    const [destinationTag, setDestinationTag] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleDelete = async (tag: string) => {
        if (!confirm(`Remove tag "${tag}" from ALL customers? This cannot be undone.`)) return;
        setIsSubmitting(true);
        const fd = new FormData();
        fd.set("action", "delete_tag");
        fd.set("targetTag", tag);
        const res = await fetch("/app/cleanup", { method: "POST", body: fd });
        const result: ActionData = await res.json();
        setIsSubmitting(false);
        if (result.cleanupJob) {
            runCleanup(result.cleanupJob);
        }
    };

    const openMergeModal = (tag: string) => {
        setSelectedSourceTag(tag);
        setDestinationTag("");
        setMergeModalOpen(true);
    };

    const handleMergeSubmit = async () => {
        if (!destinationTag.trim()) return;
        setMergeModalOpen(false);
        setIsSubmitting(true);
        const fd = new FormData();
        fd.set("action", "merge_tag");
        fd.set("sourceTag", selectedSourceTag);
        fd.set("destinationTag", destinationTag.trim());
        const res = await fetch("/app/cleanup", { method: "POST", body: fd });
        const result: ActionData = await res.json();
        setIsSubmitting(false);
        if (result.cleanupJob) {
            runCleanup(result.cleanupJob);
        }
    };

    const handleDismiss = () => {
        setJob({ label: "", total: 0, completed: 0, status: "idle" });
        // Reload to refresh the tag list after cleanup
        navigate(".", { replace: true });
    };

    return (
        <Page
            title="Smart Tag Cleanup"
            subtitle="Consolidate duplicate tags, merge messy taxonomy rules, and fix Shopify's case-sensitivity issues globally."
            backAction={{ content: 'Dashboard', url: '/app' }}
        >
            <Layout>
                {/* Premium Gate */}
                {isFree && (
                    <Layout.Section>
                        <Banner tone="critical" title="Premium Feature">
                            <BlockStack gap="200">
                                <Text as="p">Smart Tag Cleanup is available on Growth, Pro, and Elite plans.</Text>
                                <Button tone="critical" onClick={() => navigate('/app/pricing')}>Upgrade to Unlock</Button>
                            </BlockStack>
                        </Banner>
                    </Layout.Section>
                )}

                {/* ── LIVE PROGRESS BAR ────────────────────────────────── */}
                {(isRunning || isDone || isError) && (
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="300">
                                <InlineStack align="space-between" blockAlign="center">
                                    <Text variant="headingSm" as="h3">
                                        {isError ? "⚠️ Error during cleanup" : isDone ? "✅ Cleanup Complete!" : job.label}
                                    </Text>
                                    <Text variant="bodyMd" fontWeight="bold" as="span">
                                        {percentage}%
                                    </Text>
                                </InlineStack>

                                {/* Progress track */}
                                <Box paddingBlockEnd="100">
                                    <div style={{
                                        width: '100%',
                                        height: '12px',
                                        backgroundColor: 'var(--p-color-bg-surface-secondary)',
                                        borderRadius: '6px',
                                        overflow: 'hidden'
                                    }}>
                                        <div style={{
                                            width: `${percentage}%`,
                                            height: '100%',
                                            backgroundColor: isError
                                                ? 'var(--p-color-bg-fill-critical)'
                                                : isDone
                                                    ? 'var(--p-color-bg-fill-success)'
                                                    : 'var(--p-color-bg-fill-magic)',
                                            transition: 'width 0.3s ease-out'
                                        }} />
                                    </div>
                                </Box>

                                <InlineStack align="space-between" blockAlign="center">
                                    <Text as="p" tone="subdued">
                                        {isError
                                            ? `Failed: ${job.errorMsg}`
                                            : `${job.completed.toLocaleString()} of ${job.total.toLocaleString()} customers processed`
                                        }
                                    </Text>
                                    {(isDone || isError) && (
                                        <Button onClick={handleDismiss} size="slim">
                                            {isDone ? "Done — Refresh List" : "Dismiss"}
                                        </Button>
                                    )}
                                </InlineStack>
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                )}
                {/* ───────────────────────────────────────────────────────── */}

                <Layout.Section>
                    <Card padding="0">
                        <Box padding="400">
                            <BlockStack gap="400">
                                <InlineStack align="space-between" blockAlign="center">
                                    <InlineStack gap="200" blockAlign="center">
                                        <Icon source={MagicIcon} tone="magic" />
                                        <Text variant="headingMd" as="h3">Global Taxonomy</Text>
                                    </InlineStack>
                                    {/* @ts-ignore */}
                                    <Badge tone="info">{`${sortedTags.length} Unique Tags`}</Badge>
                                </InlineStack>
                                <Text as="p" tone="subdued">
                                    All unique tags across your tracked customers. Consolidate variations (like "VIP" and "vip") to keep your analytics clean.
                                </Text>
                            </BlockStack>
                        </Box>

                        <ResourceList
                            resourceName={{ singular: 'tag', plural: 'tags' }}
                            items={sortedTags}
                            renderItem={(item) => {
                                const { id, name, count } = item;
                                return (
                                    <ResourceItem id={id} onClick={() => { }} disabled={isFree}>
                                        <InlineStack align="space-between" blockAlign="center">
                                            <BlockStack gap="100">
                                                <Text variant="bodyMd" fontWeight="bold" as="h3">{name}</Text>
                                                <Text variant="bodySm" tone="subdued" as="span">Applied to {count} customers</Text>
                                            </BlockStack>
                                            <InlineStack gap="200">
                                                {/* @ts-ignore */}
                                                <Button size="micro" icon={ReplaceIcon} disabled={isFree || isSubmitting || isRunning} onClick={() => openMergeModal(name)}>Merge Into...</Button>
                                                {/* @ts-ignore */}
                                                <Button size="micro" tone="critical" icon={DeleteIcon} disabled={isFree || isSubmitting || isRunning} onClick={() => handleDelete(name)}>Delete All</Button>
                                            </InlineStack>
                                        </InlineStack>
                                    </ResourceItem>
                                );
                            }}
                        />
                    </Card>
                </Layout.Section>

                <Modal
                    open={mergeModalOpen}
                    onClose={() => setMergeModalOpen(false)}
                    title={`Merge Tag: "${selectedSourceTag}"`}
                    primaryAction={{
                        content: 'Execute Merge',
                        onAction: handleMergeSubmit,
                        disabled: !destinationTag.trim() || isRunning
                    }}
                    secondaryActions={[{ content: 'Cancel', onAction: () => setMergeModalOpen(false) }]}
                >
                    <Modal.Section>
                        <BlockStack gap="400">
                            <Text as="p">
                                All customers with <strong>"{selectedSourceTag}"</strong> will have it replaced with the destination tag below.
                            </Text>
                            <TextField
                                label="Destination Tag"
                                value={destinationTag}
                                onChange={setDestinationTag}
                                autoComplete="off"
                                placeholder="E.g. VIP-Gold"
                                helpText="Case-sensitive — 'vip' and 'VIP' are two different tags in Shopify."
                            />
                        </BlockStack>
                    </Modal.Section>
                </Modal>
            </Layout>
        </Page>
    );
}
