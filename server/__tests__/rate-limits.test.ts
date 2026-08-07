/**
 * Rate limit middleware unit tests — no HTTP, no database.
 *
 * Tests aiRateLimit and copilotRateLimit directly with mock req/res/next. Since the
 * finite-caps change, free and premium tiers are bounded on a MONTHLY window (test
 * accounts keep a daily window), premium is finite (no more UNLIMITED sentinel), and
 * image-mode social imports draw from a dedicated tighter monthly cap. The quota is
 * charged only when the response FINISHES successfully (2xx):
 *  - unauthenticated → 401, no charge
 *  - at/over the binding cap → 429 (upgradePrompt only for free), no charge
 *  - a successful (2xx) response charges exactly once, AFTER the response
 *  - a failed (non-2xx) response charges zero (the billing-integrity fix)
 *  - callsRemaining is always a real number reflecting the pending charge
 *  - storage error → 500
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../storage", () => ({
  storage: {
    resetAiCallsIfNewDay: vi.fn(),
    resetCopilotCallsIfNewDay: vi.fn(),
    resetMonthlyCountersIfNewMonth: vi.fn(),
    getUserAiUsage: vi.fn(),
    incrementAiCalls: vi.fn(),
    incrementCopilotCalls: vi.fn(),
    incrementImportCalls: vi.fn(),
    // Global breaker (tested in global-breaker.test.ts) — benign defaults here
    getGlobalAiCallsToday: vi.fn(),
    incrementGlobalAiCalls: vi.fn(),
    claimGlobalAiAlert: vi.fn(),
    logEvent: vi.fn(async () => {}),
  },
}));

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { storage } from "../storage";
import {
  aiRateLimit,
  copilotRateLimit,
  FREE_MONTHLY_SUGGESTIONS,
  PREMIUM_MONTHLY_SUGGESTIONS,
  FREE_MONTHLY_COPILOT,
  PREMIUM_MONTHLY_COPILOT,
  FREE_MONTHLY_IMPORTS,
  PREMIUM_MONTHLY_IMPORTS,
  TEST_TIER_DAILY_LIMIT,
  COPILOT_TEST_TIER_DAILY_LIMIT,
} from "../middleware/aiRateLimit";

type MockedStorage = { [K in keyof typeof storage]: ReturnType<typeof vi.fn> };
const s = storage as unknown as MockedStorage;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(authenticated: boolean, userId = 1, body: Record<string, unknown> = {}) {
  return {
    isAuthenticated: () => authenticated,
    user: authenticated ? { id: userId } : undefined,
    body,
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

function usageFor(tier: string, overrides: Record<string, number> = {}) {
  return {
    subscriptionTier: tier,
    aiCallsToday: 0, copilotCallsToday: 0,
    aiCallsMonth: 0, copilotCallsMonth: 0, importsMonth: 0,
    ...overrides,
  };
}

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  vi.clearAllMocks();
  s.resetAiCallsIfNewDay.mockResolvedValue(undefined);
  s.resetCopilotCallsIfNewDay.mockResolvedValue(undefined);
  s.resetMonthlyCountersIfNewMonth.mockResolvedValue(undefined);
  s.incrementAiCalls.mockResolvedValue({ newCount: 1 });
  s.incrementCopilotCalls.mockResolvedValue({ newCount: 1 });
  s.incrementImportCalls.mockResolvedValue({ newCount: 1 });
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

  it("free under monthly cap → next(); charges exactly ONCE, only after a 2xx finish", async () => {
    s.getUserAiUsage.mockResolvedValue(usageFor("free", { aiCallsMonth: 3 }));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();

    await aiRateLimit(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    // Not charged during the middleware — the handler hasn't run yet.
    expect(s.incrementAiCalls).not.toHaveBeenCalled();
    // callsRemaining reflects the pending charge (30 - 3 - 1 = 26)
    expect(res.locals.aiCallsRemaining).toBe(FREE_MONTHLY_SUGGESTIONS - 3 - 1);

    res.finish(200);
    await flush();
    expect(s.incrementAiCalls).toHaveBeenCalledOnce();
    expect(s.incrementAiCalls).toHaveBeenCalledWith(1);
  });

  it("a FAILED response (non-2xx) charges ZERO", async () => {
    s.getUserAiUsage.mockResolvedValue(usageFor("free", { aiCallsMonth: 3 }));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    res.finish(500);
    await flush();
    expect(s.incrementAiCalls).not.toHaveBeenCalled();
  });

  it.each([400, 401, 422, 429, 500, 503])("does not charge on a %d response", async (code) => {
    s.getUserAiUsage.mockResolvedValue(usageFor("free"));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    res.finish(code);
    await flush();
    expect(s.incrementAiCalls).not.toHaveBeenCalled();
  });

  it("free tier AT monthly cap → 429 with upgradePrompt, next not called, no charge", async () => {
    s.getUserAiUsage.mockResolvedValue(usageFor("free", { aiCallsMonth: FREE_MONTHLY_SUGGESTIONS }));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();

    await aiRateLimit(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    const body = res.json.mock.calls[0][0];
    expect(body.upgradePrompt).toBe(true);
    expect(body.callsLimit).toBe(FREE_MONTHLY_SUGGESTIONS);
    expect(next).not.toHaveBeenCalled();
    res.finish(429);
    await flush();
    expect(s.incrementAiCalls).not.toHaveBeenCalled();
  });

  it("premium is FINITE: at PREMIUM_MONTHLY_SUGGESTIONS → 429 with honest message, NO upgradePrompt", async () => {
    s.getUserAiUsage.mockResolvedValue(usageFor("premium", { aiCallsMonth: PREMIUM_MONTHLY_SUGGESTIONS }));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    const body = res.json.mock.calls[0][0];
    expect(body.upgradePrompt).toBe(false);
    expect(body.callsLimit).toBe(PREMIUM_MONTHLY_SUGGESTIONS);
    expect(body.error).toContain("resets on the 1st");
    expect(next).not.toHaveBeenCalled();
  });

  it("premium under cap → proceeds and reports a REAL remaining count (no 9999 sentinel)", async () => {
    s.getUserAiUsage.mockResolvedValue(usageFor("premium", { aiCallsMonth: 120 }));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.locals.aiCallsRemaining).toBe(PREMIUM_MONTHLY_SUGGESTIONS - 120 - 1);
    res.finish(200);
    await flush();
    expect(s.incrementAiCalls).toHaveBeenCalledOnce();
  });

  it("test tier stays on the DAILY window (monthly counters ignored)", async () => {
    s.getUserAiUsage.mockResolvedValue(usageFor("test", { aiCallsToday: TEST_TIER_DAILY_LIMIT, aiCallsMonth: 0 }));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0].callsLimit).toBe(TEST_TIER_DAILY_LIMIT);
    expect(res.json.mock.calls[0][0].upgradePrompt).toBe(false);
  });

  it("monthly reset helper runs before the usage read", async () => {
    s.getUserAiUsage.mockResolvedValue(usageFor("free"));
    await aiRateLimit(makeReq(true, 1), makeRes(), vi.fn());
    expect(s.resetMonthlyCountersIfNewMonth).toHaveBeenCalledWith(1);
    const resetOrder = s.resetMonthlyCountersIfNewMonth.mock.invocationCallOrder[0];
    const readOrder = s.getUserAiUsage.mock.invocationCallOrder[0];
    expect(resetOrder).toBeLessThan(readOrder);
  });

  it("two concurrent successful responses charge by exactly TWO", async () => {
    let count = 5;
    s.getUserAiUsage.mockResolvedValue(usageFor("test", { aiCallsToday: 5 }));
    s.incrementAiCalls.mockImplementation(async () => ({ newCount: ++count }));

    const run = async () => {
      const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
      await aiRateLimit(req, res, next);
      return res;
    };
    const [r1, r2] = await Promise.all([run(), run()]);
    r1.finish(200);
    r2.finish(200);
    await flush();

    expect(s.incrementAiCalls).toHaveBeenCalledTimes(2);
    expect(count).toBe(7); // 5 → 7, +2, no lost update
  });

  it("storage error → 500, no charge", async () => {
    s.resetAiCallsIfNewDay.mockRejectedValue(new Error("DB down"));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
    res.finish(500);
    await flush();
    expect(s.incrementAiCalls).not.toHaveBeenCalled();
  });
});

// ─── image-mode social imports (dedicated monthly cap) ────────────────────────

describe("aiRateLimit — image-mode imports", () => {
  it("free under import cap → proceeds; charges the IMPORT counter, not suggestions", async () => {
    s.getUserAiUsage.mockResolvedValue(usageFor("free", { importsMonth: 4 }));
    const req = makeReq(true, 1, { mode: "image", content: "..." });
    const res = makeRes(); const next = vi.fn();

    await aiRateLimit(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.locals.aiCallsRemaining).toBe(FREE_MONTHLY_IMPORTS - 4 - 1);
    res.finish(200);
    await flush();
    expect(s.incrementImportCalls).toHaveBeenCalledOnce();
    expect(s.incrementAiCalls).not.toHaveBeenCalled();
  });

  it("free AT import cap → 429 with upgradePrompt; suggestions quota untouched by the check", async () => {
    s.getUserAiUsage.mockResolvedValue(usageFor("free", { importsMonth: FREE_MONTHLY_IMPORTS, aiCallsMonth: 0 }));
    const req = makeReq(true, 1, { mode: "image", content: "..." });
    const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    const body = res.json.mock.calls[0][0];
    expect(body.upgradePrompt).toBe(true);
    expect(body.callsLimit).toBe(FREE_MONTHLY_IMPORTS);
    expect(next).not.toHaveBeenCalled();
  });

  it("premium AT import cap → 429 honest message, no upgradePrompt", async () => {
    s.getUserAiUsage.mockResolvedValue(usageFor("premium", { importsMonth: PREMIUM_MONTHLY_IMPORTS }));
    const req = makeReq(true, 1, { mode: "image", content: "..." });
    const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0].upgradePrompt).toBe(false);
    expect(res.json.mock.calls[0][0].callsLimit).toBe(PREMIUM_MONTHLY_IMPORTS);
  });

  it("TEXT-mode imports draw from the suggestions quota, not the import cap", async () => {
    s.getUserAiUsage.mockResolvedValue(usageFor("free", { importsMonth: FREE_MONTHLY_IMPORTS, aiCallsMonth: 2 }));
    const req = makeReq(true, 1, { mode: "text", content: "caption" });
    const res = makeRes(); const next = vi.fn();

    await aiRateLimit(req, res, next);

    // Import cap is exhausted, but text mode doesn't consult it
    expect(next).toHaveBeenCalledOnce();
    expect(res.locals.aiCallsRemaining).toBe(FREE_MONTHLY_SUGGESTIONS - 2 - 1);
    res.finish(200);
    await flush();
    expect(s.incrementAiCalls).toHaveBeenCalledOnce();
    expect(s.incrementImportCalls).not.toHaveBeenCalled();
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

  it("free under monthly cap → next(); charges once only on a 2xx finish; accurate remaining", async () => {
    s.getUserAiUsage.mockResolvedValue(usageFor("free", { copilotCallsMonth: 4 }));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();

    await copilotRateLimit(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(s.incrementCopilotCalls).not.toHaveBeenCalled();
    expect(res.locals.copilotCallsRemaining).toBe(FREE_MONTHLY_COPILOT - 4 - 1);

    res.finish(200);
    await flush();
    expect(s.incrementCopilotCalls).toHaveBeenCalledOnce();
    expect(s.incrementCopilotCalls).toHaveBeenCalledWith(1);
  });

  it("a failed copilot response charges zero", async () => {
    s.getUserAiUsage.mockResolvedValue(usageFor("free", { copilotCallsMonth: 4 }));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await copilotRateLimit(req, res, next);
    res.finish(500);
    await flush();
    expect(s.incrementCopilotCalls).not.toHaveBeenCalled();
  });

  it("free tier AT monthly copilot cap → 429 with upgradePrompt, no charge", async () => {
    s.getUserAiUsage.mockResolvedValue(usageFor("free", { copilotCallsMonth: FREE_MONTHLY_COPILOT }));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await copilotRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0].upgradePrompt).toBe(true);
    expect(res.json.mock.calls[0][0].callsLimit).toBe(FREE_MONTHLY_COPILOT);
    expect(next).not.toHaveBeenCalled();
    res.finish(429);
    await flush();
    expect(s.incrementCopilotCalls).not.toHaveBeenCalled();
  });

  it("premium is FINITE: at PREMIUM_MONTHLY_COPILOT → 429 honest message", async () => {
    s.getUserAiUsage.mockResolvedValue(usageFor("premium", { copilotCallsMonth: PREMIUM_MONTHLY_COPILOT }));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await copilotRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0].upgradePrompt).toBe(false);
    expect(res.json.mock.calls[0][0].callsLimit).toBe(PREMIUM_MONTHLY_COPILOT);
  });

  it("premium under cap → real remaining count (no 9999 sentinel)", async () => {
    s.getUserAiUsage.mockResolvedValue(usageFor("premium", { copilotCallsMonth: 250 }));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await copilotRateLimit(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.locals.copilotCallsRemaining).toBe(PREMIUM_MONTHLY_COPILOT - 250 - 1);
  });

  it("test tier stays on the DAILY window", async () => {
    s.getUserAiUsage.mockResolvedValue(usageFor("test", { copilotCallsToday: COPILOT_TEST_TIER_DAILY_LIMIT }));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await copilotRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0].callsLimit).toBe(COPILOT_TEST_TIER_DAILY_LIMIT);
  });

  it("storage error → 500", async () => {
    s.resetCopilotCallsIfNewDay.mockRejectedValue(new Error("DB down"));
    const req = makeReq(true, 1); const res = makeRes(); const next = vi.fn();
    await copilotRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });
});
