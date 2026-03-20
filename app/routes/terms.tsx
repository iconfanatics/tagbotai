import { Page, Layout, Card, Text, BlockStack } from "@shopify/polaris";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    return { title: "Terms of Service" };
};

export default function TermsOfService() {
    return (
        <div style={{ padding: "40px 20px", maxWidth: "800px", margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif" }}>
            <BlockStack gap="500">
                <Text variant="heading3xl" as="h1">Terms of Service</Text>
                <Text as="p" tone="subdued">Effective Date: March 7, 2026</Text>

                <div style={{ marginTop: "20px", lineHeight: "1.6", color: "#374151" }}>
                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "2rem", marginBottom: "1rem" }}>1. Acceptance of Terms</h2>
                    <p>
                        By downloading, installing, or using the TagBot AI Shopify Application ("App"), you agree to be bound by these Terms of Service. 
                        If you do not agree to these terms, you may not use the App. We reserve the right to update these terms at any time without prior notice.
                    </p>

                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "2rem", marginBottom: "1rem" }}>2. App Description & Functionality</h2>
                    <p>
                        TagBot AI provides automated customer and order segmentation services for Shopify merchants. 
                        We utilize historical store data to evaluate logic-based and AI-generated rules, applying tags to your store's resources. 
                        By using the App, you grant us permission to read your store's data and write tags to your Shopify admin via the official Shopify API.
                    </p>

                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "2rem", marginBottom: "1rem" }}>3. Subscription and Billing</h2>
                    <p>
                        Some features of the App are offered as premium subscription tiers (e.g., Pro, Elite). 
                        By selecting a premium plan, you agree to the recurring charges associated with that plan. 
                        All billing is handled seamlessly through the Shopify Billing API. 
                        Changes to your subscription, including cancellations, must be managed through your Shopify Admin portal.
                    </p>

                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "2rem", marginBottom: "1rem" }}>4. Data Usage and Privacy</h2>
                    <p>
                        Your privacy is important to us. We process your data in accordance with our <a href="/privacy" style={{ color: "#2563eb", textDecoration: "underline" }}>Privacy Policy</a>. 
                        TagBot AI strictly adheres to GDPR, CCPA, and Shopify's API Terms regarding data retention and erasure.
                    </p>

                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "2rem", marginBottom: "1rem" }}>5. Limitation of Liability</h2>
                    <p>
                        To the maximum extent permitted by applicable law, TagBot AI and its developers shall not be liable for any indirect, incidental, 
                        special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly. 
                        The App is provided "as is" and "as available" without any warranties of any kind. 
                        While we strive for accuracy in our AI tagging and revenue tracking, we do not guarantee the completeness or absolute reliability of the data presented.
                    </p>

                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "2rem", marginBottom: "1rem" }}>6. Service Modifications and Termination</h2>
                    <p>
                        We reserve the right to modify, suspend, or discontinue the App (or any part or content thereof) at any time with or without notice to you. 
                        You may terminate these Terms of Service at any time by uninstalling the App from your Shopify store.
                    </p>

                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "2rem", marginBottom: "1rem" }}>7. Contact Information</h2>
                    <p>
                        If you have any questions regarding these Terms of Service, please contact us at:
                        <br /><br />
                        <strong>Email:</strong> tagbotai@iconfanatics.com
                    </p>
                </div>
            </BlockStack>
        </div>
    );
}
