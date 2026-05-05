import { data } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { generateRuleConditions } from "../services/ai.server";
import { authenticate } from "../shopify.server";
import { getCachedStore } from "../services/cache.server";
import { hasProAccess } from "../services/plan-access";

export const action = async ({ request }: ActionFunctionArgs) => {
    if (request.method !== "POST") {
        return data({ error: "Method not allowed" }, { status: 405 });
    }

    try {
        const { session } = await authenticate.admin(request);
        const store = await getCachedStore(session.shop);
        if (!hasProAccess(store?.planName)) {
            return data({ error: "AI rule generation requires the Pro or Elite plan." }, { status: 403 });
        }

        const { prompt } = await request.json();

        if (!prompt || typeof prompt !== "string") {
            return data({ error: "Missing or invalid prompt string." }, { status: 400 });
        }

        const aiGeneratedRule = await generateRuleConditions(prompt);

        if (!aiGeneratedRule) {
            return data({ error: "AI failed to generate a valid rule configuration." }, { status: 500 });
        }

        return data({ success: true, rule: aiGeneratedRule });

    } catch (error: any) {
        console.error("[AI_ROUTE_ERROR] Could not process AI request:", error);
        return data({ error: "Internal server error during AI generation." }, { status: 500 });
    }
};
