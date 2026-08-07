import { Router } from "express";
import { aiRateLimit, copilotRateLimit } from "../middleware/aiRateLimit";
import { authedUser } from "../middleware/requireAuth";
import {
  suggestRecipesFromPantry,
  selectWeeklyMeals,
  optimizeShoppingList,
  autoTagRecipe
} from "../services/anthropic";
import { chatWithCopilot } from "../services/copilot";
import { cleanRecipe } from "../services/recipeCleaner";
import { searchRecipesForCopilot, searchRecipes, enrichWithNutrition, type SpoonacularRecipe } from "../services/spoonacular";
import { parseRecipeQuery, cuisineChipToQuery } from "../utils/parseRecipeQuery";
import { storage } from "../storage";
import { aiCache, TTL_24H } from "../utils/cache";
import { detectTags } from "../utils/autoTag";
import { guessCuisine } from "../utils/categorization";

const router = Router();

// --- COPILOT ROUTES ---
router.post("/copilot/chat", copilotRateLimit, async (req, res, next) => {
  try {
    const { sessionId, content } = req.body;
    if (!sessionId || !content) return res.status(400).json({ error: "Missing sessionId or content" });

    const reply = await chatWithCopilot(authedUser(req).id, authedUser(req).householdId, sessionId, content);

    res.json({ message: reply, callsRemaining: res.locals.copilotCallsRemaining });
  } catch (err) {
    next(err);
  }
});

router.get("/copilot/history/:sessionId", async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const history = await storage.getCopilotHistory(authedUser(req).id, sessionId);
    // Return chronologically
    res.json(history.reverse());
  } catch (err) {
    next(err);
  }
});

