import { type LoaderFunctionArgs, redirect } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { exchangeKlaviyoCodeForToken, klaviyoSessionStorage } from "../services/klaviyo.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    // 2. Get Klaviyo OAuth Session
    const cookieHeader = request.headers.get("Cookie");
    const kSession = await klaviyoSessionStorage.getSession(cookieHeader);
    
    // We get the shop from our own session, not authenticate.admin(request)
    // because Klaviyo's redirect doesn't carry Shopify's session headers.
    let shop = kSession.get("shop");

    // 3. Extract parameters from URL
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    // Fallback: If shop is missing from session, check if we encoded it in state (e.g. "shop.myshopify.com:nonce")
    if (!shop && state && state.includes(":")) {
        shop = state.split(":")[0];
    }

    if (!shop) {
        console.error("[KLAVIYO CALLBACK] Missing shop in kSession and state");
        return redirect("/auth/login"); // Fallback if session is totally lost
    }

    const savedState = kSession.get("state");
    const verifier = kSession.get("verifier");

    if (error) {
        console.error(`[KLAVIYO CALLBACK] Error from Klaviyo: ${error}`);
        return redirect("/app/integrations?error=Klaviyo+Authorization+Denied");
    }

    if (!code || !state || (savedState && state !== savedState && !state.endsWith(savedState)) || !verifier) {
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

        // 6. Cleanup session and redirect back through the Shopify Auth entry point
        const returnUrl = `/auth?shop=${shop}&return_to=/app/integrations?success=Klaviyo+Connected`;
        
        return redirect(returnUrl, {
            headers: {
                "Set-Cookie": await klaviyoSessionStorage.destroySession(kSession)
            }
        });

    } catch (err: any) {
        console.error("[KLAVIYO CALLBACK] Exception:", err);
        
        let errorMessage = err.message;
        if (errorMessage.includes("invalid_client")) {
            errorMessage = "Klaviyo rejected your Client ID or Secret. Please double check your OAuth settings in Klaviyo.";
        } else if (errorMessage.includes("Missing Klaviyo Client")) {
            errorMessage = "Klaviyo credentials not found in environment variables.";
        }

        // Redirect back to integrations with a clean error message
        return redirect(`/app/integrations?error=${encodeURIComponent(errorMessage)}`);
    }
};
