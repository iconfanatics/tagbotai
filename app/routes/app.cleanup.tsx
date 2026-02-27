import { data } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useSubmit, useNavigation, useNavigate, useRevalidator } from "react-router";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Button, ResourceList, ResourceItem, Box, TextField, Modal, Icon, Banner } from "@shopify/polaris";
import { MagicIcon, DeleteIcon, ReplaceIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";
import { enqueueSyncJob } from "../services/queue.server";
import { useState, useEffect } from "react";

interface ActionData {
    success: boolean;
    message?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const store = await getCachedStore(shop);
    if (!store) throw new Error("Store not found");

    // 1. Fetch all unique tags from our local database to avoid expensive Shopify queries
    const customers = await db.customer.findMany({
        where: { storeId: store.id },
        select: { tags: true }
    });

    // 2. Aggregate tags and count usage
    const tagCounts: Record<string, number> = {};
    for (const c of customers) {
        if (c.tags) {
            const splitTags = c.tags.split(",").map(t => t.trim()).filter(Boolean);
            for (const tag of splitTags) {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            }
        }
    }

    // 3. Format into a sorted array
    const sortedTags = Object.entries(tagCounts)
        .map(([name, count]) => ({ id: name, name, count }))
        .sort((a, b) => b.count - a.count);

    // 4. Pass sync progress so the Cleanup page can render its own progress bar
    const syncProgress = store.isSyncing ? {
        target: store.syncTarget,
        completed: store.syncCompleted,
        message: store.syncMessage
    } : null;

    return data({ sortedTags, planName: store.planName, syncProgress });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const store = await getCachedStore(shop);
    if (!store) return data({ success: false, message: "Store not found" });

    // Premium feature gate check
    if (store.planName === "Free") {
        return data({ success: false, message: "Advanced Smart Cleanup is only available on Growth, Pro, and Elite plans." });
    }

    const formData = await request.formData();
    const actionType = formData.get("action");

    if (actionType === "delete_tag") {
        const targetTag = formData.get("targetTag") as string;

        const affectedCustomers = await db.customer.findMany({
            where: { storeId: store.id, tags: { contains: targetTag } },
            select: { id: true, tags: true }
        });

        if (affectedCustomers.length === 0) return data({ success: true, message: "Tag is not applied anywhere." });

        enqueueSyncJob({
            shop,
            storeId: store.id,
            syncType: "CLEANUP",
            syncMessage: `Deleting tag "${targetTag}" from ${affectedCustomers.length} customers...`,
            tagsToRemove: [targetTag],
            customersToSync: affectedCustomers.map(c => ({
                node: {
                    id: `gid://shopify/Customer/${c.id}`,
                    tags: c.tags ? c.tags.split(",").map(t => t.trim()).filter(t => t !== targetTag) : [],
                    firstName: "", lastName: "", email: "", amountSpent: { amount: "0" }, numberOfOrders: "0"
                }
            }))
        });

        return data({ success: true, message: `Started deleting "${targetTag}" from ${affectedCustomers.length} customers. Watch the progress bar below.` });
    }

    if (actionType === "merge_tag") {
        const sourceTag = formData.get("sourceTag") as string;
        const destinationTag = formData.get("destinationTag") as string;

        if (!sourceTag || !destinationTag || sourceTag === destinationTag) {
            return data({ success: false, message: "Invalid Source or Destination tag selected." });
        }

        const affectedCustomers = await db.customer.findMany({
            where: { storeId: store.id, tags: { contains: sourceTag } },
            select: { id: true, tags: true }
        });

        if (affectedCustomers.length === 0) return data({ success: true, message: "Source Tag is not applied anywhere." });

        enqueueSyncJob({
            shop,
            storeId: store.id,
            syncType: "CLEANUP",
            syncMessage: `Merging "${sourceTag}" → "${destinationTag}" for ${affectedCustomers.length} customers...`,
            tagsToRemove: [sourceTag],
            tagsToAdd: [destinationTag],
            customersToSync: affectedCustomers.map(c => {
                let tags = c.tags ? c.tags.split(",").map(t => t.trim()) : [];
                tags = tags.filter(t => t !== sourceTag);
                if (!tags.includes(destinationTag)) tags.push(destinationTag);
                return {
                    node: {
                        id: `gid://shopify/Customer/${c.id}`,
                        tags,
                        firstName: "", lastName: "", email: "", amountSpent: { amount: "0" }, numberOfOrders: "0"
                    }
                };
            })
        });

        return data({ success: true, message: `Merging "${sourceTag}" into "${destinationTag}" for ${affectedCustomers.length} customers. Watch the progress bar below.` });
    }

    return data({ success: false });
};

export default function SmartCleanup() {
    const { sortedTags, planName, syncProgress } = useLoaderData<typeof loader>();
    const actionData = useActionData() as ActionData;
    const submit = useSubmit();
    const navigation = useNavigation();
    const navigate = useNavigate();
    const revalidator = useRevalidator();

    const isSubmitting = navigation.state === "submitting";
    const isFree = planName === "Free" || planName === "";
    const isRunning = syncProgress !== null;

    const [mergeModalOpen, setMergeModalOpen] = useState(false);
    const [selectedSourceTag, setSelectedSourceTag] = useState("");
    const [destinationTag, setDestinationTag] = useState("");

    // Live polling: revalidate the loader every 1.5s while a cleanup job is active
    useEffect(() => {
        if (!isRunning) return;
        const interval = setInterval(() => {
            revalidator.revalidate();
        }, 1500);
        return () => clearInterval(interval);
    }, [isRunning]);

    // Compute progress percentage
    let percentage = 0;
    if (syncProgress && syncProgress.target > 0) {
        percentage = Math.max(0, Math.min(100, Math.round((syncProgress.completed / syncProgress.target) * 100)));
    }

    const handleDelete = (tag: string) => {
        if (confirm(`Are you sure you want to remove the tag "${tag}" from ALL customers? This cannot be undone.`)) {
            submit({ action: "delete_tag", targetTag: tag }, { method: "post" });
        }
    };

    const openMergeModal = (tag: string) => {
        setSelectedSourceTag(tag);
        setDestinationTag("");
        setMergeModalOpen(true);
    };

    const handleMergeSubmit = () => {
        if (!destinationTag.trim()) return;
        submit({
            action: "merge_tag",
            sourceTag: selectedSourceTag,
            destinationTag: destinationTag.trim()
        }, { method: "post" });
        setMergeModalOpen(false);
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
                                <Text as="p">Smart Tag Cleanup is an advanced feature reserved for Growth, Pro, and Elite plans.</Text>
                                <InlineStack>
                                    <Button tone="critical" onClick={() => navigate('/app/pricing')}>Upgrade to Unlock</Button>
                                </InlineStack>
                            </BlockStack>
                        </Banner>
                    </Layout.Section>
                )}

                {/* Action result banner */}
                {actionData?.message && (
                    <Layout.Section>
                        <Banner tone={actionData.success ? "success" : "critical"}>
                            {actionData.message}
                        </Banner>
                    </Layout.Section>
                )}

                {/* ── LIVE PROGRESS BAR ─────────────────────────────────── */}
                {isRunning && (
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="300">
                                <InlineStack align="space-between" blockAlign="center">
                                    <Text variant="headingSm" as="h3">
                                        {syncProgress?.message || "Processing..."}
                                    </Text>
                                    <Text variant="bodyMd" fontWeight="bold" as="span">
                                        {percentage}%
                                    </Text>
                                </InlineStack>

                                {/* Progress track */}
                                <Box paddingBlockEnd="100">
                                    <div style={{ width: '100%', height: '10px', backgroundColor: 'var(--p-color-bg-surface-secondary)', borderRadius: '5px', overflow: 'hidden' }}>
                                        <div style={{
                                            width: `${percentage}%`,
                                            height: '100%',
                                            backgroundColor: percentage === 100 ? 'var(--p-color-bg-fill-success)' : 'var(--p-color-bg-fill-magic)',
                                            transition: 'width 0.6s ease-out'
                                        }} />
                                    </div>
                                </Box>

                                <Text as="p" tone="subdued">
                                    {syncProgress?.completed?.toLocaleString() ?? 0} of {syncProgress?.target?.toLocaleString() ?? 0} customers processed
                                </Text>

                                {percentage === 100 && (
                                    <Banner tone="success">
                                        ✅ Cleanup completed successfully! Refresh the page to see the updated tag list.
                                    </Banner>
                                )}
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                )}
                {/* ────────────────────────────────────────────────────────── */}

                <Layout.Section>
                    <Card padding="0">
                        <Box padding="400">
                            <BlockStack gap="400">
                                <InlineStack align="space-between" blockAlign="center">
                                    <InlineStack gap="200" align="start" blockAlign="center">
                                        <Icon source={MagicIcon} tone="magic" />
                                        <Text variant="headingMd" as="h3">Global Taxonomy</Text>
                                    </InlineStack>
                                    {/* @ts-ignore */}
                                    <Badge tone="info">{`${sortedTags.length} Unique Tags`}</Badge>
                                </InlineStack>
                                <Text as="p" tone="subdued">
                                    This list aggregates every tag currently applied across your tracked customer base. Consolidate variations (like "VIP" and "vip") to keep your analytics clean.
                                </Text>
                            </BlockStack>
                        </Box>

                        <ResourceList
                            resourceName={{ singular: 'tag', plural: 'tags' }}
                            items={sortedTags}
                            renderItem={(item) => {
                                const { id, name, count } = item;
                                return (
                                    <ResourceItem
                                        id={id}
                                        onClick={() => { }}
                                        disabled={isFree}
                                    >
                                        <InlineStack align="space-between" blockAlign="center">
                                            <BlockStack gap="100">
                                                <Text variant="bodyMd" fontWeight="bold" as="h3">{name}</Text>
                                                <Text variant="bodySm" tone="subdued" as="span">Applied to {count} customers</Text>
                                            </BlockStack>
                                            <InlineStack gap="200">
                                                {/* @ts-ignore */}
                                                <Button size="micro" icon={ReplaceIcon} disabled={isFree || isSubmitting || isRunning} onClick={() => { openMergeModal(name); }}>Merge Into...</Button>
                                                {/* @ts-ignore */}
                                                <Button size="micro" tone="critical" icon={DeleteIcon} disabled={isFree || isSubmitting || isRunning} onClick={() => { handleDelete(name); }}>Delete All</Button>
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
                        disabled: !destinationTag.trim(),
                        loading: isSubmitting
                    }}
                    secondaryActions={[{ content: 'Cancel', onAction: () => setMergeModalOpen(false) }]}
                >
                    <Modal.Section>
                        <BlockStack gap="400">
                            <Text as="p">
                                All customers with the tag <strong>"{selectedSourceTag}"</strong> will have it removed and replaced with the destination tag below.
                            </Text>
                            <TextField
                                label="Destination Tag"
                                value={destinationTag}
                                onChange={setDestinationTag}
                                autoComplete="off"
                                placeholder="E.g. VIP-Gold"
                                helpText="Case-sensitive! 'vip' and 'VIP' are considered two different tags in Shopify."
                            />
                        </BlockStack>
                    </Modal.Section>
                </Modal>
            </Layout>
        </Page>
    );
}
