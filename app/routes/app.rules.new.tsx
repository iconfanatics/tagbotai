import { useState, useMemo, useEffect } from "react";
import { authenticate } from "../shopify.server";
import { getCachedStore } from "../services/cache.server";
import db from "../db.server";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useActionData, useNavigation, useNavigate, useFetcher, redirect } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
    Page, Layout, Card, FormLayout, TextField, Select, Button, Banner,
    BlockStack, Text, InlineStack, Box, Icon, Badge, Modal, Spinner
} from "@shopify/polaris";
import {
    CashDollarIcon, PersonIcon, ClockIcon, SearchIcon, MagicIcon,
    OrderIcon, PaymentIcon, DiscountIcon, EditIcon, PlusIcon, LocationIcon
} from "@shopify/polaris-icons";

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    return { planName: store?.planName || "Free" };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const store = await getCachedStore(session.shop);
    if (!store) return { error: "Store not found" };

    const fd = await request.formData();
    const actionType = fd.get("actionType") as string;

    // ── AI Generation ────────────────────────────────────────────
    if (actionType === "generate_ai_rule") {
        const prompt = fd.get("prompt") as string;
        if (!prompt?.trim()) return { aiError: "Please describe your rule." };
        try {
            const { generateRuleConditions } = await import("../services/ai.server");
            const generated = await generateRuleConditions(prompt);
            if (!generated) return { aiError: "AI could not generate a rule. Try rephrasing." };
            return { aiGenerated: generated };
        } catch (e: any) {
            return { aiError: e.message || "AI generation failed." };
        }
    }

    // ── Save Rule ────────────────────────────────────────────────
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

    // Fire-and-forget: do NOT await this — redirect immediately
    if (ruleType === "metric") {
        Promise.resolve().then(async () => {
            try {
                const isFree = store.planName === "Free" || store.planName === "";
                const { fetchAllCustomers } = await import("../services/shopify-helpers.server");
                const customersToSync = await fetchAllCustomers(admin, isFree);
                if (customersToSync.length > 0) {
                    const { enqueueSyncJob } = await import("../services/queue.server");
                    enqueueSyncJob({ shop: session.shop, storeId: store.id, customersToSync });
                }
            } catch (e) { console.error("Auto-sync failed:", e); }
        });
    }

    return redirect("/app/rules");
};

// ─── Types ────────────────────────────────────────────────────────────────────

type Category = "all" | "customer" | "order" | "payment" | "location" | "discount";

type Template = {
    key: string;
    label: string;
    description: string;
    longDescription: string;
    icon: any;
    category: Category;
    popular?: boolean;
    planRequired?: "growth" | "pro";
    ruleType: string;
    field?: string;
    operator?: string;
    value?: string;
    orderField?: string;
    orderOperator?: string;
    orderValue?: string;
    tag: string;
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
    return [{ label: "Contains", value: "contains" }, { label: "Exactly equals", value: "equals" }];
};

const getHint = (field: string) => ({
    order_source: "Use lowercase. E.g.: facebook, tiktok, instagram, google",
    payment_method: "Shopify gateway name. E.g.: paypal, cash_on_delivery, stripe",
    shipping_country: "2-letter ISO code. E.g.: US, UK, BD, AU, CA",
    discount_code_used: "Enter: true — to match orders WITH a code, false — without",
    is_preorder: "Enter: true — to match pre-order orders",
    discount_code_value: "Partial match supported. E.g.: SAVE15 or SUMMER",
} as any)[field] || "";

// ─── Templates ────────────────────────────────────────────────────────────────

