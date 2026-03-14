import crypto from "crypto";
import { createCookieSessionStorage } from "react-router";

const KLAVIYO_REVISION = "2024-02-15";

const SESSION_SECRET = process.env.SESSION_SECRET || "klaviyo_default_secret_123";

export const klaviyoSessionStorage = createCookieSessionStorage({
    cookie: {
        name: "klaviyo_oauth_session",
        secure: true,
        secrets: [SESSION_SECRET],
        sameSite: "lax",
        path: "/",
        httpOnly: true,
        maxAge: 300, // 5 minutes
    },
});

/**
 * Modern Sync: Create or Update Profile
 * This uses the safer endpoint that doesn't require a pre-existing profile ID.
 */
export async function syncTagsToKlaviyo(accessToken: string, email: string, tagsToAdd: string[]) {
    if (!accessToken || !email || tagsToAdd.length === 0) {
        return { success: false, message: "Missing required Klaviyo Sync parameters." };
    }

    try {
        console.log(`[KLAVIYO SYNC] Pushing tags [${tagsToAdd.join(", ")}] for ${email}`);

        // Using Create or Update Profile endpoint
        // https://developers.klaviyo.com/en/reference/create_or_update_profile
        const payload = {
            data: {
                type: "profile",
                attributes: {
                    email: email,
                    properties: {
                        "TagBot_Segments": tagsToAdd.join(", ")
                    }
                }
            }
        };

        const response = await fetch(`https://a.klaviyo.com/api/profile-import/`, {
            method: 'POST',
            headers: {
                'Revision': KLAVIYO_REVISION,
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            console.log(`[KLAVIYO SYNC] Success for ${email}`);
            return { success: true };
        } else {
            const errorText = await response.text();
            console.error(`[KLAVIYO SYNC] Failed for ${email}. Status: ${response.status}`, errorText);
            return { success: false, message: `Klaviyo API Error: ${response.status}` };
        }
    } catch (err: any) {
        console.error(`[KLAVIYO SYNC] Catch Error:`, err);
        return { success: false, message: err.message };
    }
}

/**
 * OAuth Helpers
 */

export function generatePKCE() {
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    return { verifier, challenge };
}

export function getKlaviyoAuthUrl(clientId: string, redirectUri: string, scope: string, state: string, challenge: string) {
    const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scope,
        state: state,
        code_challenge_method: "S256",
        code_challenge: challenge
    });
    return `https://www.klaviyo.com/oauth/authorize?${params.toString()}`;
}

export async function exchangeKlaviyoCodeForToken(clientId: string, clientSecret: string, code: string, verifier: string, redirectUri: string) {
    const params = new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: verifier,
        redirect_uri: redirectUri
    });

    const response = await fetch("https://a.klaviyo.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Token exchange failed: ${err}`);
    }

    return response.json();
}

export async function refreshKlaviyoToken(clientId: string, clientSecret: string, refreshToken: string) {
    const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret
    });

    const response = await fetch("https://a.klaviyo.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Token refresh failed: ${err}`);
    }

    return response.json();
}

