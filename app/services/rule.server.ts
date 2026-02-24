import { Store, Rule, Customer } from "@prisma/client";

export type Condition = {
    field: "totalSpent" | "orderCount" | "lastOrderDate";
    operator: "greaterThan" | "lessThan" | "equals" | "isBefore" | "isAfter";
    value: any;
};

// Evaluate a single condition against customer data
function evaluateCondition(customer: Customer, condition: Condition): boolean {
    const { field, operator, value } = condition;
    const customerValue = customer[field];

    if (customerValue === null || customerValue === undefined) return false;

    switch (operator) {
        // Number comparisons
        case "greaterThan":
            return Number(customerValue) > Number(value);
        case "lessThan":
            return Number(customerValue) < Number(value);
        case "equals":
            return customerValue === value;

        // Date Comparisons
        case "isBefore":
            return new Date(customerValue as Date).getTime() < new Date(value).getTime();
        case "isAfter":
            return new Date(customerValue as Date).getTime() > new Date(value).getTime();

        default:
            return false;
    }
}

// Evaluate a rule (which may have multiple conditions, assuming AND logic for now)
export function evaluateRule(customer: Customer, rule: Rule): { isMatch: boolean; reason: string } {
    try {
        const conditions: Condition[] = JSON.parse(rule.conditions);

        // AND logic: all conditions must be true
        const isMatch = conditions.every((condition) => evaluateCondition(customer, condition));

        // Generate an english reason if it matches
        let reason = "";
        if (isMatch) {
            const reasons = conditions.map(c => `${c.field} ${c.operator} ${c.value}`);
            reason = `Matched rule "${rule.name}" (${reasons.join(" AND ")})`;
        } else {
            reason = `No longer matches rule "${rule.name}"`;
        }

        return { isMatch, reason };
    } catch (error) {
        console.error(`[RULE_ENGINE] Failed to parse conditions for Rule ${rule.id}:`, error);
        return { isMatch: false, reason: "Error parsing conditions" };
    }
}

// Main service function to calculate tags for a customer based on store rules
export async function calculateCustomerTags(
    customer: Customer,
    activeRules: Rule[]
): Promise<{ tagsToAdd: { tag: string; reason: string }[]; tagsToRemove: { tag: string; reason: string }[] }> {

    const existingTags = customer.tags ? customer.tags.split(",").map(t => t.trim()) : [];

    const tagsToAdd: { tag: string; reason: string }[] = [];
    const tagsToRemove: { tag: string; reason: string }[] = [];

    for (const rule of activeRules) {
        const { isMatch, reason } = evaluateRule(customer, rule);

        if (isMatch) {
            if (!existingTags.includes(rule.targetTag)) {
                tagsToAdd.push({ tag: rule.targetTag, reason });
            }
        } else {
            // If rule doesn't match, BUT they have the tag, we should theoretically remove it
            if (existingTags.includes(rule.targetTag)) {
                tagsToRemove.push({ tag: rule.targetTag, reason });
            }
        }
    }

    return {
        tagsToAdd,
        tagsToRemove
    };
}
