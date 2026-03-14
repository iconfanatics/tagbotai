import { BlockStack, Text } from "@shopify/polaris";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    return { title: "Klaviyo Testing Instructions" };
};

export default function KlaviyoInstructions() {
    return (
        <div style={{ padding: "40px 20px", maxWidth: "800px", margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif" }}>
            <BlockStack gap="500">
                <Text variant="heading3xl" as="h1">Klaviyo Testing Instructions</Text>
                <Text as="p" tone="subdued">TagBot AI - Klaviyo OAuth Integration Review</Text>

                <div style={{ marginTop: "20px", lineHeight: "1.6", color: "#374151" }}>
                    <p>
                        This document provides the necessary details for the Klaviyo Ecosystem team to test and approve the TagBot AI integration.
                    </p>

                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "2rem", marginBottom: "1rem" }}>OAuth App Overview</h2>
                    <p>
                        TagBot AI is an intelligent customer segmentation platform for Shopify. It uses AI to evaluate customer behavior and automatically organizes them into segments (like "Frequent Buyers," "High Spenders," or "Churn Risk"). These segments are then synchronized in real-time to Klaviyo profile properties, enabling highly targeted email and SMS campaigns.
                    </p>

                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "2rem", marginBottom: "1rem" }}>Customer Workflow</h2>
                    <ol style={{ paddingLeft: "20px" }}>
                        <li><strong>Access the App:</strong> Open the TagBot AI app within the Shopify Admin.</li>
                        <li><strong>Navigate to Integrations:</strong> Click on the <strong>Integrations</strong> tab in the sidebar menu.</li>
                        <li><strong>Initiate Connection:</strong> In the Klaviyo section, click the <strong>"Connect Klaviyo"</strong> button.</li>
                        <li><strong>Authorize Access:</strong> You will be redirected to a secure Klaviyo authorization page. Review the requested scopes (<code>accounts:read</code>, <code>profiles:read</code>, <code>profiles:write</code>) and click <strong>"Allow"</strong>.</li>
                        <li><strong>Verify Status:</strong> Upon successful redirect, the status in TagBot AI will show as <strong>"Active"</strong>.</li>
                        <li><strong>Automatic Syncing:</strong> Any active rules in TagBot AI will now automatically push those tags to the corresponding Klaviyo profiles.</li>
                        <li><strong>Bulk Sync (Optional):</strong> Click <strong>"Bulk Sync Historical Data"</strong> to push segment tags for all existing customers to your Klaviyo account.</li>
                    </ol>

                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "2rem", marginBottom: "1rem" }}>Integration Details</h2>
                    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
                        <thead>
                            <tr style={{ backgroundColor: "#f9fafb", textAlign: "left" }}>
                                <th style={{ padding: "12px", border: "1px solid #e5e7eb" }}>Use Case</th>
                                <th style={{ padding: "12px", border: "1px solid #e5e7eb" }}>Endpoint(s)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style={{ padding: "12px", border: "1px solid #e5e7eb" }}>Real-time Profile Update</td>
                                <td style={{ padding: "12px", border: "1px solid #e5e7eb" }}><code>POST /api/profile-import/</code></td>
                            </tr>
                            <tr>
                                <td style={{ padding: "12px", border: "1px solid #e5e7eb" }}>Token Exchange</td>
                                <td style={{ padding: "12px", border: "1px solid #e5e7eb" }}><code>POST /oauth/token</code></td>
                            </tr>
                        </tbody>
                    </table>

                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "2rem", marginBottom: "1rem" }}>Testing Details</h2>
                    <p>
                        To test the end-to-end flow, please use a test Shopify store with the TagBot AI app installed.
                    </p>
                    <ul style={{ paddingLeft: "20px" }}>
                        <li><strong>Install URL:</strong> <code>https://tagbotai.vercel.app/app/integrations/klaviyo/install</code> (Starts the OAuth flow automatically)</li>
                        <li><strong>Support:</strong> For help with the setup, please contact support@tagbot.ai.</li>
                    </ul>
                </div>
            </BlockStack>
        </div>
    );
}
