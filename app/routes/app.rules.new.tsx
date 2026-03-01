import { useState } from "react";
import { authenticate } from "../shopify.server";
import { getCachedStore } from "../services/cache.server";
import db from "../db.server";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useActionData, useNavigation, useNavigate, redirect } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
    Page, Layout, Card, FormLayout, TextField, Select, Button, Banner,
    BlockStack, Text, InlineStack, Box, Divider, Icon, Badge, Tabs
} from "@shopify/polaris";
import {
    CashDollarIcon, PersonIcon, ClockIcon, SearchIcon, MagicIcon,
    CheckIcon, OrderIcon, PaymentIcon, DiscountIcon, LocationIcon
} from "@shopify/polaris-icons";

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    return { planName: store?.planName || "Free" };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    if (!store) return { error: "Store not found" };

    const { admin } = await authenticate.admin(request);
    const fd = await request.formData();

    const name = fd.get("name") as string;
    const ruleType = fd.get("ruleType") as string;
    const targetTag = fd.get("targetTag") as string;

    if (!name?.trim() || !targetTag?.trim()) return { error: "Rule name and tag are required." };

    let conditions: any[] = [];
    let description = "";
    let collectionId: string | null = null;
    let collectionName: string | null = null;

    if (ruleType === "metric") {
        const field = fd.get("field") as string;
        const operator = fd.get("operator") as string;
        const value = fd.get("value") as string;
        if (!field || !operator || !value) return { error: "All condition fields are required." };
        const cv = field !== "lastOrderDate" ? Number(value) : value;
        conditions = [{ field, operator, value: cv }];
        description = `Customer ${field} ${operator} ${cv}`;

    } else if (ruleType === "collection") {
        collectionId = fd.get("collectionId") as string;
        collectionName = fd.get("collectionName") as string;
        if (!collectionId || !collectionName) return { error: "Collection ID and Name are required." };
        description = `Purchases from: ${collectionName}`;

    } else if (ruleType === "order") {
        const orderField = fd.get("orderField") as string;
        const orderOperator = fd.get("orderOperator") as string;
        const orderValue = fd.get("orderValue") as string;
        if (!orderField || !orderOperator || !orderValue) return { error: "All order condition fields are required." };
        conditions = [{ field: orderField, operator: orderOperator, value: orderValue, ruleCategory: "order" }];
        description = `Order: ${orderField} ${orderOperator} "${orderValue}"`;
    }

    await db.rule.create({
        data: {
            storeId: store.id, name, description,
            conditions: JSON.stringify(conditions), targetTag,
            collectionId, collectionName, isActive: true
        }
    });

    if (ruleType === "metric") {
        try {
            const isFree = store.planName === "Free" || store.planName === "";
            const res = await admin.graphql(`#graphql
                query { customers(first: ${isFree ? 50 : 250}) {
                    edges { node { id email firstName lastName amountSpent { amount } numberOfOrders tags } }
                } }`);
            const data = await res.json();
            const customersToSync = data.data?.customers?.edges || [];
            if (customersToSync.length > 0) {
                const { enqueueSyncJob } = await import("../services/queue.server");
                enqueueSyncJob({ shop: session.shop, storeId: store.id, customersToSync });
            }
        } catch (e) { console.error("Auto-sync failed:", e); }
    }

    return redirect("/app");
};

// ─── Config ───────────────────────────────────────────────────────────────────

const ORDER_FIELDS = [
    { label: "Traffic Source (facebook, tiktok, google…)", value: "order_source" },
    { label: "Payment Method (paypal, stripe, cod…)", value: "payment_method" },
    { label: "Shipping City", value: "shipping_city" },
    { label: "Shipping Country (US, UK, BD…)", value: "shipping_country" },
    { label: "Total Item Quantity", value: "order_item_count" },
    { label: "Order Subtotal ($)", value: "order_subtotal" },
    { label: "Discount Code Used? (true / false)", value: "discount_code_used" },
    { label: "Specific Discount Code", value: "discount_code_value" },
    { label: "Discount Percentage Applied (%)", value: "discount_percentage" },
    { label: "Pre-Order Customer (true / false)", value: "is_preorder" },
];

