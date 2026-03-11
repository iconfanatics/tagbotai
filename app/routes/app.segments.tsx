import { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Button, Icon, Divider, EmptyState, Box
} from "@shopify/polaris";
import {
  HashtagIcon, ChartLineIcon, ExportIcon, OrderIcon
} from "@shopify/polaris-icons";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getCachedStore(session.shop);
  if (!store) throw new Error("Store not found");

  // Fetch all customers for this store to aggregate segments
  const allCustomers = await db.customer.findMany({
    where: { storeId: store.id },
    select: { id: true, tags: true, totalSpent: true, firstName: true, lastName: true, email: true, orderCount: true }
  });

  // Fetch all active rules so we know which tags are intended for Orders vs Customers
  const rules = await db.rule.findMany({
    where: { storeId: store.id },
    select: { targetTag: true, targetEntity: true }
  });

  const orderRules = rules.filter(r => r.targetEntity === "order").map(r => r.targetTag.toLowerCase());

  // To get order segments, we group the activity log by tag context where action is TAG_ADDED and target is an order rule
  const logsGroups = await db.activityLog.groupBy({
    by: ['tagContext'],
    where: { storeId: store.id, action: "TAG_ADDED" },
    _count: { id: true }
  });

  // Create a fast lookup for rule entity types
  const ruleEntityMap = new Map();
  rules.forEach(r => ruleEntityMap.set(r.targetTag.toLowerCase(), r.targetEntity));

  const getTargetEntity = (tag: string) => {
    return ruleEntityMap.get(tag.toLowerCase()) || "customer";
  };

  const segmentsMap: Record<string, { count: number; totalSpent: number; customers: any[], type: "customer" | "order" }> = {};

  // 1. Process Customer Segments
  allCustomers.forEach((c) => {
    if (c.tags) {
      const tagsArray = c.tags.split(",").map((t) => t.trim()).filter(Boolean);
      tagsArray.forEach((tag) => {
        // Only tally this from the Customer table if it's actually a customer tag
        if (getTargetEntity(tag) !== "customer") return;

        if (!segmentsMap[tag]) {
          segmentsMap[tag] = { count: 0, totalSpent: 0, customers: [], type: "customer" };
        }
        segmentsMap[tag].count += 1;
        segmentsMap[tag].totalSpent += c.totalSpent;
        segmentsMap[tag].customers.push({
          firstName: c.firstName || "",
          lastName: c.lastName || "",
          email: c.email || "",
          totalSpent: c.totalSpent,
          orderCount: c.orderCount
        });
      });
    }
  });

  // 2. Process Order Segments
  // We don't store dollar values on the activity log for orders, so we'll just show the count
  logsGroups.forEach((group) => {
    const tag = group.tagContext || "";
    if (getTargetEntity(tag) === "order") {
      segmentsMap[tag] = {
         count: group._count.id,
         totalSpent: 0, // N/A for raw order logs
         customers: [], // Will be generated via CSV export on the fly
         type: "order"
      };
    }
  });

  const segments = Object.entries(segmentsMap)
    .map(([name, data]) => ({
      name,
      count: data.count,
      totalSpent: data.totalSpent,
      customers: data.customers,
      type: data.type
    }))
    .sort((a, b) => b.count - a.count);

  return { segments };
};

export default function SmartSegments() {
  const { segments } = useLoaderData<typeof loader>();

  const downloadCustomerCSV = (segmentName: string, customers: any[], type: "customer" | "order") => {
    if (type === "order") {
        // For Shopify Embedded Apps, changing window.location.href to a relative
        // path strips the iframe auth token, kicking them to a login screen.
        // Instead, we use fetch() which natively includes Shopify's session header,
        // then we manually trigger the browser's download dialog using a Blob.
        const exportUrl = `/app/export?tag=${encodeURIComponent(segmentName)}&entity=order`;
        
        fetch(exportUrl)
          .then(async (res) => {
             if (!res.ok) throw new Error("Export failed");
             const blob = await res.blob();
             const url = window.URL.createObjectURL(blob);
             const a = document.createElement('a');
             a.href = url;
             a.download = `${segmentName.replace(/\s+/g, "_")}_orders.csv`;
             document.body.appendChild(a);
             a.click();
             a.remove();
          })
          .catch(err => console.error(err));
        
        return;
    }

    const header = "First Name,Last Name,Email,Total Spent,Orders\n";
    const rows = customers.map(c => 
      `"${c.firstName}","${c.lastName}","${c.email}",${c.totalSpent},${c.orderCount}`
    ).join("\n");
    
    // Add UTF-8 BOM so Excel and other spreadsheet software read it correctly
    const bom = "\uFEFF";
    const csvStr = bom + header + rows;

    const blob = new Blob([csvStr], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `${segmentName.replace(/\s+/g, "_")}_segment.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Page 
      title="Smart Segments" 
      subtitle="Auto-generated customer groups based on AI tags."
    >
      <BlockStack gap="500">
        {segments.length === 0 ? (
          <Card padding="500">
            <EmptyState
              heading="No segments generated yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Once TagBot AI starts tagging your customers, they will automatically be grouped into actionable segments here.</p>
            </EmptyState>
          </Card>
        ) : (
          <Layout>
            {segments.map((segment) => (
              <Layout.Section variant="oneThird" key={segment.name}>
                <Card padding="500">
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <div style={{ background: segment.type === "order" ? "var(--p-color-bg-surface-info)" : "var(--p-color-bg-surface-magic)", padding: "8px", borderRadius: "8px", display: "flex", color: segment.type === "order" ? "var(--p-color-text-info)" : "var(--p-color-text-magic)" }}>
                          <Icon source={segment.type === "order" ? OrderIcon : HashtagIcon} />
                        </div>
                        <Text variant="headingMd" as="h2">{segment.name}</Text>
                      </InlineStack>
                      <Badge tone={segment.type === "order" ? "info" : "magic"}>{`${segment.count} ${segment.type === "order" ? 'Orders' : 'Customers'}`}</Badge>
                    </InlineStack>

                    <Divider />

                    <BlockStack gap="200">
                      <Text variant="bodyMd" as="p" tone="subdued">
                        {segment.type === "order" ? 'Orders' : 'Customers'} with the <strong>{segment.name}</strong> tag applied by AI rules.
                      </Text>
                      <Box paddingBlockStart="200">
                        <InlineStack gap="200" blockAlign="center">
                          <Icon source={ChartLineIcon} tone="subdued" />
                          <Text as="span" variant="bodySm" tone="subdued">
                            {segment.type === "order" ? (
                                "Export exact value data via CSV"
                            ) : (
                                <>Segment Value: <strong>${segment.totalSpent.toFixed(2)}</strong></>
                            )}
                          </Text>
                        </InlineStack>
                      </Box>
                    </BlockStack>

                    <Box paddingBlockStart="200">
                      <Button 
                        size="medium"
                        fullWidth 
                        icon={ExportIcon}
                        onClick={() => downloadCustomerCSV(segment.name, segment.customers, segment.type)}
                      >
                        Download CSV
                      </Button>
                    </Box>
                  </BlockStack>
                </Card>
              </Layout.Section>
            ))}
          </Layout>
        )}
      </BlockStack>
    </Page>
  );
}

export const headers = (headersArgs: any) => boundary.headers(headersArgs);
