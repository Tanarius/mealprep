import { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import { storage } from "../storage";
import { User } from "@shared/schema";

// ── Tier limits ──────────────────────────────────────────────────────────────
// Free and premium are bounded on a MONTHLY window (calendar month, UTC). Premium's
// caps are deliberately high — essentially no genuine household will hit them — but
// finite: "unlimited" was an unbounded promise with real per-call cost behind it.
// Test accounts keep a generous DAILY window (internal QA use only).

export const FREE_MONTHLY_SUGGESTIONS = 30;
export const PREMIUM_MONTHLY_SUGGESTIONS = 500;
// applies to: /api/ai/suggest, /api/ai/weekly-plan, /api/ai/optimize-shopping-list,
//             /api/ai/clean-recipe/:id, and TEXT-mode social imports (Haiku-cheap)

export const FREE_MONTHLY_COPILOT = 100;
export const PREMIUM_MONTHLY_COPILOT = 1000;
// applies to: /api/ai/copilot/* only

export const FREE_MONTHLY_IMPORTS = 10;
export const PREMIUM_MONTHLY_IMPORTS = 100;
// applies to: /api/ai/import-from-social with mode === "image" ONLY — the Sonnet+vision
// path costs ~an order of magnitude more per call than the Haiku paths, so it gets its
// own tighter cap. Text-caption imports draw from the suggestions quota instead.

export const TEST_TIER_DAILY_LIMIT = 200;
export const COPILOT_TEST_TIER_DAILY_LIMIT = 200;
// applies to: test accounts (subscriptionTier = 'test'); daily window, exempt from
// monthly caps. Test accounts use the premium-sized import cap.

export const ONBOARDING_DISH_LIMIT = 10;
// applies to: /api/onboarding/dishes only

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface User extends User_ {}
  }
}
type User_ = import("@shared/schema").User;

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
    // Cache-served responses made no Anthropic call — they cost nothing, so they
    // charge nothing (handlers set res.locals.servedFromCache on cache hits).
    if (res.locals.servedFromCache) return;
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
    await storage.resetMonthlyCountersIfNewMonth(userId);
    const usage = await storage.getUserAiUsage(userId);

    const tier = usage.subscriptionTier;
    const isPremium = tier === 'premium';
    const isTest = tier === 'test';

    // Image-mode social import → the dedicated (tighter) monthly import cap. This is the
    // Sonnet+vision path; it never draws from the suggestions quota, and vice versa.
    if ((req.body as any)?.mode === "image") {
      const importLimit = tier === 'free' ? FREE_MONTHLY_IMPORTS : PREMIUM_MONTHLY_IMPORTS;
      if (usage.importsMonth >= importLimit) {
        storage.logEvent(userId, "ai_limit_reached", { kind: "imports", tier });
        return res.status(429).json({
          error: isPremium
            ? "You've reached this month's screenshot import limit — it resets on the 1st."
            : "Monthly screenshot import limit reached",
          upgradePrompt: !isPremium && !isTest,
          callsUsed: usage.importsMonth,
          callsLimit: importLimit
        });
      }
      res.locals.aiCallsRemaining = Math.max(0, importLimit - usage.importsMonth - 1);
      chargeOnSuccess(res, "__aiCharged", () => Promise.all([
        storage.incrementImportCalls(userId),
        storage.incrementGlobalAiCalls(VISION_CALL_UNITS),
      ]));
      return next();
    }

    // Test accounts: daily window. Free/premium: monthly window (the binding limit).
    const limit = isTest ? TEST_TIER_DAILY_LIMIT : isPremium ? PREMIUM_MONTHLY_SUGGESTIONS : FREE_MONTHLY_SUGGESTIONS;
    const used = isTest ? usage.aiCallsToday : usage.aiCallsMonth;
    if (used >= limit) {
      // At the limit: reject up front. No charge — we return before hooking the response.
      storage.logEvent(userId, "ai_limit_reached", { kind: "suggestions", tier });
      return res.status(429).json({
        error: isTest ? "Daily assistant limit reached"
          : isPremium ? "You've reached this month's fair-use limit — it resets on the 1st."
          : "Monthly suggestions limit reached",
        upgradePrompt: !isPremium && !isTest,
        callsUsed: used,
        callsLimit: limit
      });
    }

    // Remaining AFTER this (pending) call, so handlers surface an accurate count.
    // Always a real number — the UNLIMITED (9999) sentinel is retired.
    res.locals.aiCallsRemaining = Math.max(0, limit - used - 1);
    chargeOnSuccess(res, "__aiCharged", () => Promise.all([
      storage.incrementAiCalls(userId),
      storage.incrementGlobalAiCalls(1),
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
    await storage.resetMonthlyCountersIfNewMonth(userId);
    const usage = await storage.getUserAiUsage(userId);

    const tier = usage.subscriptionTier;
    const isPremium = tier === 'premium';
    const isTest = tier === 'test';

    // Test accounts: daily window. Free/premium: monthly window (the binding limit).
    const copilotLimit = isTest ? COPILOT_TEST_TIER_DAILY_LIMIT : isPremium ? PREMIUM_MONTHLY_COPILOT : FREE_MONTHLY_COPILOT;
    const used = isTest ? usage.copilotCallsToday : usage.copilotCallsMonth;
    if (used >= copilotLimit) {
      storage.logEvent(userId, "ai_limit_reached", { kind: "copilot", tier });
      return res.status(429).json({
        error: isTest ? "Daily Copilot chat limit reached"
          : isPremium ? "You've reached this month's fair-use limit — it resets on the 1st."
          : "Monthly assistant message limit reached",
        upgradePrompt: !isPremium && !isTest,
        callsUsed: used,
        callsLimit: copilotLimit
      });
    }

    // Always a real number — the UNLIMITED (9999) sentinel is retired.
    res.locals.copilotCallsRemaining = Math.max(0, copilotLimit - used - 1);
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
