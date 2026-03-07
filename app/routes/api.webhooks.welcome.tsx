import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { sendWelcomeEmail } from "../services/email.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    // Only allow internal server POST requests (not secure for public browsers)
    if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

    try {
        const body = await request.json();
        const { shop } = body;

        if (!shop) return Response.json({ error: "Shop required" }, { status: 400 });

        console.log(`[WELCOME WEBHOOK] Triggered for shop: ${shop}`);

        const activeSession = await db.session.findFirst({
            where: { shop: shop, isOnline: false }
        });

        if (activeSession?.email) {
            await sendWelcomeEmail(shop, activeSession.email);
            return Response.json({ success: true, email: activeSession.email });
        } else {
             console.log(`[WELCOME WEBHOOK] No email found for shop: ${shop}`);
             return Response.json({ success: false, reason: "No email found" });
        }
    } catch (e) {
        console.error("Welcome Webhook Error:", e);
        return Response.json({ error: "Internal Server Error" }, { status: 500 });
    }
};
