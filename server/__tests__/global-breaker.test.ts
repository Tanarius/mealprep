/**
 * Global AI spend circuit breaker — middleware-level unit tests (no HTTP, no DB).
 *
 * The breaker is an aggregate daily ceiling across ALL users, checked in both
 * aiRateLimit and copilotRateLimit before any per-user work:
 *  - below both thresholds → request proceeds; a 2xx finish increments the global
 *    counter (weight 1, or VISION_CALL_UNITS for image-mode imports)
 *  - at/above the hard limit → 503, next() not called, no per-user or global charge
 *  - at/above the soft limit → request proceeds; the warning fires only for the
 *    caller that wins the once-per-day claim
 *  - non-2xx finish → nothing charged (mirrors the per-user billing-integrity rule)
 * Storage-level atomicity (single-statement upserts with the date-folded reset) is
 * asserted in global-breaker-storage.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../storage", () => ({
  storage: {
    resetAiCallsIfNewDay: vi.fn(),
    getUserAiUsage: vi.fn(),
    incrementAiCalls: vi.fn(),
    resetCopilotCallsIfNewDay: vi.fn(),
    incrementCopilotCalls: vi.fn(),
    getGlobalAiCallsToday: vi.fn(),
    incrementGlobalAiCalls: vi.fn(),
    claimGlobalAiAlert: vi.fn(),
  },
}));

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import * as Sentry from "@sentry/node";
import { storage } from "../storage";
import {
  aiRateLimit,
  copilotRateLimit,
  AI_DAILY_SOFT_LIMIT,
  AI_DAILY_HARD_LIMIT,
  VISION_CALL_UNITS,
  BREAKER_MESSAGE,
} from "../middleware/aiRateLimit";

type MockedStorage = { [K in keyof typeof storage]: ReturnType<typeof vi.fn> };
const s = storage as unknown as MockedStorage;

function makeReq(authenticated = true, body: Record<string, unknown> = {}) {
  return {
    isAuthenticated: () => authenticated,
    user: authenticated ? { id: 1 } : undefined,
    body,
  } as any;
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

// Flush the fire-and-forget charge promises registered on finish.
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  vi.clearAllMocks();
  s.resetAiCallsIfNewDay.mockResolvedValue(undefined);
  s.resetCopilotCallsIfNewDay.mockResolvedValue(undefined);
  s.getUserAiUsage.mockResolvedValue({ subscriptionTier: "free", aiCallsToday: 0, copilotCallsToday: 0 });
  s.incrementAiCalls.mockResolvedValue({ newCount: 1 });
  s.incrementCopilotCalls.mockResolvedValue({ newCount: 1 });
  s.getGlobalAiCallsToday.mockResolvedValue(0);
  s.incrementGlobalAiCalls.mockResolvedValue(undefined);
  s.claimGlobalAiAlert.mockResolvedValue(false);
});

describe("global breaker — aiRateLimit", () => {
  it("below both thresholds → proceeds; 2xx finish charges global counter by 1", async () => {
    const req = makeReq(); const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    expect(next).toHaveBeenCalled();
    res.finish(200);
    await flush();
    expect(s.incrementGlobalAiCalls).toHaveBeenCalledWith(1);
    expect(s.incrementAiCalls).toHaveBeenCalledWith(1);
  });

  it("image-mode import weighs VISION_CALL_UNITS against the global counter", async () => {
    const req = makeReq(true, { mode: "image", content: "..." });
    const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    res.finish(200);
    await flush();
    expect(s.incrementGlobalAiCalls).toHaveBeenCalledWith(VISION_CALL_UNITS);
  });

  it("at the hard limit → 503 with honest message, next() not called, nothing charged", async () => {
    s.getGlobalAiCallsToday.mockResolvedValue(AI_DAILY_HARD_LIMIT);
    const req = makeReq(); const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: BREAKER_MESSAGE });
    expect(next).not.toHaveBeenCalled();
    // No per-user work at all — the breaker short-circuits before it
    expect(s.resetAiCallsIfNewDay).not.toHaveBeenCalled();
    res.finish(503);
    await flush();
    expect(s.incrementAiCalls).not.toHaveBeenCalled();
    expect(s.incrementGlobalAiCalls).not.toHaveBeenCalled();
  });

  it("hard trip captures a Sentry error only for the caller that wins the daily claim", async () => {
    s.getGlobalAiCallsToday.mockResolvedValue(AI_DAILY_HARD_LIMIT + 10);
    s.claimGlobalAiAlert.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const next = vi.fn();
    await aiRateLimit(makeReq(), makeRes(), next);
    await aiRateLimit(makeReq(), makeRes(), next);
    expect(s.claimGlobalAiAlert).toHaveBeenCalledWith("hard");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("soft crossing → request still proceeds; warning fires only on a won claim", async () => {
    s.getGlobalAiCallsToday.mockResolvedValue(AI_DAILY_SOFT_LIMIT);
    s.claimGlobalAiAlert.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const next1 = vi.fn(); const next2 = vi.fn();
    await aiRateLimit(makeReq(), makeRes(), next1);
    await aiRateLimit(makeReq(), makeRes(), next2);
    expect(next1).toHaveBeenCalled();
    expect(next2).toHaveBeenCalled();
    expect(s.claimGlobalAiAlert).toHaveBeenCalledWith("soft");
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it("non-2xx finish → global counter not charged", async () => {
    const req = makeReq(); const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    res.finish(500);
    await flush();
    expect(s.incrementGlobalAiCalls).not.toHaveBeenCalled();
  });

  it("unauthenticated → 401 before the breaker is even consulted", async () => {
    const req = makeReq(false); const res = makeRes(); const next = vi.fn();
    await aiRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(s.getGlobalAiCallsToday).not.toHaveBeenCalled();
  });
});

describe("global breaker — copilotRateLimit", () => {
  it("at the hard limit → 503, no per-user work, nothing charged", async () => {
    s.getGlobalAiCallsToday.mockResolvedValue(AI_DAILY_HARD_LIMIT);
    const req = makeReq(); const res = makeRes(); const next = vi.fn();
    await copilotRateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
    expect(s.resetCopilotCallsIfNewDay).not.toHaveBeenCalled();
    res.finish(503);
    await flush();
    expect(s.incrementCopilotCalls).not.toHaveBeenCalled();
    expect(s.incrementGlobalAiCalls).not.toHaveBeenCalled();
  });

  it("below thresholds → proceeds; 2xx finish charges global counter by 1", async () => {
    const req = makeReq(); const res = makeRes(); const next = vi.fn();
    await copilotRateLimit(req, res, next);
    expect(next).toHaveBeenCalled();
    res.finish(200);
    await flush();
    expect(s.incrementGlobalAiCalls).toHaveBeenCalledWith(1);
    expect(s.incrementCopilotCalls).toHaveBeenCalledWith(1);
  });
});
