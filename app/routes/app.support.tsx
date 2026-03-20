import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useSubmit, useActionData, useNavigation, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { Page, Layout, Card, BlockStack, Text, FormLayout, TextField, Select, Button, Banner, Box, Icon, InlineStack } from "@shopify/polaris";
import { ChatIcon, EmailIcon } from "@shopify/polaris-icons";
import { getCachedStore } from "../services/cache.server";
import { sendEmail } from "../services/email.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    
    return { 
        shop: session.shop,
        // Since we don't store merchant emails in our DB directly, we let them fill it in
        storeEmail: ""
    };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();
    
    const subject = formData.get("subject") as string;
    const message = formData.get("message") as string;
    const contactEmail = formData.get("contactEmail") as string;

    if (!subject || !message || !contactEmail) {
        return { success: false, error: "Please fill out all fields." };
    }

    try {
        // Send email using our existing Resend integration
        await sendEmail(
            "tagbotai@iconfanatics.com", // Sent TO the app owner
            `[TagBot Support] ${subject} - ${session.shop}`,
            `
            <h2>New Support Request</h2>
            <p><strong>Shop:</strong> ${session.shop}</p>
            <p><strong>Contact Email:</strong> ${contactEmail}</p>
            <p><strong>Subject:</strong> ${subject}</p>
            <hr />
            <p><strong>Message:</strong></p>
            <p>${message.replace(/\\n/g, '<br/>')}</p>
            `
        );
        return { success: true, message: "Your support request has been sent! We will get back to you shortly." };
    } catch (error) {
        return { success: false, error: "Failed to send message. Please email tagbotai@iconfanatics.com directly." };
    }
};

export default function SupportPage() {
    const { shop, storeEmail } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();

    const isSubmitting = navigation.state === "submitting";

    const [subject, setSubject] = useState("Help with setting up rules");
    const [message, setMessage] = useState("");
    const [contactEmail, setContactEmail] = useState(storeEmail);

    const handleSubmit = () => {
        submit({ subject, message, contactEmail }, { method: "post" });
        if (actionData?.success) {
            setMessage("");
        }
    };

    const subjectOptions = [
        { label: "Help with setting up rules", value: "Help with setting up rules" },
        { label: "Billing or Subscription issue", value: "Billing or Subscription issue" },
        { label: "Feature request", value: "Feature request" },
        { label: "Bug report", value: "Bug report" },
        { label: "Other", value: "Other" },
    ];

    return (
        <Page
            title="Customer Support"
            subtitle="Need help? Send us a message and our team will get back to you within 24 hours."
        >
            <Layout>
                <Layout.Section>
                    {actionData?.success && (
                        <Box paddingBlockEnd="400">
                            <Banner tone="success" title={actionData.message} />
                        </Box>
                    )}
                    {actionData?.success === false && (
                        <Box paddingBlockEnd="400">
                            <Banner tone="critical" title={actionData.error} />
                        </Box>
                    )}

                    <div className="premium-card">
                        <Box padding="500">
                            <BlockStack gap="400">
                                <FormLayout>
                                    <TextField
                                        label="Your Contact Email"
                                        type="email"
                                        value={contactEmail}
                                        onChange={setContactEmail}
                                        autoComplete="email"
                                        helpText="We will reply to this email address."
                                    />
                                    
                                    <Select
                                        label="What do you need help with?"
                                        options={subjectOptions}
                                        value={subject}
                                        onChange={setSubject}
                                    />

                                    <TextField
                                        label="Message"
                                        value={message}
                                        onChange={setMessage}
                                        multiline={6}
                                        autoComplete="off"
                                        placeholder="Please describe your issue or question in detail..."
                                    />

                                    <Box paddingBlockStart="200">
                                        <div className="btn-premium">
                                            <Button size="large" icon={EmailIcon} onClick={handleSubmit} loading={isSubmitting} disabled={!message.trim() || !contactEmail.trim()}>
                                                Send Message
                                            </Button>
                                        </div>
                                    </Box>
                                </FormLayout>
                            </BlockStack>
                        </Box>
                    </div>
                </Layout.Section>
                
                <Layout.Section variant="oneThird">
                    <Card>
                        <BlockStack gap="400">
                            <Text variant="headingMd" as="h3">Other ways to connect</Text>
                            <Box paddingBlockEnd="200">
                                <Text as="p" tone="subdued">
                                    Our support operating hours are Monday to Friday, 9am - 5pm EST.
                                </Text>
                            </Box>
                            
                            <BlockStack gap="300">
                                <InlineStack gap="300" wrap={false} blockAlign="start">
                                    <Box>
                                        <Icon source={EmailIcon} tone="base" />
                                    </Box>
                                    <BlockStack gap="100">
                                        <Text as="p" fontWeight="bold">Email Support</Text>
                                        <Text as="p" tone="subdued">tagbotai@iconfanatics.com</Text>
                                    </BlockStack>
                                </InlineStack>
                                
                                <InlineStack gap="300" wrap={false} blockAlign="start">
                                    <Box>
                                        <Icon source={ChatIcon} tone="base" />
                                    </Box>
                                    <BlockStack gap="100">
                                        <Text as="p" fontWeight="bold">Live Chat</Text>
                                        <Text as="p" tone="subdued">Available on tagbotai.com</Text>
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
