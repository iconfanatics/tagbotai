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

    // Traffic source: try referring_site first, fall back to source_name
    const referringSite = (order.referring_site || "").toLowerCase();
    const sourceName = (order.source_name || "").toLowerCase();
    const orderSource = referringSite || sourceName;

    return {
        order_source: orderSource,
        payment_method: (order.payment_gateway || "").toLowerCase(),
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
    rules: Rule[],
    existingCustomerTags: string[]
): { tag: string; reason: string }[] {
    const results: { tag: string; reason: string }[] = [];
    const orderData = extractOrderData(order);

    for (const rule of rules) {
        // Only process rules that have order conditions
        let conditions: any[];
        try {
            conditions = JSON.parse(rule.conditions);
        } catch {
            continue;
        }

        // A rule is an "order rule" if ALL its conditions have ruleCategory = "order"
        const orderConditions: OrderCondition[] = conditions.filter(
            (c: any) => c.ruleCategory === "order"
        );
        if (orderConditions.length === 0) continue;

        // Skip if customer already has this tag
        if (existingCustomerTags.includes(rule.targetTag)) continue;

        // AND logic: all order conditions must match
        const isMatch = orderConditions.every(c => evaluateOrderCondition(orderData, c));

        if (isMatch) {
            const reasons = orderConditions.map(c => `order.${c.field} ${c.operator} "${c.value}"`);
            results.push({
                tag: rule.targetTag,
                reason: `Order rule "${rule.name}" matched (${reasons.join(" AND ")})`
            });
        }
    }

    return results;
}
