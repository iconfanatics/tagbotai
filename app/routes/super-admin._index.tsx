import { useLoaderData, useSubmit, useNavigation, useActionData } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { Page, Layout, Card, Text, BlockStack, InlineStack, DataTable, Button, Icon, Badge, TextField, Divider, Banner } from "@shopify/polaris";
import { MoneyIcon, PersonIcon, HashtagIcon, AlertCircleIcon, SettingsIcon } from "@shopify/polaris-icons";
import db from "../db.server";
import { requireAdminAuth } from "../adminSession.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    // 1. Lock down route
    await requireAdminAuth(request);

    // 2. Fetch all stores and calculate churn
    const stores = await db.store.findMany({
        orderBy: { createdAt: "desc" },
        include: {
            _count: {
                select: {
                    customers: true,
                    activityLogs: { where: { action: "TAG_ADDED" } }
                }
            }
        }
    });

    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const globalChurnRiskCount = await db.customer.count({
        where: {
            orderCount: { gt: 3 },
            lastOrderDate: { lt: sixtyDaysAgo }
        }
    });

    // 3. Aggregate Data
    const activeInstalls = stores.filter(s => s.isActive).length;
    let totalRevenue = 0;
    let totalTagsEverApplied = 0;

    const mappedStores = stores.map(store => {
        const totalCustomers = store._count?.customers || 0;
        const totalTagsApplied = store._count?.activityLogs || 0;

        totalTagsEverApplied += totalTagsApplied;

        if (store.isActive) {
            if (store.planName === "Growth Plan") totalRevenue += 14.99;
            if (store.planName === "Pro Plan") totalRevenue += 29.99;
            if (store.planName === "Elite Plan") totalRevenue += 49.99;
        }

        return {
            id: store.id,
            shop: store.shop,
            planName: store.planName || "Free",
            isActive: store.isActive,
            monthlyTagCount: store.monthlyTagCount,
            totalCustomers: totalCustomers,
            totalTagsApplied: totalTagsApplied,
            createdAt: new Date(store.createdAt).toLocaleDateString()
        };
    });

    // Load pricing config
    let pricingConfig = await db.pricingConfig.findUnique({ where: { key: "default" } });
    if (!pricingConfig) {
        pricingConfig = await db.pricingConfig.create({
            data: { key: "default", yearlyDiscount: 15, growthMonthly: 14.99, proMonthly: 29.99, eliteMonthly: 49.99 }
        });
    }

    return { activeInstalls, totalRevenue, totalTagsEverApplied, globalChurnRiskCount, stores: mappedStores, pricingConfig };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    await requireAdminAuth(request);

    const formData = await request.formData();
    const storeId = formData.get("storeId") as string;
    const intent = formData.get("intent") as string;

    if (storeId && intent === "upgrade_pro") {
        await db.store.update({ where: { id: storeId }, data: { planName: "Pro Plan", monthlyTagCount: 0 } });
        return { success: true };
    }
    if (storeId && intent === "upgrade_elite") {
        await db.store.update({ where: { id: storeId }, data: { planName: "Elite Plan", monthlyTagCount: 0 } });
        return { success: true };
    }
    if (storeId && intent === "downgrade_free") {
        await db.store.update({ where: { id: storeId }, data: { planName: "Free", monthlyTagCount: 0 } });
        return { success: true };
    }

    if (intent === "update_pricing") {
        const yearlyDiscount = parseInt(formData.get("yearlyDiscount") as string || "15");
        const growthMonthly = parseFloat(formData.get("growthMonthly") as string || "14.99");
        const proMonthly = parseFloat(formData.get("proMonthly") as string || "29.99");
        const eliteMonthly = parseFloat(formData.get("eliteMonthly") as string || "49.99");

        await db.pricingConfig.upsert({
            where: { key: "default" },
            create: { key: "default", yearlyDiscount, growthMonthly, proMonthly, eliteMonthly },
            update: { yearlyDiscount, growthMonthly, proMonthly, eliteMonthly }
        });
        return { success: true, message: "Pricing updated! Merchants will see the new prices immediately." };
    }

    return { success: false };
};

