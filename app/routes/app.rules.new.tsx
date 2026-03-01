import { useState } from "react";
import { authenticate } from "../shopify.server";
import { getCachedStore } from "../services/cache.server";
import db from "../db.server";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useActionData, useNavigation, useNavigate, redirect } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
    Page, Layout, Card, FormLayout, TextField, Select, Button, Banner,
    BlockStack, Text, InlineStack, Box, Divider, Icon, Badge
} from "@shopify/polaris";
import {
    CashDollarIcon, PersonIcon, ClockIcon, SearchIcon, MagicIcon,
    CheckIcon, OrderIcon, LocationIcon, PaymentIcon, DiscountIcon
} from "@shopify/polaris-icons";

// ─── Loader / Action ─────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    if (!store) return { planName: "Free" };
    return { planName: store.planName || "Free" };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;
    const store = await getCachedStore(shop);
    if (!store) return { error: "Store not found" };

    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();

    const name = formData.get("name") as string;
    const ruleType = formData.get("ruleType") as string;
    const targetTag = formData.get("targetTag") as string;

    if (!name || !targetTag) return { error: "Name and Target Tag are required." };

    let conditions: any[] = [];
    let description = "";
    let collectionId: string | null = null;
    let collectionName: string | null = null;

    if (ruleType === "metric") {
        const field = formData.get("field") as string;
        const operator = formData.get("operator") as string;
        const value = formData.get("value") as string;
        if (!field || !operator || !value) return { error: "All metric condition fields are required." };
        const conditionValue = field !== "lastOrderDate" ? Number(value) : value;
        conditions = [{ field, operator, value: conditionValue }];
        description = `Customer ${field} ${operator} ${conditionValue}`;

    } else if (ruleType === "collection") {
        collectionId = formData.get("collectionId") as string;
        collectionName = formData.get("collectionName") as string;
        if (!collectionId || !collectionName) return { error: "Collection ID and Name are required." };
        description = `Purchases from collection: ${collectionName}`;

    } else if (ruleType === "order") {
        const orderField = formData.get("orderField") as string;
        const orderOperator = formData.get("orderOperator") as string;
        const orderValue = formData.get("orderValue") as string;
        if (!orderField || !orderOperator || !orderValue) return { error: "All order condition fields are required." };
        conditions = [{ field: orderField, operator: orderOperator, value: orderValue, ruleCategory: "order" }];
        description = `Order: ${orderField} ${orderOperator} "${orderValue}"`;

    } else {
        return { error: "Unknown rule type." };
    }

    await db.rule.create({
        data: {
            storeId: store.id,
            name,
            description,
            conditions: JSON.stringify(conditions),
            targetTag,
            collectionId,
            collectionName,
            isActive: true
        }
    });

    // Auto-sync customers with new rule (customer metric rules only)
    if (ruleType === "metric") {
        try {
            const isFree = store.planName === "Free" || store.planName === "";
            const fetchLimit = isFree ? 50 : 250;
            const response = await admin.graphql(`#graphql
                query getCustomers {
                    customers(first: ${fetchLimit}) {
                        edges {
                            node {
                                id email firstName lastName
                                amountSpent { amount }
                                numberOfOrders tags
                            }
                        }
                    }
                }
            `);
            const data = await response.json();
            const customersToSync = data.data?.customers?.edges || [];
            if (customersToSync.length > 0) {
                const { enqueueSyncJob } = await import("../services/queue.server");
                enqueueSyncJob({ shop, storeId: store.id, customersToSync });
            }
        } catch (e) {
            console.error("Failed to enqueue auto-sync on rule creation.", e);
        }
    }

    return redirect("/app");
};

// ─── Order Condition Config ───────────────────────────────────────────────────

const ORDER_FIELD_OPTIONS = [
    { label: "Traffic Source (Facebook, TikTok, Google…)", value: "order_source" },
    { label: "Payment Method (PayPal, COD, Stripe…)", value: "payment_method" },
    { label: "Shipping City", value: "shipping_city" },
    { label: "Shipping Country (ISO code: US, UK, BD…)", value: "shipping_country" },
    { label: "Total Item Quantity in Order", value: "order_item_count" },
    { label: "Order Subtotal ($)", value: "order_subtotal" },
    { label: "Discount Code Used? (true / false)", value: "discount_code_used" },
    { label: "Specific Discount Code Value", value: "discount_code_value" },
    { label: "Discount Percentage Applied (%)", value: "discount_percentage" },
    { label: "Pre-Order Customer (true / false)", value: "is_preorder" },
];

