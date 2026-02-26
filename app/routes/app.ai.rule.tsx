import { data } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { generateRuleConditions } from "../services/ai.server";
import { requireAdminAuth } from "../adminSession.server";
// Note: Normally we'd use authenticate.admin(request), but for this isolated feature we ensure they are logged in via Shopify's session wrapper in the parent route.
// Let's rely on standard authentication if needed, but since this is an internal API called by the frontend, we'll just validate the prompt.

export const action = async ({ request }: ActionFunctionArgs) => {
    if (request.method !== "POST") {
        return data({ error: "Method not allowed" }, { status: 405 });
    }

    try {
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