export default function SuperAdminIndex() {
    const { activeInstalls, totalRevenue, totalTagsEverApplied, globalChurnRiskCount, stores, pricingConfig } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const isUpdating = navigation.state === "submitting";

    // Pricing config local state
    const [yearlyDiscount, setYearlyDiscount] = useState(String(pricingConfig.yearlyDiscount));
    const [growthMonthly, setGrowthMonthly] = useState(String(pricingConfig.growthMonthly));
    const [proMonthly, setProMonthly] = useState(String(pricingConfig.proMonthly));
    const [eliteMonthly, setEliteMonthly] = useState(String(pricingConfig.eliteMonthly));

    const handleUpgrade = (storeId: string, intent: string) => {
        submit({ storeId, intent }, { method: "post" });
    };

    const handleSavePricing = () => {
        submit({ intent: "update_pricing", yearlyDiscount, growthMonthly, proMonthly, eliteMonthly }, { method: "post" });
    };

    return (
        <Page title="Super Admin Dashboard" subtitle="Manage TagBot AI Installations">
            <Layout>

                {/* KPIs */}
                <Layout.Section>
                    <InlineStack gap="400" align="space-around" blockAlign="stretch" wrap={false}>
                        <div style={{ flex: 1 }}>
                            <Card>
                                <BlockStack gap="200" align="start">
                                    <InlineStack gap="200" align="start" blockAlign="center">
                                        <Icon source={PersonIcon} tone="base" />
                                        <Text variant="headingSm" as="h6" tone="subdued">Active Installs</Text>
                                    </InlineStack>
                                    <Text variant="heading3xl" as="h2">{activeInstalls}</Text>
                                </BlockStack>
                            </Card>
                        </div>

                        <div style={{ flex: 1 }}>
                            <Card background="bg-surface-magic">
                                <BlockStack gap="200" align="start">
                                    <InlineStack gap="200" align="start" blockAlign="center">
                                        <Icon source={MoneyIcon} tone="magic" />
                                        <Text variant="headingSm" as="h6" tone="magic">Est. Monthly Revenue</Text>
                                    </InlineStack>
                                    <Text variant="heading3xl" as="h2">${totalRevenue.toFixed(2)}</Text>
                                </BlockStack>
                            </Card>
                        </div>

                        <div style={{ flex: 1 }}>
                            <Card>
                                <BlockStack gap="200" align="start">
                                    <InlineStack gap="200" align="start" blockAlign="center">
                                        <Icon source={HashtagIcon} tone="base" />
                                        <Text variant="headingSm" as="h6" tone="subdued">Total Tags Fired</Text>
                                    </InlineStack>
                                    <Text variant="heading3xl" as="h2">{totalTagsEverApplied.toLocaleString()}</Text>
                                </BlockStack>
                            </Card>
                        </div>
                        <div style={{ flex: 1 }}>
                            <Card>
                                <BlockStack gap="200" align="start">
                                    <InlineStack gap="200" align="start" blockAlign="center">
                                        <Icon source={AlertCircleIcon} tone="critical" />
                                        <Text variant="headingSm" as="h6" tone="subdued">Global Churn Risk (Users)</Text>
                                    </InlineStack>
                                    <Text variant="heading3xl" as="h2">{globalChurnRiskCount.toLocaleString()}</Text>
                                </BlockStack>
                            </Card>
                        </div>
                    </InlineStack>
                </Layout.Section>

                {/* Pricing Config Card */}
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <InlineStack align="space-between" blockAlign="center">
                                <InlineStack gap="200" blockAlign="center">
                                    <Icon source={SettingsIcon} tone="base" />
                                    <Text variant="headingMd" as="h3">Pricing Configuration</Text>
                                </InlineStack>
                                <Text as="p" tone="subdued" variant="bodySm">Changes appear live on the merchant Plans page.</Text>
                            </InlineStack>

                            {actionData?.message && (
                                <Banner tone={actionData.success ? "success" : "critical"}>{actionData.message}</Banner>
                            )}

                            <Divider />

                            <InlineStack gap="400" wrap={false}>
                                <div style={{ flex: 1 }}>
                                    <TextField
                                        label="Growth Monthly Price ($)"
                                        value={growthMonthly}
                                        onChange={setGrowthMonthly}
                                        type="number"
                                        autoComplete="off"
                                        prefix="$"
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <TextField
                                        label="Pro Monthly Price ($)"
                                        value={proMonthly}
                                        onChange={setProMonthly}
                                        type="number"
                                        autoComplete="off"
                                        prefix="$"
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <TextField
                                        label="Elite Monthly Price ($)"
                                        value={eliteMonthly}
                                        onChange={setEliteMonthly}
                                        type="number"
                                        autoComplete="off"
                                        prefix="$"
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <TextField
                                        label="Yearly Discount (%)"
                                        value={yearlyDiscount}
                                        onChange={setYearlyDiscount}
                                        type="number"
                                        autoComplete="off"
                                        suffix="%"
                                        helpText="Applied when merchant selects Yearly billing"
                                    />
                                </div>
                            </InlineStack>

                            <InlineStack>
                                <Button variant="primary" onClick={handleSavePricing} loading={isUpdating}>
                                    Save Pricing
                                </Button>
                            </InlineStack>
                        </BlockStack>
                    </Card>
                </Layout.Section>

                {/* Manage Stores Map */}
                <Layout.Section>
                    <Card padding="0">
                        <div style={{ padding: '16px' }}>
                            <Text variant="headingMd" as="h3">All Installed Stores</Text>
                        </div>
                        <DataTable
                            columnContentTypes={['text', 'text', 'text', 'numeric', 'numeric', 'numeric', 'text', 'text']}
                            headings={['Shop URL', 'Status', 'Plan', 'Total Customers', 'Lifelong Tags', 'Tags Used (Mo)', 'Installed At', 'Actions']}
                            rows={stores.map(store => [
                                <Text key={`id-${store.id}`} variant="bodyMd" fontWeight="bold" as="span">{store.shop}</Text>,
                                store.isActive ? <Badge key={`active-${store.id}`} tone="success">Active</Badge> : <Badge key={`inactive-${store.id}`} tone="critical">Uninstalled</Badge>,
                                <Badge key={`plan-${store.id}`} tone={store.planName.includes("Pro") || store.planName.includes("Elite") ? "magic" : "info"}>
                                    {store.planName}
                                </Badge>,
                                store.totalCustomers.toLocaleString(),
                                store.totalTagsApplied.toLocaleString(),
                                store.monthlyTagCount.toLocaleString(),
                                store.createdAt,
                                <InlineStack key={`actions-${store.id}`} gap="200" wrap={false}>
                                    <Button size="micro" onClick={() => handleUpgrade(store.id, "upgrade_pro")} disabled={store.planName === "Pro Plan" || isUpdating}>Set Pro</Button>
                                    <Button size="micro" tone="critical" onClick={() => handleUpgrade(store.id, "upgrade_elite")} disabled={store.planName === "Elite Plan" || isUpdating}>Set Elite</Button>
                                    <Button size="micro" variant="tertiary" onClick={() => handleUpgrade(store.id, "downgrade_free")} disabled={store.planName === "Free" || isUpdating}>Reset Free</Button>
                                </InlineStack>
                            ])}
                            hasZebraStripingOnData
                        />
                    </Card>
                </Layout.Section>

            </Layout>
        </Page>
    );
}
