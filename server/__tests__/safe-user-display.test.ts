/**
 * safeUser() display normalization.
 *
 * The DB zeroes daily AI counters lazily (on the next AI call via resetAiCallsIfNewDay),
 * so the stored aiCallsToday/copilotCallsToday are stale after midnight until the user
 * makes an AI call. safeUser() must report 0 for any counter whose stored reset date is
 * not today, so /api/user and login/register responses never show yesterday's usage.
 * It must also never leak the password field.
 */
import { describe, it, expect } from "vitest";
import { safeUser } from "../auth";

const TODAY = new Date().toISOString().split("T")[0];
const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    username: "tester",
    password: "hashed-secret",
    subscriptionTier: "free",
    aiCallsToday: 7,
    aiCallsResetDate: TODAY,
    copilotCallsToday: 12,
    copilotResetDate: TODAY,
    ...overrides,
  };
}

describe("safeUser", () => {
  it("strips the password field", () => {
    const safe = safeUser(baseUser());
    expect(safe.password).toBeUndefined();
    expect(safe.username).toBe("tester");
  });

  it("passes through today's counters unchanged", () => {
    const safe = safeUser(baseUser());
    expect(safe.aiCallsToday).toBe(7);
    expect(safe.copilotCallsToday).toBe(12);
  });

  it("zeroes the suggestions counter when its reset date is stale", () => {
    const safe = safeUser(baseUser({ aiCallsResetDate: YESTERDAY }));
    expect(safe.aiCallsToday).toBe(0);
    // The other counter is independent and still fresh
    expect(safe.copilotCallsToday).toBe(12);
  });

  it("zeroes the copilot counter when its reset date is stale", () => {
    const safe = safeUser(baseUser({ copilotResetDate: YESTERDAY }));
    expect(safe.copilotCallsToday).toBe(0);
    expect(safe.aiCallsToday).toBe(7);
  });

  it("zeroes both counters for a user who has never made an AI call (null reset dates)", () => {
    const safe = safeUser(baseUser({ aiCallsResetDate: null, copilotResetDate: null, aiCallsToday: 3, copilotCallsToday: 4 }));
    expect(safe.aiCallsToday).toBe(0);
    expect(safe.copilotCallsToday).toBe(0);
  });

  it("returns falsy input unchanged", () => {
    expect(safeUser(null)).toBeNull();
    expect(safeUser(undefined)).toBeUndefined();
  });
});
