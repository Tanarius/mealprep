/**
 * Rate limit middleware unit tests — no HTTP, no database.
 *
 * Tests aiRateLimit and copilotRateLimit directly with mock req/res/next. The quota is now
 * charged only when the response FINISHES successfully (2xx), via res.on("finish") — so:
 *  - unauthenticated → 401, no charge
 *  - free tier at/over limit → 429 with upgradePrompt, no charge (returns before hooking)
 *  - a successful (2xx) response charges exactly once, AFTER the response
 *  - a failed (non-2xx) response charges zero (the billing-integrity fix)
 *  - two concurrent successful responses charge by exactly two
 *  - callsRemaining reflects the pending charge
 *  - storage error → 500
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../storage", () => ({
  storage: {
    resetAiCallsIfNewDay: vi.fn(),
    getUserAiUsage: vi.fn(),
    incrementAiCalls: vi.fn(),
    resetCopilotCallsIfNewDay: vi.fn(),
    incrementCopilotCalls: vi.fn(),
    // Global breaker (tested in global-breaker.test.ts) — benign defaults here
    getGlobalAiCallsToday: vi.fn(),
    incrementGlobalAiCalls: vi.fn(),
    claimGlobalAiAlert: vi.fn(),
  },
}));

import { storage } from "../storage";
import {
  aiRateLimit,
  copilotRateLimit,
  UNLIMITED,
  FREE_TIER_DAILY_LIMIT,
  TEST_TIER_DAILY_LIMIT,
  COPILOT_FREE_TIER_DAILY_LIMIT,
  COPILOT_TEST_TIER_DAILY_LIMIT,
} from "../middleware/aiRateLimit";

type MockedStorage = { [K in keyof typeof storage]: ReturnType<typeof vi.fn> };
const s = storage as unknown as MockedStorage;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(authenticated: boolean, userId = 1) {
  return {
    isAuthenticated: () => authenticated,
    user: authenticated ? { id: userId } : undefined,
  } as any;
}

// Event-capable mock response: records status, captures finish handlers, and exposes
// finish(code) to simulate the response completing (as express fires on real send).
function makeRes() {
  const handlers: Record<string, Array<() => void>> = {};
  const res: any = {
    statusCode: 200,
    locals: {},
    status: vi.fn(function (code: number) { res.statusCode = code; return res; }),
    json: vi.fn(function () { return res; }),
    on: vi.fn(function (event: string, cb: () => void) { (handlers[event] ||= []).push(cb); return res; }),
    finish: (code?: number) => { if (code !== undefined) res.statusCode = code; (handlers["finish"] || []).forEach(cb => cb()); },
  };
  return res;
}

function usageFor(tier: string, aiCallsToday: number, copilotCallsToday = 0) {
  return { subscriptionTier: tier, aiCallsToday, copilotCallsToday };
}

beforeEach(() => {
  vi.clearAllMocks();
  s.incrementAiCalls.mockResolvedValue({ newCount: 1 });
  s.incrementCopilotCalls.mockResolvedValue({ newCount: 1 });
  s.getGlobalAiCallsToday.mockResolvedValue(0);
  s.incrementGlobalAiCalls.mockResolvedValue(undefined);
  s.claimGlobalAiAlert.mockResolvedValue(false);
});

// ─── aiRateLimit ──────────────────────────────────────────────────────────────

describe("aiRateLimit", () => {
  it("unauthenticated request → 401, next not called, no charge", async () => {
    const req = makeReq(false); const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    res.finish();
    expect(s.incrementAiCalls).not.toHaveBeenCalled();
  });

  it("under limit → next(); charges exactly ONCE, only after a 2xx finish", async () => {
    s.resetAiCallsIfNewDay.mockResolvedValue(undefined);
    s.getUserAiUsage.mockResolvedValue(usageFor("free", 3));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();

    await aiRateLimit(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    // Not charged during the middleware — the handler hasn't run yet.
    expect(s.incrementAiCalls).not.toHaveBeenCalled();
    // callsRemaining reflects the pending charge (10 - 3 - 1 = 6)
    expect(res.locals.aiCallsRemaining).toBe(FREE_TIER_DAILY_LIMIT - 3 - 1);

    // Handler succeeds → 200 finishes → charge once.
    res.finish(200);
    expect(s.incrementAiCalls).toHaveBeenCalledOnce();
    expect(s.incrementAiCalls).toHaveBeenCalledWith(1);
  });

  it("a FAILED response (non-2xx) charges ZERO — the fix", async () => {
    s.resetAiCallsIfNewDay.mockResolvedValue(undefined);
    s.getUserAiUsage.mockResolvedValue(usageFor("free", 3));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();

    await aiRateLimit(req, res, next);
    expect(next).toHaveBeenCalledOnce();

    // Anthropic error / timeout / empty → error handler sends 500 (or 400/422).
    res.finish(500);
    expect(s.incrementAiCalls).not.toHaveBeenCalled();
  });

  it.each([400, 401, 422, 429, 500, 503])("does not charge on a %d response", async (code) => {
    s.resetAiCallsIfNewDay.mockResolvedValue(undefined);
    s.getUserAiUsage.mockResolvedValue(usageFor("free", 0));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    res.finish(code);
    expect(s.incrementAiCalls).not.toHaveBeenCalled();
  });

  it("free tier AT limit → 429 with upgradePrompt, next not called, no charge even on finish", async () => {
    s.resetAiCallsIfNewDay.mockResolvedValue(undefined);
    s.getUserAiUsage.mockResolvedValue(usageFor("free", FREE_TIER_DAILY_LIMIT));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();

    await aiRateLimit(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    const body = res.json.mock.calls[0][0];
    expect(body.upgradePrompt).toBe(true);
    expect(body.callsLimit).toBe(FREE_TIER_DAILY_LIMIT);
    expect(next).not.toHaveBeenCalled();
    // The 429 path returns before hooking finish → firing finish never charges.
    res.finish(429);
    expect(s.incrementAiCalls).not.toHaveBeenCalled();
  });

  it("two concurrent successful responses charge by exactly TWO", async () => {
    let count = 5;
    s.resetAiCallsIfNewDay.mockResolvedValue(undefined);
    s.getUserAiUsage.mockResolvedValue(usageFor("test", 5));
    s.incrementAiCalls.mockImplementation(async () => ({ newCount: ++count }));

    const run = async () => {
      const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
      await aiRateLimit(req, res, next);
      return res;
    };
    const [r1, r2] = await Promise.all([run(), run()]);
    r1.finish(200);
    r2.finish(200);
    await new Promise(r => setTimeout(r, 0)); // let the fire-and-forget charges settle

    expect(s.incrementAiCalls).toHaveBeenCalledTimes(2);
    expect(count).toBe(7); // 5 → 7, +2, no lost update
  });

  it("test tier uses TEST_TIER_DAILY_LIMIT", async () => {
    s.resetAiCallsIfNewDay.mockResolvedValue(undefined);
    s.getUserAiUsage.mockResolvedValue(usageFor("test", TEST_TIER_DAILY_LIMIT));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0].callsLimit).toBe(TEST_TIER_DAILY_LIMIT);
    expect(next).not.toHaveBeenCalled();
  });

  it("premium tier is NEVER rate-limited and reports UNLIMITED remaining", async () => {
    s.resetAiCallsIfNewDay.mockResolvedValue(undefined);
    s.getUserAiUsage.mockResolvedValue(usageFor("premium", 99999));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.locals.aiCallsRemaining).toBe(UNLIMITED);
    res.finish(200);
    expect(s.incrementAiCalls).toHaveBeenCalledOnce(); // premium still counts internally
  });

  it("storage error → 500, no charge", async () => {
    s.resetAiCallsIfNewDay.mockRejectedValue(new Error("DB down"));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
    res.finish(500);
    expect(s.incrementAiCalls).not.toHaveBeenCalled();
  });
});

// ─── copilotRateLimit ─────────────────────────────────────────────────────────

describe("copilotRateLimit", () => {
  it("unauthenticated → 401", async () => {
    const req = makeReq(false); const res = makeRes(); const next = vi.fn();
    await copilotRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("under limit → next(); charges once only on a 2xx finish; accurate remaining", async () => {
    s.resetCopilotCallsIfNewDay.mockResolvedValue(undefined);
    s.getUserAiUsage.mockResolvedValue(usageFor("free", 0, 4));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();

    await copilotRateLimit(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(s.incrementCopilotCalls).not.toHaveBeenCalled();
    expect(res.locals.copilotCallsRemaining).toBe(COPILOT_FREE_TIER_DAILY_LIMIT - 4 - 1);

    res.finish(200);
    expect(s.incrementCopilotCalls).toHaveBeenCalledOnce();
    expect(s.incrementCopilotCalls).toHaveBeenCalledWith(1);
  });

  it("a failed copilot response charges zero", async () => {
    s.resetCopilotCallsIfNewDay.mockResolvedValue(undefined);
    s.getUserAiUsage.mockResolvedValue(usageFor("free", 0, 4));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await copilotRateLimit(req, res, next);
    res.finish(500);
    expect(s.incrementCopilotCalls).not.toHaveBeenCalled();
  });

  it("free tier AT COPILOT_FREE_TIER_DAILY_LIMIT → 429, no charge", async () => {
    s.resetCopilotCallsIfNewDay.mockResolvedValue(undefined);
    s.getUserAiUsage.mockResolvedValue(usageFor("free", 0, COPILOT_FREE_TIER_DAILY_LIMIT));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await copilotRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0].upgradePrompt).toBe(true);
    expect(next).not.toHaveBeenCalled();
    res.finish(429);
    expect(s.incrementCopilotCalls).not.toHaveBeenCalled();
  });

  it("test tier uses COPILOT_TEST_TIER_DAILY_LIMIT", async () => {
    s.resetCopilotCallsIfNewDay.mockResolvedValue(undefined);
    s.getUserAiUsage.mockResolvedValue(usageFor("test", 0, COPILOT_TEST_TIER_DAILY_LIMIT));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await copilotRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0].callsLimit).toBe(COPILOT_TEST_TIER_DAILY_LIMIT);
  });

  it("premium bypasses copilot rate limit; UNLIMITED remaining", async () => {
    s.resetCopilotCallsIfNewDay.mockResolvedValue(undefined);
    s.getUserAiUsage.mockResolvedValue(usageFor("premium", 0, 99999));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await copilotRateLimit(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.locals.copilotCallsRemaining).toBe(UNLIMITED);
  });

  it("storage error → 500", async () => {
    s.resetCopilotCallsIfNewDay.mockRejectedValue(new Error("DB down"));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await copilotRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });
});