router.post("/copilot/execute-tool", copilotRateLimit, async (req, res, next) => {
  try {
    const { sessionId, messageId, action, status } = req.body; // status: 'applied' | 'dismissed'
    
    await storage.updateProposedActionStatus(authedUser(req).id, sessionId, messageId, status);
    
    if (status === 'applied') {
      const p = action.parameters;
      // Real database execution
      switch (action.toolName) {
        case 'save_new_recipe': {
          // Parse raw ingredient strings into structured objects
          const parseIngredientString = (raw: string): { name: string; amount: number; unit: string; category: string } => {
            const amountUnitPattern = /^([\d./\s½⅓¼¾⅔⅛]+)\s*(cups?|tablespoons?|tbsp|teaspoons?|tsp|pounds?|lbs?|ounces?|oz|grams?|g|kg|cloves?|slices?|pieces?|cans?|whole|large|medium|small|bunch|stalks?|sprigs?|handfuls?)\.?\s*/i;
            const match = raw.match(amountUnitPattern);
            let name = raw;
            let amount = 1;
            let unit = '';
            if (match) {
              const rawAmt = match[1].trim().replace('½','0.5').replace('⅓','0.33').replace('¼','0.25').replace('¾','0.75');
              const parts = rawAmt.split(/\s+/);
              amount = parts.reduce((acc, p) => {
                if (p.includes('/')) { const [n,d] = p.split('/'); return acc + Number(n)/Number(d); }
                return acc + (Number(p) || 0);
              }, 0) || 1;
              unit = match[2]?.toLowerCase().replace(/s$/, '') || '';
              name = raw.slice(match[0].length).replace(/^,\s*/, '').trim() || raw;
            }
            return { name, amount, unit, category: 'other' };
          };

          const structuredIngredients = Array.isArray(p.ingredients)
            ? p.ingredients.map(parseIngredientString)
            : [];

          // Convert plain instruction text to JSON array of steps
          const structuredInstructions: string[] = [];
          if (typeof p.instructions === 'string') {
            p.instructions.split(/\n+/).forEach((line: string) => {
              const clean = line.replace(/^\d+\.\s*/, '').trim();
              if (clean.length > 5) structuredInstructions.push(clean);
            });
          } else if (Array.isArray(p.instructions)) {
            structuredInstructions.push(...p.instructions);
          }

          // picsum.photos: deterministic beautiful photo keyed to recipe name
          const picsumSeed = encodeURIComponent((p.name as string || 'food').trim().toLowerCase().replace(/\s+/g, '-'));
          const imageUrl = `https://picsum.photos/seed/${picsumSeed}/800/600`;

          // Build tips array
          const tips: string[] = [];
          if (p.tip) tips.push(p.tip);
          if (p.servingSuggestion) tips.push(`Serving: ${p.servingSuggestion}`);

          const recipe = await storage.createRecipe({
            householdId: authedUser(req).householdId,
            name: p.name,
            cuisine: p.cuisine || 'other',
            ingredients: JSON.stringify(structuredIngredients),
            instructions: JSON.stringify(structuredInstructions),
            mealType: p.mealType || 'dinner',
            difficulty: p.difficulty || 'medium',
            servings: p.servings || 2,
            prepTime: p.prepTime || 15,
            cookTime: p.cookTime || 20,
            description: p.description || '',
            // Use verified image/source from Spoonacular/TheMealDB lookup (not AI-generated URLs)
            sourceUrl: p.resolvedSourceUrl || null,
            imageUrl: p.resolvedImageUrl || null,
            tips,
            isProcessed: true,
          } as any);
          storage.logActivity(authedUser(req).id, "recipe_added", recipe.id, recipe.name);
          return res.json({ success: true, message: "Recipe saved to library!", recipeId: recipe.id });
        }

        case 'add_to_weekly_plan':
          const householdIdForPlan = authedUser(req).householdId;
          const weekPlan = await storage.getWeeklyPlan(p.weekStart, householdIdForPlan);
          let meals = weekPlan ? JSON.parse(weekPlan.meals) : {};
          // Use recipeId (number) so shopping list and recipe cards work correctly
          meals[`${p.dayOfWeek}_${p.mealType}`] = p.recipeId ?? p.recipeName;
          await storage.upsertWeeklyPlan({
            householdId: householdIdForPlan,
            weekStart: p.weekStart,
            meals: JSON.stringify(meals)
          });
          return res.json({ success: true, message: `Added to ${p.dayOfWeek} ${p.mealType}` });

        case 'add_to_shopping_list': {
          const rawItems: string[] = Array.isArray(p.items) ? p.items : [];
          if (rawItems.length === 0) {
            return res.json({ success: true, message: "No items to add." });
          }
          const amountUnitRe = /^([\d./\s½⅓¼¾⅔⅛]+)\s*(cups?|tablespoons?|tbsp|teaspoons?|tsp|pounds?|lbs?|ounces?|oz|grams?|g|kg|cloves?|slices?|pieces?|cans?|whole|large|medium|small|bunch|stalks?|sprigs?|handfuls?)\.?\s*/i;
          const parsed = rawItems.map(raw => {
            const match = raw.match(amountUnitRe);
            if (match) {
              return {
                name: raw.slice(match[0].length).replace(/^,\s*/, '').trim() || raw,
                amount: match[1].trim(),
                unit: match[2].toLowerCase().replace(/s$/, ''),
                source: 'copilot' as const,
              };
            }
            return { name: raw.trim(), source: 'copilot' as const };
          });
          await storage.bulkAddShoppingItems(
            authedUser(req).householdId,
            authedUser(req).id,
            parsed
          );
          return res.json({ success: true, message: `Added ${parsed.length} item${parsed.length === 1 ? '' : 's'} to your shopping list.` });
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Find real recipes via Spoonacular (no AI hallucination — real photos, real URLs)
router.post("/copilot/find-recipes", copilotRateLimit, async (req, res, next) => {
  try {
    const { query, cuisineChoice, mealType, maxReadyTime, diet, method } = req.body;
    const userId = authedUser(req).id;

    // Build ParsedQuery from text (if present) then overlay explicit chip selections.
    // ALL paths go through searchRecipes — cuisine is NEVER dropped in that function.
    // Taste profile is NOT used to filter search results (only for AI suggestions).
    const parsed = query?.trim() ? parseRecipeQuery(query) : { searchText: '', tags: [] as string[] };

    // Explicit chip selections always win over text-parsed values
    if (cuisineChoice && cuisineChoice !== 'surprise') {
      const { cuisine, excludeCuisine } = cuisineChipToQuery(cuisineChoice);
      parsed.cuisine = cuisine;
      if (excludeCuisine) parsed.excludeCuisine = excludeCuisine;
    }
    if (mealType) parsed.mealType = mealType;
    if (maxReadyTime) parsed.maxReadyTime = Number(maxReadyTime);
    if (diet) parsed.diet = diet;

    // Cooking method chip: append keyword to searchText and neutralise time limit
    if (method) {
      parsed.searchText = parsed.searchText ? `${parsed.searchText} ${method}` : method;
      if (method === 'slow cooker' || method === 'crockpot') parsed.maxReadyTime = undefined;
    }

    const foundRecipes = await searchRecipes(parsed, { number: 12 });
    res.json({ recipes: foundRecipes, callsRemaining: res.locals.copilotCallsRemaining });
  } catch (err) {
    next(err);
  }
});

// Save a Spoonacular recipe to the user's library directly (no AI execute-tool needed)
router.post("/copilot/save-recipe", copilotRateLimit, async (req, res, next) => {
  try {
    const { recipe }: { recipe: SpoonacularRecipe } = req.body;
    if (!recipe?.title) return res.status(400).json({ error: "Recipe data required" });

    const ingredients = recipe.ingredients.map(i => ({
      name: i.name,
      amount: i.amount,
      unit: i.unit,
      category: 'other',
    }));

    // Normalize cuisine — pass Spoonacular hint + title to shared guessCuisine util
    const rawCuisine = recipe.cuisines?.[0] ?? '';
    const cuisineNorm = guessCuisine(recipe.title, [rawCuisine]);

    const mealType = recipe.dishTypes?.includes('breakfast') ? 'breakfast'
      : recipe.dishTypes?.includes('lunch') ? 'lunch'
      : 'dinner';

    // Auto-detect tags from title + cook time
    const autoTags = detectTags(recipe.title, recipe.readyInMinutes, recipe.diets || []);

    const saved = await storage.createRecipe({
      householdId: authedUser(req).householdId,
      name: recipe.title,
      cuisine: cuisineNorm,
      mealType,
      difficulty: recipe.readyInMinutes <= 30 ? 'easy' : recipe.readyInMinutes <= 60 ? 'medium' : 'hard',
      servings: recipe.servings,
      prepTime: Math.round(recipe.readyInMinutes * 0.4),
      cookTime: Math.round(recipe.readyInMinutes * 0.6),
      description: recipe.summary,
      ingredients: JSON.stringify(ingredients),
      instructions: JSON.stringify(recipe.instructions),
      imageUrl: recipe.imageUrl || null,
      sourceUrl: recipe.sourceUrl || null,
      tags: JSON.stringify(autoTags),
      isProcessed: true,
    } as any);

    storage.logActivity(authedUser(req).id, "recipe_added", saved.id, saved.name);
    res.json({ success: true, recipe: saved });

    // Fire-and-forget: nutrition + image fallback
    const ingredientNames = ingredients.map(i => i.name);
    enrichWithNutrition(recipe.title, ingredientNames).then(nutrition => {
      if (nutrition) storage.updateRecipeNutrition(saved.id, JSON.stringify(nutrition)).catch(() => {});
    }).catch(() => {});

    if (!recipe.imageUrl) {
      const { CUISINE_EMOJI } = await import('../services/spoonacular');
      const emoji = CUISINE_EMOJI[cuisineNorm] ?? '🍽️';
      // Try Spoonacular first, fall back to emoji
      searchRecipes({ searchText: recipe.title, cuisine: cuisineNorm, tags: [] }, { number: 1 })
        .then(results => {
          const imgUrl = results[0]?.imageUrl || emoji;
          storage.updateRecipe(saved.id, authedUser(req).householdId, { imageUrl: imgUrl } as any).catch(() => {});
        }).catch(() => {
          storage.updateRecipe(saved.id, authedUser(req).householdId, { imageUrl: emoji } as any).catch(() => {});
        });
    }
  } catch (err) {
    next(err);
  }
});

// --- GENERAL AI ROUTES ---

// Apply general AI rate limit middleware to standard routes
router.use(aiRateLimit);

router.post("/clean-recipe/:id", async (req, res, next) => {
  try {
    const recipeId = parseInt(req.params.id);
    const householdId = authedUser(req).householdId;
    const dbRecipe = await storage.getRecipe(recipeId, householdId);
    if (!dbRecipe) return res.status(404).json({ error: "Recipe not found" });

    // Assuming we have basic raw representation
    let ingredientsArray = [];
    try { ingredientsArray = JSON.parse(dbRecipe.ingredients); } catch { ingredientsArray = [dbRecipe.ingredients]; }

    const cleaned = await cleanRecipe({
      name: dbRecipe.name,
      ingredients: ingredientsArray,
      instructions: dbRecipe.instructions || ''
    });

    // Flatten all cleaned steps into the instructions field so the recipe dialog renders them
    const flatSteps: string[] = cleaned.sections.flatMap((s: any) =>
      s.steps.map((step: any) => (typeof step === 'string' ? step : step.instruction ?? step.text ?? String(step)))
    );

    // Update DB
    await storage.updateRecipe(recipeId, householdId, {
      isProcessed: true,
      rawInstructions: dbRecipe.instructions,
      instructions: JSON.stringify(flatSteps),
      sections: cleaned.sections,
      cleanedSteps: cleaned.sections.flatMap((s: any) => s.steps),
      totalPrepTime: cleaned.totalPrepTime,
      totalCookTime: cleaned.totalCookTime,
      tips: cleaned.tips,
      difficulty: cleaned.difficulty,
    } as any);
    
    res.json({ success: true, recipe: cleaned });
  } catch (err) {
    next(err);
  }
});

router.post("/suggest", async (req, res, next) => {
  try {
    const { ingredients, preferences } = req.body;
    const userId = authedUser(req).id;

    // Build structured prefs — handle both string mood ("quick meal") and object
    let prefs: any;
    if (typeof preferences === 'string') {
      const moodMaxTime: Record<string, number> = { 'quick meal': 30, 'healthy': 45, 'comfort food': 60, 'surprise me': 60 };
      prefs = {
        dietary: [],
        cuisines: [],
        skillLevel: 'intermediate',
        maxPrepTime: moodMaxTime[preferences] ?? 60,
        moodPreference: preferences,
      };
    } else if (preferences) {
      prefs = preferences;
    } else {
      const userPrefs = await storage.getUserPreferences(userId);
      prefs = userPrefs || { dietary: [], cuisines: [], skillLevel: 'intermediate', maxPrepTime: 60 };
    }

    // Enrich prefs with taste profile
    const tasteProfile = await storage.getUserTasteProfile(userId);
    if (tasteProfile) {
      if (tasteProfile.likedCuisines?.length) prefs.cuisines = tasteProfile.likedCuisines;
      if (tasteProfile.dislikedIngredients?.length) prefs.dietary = [...(prefs.dietary || []), ...tasteProfile.dislikedIngredients.map((i: string) => `no ${i}`)];
      if (!prefs.moodPreference) {
        const complexityToSkill: Record<string, string> = { easy: 'beginner', medium: 'intermediate', hard: 'advanced' };
        prefs.skillLevel = complexityToSkill[tasteProfile.complexityPreference] || 'intermediate';
      }
    }

    // Fall back to pantry staples when no ingredients supplied
    let ingredientList: string[] = ingredients && ingredients.length > 0 ? ingredients : [];
    if (ingredientList.length === 0) {
      const staples = await storage.getPantryStaples(authedUser(req).householdId);
      ingredientList = staples.map(s => s.name);
    }

    const cacheKey = aiCache.generateKey('suggest', { ingredientList, prefs });
    const cached = aiCache.get<{recipes: any[]}>(cacheKey);
    if (cached) {
      // Cache hit: no Anthropic call, so no quota charge (the finish-hook skips when
      // servedFromCache is set). The middleware's remaining count assumed a pending
      // charge (limit - used - 1); uncharged, the real remaining is one higher.
      res.locals.servedFromCache = true;
      return res.json({ recipes: cached.recipes, callsRemaining: res.locals.aiCallsRemaining + 1, cached: true });
    }

    const recipes = await suggestRecipesFromPantry(ingredientList, prefs);
    aiCache.set(cacheKey, { recipes }, TTL_24H);

    res.json({ recipes, callsRemaining: res.locals.aiCallsRemaining });
  } catch (err) {
    next(err);
  }
});

router.post("/weekly-plan", async (req, res, next) => {
  try {
    const { schedule } = req.body;
    const userId = authedUser(req).id;
    const householdId = authedUser(req).householdId;

    const [recipes, recentMealNames, userPrefs] = await Promise.all([
      storage.getRecipes(householdId),
      storage.getRecentMealNames(householdId, 14),
      storage.getUserPreferences(userId),
    ]);

    if (recipes.length === 0) {
      return res.status(400).json({ error: "Add some recipes to your library first, then let Simmer plan your week." });
    }

    const cookingStyles: string[] = (userPrefs as any)?.cookingStyles ?? [];

    // Resolve recent meal names back to IDs so Claude can avoid them
    const recentMealIds = recentMealNames
      .map(name => recipes.find(r => r.name === name)?.id)
      .filter((id): id is number => id !== undefined);

    // Include tags so Claude can honour crockpot/meal-prep preferences
    const recipeList = recipes.map(r => ({
      id: r.id,
      name: r.name,
      cuisine: r.cuisine,
      mealType: r.mealType,
      prepTime: r.prepTime,
      cookTime: r.cookTime,
      tags: r.tags,
    }));

    const cacheKey = aiCache.generateKey('weekly', { schedule, recipeIds: recipeList.map(r => r.id), cookingStyles });
    const cached = aiCache.get<{ meals: Record<string, number> }>(cacheKey);
    if (cached) {
      // Cache hit: no charge (see /suggest above) — report the uncharged remaining count.
      res.locals.servedFromCache = true;
      return res.json({ meals: cached.meals, callsRemaining: res.locals.aiCallsRemaining + 1, cached: true });
    }

    const meals = await selectWeeklyMeals(recipeList, schedule, recentMealIds, cookingStyles);
    aiCache.set(cacheKey, { meals }, TTL_24H);

    res.json({ meals, callsRemaining: res.locals.aiCallsRemaining });
  } catch (err) {
    next(err);
  }
});

router.post("/optimize-shopping-list", async (req, res, next) => {
  try {
    const { listItems } = req.body; 
    const staples = await storage.getPantryStaples(authedUser(req).householdId);
    const pantryItems = staples.map(s => s.name);

    const optimizedList = await optimizeShoppingList(listItems || [], pantryItems);
    res.json({ optimizedList, callsRemaining: res.locals.aiCallsRemaining });
  } catch (err) {
    next(err);
  }
});

router.post("/tag-recipe", async (req, res, next) => {
  try {
    const { recipeId } = req.body;
    const recipe = await storage.getRecipe(recipeId, authedUser(req).householdId);
    if (!recipe) return res.status(404).json({ error: "Recipe not found" });

    try {
      const parsedIngredients = typeof recipe.ingredients === "string" ? JSON.parse(recipe.ingredients) : recipe.ingredients;
      const stepStrings = recipe.instructions ? JSON.parse(recipe.instructions) : [];

      const tags = await autoTagRecipe(recipe.name, parsedIngredients, stepStrings);

      await storage.updateRecipe(recipeId, authedUser(req).householdId, {
        tags: JSON.stringify(tags.dietaryFlags || []),
        difficulty: tags.difficulty || 'medium',
        prepTime: tags.prepTime || 15,
        cookTime: tags.cookTime || 30,
        mealType: tags.mealType || 'dinner'
      });
      res.json({ tags });
    } catch (tagError) {
      console.error("Auto tag failed", tagError);
      res.json({ tags: {} });
    }
  } catch (err) {
    next(err);
  }
});

// ── Social Media Import ─────────────────────────────────────────────────────
// Accepts either a pasted caption (text) or a base64-encoded screenshot (image).
// Returns the same shape as /api/recipes/import-url so the frontend can reuse
// the same populate logic.

const SOCIAL_RECIPE_PROMPT = `You are a recipe extraction assistant. Extract a recipe from the provided content (a social media post caption or screenshot). Return ONLY a raw JSON object with no markdown fences, no explanation. If no recipe is found, return {"error": "No recipe found"}.

JSON shape:
{
  "name": string,
  "description": string,
  "cuisine": "tex-mex"|"italian"|"asian"|"american"|"mediterranean"|"indian"|"other",
  "mealType": "breakfast"|"lunch"|"dinner"|"either",
  "servings": number,
  "prepTime": number (minutes),
  "cookTime": number (minutes),
  "ingredients": [{"name": string, "amount": number, "unit": string}],
  "instructions": [string],
  "tags": string[]
}

Rules:
- ingredients[].amount must be a number (use 1 if unclear)
- instructions must be an array of plain strings (no numbering)
- tags: only values from: crockpot, slow-cook, grilled, quick, make-ahead, freezer-friendly, one-pot, one-pan, air-fryer
- If prep/cook times are not mentioned, use 0
- If the image is a screenshot with partial text, extract whatever is visible
- Cuisine detection: infer from dish name and ingredients. pasta/risotto/pizza → italian; tortillas/salsa/chipotle/jalapeño → tex-mex; soy sauce/ginger/bok choy/noodles/rice/miso/kimchi/curry → asian; tikka/masala/naan/ghee/turmeric → indian; olive oil/feta/hummus/pita/tahini → mediterranean; burger/bbq/mac and cheese/biscuits → american; when uncertain → other`;

router.post("/import-from-social", aiRateLimit, async (req, res, next) => {
  try {
    const { mode, content, mimeType } = req.body;

    if (!mode || !content) {
      return res.status(400).json({ error: "mode and content are required" });
    }
    if (mode !== "text" && mode !== "image") {
      return res.status(400).json({ error: "mode must be 'text' or 'image'" });
    }

    // Image size guard: base64 of 10MB binary ≈ 13.7MB string
    if (mode === "image" && content.length > 14_000_000) {
      return res.status(400).json({ error: "Image too large. Please use a screenshot under 10 MB." });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      const e: any = new Error("ANTHROPIC_API_KEY is not configured");
      e.status = 503;
      throw e;
    }

    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    let messageContent: any[];

    if (mode === "text") {
      messageContent = [{ type: "text", text: `Social media post content:\n\n${content}` }];
    } else {
      // Image mode — use vision
      const validMimeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      const safeMime = validMimeTypes.includes(mimeType) ? mimeType : "image/jpeg";

      // Strip data URL prefix if present
      const base64Data = content.replace(/^data:image\/[a-z]+;base64,/, "");

      messageContent = [
        {
          type: "image",
          source: { type: "base64", media_type: safeMime, data: base64Data },
        },
        { type: "text", text: "Extract the recipe from this social media screenshot." },
      ];
    }

    // Use Sonnet for image (better OCR), Haiku for text (cheaper + fast enough)
    const model = mode === "image" ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";

    const msg = await client.messages.create({
      model,
      max_tokens: 1500,
      system: SOCIAL_RECIPE_PROMPT,
      messages: [{ role: "user", content: messageContent }],
    });

    const textBlock = msg.content.find((b) => b.type === "text") as any;
    if (!textBlock?.text) {
      return res.status(422).json({ error: "No response from the assistant" });
    }

    let raw = textBlock.text.trim();
    if (raw.startsWith("```")) raw = raw.replace(/^```[a-z]*\n?/, "").replace(/```$/, "").trim();

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(422).json({ error: "Could not parse the assistant's response" });
    }

    if (parsed.error) {
      return res.status(422).json({ error: parsed.error });
    }

    // Normalise types — Claude sometimes returns amounts as strings
    if (Array.isArray(parsed.ingredients)) {
      parsed.ingredients = parsed.ingredients.map((ing: any) => ({
        ...ing,
        amount: typeof ing.amount === "number" ? ing.amount : parseFloat(ing.amount) || 1,
        unit: ing.unit ?? "",
      }));
    }

    res.json(parsed);
  } catch (err) {
    next(err);
  }
});

export default router;