const TEMPLATES: Template[] = [
    // Customer
    {
        key: "big_spender", label: "High-value Customers", popular: true,
        category: "customer", icon: CashDollarIcon,
        description: "Total spent ≥ $1,000",
        longDescription: "When customer has total spent greater than or equal to $1,000, automatically add tag Gold-VIP to customer.",
        ruleType: "metric", field: "totalSpent", operator: "greaterThan", value: "1000", tag: "Gold-VIP",
    },
    {
        key: "medium_spend", label: "Medium Spend Customers", popular: true,
        category: "customer", icon: CashDollarIcon,
        description: "Total spent $200–$999",
        longDescription: "When customer has total spent greater than or equal to $200 and less than $1,000, automatically add tag Silver-VIP to customer.",
        ruleType: "metric", field: "totalSpent", operator: "greaterThan", value: "200", tag: "Silver-VIP",
    },
    {
        key: "loyalist", label: "Loyal Customers", popular: true,
        category: "customer", icon: PersonIcon,
        description: "Customer has 5+ orders",
        longDescription: "When customer has orders number greater than or equal to 5, automatically add tag Loyal-Customer to customer.",
        ruleType: "metric", field: "orderCount", operator: "greaterThan", value: "5", tag: "Loyal-Customer",
    },
    {
        key: "window_shopper", label: "Window Shoppers",
        category: "customer", icon: SearchIcon,
        description: "Registered but never ordered",
        longDescription: "When customer has 0 orders placed, automatically add tag Prospect to customer.",
        ruleType: "metric", field: "orderCount", operator: "equals", value: "0", tag: "Prospect",
    },
    {
        key: "at_risk", label: "At-Risk Customers", popular: true,
        category: "customer", icon: ClockIcon,
        description: "No purchase in last 90 days",
        longDescription: "When customer's last order was more than 90 days ago, automatically add tag At-Risk to customer.",
        ruleType: "metric", field: "lastOrderDate", operator: "isBefore", value: "", tag: "At-Risk",
    },
    // Order — Traffic Source
    {
        key: "facebook_buyer", label: "Facebook Campaign Orders", popular: true,
        category: "order", icon: OrderIcon,
        description: "Traffic source contains Facebook",
        longDescription: "When orders are created and traffic source contains facebook, automatically add tag Facebook to customer.",
        ruleType: "order", orderField: "order_source", orderOperator: "contains", orderValue: "facebook", tag: "Social-FB",
    },
    {
        key: "tiktok_buyer", label: "TikTok Campaign Orders",
        category: "order", icon: OrderIcon,
        description: "Traffic source contains TikTok",
        longDescription: "When orders are created and traffic source contains tiktok, automatically add tag TikTok to customer.",
        ruleType: "order", orderField: "order_source", orderOperator: "contains", orderValue: "tiktok", tag: "Social-TT",
    },
    {
        key: "instagram_buyer", label: "Instagram Campaign Orders",
        category: "order", icon: OrderIcon,
        description: "Traffic source contains Instagram",
        longDescription: "When orders are created and traffic source contains instagram, automatically add tag Instagram to customer.",
        ruleType: "order", orderField: "order_source", orderOperator: "contains", orderValue: "instagram", tag: "Social-IG",
    },
    {
        key: "google_buyer", label: "Google Ads Orders",
        category: "order", icon: OrderIcon,
        description: "Traffic source contains Google",
        longDescription: "When orders are created and traffic source contains google, automatically add tag Google-Ads to customer.",
        ruleType: "order", orderField: "order_source", orderOperator: "contains", orderValue: "google", tag: "Google-Ads",
    },
    // Payment
    {
        key: "cod_customer", label: "COD Customers", popular: true,
        category: "payment", icon: PaymentIcon,
        description: "Paid with Cash on Delivery",
        longDescription: "When order payment method contains cash_on_delivery, automatically add tag COD-Customer to customer.",
        ruleType: "order", orderField: "payment_method", orderOperator: "contains", orderValue: "cash_on_delivery", tag: "COD-Customer",
    },
    {
        key: "paypal_buyer", label: "PayPal Customers",
        category: "payment", icon: PaymentIcon,
        description: "Paid via PayPal",
        longDescription: "When order payment method contains paypal, automatically add tag PayPal-Customer to customer.",
        ruleType: "order", orderField: "payment_method", orderOperator: "contains", orderValue: "paypal", tag: "PayPal-Customer",
    },
    {
        key: "stripe_buyer", label: "Stripe Customers",
        category: "payment", icon: PaymentIcon,
        description: "Paid via Stripe",
        longDescription: "When order payment method contains stripe, automatically add tag Stripe-Customer to customer.",
        ruleType: "order", orderField: "payment_method", orderOperator: "contains", orderValue: "stripe", tag: "Stripe-Customer",
    },
    // Location
    {
        key: "local_buyer", label: "Local City Buyers",
        category: "location", icon: LocationIcon,
        description: "Ships to a specific city",
        longDescription: "When order shipping city matches a specific value, automatically add tag Local-Customer to customer.",
        ruleType: "order", orderField: "shipping_city", orderOperator: "contains", orderValue: "", tag: "Local-Customer",
    },
    {
        key: "country_buyer", label: "Country-Specific Buyers",
        category: "location", icon: LocationIcon,
        description: "Ships to a specific country",
        longDescription: "When order shipping country equals a specific 2-letter code, automatically add tag [Country]-Customer to customer.",
        ruleType: "order", orderField: "shipping_country", orderOperator: "equals", orderValue: "", tag: "Country-Customer",
    },
    // Discount
    {
        key: "discount_user", label: "Discount Hunters", popular: true,
        category: "discount", icon: DiscountIcon,
        description: "Used any discount code",
        longDescription: "When orders are created with any discount code, automatically add tag Discount-User to customer.",
        ruleType: "order", orderField: "discount_code_used", orderOperator: "equals", orderValue: "true", tag: "Discount-User",
    },
    {
        key: "heavy_discount", label: "Heavy Discount Buyers",
        category: "discount", icon: DiscountIcon,
        description: "Discount applied was > 15%",
        longDescription: "When order discount percentage is greater than 15%, automatically add tag Heavy-Discounter to customer.",
        ruleType: "order", orderField: "discount_percentage", orderOperator: "greaterThan", orderValue: "15", tag: "Heavy-Discounter",
    },
    {
        key: "bulk_buyer", label: "Bulk Buyers",
        category: "order", icon: OrderIcon,
        description: "Ordered 3+ items in one order",
        longDescription: "When an order has more than 3 items, automatically add tag Bulk-Buyer to customer.",
        ruleType: "order", orderField: "order_item_count", orderOperator: "greaterThan", orderValue: "3", tag: "Bulk-Buyer",
    },
    {
        key: "preorder", label: "Pre-Order Customers",
        category: "order", icon: ClockIcon,
        description: "Bought a pre-order item",
        longDescription: "When one of the order items is a pre-order, automatically add tag Pre-Order to customer.",
        ruleType: "order", orderField: "is_preorder", orderOperator: "equals", orderValue: "true", tag: "Pre-Order",
    },
];

