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
  HashtagIcon, ExternalIcon, ChartLineIcon
} from "@shopify/polaris-icons";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getCachedStore(session.shop);
  if (!store) throw new Error("Store not found");

  // Fetch all customers for this store to aggregate segments
  // In a massive production app, we would use native SQL grouping or background aggregation jobs.
  const allCustomers = await db.customer.findMany({
    where: { storeId: store.id },
    select: { id: true, tags: true, totalSpent: true }
  });

  const segmentsMap: Record<string, { count: number; totalSpent: number }> = {};

  allCustomers.forEach((c) => {
    if (c.tags) {
      const tagsArray = c.tags.split(",").map((t) => t.trim()).filter(Boolean);
      tagsArray.forEach((tag) => {
        if (!segmentsMap[tag]) {
          segmentsMap[tag] = { count: 0, totalSpent: 0 };
        }
        segmentsMap[tag].count += 1;
        segmentsMap[tag].totalSpent += c.totalSpent;
      });
    }
  });

  const segments = Object.entries(segmentsMap)
    .map(([name, data]) => ({
      name,
      count: data.count,
      totalSpent: data.totalSpent,
    }))
    .sort((a, b) => b.count - a.count);

  return { segments };
};

export default function SmartSegments() {
  const { segments } = useLoaderData<typeof loader>();

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
                        <div style={{ background: "var(--p-color-bg-surface-magic)", padding: "8px", borderRadius: "8px", display: "flex", color: "var(--p-color-text-magic)" }}>
                          <Icon source={HashtagIcon} />
                        </div>
                        <Text variant="headingMd" as="h2">{segment.name}</Text>
                      </InlineStack>
                      <Badge tone="magic">{`${segment.count} Customers`}</Badge>
                    </InlineStack>

                    <Divider />

                    <BlockStack gap="200">
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Customers with the <strong>{segment.name}</strong> tag applied by AI rules.
                      </Text>
                      <Box paddingBlockStart="200">
                        <InlineStack gap="200" blockAlign="center">
                          <Icon source={ChartLineIcon} tone="subdued" />
                          <Text as="span" variant="bodySm" tone="subdued">
                            Segment Value: <strong>${segment.totalSpent.toFixed(2)}</strong>
                          </Text>
                        </InlineStack>
                      </Box>
                    </BlockStack>

                    <Box paddingBlockStart="200">
                      <Button 
                        size="medium"
                        fullWidth 
                        icon={ExternalIcon}
                        onClick={() => {
                          // Redirect to Shopify's native customer list filtered by this tag
                          window.open(`shopify:admin/customers?query=${encodeURIComponent(segment.name)}`, "_blank");
                        }}
                      >
                        View in Shopify
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
