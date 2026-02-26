import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

/**
 * Interface representing the structured JSON output expected from the LLM.
 * This directly maps to the database schema for creating a new TagBot Rule.
 */
export interface GeneratedRule {
    targetTag: string;
    description: string;
    matchType: "ALL" | "ANY";
    conditions: Array<{
        field: string;
        operator: string;
        value: string;
    }>;
}

/**
 * Formats the AI prompt to ensure a strict JSON schema is returned
 * that can be easily parsed and applied to the Rule Creator UI.
 */
const getSystemPrompt = () => `
You are an expert Shopify segmentation AI assistant built for "TagBot AI". 
Your job is to translate a merchant's natural language request into a strict JSON configuration for a customer tagging rule.

AVAILABLE CONDITION FIELDS: 
- "total_spent" (Float: lifetime spend)
- "order_count" (Integer: total number of orders)
- "last_order_date" (Date string: e.g. "X days ago" should map to relative logic)
- "email_domain" (String: e.g. "@gmail.com")

AVAILABLE OPERATORS:
- ">" (Greater than)
- "<" (Less than)
- "==" (Equals)
- "CONTAINS" (String matching)

INSTRUCTIONS:
1. Analyze the merchant's prompt.
2. Determine the most logical 'targetTag' (e.g. "VIP", "At-Risk", "First-Time Buyer"). Keep it concise.
3. Write a short 'description' of what the rule does.
4. Set 'matchType' to "ALL" if all conditions must be true, or "ANY" if only one needs to be true.
5. Create an array of 'conditions' mapping to the prompt.

OUTPUT FORMAT:
You MUST return ONLY raw JSON matching this exact structure, with no markdown formatting or block backticks:
{
  "targetTag": "VIP_Gold",
  "description": "Customers who have spent over $500",
  "matchType": "ALL",
  "conditions": [
    { "field": "total_spent", "operator": ">", "value": "500" }
  ]
}
`;

/**
 * Generates a structured TagBot rule based on a natural language prompt.
 * Automatically selects between Google Gemini (Default) or OpenAI ChatGPT based on environment variables.
 */
export async function generateRuleConditions(prompt: string): Promise<GeneratedRule | null> {
    const provider = process.env.ACTIVE_AI_PROVIDER?.toLowerCase() || 'gemini';

    try {
        if (provider === 'gemini') {
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

            const genAI = new GoogleGenerativeAI(apiKey);
            // Use gemini-2.5-flash as the default fast reasoning model
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

            const result = await model.generateContent(`${getSystemPrompt()}\n\nMERCHANT PROMPT:\n"${prompt}"`);
            const responseText = result.response.text();

            // Clean potential markdown blocks ` ```json ` sometimes returned by LLMs
            const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(cleanJson) as GeneratedRule;

        } else if (provider === 'openai') {
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

            const openai = new OpenAI({ apiKey });

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: getSystemPrompt() },
                    { role: "user", content: `MERCHANT PROMPT:\n"${prompt}"` }
                ],
                response_format: { type: "json_object" }
            });

            const responseText = completion.choices[0]?.message?.content || "{}";
            return JSON.parse(responseText) as GeneratedRule;

        } else {
            throw new Error(`Unsupported AI Provider: ${provider}`);
        }
    } catch (error) {
        console.error("[AI_SERVICE] Failed to generate rule:", error);
        return null;
    }
}
