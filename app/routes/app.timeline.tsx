import { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { getCachedStore } from "../services/cache.server";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack, Badge,
  TextField, Button, Icon, Box, Divider, EmptyState, Avatar
} from "@shopify/polaris";
import {
  SearchIcon, EmailIcon, ChartVerticalIcon, HashtagIcon, CheckIcon, XIcon
} from "@shopify/polaris-icons";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getCachedStore(session.shop);
  if (!store) throw new Error("Store not found");

  const url = new URL(request.url);
  const searchQ = url.searchParams.get("q") || "";
  const selectedCustomerId = url.searchParams.get("customerId");

  // Fetch top 5 recent customers or filter by search query
  const customers = await db.customer.findMany({
    where: {
      storeId: store.id,
      OR: searchQ ? [
        { email: { contains: searchQ } },
        { firstName: { contains: searchQ } },
        { lastName: { contains: searchQ } }
      ] : undefined
    },
    take: 5,
    orderBy: { updatedAt: "desc" }
  });

  let selectedCustomer = null;
  let timelineLogs: any[] = [];

  if (selectedCustomerId) {
    selectedCustomer = await db.customer.findUnique({
      where: { id_storeId: { id: selectedCustomerId, storeId: store.id } }
    });
    
    if (selectedCustomer) {
      timelineLogs = await db.activityLog.findMany({
        where: { storeId: store.id, customerId: selectedCustomerId },
        include: { rule: true },
        orderBy: { createdAt: "desc" }
      });
    }
  }

  return { customers, selectedCustomer, timelineLogs, searchQ };
};