const getOperatorsFor = (field: string) => {
    if (["order_item_count", "order_subtotal", "discount_percentage"].includes(field)) {
        return [
            { label: "Greater Than (>)", value: "greaterThan" },
            { label: "Less Than (<)", value: "lessThan" },
            { label: "Equals (=)", value: "equals" },
        ];
    }
    if (["discount_code_used", "is_preorder"].includes(field)) {
        return [{ label: "Equals (=)", value: "equals" }];
    }
    return [
        { label: "Contains", value: "contains" },
        { label: "Equals (exact)", value: "equals" },
        { label: "Not Equals", value: "notEquals" },
    ];
};

const getPlaceholderFor = (field: string) => {
    const map: Record<string, string> = {
        order_source: "facebook  (or: tiktok, instagram, google)",
        payment_method: "paypal  (or: cash_on_delivery, stripe)",
        shipping_city: "New York",
        shipping_country: "US  (or: UK, BD, AU)",
        order_item_count: "3",
        order_subtotal: "100",
        discount_code_used: "true  (or: false)",
        discount_code_value: "SAVE15  (partial match supported)",
        discount_percentage: "15",
        is_preorder: "true  (or: false)",
    };
    return map[field] || "value";
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function NewRule() {
    const { planName } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const navigate = useNavigate();
    const shopify = useAppBridge();
    const isSubmitting = navigation.state === "submitting";
    const isFreePlan = planName === "Free" || planName === "";

    // Common
    const [name, setName] = useState("");
    const [ruleType, setRuleType] = useState("metric");
    const [targetTag, setTargetTag] = useState("");
    const [activePreset, setActivePreset] = useState<string | null>(null);

    // Customer metric fields
    const [field, setField] = useState("totalSpent");
    const [operator, setOperator] = useState("greaterThan");
    const [value, setValue] = useState("");

    // Collection fields
    const [collectionId, setCollectionId] = useState("");
    const [collectionName, setCollectionName] = useState("");

    // Order fields
    const [orderField, setOrderField] = useState("order_source");
    const [orderOperator, setOrderOperator] = useState("contains");
    const [orderValue, setOrderValue] = useState("");

    // AI State
    const [aiPrompt, setAiPrompt] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);

    // ── field change resets operator ──────────────────────────────────────────
    const handleOrderFieldChange = (v: string) => {
        setOrderField(v);
        setOrderOperator(getOperatorsFor(v)[0].value);
        setOrderValue("");
    };

    // ── AI Generator ──────────────────────────────────────────────────────────
    const handleAIGenerate = async () => {
        if (!aiPrompt) return;
        setIsGenerating(true);
        setActivePreset("custom_ai");
        shopify.toast.show("Analyzing prompt...");
        try {
            const response = await fetch("/app/ai/rule", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: aiPrompt })
            });
            const data = await response.json();
            if (data.error) { shopify.toast.show(data.error, { isError: true }); return; }
            const rule = data.rule;
            setName(rule.description || "AI Generated Rule");
            setTargetTag(rule.targetTag || "SmartTag");
            if (rule.conditions?.length > 0) {
                const c = rule.conditions[0];
                const fieldMap: Record<string, string> = {
                    total_spent: "totalSpent", order_count: "orderCount",
                    last_order_date: "lastOrderDate", email_domain: "emailDomain"
                };
                const opMap: Record<string, string> = {
                    ">": "greaterThan", "<": "lessThan", "==": "equals", "CONTAINS": "contains"
                };
                setRuleType("metric");
                setField(fieldMap[c.field] || "totalSpent");
                setOperator(opMap[c.operator] || "equals");
                setValue(c.value || "");
            }
            shopify.toast.show("Rule configured magically! ✨");
        } catch {
            shopify.toast.show("Failed to connect to AI engine.", { isError: true });
        } finally {
            setIsGenerating(false);
        }
    };

    // ── Submit ────────────────────────────────────────────────────────────────
    const handleSubmit = () => {
        const fd = new FormData();
        fd.append("name", name);
        fd.append("ruleType", ruleType);
        fd.append("targetTag", targetTag);
        fd.append("field", field);
        fd.append("operator", operator);
        fd.append("value", value);
        fd.append("collectionId", collectionId);
        fd.append("collectionName", collectionName);
        fd.append("orderField", orderField);
        fd.append("orderOperator", orderOperator);
        fd.append("orderValue", orderValue);
        submit(fd, { method: "post" });
    };

    // ── Customer Presets ──────────────────────────────────────────────────────
    const applyCustomerPreset = (preset: string) => {
        setActivePreset(preset);
        setRuleType("metric");
        if (preset === "big_spender") {
            setName("Big Spenders"); setField("totalSpent"); setOperator("greaterThan"); setValue("1000"); setTargetTag("VIP");
        } else if (preset === "loyalist") {
            setName("Loyalists"); setField("orderCount"); setOperator("greaterThan"); setValue("5"); setTargetTag("Loyal");
        } else if (preset === "window_shopper") {
            setName("Window Shoppers"); setField("orderCount"); setOperator("equals"); setValue("0"); setTargetTag("Prospect");
        } else if (preset === "at_risk") {
            setName("At Risk VIPs"); setField("lastOrderDate"); setOperator("isBefore");
            const d = new Date(); d.setDate(d.getDate() - 90);
            setValue(d.toISOString().split("T")[0]); setTargetTag("AtRisk");
        }
    };

    // ── Order Presets ─────────────────────────────────────────────────────────
    const applyOrderPreset = (preset: string) => {
        setActivePreset(preset);
        setRuleType("order");
        if (preset === "facebook_buyer") {
            setName("Facebook Buyer"); setOrderField("order_source"); setOrderOperator("contains"); setOrderValue("facebook"); setTargetTag("Social-Buyer-FB");
        } else if (preset === "tiktok_buyer") {
            setName("TikTok Buyer"); setOrderField("order_source"); setOrderOperator("contains"); setOrderValue("tiktok"); setTargetTag("Social-Buyer-TT");
        } else if (preset === "cod_customer") {
            setName("Cash on Delivery"); setOrderField("payment_method"); setOrderOperator("contains"); setOrderValue("cash_on_delivery"); setTargetTag("COD-Customer");
        } else if (preset === "paypal_buyer") {
            setName("PayPal Buyer"); setOrderField("payment_method"); setOrderOperator("equals"); setOrderValue("paypal"); setTargetTag("PayPal-Customer");
        } else if (preset === "bulk_buyer") {
            setName("Bulk Buyer"); setOrderField("order_item_count"); setOrderOperator("greaterThan"); setOrderValue("3"); setTargetTag("Bulk-Buyer");
        } else if (preset === "discount_hunter") {
            setName("Discount Hunter"); setOrderField("discount_code_used"); setOrderOperator("equals"); setOrderValue("true"); setTargetTag("Discount-User");
        } else if (preset === "preorder_customer") {
            setName("Pre-Order Customer"); setOrderField("is_preorder"); setOrderOperator("equals"); setOrderValue("true"); setTargetTag("Pre-Order-Customer");
        } else if (preset === "high_discount") {
            setName("Heavy Discount Buyer"); setOrderField("discount_percentage"); setOrderOperator("greaterThan"); setOrderValue("15"); setTargetTag("Heavy-Discount-User");
        }
    };

    return (
        <Page
            title="Create Automation Rule"
            backAction={{ content: "Back to Rules", url: "/app/rules" }}
            subtitle="Define when to automatically tag customers based on their profile or order behavior."
        >
            <style>{`
                .preset-card-wrapper { transition: all 0.2s ease-in-out; border-radius: 8px; }
                .preset-card-wrapper:hover { transform: translateY(-3px); box-shadow: 0 8px 16px rgba(0,0,0,0.08); }
                .preset-card-wrapper:active { transform: translateY(1px); }
            `}</style>

            <Layout>
                <Layout.Section>
                    {actionData?.error && <Banner tone="critical" title={actionData.error} />}

                    {/* ── Customer Presets ─────────────────────────────────── */}
                    <Box paddingBlockEnd="400">
                        <Card>
                            <BlockStack gap="400">
                                <InlineStack align="start" gap="200" blockAlign="center">
                                    <Icon source={PersonIcon} tone="base" />
                                    <Text variant="headingMd" as="h3">Customer Behaviour Presets</Text>
                                </InlineStack>
                                <Text as="p" tone="subdued">One-click templates based on lifetime customer metrics.</Text>
                                <InlineStack gap="300" wrap>
                                    {[
                                        { key: "big_spender", icon: CashDollarIcon, label: "Big Spenders", sub: "Spent > $1,000" },
                                        { key: "loyalist", icon: PersonIcon, label: "Loyalists", sub: "Orders > 5" },
                                        { key: "window_shopper", icon: SearchIcon, label: "Window Shoppers", sub: "Orders = 0" },
                                        { key: "at_risk", icon: ClockIcon, label: "At Risk", sub: "No orders 90d" },
                                    ].map(p => (
                                        <div key={p.key} className="preset-card-wrapper" style={{ flex: "1 1 180px", cursor: "pointer" }} onClick={() => applyCustomerPreset(p.key)}>
                                            <Box padding="300" background={activePreset === p.key ? "bg-surface-magic" : "bg-surface"} borderRadius="200" borderWidth="025" borderColor={activePreset === p.key ? "border-magic" : "border"}>
                                                <BlockStack gap="200">
                                                    <Icon source={p.icon} tone={activePreset === p.key ? "magic" : "base"} />
                                                    <Text variant="headingSm" as="h6">{p.label}</Text>
                                                    <Text as="p" variant="bodySm" tone="subdued">{p.sub}</Text>
                                                </BlockStack>
                                            </Box>
                                        </div>
                                    ))}
                                </InlineStack>
                            </BlockStack>
                        </Card>
                    </Box>

                    {/* ── Order Presets ─────────────────────────────────────── */}
                    <Box paddingBlockEnd="400">
                        <Card>
                            <BlockStack gap="400">
                                <InlineStack align="start" gap="200" blockAlign="center">
                                    <Icon source={OrderIcon} tone="magic" />
                                    <Text variant="headingMd" as="h3">Order-Based Presets</Text>
                                    <Badge tone="magic">New</Badge>
                                </InlineStack>
                                <Text as="p" tone="subdued">Tag customers based on how, where, and what they ordered.</Text>
                                <InlineStack gap="300" wrap>
                                    {[
                                        { key: "facebook_buyer", icon: OrderIcon, label: "Facebook Buyer", sub: "Source: facebook" },
                                        { key: "tiktok_buyer", icon: OrderIcon, label: "TikTok Buyer", sub: "Source: tiktok" },
                                        { key: "cod_customer", icon: PaymentIcon, label: "COD Customer", sub: "Payment: cash_on_delivery" },
                                        { key: "paypal_buyer", icon: PaymentIcon, label: "PayPal Buyer", sub: "Payment: paypal" },
                                        { key: "bulk_buyer", icon: OrderIcon, label: "Bulk Buyer", sub: "Items > 3" },
                                        { key: "discount_hunter", icon: DiscountIcon, label: "Discount Hunter", sub: "Used a discount code" },
                                        { key: "high_discount", icon: DiscountIcon, label: "Heavy Discount", sub: "Discount > 15%" },
                                        { key: "preorder_customer", icon: ClockIcon, label: "Pre-Order Customer", sub: "Pre-order product" },
                                    ].map(p => (
                                        <div key={p.key} className="preset-card-wrapper" style={{ flex: "1 1 160px", cursor: "pointer" }} onClick={() => applyOrderPreset(p.key)}>
                                            <Box padding="300" background={activePreset === p.key ? "bg-surface-magic" : "bg-surface"} borderRadius="200" borderWidth="025" borderColor={activePreset === p.key ? "border-magic" : "border"}>
                                                <BlockStack gap="200">
                                                    <Icon source={p.icon} tone={activePreset === p.key ? "magic" : "base"} />
                                                    <Text variant="headingSm" as="h6">{p.label}</Text>
                                                    <Text as="p" variant="bodySm" tone="subdued">{p.sub}</Text>
                                                </BlockStack>
                                            </Box>
                                        </div>
                                    ))}
                                </InlineStack>
                            </BlockStack>
                        </Card>
                    </Box>

                    {/* ── AI Smart Constructor ──────────────────────────────── */}
                    <Box paddingBlockEnd="400">
                        <Card background={activePreset === "custom_ai" ? "bg-surface-magic" : "bg-surface"}>
                            <BlockStack gap="400">
                                <InlineStack align="start" gap="200" blockAlign="center">
                                    <Icon source={MagicIcon} tone="magic" />
                                    <Text variant="headingMd" as="h3">AI Smart Constructor</Text>
                                    <Badge tone="magic">Beta</Badge>
                                </InlineStack>
                                <Text as="p" tone="subdued">Describe what kind of customers you want to tag and the AI will build the rule for you.</Text>
                                <BlockStack gap="200">
                                    <TextField
                                        label="Magic Prompt" labelHidden value={aiPrompt} onChange={setAiPrompt}
                                        multiline={3} autoComplete="off"
                                        placeholder="E.g. Tag customers who have spent more than $500 total as 'High-Value VIP'"
                                    />
                                    <InlineStack align="end">
                                        <Button variant="primary" onClick={handleAIGenerate} loading={isGenerating} disabled={!aiPrompt.trim()} tone="success">
                                            ✨ Generate with AI
                                        </Button>
                                    </InlineStack>
                                </BlockStack>
                            </BlockStack>
                        </Card>
                    </Box>

                    {/* ── Manual Rule Builder ───────────────────────────────── */}
                    <Card>
                        <BlockStack gap="500">
                            <BlockStack gap="200">
                                <Text variant="headingMd" as="h3">Rule Identification</Text>
                                <TextField
                                    label="Rule Name" value={name} onChange={setName} autoComplete="off"
                                    placeholder="e.g., Facebook Social Buyers" helpText="Used internally to identify this automation."
                                />
                            </BlockStack>

                            <Divider />

                            <BlockStack gap="300">
                                <Text variant="headingMd" as="h3">Trigger Conditions</Text>
                                <Text as="p" tone="subdued">Choose when a customer qualifies for this tag.</Text>

                                <Select
                                    label="Rule Trigger Type"
                                    options={[
                                        { label: "Customer Metric (Lifetime Spend, Order Count, Date)", value: "metric" },
                                        { label: isFreePlan ? "Specific Collection Purchase (Growth+)" : "Specific Collection Purchase", value: "collection" },
                                        { label: isFreePlan ? "Order Properties (Source, Payment, Location…) (Growth+)" : "Order Properties (Source, Payment, Location, Discount…)", value: "order" },
                                    ]}
                                    value={ruleType}
                                    onChange={(v) => { setRuleType(v); setActivePreset(null); }}
                                />

                                {/* ── METRIC ── */}
                                {ruleType === "metric" && (
                                    <FormLayout.Group>
                                        <Select
                                            label="Customer Attribute"
                                            options={[
                                                { label: "Total Spent ($)", value: "totalSpent" },
                                                { label: "Total Order Count", value: "orderCount" },
                                                { label: "Date of Last Order", value: "lastOrderDate" },
                                            ]}
                                            value={field} onChange={setField}
                                        />
                                        <Select
                                            label="Operator"
                                            options={[
                                                { label: "Greater Than (>)", value: "greaterThan" },
                                                { label: "Less Than (<)", value: "lessThan" },
                                                { label: "Equals (=)", value: "equals" },
                                                { label: "Is Before Date", value: "isBefore" },
                                                { label: "Is After Date", value: "isAfter" },
                                            ]}
                                            value={operator} onChange={setOperator}
                                        />
                                        <TextField
                                            label={field === "lastOrderDate" ? "Cutoff Date (YYYY-MM-DD)" : "Threshold Value"}
                                            value={value} onChange={setValue} autoComplete="off"
                                            type={field === "lastOrderDate" ? "text" : "number"}
                                            placeholder={field === "lastOrderDate" ? "2023-01-01" : "1000"}
                                        />
                                    </FormLayout.Group>
                                )}

                                {/* ── COLLECTION ── */}
                                {ruleType === "collection" && isFreePlan && (
                                    <Banner tone="warning" title="Upgrade Required">
                                        <Text as="p">Collection-specific tagging is available on Growth plan and above.</Text>
                                        <Box paddingBlockStart="200">
                                            <Button onClick={() => navigate("/app/pricing")}>View Plans</Button>
                                        </Box>
                                    </Banner>
                                )}
                                {ruleType === "collection" && !isFreePlan && (
                                    <FormLayout.Group>
                                        <TextField
                                            label="Shopify Collection ID"
                                            value={collectionId} onChange={setCollectionId} autoComplete="off"
                                            helpText="Numeric ID from the Shopify Admin Collection URL."
                                            placeholder="4432104928"
                                        />
                                        <TextField
                                            label="Collection Display Name"
                                            value={collectionName} onChange={setCollectionName} autoComplete="off"
                                            placeholder="Summer 2024 Inventory"
                                        />
                                    </FormLayout.Group>
                                )}

                                {/* ── ORDER PROPERTIES ── */}
                                {ruleType === "order" && isFreePlan && (
                                    <Banner tone="warning" title="Upgrade Required">
                                        <Text as="p">Order-based tagging is available on Growth plan and above.</Text>
                                        <Box paddingBlockStart="200">
                                            <Button onClick={() => navigate("/app/pricing")}>View Plans</Button>
                                        </Box>
                                    </Banner>
                                )}
                                {ruleType === "order" && !isFreePlan && (
                                    <BlockStack gap="300">
                                        <FormLayout.Group>
                                            <Select
                                                label="Order Property"
                                                options={ORDER_FIELD_OPTIONS}
                                                value={orderField}
                                                onChange={handleOrderFieldChange}
                                            />
                                            <Select
                                                label="Operator"
                                                options={getOperatorsFor(orderField)}
                                                value={orderOperator}
                                                onChange={setOrderOperator}
                                            />
                                            <TextField
                                                label="Match Value"
                                                value={orderValue} onChange={setOrderValue} autoComplete="off"
                                                placeholder={getPlaceholderFor(orderField)}
                                                helpText={
                                                    orderField === "order_source"
                                                        ? "Checks referring_site and source_name. Use lowercase: facebook, google, tiktok."
                                                        : orderField === "payment_method"
                                                            ? "Shopify gateway name lowercase: paypal, cash_on_delivery, stripe, bogus."
                                                            : orderField === "shipping_country"
                                                                ? "2-letter ISO code: US, UK, BD, AU, CA."
                                                                : undefined
                                                }
                                            />
                                        </FormLayout.Group>
                                        {/* Live preview box */}
                                        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                            <InlineStack gap="200" wrap>
                                                <Text as="span" variant="bodySm" tone="subdued">When an order arrives where</Text>
                                                <Badge>{ORDER_FIELD_OPTIONS.find(o => o.value === orderField)?.label.split("(")[0].trim() ?? orderField}</Badge>
                                                <Badge tone="info">{orderOperator}</Badge>
                                                <Badge tone="success">{orderValue || "…"}</Badge>
                                                <Text as="span" variant="bodySm" tone="subdued">→ apply tag</Text>
                                                <Badge tone="magic">{targetTag || "?"}</Badge>
                                            </InlineStack>
                                        </Box>
                                    </BlockStack>
                                )}
                            </BlockStack>

                            <Divider />

                            {/* ── Action / Target Tag ───────────────────────── */}
                            <BlockStack gap="200">
                                <InlineStack gap="200" blockAlign="center">
                                    <Text variant="headingMd" as="h3">Action</Text>
                                    {ruleType === "order" && <Badge tone="info">Applied on next qualifying order</Badge>}
                                </InlineStack>
                                <TextField
                                    label="Shopify Tag to Apply"
                                    value={targetTag} onChange={setTargetTag} autoComplete="off"
                                    placeholder="e.g., Facebook-Buyer"
                                    helpText="This exact tag will be added to the customer in Shopify when the rule matches."
                                />
                                {targetTag && (
                                    <InlineStack gap="200" align="start" blockAlign="center">
                                        <Text as="p" variant="bodySm" tone="subdued">Tag preview:</Text>
                                        <Badge tone="info">{targetTag}</Badge>
                                    </InlineStack>
                                )}
                            </BlockStack>

                            <Box paddingBlockStart="200">
                                <Button
                                    size="large" variant="primary" icon={CheckIcon}
                                    onClick={handleSubmit} loading={isSubmitting}
                                    disabled={(ruleType === "collection" || ruleType === "order") && isFreePlan}
                                    fullWidth
                                >
                                    Launch Smart Automation
                                </Button>
                            </Box>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}

// Re-export field config for guide/docs
export { ORDER_FIELD_OPTIONS };
