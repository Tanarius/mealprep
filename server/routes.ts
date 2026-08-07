import type { Express } from "express";
import type { Server } from "http";
import * as Sentry from "@sentry/node";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import aiRoutes from "./routes/ai";
import onboardingRoutes from "./routes/onboarding";
import billingRoutes from "./routes/billing";
import snacksRoutes from "./routes/snacks";
import { requireAuth, authedUser, isSafeUrl, isPrivateAddress } from "./middleware/requireAuth";
import { lookup } from "dns/promises";
import { insertRecipeSchema, insertWeeklyPlanSchema, insertPantryStapleSchema, updateUserTasteProfileSchema, type InsertWeeklyPlan } from "@shared/schema";
import { guessCategory, guessCuisine } from "./utils/categorization";
import { checkHouseholdJoinCap, joinCapError, householdIsPremium, FREE_ACTIVITY_LIMIT, PREMIUM_ACTIVITY_LIMIT } from "./utils/householdLimit";
import { detectTags } from "./utils/autoTag";
import { buildShoppingList } from "./utils/shoppingList";
import { enrichWithNutrition, extractRecipeByUrl, searchRecipeImage } from "./services/spoonacular";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Parse an ISO 8601 duration (e.g. PT1H30M, PT45M, PT2H) into minutes.
 */
function parseDuration(iso: string | undefined | null): number {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || "0", 10);
  const mins = parseInt(match[2] || "0", 10);
  return hours * 60 + mins;
}

/**
 * Guess a store category from an ingredient name string.
 */
/**
 * Parse a raw ingredient string like "2 cups all-purpose flour" into structured parts.
 */
function parseIngredientString(raw: string): { name: string; amount: number; unit: string } {
  // Clean up common unicode fractions — replace with space + fraction so "1½" becomes "1 1/2"
  let s = raw.trim()
    .replace(/½/g, " 1/2").replace(/⅓/g, " 1/3").replace(/⅔/g, " 2/3")
    .replace(/¼/g, " 1/4").replace(/¾/g, " 3/4")
    .replace(/⅛/g, " 1/8").replace(/⅜/g, " 3/8").replace(/⅝/g, " 5/8").replace(/⅞/g, " 7/8")
    .replace(/⅙/g, " 1/6").replace(/⅚/g, " 5/6")
    .replace(/ {2,}/g, " ")
    .trim();

  const units = "cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|cloves?|cans?|heads?|bunch(?:es)?|packages?|packs?|slices?|pieces?|stalks?|bags?|quarts?|gallons?|pints?|liters?|ml|grams?|g|kg|dash(?:es)?|pinch(?:es)?|sprigs?|leaves|sticks?";

  // Strategy: try multiple patterns from most specific to least

  // Pattern 1: "1 1/2 cups flour" — whole + fraction + unit + name
  let match = s.match(new RegExp(`^(\\d+)\\s+(\\d+)\\s*/\\s*(\\d+)\\s+(${units})\\s+(.+)$`, "i"));
  if (match) {
    const amount = Math.round((parseInt(match[1]) + parseInt(match[2]) / parseInt(match[3])) * 100) / 100;
    return { amount, unit: match[4].toLowerCase().replace(/s$/, ""), name: match[5].trim() };
  }

  // Pattern 2: "1/3 cup butter" — fraction + unit + name
  match = s.match(new RegExp(`^(\\d+)\\s*/\\s*(\\d+)\\s+(${units})\\s+(.+)$`, "i"));
  if (match) {
    const amount = Math.round((parseInt(match[1]) / parseInt(match[2])) * 100) / 100;
    return { amount, unit: match[3].toLowerCase().replace(/s$/, ""), name: match[4].trim() };
  }

  // Pattern 3: "1 package (14.1 ounces) pie crusts" — number + unit + parenthetical + name
  match = s.match(new RegExp(`^([\\d.]+)\\s+(${units})\\s*\\([^)]*\\)\\s*(.+)$`, "i"));
  if (match) {
    return { amount: Math.round(parseFloat(match[1]) * 100) / 100, unit: match[2].toLowerCase().replace(/s$/, ""), name: match[3].trim() };
  }

  // Pattern 4: "1 (10.75 ounce) can cream of chicken" — number + parenthetical-unit + unit + name
  match = s.match(/^([\d.]+)\s*\([^)]*\)\s*(\w+)\s+(.+)$/i);
  if (match) {
    return { amount: Math.round(parseFloat(match[1]) * 100) / 100, unit: match[2].toLowerCase().replace(/s$/, ""), name: match[3].trim() };
  }

  // Pattern 5: "2 cups chicken" — whole + unit + name
  match = s.match(new RegExp(`^([\\d.]+)\\s+(${units})\\s+(.+)$`, "i"));
  if (match) {
    return { amount: Math.round(parseFloat(match[1]) * 100) / 100, unit: match[2].toLowerCase().replace(/s$/, ""), name: match[3].trim() };
  }

  // Pattern 6: "3 large eggs" or "2 avocados" — number + name (no recognized unit)
  match = s.match(/^([\d.]+)\s+(.+)$/i);
  if (match) {
    return { amount: Math.round(parseFloat(match[1]) * 100) / 100, unit: "whole", name: match[2].trim() };
  }

  // Pattern 7: just a fraction "1/2" + name — no unit
  match = s.match(/^(\d+)\s*\/\s*(\d+)\s+(.+)$/i);
  if (match) {
    const amount = Math.round((parseInt(match[1]) / parseInt(match[2])) * 100) / 100;
    return { amount, unit: "whole", name: match[3].trim() };
  }

  // Fallback: no number found, just use the whole string as the name
  return { name: raw.trim(), amount: 1, unit: "whole" };
}

/**
 * Decode common HTML entities in text.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, "/")
    .replace(/&#\d+;/g, (match) => {
      const code = parseInt(match.replace(/&#|;/g, ""), 10);
      return String.fromCharCode(code);
    });
}

/**
 * Clean imported text by removing citation references and other junk markers
 */
