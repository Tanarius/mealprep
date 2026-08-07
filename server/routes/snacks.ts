import { Router } from "express";
import { z } from "zod";
import { requireAuth, authedUser } from "../middleware/requireAuth";
import { storage } from "../storage";
import { guessCategory } from "../utils/categorization";
import { dedupeShoppingItems } from "../utils/dedupeShoppingItems";
import { insertShoppingListItemSchema } from "@shared/schema";
import rateLimit from "express-rate-limit";

const router = Router();

const searchRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: { error: "Too many searches. Slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

const bulkRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: { error: "Too many bulk-add requests. Slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Product Search (US-focused: Spoonacular → Nutritionix → USDA) ────────────

interface ProductResult {
  offId: string;
  name: string;
  brand: string;
  imageUrl: string | null;
  calories: number | null;
  protein: string | null;
  carbs: string | null;
  fat: string | null;
  categories: string[];
  servingDisplay?: string;
}

async function searchSpoonacular(q: string): Promise<ProductResult[]> {
  const key = process.env.SPOONACULAR_API_KEY;
  if (!key) return [];
  try {
    console.log(`[snacks/spoon] searching "${q}"`);
    const url = `https://api.spoonacular.com/food/products/search?query=${encodeURIComponent(q)}&number=24&apiKey=${key}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) { console.log(`[snacks/spoon] ${res.status}`); return []; }
    const data = await res.json() as { products?: { id: number; title: string; image: string }[] };
    const products = data.products ?? [];
    console.log(`[snacks/spoon] ${products.length} results`);
    return products.map(p => ({
      offId: `sp-${p.id}`,
      name: p.title ?? "",
      brand: "",
      imageUrl: p.image ? `https://spoonacular.com/productImages/${p.image}` : null,
      calories: null,
      protein: null,
      carbs: null,
      fat: null,
      categories: [],
    }));
  } catch (err) {
    console.log(`[snacks/spoon] error:`, (err as any)?.message);
    return [];
  }
}

