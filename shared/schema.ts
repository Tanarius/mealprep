import { pgTable, text, integer, serial, date, boolean, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const households = pgTable('households', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  inviteCode: text('invite_code').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
});

// First-party product analytics. One row per event; properties never contain PII
// beyond the user id (which is scrubbed on account deletion via deleteUserData).
export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  event: text("event").notNull(),
  properties: jsonb("properties"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").unique(),
  resetToken: text("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
  subscriptionTier: text("subscription_tier").notNull().default('free'),
  aiCallsToday: integer("ai_calls_today").notNull().default(0),
  aiCallsResetDate: date("ai_calls_reset_date"),
  copilotCallsToday: integer("copilot_calls_today").notNull().default(0),
  copilotResetDate: date("copilot_reset_date"),
  // Monthly usage windows (the binding limits for free/premium; "YYYY-MM" key shared
  // by all three counters — they reset together on the calendar-month boundary)
  aiCallsMonth: integer("ai_calls_month").notNull().default(0),
  copilotCallsMonth: integer("copilot_calls_month").notNull().default(0),
  importsMonth: integer("imports_month").notNull().default(0),
  usageMonthKey: text("usage_month_key"),
  householdId: integer("household_id").references(() => households.id),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  avatar: text("avatar"), // emoji string e.g. "👨‍🍳"
});

export const recipes = pgTable("recipes", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").references(() => households.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  cuisine: text("cuisine").notNull(), // tex-mex, italian, asian, american, other
  mealType: text("meal_type").notNull(), // lunch, dinner, either
  difficulty: text("difficulty").notNull(), // easy, medium
  prepTime: integer("prep_time"), // minutes
  cookTime: integer("cook_time"), // minutes
  servings: integer("servings").notNull().default(3),
  ingredients: text("ingredients").notNull(), // JSON array
  instructions: text("instructions"), // JSON array of steps
  tags: text("tags"), // JSON array: crockpot, quick, make-ahead, freezer-friendly, etc.
  imageUrl: text("image_url"),
  sourceUrl: text("source_url"),
  isFavorite: integer("is_favorite").default(0),

  // AI tagging (populated by autoTagRecipe on save)
  cuisineType: text('cuisine_type'),
  // difficulty already exists
  dietaryFlags: text('dietary_flags').array().default([]),
  // mealType already exists
  
  // AI cleaning pipeline
  isProcessed: boolean('is_processed').notNull().default(false),
  rawInstructions: text('raw_instructions'),
  sections: jsonb('sections'),
  cleanedSteps: jsonb('cleaned_steps'),
  totalPrepTime: integer('total_prep_time'),
  totalCookTime: integer('total_cook_time'),
  tips: text('tips').array().default([]),

  // Nutrition data (JSON: { calories, protein, carbs, fat, fiber })
  nutritionData: text('nutrition_data'),
});

export const weeklyPlans = pgTable("weekly_plans", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").references(() => households.id).notNull(),
  weekStart: text("week_start").notNull(), // ISO date string for Monday
  meals: text("meals").notNull(), // JSON: { mon_lunch: recipeId, mon_dinner: recipeId, ... }
  mealMeta: text("meal_meta"), // JSON: { mon_lunch: { addedBy: "Allie" }, notes: { mon: "pizza night" } }
});

export const pantryStaples = pgTable("pantry_staples", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").references(() => households.id).notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(), // spices, oils, condiments, grains, etc.
});

// --- NEW TABLES ---

export const userPreferences = pgTable('user_preferences', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull().unique(),
  dietary: text('dietary').array().default([]),
  cuisines: text('cuisines').array().default([]),
  skillLevel: text('skill_level').notNull().default('intermediate'),
  maxPrepTime: integer('max_prep_time').notNull().default(60),
  cookingStyles: text('cooking_styles').array().default([]), // quick, classic, crockpot, meal-prep
  householdSize: integer('household_size').default(2),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const userOnboarding = pgTable('user_onboarding', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull().unique(),
  completed: boolean('completed').notNull().default(false),
  cookingMode: text('cooking_mode'),
  currentStep: integer('current_step').notNull().default(1),
  completedAt: timestamp('completed_at'),
});

export const onboardingSwipes = pgTable('onboarding_swipes', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  dishName: text('dish_name').notNull(),
  imageUrl: text('image_url').notNull(),
  cuisineType: text('cuisine_type').notNull(),
  complexity: text('complexity').notNull(),
  mealType: text('meal_type').notNull(),
  liked: boolean('liked').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userTasteProfile = pgTable('user_taste_profile', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull().unique(),
  cookingMode: text('cooking_mode').notNull().default('eater'),
  likedCuisines: text('liked_cuisines').array().default([]),
  dislikedCuisines: text('disliked_cuisines').array().default([]),
  likedIngredients: text('liked_ingredients').array().default([]),
  dislikedIngredients: text('disliked_ingredients').array().default([]),
  // ingredient substitutions: { "cilantro": "parsley", "mushrooms": null (just avoid) }
  ingredientSubstitutions: jsonb('ingredient_substitutions').default({}),
  complexityPreference: text('complexity_preference').notNull().default('medium'),
  preferredMealTypes: text('preferred_meal_types').array().default([]),
  cuisineSignals: jsonb('cuisine_signals').default({}),
  derivedFrom: integer('derived_from').notNull().default(0),
  lastUpdated: timestamp('last_updated').defaultNow(),
});