const CATEGORIES: { label: string; value: Category }[] = [
    { label: "All", value: "all" },
    { label: "Customer", value: "customer" },
    { label: "Order", value: "order" },
    { label: "Payment", value: "payment" },
    { label: "Location", value: "location" },
    { label: "Discount", value: "discount" },
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

    // AI Fetcher
    const aiFetcher = useFetcher<typeof action>();
    const isGenerating = aiFetcher.state !== "idle";
    const [aiPrompt, setAiPrompt] = useState("");

    // Gallery state
    const [search, setSearch] = useState("");
    const [activeCategory, setActiveCategory] = useState<Category>("all");
    const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Form state
    const [name, setName] = useState("");
    const [ruleType, setRuleType] = useState("metric");
    const [field, setField] = useState("totalSpent");
    const [operator, setOperator] = useState("greaterThan");
    const [value, setValue] = useState("");
    const [orderField, setOrderField] = useState("order_source");
    const [orderOperator, setOrderOperator] = useState("contains");
    const [orderValue, setOrderValue] = useState("");
    const [targetTag, setTargetTag] = useState("");

    // Auto-populate form when AI returns a result
    useEffect(() => {
        const gen = (aiFetcher.data as any)?.aiGenerated;
        if (!gen) return;
        setSelectedTemplate(null);
        setName(gen.name || aiPrompt);
        setTargetTag(gen.targetTag || "");
        if (gen.ruleType === "order") {
            setRuleType("order");
            const cond = gen.conditions?.[0];
            if (cond) { setOrderField(cond.field || "order_source"); setOrderOperator(cond.operator || "contains"); setOrderValue(String(cond.value || "")); }
        } else {
            setRuleType("metric");
            const cond = gen.conditions?.[0];
            if (cond) { setField(cond.field || "totalSpent"); setOperator(cond.operator || "greaterThan"); setValue(String(cond.value || "")); }
        }
        setIsModalOpen(true);
    }, [aiFetcher.data]);

    const handleAiGenerate = () => {
        if (!aiPrompt.trim()) return;
        aiFetcher.submit({ actionType: "generate_ai_rule", prompt: aiPrompt }, { method: "post" });
    };

    // Filtered templates
    const filtered = useMemo(() => {
        return TEMPLATES.filter(t => {
            const matchCat = activeCategory === "all" || t.category === activeCategory;
            const matchSearch = !search || t.label.toLowerCase().includes(search.toLowerCase()) || t.description.toLowerCase().includes(search.toLowerCase());
            return matchCat && matchSearch;
        });
    }, [search, activeCategory]);

    const applyTemplate = (t: Template) => {
        setSelectedTemplate(t);
        setName(t.label);
        setRuleType(t.ruleType);
        setTargetTag(t.tag);
        if (t.ruleType === "metric") {
            setField(t.field || "totalSpent");
            setOperator(t.operator || "greaterThan");
            setValue(t.value || "");
        } else if (t.ruleType === "order") {
            setOrderField(t.orderField || "order_source");
            setOrderOperator(t.orderOperator || "contains");
            setOrderValue(t.orderValue || "");
        }
        setIsModalOpen(true);
    };

    const openBlank = () => {
        setSelectedTemplate(null);
        setName(""); setTargetTag(""); setRuleType("metric");
        setField("totalSpent"); setOperator("greaterThan"); setValue("");
        setOrderField("order_source"); setOrderOperator("contains"); setOrderValue("");
        setIsModalOpen(true);
    };

    const handleSubmit = () => {
        const fd: Record<string, string> = { name, ruleType, targetTag };
        if (ruleType === "metric") Object.assign(fd, { field, operator, value });
        else if (ruleType === "order") Object.assign(fd, { orderField, orderOperator, orderValue });
        submit(fd, { method: "post" });
    };

    const metricFieldOptions = [
        { label: "Total Spent ($)", value: "totalSpent" },
        { label: "Number of Orders", value: "orderCount" },
        { label: "Last Order Date", value: "lastOrderDate" },
    ];
    const metricOperatorOptions = field === "lastOrderDate"
        ? [{ label: "Before", value: "isBefore" }, { label: "After", value: "isAfter" }]
        : [{ label: "Greater than (>)", value: "greaterThan" }, { label: "Less than (<)", value: "lessThan" }, { label: "Equals (=)", value: "equals" }];

    const orderFieldOptions = ORDER_FIELDS.map(f => ({ label: f.label, value: f.value }));
    const orderOperatorOptions = getOps(orderField);

    return (
        <>
            {/* ── Form Modal ───────────────────────────────────────────── */}
            <Modal
                open={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={selectedTemplate ? `Customize: ${selectedTemplate.label}` : "Create Custom Rule"}
                primaryAction={{
                    content: isSubmitting ? "Saving…" : "Save Rule",
                    onAction: handleSubmit,
                    loading: isSubmitting,
                }}
                secondaryActions={[{ content: "Cancel", onAction: () => setIsModalOpen(false) }]}
                size="large"
            >
                <Modal.Section>
                    {actionData?.error && (
                        <Box paddingBlockEnd="400">
                            <Banner tone="critical">{actionData.error}</Banner>
                        </Box>
                    )}
                    <FormLayout>
                        <TextField
                            label="Rule Name"
                            value={name}
                            onChange={setName}
                            placeholder="e.g. High-value Customers"
                            autoComplete="off"
                        />
                        <Select
                            label="Rule Type"
                            options={[
                                { label: "Customer Metric", value: "metric" },
                                { label: "Order Properties", value: "order" },
                            ]}
                            value={ruleType}
                            onChange={v => { setRuleType(v); }}
                        />

                        {ruleType === "metric" && (
                            <FormLayout.Group>
                                <Select label="Customer Field" options={metricFieldOptions} value={field} onChange={v => { setField(v); setOperator("greaterThan"); }} />
                                <Select label="Operator" options={metricOperatorOptions} value={operator} onChange={setOperator} />
                                <TextField
                                    label={field === "lastOrderDate" ? "Date (YYYY-MM-DD)" : "Value"}
                                    value={value}
                                    onChange={setValue}
                                    placeholder={field === "totalSpent" ? "1000" : field === "orderCount" ? "5" : "2024-01-01"}
                                    autoComplete="off"
                                />
                            </FormLayout.Group>
                        )}

                        {ruleType === "order" && (
                            <FormLayout.Group>
                                <Select label="Order Field" options={orderFieldOptions} value={orderField} onChange={v => { setOrderField(v); setOrderOperator(getOps(v)[0]?.value || "contains"); }} />
                                <Select label="Operator" options={orderOperatorOptions} value={orderOperator} onChange={setOrderOperator} />
                                <TextField
                                    label="Value"
                                    value={orderValue}
                                    onChange={setOrderValue}
                                    helpText={getHint(orderField)}
                                    placeholder="e.g. facebook, paypal, true"
                                    autoComplete="off"
                                />
                            </FormLayout.Group>
                        )}

                        <TextField
                            label="Tag to Apply"
                            value={targetTag}
                            onChange={setTargetTag}
                            placeholder="e.g. VIP, Loyal-Customer"
                            helpText="This tag will be added to the customer in Shopify."
                            autoComplete="off"
                        />
                    </FormLayout>
                </Modal.Section>
            </Modal>

            {/* ── Gallery Page ─────────────────────────────────────────── */}
            <Page
                title="Rule Templates"
                subtitle="Choose a template to get started, or create a custom rule from scratch."
                backAction={{ content: "Rules", url: "/app/rules" }}
                primaryAction={{ content: "Start from Scratch", icon: PlusIcon, onAction: openBlank }}
            >
                <Layout>
                    {/* ── AI Generator ─────────────────────────────────── */}
                    <Layout.Section>
                        <div style={{
                            background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #a855f7 100%)",
                            borderRadius: 12, padding: "24px 28px",
                            color: "#fff", position: "relative", overflow: "hidden"
                        }}>
                            {/* Decorative glow */}
                            <div style={{ position: "absolute", top: -40, right: -40, width: 140, height: 140, background: "rgba(255,255,255,0.06)", borderRadius: "50%" }} />
                            <div style={{ position: "absolute", bottom: -30, left: -20, width: 100, height: 100, background: "rgba(255,255,255,0.04)", borderRadius: "50%" }} />

                            <BlockStack gap="300">
                                <InlineStack gap="200" blockAlign="center">
                                    <Icon source={MagicIcon} />
                                    <Text variant="headingMd" as="h2" tone="text-inverse">Generate with AI ✨</Text>
                                </InlineStack>
                                <Text as="p" tone="text-inverse" variant="bodySm">
                                    Describe your rule in plain English and AI will build it for you automatically.
                                </Text>

                                {(aiFetcher.data as any)?.aiError && (
                                    <div style={{ background: "rgba(255,100,100,0.2)", borderRadius: 8, padding: "8px 12px" }}>
                                        <Text as="p" tone="text-inverse" variant="bodySm">{(aiFetcher.data as any).aiError}</Text>
                                    </div>
                                )}

                                <InlineStack gap="200" blockAlign="end" wrap={false}>
                                    <div style={{ flex: 1 }}>
                                        <div
                                            style={{ background: "rgba(255,255,255,0.15)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.25)" }}
                                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) handleAiGenerate(); }}
                                        >
                                            <TextField
                                                label=""
                                                labelHidden
                                                value={aiPrompt}
                                                onChange={setAiPrompt}
                                                placeholder="e.g. Tag customers who spent more than $500 and ordered 3+ times as Gold VIP"
                                                autoComplete="off"
                                                multiline={2}
                                            />
                                        </div>
                                    </div>
                                    <div style={{ flexShrink: 0 }}>
                                        <Button
                                            onClick={handleAiGenerate}
                                            loading={isGenerating}
                                            disabled={!aiPrompt.trim()}
                                            size="large"
                                        >
                                            {isGenerating ? "Generating…" : "Generate Rule"}
                                        </Button>
                                    </div>
                                </InlineStack>
                            </BlockStack>
                        </div>
                    </Layout.Section>

                    {/* Search + Category filters */}
                    <Layout.Section>

                        <Card>
                            <BlockStack gap="400">
                                <TextField
                                    label=""
                                    labelHidden
                                    prefix={<Icon source={SearchIcon} />}
                                    placeholder="Search templates… e.g. Facebook, COD, Discount"
                                    value={search}
                                    onChange={setSearch}
                                    autoComplete="off"
                                    clearButton
                                    onClearButtonClick={() => setSearch("")}
                                />
                                <InlineStack gap="200" wrap>
                                    {CATEGORIES.map(c => (
                                        <button
                                            key={c.value}
                                            onClick={() => setActiveCategory(c.value)}
                                            style={{
                                                padding: "6px 14px",
                                                borderRadius: 20,
                                                border: activeCategory === c.value ? "2px solid #6366f1" : "1.5px solid rgba(0,0,0,0.12)",
                                                background: activeCategory === c.value ? "#6366f1" : "transparent",
                                                color: activeCategory === c.value ? "#fff" : "#374151",
                                                fontWeight: activeCategory === c.value ? 600 : 400,
                                                fontSize: 13,
                                                cursor: "pointer",
                                                transition: "all 0.15s ease",
                                            }}
                                        >
                                            {c.label}
                                        </button>
                                    ))}
                                </InlineStack>
                            </BlockStack>
                        </Card>
                    </Layout.Section>

                    {/* Template Cards Grid */}
                    <Layout.Section>
                        {filtered.length === 0 ? (
                            <Card>
                                <Box padding="600">
                                    <BlockStack gap="200" inlineAlign="center">
                                        <Text as="p" tone="subdued" alignment="center">No templates match your search. Try a different keyword or category.</Text>
                                        <Button onClick={openBlank}>Create Custom Rule</Button>
                                    </BlockStack>
                                </Box>
                            </Card>
                        ) : (
                            <div style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                                gap: 16,
                            }}>
                                {filtered.map(t => {
                                    const isLocked = (t.category === "order" || t.category === "payment" || t.category === "location" || t.category === "discount") && isFreePlan;
                                    return (
                                        <div
                                            key={t.key}
                                            style={{
                                                background: "#fff",
                                                border: "1.5px solid rgba(0,0,0,0.08)",
                                                borderRadius: 12,
                                                padding: "20px 20px 16px",
                                                position: "relative",
                                                transition: "box-shadow 0.2s, border-color 0.2s",
                                                boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                                                opacity: isLocked ? 0.7 : 1,
                                            }}
                                            onMouseEnter={e => { if (!isLocked) (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 20px rgba(99,102,241,0.12)"; (e.currentTarget as HTMLDivElement).style.borderColor = "#6366f1"; }}
                                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.04)"; (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(0,0,0,0.08)"; }}
                                        >
                                            {/* Edit button */}
                                            <button
                                                onClick={() => isLocked ? navigate("/app/pricing") : applyTemplate(t)}
                                                style={{
                                                    position: "absolute", top: 12, right: 12,
                                                    background: "rgba(0,0,0,0.05)", border: "none",
                                                    borderRadius: 6, padding: "4px 8px",
                                                    cursor: "pointer", display: "flex", alignItems: "center",
                                                    gap: 4, fontSize: 12, color: "#374151",
                                                }}
                                                title={isLocked ? "Upgrade to use this template" : "Use this template"}
                                            >
                                                <Icon source={isLocked ? MagicIcon : EditIcon} />
                                                {isLocked ? "Upgrade" : "Use"}
                                            </button>

                                            {/* Content */}
                                            <BlockStack gap="200">
                                                <InlineStack gap="200" blockAlign="center">
                                                    <div style={{ color: "#6366f1" }}>
                                                        <Icon source={t.icon} tone="magic" />
                                                    </div>
                                                    <Text variant="headingSm" as="h3" fontWeight="bold">{t.label}</Text>
                                                </InlineStack>

                                                <Text as="p" tone="subdued" variant="bodySm">{t.longDescription}</Text>

                                                <div style={{ marginTop: 8 }}>
                                                    <InlineStack gap="150" wrap>
                                                        {t.popular && <Badge tone="magic">Most popular</Badge>}
                                                        <Badge tone="info">{t.category.charAt(0).toUpperCase() + t.category.slice(1)}</Badge>
                                                        {isLocked && <Badge tone="warning">Growth+</Badge>}
                                                    </InlineStack>
                                                </div>
                                            </BlockStack>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Layout.Section>

                    {/* Footer CTA */}
                    <Layout.Section>
                        <Card background="bg-surface-magic">
                            <InlineStack align="space-between" blockAlign="center" wrap>
                                <BlockStack gap="100">
                                    <Text variant="headingSm" as="h3">Want something specific?</Text>
                                    <Text as="p" tone="subdued" variant="bodySm">Can't find a template? Build your own rule with any condition.</Text>
                                </BlockStack>
                                <Button icon={PlusIcon} onClick={openBlank}>Create Custom Rule</Button>
                            </InlineStack>
                        </Card>
                    </Layout.Section>
                </Layout>
            </Page>
        </>
    );
}
