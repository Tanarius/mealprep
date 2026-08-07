/**
 * Cache quota integrity — cache hits cost nothing, so they charge nothing and
 * report the user's REAL remaining count (never the retired 9999 sentinel).
 *
 * Middleware contract: handlers set res.locals.servedFromCache = true on a cache
 * hit; the finish-hook registered by chargeOnSuccess skips the charge when it's
 * set. The remaining count the middleware precomputed assumed a pending charge
 * (limit - used - 1); an uncharged cache hit reports one higher (limit - used) —
 * the handlers add that 1 back (see routes/ai.ts cache-hit sites).
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
    getGlobalAiCallsToday: vi.fn(),
    incrementGlobalAiCalls: vi.fn(),
    claimGlobalAiAlert: vi.fn(),
  },
}));

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { storage } from "../storage";
import { aiRateLimit, FREE_MONTHLY_SUGGESTIONS } from "../middleware/aiRateLimit";

type MockedStorage = { [K in keyof typeof storage]: ReturnType<typeof vi.fn> };
const s = storage as unknown as MockedStorage;

function makeReq() {
  return { isAuthenticated: () => true, user: { id: 1 }, body: {} } as any;
}

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

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  vi.clearAllMocks();
  s.resetAiCallsIfNewDay.mockResolvedValue(undefined);
  s.resetMonthlyCountersIfNewMonth.mockResolvedValue(undefined);
  s.getUserAiUsage.mockResolvedValue({
    subscriptionTier: "free",
    aiCallsToday: 0, copilotCallsToday: 0,
    aiCallsMonth: 5, copilotCallsMonth: 0, importsMonth: 0,
  });
  s.incrementAiCalls.mockResolvedValue({ newCount: 1 });
  s.getGlobalAiCallsToday.mockResolvedValue(0);
  s.incrementGlobalAiCalls.mockResolvedValue(undefined);
  s.claimGlobalAiAlert.mockResolvedValue(false);
});

describe("cache-hit quota integrity", () => {
  it("a cache-served 200 charges NOTHING (per-user or global)", async () => {
    const req = makeReq(); const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    expect(next).toHaveBeenCalledOnce();

    // Handler found a cache hit: sets the flag, responds 200.
    res.locals.servedFromCache = true;
    res.finish(200);
    await flush();

    expect(s.incrementAiCalls).not.toHaveBeenCalled();
    expect(s.incrementGlobalAiCalls).not.toHaveBeenCalled();
  });

  it("a cache MISS still charges exactly once", async () => {
    const req = makeReq(); const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    res.finish(200); // no servedFromCache flag
    await flush();
    expect(s.incrementAiCalls).toHaveBeenCalledOnce();
    expect(s.incrementGlobalAiCalls).toHaveBeenCalledOnce();
  });

  it("the middleware's precomputed remaining is real (free tier: limit - used - 1), so the handler's +1 on cache hits yields limit - used", async () => {
    const req = makeReq(); const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    // 5 used of 30 → pending-charge remaining is 24; a cache hit reports 24 + 1 = 25
    expect(res.locals.aiCallsRemaining).toBe(FREE_MONTHLY_SUGGESTIONS - 5 - 1);
    expect(res.locals.aiCallsRemaining + 1).toBe(FREE_MONTHLY_SUGGESTIONS - 5);
  });
});
