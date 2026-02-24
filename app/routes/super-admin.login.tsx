import { useNavigation, useActionData } from "react-router";
import { ActionFunctionArgs, redirect } from "react-router";
import { Page, Layout, Card, Text, BlockStack, TextField, Banner } from "@shopify/polaris";
import { useState } from "react";
import { getAdminSession, adminSessionStorage } from "../adminSession.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const formData = await request.formData();
    const password = formData.get("password") as string;

    // Log for debugging
    console.log("[LOGIN ACTION] Received password attempt.");

    const MASTER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || "tagbotadmin";

    if (password === MASTER_PASSWORD) {
        const session = await getAdminSession(request);
        session.set("adminId", "super_admin_logged_in");

        return redirect("/super-admin", {
            headers: {
                "Set-Cookie": await adminSessionStorage.commitSession(session),
            },
        });
    }

    return { error: "Invalid admin password" };
};

export default function SuperAdminLogin() {
    const [password, setPassword] = useState("");
    const navigation = useNavigation();
    const actionData = useActionData<typeof action>();
    const isLoggingIn = navigation.state === "submitting" || navigation.state === "loading";

    return (
        <Page>
            <Layout>
                <Layout.Section>
                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '100px' }}>
                        <Card>
                            <div style={{ padding: '0 20px', minWidth: '350px' }}>
                                <form method="POST" action="/super-admin/login">
                                    <BlockStack gap="400">
                                        <Text variant="headingLg" as="h1" alignment="center">Super Admin Console</Text>

                                        {actionData?.error && (
                                            <Banner tone="critical">
                                                {actionData.error}
                                            </Banner>
                                        )}

                                        <input type="hidden" name="password" value={password} />

                                        <TextField
                                            label="Master Password"
                                            name="password_display"
                                            type="password"
                                            value={password}
                                            onChange={setPassword}
                                            autoComplete="off"
                                        />

                                        <button
                                            type="submit"
                                            style={{
                                                background: '#000',
                                                color: '#fff',
                                                padding: '10px 20px',
                                                border: 'none',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontSize: '14px',
                                                fontWeight: 'bold',
                                                width: '100%'
                                            }}
                                        >
                                            Secure Login
                                        </button>
                                    </BlockStack>
                                </form>
                            </div>
                        </Card>
                    </div>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