const getOps = (field: string) => {
    if (["order_item_count", "order_subtotal", "discount_percentage"].includes(field))
        return [{ label: "Greater than (>)", value: "greaterThan" }, { label: "Less than (<)", value: "lessThan" }, { label: "Equals (=)", value: "equals" }];
    if (["discount_code_used", "is_preorder"].includes(field))
        return [{ label: "Equals (=)", value: "equals" }];
    return [{ label: "Contains", value: "contains" }, { label: "Exactly equals", value: "equals" }, { label: "Does not equal", value: "notEquals" }];
};

const getHint = (field: string) => ({
    order_source: "Use lowercase. E.g.: facebook, tiktok, instagram, google",
    payment_method: "Shopify gateway name. E.g.: paypal, cash_on_delivery, stripe",
    shipping_country: "2-letter ISO code. E.g.: US, UK, BD, AU, CA",
    discount_code_used: "Enter: true — to match orders WITH a code, false — without",
    is_preorder: "Enter: true — to match pre-order orders",
    discount_code_value: "Partial match supported. E.g.: SAVE15 or SUMMER",
}[field] || "");

// ─── Presets ─────────────────────────────────────────────────────────────────

type Preset = {
    key: string; label: string; description: string;
    icon: any; category: "customer" | "order";
    ruleType: string; field?: string; operator?: string; value?: string;
    orderField?: string; orderOperator?: string; orderValue?: string;
    tag: string;
};