export const householdTasteProfile = pgTable('household_taste_profile', {
  id: serial('id').primaryKey(),
  householdId: integer('household_id').notNull().unique(),
  memberCount: integer('member_count').notNull().default(1),
  sharedCuisines: text('shared_cuisines').array().default([]),
  avoidCuisines: text('avoid_cuisines').array().default([]),
  complexityConsensus: text('complexity_consensus').notNull().default('easy'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const copilotSessions = pgTable('copilot_sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  sessionId: text('session_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  proposedAction: jsonb('proposed_action'),
  timestamp: timestamp('timestamp').defaultNow(),
});

export const mealReactions = pgTable("meal_reactions", {
  id:        serial("id").primaryKey(),
  weekStart: text("week_start").notNull(),
  slotKey:   text("slot_key").notNull(),
  userId:    integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  emoji:     text("emoji").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ uniq: unique().on(t.weekStart, t.slotKey, t.userId) }));
export type MealReaction = typeof mealReactions.$inferSelect;

export const snackWishlist = pgTable("snack_wishlist", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").references(() => households.id).notNull(),
  addedBy: integer("added_by").references(() => users.id),
  name: text("name").notNull(),
  brand: text("brand"),
  notes: text("notes"),
  imageUrl: text("image_url"),
  productData: text("product_data"), // JSON from Open Food Facts
  createdAt: timestamp("created_at").defaultNow(),
});
export type SnackWishlistItem = typeof snackWishlist.$inferSelect;

export const shoppingListItems = pgTable("shopping_list_items", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").references(() => households.id).notNull(),
  addedBy: integer("added_by").references(() => users.id),
  name: text("name").notNull(),
  amount: text("amount"),
  unit: text("unit"),
  category: text("category").notNull().default("other"),
  checked: boolean("checked").notNull().default(false),
  checkedBy: integer("checked_by").references(() => users.id),
  checkedAt: timestamp("checked_at"),
  source: text("source").default("manual"), // "recipe" | "wishlist" | "manual"
  sourceId: integer("source_id"),
  productData: text("product_data"), // JSON: { imageUrl, brand, offId }
  createdAt: timestamp("created_at").defaultNow(),
});
export type ShoppingListItem = typeof shoppingListItems.$inferSelect;

export const activityLog = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  action: text("action").notNull(), // 'recipe_added' | 'recipe_deleted' | 'pantry_added' | 'plan_updated'
  recipeId: integer("recipe_id"),         // nullable, no cascade FK — survives recipe deletion
  recipeName: text("recipe_name"),        // denormalized snapshot at write time
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Insert schemas
// householdId is always injected server-side from the authenticated user — omit from client-facing schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertRecipeSchema = createInsertSchema(recipes).omit({ id: true, householdId: true });
export const insertWeeklyPlanSchema = createInsertSchema(weeklyPlans).omit({ id: true, householdId: true });
export const insertPantryStapleSchema = createInsertSchema(pantryStaples).omit({ id: true, householdId: true });
// Client-facing shape for a shopping-list item. householdId/addedBy and all check/timestamp
// columns are server-controlled, so they're omitted. `source` is accepted but the
// recipe-sync endpoint forces it to "recipe" regardless.
export const insertShoppingListItemSchema = createInsertSchema(shoppingListItems).omit({
  id: true, householdId: true, addedBy: true,
  checked: true, checkedBy: true, checkedAt: true, createdAt: true,
});
export const updateUserTasteProfileSchema = createInsertSchema(userTasteProfile)
  .omit({ id: true, userId: true, derivedFrom: true, lastUpdated: true, cuisineSignals: true })
  .partial();

// Types
export type Household = typeof households.$inferSelect;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Recipe = typeof recipes.$inferSelect;
export type InsertRecipe = z.infer<typeof insertRecipeSchema> & { householdId: number };
export type WeeklyPlan = typeof weeklyPlans.$inferSelect;
export type InsertWeeklyPlan = z.infer<typeof insertWeeklyPlanSchema> & { householdId: number };
export type PantryStaple = typeof pantryStaples.$inferSelect;
export type InsertPantryStaple = z.infer<typeof insertPantryStapleSchema> & { householdId: number };
export type UserPreference = typeof userPreferences.$inferSelect;
export type UserTasteProfile = typeof userTasteProfile.$inferSelect;
export type CopilotSession = typeof copilotSessions.$inferSelect;
export type ActivityLogEntry = typeof activityLog.$inferSelect;
export type WeeklyPlanWithMeta = WeeklyPlan & { mealMeta?: string | null };

// Ingredient type for parsing
export interface Ingredient {
  name: string;
  amount: number;
  unit: string;
  category: string; // produce, protein, dairy, pantry, frozen, bakery
}

/*
INDEX RECOMMENDATIONS for DBA:
-- Efficient onboarding swipe queries
CREATE INDEX onboarding_swipes_user_idx ON onboarding_swipes(user_id, created_at DESC);

-- Efficient copilot history queries  
CREATE INDEX copilot_sessions_user_session_idx ON copilot_sessions(user_id, session_id, timestamp DESC);

-- Efficient recipe filtering by cuisine/difficulty for taste matching
CREATE INDEX recipes_cuisine_difficulty_idx ON recipes(cuisine_type, difficulty);

-- Efficient AI usage lookups
CREATE INDEX users_ai_reset_idx ON users(id, ai_calls_reset_date);
*/
