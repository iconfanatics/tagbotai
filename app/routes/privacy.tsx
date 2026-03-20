import { Page, Layout, Card, Text, BlockStack } from "@shopify/polaris";
import shopify from "../shopify.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    return { title: "Privacy Policy" };
};

export default function PrivacyPolicy() {
    return (
        <div style={{ padding: "40px 20px", maxWidth: "800px", margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif" }}>
            <BlockStack gap="500">
                <Text variant="heading3xl" as="h1">Privacy Policy</Text>
                <Text as="p" tone="subdued">Last updated: March 7, 2026</Text>

                <div style={{ marginTop: "20px", lineHeight: "1.6", color: "#374151" }}>
                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "2rem", marginBottom: "1rem" }}>1. Introduction</h2>
                    <p>
                        Welcome to TagBot AI. This Privacy Policy outlines how TagBot AI ("we", "our", or "us") 
                        collects, uses, and shares information in connection with the operation of our Shopify application 
                        ("App"). By installing and using the App, you agree to the collection and use of your information 
                        as described in this policy.
                    </p>

                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "2rem", marginBottom: "1rem" }}>2. Information We Collect</h2>
                    <p>
                        When you install the App, we automatically access certain types of information from your Shopify account:
                    </p>
                    <ul style={{ paddingLeft: "20px", marginTop: "10px", marginBottom: "10px" }}>
                        <li><strong>Store Information:</strong> Your shop domain, store name, and email address for communication and billing.</li>
                        <li><strong>Customer Information:</strong> First name, last name, email addresses, order count, total spent, and existing Shopify tags. This is required for our AI segmentation engine to function.</li>
                        <li><strong>Order Information:</strong> Financial status, fulfillment status, tags, discount codes, shipping locations, and traffic sources (e.g., Facebook, TikTok) to process segmentation rules.</li>
                    </ul>

                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "2rem", marginBottom: "1rem" }}>3. How We Use Your Information</h2>
                    <p>
                        We use the collected information exclusively to provide the core functionality of the App:
                    </p>
                    <ul style={{ paddingLeft: "20px", marginTop: "10px", marginBottom: "10px" }}>
                        <li>To automatically evaluate rules and apply tags to your customers and orders.</li>
                        <li>To calculate Return on Investment (ROI) metrics based on segmented cohorts.</li>
                        <li>To predict at-risk and high-value customer clusters utilizing our AI engines.</li>
                        <li>To communicate critical app updates, support responses, and billing changes.</li>
                    </ul>

                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "2rem", marginBottom: "1rem" }}>4. Data Sharing and Retention</h2>
                    <p>
                        We do not sell, rent, or lease your data or your customers' data to third parties. Data is processed securely and is only retained for as long as you have the App installed.
                    </p>
                    <p style={{ marginTop: "10px" }}>
                        Upon uninstallation of the App, we comply with Shopify's data retention guidelines and will automatically purge all downloaded customer and order data from our active databases within 48 hours via mandated GDPR webhooks.
                    </p>

                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "2rem", marginBottom: "1rem" }}>5. GDPR and CCPA Compliance</h2>
                    <p>
                        We are fully compliant with the European General Data Protection Regulation (GDPR) and the California Consumer Privacy Act (CCPA). We support Shopify's mandatory webhooks for:
                    </p>
                    <ul style={{ paddingLeft: "20px", marginTop: "10px", marginBottom: "10px" }}>
                        <li><strong>Customer Data Requests:</strong> Providing your customers with all data we hold on them upon request.</li>
                        <li><strong>Customer Data Erasure:</strong> Permanently deleting specific customer data when requested by the merchant or Shopify.</li>
                        <li><strong>Shop Data Erasure:</strong> Deleting all merchant and associated customer data upon app uninstallation.</li>
                    </ul>

                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "2rem", marginBottom: "1rem" }}>6. Contact Us</h2>
                    <p>
                        If you have any questions about this Privacy Policy, please contact our support team at:
                        <br /><br />
                        <strong>Email:</strong> tagbotai@iconfanatics.com
                    </p>
                </div>
            </BlockStack>
        </div>
    );
}
