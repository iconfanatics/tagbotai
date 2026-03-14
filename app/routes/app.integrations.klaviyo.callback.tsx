import { type LoaderFunctionArgs, redirect } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { exchangeKlaviyoCodeForToken, klaviyoSessionStorage } from "../services/klaviyo.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    // 1. Authenticate with Shopify to get the shop
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    // 2. Get Klaviyo OAuth Session
    const cookieHeader = request.headers.get("Cookie");
    const kSession = await klaviyoSessionStorage.getSession(cookieHeader);

    // 3. Extract parameters from URL
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    const savedState = kSession.get("state");
    const verifier = kSession.get("verifier");

    if (error) {
        console.error(`[KLAVIYO CALLBACK] Error from Klaviyo: ${error}`);
        return redirect("/app/integrations?error=Klaviyo+Authorization+Denied");
    }

    if (!code || !state || state !== savedState || !verifier) {
        console.error("[KLAVIYO CALLBACK] Security check failed or missing parameters");
        return redirect("/app/integrations?error=Security+Validation+Failed");
    }

    try {
        const clientId = process.env.KLAVIYO_CLIENT_ID;
        const clientSecret = process.env.KLAVIYO_CLIENT_SECRET;
        const appUrl = process.env.SHOPIFY_APP_URL || `https://${new URL(request.url).host}`;
        const redirectUri = `${appUrl}/app/integrations/klaviyo/callback`;

        if (!clientId || !clientSecret) {
            throw new Error("Missing Klaviyo Client credentials in environment");
        }

        // 4. Exchange code for tokens
        const tokens = await exchangeKlaviyoCodeForToken(
            clientId,
            clientSecret,
            code,
            verifier,
            redirectUri
        );

        // 5. Save tokens to DB
        await db.store.update({
            where: { shop },
            data: {
                klaviyoAccessToken: tokens.access_token,
                klaviyoRefreshToken: tokens.refresh_token,
                klaviyoIsActive: true
            }
        });

        console.log(`[KLAVIYO CALLBACK] Successfully connected Klaviyo for ${shop}`);

        // 6. Cleanup session and redirect
        return redirect("/app/integrations?success=Klaviyo+Connected", {
            headers: {
                "Set-Cookie": await klaviyoSessionStorage.destroySession(kSession)
            }
        });

    } catch (err: any) {
        console.error("[KLAVIYO CALLBACK] Exception:", err);
        return redirect(`/app/integrations?error=${encodeURIComponent(err.message)}`);
    }
};
