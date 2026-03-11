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
    OrderIcon, PaymentIcon, DiscountIcon, EditIcon, PlusIcon, LocationIcon, DeleteIcon
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
    const targetTag = fd.get("targetTag") as string;
    const targetEntity = (fd.get("targetEntity") as string) || "customer";
    const matchType = (fd.get("matchType") as string) || "ALL";
    const conditionsJson = fd.get("conditionsJson") as string;

    if (!name?.trim() || !targetTag?.trim()) return { error: "Rule name and tag are required." };

    let conditions: any[] = [];
    try {
        if (conditionsJson) {
            conditions = JSON.parse(conditionsJson);
            // Ensure numbers are converted if needed for metrics
            conditions = conditions.map((c: any) => {
                if (c.ruleCategory === "metric" && c.field !== "lastOrderDate") {
                    return { ...c, value: Number(c.value) };
                }
                return c;
            });
        }
    } catch (e) { return { error: "Invalid conditions structure" }; }

    const description = `${conditions.length} condition(s) specified.`;

    await db.rule.create({
        data: {
            storeId: store.id, name, description,
            conditions: JSON.stringify(conditions), targetTag, targetEntity,
            matchType, isActive: true
        }
    });

    // Fire-and-forget: do NOT await this — redirect immediately
    const hasMetric = conditions.some((c: any) => c.ruleCategory === "metric");
    if (hasMetric) {
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
    targetEntity?: "customer" | "order";
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
        ruleType: "metric", field: "totalSpent", operator: "greaterThan", value: "1000", tag: "Gold-VIP", targetEntity: "customer",
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
        ruleType: "metric", field: "lastOrderDate", operator: "isBefore", value: "__90_DAYS_AGO__", tag: "At-Risk",
    },
    // Order — Traffic Source
    {
        key: "facebook_buyer", label: "Facebook Campaign Orders", popular: true,
        category: "order", icon: OrderIcon,
        description: "Traffic source contains Facebook",
        longDescription: "When orders are created and traffic source contains facebook, automatically add tag Facebook to order.",
        ruleType: "order", orderField: "order_source", orderOperator: "contains", orderValue: "facebook", tag: "Social-FB", targetEntity: "order",
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
    // New Additions per User Request
    {
        key: "high_volume_social", label: "High Value Social Ads", popular: true,
        category: "order", icon: CashDollarIcon,
        description: "Spent over $500 AND came from Facebook",
        longDescription: "When orders are created where traffic source is Facebook and total spent is greater than $500, apply High-Value-FB.",
        ruleType: "mixed", field: "totalSpent", operator: "greaterThan", value: "500", orderField: "order_source", orderOperator: "contains", orderValue: "facebook", tag: "High-Value-FB",
    },
    {
        key: "tiktok_cod", label: "TikTok COD Buyers",
        category: "payment", icon: PaymentIcon,
        description: "Traffic from TikTok + Cash on Delivery",
        longDescription: "When orders are created from TikTok using COD payment method, apply TikTok-COD.",
        ruleType: "order", orderField: "payment_method", orderOperator: "contains", orderValue: "cash_on_delivery", tag: "TikTok-COD",
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
    const [targetTag, setTargetTag] = useState("");
    const [targetEntity, setTargetEntity] = useState("customer");
    const [matchType, setMatchType] = useState("ALL");
    const [conditions, setConditions] = useState<any[]>([{ ruleCategory: "metric", field: "totalSpent", operator: "greaterThan", value: "" }]);

    // Auto-populate form when AI returns a result
    useEffect(() => {
        const gen = (aiFetcher.data as any)?.aiGenerated;
        if (!gen) return;
        setSelectedTemplate(null);
        setName(gen.name || aiPrompt);
        setTargetTag(gen.targetTag || "");
        setTargetEntity(gen.targetEntity || "customer");
        setMatchType(gen.matchType || "ALL");

        let newConditions = [];
        if (gen.conditions && gen.conditions.length > 0) {
            // Standardize AI conditions
            newConditions = gen.conditions.map((c: any) => ({
                ruleCategory: c.ruleCategory || "metric",
                field: c.field || "totalSpent",
                operator: c.operator || "greaterThan",
                value: String(c.value || "")
            }));
        } else {
            newConditions = [{ ruleCategory: "metric", field: "totalSpent", operator: "greaterThan", value: "" }];
        }
        setConditions(newConditions);
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
        setTargetTag(t.tag);
        setTargetEntity(t.targetEntity || "customer");
        setMatchType("ALL");

        // Helper: compute a date string N days in the past
        const daysAgo = (n: number) => {
            const d = new Date();
            d.setDate(d.getDate() - n);
            return d.toISOString().split("T")[0]; // YYYY-MM-DD
        };

        let newConditions: any[] = [];

        if (t.key === "at_risk") {
            // Dynamically calculate 90 days ago so the condition always fires correctly
            newConditions = [{ ruleCategory: "metric", field: "lastOrderDate", operator: "isBefore", value: daysAgo(90) }];
        } else if (t.key === "high_volume_social") {
            // Mixed rule: metric (totalSpent) + order (traffic source)
            newConditions = [
                { ruleCategory: "metric", field: "totalSpent", operator: "greaterThan", value: "500" },
                { ruleCategory: "order", field: "order_source", operator: "contains", value: "facebook" }
            ];
        } else if (t.key === "tiktok_cod") {
            newConditions = [
                { ruleCategory: "order", field: "order_source", operator: "contains", value: "tiktok" },
                { ruleCategory: "order", field: "payment_method", operator: "contains", value: "cash_on_delivery" }
            ];
        } else if (t.ruleType === "metric") {
            // Check if value is a sentinel placeholder
            const val = t.value === "__90_DAYS_AGO__" ? daysAgo(90) : (t.value || "");
            newConditions = [{ ruleCategory: "metric", field: t.field || "totalSpent", operator: t.operator || "greaterThan", value: val }];
        } else {
            newConditions = [{ ruleCategory: "order", field: t.orderField || "order_source", operator: t.orderOperator || "contains", value: t.orderValue || "" }];
        }

        setConditions(newConditions);
        setIsModalOpen(true);
    };

    const openBlank = () => {
        setSelectedTemplate(null);
        setName(""); setTargetTag(""); setTargetEntity("customer"); setMatchType("ALL");
        setConditions([{ ruleCategory: "metric", field: "totalSpent", operator: "greaterThan", value: "" }]);
        setIsModalOpen(true);
    };

    const addCondition = () => {
        setConditions([...conditions, { ruleCategory: "order", field: "order_source", operator: "contains", value: "" }]);
    };

    const updateCondition = (index: number, key: string, val: string) => {
        const newConds = [...conditions];
        newConds[index][key] = val;
        // Auto-fix operator on field switch
        if (key === "field") {
            if (newConds[index].ruleCategory === "metric") {
                newConds[index].operator = val === "lastOrderDate" ? "isBefore" : "greaterThan";
            } else {
                newConds[index].operator = getOps(val)[0]?.value || "contains";
            }
        }
        if (key === "ruleCategory") {
            if (val === "metric") { newConds[index].field = "totalSpent"; newConds[index].operator = "greaterThan"; }
            else { newConds[index].field = "order_source"; newConds[index].operator = "contains"; }
        }
        setConditions(newConds);
    };

    const removeCondition = (index: number) => {
        setConditions(conditions.filter((_, i) => i !== index));
    };

    const handleSubmit = () => {
        submit({ name, targetTag, targetEntity, matchType, conditionsJson: JSON.stringify(conditions) }, { method: "post" });
    };

    const metricFieldOptions = [
        { label: "Total Spent ($)", value: "totalSpent" },
        { label: "Number of Orders", value: "orderCount" },
        { label: "Last Order Date", value: "lastOrderDate" },
    ];

    const orderFieldOptions = ORDER_FIELDS.map(f => ({ label: f.label, value: f.value }));

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
                            label="Multiple Conditions Behavior"
                            options={[
                                { label: "Match ALL conditions (AND)", value: "ALL" },
                                { label: "Match ANY condition (OR)", value: "ANY" },
                            ]}
                            value={matchType}
                            onChange={setMatchType}
                        />
                        <Text variant="headingSm" as="h6">Conditions</Text>
                        <BlockStack gap="300">
                            {conditions.map((cond, index) => {
                                const isMetric = cond.ruleCategory === "metric";
                                const ops = isMetric
                                    ? (cond.field === "lastOrderDate"
                                        ? [{ label: "Before", value: "isBefore" }, { label: "After", value: "isAfter" }]
                                        : [{ label: "Greater than (>)", value: "greaterThan" }, { label: "Less than (<)", value: "lessThan" }, { label: "Equals (=)", value: "equals" }])
                                    : getOps(cond.field);

                                return (
                                    <div key={index} style={{ padding: "12px", background: "var(--p-color-bg-surface-secondary)", borderRadius: "8px", position: "relative" }}>
                                        {conditions.length > 1 && (
                                            <div style={{ position: "absolute", top: "12px", right: "12px", zIndex: 2 }}>
                                                <Button size="micro" variant="tertiary" tone="critical" onClick={() => removeCondition(index)} icon={DeleteIcon} />
                                            </div>
                                        )}
                                        <FormLayout>
                                            <Select
                                                label="Condition Scope"
                                                options={[
                                                    { label: "Customer Property", value: "metric" },
                                                    { label: "Order Property", value: "order" },
                                                ]}
                                                value={cond.ruleCategory}
                                                onChange={v => updateCondition(index, "ruleCategory", v)}
                                            />
                                            <FormLayout.Group>
                                                <Select
                                                    label="Field"
                                                    options={isMetric ? metricFieldOptions : orderFieldOptions}
                                                    value={cond.field}
                                                    onChange={v => updateCondition(index, "field", v)}
                                                />
                                                <Select
                                                    label="Operator"
                                                    options={ops}
                                                    value={cond.operator}
                                                    onChange={v => updateCondition(index, "operator", v)}
                                                />
                                                <TextField
                                                    label={isMetric ? (cond.field === "lastOrderDate" ? "Date (YYYY-MM-DD)" : "Value") : "Value"}
                                                    value={cond.value}
                                                    onChange={v => updateCondition(index, "value", v)}
                                                    helpText={!isMetric ? getHint(cond.field) : ""}
                                                    placeholder={isMetric ? (cond.field === "totalSpent" ? "1000" : cond.field === "orderCount" ? "5" : "2024-01-01") : "e.g. facebook, true"}
                                                    autoComplete="off"
                                                />
                                            </FormLayout.Group>
                                        </FormLayout>
                                    </div>
                                );
                            })}
                        </BlockStack>
                        <InlineStack>
                            <Button size="slim" icon={PlusIcon} onClick={addCondition}>Add AND Condition</Button>
                        </InlineStack>

                        <TextField
                            label="Tag to Apply"
                            value={targetTag}
                            onChange={setTargetTag}
                            placeholder="e.g. VIP, Loyal-Customer"
                            helpText={`This tag will be added to the ${targetEntity === "order" ? "Order" : "Customer"} in Shopify.`}
                            autoComplete="off"
                        />
                        <Select
                            label="Tag Target"
                            options={[
                                { label: "Shopify Customer Profile", value: "customer" },
                                { label: "Shopify Order", value: "order" },
                            ]}
                            value={targetEntity}
                            onChange={setTargetEntity}
                            helpText={targetEntity === "order" ? "The tag will appear on the individual Shopify Order." : "The tag will appear on the Customer's profile in Shopify."}
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

                        <div className="premium-card">
                            <Box padding="400">
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
                            </Box>
                        </div>
                    </Layout.Section>

                    {/* Template Cards Grid */}
                    <Layout.Section>
                        {filtered.length === 0 ? (
                            <div className="premium-card">
                                <Box padding="400">
                                    <BlockStack gap="200" inlineAlign="center">
                                        <Text as="p" tone="subdued" alignment="center">No templates match your search. Try a different keyword or category.</Text>
                                        <Button onClick={openBlank}>Create Custom Rule</Button>
                                    </BlockStack>
                                </Box>
                            </div>
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
                        <div className="premium-card" style={{ background: "var(--p-color-bg-surface-magic)" }}>
                            <Box padding="400">
                                <InlineStack align="space-between" blockAlign="center" wrap>
                                    <BlockStack gap="100">
                                        <Text variant="headingSm" as="h3">Want something specific?</Text>
                                        <Text as="p" tone="subdued" variant="bodySm">Can't find a template? Build your own rule with any condition.</Text>
                                    </BlockStack>
                                    <div className="btn-premium">
                                        <Button icon={PlusIcon} onClick={openBlank}>Create Custom Rule</Button>
                                    </div>
                                </InlineStack>
                            </Box>
                        </div>
                    </Layout.Section>
                </Layout>
            </Page>
        </>
    );
}
