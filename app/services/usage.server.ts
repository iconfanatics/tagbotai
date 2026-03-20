import db from "../db.server";

export type UsageType = "customer_tag" | "order_tag" | "removal";

export const PLAN_LIMITS: Record<string, { customer_tag: number; order_tag: number; removal: number }> = {
    "Free": {
        customer_tag: 100,
        order_tag: 100,
        removal: 100
    },
    "Growth Plan": {
        customer_tag: 1000,
        order_tag: 1000,
        removal: 1000
    },
    "Pro Plan": {
        customer_tag: 1000000, // Effectively unlimited
        order_tag: 1000000,
        removal: 1000000
    },
    "Elite Plan": {
        customer_tag: 1000000,
        order_tag: 1000000,
        removal: 1000000
    }
};

/**
 * Resets the usage counters if more than 30 days have passed since the last reset.
 */
export async function resetUsageIfMonthPassed(shop: string) {
    const store = await db.store.findUnique({
        where: { shop },
        select: { id: true, usageResetDate: true }
    });

    if (!store) return;

    const lastReset = new Date(store.usageResetDate);
    const now = new Date();
    const diffInDays = (now.getTime() - lastReset.getTime()) / (1000 * 3600 * 24);

    if (diffInDays >= 30) {
        await db.store.update({
            where: { shop },
            data: {
                monthlyCustomerTagCount: 0,
                monthlyOrderTagCount: 0,
                monthlyRemovalCount: 0,
                usageResetDate: now
            }
        });
    }
}

/**
 * Checks if the store has remaining quota for the given usage type.
 * If yes, increments the counter and returns true.
 * If no, returns false.
 */
export async function incrementUsage(shop: string, type: UsageType, amount: number = 1): Promise<boolean> {
    await resetUsageIfMonthPassed(shop);

    const store = await db.store.findUnique({
        where: { shop },
        select: { 
            planName: true, 
            monthlyCustomerTagCount: true, 
            monthlyOrderTagCount: true, 
            monthlyRemovalCount: true 
        }
    });

    if (!store) return false;

    const limits = PLAN_LIMITS[store.planName] || PLAN_LIMITS["Free"];
    let currentCount = 0;
    let limit = 0;
    let field = "";

    switch (type) {
        case "customer_tag":
            currentCount = store.monthlyCustomerTagCount;
            limit = limits.customer_tag;
            field = "monthlyCustomerTagCount";
            break;
        case "order_tag":
            currentCount = store.monthlyOrderTagCount;
            limit = limits.order_tag;
            field = "monthlyOrderTagCount";
            break;
        case "removal":
            currentCount = store.monthlyRemovalCount;
            limit = limits.removal;
            field = "monthlyRemovalCount";
            break;
    }

    if (currentCount + amount > limit) {
        return false;
    }

    await db.store.update({
        where: { shop },
        data: {
            [field]: { increment: amount }
        }
    });

    return true;
}

/**
 * Convenience helper to check if multiple actions can be performed.
 */
export async function canPerformActions(shop: string, type: UsageType, count: number): Promise<boolean> {
    const store = await db.store.findUnique({
        where: { shop },
        select: { 
            planName: true, 
            monthlyCustomerTagCount: true, 
            monthlyOrderTagCount: true, 
            monthlyRemovalCount: true 
        }
    });

    if (!store) return false;

    const limits = PLAN_LIMITS[store.planName] || PLAN_LIMITS["Free"];
    let currentCount = 0;
    let limit = 0;

    switch (type) {
        case "customer_tag":
            currentCount = store.monthlyCustomerTagCount;
            limit = limits.customer_tag;
            break;
        case "order_tag":
            currentCount = store.monthlyOrderTagCount;
            limit = limits.order_tag;
            break;
        case "removal":
            currentCount = store.monthlyRemovalCount;
            limit = limits.removal;
            break;
    }

    return currentCount + count <= limit;
}
