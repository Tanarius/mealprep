import { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import { storage } from "../storage";
import { User } from "@shared/schema";

export const FREE_TIER_DAILY_LIMIT = 10;
// applies to: /api/ai/suggest, /api/ai/weekly-plan, /api/ai/optimize-shopping-list, /api/ai/clean-recipe/:id

export const TEST_TIER_DAILY_LIMIT = 200;
// applies to: test accounts (subscriptionTier = 'test')

export const COPILOT_FREE_TIER_DAILY_LIMIT = 30;
// applies to: /api/ai/copilot/chat only

export const COPILOT_TEST_TIER_DAILY_LIMIT = 200;
// applies to: test accounts copilot calls

export const ONBOARDING_DISH_LIMIT = 10;
// applies to: /api/onboarding/dishes only

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface User extends User_ {}
  }
}
type User_ = import("@shared/schema").User;

// Premium sentinel returned to the client for callsRemaining (matches routes/ai.ts).
export const UNLIMITED = 9999;

// ── Global daily circuit breaker ─────────────────────────────────────────────
// Aggregate ceiling on AI calls across ALL users, counted in units (a Haiku-backed
// call = 1, a Sonnet vision call = VISION_CALL_UNITS — the liability is dollars, not
// call count). Per-user limits bound one account; this bounds the whole day's spend,
// including disposable-account farming and — until finite tier caps land — premium
// accounts, which bypass the per-user limits entirely. Deliberately NO premium bypass
// of the hard limit: an uncapped bypass would reopen the unbounded liability.
function envInt(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
export const AI_DAILY_SOFT_LIMIT = envInt("AI_DAILY_SOFT_LIMIT", 2000);
export const AI_DAILY_HARD_LIMIT = envInt("AI_DAILY_HARD_LIMIT", 5000);
export const VISION_CALL_UNITS = 5;
export const BREAKER_MESSAGE = "Simmer's assistant is taking a short break — please try again later.";

// Sends the 503 and returns true when the breaker is tripped. Alerts (soft warning /
// hard error) fire once per day each, via an atomic DB claim — not per request.
async function globalBreakerTripped(res: Response): Promise<boolean> {
  const callsToday = await storage.getGlobalAiCallsToday();
  if (callsToday >= AI_DAILY_HARD_LIMIT) {
    if (await storage.claimGlobalAiAlert("hard")) {
      console.error(`[breaker] global AI hard limit reached (${callsToday}/${AI_DAILY_HARD_LIMIT}) — AI endpoints disabled until tomorrow`);
      Sentry.captureException(new Error(`Global AI hard limit reached: ${callsToday}/${AI_DAILY_HARD_LIMIT}`));
    }
    res.status(503).json({ error: BREAKER_MESSAGE });
    return true;
  }
  if (callsToday >= AI_DAILY_SOFT_LIMIT && await storage.claimGlobalAiAlert("soft")) {
    console.warn(`[breaker] global AI soft limit crossed (${callsToday}/${AI_DAILY_SOFT_LIMIT})`);
    Sentry.captureMessage(`Global AI soft limit crossed: ${callsToday}/${AI_DAILY_SOFT_LIMIT}`, "warning");
  }
  return false;
}

// Charge the quota only once the response finishes successfully (2xx). Registering this on
// `finish` (rather than incrementing up front) means a failed handler — Anthropic error,
// timeout, validation 400, empty-response 422, 500 — never burns the user's daily quota.
// Guarded so a doubly-applied middleware (import-from-social lists aiRateLimit twice) charges
// exactly once. Fire-and-forget: the response is already sent; a rare charge failure just
// under-counts, which favours the user.
function chargeOnSuccess(res: Response, hookedFlag: string, charge: () => Promise<unknown>) {
  if ((res.locals as any)[hookedFlag]) return;
  (res.locals as any)[hookedFlag] = true;
  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      charge().catch(err => console.error("[rateLimit] quota charge failed:", err));
    }
  });
}

export async function aiRateLimit(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.isAuthenticated() || !req.user || !(req.user as any).id) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const userId = (req.user as any).id;

    // Global breaker first — a tripped breaker short-circuits before any per-user queries.
    if (await globalBreakerTripped(res)) return;

    await storage.resetAiCallsIfNewDay(userId);
    const usage = await storage.getUserAiUsage(userId);

    const isPremium = usage.subscriptionTier === 'premium';
    const limit = usage.subscriptionTier === 'test' ? TEST_TIER_DAILY_LIMIT : FREE_TIER_DAILY_LIMIT;
    if (!isPremium && usage.aiCallsToday >= limit) {
      // At the limit: reject up front. No charge — we return before hooking the response.
      return res.status(429).json({
        error: "Daily assistant limit reached",
        upgradePrompt: true,
        callsUsed: usage.aiCallsToday,
        callsLimit: limit
      });
    }

    // Remaining AFTER this (pending) call, so handlers surface an accurate count.
    res.locals.aiCallsRemaining = isPremium ? UNLIMITED : Math.max(0, limit - usage.aiCallsToday - 1);
    // Vision-mode screenshot imports run on Sonnet + image tokens (~an order of magnitude
    // pricier than the Haiku paths), so they weigh more against the global daily ceiling.
    const globalUnits = (req.body as any)?.mode === "image" ? VISION_CALL_UNITS : 1;
    chargeOnSuccess(res, "__aiCharged", () => Promise.all([
      storage.incrementAiCalls(userId),
      storage.incrementGlobalAiCalls(globalUnits),
    ]));
    next();
  } catch (error) {
    console.error("Rate limit check failed:", error);
    res.status(500).json({ error: "Failed to verify assistant usage limits" });
  }
}

export async function copilotRateLimit(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.isAuthenticated() || !req.user || !(req.user as any).id) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const userId = (req.user as any).id;

    // Global breaker first — a tripped breaker short-circuits before any per-user queries.
    if (await globalBreakerTripped(res)) return;

    await storage.resetCopilotCallsIfNewDay(userId);
    const usage = await storage.getUserAiUsage(userId);

    const isPremium = usage.subscriptionTier === 'premium';
    const copilotLimit = usage.subscriptionTier === 'test' ? COPILOT_TEST_TIER_DAILY_LIMIT : COPILOT_FREE_TIER_DAILY_LIMIT;
    if (!isPremium && usage.copilotCallsToday >= copilotLimit) {
      return res.status(429).json({
        error: "Daily Copilot chat limit reached",
        upgradePrompt: true,
        callsUsed: usage.copilotCallsToday,
        callsLimit: copilotLimit
      });
    }

    res.locals.copilotCallsRemaining = isPremium ? UNLIMITED : Math.max(0, copilotLimit - usage.copilotCallsToday - 1);
    chargeOnSuccess(res, "__copilotCharged", () => Promise.all([
      storage.incrementCopilotCalls(userId),
      storage.incrementGlobalAiCalls(1),
    ]));
    next();
  } catch (error) {
    console.error("Copilot rate limit check failed:", error);
    res.status(500).json({ error: "Failed to verify Copilot usage limits" });
  }
}