async function searchNutritionix(q: string): Promise<ProductResult[]> {
  const appId = process.env.NUTRITIONIX_APP_ID;
  const appKey = process.env.NUTRITIONIX_APP_KEY;
  if (!appId || !appKey) return [];
  try {
    console.log(`[snacks/nutritionix] searching "${q}"`);
    const url = `https://trackapi.nutritionix.com/v2/search/instant?query=${encodeURIComponent(q)}&branded=true&self=false`;
    const res = await fetch(url, {
      headers: { "x-app-id": appId, "x-app-key": appKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { console.log(`[snacks/nutritionix] ${res.status}`); return []; }
    const data = await res.json() as { branded?: any[] };
    const branded = data.branded ?? [];
    console.log(`[snacks/nutritionix] ${branded.length} results`);
    return branded.map(item => ({
      offId: item.nix_item_id ?? `nix-${item.food_name}`,
      name: item.food_name ?? "",
      brand: item.brand_name ?? "",
      imageUrl: item.photo?.thumb ?? null,
      calories: typeof item.nf_calories === "number" ? Math.round(item.nf_calories) : null,
      protein: typeof item.nf_protein === "number" ? `${Math.round(item.nf_protein)}g` : null,
      carbs: typeof item.nf_total_carbohydrate === "number" ? `${Math.round(item.nf_total_carbohydrate)}g` : null,
      fat: typeof item.nf_total_fat === "number" ? `${Math.round(item.nf_total_fat)}g` : null,
      categories: [],
    }));
  } catch (err) {
    console.log(`[snacks/nutritionix] error:`, (err as any)?.message);
    return [];
  }
}

async function searchUSDA(q: string): Promise<ProductResult[]> {
  const apiKey = process.env.USDA_API_KEY ?? "DEMO_KEY";
  try {
    console.log(`[snacks/usda] searching "${q}"`);
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(q)}&dataType=Branded&pageSize=24&sortBy=score&sortOrder=desc&api_key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) { console.log(`[snacks/usda] ${res.status}`); return []; }
    const data = await res.json() as { foods?: any[] };
    const foods = data.foods ?? [];
    console.log(`[snacks/usda] ${foods.length} results, first: ${foods[0]?.description ?? "none"}`);
    return foods.map(f => {
      const nutrients: { nutrientName: string; value: number }[] = f.foodNutrients ?? [];
      const byName = (name: string) => nutrients.find(n => n.nutrientName === name)?.value ?? null;

      // USDA values are per 100g — scale to serving size
      const servingSize: number = f.servingSize ?? 100;
      const servingUnit: string = f.servingSizeUnit ?? "g";
      const factor = servingUnit.toLowerCase() === "g" ? servingSize / 100 : 1;

      const cal = byName("Energy");
      const prot = byName("Protein");
      const carb = byName("Carbohydrate, by difference");
      const fat = byName("Total lipid (fat)");

      return {
        offId: `usda-${f.fdcId}`,
        name: f.description ?? "",
        brand: f.brandOwner ?? f.brandName ?? "",
        imageUrl: null,
        calories: cal != null ? Math.round(cal * factor) : null,
        protein: prot != null ? `${Math.round(prot * factor)}g` : null,
        carbs: carb != null ? `${Math.round(carb * factor)}g` : null,
        fat: fat != null ? `${Math.round(fat * factor)}g` : null,
        categories: f.brandedFoodCategory ? [f.brandedFoodCategory] : [],
        servingDisplay: f.servingSize ? `per ${f.servingSize}${f.servingSizeUnit}` : "per 100g",
      };
    });
  } catch (err) {
    console.log(`[snacks/usda] error:`, (err as any)?.message);
    return [];
  }
}

async function searchProductsMultiSource(q: string): Promise<ProductResult[]> {
  // Strategy 1: USDA FoodData Central — primary, every US branded food
  const usda = await searchUSDA(q);
  if (usda.length >= 3) {
    console.log(`[snacks] resolved via usda (${usda.length})`);
    return usda;
  }

  // Strategy 2: Spoonacular — fallback if USDA sparse
  console.log(`[snacks/spoon] usda returned ${usda.length}, trying spoonacular`);
  const spoon = await searchSpoonacular(q);
  if (spoon.length >= 3) {
    console.log(`[snacks] resolved via spoonacular (${spoon.length})`);
    return spoon;
  }

  const partial = [...usda, ...spoon];
  if (partial.length >= 3) return partial;

  // Strategy 3: Nutritionix — final fallback if keys set
  const nix = await searchNutritionix(q);
  console.log(`[snacks] resolved via nutritionix (${nix.length})`);
  return [...partial, ...nix];
}

router.get("/products/search", requireAuth, searchRateLimit, async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.json([]);
    const results = await searchProductsMultiSource(q);
    res.json(results);
  } catch (err) { next(err); }
});

// ── Snack Wishlist ────────────────────────────────────────────────────────────

router.get("/wishlist", requireAuth, async (req, res, next) => {
  try {
    const householdId = authedUser(req).householdId;
    const items = await storage.getSnackWishlist(householdId);
    res.json(items);
  } catch (err) { next(err); }
});

router.post("/wishlist", requireAuth, async (req, res, next) => {
  try {
    const { name, brand, notes, imageUrl, productData } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Name required" });
    const householdId = authedUser(req).householdId;
    const userId = authedUser(req).id;
    const item = await storage.addSnackWishlistItem(householdId, userId, {
      name: name.trim(), brand, notes, imageUrl, productData,
    });
    res.status(201).json(item);
  } catch (err) { next(err); }
});