export default function Timeline() {
  const { customers, selectedCustomer, timelineLogs, searchQ } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState(searchQ);

  const handleSearchChange = (val: string) => {
    setSearchValue(val);
    if (!val) {
      const url = new URL(window.location.href);
      url.searchParams.delete("q");
      navigate(url.pathname + url.search);
    }
  };

  const submitSearch = () => {
    const url = new URL(window.location.href);
    if (searchValue) url.searchParams.set("q", searchValue);
    else url.searchParams.delete("q");
    navigate(url.pathname + url.search);
  };

  const selectCustomer = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("customerId", id);
    navigate(url.pathname + url.search);
  };

  const getLogIconDetails = (action: string) => {
    if (action === "TAG_ADDED") return { icon: CheckIcon, tone: "success", color: "#10b981", bg: "#d1fae5" };
    if (action === "TAG_REMOVED") return { icon: XIcon, tone: "critical", color: "#ef4444", bg: "#fee2e2" };
    if (action === "EMAIL_SENT") return { icon: EmailIcon, tone: "magic", color: "#8b5cf6", bg: "#ede9fe" };
    return { icon: ChartVerticalIcon, tone: "base", color: "#6b7280", bg: "#f3f4f6" };
  };

  return (
    <Page title="Customer Timeline Explorer" subtitle="See exactly why AI applied or removed a tag from any customer.">
      <style>{`
        .timeline-container { position: relative; padding-left: 2rem; margin-top: 1rem; }
        .timeline-line { position: absolute; left: 0.8rem; top: 0; bottom: 0; width: 2px; background: #e5e7eb; }
        .timeline-node { position: relative; margin-bottom: 2rem; }
        .timeline-icon-wrapper { 
          position: absolute; left: -2rem; top: 0; width: 1.8rem; height: 1.8rem; 
          border-radius: 50%; display: flex; align-items: center; justify-content: center;
          border: 2px solid white; box-shadow: 0 0 0 4px white; z-index: 2;
        }
      `}</style>
      
      <Layout>
        {/* Left Column: Search & Customer List */}
        <Layout.Section variant="oneThird">
          <Card padding="400">
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Find Customer</Text>
              
              <InlineStack gap="200" blockAlign="center" wrap={false}>
                <div style={{ flex: 1 }}>
                  <TextField 
                    label="" 
                    labelHidden 
                    value={searchValue} 
                    onChange={handleSearchChange} 
                    placeholder="Email or name..." 
                    autoComplete="off" 
                    prefix={<Icon source={SearchIcon} />}
                    onBlur={submitSearch}
                  />
                </div>
                <Button onClick={submitSearch}>Search</Button>
              </InlineStack>

              <Divider />
              
              <BlockStack gap="200">
                <Text as="h3" variant="bodySm" tone="subdued">Recent & Matching Customers</Text>
                {customers.length === 0 ? (
                  <Text as="p" tone="subdued">No customers found.</Text>
                ) : (
                  customers.map(c => {
                    const isSelected = selectedCustomer?.id === c.id;
                    const name = c.firstName ? `${c.firstName} ${c.lastName || ""}` : "Guest User";
                    const initials = c.firstName ? c.firstName.charAt(0).toUpperCase() : "?";
                    
                    return (
                      <div 
                        key={c.id}
                        onClick={() => selectCustomer(c.id)}
                        style={{ 
                          padding: "12px", borderRadius: "8px", 
                          background: isSelected ? "var(--p-color-bg-surface-secondary-active)" : "var(--p-color-bg-surface)",
                          border: isSelected ? "1px solid var(--p-color-border-magic)" : "1px solid var(--p-color-border)",
                          cursor: "pointer", transition: "all 0.2s"
                        }}
                      >
                        <InlineStack gap="300" blockAlign="center" wrap={false}>
                          <Avatar initials={initials} customer name={name} />
                          <BlockStack gap="0">
                            <Text as="p" fontWeight={isSelected ? "bold" : "regular"}>{name}</Text>
                            <Text as="p" variant="bodySm" tone="subdued">{c.email || c.id}</Text>
                          </BlockStack>
                        </InlineStack>
                      </div>
                    );
                  })
                )}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Right Column: Timeline Visualizer */}
        <Layout.Section>
          <Card padding="500">
            {!selectedCustomer ? (
              <EmptyState
                heading="Select a customer to view their timeline"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Search for a specific customer or pick one from the list to see every interaction TagBot AI has logged for them over time.</p>
              </EmptyState>
            ) : (
              <BlockStack gap="500">
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="200">
                    <Text variant="headingLg" as="h1">
                      {selectedCustomer.firstName ? `${selectedCustomer.firstName} ${selectedCustomer.lastName || ""}` : "Guest User"}
                    </Text>
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={EmailIcon} tone="subdued" />
                      <Text as="span" tone="subdued">{selectedCustomer.email || "No email"}</Text>
                    </InlineStack>
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" tone="subdued">Total Spent: ${selectedCustomer.totalSpent.toFixed(2)} • Orders: {selectedCustomer.orderCount}</Text>
                    </InlineStack>
                  </BlockStack>
                  
                  <BlockStack gap="100" inlineAlign="end">
                    <Text variant="headingSm" as="h3">Current Tags</Text>
                    <InlineStack gap="100" wrap>
                      {selectedCustomer.tags ? selectedCustomer.tags.split(",").map(t => (
                        <Badge tone="magic" key={t.trim()}>{t.trim()}</Badge>
                      )) : <Text as="span" tone="subdued">None</Text>}
                    </InlineStack>
                  </BlockStack>
                </InlineStack>

                <Divider />

                <Text variant="headingMd" as="h2">AI History Log</Text>
                
                {timelineLogs.length === 0 ? (
                  <Box padding="400">
                    <Text as="p" tone="subdued">No AI tag history recorded for this customer yet.</Text>
                  </Box>
                ) : (
                  <div className="timeline-container">
                    <div className="timeline-line"></div>
                    
                    {timelineLogs.map((log: any) => {
                      const details = getLogIconDetails(log.action);
                      const isAdded = log.action === "TAG_ADDED";
                      
                      return (
                        <div key={log.id} className="timeline-node">
                          <div className="timeline-icon-wrapper" style={{ background: details.bg, color: details.color }}>
                            <Icon source={details.icon as any} />
                          </div>
                          
                          <Card roundedAbove="sm" background="bg-surface-secondary">
                            <Box padding="300">
                              <BlockStack gap="200">
                                <InlineStack align="space-between" blockAlign="center">
                                  <InlineStack gap="200" blockAlign="center">
                                    <Badge tone={isAdded ? "success" : "critical"}>
                                      {isAdded ? "Tag Added" : log.action === "TAG_REMOVED" ? "Tag Removed" : "Event"}
                                    </Badge>
                                    <Badge tone="magic">{log.tagContext}</Badge>
                                  </InlineStack>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    {new Date(log.createdAt).toLocaleString(undefined, { 
                                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                    })}
                                  </Text>
                                </InlineStack>
                                
                                <BlockStack gap="100">
                                  <Text as="span" variant="bodySm" fontWeight="bold">AI Reasoning:</Text>
                                  <Text variant="bodyMd" as="p">
                                    {log.reason || "Automatic threshold triggered."}
                                  </Text>
                                  {log.rule && (
                                    <Text variant="bodySm" tone="subdued" as="p">
                                      Rule triggered: {log.rule.name}
                                    </Text>
                                  )}
                                </BlockStack>
                              </BlockStack>
                            </Box>
                          </Card>
                        </div>
                      );
                    })}
                  </div>
                )}
              </BlockStack>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers = (headersArgs: any) => boundary.headers(headersArgs);
