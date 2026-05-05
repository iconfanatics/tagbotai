export function hasGrowthAccess(planName?: string | null) {
  const plan = planName || "";
  return plan.includes("Growth") || plan.includes("Pro") || plan.includes("Elite");
}

export function hasProAccess(planName?: string | null) {
  const plan = planName || "";
  return plan.includes("Pro") || plan.includes("Elite");
}

export function hasEliteAccess(planName?: string | null) {
  return Boolean(planName?.includes("Elite"));
}
