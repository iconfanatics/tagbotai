import { Page, Layout, Card, Text, BlockStack, List, Icon, InlineStack, Badge, Box } from "@shopify/polaris";
import { CheckCircleIcon, PlayCircleIcon } from "@shopify/polaris-icons";

export default function FeaturesGuide() {
    return (
        <Page
            title="Features & Testing Guide"
            subtitle="A comprehensive list of all TagBot AI features and how to test them."
        >
            <Layout>
                <Layout.Section>
                    <BlockStack gap="500">
                        <Card>
                            <BlockStack gap="400">
                                <InlineStack gap="200" align="start" blockAlign="center">
                                    <Icon source={CheckCircleIcon} tone="success" />
                                    <Text variant="headingMd" as="h2">1. Smart Rule Builder & Auto-Tagging</Text>
                                </InlineStack>
                                <Text as="p">
                                    The core engine allows you to define custom logic to automatically apply or remove tags on customers when they place orders.
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Go to the <strong>Rules</strong> tab and click "Create Rule".</List.Item>
                                        <List.Item>Set a condition based on Customer Metrics (e.g., Total Amount Spent &gt; 50) and assign a target tag (e.g., "TEST_TAG").</List.Item>
                                        <List.Item>Place a real or draft order on your Shopify store that meets the condition.</List.Item>
                                        <List.Item>Check the Customer profile in Shopify to see if the tag was automatically applied.</List.Item>
                                    </List>
                                </Box>
                            </BlockStack>
                        </Card>

                        <Card>
                            <BlockStack gap="400">
                                <InlineStack gap="200" align="start" blockAlign="center">
                                    <Icon source={CheckCircleIcon} tone="success" />
                                    <Text variant="headingMd" as="h2">2. Pre-Built Automation Templates</Text>
                                </InlineStack>
                                <Text as="p">
                                    Instead of manually configuring logic, you can use one of our four 1-click presets (Big Spenders, Loyalists, Window Shoppers, At-Risk).
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>In the Rule Builder, click on any of the preset cards at the top.</List.Item>
                                        <List.Item>Observe how the form fields (Metric, Operator, Value, Target Tag) auto-populate.</List.Item>
                                        <List.Item>Save the rule and go to the Home dashboard to click "Sync Customers" to evaluate it against past data.</List.Item>
                                    </List>
                                </Box>
                            </BlockStack>
                        </Card>

                        <Card>
                            <BlockStack gap="400">
                                <InlineStack gap="200" align="start" blockAlign="center">
                                    <Icon source={CheckCircleIcon} tone="success" />
                                    <Text variant="headingMd" as="h2">3. Historical Data Sync</Text>
                                </InlineStack>
                                <Text as="p">
                                    Retroactively apply newly created rules to your existing Shopify customer base without waiting for new orders.
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Create a new rule (e.g., Target Tag: "Retro-VIP").</List.Item>
                                        <List.Item>Go to the Home Dashboard and click the <strong>Sync Customers</strong> button.</List.Item>
                                        <List.Item>Check the "Recent Activity" table at the bottom of the dashboard to see the log of historically processed tags.</List.Item>
                                    </List>
                                </Box>
                            </BlockStack>
                        </Card>

                        <Card>
                            <BlockStack gap="400">
                                <InlineStack gap="200" align="start" blockAlign="center">
                                    <Icon source={CheckCircleIcon} tone="success" />
                                    <Text variant="headingMd" as="h2">4. Direct Segment Export (CSV)</Text>
                                </InlineStack>
                                <Text as="p">
                                    Generate targeted CSV downloads for marketing campaigns directly based on segments and automation rules.
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Make sure you are subscribed to the Pro or Elite plan (Test via Super Admin if needed).</List.Item>
                                        <List.Item>On the Home Dashboard, click the <strong>Export CSV</strong> dropdown and choose "Active VIPs".</List.Item>
                                        <List.Item>A CSV file named `segment-tag-VIP-[DATE].csv` should automatically download.</List.Item>
                                        <List.Item>Also try exporting directly from a specific rule on the <strong>Rules</strong> tab.</List.Item>
                                    </List>
                                </Box>
                            </BlockStack>
                        </Card>

                        <Card>
                            <BlockStack gap="400">
                                <InlineStack gap="200" align="start" blockAlign="center">
                                    <Icon source={CheckCircleIcon} tone="success" />
                                    <Text variant="headingMd" as="h2">5. AI Retention Alerts (High-Value Churn Prediction)</Text>
                                </InlineStack>
                                <Text as="p">
                                    Actively monitor the database for High-Value customers (users with &gt; 3 orders) who have suddenly stopped buying (no orders in 60+ days).
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Create a test customer in Shopify with more than 3 orders, but artificially set their last order date to older than 60 days (or wait for the DB to populate using Sync).</List.Item>
                                        <List.Item>Check the Home Dashboard for the Red "Retention Alerts" widget.</List.Item>
                                        <List.Item>Click the <strong>Send Win-back Offer</strong> button on one of the rows.</List.Item>
                                        <List.Item>Check the Activity Log table to see the simulated "EMAIL_SENT" event.</List.Item>
                                    </List>
                                </Box>
                            </BlockStack>
                        </Card>

                        <Card>
                            <BlockStack gap="400">
                                <InlineStack gap="200" align="start" blockAlign="center">
                                    <Icon source={CheckCircleIcon} tone="success" />
                                    <Text variant="headingMd" as="h2">6. Automated VIP Discount Generation</Text>
                                </InlineStack>
                                <Text as="p">
                                    Talks directly to Shopify to generate a unique, single-use 20% off discount code specifically tied to a customer's account when they unlock a VIP tag.
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Create a rule targeting the exact tag `VIP` or `High Spender`.</List.Item>
                                        <List.Item>Trigger this rule for a customer (either via placing a matching order or using the "Sync Customers" button).</List.Item>
                                        <List.Item>Check the Activity Log table to see a "DISCOUNT_SENT" entry.</List.Item>
                                        <List.Item>Login to your Shopify Admin and go to Discounts. You should see a newly generated "VIP-[RANDOM]" code assigned to that specific customer email.</List.Item>
                                    </List>
                                </Box>
                            </BlockStack>
                        </Card>

                        <Card>
                            <BlockStack gap="400">
                                <InlineStack gap="200" align="start" blockAlign="center">
                                    <Icon source={CheckCircleIcon} tone="success" />
                                    <Text variant="headingMd" as="h2">7. Automated Customer Note Sync</Text>
                                </InlineStack>
                                <Text as="p">
                                    Safe appends of a timestamped note to the bottom of the customer's Shopify profile explaining exactly why they were tagged by the AI.
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Go to the <strong>Settings</strong> tab and check the "Sync Tags to Customer Notes" option.</List.Item>
                                        <List.Item>Trigger an automation that adds a tag to a customer (e.g., via the "Sync Customers" button or a new order).</List.Item>
                                        <List.Item>Open that Customer's profile in the native Shopify Admin.</List.Item>
                                        <List.Item>Look at the Customer "Note" field on the right sidebar. You should see a new timestamped log from TagBot AI appended to it.</List.Item>
                                    </List>
                                </Box>
                            </BlockStack>
                        </Card>

                        <Card>
                            <BlockStack gap="400">
                                <InlineStack gap="200" align="start" blockAlign="center">
                                    <Icon source={CheckCircleIcon} tone="success" />
                                    <Text variant="headingMd" as="h2">8. Super Admin Dashboard</Text>
                                </InlineStack>
                                <Text as="p">
                                    An isolated, owner-only dashboard to overlook and manually manage the entire SaaS ecosystem, bypassing the Shopify Admin iframe.
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Open a new browser tab and navigate manually to the root URL of your app, appending `/super-admin` (e.g., `https://[your-url]/super-admin`).</List.Item>
                                        <List.Item>Log in using the default password: <strong>admin123</strong>.</List.Item>
                                        <List.Item>Review the Global KPIs (Total Revenue, Global Churn Risk).</List.Item>
                                        <List.Item>Test overriding a store's subscription plan directly from the Super Admin panel by clicking "Set Pro" or "Set Elite", then verify the changes reflect inside the Shopify Admin app environment.</List.Item>
                                    </List>
                                </Box>
                            </BlockStack>
                        </Card>

                        <Card>
                            <BlockStack gap="400">
                                <InlineStack gap="200" align="start" blockAlign="center">
                                    <Icon source={CheckCircleIcon} tone="success" />
                                    <Text variant="headingMd" as="h2">9. Collection-Specific Rules</Text>
                                </InlineStack>
                                <Text as="p">
                                    Target customers based on the specific collections they purchase from. If an order contains a product from the targeted collection, the customer gets tagged.
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Make sure you are subscribed to the Growth, Pro, or Elite plan.</List.Item>
                                        <List.Item>Go to the <strong>Rules</strong> tab and click "Create Rule".</List.Item>
                                        <List.Item>Change the Rule Type to "Collection Purchase".</List.Item>
                                        <List.Item>Enter a valid Shopify Collection ID from your store along with its Name, and assign a target Tag (e.g., "Summer-Spender").</List.Item>
                                        <List.Item>Place a dummy order containing a product explicitly from that collection to verify the tag applies.</List.Item>
                                    </List>
                                </Box>
                            </BlockStack>
                        </Card>

                        <Card>
                            <BlockStack gap="400">
                                <InlineStack gap="200" align="start" blockAlign="center">
                                    <Icon source={CheckCircleIcon} tone="success" />
                                    <Text variant="headingMd" as="h2">10. Marketing Integrations (Klaviyo & Mailchimp)</Text>
                                </InlineStack>
                                <Text as="p">
                                    Sync your TagBot AI segments in real-time to external email providers to trigger automated marketing flows.
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Make sure you are subscribed to the Elite plan.</List.Item>
                                        <List.Item>Go to the <strong>Integrations</strong> tab.</List.Item>
                                        <List.Item>Input a fake API Key (e.g., "pk_test_123" for Klaviyo or "test-us14" / "8d3a1fb" for Mailchimp) and click Save.</List.Item>
                                        <List.Item>Either place a new valid order, or click "Sync Customers" on the Home Dashboard to trigger an existing rule.</List.Item>
                                        <List.Item>Check the server terminal logs (`npm run dev`) to observe the `[MARKETING SYNC]` output detailing the outgoing dispatch payload to the configured platform.</List.Item>
                                    </List>
                                </Box>
                            </BlockStack>
                        </Card>

                    </BlockStack>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