function cleanImportedText(text: string): string {
  return text
    // Remove citation references like :contentReference[oaicite:0]{index=0}
    .replace(/:contentReference\[oaicite:\d+\]\{index:\d+\}/g, "")
    // Remove other common reference patterns
    .replace(/\[cite:\d+\]/g, "")
    .replace(/\[ref\s*\d+\]/gi, "")
    .replace(/\[\d+\]/g, "") // Remove [1], [2], etc at end of sentences
    // Remove multiple spaces
    .replace(/\s{2,}/g, " ")
    // Clean up spacing around punctuation
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

function cleanIngredient(name: string): string {
  return name
    .replace(/\(\$[\d.]+\)/g, "")   // ($0.70) price annotations
    .replace(/\$[\d.]+/g, "")        // $1.20 bare prices
    .replace(/^\d+\.\s*/, "")        // "1. ingredient" list numbering
    .replace(/^step\s+\d+:?\s*/i, "") // "Step 1:" prefixes
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Detect placeholder instruction text that some sites put in their JSON-LD
// (e.g. "Full recipe on source site", "See instructions at foodista.com")
const PLACEHOLDER_PATTERNS = [
  /full\s*(recipe\s*)?(instructions?\s*)?on\s*(the\s*)?(source|original)\s*site/i,
  /see\s+(full\s*)?(recipe|instructions?)\s*(on|at)/i,
  /instructions?\s*(are\s*)?(available\s*)?(on|at)\s*(the\s*)?(source|original)\s*site/i,
  /visit\s+(the\s*)?(original\s*)?site\s+for/i,
  /full\s+recipe\s+at\s+\w/i,
  /get\s+(the\s+)?full\s+recipe/i,
  /find\s+(the\s+)?(full\s+)?recipe\s+(on|at)/i,
  /directions?\s+at\s+(source|the)\s*site/i,
];

function isPlaceholderInstructions(instructions: string[]): boolean {
  if (instructions.length === 0) return true;
  const combined = instructions.join(" ");
  if (combined.length > 400) return false; // real instructions are longer
  return PLACEHOLDER_PATTERNS.some(p => p.test(combined));
}

// Extract instruction strings from a recipeInstructions JSON-LD field
function extractInstructionsFromJsonLd(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((step: any) => {
      if (typeof step === "string") return cleanImportedText(decodeHtmlEntities(step.replace(/<[^>]*>/g, "").trim()));
      if (step.text) return cleanImportedText(decodeHtmlEntities(step.text.replace(/<[^>]*>/g, "").trim()));
      if (step.itemListElement) {
        return step.itemListElement.map((sub: any) =>
          cleanImportedText(decodeHtmlEntities((sub.text || String(sub)).replace(/<[^>]*>/g, "").trim()))
        ).join(" ");
      }
      return cleanImportedText(decodeHtmlEntities(String(step).replace(/<[^>]*>/g, "").trim()));
    }).filter((s: string) => s.length > 0);
  }
  if (typeof raw === "string") {
    return raw.replace(/<[^>]*>/g, "").split(/\n+/).filter((s: string) => s.trim()).map((s: string) => cleanImportedText(decodeHtmlEntities(s.trim())));
  }
  return [];
}

// Semaphore: max concurrent background recipe-clean Anthropic calls
let autoCleanActive = 0;

export async function registerRoutes(server: Server, app: Express) {
  // Setup Authentication
  setupAuth(app);

  // AI routes (all require auth)
  app.use("/api/ai", requireAuth, aiRoutes);

  // Billing — webhook is public (signature-verified), checkout/portal require auth (handled inside router)
  app.use("/api/billing", billingRoutes);


  // Onboarding routes (all require auth)
  app.use("/api/onboarding", requireAuth, onboardingRoutes);

  // Snacks & Shopping List
  app.use("/api/snacks", snacksRoutes);

  // Initialize database and seed default data on first run
  await storage.init();
  await storage.seedDefaultData();

  // === OG IMAGE PROXY ===
  // Extracts og:image from a recipe page URL server-side (avoids CORS).
  // SSRF-hardened: requireAuth; string check + resolved-IP check; manual redirects
  // (3xx rejected, not followed); capped body read; AbortController timeout.
  app.get("/api/proxy/og-image", requireAuth, async (req, res) => {
    const url = req.query.url as string;
    if (!url || !isSafeUrl(url)) return res.json({ imageUrl: null });

    // Resolve the hostname and reject if ANY resolved address is internal. This catches a
    // public hostname pointing at a private IP — isSafeUrl only inspects the literal string.
    try {
      const { hostname } = new URL(url);
      const resolved = await lookup(hostname, { all: true });
      if (resolved.length === 0 || resolved.some(r => isPrivateAddress(r.address))) {
        return res.json({ imageUrl: null });
      }
    } catch {
      return res.json({ imageUrl: null });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SimmerApp/1.0; +https://simmer.kitchen)" },
        redirect: "manual", // don't follow redirects — the target is never re-validated
        signal: controller.signal,
      });
      // Reject a redirect rather than chasing it to an unvalidated host.
      if (response.status >= 300 && response.status < 400) return res.json({ imageUrl: null });

      // Read at most ~1 MB from the body stream, stopping past the cap instead of buffering
      // the whole response, so a huge target can't exhaust memory.
      const MAX_BYTES = 1_000_000;
      let html = "";
      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let total = 0;
        while (total < MAX_BYTES) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          html += decoder.decode(value, { stream: true });
        }
        // Cancel failure is inconsequential (we already have the bytes we need) —
        // record a breadcrumb rather than an event.
        await reader.cancel().catch(err => Sentry.addBreadcrumb({ category: "og-image", message: `reader.cancel failed: ${err?.message}`, level: "warning" }));
      }

      // Try multiple og:image patterns (property or name attribute order varies)
      const match =
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
        html.match(/<meta[^>]+name=["']og:image["'][^>]+content=["']([^"']+)["']/i);
      const imageUrl = match?.[1]?.replace(/&amp;/g, "&") || null;
      return res.json({ imageUrl });
    } catch {
      return res.json({ imageUrl: null });
    } finally {
      clearTimeout(timeout);
    }
  });

  // === DEV UTILITIES ===
  if (process.env.NODE_ENV !== "production") {
  // Upgrade a user to 'test' tier (50 AI calls/day) — dev only
  app.post("/api/dev/upgrade-testuser", async (req, res) => {

    try {
      const user = await storage.getUserByUsername("testuser");
      if (!user) return res.status(404).json({ error: "testuser not found" });
      await storage.updateUserSubscriptionTier(user.id, "test");
      res.json({ success: true, message: "testuser upgraded to test tier (50 AI calls/day)" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Funnel summary (event counts, last N days; default 30) — dev only
  app.get("/api/dev/events-summary", async (req, res) => {
    try {
      const days = Math.min(365, Math.max(1, parseInt(String(req.query.days ?? "30"), 10) || 30));
      const counts = await storage.getEventCounts(days);
      res.json({ days, counts });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  } // end dev-only block

  // === TASTE PROFILE ===
  app.get("/api/taste-profile", requireAuth, async (req, res) => {
    const profile = await storage.getUserTasteProfile(authedUser(req).id);
    res.json(profile || {});
  });

  app.patch("/api/taste-profile", requireAuth, async (req, res) => {
    const result = updateUserTasteProfileSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: "Invalid taste profile data", details: result.error.flatten() });
    }
    await storage.upsertUserTasteProfile(authedUser(req).id, result.data);
    res.json({ success: true });
  });

  // === RECIPES ===
  app.get("/api/recipes", requireAuth, async (req, res) => {
    const householdId = authedUser(req).householdId;
    if (!householdId) return res.json([]); // no household yet — return empty rather than crash
    const recipes = await storage.getRecipes(householdId);
    res.json(recipes);
  });

  app.get("/api/recipes/:id", requireAuth, async (req, res) => {
    const householdId = authedUser(req).householdId;
    const recipe = await storage.getRecipe(Number(req.params.id), householdId);
    if (!recipe) return res.status(404).json({ error: "Recipe not found" });
    res.json(recipe);
  });

  app.post("/api/recipes", requireAuth, async (req, res) => {
    const householdId = authedUser(req).householdId;
    const parsed = insertRecipeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const recipe = await storage.createRecipe({ ...parsed.data, householdId });
    res.status(201).json(recipe);
    storage.logActivity(authedUser(req).id, "recipe_added", recipe.id, recipe.name);

    // Fire-and-forget nutrition enrichment — don't block the response
    {
      let ingredientNames: string[] = [];
      try { ingredientNames = (JSON.parse(recipe.ingredients) as any[]).map(i => i.name).filter(Boolean); } catch { /* skip */ }
      if (ingredientNames.length > 0) {
        // Failures don't affect the response but must be visible — capture, don't swallow.
        enrichWithNutrition(recipe.name, ingredientNames).then(nutrition => {
          if (nutrition) storage.updateRecipeNutrition(recipe.id, JSON.stringify(nutrition)).catch(err => Sentry.captureException(err));
        }).catch(err => Sentry.captureException(err));
      }
    }

    // Fire-and-forget image fetch if imageUrl is null
    if (!recipe.imageUrl) {
      setImmediate(async () => {
        try {
          const { imageUrl: url } = await searchRecipeImage(recipe.name);
          if (url) {
            await storage.updateRecipe(recipe.id, householdId, { imageUrl: url } as any);
            console.log(`[auto-image] fetched for "${recipe.name}": ${url}`);
          }
        } catch (e) {
          console.warn(`[auto-image] failed for recipe ${recipe.id}:`, (e as any)?.message);
        }
      });
    }

    // Auto-clean instructions in background — best-effort, never blocks the response
    // Rate-limited: max 3 concurrent Anthropic calls to avoid burst costs
    if (!recipe.isProcessed && autoCleanActive < 3) {
      autoCleanActive++;
      setImmediate(async () => {
        try {
          const { cleanRecipe } = await import('./services/recipeCleaner');
          let ingredientsParsed: any[] = [];
          try { ingredientsParsed = JSON.parse(recipe.ingredients); } catch { /* skip */ }

          // Detect placeholder / empty instructions — if so, try re-fetching the source URL
          let rawInstructions = recipe.instructions || '';
          let parsedInstructions: string[] = [];
          try { parsedInstructions = JSON.parse(rawInstructions); } catch {
            parsedInstructions = rawInstructions ? [rawInstructions] : [];
          }

          if (isPlaceholderInstructions(parsedInstructions) && recipe.sourceUrl) {
            try {
              console.log(`[auto-clean] instructions placeholder for recipe ${recipe.id}, re-fetching ${recipe.sourceUrl}`);
              const freshHtml = await fetchHtml(recipe.sourceUrl);
              // Try JSON-LD first
              const jsonLd = extractRecipeJsonLd(freshHtml);
              let freshInstructions = extractInstructionsFromJsonLd(jsonLd?.recipeInstructions);
              // If still placeholder, try HTML fallback
              if (isPlaceholderInstructions(freshInstructions)) {
                const fallback = extractRecipeFallback(freshHtml);
                const fb = Array.isArray(fallback?.recipeInstructions) ? fallback.recipeInstructions as string[] : [];
                if (fb.length > 1 && !isPlaceholderInstructions(fb)) freshInstructions = fb;
              }
              if (!isPlaceholderInstructions(freshInstructions) && freshInstructions.length > 0) {
                rawInstructions = JSON.stringify(freshInstructions);
                parsedInstructions = freshInstructions;
              } else {
                console.warn(`[auto-clean] could not extract real instructions from ${recipe.sourceUrl}`);
              }
            } catch (fetchErr) {
              console.warn(`[auto-clean] re-fetch failed for recipe ${recipe.id}:`, (fetchErr as any)?.message);
            }
          }

          if (parsedInstructions.length === 0) {
            // Nothing to clean — mark processed so we don't retry forever
            await storage.updateRecipe(recipe.id, householdId, { isProcessed: true } as any);
            return;
          }

          const cleaned = await cleanRecipe({ name: recipe.name, ingredients: ingredientsParsed, instructions: rawInstructions });
          const flatSteps = cleaned.sections.flatMap((s: any) => s.steps.map((st: any) => st.instruction ?? String(st)));
          await storage.updateRecipe(recipe.id, householdId, {
            isProcessed: true, rawInstructions: recipe.instructions,
            instructions: JSON.stringify(flatSteps), sections: cleaned.sections,
            cleanedSteps: cleaned.sections.flatMap((s: any) => s.steps),
            totalPrepTime: cleaned.totalPrepTime, totalCookTime: cleaned.totalCookTime,
            tips: cleaned.tips, difficulty: cleaned.difficulty,
          } as any);
        } catch (err) {
          console.error('[auto-clean] failed for recipe', recipe.id, (err as any)?.message);
        } finally {
          autoCleanActive--;
        }
      });
    }
  });

  app.patch("/api/recipes/:id", requireAuth, async (req, res) => {
    const householdId = authedUser(req).householdId;
    // Validate against a partial of the insert schema. insertRecipeSchema already
    // omits id and householdId, so a malicious body cannot reassign a recipe to
    // another household or overwrite internal columns (mass-assignment guard).
    const parsed = insertRecipeSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const recipe = await storage.updateRecipe(Number(req.params.id), householdId, parsed.data);
    if (!recipe) return res.status(404).json({ error: "Recipe not found" });
    res.json(recipe);
  });

  app.delete("/api/recipes/:id", requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const householdId = authedUser(req).householdId;
    const existing = await storage.getRecipe(id, householdId);
    await storage.deleteRecipe(id, householdId);
    res.status(204).send();
    if (existing) storage.logActivity(authedUser(req).id, "recipe_deleted", id, existing.name);
  });

  app.post("/api/recipes/:id/favorite", requireAuth, async (req, res) => {
    const householdId = authedUser(req).householdId;
    const recipe = await storage.toggleFavorite(Number(req.params.id), householdId);
    if (!recipe) return res.status(404).json({ error: "Recipe not found" });
    res.json(recipe);
  });

  // === HOUSEHOLD ===
  // Rate limiter for join attempts: max 10 per IP per minute
  const joinAttempts = new Map<string, { count: number; resetAt: number }>();
  function checkJoinRate(ip: string): boolean {
    const now = Date.now();
    const slot = joinAttempts.get(ip);
    if (!slot || now >= slot.resetAt) { joinAttempts.set(ip, { count: 1, resetAt: now + 60_000 }); return true; }
    if (slot.count >= 10) return false;
    slot.count++;
    return true;
  }

  app.get("/api/household", requireAuth, async (req, res) => {
    const user = authedUser(req);
    let householdId = user.householdId;
    // Auto-assign: if user somehow has no household (migration gap), create one now
    if (!householdId) {
      const { generateInviteCode } = await import("./utils/invite");
      const hh = await storage.createHousehold(`${user.username}'s Home`, generateInviteCode());
      await storage.setUserHousehold(user.id, hh.id);
      householdId = hh.id;
    }
    const hh = await storage.getHousehold(householdId);
    if (!hh) return res.status(404).json({ error: "Household not found" });
    const members = await storage.getHouseholdMembers(householdId);
    res.json({ ...hh, members: members.map(m => ({ id: m.id, username: m.username })) });
  });

  app.patch("/api/household/name", requireAuth, async (req, res) => {
    const user = authedUser(req);
    if (!user.householdId) return res.status(404).json({ error: "No household" });
    const { name } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Name required" });
    await storage.updateHouseholdName(user.householdId, name.trim());
    res.json({ success: true });
  });

  app.post("/api/household/join", requireAuth, async (req, res) => {
    const ip = (req.ip ?? req.socket.remoteAddress ?? "unknown");
    if (!checkJoinRate(ip)) return res.status(429).json({ error: "Too many attempts. Try again in a minute." });
    const user = authedUser(req);
    const code = (req.body.inviteCode ?? "").trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{8,20}$/.test(code)) return res.status(400).json({ error: "Invalid invite code format" });
    const hh = await storage.getHouseholdByInviteCode(code);
    if (!hh) return res.status(404).json({ error: "Invalid invite code" });
    const cap = await checkHouseholdJoinCap(hh.id);
    if (!cap.allowed) return res.status(403).json(joinCapError(cap));
    await storage.setUserHousehold(user.id, hh.id);
    res.json(hh);
  });

  // Preview a household by invite code (public — no auth required)
  app.get("/api/household/preview/:code", async (req, res) => {
    const ip = (req.ip ?? req.socket.remoteAddress ?? "unknown");
    if (!checkJoinRate(ip)) return res.status(429).json({ error: "Too many attempts." });
    const code = req.params.code.toUpperCase();
    const hh = await storage.getHouseholdByInviteCode(code);
    if (!hh) return res.status(404).json({ error: "Invalid invite code" });
    const members = await storage.getHouseholdMembers(hh.id);
    res.json({ id: hh.id, name: hh.name, memberCount: members.length });
  });

  // Regenerate invite code
  app.post("/api/household/regenerate", requireAuth, async (req, res) => {
    const user = authedUser(req);
    if (!user.householdId) return res.status(404).json({ error: "No household" });
    const { generateInviteCode } = await import("./utils/invite");
    const newCode = generateInviteCode();
    await storage.updateHouseholdInviteCode(user.householdId, newCode);
    res.json({ inviteCode: newCode });
  });

  // Leave household (creates a new solo home)
  app.post("/api/household/leave", requireAuth, async (req, res) => {
    const user = authedUser(req);
    if (!user.householdId) return res.status(404).json({ error: "No household" });
    const { generateInviteCode } = await import("./utils/invite");
    const code = generateInviteCode();
    const hh = await storage.createHousehold(`${user.username}'s Home`, code);
    await storage.setUserHousehold(user.id, hh.id);
    res.json(hh);
  });

  // === ACTIVITY FEED ===
  app.get("/api/activity", requireAuth, async (req, res) => {
    interface ActivityGroup {
      username: string; avatar: string | null; action: string; count: number;
      recipeNames: string[]; recipeIds: number[]; latestAt: string;
    }
    const householdId = authedUser(req).householdId;
    // "Full activity feed history" is a Pro perk: premium households see 40 entries,
    // free households the most recent 15.
    const premium = await householdIsPremium(householdId);
    const rows = await storage.getRecentActivity(householdId, premium ? PREMIUM_ACTIVITY_LIMIT : FREE_ACTIVITY_LIMIT);
    const groups: ActivityGroup[] = [];
    for (const row of rows) {
      const last = groups[groups.length - 1];
      const sameWindow = last && last.username === row.username && last.action === row.action &&
        (new Date(last.latestAt).getTime() - new Date(row.createdAt).getTime()) < 10 * 60 * 1000;
      if (sameWindow) {
        last.count++;
        if (row.recipeName && !last.recipeNames.includes(row.recipeName)) {
          last.recipeNames.push(row.recipeName);
          if (row.recipeId) last.recipeIds.push(row.recipeId);
        }
      } else {
        groups.push({
          username: row.username, avatar: row.avatar ?? null, action: row.action, count: 1,
          recipeNames: row.recipeName ? [row.recipeName] : [],
          recipeIds: row.recipeId ? [row.recipeId] : [],
          latestAt: row.createdAt.toISOString(),
        });
      }
      if (groups.length >= 8) break;
    }
    res.json(groups);
  });

  // === WEEKLY PLANS ===
  app.get("/api/plans", requireAuth, async (req, res) => {
    const householdId = authedUser(req).householdId;
    const plans = await storage.getWeeklyPlans(householdId);
    res.json(plans);
  });

  app.get("/api/plans/:weekStart", requireAuth, async (req, res) => {
    const householdId = authedUser(req).householdId;
    const plan = await storage.getWeeklyPlan(req.params.weekStart as string, householdId);
    if (!plan) return res.json({ weekStart: req.params.weekStart, meals: "{}" });
    res.json(plan);
  });

  app.post("/api/plans", requireAuth, async (req, res) => {
    const householdId = authedUser(req).householdId;
    const parsed = insertWeeklyPlanSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const existing = await storage.getWeeklyPlan(parsed.data.weekStart, householdId);
    const planData: InsertWeeklyPlan = { ...parsed.data, householdId };
    if (req.body.mealMeta !== undefined) (planData as any).mealMeta = req.body.mealMeta;
    const plan = await storage.upsertWeeklyPlan(planData);
    res.json(plan);
    storage.logEvent(authedUser(req).id, "week_planned", { weekStart: parsed.data.weekStart });
    // Diff-based activity logging — log each newly added recipe
    if (existing?.meals !== parsed.data.meals) {
      const userId = authedUser(req).id;
      const oldMeals: Record<string, any> = existing?.meals ? JSON.parse(existing.meals) : {};
      const newMeals: Record<string, any> = JSON.parse(parsed.data.meals);
      const oldVals = new Set(Object.values(oldMeals).map(String));
      let added = 0;
      for (const val of Object.values(newMeals)) {
        if (typeof val === "number" && !oldVals.has(String(val))) {
          const recipe = await storage.getRecipe(val, householdId);
          storage.logActivity(userId, "plan_meal_added", val, recipe?.name ?? null);
          added++;
        }
      }
      if (added === 0) storage.logActivity(userId, "plan_updated");
    }
  });

  app.delete("/api/plans/:id", requireAuth, async (req, res) => {
    const householdId = authedUser(req).householdId;
    await storage.deleteWeeklyPlan(Number(req.params.id), householdId);
    res.status(204).send();
  });

  // === MEAL REACTIONS ===
  app.get("/api/plans/:weekStart/reactions", requireAuth, async (req, res) => {
    const householdId = authedUser(req).householdId;
    const reactions = await storage.getReactionsForWeek(req.params.weekStart as string, householdId);
    res.json(reactions);
  });

  app.post("/api/plans/:weekStart/reactions", requireAuth, async (req, res) => {
    const householdId = authedUser(req).householdId;
    const weekStart = req.params.weekStart as string;
    const { slotKey, emoji } = req.body;
    const userId = authedUser(req).id;
    if (!slotKey) return res.status(400).json({ error: "slotKey required" });
    // Verify the week plan belongs to this household before accepting reactions
    const plan = await storage.getWeeklyPlan(weekStart, householdId);
    if (!plan) return res.status(403).json({ error: "Forbidden" });
    if (!emoji) {
      await storage.deleteReaction(weekStart, slotKey, userId);
    } else {
      await storage.upsertReaction(weekStart, slotKey, userId, emoji);
    }
    res.status(204).send();
  });

  // === PANTRY STAPLES ===
  app.get("/api/staples", requireAuth, async (req, res) => {
    const householdId = authedUser(req).householdId;
    const staples = await storage.getPantryStaples(householdId);
    res.json(staples);
  });

  app.post("/api/staples", requireAuth, async (req, res) => {
    const householdId = authedUser(req).householdId;
    const parsed = insertPantryStapleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const staple = await storage.createPantryStaple({ ...parsed.data, householdId });
    res.status(201).json(staple);
    storage.logActivity(authedUser(req).id, "pantry_added", null, staple.name);
  });

  app.delete("/api/staples/:id", requireAuth, async (req, res) => {
    const householdId = authedUser(req).householdId;
    await storage.deletePantryStaple(Number(req.params.id), householdId);
    res.status(204).send();
  });

  // === RECIPE IMPORT FROM URL ===

  /**
   * Attempt to fetch a URL's HTML using multiple strategies.
   * Some recipe sites (AllRecipes, Dotdash Meredith) block server-side requests.
   */
  async function fetchHtml(url: string): Promise<string> {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.google.com/",
      "Upgrade-Insecure-Requests": "1",
    };

    let directHtml: string | null = null;
    try {
      const res = await fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const html = await res.text();
        if (html.length > 500) {
          // Return immediately when structured data is present
          if (html.includes("application/ld+json") || html.includes("recipeIngredient")) return html;
          directHtml = html; // keep as fallback for non-standard sites
        }
      }
    } catch {
      // Site blocked or unreachable — caller will try Spoonacular extract next
    }

    if (directHtml) return directHtml;
    throw new Error("Could not reach this recipe site.");
  }

  /**
   * Extract JSON-LD Recipe data from HTML.
   */
  function extractRecipeJsonLd(html: string): any {
    const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis);
    if (!jsonLdMatches) return null;

    for (const block of jsonLdMatches) {
      try {
        const jsonStr = block.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "").trim();
        let parsed = JSON.parse(jsonStr);

        // Handle @graph arrays
        if (parsed["@graph"]) {
          const found = parsed["@graph"].find((item: any) =>
            item["@type"] === "Recipe" || (Array.isArray(item["@type"]) && item["@type"].includes("Recipe"))
          );
          if (found) return found;
        }
        // Handle arrays of objects
        if (Array.isArray(parsed)) {
          const found = parsed.find((item: any) =>
            item["@type"] === "Recipe" || (Array.isArray(item["@type"]) && item["@type"].includes("Recipe"))
          );
          if (found) return found;
        }
        // Direct Recipe object
        if (parsed && (parsed["@type"] === "Recipe" || (Array.isArray(parsed["@type"]) && parsed["@type"].includes("Recipe")))) {
          return parsed;
        }
      } catch {
        // JSON parse failed, try next block
      }
    }
    return null;
  }

  /**
   * Fallback: Try to extract recipe from HTML using common microdata/meta tags
   */
  function extractRecipeFallback(html: string): any {
    // Look for recipe name in meta tags or headings
    const nameMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                      html.match(/<h1[^>]*class=["'][^"']*recipe[^"']*["'][^>]*>([^<]+)<\/h1>/i) ||
                      html.match(/<h1[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([^<]+)<\/h1>/i) ||
                      html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const name = nameMatch ? cleanImportedText(decodeHtmlEntities(nameMatch[1].trim())) : "Imported Recipe";

    // Look for description in meta tags
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                      html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
    const description = descMatch ? cleanImportedText(decodeHtmlEntities(descMatch[1].trim())) : "";

    // Strategy 1: Look for ingredients with specific classes/attributes
    let ingredientMatches = Array.from(html.matchAll(/<li[^>]*class=["'][^"']*ingredient[^"']*["'][^>]*>([^<]+)<\/li>/gi));
    if (ingredientMatches.length === 0) {
      ingredientMatches = Array.from(html.matchAll(/<span[^>]*itemprop=["']recipeIngredient["'][^>]*>([^<]+)<\/span>/gi));
    }
    if (ingredientMatches.length === 0) {
      ingredientMatches = Array.from(html.matchAll(/data-ingredient=["']([^"']+)["']/gi));
    }

    // Strategy 2: If no specific markup, look for lists that might be ingredients
    // Look for common ingredient patterns (starts with number or fraction)
    if (ingredientMatches.length === 0) {
      // Find all <li> tags and filter for ones that look like ingredients
      const allListItems = Array.from(html.matchAll(/<li[^>]*>([^<]+(?:<[^>]+>[^<]*<\/[^>]+>)*[^<]*)<\/li>/gi));
      ingredientMatches = allListItems.filter(match => {
        const text = match[1].replace(/<[^>]*>/g, "").trim();
        // Ingredient pattern: starts with number, fraction, or common measurement words
        return /^(\d+\/?\d*|\d*\.?\d+)?\s*(cup|tbsp|tsp|tablespoon|teaspoon|oz|lb|pound|g|kg|ml|clove|piece|can|package|bunch)?s?\s+/i.test(text) ||
               /^(one|two|three|four|five|six|seven|eight|a|an)\s+(cup|tablespoon|teaspoon|pound|can|piece)/i.test(text);
      });
    }

    const ingredients = ingredientMatches.length > 0
      ? ingredientMatches.map(m => cleanImportedText(decodeHtmlEntities(m[1].replace(/<[^>]*>/g, "").trim()))).filter(i => i.length > 0 && i.length < 200)
      : [];

    // Strategy 1: Look for instructions with specific classes
    let instructionMatches = Array.from(html.matchAll(/<li[^>]*class=["'][^"']*instruction[^"']*["'][^>]*>([^<]+)<\/li>/gi));
    if (instructionMatches.length === 0) {
      instructionMatches = Array.from(html.matchAll(/<div[^>]*class=["'][^"']*step[^"']*["'][^>]*>([^<]+)<\/div>/gi));
    }
    if (instructionMatches.length === 0) {
      instructionMatches = Array.from(html.matchAll(/<span[^>]*itemprop=["']recipeInstructions["'][^>]*>([^<]+)<\/span>/gi));
    }

    // Strategy 2: Look for ordered lists (often instructions)
    if (instructionMatches.length === 0) {
      // Find ordered lists that might contain instructions
      const olMatch = html.match(/<ol[^>]*>([\s\S]*?)<\/ol>/i);
      if (olMatch) {
        instructionMatches = Array.from(olMatch[1].matchAll(/<li[^>]*>(.*?)<\/li>/gi));
      }
    }

    const instructions = instructionMatches.length > 0
      ? instructionMatches.map(m => cleanImportedText(decodeHtmlEntities(m[1].replace(/<[^>]*>/g, "").trim()))).filter(i => i.length > 0)
      : [];

    // Look for image
    const imageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
                       html.match(/<img[^>]*class=["'][^"']*recipe[^"']*["'][^>]*src=["']([^"']+)["']/i);
    const image = imageMatch ? imageMatch[1] : null;

    // Only return if we found at least a name and some ingredients
    if (name && ingredients.length > 2) {
      return {
        name,
        description,
        recipeIngredient: ingredients,
        recipeInstructions: instructions.length > 0 ? instructions : undefined,
        image,
      };
    }

    return null;
  }

  // ── Strategy 0: Jina.ai reader + Claude extraction ───────────────────────────
  async function tryAnthropicWebSearch(url: string): Promise<any | null> {
    const TIMEOUT_MS = 14000;
    const timeoutPromise = new Promise<null>(resolve => setTimeout(() => resolve(null), TIMEOUT_MS));

    const work = async (): Promise<any | null> => {
      try {
        console.log("[websearch] attempting for:", url);
        const extractionPrompt = `Use web_search to fetch the content of this exact URL: ${url}

Then extract the recipe data and return ONLY this JSON with no markdown or explanation:
{
  "name": "...",
  "description": "1-2 sentence dish description, NOT instructions",
  "ingredients": ["amount ingredient"],
  "instructions": ["step text, no numbering"],
  "prepTime": 15,
  "cookTime": 30,
  "servings": 4,
  "cuisine": "american|italian|tex-mex|asian|mediterranean|indian|other",
  "mealType": "breakfast|lunch|dinner",
  "difficulty": "easy|medium|hard",
  "imageUrl": "https://... or null"
}
If not a recipe: {"error": "not a recipe"}`;

        const messages: any[] = [{ role: "user", content: extractionPrompt }];
        let response = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1500,
          tools: [{ type: "web_search_20250305" as any, name: "web_search" }],
          messages,
        });

        // Anthropic executes web_search server-side; handle tool-use continuation
        let iters = 0;
        while (response.stop_reason === "tool_use" && iters < 3) {
          iters++;
          const toolUses = response.content.filter((b: any) => b.type === "tool_use");
          messages.push({ role: "assistant", content: response.content });
          messages.push({
            role: "user",
            content: toolUses.map((b: any) => ({ type: "tool_result", tool_use_id: b.id, content: "" })),
          });
          response = await anthropic.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1500,
            tools: [{ type: "web_search_20250305" as any, name: "web_search" }],
            messages,
          });
        }

        const textBlock = response.content.find((b: any) => b.type === "text");
        if (!textBlock) { console.log("[websearch] no text block in response"); return null; }
        const text = (textBlock as any).text ?? "";
        console.log("[websearch] raw result:", text.substring(0, 200));

        let parsed: any;
        try {
          parsed = JSON.parse(text.trim());
        } catch {
          const match = text.match(/\{[\s\S]*\}/);
          if (!match) { console.log("[websearch] no JSON found in response"); return null; }
          parsed = JSON.parse(match[0]);
        }
        if (parsed.error || !parsed.name || !(parsed.ingredients?.length > 0)) {
          console.log("[websearch] result invalid or error:", parsed.error ?? "missing name/ingredients");
          return null;
        }
        console.log(`[websearch] succeeded: "${parsed.name}" (${parsed.ingredients?.length} ingredients)`);
        return parsed;
      } catch (err) {
        console.log("[websearch] error:", (err as any)?.message);
        return null;
      }
    };

    return Promise.race([work(), timeoutPromise]);
  }

  async function tryJinaExtract(url: string): Promise<any | null> {
    try {
      const jinaUrl = `https://r.jina.ai/${url}`;
      console.log("[jina] fetching:", jinaUrl);
      const res = await fetch(jinaUrl, {
        headers: { "Accept": "text/plain", "X-Timeout": "15" },
        signal: AbortSignal.timeout(15000),
      });
      console.log("[jina] response status:", res.status);
      if (!res.ok) {
        console.log("[jina] non-OK response, aborting");
        return null;
      }
      const pageText = await res.text();
      console.log("[jina] text length:", pageText.length);
      console.log("[jina] first 500 chars:", pageText.substring(0, 500));

      // Bail out if Jina returned an error/block page rather than real content
      const lower = pageText.toLowerCase();
      if (
        pageText.length < 500 ||
        lower.includes("access denied") ||
        lower.includes("captcha") ||
        (lower.includes("403") && lower.includes("forbidden")) ||
        lower.includes("blocked by") ||
        lower.includes("please enable javascript") ||
        lower.includes("enable cookies")
      ) {
        console.log("[jina] detected error/block page, aborting");
        return null;
      }

      const prompt = `Extract recipe information from this webpage text. Return ONLY valid JSON with no markdown or explanation:
{
  "name": "recipe name",
  "description": "1-2 sentence description of the dish (NOT instructions)",
  "ingredients": ["1 cup flour", "2 eggs"],
  "instructions": ["Step text only, no numbers or Step X: prefixes"],
  "prepTime": 15,
  "cookTime": 30,
  "servings": 4,
  "cuisine": "american|italian|tex-mex|asian|mediterranean|indian|other",
  "mealType": "breakfast|lunch|dinner",
  "difficulty": "easy|medium|hard",
  "imageUrl": "https://... or null"
}
Rules:
- ingredients: plain text only, no prices, no dollar signs, no ($0.70) annotations
- instructions: step text only, no "Step 1:" prefixes, no numbering
- description: must be a dish description, never instruction text
- cuisine: pick closest from the list
- imageUrl: first food photo URL found, or null
- If not a recipe page return: {"error":"not a recipe"}

Webpage content (first 6000 chars):
${pageText.substring(0, 6000)}`;

      const aiRes = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      });

      const text = aiRes.content[0].type === "text" ? aiRes.content[0].text : "";
      let parsed: any;
      try {
        parsed = JSON.parse(text.trim());
      } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        parsed = JSON.parse(match[0]);
      }
      if (parsed.error) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  app.post("/api/recipes/import-url", requireAuth, async (req, res) => {
    const { url } = req.body as { url: string };
    if (!url || !isSafeUrl(url)) return res.status(400).json({ error: "URL is required and must be a public URL" });

    try {
      let recipeData: any = null;
      let html = "";
      let strategyUsed = "error";
      const strategiesTried: string[] = [];
      const deadline = Date.now() + 28000; // stay under Railway's 30s request timeout

      // ── Strategy 0: Anthropic web_search (works from any server, no external deps) ─
      console.log(`[import] ${url} → trying strategy=0 (anthropic-websearch)`);
      strategiesTried.push("anthropic");
      const webSearchResult = await tryAnthropicWebSearch(url);
      console.log(`[import] strategy=0 result:`, webSearchResult ? JSON.stringify(webSearchResult).substring(0, 200) : "null");
      if (webSearchResult && webSearchResult.name && (webSearchResult.ingredients?.length ?? 0) > 0) {
        console.log(`[import] ${url} → strategy=0 succeeded name="${webSearchResult.name}"`);
        const ingredients = (webSearchResult.ingredients as string[]).map((raw: string) => {
          const clean = cleanIngredient(cleanImportedText(raw));
          const parsed = parseIngredientString(clean);
          return { name: parsed.name, amount: parsed.amount, unit: parsed.unit, category: guessCategory(clean) };
        }).filter((i: any) => i.name);
        const instructions = (webSearchResult.instructions as string[] ?? []).map((s: string) => cleanIngredient(cleanImportedText(s))).filter(Boolean);
        const cuisine = guessCuisine(webSearchResult.name, webSearchResult.ingredients ?? []);
        const prepTime = typeof webSearchResult.prepTime === "number" ? webSearchResult.prepTime : 15;
        const cookTime = typeof webSearchResult.cookTime === "number" ? webSearchResult.cookTime : 30;
        const tags = detectTags(webSearchResult.name, prepTime + cookTime);
        return res.json({
          name: webSearchResult.name,
          description: webSearchResult.description ?? "",
          cuisine,
          mealType: webSearchResult.mealType ?? "dinner",
          difficulty: webSearchResult.difficulty ?? ((prepTime + cookTime) > 60 ? "medium" : "easy"),
          prepTime,
          cookTime,
          servings: typeof webSearchResult.servings === "number" ? webSearchResult.servings : 4,
          ingredients,
          instructions,
          tags,
          imageUrl: webSearchResult.imageUrl || null,
          sourceUrl: url,
        });
      }

      // ── Strategy 1: Jina.ai + Claude extraction (works on JS-rendered sites) ─
      if (Date.now() > deadline - 2000) {
        console.log(`[import] ${url} → deadline reached, skipping strategy=1`);
      } else {
      console.log(`[import] ${url} → trying strategy=1 (jina+claude)`);
      strategiesTried.push("jina");
      const jinaResult = await tryJinaExtract(url);
      console.log(`[import] strategy=1 result:`, jinaResult ? "success" : "null");
      if (jinaResult && jinaResult.name && (jinaResult.ingredients?.length ?? 0) > 0) {
        console.log(`[import] ${url} → strategy=1 succeeded name="${jinaResult.name}"`);
        const ingredients = (jinaResult.ingredients as string[]).map((raw: string) => {
          const clean = cleanIngredient(cleanImportedText(raw));
          const parsed = parseIngredientString(clean);
          return { name: parsed.name, amount: parsed.amount, unit: parsed.unit, category: guessCategory(clean) };
        }).filter((i: any) => i.name);

        const instructions = (jinaResult.instructions as string[] ?? []).map((s: string) => cleanIngredient(cleanImportedText(s))).filter(Boolean);
        const cuisine = guessCuisine(jinaResult.name, jinaResult.ingredients ?? []);
        const prepTime = typeof jinaResult.prepTime === "number" ? jinaResult.prepTime : 15;
        const cookTime = typeof jinaResult.cookTime === "number" ? jinaResult.cookTime : 30;
        const tags = detectTags(jinaResult.name, prepTime + cookTime);

        return res.json({
          name: jinaResult.name,
          description: jinaResult.description ?? "",
          cuisine,
          mealType: jinaResult.mealType ?? "dinner",
          difficulty: jinaResult.difficulty ?? ((prepTime + cookTime) > 60 ? "medium" : "easy"),
          prepTime,
          cookTime,
          servings: typeof jinaResult.servings === "number" ? jinaResult.servings : 4,
          ingredients,
          instructions,
          tags,
          imageUrl: jinaResult.imageUrl || null,
          sourceUrl: url,
        });
      }
      } // end strategy=1 else block

      // ── Strategy 2: Direct fetch + JSON-LD / HTML parsing ─────────────────
      if (Date.now() > deadline - 2000) {
        console.log(`[import] ${url} → deadline reached, skipping strategy=2`);
      } else {
        console.log(`[import] ${url} → trying strategy=2 (json-ld/html)`);
        strategiesTried.push("jsonld");
        try {
          html = await fetchHtml(url);
          const jsonLd = extractRecipeJsonLd(html);
          console.log(`[import-url] json-ld found:`, jsonLd ? `"${jsonLd.name ?? "(no name)"}"` : "null");
          const fallback = jsonLd ? null : extractRecipeFallback(html);
          if (fallback) console.log(`[import-url] html-fallback found:`, `"${fallback.name ?? "(no name)"}", ${fallback.recipeIngredient?.length ?? 0} ingredients`);
          recipeData = jsonLd ?? fallback;
        } catch (e) {
          console.log(`[import-url] direct fetch failed:`, (e as any)?.message);
        }
        if (recipeData) {
          strategyUsed = "2";
          console.log(`[import] ${url} → strategy=2 succeeded name="${recipeData.name ?? "(no name)"}"`);
        }
        console.log(`[import] strategy=2 result:`, recipeData ? "success" : "null");
      }

      // ── Strategy 3: Spoonacular extract API ────────────────────────────────
      if (!recipeData) {
        if (Date.now() > deadline - 2000) {
          console.log(`[import] ${url} → deadline reached, skipping strategy=3`);
        } else {
          console.log(`[import] ${url} → trying strategy=3 (spoonacular)`);
          strategiesTried.push("spoonacular");
          const sp = await extractRecipeByUrl(url);
          if (sp) {
            console.log(`[import] ${url} → strategy=3 succeeded name="${sp.title}"`);
            const spIngredients = sp.ingredients.map(i => ({
              name: cleanIngredient(i.name),
              amount: i.amount,
              unit: i.unit,
              category: guessCategory(i.original || i.name),
            })).filter(i => i.name);

            if (spIngredients.length === 0) {
              return res.status(400).json({ error: "Found recipe but no ingredients could be extracted.", strategiesTried });
            }

            const spInstructions = sp.instructions.filter(Boolean);
            const totalTime = sp.readyInMinutes ?? 0;
            const prepTime = totalTime > 0 ? Math.round(totalTime * 0.4) : 0;
            const cookTime = totalTime > 0 ? Math.round(totalTime * 0.6) : 0;
            const cuisine = guessCuisine(sp.title, [sp.cuisines?.[0] ?? ""]);
            const tags = detectTags(sp.title, totalTime, sp.diets ?? []);
            const mealType = sp.dishTypes?.includes("breakfast") ? "breakfast"
              : sp.dishTypes?.includes("lunch") ? "lunch" : "dinner";

            return res.json({
              name: sp.title,
              description: sp.summary.substring(0, 300),
              cuisine,
              mealType,
              difficulty: totalTime > 60 || spInstructions.length > 8 ? "medium" : "easy",
              prepTime,
              cookTime,
              servings: sp.servings,
              ingredients: spIngredients,
              instructions: spInstructions,
              tags,
              imageUrl: sp.imageUrl || null,
              sourceUrl: sp.sourceUrl || url,
            });
          }
        }
      }

      if (!recipeData) {
        console.log(`[import] ${url} → strategy=error — all strategies failed. tried: ${strategiesTried.join(", ")}`);
        return res.status(400).json({
          error: "We couldn't import from that URL automatically.\n\nTry these options:\n- Copy the recipe text and paste it in the 'Instagram/Social' tab — works for any site\n- Take a screenshot of the recipe and upload it in the 'Upload Screenshot' tab\n- These sites import well: Budget Bytes, Pinch of Yum, Food52, Tasty, Serious Eats\n\nSites that block imports: AllRecipes, NYT Cooking, Food Network",
          strategiesTried,
        });
      }

      // ── Parse JSON-LD / HTML-scraped data ──────────────────────────────────
      const name = cleanImportedText(decodeHtmlEntities((recipeData.name || "Imported Recipe").replace(/<[^>]*>/g, "")));
      const description = cleanImportedText(decodeHtmlEntities((recipeData.description || "").replace(/<[^>]*>/g, "")));
      const prepTime = parseDuration(recipeData.prepTime);
      const cookTime = parseDuration(recipeData.cookTime) || parseDuration(recipeData.totalTime);
      const servings = parseInt(recipeData.recipeYield?.[0] || recipeData.recipeYield || "3", 10) || 3;

      const rawIngredients: string[] = recipeData.recipeIngredient || [];
      const ingredients = rawIngredients.map((raw: string) => {
        const clean = cleanIngredient(cleanImportedText(decodeHtmlEntities(raw.replace(/<[^>]*>/g, "").trim())));
        const parsed = parseIngredientString(clean);
        return { name: parsed.name, amount: parsed.amount, unit: parsed.unit, category: guessCategory(clean) };
      }).filter(ing => ing.name && ing.name.length > 0);

      let instructions = extractInstructionsFromJsonLd(recipeData.recipeInstructions);
      if (isPlaceholderInstructions(instructions)) {
        const fallback = extractRecipeFallback(html);
        const fb = Array.isArray(fallback?.recipeInstructions) ? fallback.recipeInstructions as string[] : [];
        instructions = (fb.length > 1 && !isPlaceholderInstructions(fb)) ? fb : [];
      }

      if (ingredients.length === 0) {
        return res.status(400).json({ error: "Found recipe but no ingredients could be extracted. Try copying the recipe details manually." });
      }

      // Trust JSON-LD recipeCuisine when present, otherwise auto-detect
      const ldCuisineRaw = typeof recipeData.recipeCuisine === "string"
        ? recipeData.recipeCuisine
        : Array.isArray(recipeData.recipeCuisine) ? recipeData.recipeCuisine[0] : "";
      const cuisine = ldCuisineRaw
        ? guessCuisine(ldCuisineRaw, rawIngredients) // let guessCuisine normalize LD cuisine names
        : guessCuisine(name, rawIngredients);
      const tags = detectTags(name, prepTime + cookTime);
      console.log(`[import] ${url} → strategy=2 res name="${name}"`);

      let imageUrl: string | null = null;
      if (recipeData.image) {
        if (typeof recipeData.image === "string") imageUrl = recipeData.image;
        else if (Array.isArray(recipeData.image)) imageUrl = typeof recipeData.image[0] === "string" ? recipeData.image[0] : recipeData.image[0]?.url || null;
        else if (recipeData.image.url) imageUrl = recipeData.image.url;
      }

      res.json({
        name,
        description: description.substring(0, 300),
        cuisine,
        mealType: "dinner",
        difficulty: (prepTime + cookTime) > 60 || instructions.length > 8 ? "medium" : "easy",
        prepTime,
        cookTime,
        servings,
        ingredients,
        instructions,
        tags,
        imageUrl,
        sourceUrl: url,
      });
    } catch (err: any) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        return res.status(408).json({ error: "Request timed out. The site may be slow or blocking requests." });
      }
      return res.status(400).json({ error: err.message || "Failed to import recipe" });
    }
  });

  // === SHOPPING LIST GENERATOR ===
  app.post("/api/shopping-list", requireAuth, async (req, res) => {
    const { recipeIds } = req.body as { recipeIds: number[] };
    if (!recipeIds || !Array.isArray(recipeIds)) {
      return res.status(400).json({ error: "recipeIds array required" });
    }
    const householdId = authedUser(req).householdId;
    const staples = await storage.getPantryStaples(householdId);
    const stapleNames = new Set(staples.map(s => s.name.toLowerCase()));

    // Collect all ingredients from selected recipes (single batch query)
    const recipeRows = await storage.getRecipesByIds(recipeIds, householdId);
    const allIngredients: Array<{ name: string; amount: number; unit: string }> = [];
    for (const recipe of recipeRows) {
      try {
        const parsed: Array<{ name: string; amount: number; unit: string }> =
          recipe.ingredients ? JSON.parse(recipe.ingredients) : [];
        allIngredients.push(...parsed);
      } catch {
        console.warn(`Skipping recipe ${recipe.id}: malformed ingredients JSON`);
      }
    }

    const { totalItems, categories } = buildShoppingList(allIngredients, stapleNames);
    res.json({ totalItems, recipeCount: recipeIds.length, categories });
    storage.logEvent(authedUser(req).id, "shopping_list_generated", { recipeCount: recipeIds.length, totalItems });
  });

  // === PRODUCT ANALYTICS ===
  // Client-originated events only; server-side funnel events are logged at their
  // source. Strict allowlist — the client cannot invent event names, and no PII
  // beyond the session's user id is stored.
  const CLIENT_EVENTS = new Set(["upgrade_clicked"]);
  app.post("/api/events", requireAuth, async (req, res) => {
    const { event, properties } = (req.body ?? {}) as { event?: unknown; properties?: any };
    if (typeof event !== "string" || !CLIENT_EVENTS.has(event)) {
      return res.status(400).json({ error: "Unknown event" });
    }
    const source = typeof properties?.source === "string" ? properties.source.slice(0, 40) : undefined;
    await storage.logEvent(authedUser(req).id, event, source ? { source } : undefined);
    res.json({ ok: true });
  });
}
