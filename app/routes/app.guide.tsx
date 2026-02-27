import { Page, Layout, Card, Text, BlockStack, List, Icon, InlineStack, Badge, Box } from "@shopify/polaris";
import { CheckCircleIcon, PlayCircleIcon } from "@shopify/polaris-icons";

export default function FeaturesGuide() {
    return (
        <Page
            title="Features & Testing Guide"
            subtitle="A comprehensive list of all TagBot AI features and how to test them."
            backAction={{ content: "Dashboard", url: "/app" }}
        >
            <Layout>
                <Layout.Section>
                    <BlockStack gap="500">

                        {/* ─── Existing Features ─────────────────────────── */}

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
                                    Actively monitor the database for High-Value customers who have suddenly stopped buying (no orders in 60+ days).
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Create a test customer in Shopify with more than 3 orders, but with their last order date older than 60 days.</List.Item>
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
                                    Generates a unique, single-use 20% off discount code tied to a customer's account when they unlock a VIP tag.
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Create a rule targeting the exact tag `VIP` or `High Spender`.</List.Item>
                                        <List.Item>Trigger this rule via a qualifying order or "Sync Customers".</List.Item>
                                        <List.Item>Check the Activity Log table to see a "DISCOUNT_SENT" entry.</List.Item>
                                        <List.Item>Go to Shopify Admin → Discounts. You should see a newly generated "VIP-[RANDOM]" code.</List.Item>
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
                                    Appends a timestamped note to the customer's Shopify profile explaining exactly why they were tagged.
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Go to <strong>Settings</strong> and enable "Sync Tags to Customer Notes".</List.Item>
                                        <List.Item>Trigger a tag via Sync Customers or a new order.</List.Item>
                                        <List.Item>Open that customer's profile in Shopify Admin and check the Note field — a TagBot AI timestamped entry should appear.</List.Item>
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
                                    An owner-only dashboard to manage all stores, override subscription plans, and configure pricing.
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Open a new tab and navigate to: <code>https://[your-url]/super-admin</code></List.Item>
                                        <List.Item>Log in with password: <strong>admin123</strong></List.Item>
                                        <List.Item>Test the <strong>Pricing Configuration</strong> card — change the yearly discount % and click Save Pricing. Then open the Plans page as a merchant to see the updated price.</List.Item>
                                        <List.Item>Test plan overrides by clicking "Set Pro" or "Set Elite" for your store.</List.Item>
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
                                    Target customers based on the specific Shopify collections they purchase from.
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Requires Growth plan or higher.</List.Item>
                                        <List.Item>Go to <strong>Rules → Create Rule</strong> and change Rule Type to "Collection Purchase".</List.Item>
                                        <List.Item>Enter a valid Shopify Collection ID and assign a target tag (e.g., "Summer-Spender").</List.Item>
                                        <List.Item>Place a dummy order with a product from that collection and verify the tag applies.</List.Item>
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
                                    Sync TagBot AI segments in real-time to external email providers to trigger automated marketing flows.
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Requires Elite plan.</List.Item>
                                        <List.Item>Go to <strong>Integrations</strong> and input a test API Key for Klaviyo or Mailchimp.</List.Item>
                                        <List.Item>Trigger an existing rule via "Sync Customers".</List.Item>
                                        <List.Item>Check Vercel logs for the <code>[MARKETING SYNC]</code> output confirming the dispatch payload.</List.Item>
                                    </List>
                                </Box>
                            </BlockStack>
                        </Card>

                        <Card>
                            <BlockStack gap="400">
                                <InlineStack gap="200" align="start" blockAlign="center">
                                    <Icon source={CheckCircleIcon} tone="success" />
                                    <Text variant="headingMd" as="h2">11. AI Natural Language Rule Engine (Magic Creator)</Text>
                                </InlineStack>
                                <Text as="p">
                                    Describe a rule in plain English and let the AI auto-configure the full rule structure for you.
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Go to <strong>Rules → Create Rule</strong> and find the AI text bar.</List.Item>
                                        <List.Item>Try: <code>Tag people who have spent more than $500 as VIP</code></List.Item>
                                        <List.Item>Try: <code>Find customers who haven't ordered in the last 90 days and tag them as At-Risk</code></List.Item>
                                        <List.Item>Try: <code>Tag anyone with a .edu email address as Student</code></List.Item>
                                        <List.Item>Observe the form fields auto-populate and save the rule.</List.Item>
                                    </List>
                                </Box>
                            </BlockStack>
                        </Card>

                        <Card>
                            <BlockStack gap="400">
                                <InlineStack gap="200" align="start" blockAlign="center">
                                    <Icon source={CheckCircleIcon} tone="success" />
                                    <Text variant="headingMd" as="h2">12. Monthly / Yearly Billing Toggle</Text>
                                </InlineStack>
                                <Text as="p">
                                    Merchants can switch between monthly and yearly billing on the Plans page. Yearly subscribers receive a configurable discount (default 15% off).
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Go to <strong>Plans</strong> in the navigation.</List.Item>
                                        <List.Item>Click the <strong>Yearly</strong> toggle. Observe the pricing cards update to show: annual price, strikethrough monthly total, "15% off" badge, and monthly equivalent.</List.Item>
                                        <List.Item>Open the Super Admin dashboard (<code>/super-admin</code>) → Pricing Configuration card.</List.Item>
                                        <List.Item>Change the Yearly Discount to 20% and click Save. Reload the Plans page and verify the savings badge now reads "20% off".</List.Item>
                                    </List>
                                </Box>
                            </BlockStack>
                        </Card>

                        {/* ─── NEW MODULES ────────────────────────────────── */}

                        <Card background="bg-surface-magic">
                            <BlockStack gap="400">
                                <InlineStack gap="200" align="start" blockAlign="center">
                                    <Icon source={PlayCircleIcon} tone="magic" />
                                    <Text variant="headingMd" as="h2">13. Revenue ROI Dashboard</Text>
                                    {/* @ts-ignore */}
                                    <Badge tone="magic">New</Badge>
                                </InlineStack>
                                <Text as="p">
                                    Shows which tag segments generate the most revenue — calculated from your locally synced customer lifetime spend data with inline bar charts.
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Click <strong>Revenue ROI</strong> in the left sidebar.</List.Item>
                                        <List.Item>Check the three KPI cards: Total Revenue, Top Segment, and total unique tag count.</List.Item>
                                        <List.Item>Review the "Revenue by Tag Segment" table. The bar chart fills proportionally — the top tag is always 100% wide; others scale down.</List.Item>
                                        <List.Item>Verify: <em>Revenue Share %</em> across all segments should add up to roughly 100% (customers with multiple tags are counted in each).</List.Item>
                                        <List.Item>If you see no data, run a <strong>Sync Customers</strong> from the Home Dashboard first to populate local customer records.</List.Item>
                                    </List>
                                </Box>
                                <Text as="p" tone="subdued" variant="bodySm">⚠️ Requires Growth plan or higher. Reads from locally synced Customer data — no extra Shopify API calls made.</Text>
                            </BlockStack>
                        </Card>

                        <Card background="bg-surface-magic">
                            <BlockStack gap="400">
                                <InlineStack gap="200" align="start" blockAlign="center">
                                    <Icon source={PlayCircleIcon} tone="magic" />
                                    <Text variant="headingMd" as="h2">14. Predictive Segmentation</Text>
                                    {/* @ts-ignore */}
                                    <Badge tone="magic">New</Badge>
                                </InlineStack>
                                <Text as="p">
                                    Auto-labels customers as <strong>VIP</strong> or <strong>At-Risk</strong> using deterministic purchase behavior rules — no manual rule setup needed.
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">Scoring Rules:</Text>
                                    <List>
                                        <List.Item><strong>VIP</strong>: ≥ 3 orders AND ≥ $200 lifetime spend AND ordered within 60 days</List.Item>
                                        <List.Item><strong>At-Risk</strong>: ≥ 2 orders AND last order was &gt; 90 days ago</List.Item>
                                        <List.Item>Already-tagged customers are skipped (zero duplicate writes)</List.Item>
                                        <List.Item>VIPs who no longer qualify are automatically demoted</List.Item>
                                    </List>
                                </Box>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Click <strong>Predictive</strong> in the left sidebar.</List.Item>
                                        <List.Item>Read the stat cards — they show current VIP/At-Risk counts AND how many <em>new candidates</em> are ready to be tagged if you run now.</List.Item>
                                        <List.Item>Click <strong>Run Predictive Segmentation</strong>. A progress bar appears while processing.</List.Item>
                                        <List.Item>When done, a green banner shows: how many tagged VIP, how many tagged At-Risk, and how long it took in milliseconds.</List.Item>
                                        <List.Item>Go to Shopify Admin → Customers → filter by tag "VIP" or "At-Risk" to confirm the tags were applied correctly.</List.Item>
                                        <List.Item>Run again immediately — the candidate counts should now be 0 (idempotent run).</List.Item>
                                    </List>
                                </Box>
                                <Text as="p" tone="subdued" variant="bodySm">⚠️ Requires Growth plan or higher. Processes all customers synchronously.</Text>
                            </BlockStack>
                        </Card>

                        <Card background="bg-surface-magic">
                            <BlockStack gap="400">
                                <InlineStack gap="200" align="start" blockAlign="center">
                                    <Icon source={PlayCircleIcon} tone="magic" />
                                    <Text variant="headingMd" as="h2">15. Action-based Workflows</Text>
                                    {/* @ts-ignore */}
                                    <Badge tone="magic">New</Badge>
                                </InlineStack>
                                <Text as="p">
                                    Trigger automated post-tag actions whenever a specific tag is added or removed. Supports Webhook POST, Structured Log, and Email Prep.
                                </Text>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">Action Types:</Text>
                                    <List>
                                        <List.Item><strong>WEBHOOK</strong>: POSTs a JSON event to any external URL (CRM, Zapier, Slack, n8n) within a 5-second timeout</List.Item>
                                        <List.Item><strong>LOG</strong>: Writes a structured JSON entry to Vercel function logs for auditing</List.Item>
                                        <List.Item><strong>EMAIL_PREP</strong>: Creates an <code>ActivityLog</code> record (<code>WORKFLOW_EMAIL_PREP</code>) your email tool can query</List.Item>
                                    </List>
                                </Box>
                                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                    <Text variant="headingSm" as="h3">How to Test:</Text>
                                    <List type="number">
                                        <List.Item>Click <strong>Workflows</strong> in the left sidebar.</List.Item>
                                        <List.Item>Create a new workflow:
                                            <List>
                                                <List.Item>Name: <code>Test Log on VIP</code></List.Item>
                                                <List.Item>Trigger Tag: <code>VIP</code></List.Item>
                                                <List.Item>Trigger On: <code>When tag is ADDED</code></List.Item>
                                                <List.Item>Action Type: <code>LOG</code> (safest, no external URL needed)</List.Item>
                                            </List>
                                        </List.Item>
                                        <List.Item>Click <strong>Create Workflow</strong> — it appears in the Active Workflows list below.</List.Item>
                                        <List.Item>Now trigger a VIP tag: run Predictive Segmentation (step 14 above), or sync with an existing VIP rule.</List.Item>
                                        <List.Item>Open <strong>Vercel Dashboard → Functions → Logs</strong> and search for <code>WORKFLOW_LOG</code> — you should see a JSON object with storeId, customerId, and tag.</List.Item>
                                        <List.Item><strong>Webhook test</strong>: Go to <a href="https://webhook.site" target="_blank" rel="noreferrer">webhook.site</a>, copy your unique URL, create a WEBHOOK workflow with that URL, trigger a tag, and confirm the request arrives at webhook.site in real time.</List.Item>
                                        <List.Item>Test the <strong>Pause</strong> button — a paused workflow should be skipped even when its tag fires (verify by checking logs: no <code>WORKFLOW_LOG</code> entry should appear).</List.Item>
                                    </List>
                                </Box>
                                <Text as="p" tone="subdued" variant="bodySm">⚠️ Requires Growth plan or higher. Workflows fire asynchronously — they never slow down the main tag pipeline.</Text>
                            </BlockStack>
                        </Card>

                    </BlockStack>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
