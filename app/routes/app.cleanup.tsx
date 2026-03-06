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
        <Page backAction={{ content: "Dashboard", url: "/app" }}>
            <div className="ds-page" style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 60 }}>
                
                <div style={{ padding: '24px 0 32px' }}>
                    <h1 className="ds-section-title" style={{ fontSize: 26, letterSpacing: '-0.5px' }}>
                        🧹 Smart Tag Cleanup
                    </h1>
                    <p style={{ fontSize: 14, color: '#9ca3af', margin: 0 }}>Remove or consolidate tags across your entire customer base.</p>
                </div>

                {/* Premium gate */}
                {isFree && (
                    <div className="ds-alert error" style={{ marginBottom: 24 }}>
                        <div style={{ flex: 1 }}>Smart Cleanup requires a <strong>Growth</strong>, <strong>Pro</strong>, or <strong>Elite</strong> plan.</div>
                        <button className="ds-btn sm" style={{ background: '#fff', border: '1px solid #e5e7eb' }} onClick={() => navigate("/app/pricing")}>Upgrade Plan</button>
                    </div>
                )}

                {/* ── PROGRESS BANNER (shown while submitting) ── */}
                {isSubmitting && submittingTag && (
                    <div className="ds-card" style={{ marginBottom: 24, border: '1px solid #e0e7ff', background: '#eef2ff' }}>
                        <div style={{ fontWeight: 600, color: '#3730a3', fontSize: 16, marginBottom: 4 }}>
                            {submittingIntent === "merge"
                                ? `Merging "${submittingTag}"…`
                                : `Deleting tag "${submittingTag}" from all customers…`}
                        </div>
                        <div style={{ fontSize: 13, color: '#4f46e5', marginBottom: 16 }}>
                            Please keep this page open. TagBot AI is updating Shopify tags in real time.
                        </div>
                        {/* Animated indeterminate progress bar */}
                        <div style={{
                            width: "100%", height: "8px", backgroundColor: "rgba(99, 102, 241, 0.2)",
                            borderRadius: "4px", overflow: "hidden", position: "relative"
                        }}>
                            <div style={{
                                position: "absolute", top: 0, left: 0, height: "100%", width: "40%",
                                backgroundColor: "#6366f1", borderRadius: "4px",
                                animation: "tagbot-progress 1.4s ease-in-out infinite"
                            }} />
                        </div>
                        <style>{`
                            @keyframes tagbot-progress {
                                0%   { left: -40%; }
                                100% { left: 110%; }
                            }
                        `}</style>
                    </div>
                )}

                {/* ── RESULT BANNER (shown after action returns) ── */}
                {!isSubmitting && actionData?.message && (
                    <div className={`ds-alert ${actionData.success ? 'success' : 'error'}`} style={{ marginBottom: 24 }}>
                        {actionData.message}
                    </div>
                )}

                {/* ── TAG LIST ── */}
                <div className="ds-card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f3f4f6' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ color: '#8b5cf6', display: 'flex' }}><Icon source={MagicIcon} /></div>
                            <div className="ds-card-title" style={{ margin: 0 }}>All Tags</div>
                        </div>
                        <span className="ds-tag gray" style={{ fontWeight: 500 }}>{sortedTags.length} unique tags</span>
                    </div>

                    {sortedTags.length === 0 ? (
                        <div className="ds-empty">
                            <div className="ds-empty-icon" style={{ background: '#f5f3ff', color: '#8b5cf6' }}>✨</div>
                            <div className="ds-empty-title">No Tags Found</div>
                            <div className="ds-empty-body">Your store currently has no customer tags. Tag some customers manually or via rules to see them here.</div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {sortedTags.map((item, idx) => (
                                <div key={item.id} style={{ 
                                    padding: '16px 24px', 
                                    borderBottom: idx < sortedTags.length - 1 ? '1px solid #f9fafb' : 'none',
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center',
                                    opacity: (isFree || isSubmitting) ? 0.6 : 1
                                }}>
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: 15, color: '#111827', marginBottom: 2 }}>{item.name}</div>
                                        <div style={{ fontSize: 13, color: '#6b7280' }}>{item.count} customers</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button 
                                            className="ds-btn ghost sm"
                                            disabled={isFree || isSubmitting}
                                            onClick={() => openMerge(item.name)}
                                        >
                                            <Icon source={ReplaceIcon} /> Merge Into…
                                        </button>
                                        <button 
                                            className="ds-btn danger sm"
                                            disabled={isFree || isSubmitting}
                                            style={{ opacity: (isSubmitting && activeTag === item.name) ? 0.5 : 1 }}
                                            onClick={() => handleDelete(item.name)}
                                        >
                                            <Icon source={DeleteIcon} /> {(isSubmitting && activeTag === item.name) ? "Deleting..." : "Delete All"}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

            </div>

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