const PRESETS: Preset[] = [
    { key: "big_spender", label: "Big Spenders", description: "Lifetime spend > $1,000", icon: CashDollarIcon, category: "customer", ruleType: "metric", field: "totalSpent", operator: "greaterThan", value: "1000", tag: "VIP" },
    { key: "loyalist", label: "Loyalists", description: "More than 5 orders", icon: PersonIcon, category: "customer", ruleType: "metric", field: "orderCount", operator: "greaterThan", value: "5", tag: "Loyal" },
    { key: "window_shopper", label: "Window Shoppers", description: "Zero orders placed", icon: SearchIcon, category: "customer", ruleType: "metric", field: "orderCount", operator: "equals", value: "0", tag: "Prospect" },
    { key: "at_risk", label: "At Risk", description: "No orders in 90 days", icon: ClockIcon, category: "customer", ruleType: "metric", field: "lastOrderDate", operator: "isBefore", value: "", tag: "AtRisk" },
    { key: "facebook_buyer", label: "Facebook Buyer", description: "Came from Facebook", icon: OrderIcon, category: "order", ruleType: "order", orderField: "order_source", orderOperator: "contains", orderValue: "facebook", tag: "Social-FB" },
    { key: "tiktok_buyer", label: "TikTok Buyer", description: "Came from TikTok", icon: OrderIcon, category: "order", ruleType: "order", orderField: "order_source", orderOperator: "contains", orderValue: "tiktok", tag: "Social-TT" },
    { key: "cod_customer", label: "COD Customer", description: "Paid with cash on delivery", icon: PaymentIcon, category: "order", ruleType: "order", orderField: "payment_method", orderOperator: "contains", orderValue: "cash_on_delivery", tag: "COD-Customer" },
    { key: "paypal_buyer", label: "PayPal Buyer", description: "Paid with PayPal", icon: PaymentIcon, category: "order", ruleType: "order", orderField: "payment_method", orderOperator: "equals", orderValue: "paypal", tag: "PayPal-Customer" },
    { key: "bulk_buyer", label: "Bulk Buyer", description: "Ordered 3+ items", icon: OrderIcon, category: "order", ruleType: "order", orderField: "order_item_count", orderOperator: "greaterThan", orderValue: "3", tag: "Bulk-Buyer" },
    { key: "discount_user", label: "Discount Hunter", description: "Used a discount code", icon: DiscountIcon, category: "order", ruleType: "order", orderField: "discount_code_used", orderOperator: "equals", orderValue: "true", tag: "Discount-User" },
    { key: "heavy_discount", label: "Heavy Discount", description: "Discount > 15%", icon: DiscountIcon, category: "order", ruleType: "order", orderField: "discount_percentage", orderOperator: "greaterThan", orderValue: "15", tag: "Heavy-Discounter" },
    { key: "preorder", label: "Pre-Order", description: "Bought a pre-order item", icon: ClockIcon, category: "order", ruleType: "order", orderField: "is_preorder", orderOperator: "equals", orderValue: "true", tag: "Pre-Order-Customer" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function NewRule() {
    const { planName } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const navigate = useNavigate();
    const shopify = useAppBridge();
    const isSubmitting = navigation.state === "submitting";
    const isFreePlan = !planName || planName === "Free";

    // Builder state
    const [name, setName] = useState("");
    const [ruleType, setRuleType] = useState<"metric" | "collection" | "order">("metric");
    const [targetTag, setTargetTag] = useState("");
    const [activePreset, setActivePreset] = useState<string | null>(null);

    // Metric
    const [field, setField] = useState("totalSpent");
    const [operator, setOperator] = useState("greaterThan");
    const [value, setValue] = useState("");

    // Collection
    const [collectionId, setCollectionId] = useState("");
    const [collectionName, setCollectionName] = useState("");

    // Order
    const [orderField, setOrderField] = useState("order_source");
    const [orderOperator, setOrderOperator] = useState("contains");
    const [orderValue, setOrderValue] = useState("");

    // AI
    const [aiPrompt, setAiPrompt] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [showAI, setShowAI] = useState(false);

    const handleOrderFieldChange = (v: string) => {
        setOrderField(v);
        setOrderOperator(getOps(v)[0].value);
        setOrderValue("");
    };

    const applyPreset = (p: Preset) => {
        setActivePreset(p.key);
        setName(p.label);
        setTargetTag(p.tag);
        setRuleType(p.ruleType as any);

        if (p.ruleType === "metric") {
            setField(p.field!);
            setOperator(p.operator!);
            if (p.key === "at_risk") {
                const d = new Date(); d.setDate(d.getDate() - 90);
                setValue(d.toISOString().split("T")[0]);
            } else {
                setValue(p.value!);
            }
        } else if (p.ruleType === "order") {
            setOrderField(p.orderField!);
            setOrderOperator(p.orderOperator!);
            setOrderValue(p.orderValue!);
        }
    };

    const handleAIGenerate = async () => {
        if (!aiPrompt.trim()) return;
        setIsGenerating(true);
        shopify.toast.show("Analysing prompt…");
        try {
            const res = await fetch("/app/ai/rule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: aiPrompt }) });
            const data = await res.json();
            if (data.error) { shopify.toast.show(data.error, { isError: true }); return; }
            const rule = data.rule;
            setActivePreset("custom_ai");
            setName(rule.description || "AI Rule");
            setTargetTag(rule.targetTag || "SmartTag");
            setRuleType("metric");
            const fm: Record<string, string> = { total_spent: "totalSpent", order_count: "orderCount", last_order_date: "lastOrderDate" };
            const om: Record<string, string> = { ">": "greaterThan", "<": "lessThan", "==": "equals", "CONTAINS": "contains" };
            if (rule.conditions?.[0]) {
                const c = rule.conditions[0];
                setField(fm[c.field] || "totalSpent");
                setOperator(om[c.operator] || "equals");
                setValue(c.value || "");
            }
            shopify.toast.show("Rule configured! ✨");
        } catch { shopify.toast.show("AI engine unreachable.", { isError: true }); }
        finally { setIsGenerating(false); }
    };

    const handleSubmit = () => {
        const fd = new FormData();
        fd.append("name", name); fd.append("ruleType", ruleType); fd.append("targetTag", targetTag);
        fd.append("field", field); fd.append("operator", operator); fd.append("value", value);
        fd.append("collectionId", collectionId); fd.append("collectionName", collectionName);
        fd.append("orderField", orderField); fd.append("orderOperator", orderOperator); fd.append("orderValue", orderValue);
        submit(fd, { method: "post" });
    };

    const customerPresets = PRESETS.filter(p => p.category === "customer");
    const orderPresets = PRESETS.filter(p => p.category === "order");

    const isLocked = (rt: string) => isFreePlan && (rt === "collection" || rt === "order");

    const ruleTypeOptions = [
        { label: "Customer Metrics", value: "metric" },
        { label: `Collection Purchase${isFreePlan ? " 🔒" : ""}`, value: "collection" },
        { label: `Order Properties${isFreePlan ? " 🔒" : ""}`, value: "order" },
    ];

    return (
        <Page
            title="Create Rule"
            backAction={{ content: "Rules", url: "/app/rules" }}
            subtitle="Set a condition, choose what tag to apply, and TagBot handles the rest."
        >
            <style>{`
                .preset-chip { cursor:pointer; border-radius:8px; border:1.5px solid var(--p-color-border); padding:12px 14px; transition:all .15s; background:#fff; }
                .preset-chip:hover { border-color:var(--p-color-border-magic); background:var(--p-color-bg-surface-magic-hover, #f3f0ff); transform:translateY(-1px); }
                .preset-chip.active { border-color:var(--p-color-border-magic); background:var(--p-color-bg-fill-magic-secondary, #ede9fe); }
            `}</style>

            <Layout>
                <Layout.Section>
                    {actionData?.error && (
                        <Box paddingBlockEnd="400">
                            <Banner tone="critical">{actionData.error}</Banner>
                        </Box>
                    )}

                    {/* ── Step 1: Quick Presets ──────────────────────────── */}
                    <Box paddingBlockEnd="400">
                        <Card>
                            <BlockStack gap="400">
                                <InlineStack align="space-between" blockAlign="center">
                                    <BlockStack gap="100">
                                        <Text variant="headingMd" as="h2">Quick Presets</Text>
                                        <Text as="p" tone="subdued" variant="bodySm">Click any template to auto-fill the rule — or build from scratch below.</Text>
                                    </BlockStack>
                                    <Button
                                        variant={showAI ? "secondary" : "plain"}
                                        icon={MagicIcon}
                                        onClick={() => setShowAI(!showAI)}
                                        tone="success"
                                    >
                                        AI Generator
                                    </Button>
                                </InlineStack>

                                {/* AI Generator (collapsible) */}
                                {showAI && (
                                    <Box padding="300" background="bg-surface-magic" borderRadius="200">
                                        <BlockStack gap="300">
                                            <InlineStack gap="200" blockAlign="center">
                                                <Icon source={MagicIcon} tone="magic" />
                                                <Text variant="headingSm" as="h3">Describe your rule in plain English</Text>
                                                <Badge tone="magic">Beta</Badge>
                                            </InlineStack>
                                            <TextField
                                                label="" labelHidden value={aiPrompt} onChange={setAiPrompt}
                                                multiline={2} autoComplete="off"
                                                placeholder="E.g. Tag customers who have spent more than $500 as VIP Gold"
                                            />
                                            <InlineStack align="end">
                                                <Button variant="primary" tone="success" onClick={handleAIGenerate} loading={isGenerating} disabled={!aiPrompt.trim()}>
                                                    ✨ Generate Rule
                                                </Button>
                                            </InlineStack>
                                        </BlockStack>
                                    </Box>
                                )}

                                <Divider />

                                {/* Customer presets */}
                                <BlockStack gap="200">
                                    <InlineStack gap="150" blockAlign="center">
                                        <Icon source={PersonIcon} tone="base" />
                                        <Text variant="headingSm" as="h3">Customer Behaviour</Text>
                                    </InlineStack>
                                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                                        {customerPresets.map(p => (
                                            <div key={p.key} className={`preset-chip${activePreset === p.key ? " active" : ""}`} style={{ minWidth: 130 }} onClick={() => applyPreset(p)}>
                                                <BlockStack gap="100">
                                                    <Icon source={p.icon} tone={activePreset === p.key ? "magic" : "subdued"} />
                                                    <Text variant="bodySm" fontWeight="semibold" as="span">{p.label}</Text>
                                                    <Text variant="bodySm" tone="subdued" as="span">{p.description}</Text>
                                                </BlockStack>
                                            </div>
                                        ))}
                                    </div>
                                </BlockStack>

                                {/* Order presets */}
                                <BlockStack gap="200">
                                    <InlineStack gap="150" blockAlign="center">
                                        <Icon source={OrderIcon} tone="magic" />
                                        <Text variant="headingSm" as="h3">Order Properties</Text>
                                        <Badge tone="magic">New</Badge>
                                        {isFreePlan && <Badge tone="warning">Growth+</Badge>}
                                    </InlineStack>
                                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                                        {orderPresets.map(p => (
                                            <div
                                                key={p.key}
                                                className={`preset-chip${activePreset === p.key ? " active" : ""}${isFreePlan ? " is-locked" : ""}`}
                                                style={{ minWidth: 130, opacity: isFreePlan ? 0.6 : 1, cursor: isFreePlan ? "not-allowed" : "pointer" }}
                                                onClick={() => isFreePlan ? navigate("/app/pricing") : applyPreset(p)}
                                            >
                                                <BlockStack gap="100">
                                                    <Icon source={p.icon} tone={activePreset === p.key ? "magic" : "subdued"} />
                                                    <Text variant="bodySm" fontWeight="semibold" as="span">{p.label}</Text>
                                                    <Text variant="bodySm" tone="subdued" as="span">{p.description}</Text>
                                                </BlockStack>
                                            </div>
                                        ))}
                                    </div>
                                </BlockStack>
                            </BlockStack>
                        </Card>
                    </Box>

                    {/* ── Step 2–4: Rule Builder ─────────────────────────── */}
                    <Card>
                        <BlockStack gap="500">

                            {/* Rule Name */}
                            <BlockStack gap="150">
                                <Text variant="headingMd" as="h2">
                                    <InlineStack gap="200" blockAlign="center">
                                        <Box as="span" background="bg-fill-magic" borderRadius="full" padding="025">
                                            <Text as="span" variant="headingSm" tone="magic">1</Text>
                                        </Box>
                                        Rule Name
                                    </InlineStack>
                                </Text>
                                <TextField
                                    label="Rule name" labelHidden
                                    value={name} onChange={setName} autoComplete="off"
                                    placeholder="e.g. Facebook Buyers from New York"
                                />
                            </BlockStack>

                            <Divider />

                            {/* Rule Type + Conditions */}
                            <BlockStack gap="300">
                                <Text variant="headingMd" as="h2">
                                    <InlineStack gap="200" blockAlign="center">
                                        <Box as="span" background="bg-fill-magic" borderRadius="full" padding="025">
                                            <Text as="span" variant="headingSm" tone="magic">2</Text>
                                        </Box>
                                        Trigger Condition
                                    </InlineStack>
                                </Text>

                                <Select
                                    label="Trigger type" labelHidden
                                    options={ruleTypeOptions}
                                    value={ruleType}
                                    onChange={(v) => { setRuleType(v as any); setActivePreset(null); }}
                                />

                                {/* METRIC */}
                                {ruleType === "metric" && (
                                    <FormLayout.Group>
                                        <Select
                                            label="Customer attribute"
                                            options={[
                                                { label: "Total Lifetime Spend ($)", value: "totalSpent" },
                                                { label: "Number of Orders", value: "orderCount" },
                                                { label: "Last Order Date", value: "lastOrderDate" },
                                            ]}
                                            value={field} onChange={setField}
                                        />
                                        <Select
                                            label="Operator"
                                            options={[
                                                { label: "Greater than (>)", value: "greaterThan" },
                                                { label: "Less than (<)", value: "lessThan" },
                                                { label: "Equals (=)", value: "equals" },
                                                { label: "Before date", value: "isBefore" },
                                                { label: "After date", value: "isAfter" },
                                            ]}
                                            value={operator} onChange={setOperator}
                                        />
                                        <TextField
                                            label={field === "lastOrderDate" ? "Date (YYYY-MM-DD)" : "Value"}
                                            value={value} onChange={setValue} autoComplete="off"
                                            type={field === "lastOrderDate" ? "text" : "number"}
                                            placeholder={field === "lastOrderDate" ? "2024-01-01" : "500"}
                                        />
                                    </FormLayout.Group>
                                )}

                                {/* COLLECTION */}
                                {ruleType === "collection" && isFreePlan && (
                                    <Banner tone="warning">
                                        Collection rules require a <strong>Growth</strong> plan or higher.{" "}
                                        <Button variant="plain" onClick={() => navigate("/app/pricing")}>Upgrade now →</Button>
                                    </Banner>
                                )}
                                {ruleType === "collection" && !isFreePlan && (
                                    <FormLayout.Group>
                                        <TextField label="Collection ID" value={collectionId} onChange={setCollectionId} autoComplete="off" helpText="Numeric ID from the Shopify collection URL." placeholder="4432104928" />
                                        <TextField label="Collection Name" value={collectionName} onChange={setCollectionName} autoComplete="off" placeholder="Summer 2024" />
                                    </FormLayout.Group>
                                )}

                                {/* ORDER PROPERTIES */}
                                {ruleType === "order" && isFreePlan && (
                                    <Banner tone="warning">
                                        Order-based rules require a <strong>Growth</strong> plan or higher.{" "}
                                        <Button variant="plain" onClick={() => navigate("/app/pricing")}>Upgrade now →</Button>
                                    </Banner>
                                )}
                                {ruleType === "order" && !isFreePlan && (
                                    <BlockStack gap="300">
                                        <FormLayout.Group>
                                            <Select label="Order field" options={ORDER_FIELDS} value={orderField} onChange={handleOrderFieldChange} />
                                            <Select label="Operator" options={getOps(orderField)} value={orderOperator} onChange={setOrderOperator} />
                                            <TextField
                                                label="Match value" value={orderValue} onChange={setOrderValue} autoComplete="off"
                                                placeholder={({
                                                    order_source: "facebook", payment_method: "paypal", shipping_city: "New York",
                                                    shipping_country: "US", order_item_count: "3", order_subtotal: "100",
                                                    discount_code_used: "true", discount_code_value: "SAVE15",
                                                    discount_percentage: "15", is_preorder: "true"
                                                }[orderField]) || "value"}
                                                helpText={getHint(orderField)}
                                            />
                                        </FormLayout.Group>
                                        {/* Preview */}
                                        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                            <InlineStack gap="200" blockAlign="center" wrap>
                                                <Text as="span" variant="bodySm" tone="subdued">When an order arrives where</Text>
                                                <Badge>{ORDER_FIELDS.find(f => f.value === orderField)?.label.split("(")[0].trim() || orderField}</Badge>
                                                <Badge tone="info">{orderOperator}</Badge>
                                                <Badge tone="success">{`"${orderValue || "…"}"`}</Badge>
                                                <Text as="span" variant="bodySm" tone="subdued">→ tag customer as</Text>
                                                <Badge tone="magic">{targetTag || "?"}</Badge>
                                            </InlineStack>
                                        </Box>
                                    </BlockStack>
                                )}
                            </BlockStack>

                            <Divider />

                            {/* Target Tag */}
                            <BlockStack gap="150">
                                <Text variant="headingMd" as="h2">
                                    <InlineStack gap="200" blockAlign="center">
                                        <Box as="span" background="bg-fill-magic" borderRadius="full" padding="025">
                                            <Text as="span" variant="headingSm" tone="magic">3</Text>
                                        </Box>
                                        Tag to Apply
                                    </InlineStack>
                                </Text>
                                <TextField
                                    label="Tag name" labelHidden
                                    value={targetTag} onChange={setTargetTag} autoComplete="off"
                                    placeholder="e.g. VIP, COD-Customer, Facebook-Buyer"
                                    helpText="This exact tag will be applied to the customer in Shopify."
                                    connectedRight={
                                        targetTag ? <Box padding="150"><Badge tone="info">{targetTag}</Badge></Box> : undefined
                                    }
                                />
                            </BlockStack>

                            <Divider />

                            {/* Save */}
                            <InlineStack align="end" gap="300">
                                <Button onClick={() => navigate("/app/rules")}>Cancel</Button>
                                <Button
                                    variant="primary" icon={CheckIcon}
                                    onClick={handleSubmit} loading={isSubmitting}
                                    disabled={isLocked(ruleType) || !name.trim() || !targetTag.trim()}
                                >
                                    Save Rule
                                </Button>
                            </InlineStack>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
