import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { sendUpgradePromptEmail } from "../services/email.server";

// This endpoint is meant to be called by a Vercel Cron Job every night at 12:00 AM UTC
// E.g. GET https://tagbot.ai/api/cron/emails

// To secure the endpoint, Vercel securely passes a CRON_SECRET header.
// Without this secret, random people on the internet cannot trigger your merchant emails.

export const loader = async ({ request }: LoaderFunctionArgs) => {
    // 1. Authenticate the Cron request
    const authHeader = request.headers.get("authorization");
    const vercelCronSecret = process.env.CRON_SECRET;

    if (!vercelCronSecret) {
         console.warn("[CRON ERROR] CRON_SECRET environment variable is missing.");
         return Response.json({ error: "Configuration Error" }, { status: 500 });
    }

    if (authHeader !== `Bearer ${vercelCronSecret}`) {
         console.warn("[CRON ERROR] Unauthorized attempt to trigger email cron job.");
         return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("[CRON JOB ACTIVE] -> Scanning for 7-Day Upgrade Prompts...");

    // 2. Calculate the date exactly 7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    // Create a start and end window for that day so we catch all installs on that specific date
    const startOfDay = new Date(sevenDaysAgo);
    startOfDay.setUTCHours(0, 0, 0, 0);
    
    const endOfDay = new Date(sevenDaysAgo);
    endOfDay.setUTCHours(23, 59, 59, 999);

    // 3. Find all active stores that installed on this exact date and are still on the "Free" plan
    const eligibleStores = await db.store.findMany({
        where: {
            isActive: true, // Only email apps that still have it installed
            planName: "Free", // Only target free users
            createdAt: {
                gte: startOfDay,
                lte: endOfDay
            }
        }
    });

    console.log(`[CRON SUMMARY] Found ${eligibleStores.length} stores eligible for the 7-Day Upgrade Prompt.`);
    
    let emailsSent = 0;
    const errors: string[] = [];

    // 4. Dispatch the Upgrade Email to each eligible merchant
    for (const store of eligibleStores) {
        // Find the active session for this Shopify store to retrieve the account owner's email
        const activeSession = await db.session.findFirst({
            where: {
                shop: store.shop,
                isOnline: false // Offline token is usually the most stable long-term
            }
        });

        const recipientEmail = activeSession?.email;

        if (recipientEmail) {
            const success = await sendUpgradePromptEmail(store.shop, recipientEmail);
            if (success) {
                emailsSent++;
            } else {
                errors.push(`Failed to send to ${store.shop} (${recipientEmail})`);
            }
        } else {
             // Sometimes development stores or broken installs don't have an email attached
             console.log(`[CRON SKIP] No email address found on file for shop: ${store.shop}`);
        }
    }

    return Response.json({ 
        success: true, 
        message: "Daily Cron execution successful.",
        stats: {
             eligibleMerchants: eligibleStores.length,
             emailsDispatched: emailsSent,
             failures: errors.length
        },
        errors: errors.length > 0 ? errors : undefined
    });
};

export const action = async ({ request }: ActionFunctionArgs) => {
     // Explicitly reject POST/PUT methods
     return Response.json({ error: "Method not allowed. Use GET." }, { status: 405 });
};