router.delete("/wishlist/:id", requireAuth, async (req, res, next) => {
  try {
    const householdId = authedUser(req).householdId;
    await storage.deleteSnackWishlistItem(Number(req.params.id), householdId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Move wishlist item → shopping list
router.post("/wishlist/:id/add-to-shopping", requireAuth, async (req, res, next) => {
  try {
    const householdId = authedUser(req).householdId;
    const userId = authedUser(req).id;
    const wishlist = await storage.getSnackWishlist(householdId);
    const item = wishlist.find(w => w.id === Number(req.params.id));
    if (!item) return res.status(404).json({ error: "Item not found" });
    const added = await storage.addShoppingItem(householdId, userId, {
      name: item.name,
      category: "snacks",
      source: "wishlist",
      sourceId: item.id,
      productData: item.productData ?? undefined,
    });
    res.json(added);
  } catch (err) { next(err); }
});

// ── Persistent Shopping List ─────────────────────────────────────────────────

router.get("/shopping", requireAuth, async (req, res, next) => {
  try {
    const householdId = authedUser(req).householdId;
    const items = await storage.getShoppingList(householdId);
    res.json(items);
  } catch (err) { next(err); }
});

router.post("/shopping", requireAuth, async (req, res, next) => {
  try {
    const householdId = authedUser(req).householdId;
    const userId = authedUser(req).id;
    const { name, amount, unit, category, source, sourceId, productData } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Name required" });
    const cat = category ?? guessCategory(name);
    const item = await storage.addShoppingItem(householdId, userId, {
      name: name.trim(), amount, unit, category: cat, source, sourceId, productData,
    });
    res.status(201).json(item);
  } catch (err) { next(err); }
});

// Bulk-add items (from recipe generation)
router.post("/shopping/bulk", requireAuth, bulkRateLimit, async (req, res, next) => {
  try {
    const householdId = authedUser(req).householdId;
    const userId = authedUser(req).id;
    const { items } = req.body as { items: { name: string; amount?: string; unit?: string; category?: string; source?: string; sourceId?: number }[] };
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "items array required" });
    if (items.length > 50) return res.status(400).json({ error: "Cannot add more than 50 items at once" });
    const enriched = dedupeShoppingItems(
      items.map(i => ({ ...i, category: i.category ?? guessCategory(i.name) }))
    );
    const added = await storage.bulkAddShoppingItems(householdId, userId, enriched);
    res.status(201).json(added);
  } catch (err) { next(err); }
});

// Atomic recipe-item sync — replaces ALL source='recipe' items with the supplied set in a
// single server-side transaction (delete-then-insert). Unlike /bulk this owns the swap
// atomically, so a failure can never leave the list emptied, and it allows an empty array
// (an empty plan validly clears recipe items). Manual/wishlist items are never touched.
// Its own generous cap (300) is safe: it's one authenticated, household-scoped call.
const syncItemSchema = insertShoppingListItemSchema.pick({
  name: true, amount: true, unit: true, category: true, sourceId: true,
});
const syncRecipeItemsSchema = z.object({ items: z.array(syncItemSchema).max(300) });

router.post("/shopping/sync-recipe-items", requireAuth, bulkRateLimit, async (req, res, next) => {
  try {
    const householdId = authedUser(req).householdId;
    const userId = authedUser(req).id;
    const parsed = syncRecipeItemsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const enriched = dedupeShoppingItems(
      parsed.data.items.map(i => ({
        name: i.name,
        amount: i.amount ?? undefined,
        unit: i.unit ?? undefined,
        category: i.category ?? guessCategory(i.name),
        sourceId: i.sourceId ?? undefined,
      }))
    );
    const synced = await storage.syncRecipeShoppingItems(householdId, userId, enriched);
    res.status(200).json({ count: synced.length, items: synced });
  } catch (err) { next(err); }
});

router.patch("/shopping/:id", requireAuth, async (req, res, next) => {
  try {
    const householdId = authedUser(req).householdId;
    const userId = authedUser(req).id;
    const { checked } = req.body;
    if (typeof checked !== "boolean") return res.status(400).json({ error: "checked boolean required" });
    const item = await storage.toggleShoppingItem(Number(req.params.id), householdId, userId, checked);
    if (!item) return res.status(404).json({ error: "Item not found" });
    res.json(item);
  } catch (err) { next(err); }
});

router.delete("/shopping/:id", requireAuth, async (req, res, next) => {
  try {
    await storage.deleteShoppingItem(Number(req.params.id), authedUser(req).householdId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.delete("/shopping", requireAuth, async (req, res, next) => {
  try {
    const householdId = authedUser(req).householdId;
    const { checked, source } = req.query;
    if (checked === "true") {
      await storage.clearCheckedShoppingItems(householdId);
    } else if (source === "recipe") {
      await storage.clearRecipeShoppingItems(householdId);
    } else {
      await storage.clearAllShoppingItems(householdId);
    }
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Attach product data to a shopping item (after user picks a product match)
router.patch("/shopping/:id/product", requireAuth, async (req, res, next) => {
  try {
    const householdId = authedUser(req).householdId;
    const { productData, imageUrl } = req.body;
    if (!productData) return res.status(400).json({ error: "productData required" });
    await storage.updateShoppingItemProduct(Number(req.params.id), householdId, productData, imageUrl);
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
