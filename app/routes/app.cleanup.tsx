import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigation, useNavigate, useSubmit, Form } from "react-router";
import {
    Page, Layout, Card, Text, BlockStack, InlineStack, Badge,
    Button, Box, TextField, Modal, Icon, Banner, ResourceList, ResourceItem
} from "@shopify/polaris";
import { MagicIcon, DeleteIcon, ReplaceIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";
import { useState } from "react";

// ─── Loader ───────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    if (!store) throw new Error("Store not found");

    const customers = await db.customer.findMany({
        where: { storeId: store.id },
        select: { tags: true }
    });

    const tagCounts: Record<string, number> = {};
    for (const c of customers) {
        if (!c.tags) continue;
        for (const tag of c.tags.split(",").map(t => t.trim()).filter(Boolean)) {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
    }

    const sortedTags = Object.entries(tagCounts)
        .map(([name, count]) => ({ id: name, name, count }))
        .sort((a, b) => b.count - a.count);

    return { sortedTags, planName: store.planName, storeId: store.id };
};

// ─── Action (runs synchronously — processes all customers before returning) ────
export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    if (!store) return { success: false, message: "Store not found." };

    if (store.planName === "Free") {
        return { success: false, message: "Smart Cleanup requires a Growth, Pro, or Elite plan." };
    }

    const form = await request.formData();
    const intent = form.get("intent") as string;
    const targetTag = form.get("targetTag") as string;
    const destinationTag = form.get("destinationTag") as string | null;

    if (!targetTag) return { success: false, message: "No tag specified." };

    // Find all customers who have this tag in our local database
    const affected = await db.customer.findMany({
        where: { storeId: store.id, tags: { contains: targetTag } },
        select: { id: true, tags: true }
    });

    if (affected.length === 0) {
        return { success: true, message: `No customers found with the tag "${targetTag}".`, count: 0 };
    }

    let processedCount = 0;
    let errorCount = 0;

    for (const customer of affected) {
        try {
            const gid = `gid://shopify/Customer/${customer.id}`;

            // Fetch current tags from Shopify
            const response = await admin.graphql(`
                #graphql
                query GetCustomerTags($id: ID!) {
                    customer(id: $id) { tags }
                }
            `, { variables: { id: gid } });
            const resData = await response.json();
            const currentTags: string[] = resData.data?.customer?.tags ?? [];

            // Compute new tag list
            let newTags = currentTags.filter(t => t !== targetTag);
            if (intent === "merge" && destinationTag && !newTags.includes(destinationTag)) {
                newTags.push(destinationTag);
            }

            // Push to Shopify
            await admin.graphql(`
                #graphql
                mutation UpdateTags($input: CustomerInput!) {
                    customerUpdate(input: $input) {
                        userErrors { field message }
                    }
                }
            `, { variables: { input: { id: gid, tags: newTags } } });

            // Update our local DB
            await db.customer.update({
                where: { id_storeId: { id: customer.id, storeId: store.id } },
                data: { tags: newTags.join(",") }
            });

            // Log it
            await db.activityLog.create({
                data: {
                    storeId: store.id,
                    customerId: customer.id,
                    action: "TAG_REMOVED",
                    tagContext: targetTag,
                    reason: intent === "merge"
                        ? `Merged into "${destinationTag}" via Tag Cleanup`
                        : "Deleted via Tag Cleanup"
                }
            });

            processedCount++;
        } catch (e: any) {
            console.error(`[CLEANUP] Failed for customer ${customer.id}:`, e.message);
            errorCount++;
        }
    }

    if (intent === "merge" && destinationTag) {
        return {
            success: errorCount === 0,
            message: errorCount === 0
                ? `✅ Successfully merged "${targetTag}" → "${destinationTag}" for ${processedCount} customers!`
                : `Completed with ${errorCount} errors. ${processedCount} customers updated.`,
            count: processedCount
        };
    }

    return {
        success: errorCount === 0,
        message: errorCount === 0
            ? `✅ Successfully deleted the tag "${targetTag}" from ${processedCount} customers!`
            : `Completed with ${errorCount} errors. ${processedCount} customers updated.`,
        count: processedCount
    };
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function SmartCleanup() {
    const { sortedTags, planName } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const navigate = useNavigate();
    const submit = useSubmit();

    const isSubmitting = navigation.state === "submitting";
    const isFree = !planName || planName === "Free";

    // Which tag is currently being processed (for button loading state)
    const [activeTag, setActiveTag] = useState<string | null>(null);

    // Merge modal state
    const [mergeOpen, setMergeOpen] = useState(false);
    const [mergeSource, setMergeSource] = useState("");
    const [mergeDest, setMergeDest] = useState("");

    const handleDelete = (tag: string) => {
        if (!confirm(`Remove "${tag}" from ALL customers? This cannot be undone.`)) return;
        setActiveTag(tag);
        const fd = new FormData();
        fd.set("intent", "delete");
        fd.set("targetTag", tag);
        submit(fd, { method: "post" });
    };

    const openMerge = (tag: string) => {
        setMergeSource(tag);
        setMergeDest("");
        setMergeOpen(true);
    };

    const handleMerge = () => {
        if (!mergeDest.trim()) return;
        setActiveTag(mergeSource);
        setMergeOpen(false);
        const fd = new FormData();
        fd.set("intent", "merge");
        fd.set("targetTag", mergeSource);
        fd.set("destinationTag", mergeDest.trim());
        submit(fd, { method: "post" });
    };

    // What tag name is in the submitted form (to show on the progress bar)
    const submittingTag = navigation.formData?.get("targetTag") as string | undefined;
    const submittingIntent = navigation.formData?.get("intent") as string | undefined;

    return (
        <Page
            title="Smart Tag Cleanup"
            subtitle="Remove or consolidate tags across your entire customer base."
            backAction={{ content: "Dashboard", url: "/app" }}
        >
            <Layout>
                {/* Premium gate */}
                {isFree && (
                    <Layout.Section>
                        <Banner tone="critical" title="Premium Feature">
                            <BlockStack gap="200">
                                <Text as="p">Smart Cleanup requires a Growth, Pro, or Elite plan.</Text>
                                <Button tone="critical" onClick={() => navigate("/app/pricing")}>Upgrade</Button>
                            </BlockStack>
                        </Banner>
                    </Layout.Section>
                )}

                {/* ── PROGRESS BANNER (shown while submitting) ── */}
                {isSubmitting && submittingTag && (
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="300">
                                <Text variant="headingSm" as="h3">
                                    {submittingIntent === "merge"
                                        ? `Merging "${submittingTag}"…`
                                        : `Deleting tag "${submittingTag}" from all customers…`}
                                </Text>
                                <Text as="p" tone="subdued">
                                    Please keep this page open. TagBot AI is updating Shopify tags in real time.
                                </Text>
                                {/* Animated indeterminate progress bar */}
                                <Box paddingBlockStart="100">
                                    <div style={{
                                        width: "100%",
                                        height: "10px",
                                        backgroundColor: "var(--p-color-bg-surface-secondary)",
                                        borderRadius: "5px",
                                        overflow: "hidden",
                                        position: "relative"
                                    }}>
                                        <div style={{
                                            position: "absolute",
                                            top: 0,
                                            left: 0,
                                            height: "100%",
                                            width: "40%",
                                            backgroundColor: "var(--p-color-bg-fill-magic)",
                                            borderRadius: "5px",
                                            animation: "tagbot-progress 1.4s ease-in-out infinite"
                                        }} />
                                    </div>
                                    <style>{`
                                        @keyframes tagbot-progress {
                                            0%   { left: -40%; }
                                            100% { left: 110%; }
                                        }
                                    `}</style>
                                </Box>
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                )}

                {/* ── RESULT BANNER (shown after action returns) ── */}
                {!isSubmitting && actionData?.message && (
                    <Layout.Section>
                        <Banner tone={actionData.success ? "success" : "critical"}>
                            <Text as="p">{actionData.message}</Text>
                        </Banner>
                    </Layout.Section>
                )}

                {/* ── TAG LIST ── */}
                <Layout.Section>
                    <Card padding="0">
                        <Box padding="400">
                            <InlineStack align="space-between" blockAlign="center">
                                <InlineStack gap="200" blockAlign="center">
                                    <Icon source={MagicIcon} tone="magic" />
                                    <Text variant="headingMd" as="h3">All Tags</Text>
                                </InlineStack>
                                {/* @ts-ignore */}
                                <Badge tone="info">{sortedTags.length} unique tags</Badge>
                            </InlineStack>
                        </Box>

                        <ResourceList
                            resourceName={{ singular: "tag", plural: "tags" }}
                            items={sortedTags}
                            renderItem={(item) => (
                                <ResourceItem id={item.id} onClick={() => { }} disabled={isFree}>
                                    <InlineStack align="space-between" blockAlign="center">
                                        <BlockStack gap="100">
                                            <Text variant="bodyMd" fontWeight="bold" as="h3">{item.name}</Text>
                                            <Text variant="bodySm" tone="subdued" as="span">{item.count} customers</Text>
                                        </BlockStack>
                                        <InlineStack gap="200">
                                            {/* @ts-ignore */}
                                            <Button
                                                size="micro"
                                                icon={ReplaceIcon}
                                                disabled={isFree || isSubmitting}
                                                onClick={() => openMerge(item.name)}
                                            >
                                                Merge Into…
                                            </Button>
                                            {/* @ts-ignore */}
                                            <Button
                                                size="micro"
                                                tone="critical"
                                                icon={DeleteIcon}
                                                disabled={isFree || isSubmitting}
                                                loading={isSubmitting && activeTag === item.name}
                                                onClick={() => handleDelete(item.name)}
                                            >
                                                Delete All
                                            </Button>
                                        </InlineStack>
                                    </InlineStack>
                                </ResourceItem>
                            )}
                        />
                    </Card>
                </Layout.Section>
            </Layout>

            {/* ── Merge Modal ── */}
            <Modal
                open={mergeOpen}
                onClose={() => setMergeOpen(false)}
                title={`Merge "${mergeSource}"`}
                primaryAction={{
                    content: "Merge",
                    onAction: handleMerge,
                    disabled: !mergeDest.trim()
                }}
                secondaryActions={[{ content: "Cancel", onAction: () => setMergeOpen(false) }]}
            >
                <Modal.Section>
                    <BlockStack gap="400">
                        <Text as="p">
                            All customers tagged <strong>"{mergeSource}"</strong> will have it replaced with the tag below.
                        </Text>
                        <TextField
                            label="Destination Tag"
                            value={mergeDest}
                            onChange={setMergeDest}
                            autoComplete="off"
                            placeholder="e.g. VIP-Gold"
                            helpText="Case-sensitive. 'vip' and 'VIP' are different tags in Shopify."
                        />
                    </BlockStack>
                </Modal.Section>
            </Modal>
        </Page>
    );
}
