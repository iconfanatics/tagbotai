import { data } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useSubmit, useNavigation, useNavigate } from "react-router";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Button, ResourceList, ResourceItem, Box, TextField, Modal, Icon, Banner } from "@shopify/polaris";
import { MagicIcon, DeleteIcon, ReplaceIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";
import { enqueueSyncJob } from "../services/queue.server";
import { useState } from "react";

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

    return data({ sortedTags, planName: store.planName });
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

        // Find customers with this tag
        const affectedCustomers = await db.customer.findMany({
            where: { storeId: store.id, tags: { contains: targetTag } },
            select: { id: true, tags: true }
        });

        if (affectedCustomers.length === 0) return data({ success: true, message: "Tag is not applied anywhere." });

        // Enqueue background removal job
        // Note: enqueueSyncJob expects full node data, so we reconstruct it as an empty diff except for tags
        enqueueSyncJob({
            shop,
            storeId: store.id,
            syncType: "CLEANUP",
            syncMessage: `TagBot AI is deleting all instances of the tag "${targetTag}". This relies on standard Shopify API rate limits.`,
            tagsToRemove: [targetTag],
            customersToSync: affectedCustomers.map(c => ({
                node: {
                    id: `gid://shopify/Customer/${c.id}`,
                    tags: c.tags ? c.tags.split(",").map(t => t.trim()).filter(t => t !== targetTag) : [],
                    // Provide empty defaults since the queue only updates missing properties vs diffs
                    firstName: "", lastName: "", email: "", amountSpent: { amount: "0" }, numberOfOrders: "0"
                }
            }))
        });

        return data({ success: true, message: `Dispatched cleanup job to remove "${targetTag}" from ${affectedCustomers.length} customers.` });
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
            syncMessage: `TagBot AI is merging the tag "${sourceTag}" into "${destinationTag}".`,
            tagsToRemove: [sourceTag],
            tagsToAdd: [destinationTag],
            customersToSync: affectedCustomers.map(c => {
                let tags = c.tags ? c.tags.split(",").map(t => t.trim()) : [];
                tags = tags.filter(t => t !== sourceTag); // Remove old
                if (!tags.includes(destinationTag)) tags.push(destinationTag); // Add new

                return {
                    node: {
                        id: `gid://shopify/Customer/${c.id}`,
                        tags,
                        firstName: "", lastName: "", email: "", amountSpent: { amount: "0" }, numberOfOrders: "0"
                    }
                };
            })
        });

        return data({ success: true, message: `Dispatched merge job: replacing "${sourceTag}" with "${destinationTag}" for ${affectedCustomers.length} customers.` });
    }

    return data({ success: false });
};

export default function SmartCleanup() {
    const { sortedTags, planName } = useLoaderData<typeof loader>();
    const actionData = useActionData() as ActionData;
    const submit = useSubmit();
    const navigation = useNavigation();
    const navigate = useNavigate();

    const isProcessing = navigation.state === "submitting";
    const isFree = planName === "Free" || planName === "";

    const [mergeModalOpen, setMergeModalOpen] = useState(false);
    const [selectedSourceTag, setSelectedSourceTag] = useState("");
    const [destinationTag, setDestinationTag] = useState("");

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
                                <Text as="p">Smart Tag Cleanup is an advanced feature reserved for Growth, Pro, and Elite plans. It relies on extensive background queue processing to bulk-modify Shopify taxonomies safely.</Text>
                                <InlineStack>
                                    <Button tone="critical" onClick={() => navigate('/app/pricing')}>Upgrade to Unlock</Button>
                                </InlineStack>
                            </BlockStack>
                        </Banner>
                    </Layout.Section>
                )}

                {actionData?.message && (
                    <Layout.Section>
                        <Banner tone={actionData.success ? "success" : "critical"}>
                            {actionData.message}
                        </Banner>
                    </Layout.Section>
                )}

                <Layout.Section>
                    <Card padding="0">
                        <Box padding="400">
                            <BlockStack gap="400">
                                <InlineStack align="space-between" blockAlign="center">
                                    <InlineStack gap="200" align="start" blockAlign="center">
                                        <Icon source={MagicIcon} tone="magic" />
                                        <Text variant="headingMd" as="h3">Global Taxonomy</Text>
                                    </InlineStack>
                                    {/* @ts-ignore - Bypass React Router v7 strict String-Array interpolation checking */}
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
                                                <Button size="micro" icon={ReplaceIcon} disabled={isFree || isProcessing} onClick={() => { openMergeModal(name); }}>Merge Into...</Button>
                                                {/* @ts-ignore */}
                                                <Button size="micro" tone="critical" icon={DeleteIcon} disabled={isFree || isProcessing} onClick={() => { handleDelete(name); }}>Delete All</Button>
                                            </InlineStack>
                                        </InlineStack>
                                    </ResourceItem>
                                );
                            }}
                        />
                    </Card>
                </Layout.Section>

                {/* Setup the Merge Dialog Modal */}
                <Modal
                    open={mergeModalOpen}
                    onClose={() => setMergeModalOpen(false)}
                    title={`Merge Tag: "${selectedSourceTag}"`}
                    primaryAction={{
                        content: 'Execute Merge',
                        onAction: handleMergeSubmit,
                        disabled: !destinationTag.trim(),
                        loading: isProcessing
                    }}
                    secondaryActions={[
                        {
                            content: 'Cancel',
                            onAction: () => setMergeModalOpen(false),
                        },
                    ]}
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
