import { type LoaderFunctionArgs, redirect } from "react-router";
import crypto from "crypto";
import { authenticate } from "../shopify.server";
import { generatePKCE, getKlaviyoAuthUrl, klaviyoSessionStorage } from "../services/klaviyo.server";

/**
 * Klaviyo Install URL Route
 * This route is intended to be the "Install URL" in the Klaviyo App Directory.
 * It automatically initiates the OAuth flow for the currently authenticated Shopify session.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
    // 1. Authenticate with Shopify to get the shop
    // If not authenticated, Shopify's authenticate.admin will handle the redirect to login/install
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    if (!shop) {
        throw new Response("Store not found in session", { status: 400 });
    }

    // 2. Prepare OAuth Parameters
    const { verifier, challenge } = generatePKCE();
    const state = crypto.randomUUID();
    const clientId = process.env.KLAVIYO_CLIENT_ID;
    
    // Standardize app URL
    const appUrl = process.env.SHOPIFY_APP_URL || `https://${new URL(request.url).host}`;
    const redirectUri = `${appUrl}/app/integrations/klaviyo/callback`;
    const scope = "accounts:read profiles:read profiles:write";

    if (!clientId) {
        throw new Response("Klaviyo Client ID not configured", { status: 500 });
    }

    // 3. Construct Authorization URL
    const authUrl = getKlaviyoAuthUrl(clientId, redirectUri, scope, state, challenge);

    // 4. Save state in session for verification during callback
    const kSession = await klaviyoSessionStorage.getSession();
    kSession.set("state", state);
    kSession.set("verifier", verifier);
    kSession.set("shop", shop);

    // 5. Redirect to Klaviyo Authorization
    return redirect(authUrl, {
        headers: {
            "Set-Cookie": await klaviyoSessionStorage.commitSession(kSession)
        }
    });
};
