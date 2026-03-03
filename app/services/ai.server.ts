import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

/**
 * Interface representing the structured JSON output expected from the LLM.
 */
export interface GeneratedRule {
    name: string;
    targetTag: string;
    description: string;
    ruleType: "metric" | "order";
    conditions: Array<{
        field: string;
        operator: string;
        value: string;
        ruleCategory?: "order";
    }>;
}

/**
 * Formats the AI prompt to ensure a strict JSON schema is returned
 * that can be easily parsed and applied to the Rule Creator UI.
 */
const getSystemPrompt = () => `
You are an expert Shopify segmentation AI for "TagBot AI".
Translate a merchant's natural language request into a strict JSON rule configuration.

RULE TYPES:
- "metric" → applies to customer profile data (totalSpent, orderCount, lastOrderDate)
- "order"  → applies to individual order properties (traffic source, payment, location, discounts, quantity)

CUSTOMER METRIC FIELDS (ruleType: "metric"):
- "totalSpent"     (Number: lifetime spend in dollars, e.g. 1000)
- "orderCount"     (Number: total number of orders, e.g. 5)
- "lastOrderDate"  (Date string: ISO 8601, e.g. "2024-01-01")

ORDER FIELDS — use ruleCategory: "order" in condition (ruleType: "order"):
- "order_source"         (String: e.g. "facebook", "tiktok", "instagram", "google")
- "payment_method"       (String: e.g. "paypal", "stripe", "cash_on_delivery")
- "shipping_city"        (String: e.g. "Dhaka", "London")
- "shipping_country"     (String: 2-letter ISO code, e.g. "US", "BD", "UK")
- "order_item_count"     (Number: total items in order, e.g. 3)
- "order_subtotal"       (Number: order total in dollars, e.g. 500)
- "discount_code_used"   (Boolean string: "true" or "false")
- "discount_code_value"  (String: specific code, e.g. "SUMMER20")
- "discount_percentage"  (Number: percentage, e.g. 15)
- "is_preorder"          (Boolean string: "true" or "false")

OPERATORS (use EXACTLY these strings):
- "greaterThan"   → for numbers: field > value
- "lessThan"      → for numbers: field < value
- "equals"        → for exact match (strings, booleans, numbers)
- "contains"      → for partial string match (e.g. source contains "facebook")
- "isBefore"      → for dates only
- "isAfter"       → for dates only

RULES:
1. If the merchant mentions order source / traffic / campaign / social media → use ruleType: "order", field: "order_source"
2. If about payment method → field: "payment_method"
3. If about location/city/country → field: "shipping_city" or "shipping_country"  
4. If about discount/coupon → field: "discount_code_used" or "discount_percentage"
5. If about spend/revenue → use ruleType: "metric", field: "totalSpent"
6. If about order count/frequency → field: "orderCount"
7. All values must be strings in the JSON.

OUTPUT FORMAT — return ONLY raw JSON, no markdown:
{
  "name": "Facebook Campaign Buyers",
  "ruleType": "order",
  "targetTag": "Social-FB",
  "description": "Tags customers who ordered via Facebook",
  "conditions": [
    { "field": "order_source", "operator": "contains", "value": "facebook", "ruleCategory": "order" }
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

/**
 * Analyzes a Shopify Order Note to determine customer sentiment or intent.
 * Returns a single, concise Tag (e.g., "Gifting", "Frustrated", "Urgent") or null if neutral/meaningless.
 */
export async function analyzeSentiment(note: string): Promise<string | null> {
    const provider = process.env.ACTIVE_AI_PROVIDER?.toLowerCase() || 'gemini';

    const sentimentPrompt = `
You are an AI order analysis engine for Shopify.
Read the following customer order note and determine if it warrants a special tag.

CATEGORIES TO LOOK FOR:
- Gifting (e.g., "Please don't include an invoice", "Happy birthday mom") -> return "Gifting"
- Frustrated (e.g., "This took forever last time", "Better not be broken") -> return "Frustrated"
- Urgent (e.g., "I need this by Friday", "Overnight shipping please") -> return "Urgent"
- High-Intent (e.g., "I buy these all the time", "Can't wait to try") -> return "High-Intent"

INSTRUCTIONS:
1. If the note clearly matches one of the above intents, return ONLY the single tag word (e.g. "Gifting").
2. Do not include any punctuation, explanation, or quotes.
3. If the note is neutral, meaningless, or just generic instructions (e.g., "Leave at back door"), return EXACTLY the string "NULL".

CUSTOMER NOTE:
"${note}"
`;

    try {
        if (provider === 'gemini') {
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) return null;

            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

            const result = await model.generateContent(sentimentPrompt);
            const tag = result.response.text().trim();

            return tag === "NULL" ? null : tag;

        } else if (provider === 'openai') {
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) return null;

            const openai = new OpenAI({ apiKey });

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "user", content: sentimentPrompt }
                ]
            });

            const tag = completion.choices[0]?.message?.content?.trim() || "NULL";
            return tag === "NULL" ? null : tag;

        }
    } catch (error) {
        console.error("[AI_SERVICE] Failed to analyze sentiment:", error);
        return null;
    }

    return null;
}
