import { storage } from "../storage";

// Advertised Pro perk "Up to 6 household members" — now actually enforced.
export const FREE_HOUSEHOLD_MAX_MEMBERS = 2;
export const PREMIUM_HOUSEHOLD_MAX_MEMBERS = 6;

// Activity feed depth per tier ("Full activity feed history" perk).
export const FREE_ACTIVITY_LIMIT = 15;
export const PREMIUM_ACTIVITY_LIMIT = 40;

// One subscription covers the whole household, so a household counts as premium
// if ANY member is premium (test accounts get premium-sized caps too).
export async function householdIsPremium(householdId: number): Promise<boolean> {
  const members = await storage.getHouseholdMembers(householdId);
  return members.some(m => m.subscriptionTier === "premium" || m.subscriptionTier === "test");
}

// Gate for every path that adds a member to an existing household (invite-code join
// and register-with-invite). Existing households already over their cap are
// grandfathered: the cap binds only NEW joins — an over-cap household keeps its
// members, it just can't add more.
export async function checkHouseholdJoinCap(householdId: number): Promise<{ allowed: boolean; count: number; limit: number; premium: boolean }> {
  const members = await storage.getHouseholdMembers(householdId);
  const premium = members.some(m => m.subscriptionTier === "premium" || m.subscriptionTier === "test");
  const limit = premium ? PREMIUM_HOUSEHOLD_MAX_MEMBERS : FREE_HOUSEHOLD_MAX_MEMBERS;
  return { allowed: members.length < limit, count: members.length, limit, premium };
}

export function joinCapError(cap: { limit: number; premium: boolean }) {
  return {
    error: cap.premium
      ? `This household is full — up to ${cap.limit} members.`
      : `Free households can have up to ${cap.limit} members. Upgrade to Premium for up to ${PREMIUM_HOUSEHOLD_MAX_MEMBERS}.`,
    upgradePrompt: !cap.premium,
  };
}
