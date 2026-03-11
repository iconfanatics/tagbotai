/**
 * order-rules.server.ts
 *
 * Order-Based Rule Evaluation Engine (Additive Module)
 *
 * Evaluates Rule records whose conditions have ruleCategory = "order" against
 * the raw Shopify `orders/paid` webhook payload. Zero changes to the existing
 * customer metric evaluation pipeline (rule.server.ts is untouched).
 *
 * Supported order fields:
 *   order_source         - referring_site / source_name
 *   payment_method       - payment_gateway
 *   shipping_city        - shipping_address.city
 *   shipping_country     - shipping_address.country_code
 *   order_item_count     - sum of line_items[].quantity
 *   order_subtotal       - subtotal_price
 *   discount_code_used   - whether discount_codes is non-empty ("true"/"false")
 *   discount_code_value  - specific discount code string
 *   discount_percentage  - derived: (total_discounts / subtotal_price) * 100
 *   is_preorder          - any line_item.properties has name "Pre-Order" or product tag "pre-order"
 */

import type { Rule } from "@prisma/client";
import { evaluateCondition as evalCustomerCondition } from "./rule.server";

export type OrderCondition = {
    field: string;
    operator: string;
    value: string;
    ruleCategory: "order";
};

/**
 * Extract normalized order data fields from the raw Shopify order payload.
 */
function extractOrderData(order: any): Record<string, any> {
    // Total ordered item quantity
    const itemCount = (order.line_items || []).reduce(
        (sum: number, item: any) => sum + (item.quantity || 0), 0
    );

    // Detect pre-order: look for a line_item property named pre-order / pre_order
    const isPreorder = (order.line_items || []).some((item: any) => {
        const props: { name: string; value: string }[] = item.properties || [];
        return props.some(p =>
            p.name?.toLowerCase().replace(/[^a-z]/g, "") === "preorder" ||
            p.value?.toLowerCase().replace(/[^a-z]/g, "") === "preorder"
        );
    });

    const subtotal = parseFloat(order.subtotal_price || "0");
    const totalDiscount = parseFloat(order.total_discounts || "0");
    const discountPct = subtotal > 0 ? (totalDiscount / subtotal) * 100 : 0;
    const discountCodes: { code: string }[] = order.discount_codes || [];
    const discountCodeUsed = discountCodes.length > 0;
    const discountCodeValue = discountCodes.map(d => d.code).join(",").toLowerCase();

    // Traffic source: build a combined string so merchants can match by any signal.
    //   1. referring_site  = full URL the customer came from (e.g. "https://www.facebook.com/...")
    //   2. landing_site    = URL of the first page visited — often contains UTM params
    //                        (e.g. "?utm_source=facebook&utm_medium=cpc")
    //   3. source_name     = Shopify's own channel label ("web", "pos", "shopify_draft_order", etc.)
    // We join all three so a "contains facebook" check will fire if ANY of them mentions facebook.
    const referringSite = (order.referring_site || "").toLowerCase();
    const landingSite = (order.landing_site || "").toLowerCase();
    const sourceName = (order.source_name || "").toLowerCase();
    // Combine into one searchable string separated by spaces
    const orderSource = [referringSite, landingSite, sourceName].filter(Boolean).join(" ");

    // Payment method: Shopify may expose the gateway in multiple places.
    // `payment_gateway_names` is the most reliable; fall back to `payment_gateway` or `gateway`.
    let paymentMethodStr = "";
    if (Array.isArray(order.payment_gateway_names) && order.payment_gateway_names.length > 0) {
        paymentMethodStr = order.payment_gateway_names.join(", ").toLowerCase();
    } else {
        paymentMethodStr = (order.payment_gateway || order.gateway || "").toLowerCase();
    }
    // Normalize all COD variants → always include "cash_on_delivery" so template matching works.
    // Real Shopify gateways: "Cash on Delivery (COD)", "cash on delivery", "cod", "cash-on-delivery"
    if (
        paymentMethodStr.includes("cash on delivery") ||
        paymentMethodStr.includes("cash_on_delivery") ||
        paymentMethodStr.includes("cash-on-delivery") ||
        paymentMethodStr === "cod" ||
        paymentMethodStr.includes("(cod)")
    ) {
        paymentMethodStr += " cash_on_delivery";
    }

    return {
        order_source: orderSource,
        payment_method: paymentMethodStr,
        shipping_city: (order.shipping_address?.city || "").toLowerCase(),
        shipping_country: (order.shipping_address?.country_code || "").toLowerCase(),
        order_item_count: itemCount,
        order_subtotal: subtotal,
        discount_code_used: discountCodeUsed ? "true" : "false",
        discount_code_value: discountCodeValue,
        discount_percentage: parseFloat(discountPct.toFixed(2)),
        is_preorder: isPreorder ? "true" : "false"
    };
}

function evaluateOrderCondition(orderData: Record<string, any>, condition: OrderCondition): boolean {
    const rawActual = orderData[condition.field];
    if (rawActual === undefined || rawActual === null) return false;

    const { operator, value } = condition;

    switch (operator) {
        case "equals":
            return String(rawActual).toLowerCase() === value.toLowerCase();

        case "contains":
            return String(rawActual).toLowerCase().includes(value.toLowerCase());

        case "greaterThan":
            return Number(rawActual) > Number(value);

        case "lessThan":
            return Number(rawActual) < Number(value);

        case "notEquals":
            return String(rawActual).toLowerCase() !== value.toLowerCase();

        default:
            return false;
    }
}

/**
 * Main export: given the raw Shopify order and a list of active Rule records,
 * return matched tag names and reasons.
 */
export function evaluateOrderRules(
    order: any,
    customer: any,
    rules: Rule[],
    existingCustomerTags: string[]
): { tag: string; reason: string; targetEntity: string }[] {
    const results: { tag: string; reason: string; targetEntity: string }[] = [];
    const orderData = extractOrderData(order);


    for (const rule of rules) {
        let conditions: any[];
        try {
            conditions = JSON.parse(rule.conditions);
        } catch {
            continue;
        }

        // A rule requires order evaluation if it has AT LEAST ONE order condition
        const orderConditions = conditions.filter((c: any) => c.ruleCategory === "order");
        if (orderConditions.length === 0) continue; // Pure metric rules are handled purely by rule.server.ts

        // It might also have metric conditions (mixed rule)
        const metricConditions = conditions.filter((c: any) => c.ruleCategory === "metric");

        // Skip if customer already has this tag
        if (existingCustomerTags.includes(rule.targetTag)) continue;

        // Evaluate all conditions across both scopes
        const evaluateGenericCondition = (c: any) => {
            if (c.ruleCategory === "order") {
                return evaluateOrderCondition(orderData, c);
            } else {
                return evalCustomerCondition(customer, c);
            }
        };

        const isMatch = rule.matchType === "ANY"
            ? conditions.some(c => evaluateGenericCondition(c))
            : conditions.every(c => evaluateGenericCondition(c));

        if (isMatch) {
            const reasons = conditions.map((c: any) =>
                c.ruleCategory === "order"
                    ? `order.${c.field} ${c.operator} "${c.value}"`
                    : `customer.${c.field} ${c.operator} "${c.value}"`
            );
            const joinWord = rule.matchType === "ANY" ? " OR " : " AND ";
            results.push({
                tag: rule.targetTag,
                reason: `Rule "${rule.name}" matched (${reasons.join(joinWord)})`,
                targetEntity: rule.targetEntity
            });
        }
    }

    return results;
}
