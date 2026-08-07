/**
 * Household member cap — the "Up to 6 household members" Pro perk, now enforced.
 *
 * checkHouseholdJoinCap gates every member-adding path (invite-code join and
 * register-with-invite). Free households cap at 2 members, premium at 6 — a
 * household counts as premium when ANY member is premium (one subscription covers
 * the household; test accounts get premium-sized caps). Grandfathering: the cap
 * binds only NEW joins, so an over-cap household keeps its members.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../storage", () => ({
  storage: {
    getHouseholdMembers: vi.fn(),
  },
}));

import { storage } from "../storage";
import {
  checkHouseholdJoinCap,
  householdIsPremium,
  joinCapError,
  FREE_HOUSEHOLD_MAX_MEMBERS,
  PREMIUM_HOUSEHOLD_MAX_MEMBERS,
} from "../utils/householdLimit";

const s = storage as unknown as { getHouseholdMembers: ReturnType<typeof vi.fn> };

function members(...tiers: string[]) {
  return tiers.map((t, i) => ({ id: i + 1, username: `u${i + 1}`, subscriptionTier: t }));
}

beforeEach(() => vi.clearAllMocks());

describe("checkHouseholdJoinCap", () => {
  it("free household under the cap → join allowed", async () => {
    s.getHouseholdMembers.mockResolvedValue(members("free"));
    const cap = await checkHouseholdJoinCap(1);
    expect(cap.allowed).toBe(true);
    expect(cap.limit).toBe(FREE_HOUSEHOLD_MAX_MEMBERS);
  });

  it("free household AT 2 members → join blocked", async () => {
    s.getHouseholdMembers.mockResolvedValue(members("free", "free"));
    const cap = await checkHouseholdJoinCap(1);
    expect(cap.allowed).toBe(false);
    expect(cap.limit).toBe(FREE_HOUSEHOLD_MAX_MEMBERS);
    expect(joinCapError(cap).upgradePrompt).toBe(true);
  });

  it("premium household gets the 6-member cap (any premium member counts)", async () => {
    s.getHouseholdMembers.mockResolvedValue(members("free", "premium", "free"));
    const cap = await checkHouseholdJoinCap(1);
    expect(cap.allowed).toBe(true);
    expect(cap.limit).toBe(PREMIUM_HOUSEHOLD_MAX_MEMBERS);
  });

  it("premium household AT 6 members → join blocked, no upgrade prompt", async () => {
    s.getHouseholdMembers.mockResolvedValue(members("premium", "free", "free", "free", "free", "free"));
    const cap = await checkHouseholdJoinCap(1);
    expect(cap.allowed).toBe(false);
    expect(cap.limit).toBe(PREMIUM_HOUSEHOLD_MAX_MEMBERS);
    expect(joinCapError(cap).upgradePrompt).toBe(false);
  });

  it("grandfathered over-cap free household: members remain (only the join is blocked)", async () => {
    // 4 members in a free household (pre-cap era): the check only refuses NEW joins —
    // nothing here removes members, and the count is reported as-is.
    s.getHouseholdMembers.mockResolvedValue(members("free", "free", "free", "free"));
    const cap = await checkHouseholdJoinCap(1);
    expect(cap.allowed).toBe(false);
    expect(cap.count).toBe(4);
  });

  it("test-tier members give the household premium-sized caps", async () => {
    s.getHouseholdMembers.mockResolvedValue(members("test", "free"));
    const cap = await checkHouseholdJoinCap(1);
    expect(cap.limit).toBe(PREMIUM_HOUSEHOLD_MAX_MEMBERS);
  });
});

describe("householdIsPremium", () => {
  it("true when any member is premium or test; false otherwise", async () => {
    s.getHouseholdMembers.mockResolvedValue(members("free", "free"));
    expect(await householdIsPremium(1)).toBe(false);
    s.getHouseholdMembers.mockResolvedValue(members("free", "premium"));
    expect(await householdIsPremium(1)).toBe(true);
    s.getHouseholdMembers.mockResolvedValue(members("test"));
    expect(await householdIsPremium(1)).toBe(true);
  });
});
