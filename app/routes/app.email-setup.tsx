import { Page, Layout, Card, BlockStack, Text, Button, InlineStack, Badge, Box, Divider, List, Icon, Banner } from "@shopify/polaris";
import { LinkIcon, EmailIcon, KeyIcon } from "@shopify/polaris-icons";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    return { title: "Email Automation Setup" };
};

export default function EmailSetupGuide() {
    return (
        <Page
            title="Email Automation Setup"
            subtitle="Configure your custom domain to unlock automated Welcome and Upgrade emails for your merchants."
            backAction={{ content: 'Dashboard', url: '/app' }}
        >
            <Layout>
                <Layout.Section>
                    <div className="premium-card">
                        <Box padding="500">
                            <BlockStack gap="500">
                                <div>
                                    <Text variant="headingXl" as="h2">Why set this up?</Text>
                                    <Box paddingBlockStart="200">
                                        <Text as="p" tone="subdued">
                                            When merchants install TagBot AI, building trust immediately is critical. 
                                            By setting up <strong>Resend</strong> with your custom domain (e.g., <Text as="span" fontWeight="bold">hello@tagbot.ai</Text>), 
                                            you can automatically dispatch professional welcome emails and automated upgrade sequences without them landing in the merchant's spam folder.
                                        </Text>
                                    </Box>
                                </div>

                                <Divider />

                                <div>
                                    <InlineStack gap="300" align="start" blockAlign="center">
                                        <div style={{ background: '#e3f1df', color: '#173630', width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', fontWeight: 'bold' }}>1</div>
                                        <BlockStack gap="200">
                                            <Text variant="headingLg" as="h3">Create a free Resend account</Text>
                                            <Text as="p">
                                                Go to <a href="https://resend.com" target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "underline" }}>Resend.com</a> and sign up for a free account. 
                                                Their generous free tier allows you to send up to 300 emails per day, which is more than enough for app rollouts.
                                            </Text>
                                        </BlockStack>
                                    </InlineStack>
                                </div>

                                <Divider />

                                <div>
                                    <InlineStack gap="300" align="start" blockAlign="center">
                                        <div style={{ background: '#e3f1df', color: '#173630', width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', fontWeight: 'bold' }}>2</div>
                                        <BlockStack gap="200">
                                            <Text variant="headingLg" as="h3">Add and Verify your Domain</Text>
                                            <Text as="p">
                                                In your Resend dashboard, navigate to the <strong>Domains</strong> sidebar menu and click <strong>Add Domain</strong>.
                                            </Text>
                                            <List type="bullet">
                                                <List.Item>Enter your domain (e.g., <Text as="span" fontWeight="bold">tagbot.ai</Text>).</List.Item>
                                                <List.Item>Resend will generate a set of DNS records (TXT and MX records).</List.Item>
                                                <List.Item>Log into your domain provider (GoDaddy, Namecheap, Vercel Domains, etc.) and add these records to your DNS settings.</List.Item>
                                                <List.Item>Click "Verify" in Resend. This usually takes just 2 minutes but can take up to 24 hours.</List.Item>
                                            </List>
                                        </BlockStack>
                                    </InlineStack>
                                </div>

                                <Divider />

                                <div>
                                    <InlineStack gap="300" align="start" blockAlign="center">
                                        <div style={{ background: '#e3f1df', color: '#173630', width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', fontWeight: 'bold' }}>3</div>
                                        <BlockStack gap="200">
                                            <Text variant="headingLg" as="h3">Generate an API Key</Text>
                                            <Text as="p">
                                                Once your domain is verified, go to the <strong>API Keys</strong> sidebar menu in Resend.
                                            </Text>
                                            <List type="bullet">
                                                <List.Item>Click <strong>Create API Key</strong>.</List.Item>
                                                <List.Item>Give it full access permissions.</List.Item>
                                                <List.Item>Copy the generated key (it starts with <Text as="span" fontWeight="bold">re_...</Text>).</List.Item>
                                            </List>
                                        </BlockStack>
                                    </InlineStack>
                                </div>

                                <Divider />

                                <div>
                                    <InlineStack gap="300" align="start" blockAlign="center">
                                        <div style={{ background: '#e3f1df', color: '#173630', width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', fontWeight: 'bold' }}>4</div>
                                        <BlockStack gap="200">
                                            <Text variant="headingLg" as="h3">Add the Key to Vercel</Text>
                                            <Text as="p">
                                                This is the final step to activate the automation engine in your app.
                                            </Text>
                                            <List type="bullet">
                                                <List.Item>Log into your Vercel Dashboard and open your TagBot AI project.</List.Item>
                                                <List.Item>Go to <strong>Settings</strong> &gt; <strong>Environment Variables</strong>.</List.Item>
                                                <List.Item>Create a new variable named <Text as="span" fontWeight="bold">RESEND_API_KEY</Text>.</List.Item>
                                                <List.Item>Paste your API key as the value and hit Save.</List.Item>
                                                <List.Item>Redeploy your Vercel project for the changes to take effect.</List.Item>
                                            </List>
                                        </BlockStack>
                                    </InlineStack>
                                </div>

                                <Box paddingBlockStart="400">
                                    <Banner tone="info">
                                        Once these steps are completed, your automated Welcome and Upgrade sequence emails will automatically begin dispatching via our background CRON job and App Webhooks.
                                    </Banner>
                                </Box>

                            </BlockStack>
                        </Box>
                    </div>
                </Layout.Section>

                <Layout.Section variant="oneThird">
                    <Card>
                        <BlockStack gap="400">
                            <Text variant="headingMd" as="h3">Active Flows</Text>
                            <Box paddingBlockEnd="200">
                                <Text as="p" tone="subdued">
                                    The following emails are configured to run automatically once Resend is connected.
                                </Text>
                            </Box>
                            
                            <BlockStack gap="300">
                                <InlineStack gap="300" wrap={false} blockAlign="start">
                                    <Box>
                                        <Icon source={EmailIcon} tone="base" />
                                    </Box>
                                    <BlockStack gap="100">
                                        <Text as="p" fontWeight="bold">The Welcome Email</Text>
                                        <Text as="p" tone="subdued">Fires instantly upon app installation via the Shopify App Uninstalled Webhook (afterAuth).</Text>
                                        <Badge tone="success">Active</Badge>
                                    </BlockStack>
                                </InlineStack>
                                
                                <Divider />

                                <InlineStack gap="300" wrap={false} blockAlign="start">
                                    <Box>
                                        <Icon source={EmailIcon} tone="base" />
                                    </Box>
                                    <BlockStack gap="100">
                                        <Text as="p" fontWeight="bold">The 7-Day Upgrade Prompt</Text>
                                        <Text as="p" tone="subdued">Fires 7 days exactly after install, asking Free users why they haven't upgraded yet.</Text>
                                        <Badge tone="magic">Automated via Cron</Badge>
                                    </BlockStack>
                                </InlineStack>
                            </BlockStack>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
