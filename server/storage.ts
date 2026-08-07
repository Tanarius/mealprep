import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  recipes, weeklyPlans, pantryStaples, users, households,
  userPreferences, userOnboarding, onboardingSwipes,
  userTasteProfile, householdTasteProfile, copilotSessions, activityLog, mealReactions,
  snackWishlist, shoppingListItems, events
} from "@shared/schema";
import type {
  Recipe, InsertRecipe, WeeklyPlan, InsertWeeklyPlan,
  PantryStaple, InsertPantryStaple, User, InsertUser,
  UserPreference, UserTasteProfile as DbUserTasteProfile, CopilotSession, ActivityLogEntry,
  MealReaction, Household, SnackWishlistItem, ShoppingListItem
} from "@shared/schema";
import { eq, desc, and, inArray, sql } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("ERROR: DATABASE_URL environment variable is not set!");
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

const db = drizzle(pool);

export interface IStorage {
  init(): Promise<void>;

  // Households
  createHousehold(name: string, inviteCode: string): Promise<Household>;
  getHousehold(id: number): Promise<Household | undefined>;
  getHouseholdByInviteCode(code: string): Promise<Household | undefined>;
  getHouseholdMembers(householdId: number): Promise<User[]>;
  setUserHousehold(userId: number, householdId: number): Promise<void>;
  updateHouseholdName(householdId: number, name: string): Promise<void>;
  updateHouseholdInviteCode(householdId: number, inviteCode: string): Promise<void>;
  updateUserPassword(userId: number, hashedPassword: string): Promise<void>;
  getUserByEmail(email: string): Promise<User | undefined>;
  setUserEmail(userId: number, email: string): Promise<void>;
  setUserAvatar(userId: number, avatar: string): Promise<void>;
  setResetToken(userId: number, token: string, expiry: Date): Promise<void>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  clearResetToken(userId: number): Promise<void>;

  // Users & AI Limits
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getUserAiUsage(userId: number): Promise<{ aiCallsToday: number; aiCallsResetDate: string | null; copilotCallsToday: number; copilotResetDate: string | null; aiCallsMonth: number; copilotCallsMonth: number; importsMonth: number; usageMonthKey: string | null; subscriptionTier: string }>;
  incrementAiCalls(userId: number): Promise<{ newCount: number }>;
  incrementCopilotCalls(userId: number): Promise<{ newCount: number }>;
  incrementImportCalls(userId: number): Promise<{ newCount: number }>;
  resetAiCallsIfNewDay(userId: number): Promise<void>;
  resetCopilotCallsIfNewDay(userId: number): Promise<void>;
  resetMonthlyCountersIfNewMonth(userId: number): Promise<void>;
  getGlobalAiCallsToday(): Promise<number>;
  incrementGlobalAiCalls(units: number): Promise<void>;
  claimGlobalAiAlert(kind: "soft" | "hard"): Promise<boolean>;

  // Product analytics
  logEvent(userId: number | null, event: string, properties?: Record<string, unknown>): Promise<void>;
  getEventCounts(days: number): Promise<Array<{ event: string; count: number }>>;
  updateUserSubscriptionTier(userId: number, tier: string): Promise<void>;
  setStripeCustomer(userId: number, customerId: string): Promise<void>;
  setStripeSubscription(userId: number, subscriptionId: string | null): Promise<void>;
  getUserByStripeCustomerId(customerId: string): Promise<User | undefined>;
  deleteUserData(userId: number, householdId: number): Promise<void>;

  // Preferences & Onboarding
  getUserPreferences(userId: number): Promise<UserPreference | null>;
  upsertUserPreferences(userId: number, prefs: Partial<UserPreference>): Promise<void>;
  getOnboardingState(userId: number): Promise<any | null>;
  createOnboardingState(userId: number): Promise<any>;
  updateOnboardingStep(userId: number, step: number): Promise<void>;
  setOnboardingMode(userId: number, cookingMode: 'cook' | 'eater'): Promise<void>;
  completeOnboarding(userId: number): Promise<void>;
  saveOnboardingSwipe(userId: number, swipe: any): Promise<void>;
  getOnboardingSwipes(userId: number): Promise<any[]>;
  getOnboardingSwipeCount(userId: number): Promise<number>;

  // Taste Profiles
  getUserTasteProfile(userId: number): Promise<DbUserTasteProfile | null>;
  upsertUserTasteProfile(userId: number, profile: Partial<DbUserTasteProfile>): Promise<void>;
  getHouseholdTasteProfile(householdId: number): Promise<any | null>;
  upsertHouseholdTasteProfile(householdId: number, profile: Partial<any>): Promise<void>;
  getAllHouseholdMemberProfiles(householdId: number): Promise<DbUserTasteProfile[]>;
  incrementCuisineSignal(userId: number, cuisineType: string): Promise<void>;
  getRecentMealNames(householdId: number, limit?: number): Promise<string[]>;

  // Copilot Logic
  getCopilotHistory(userId: number, sessionId: string, limit?: number): Promise<any[]>;
  saveCopilotMessage(userId: number, sessionId: string, message: any): Promise<number>;
  updateProposedActionStatus(userId: number, sessionId: string, messageId: number, status: 'applied' | 'dismissed'): Promise<void>;

  // Recipes & Plans
  getRecipes(householdId: number): Promise<Recipe[]>;
  getRecipe(id: number, householdId?: number): Promise<Recipe | undefined>;
  getRecipesByIds(ids: number[], householdId: number): Promise<Recipe[]>;
  createRecipe(recipe: InsertRecipe): Promise<Recipe>;
  updateRecipe(id: number, householdId: number, recipe: Partial<InsertRecipe>): Promise<Recipe | undefined>;
  updateRecipeNutrition(id: number, nutritionJson: string): Promise<void>;
  deleteRecipe(id: number, householdId: number): Promise<void>;
  toggleFavorite(id: number, householdId: number): Promise<Recipe | undefined>;

  getWeeklyPlans(householdId: number): Promise<WeeklyPlan[]>;
  getWeeklyPlan(weekStart: string, householdId: number): Promise<WeeklyPlan | undefined>;
  upsertWeeklyPlan(plan: InsertWeeklyPlan): Promise<WeeklyPlan>;
  deleteWeeklyPlan(id: number, householdId: number): Promise<void>;

  getPantryStaples(householdId: number): Promise<PantryStaple[]>;
  createPantryStaple(staple: InsertPantryStaple): Promise<PantryStaple>;
  deletePantryStaple(id: number, householdId: number): Promise<void>;

  seedDefaultData(): Promise<void>;

  // Activity Feed
  logActivity(userId: number, action: string, recipeId?: number | null, recipeName?: string | null): Promise<void>;
  getRecentActivity(householdId: number, limit?: number): Promise<(ActivityLogEntry & { username: string; avatar: string | null })[]>;

  // Meal Reactions
  upsertReaction(weekStart: string, slotKey: string, userId: number, emoji: string): Promise<void>;
  deleteReaction(weekStart: string, slotKey: string, userId: number): Promise<void>;
  getReactionsForWeek(weekStart: string, householdId: number): Promise<MealReaction[]>;

  // Snack Wishlist
  getSnackWishlist(householdId: number): Promise<SnackWishlistItem[]>;
  addSnackWishlistItem(householdId: number, userId: number, item: { name: string; brand?: string; notes?: string; imageUrl?: string; productData?: string }): Promise<SnackWishlistItem>;
  deleteSnackWishlistItem(id: number, householdId: number): Promise<void>;

  // Persistent Shopping List
  getShoppingList(householdId: number): Promise<ShoppingListItem[]>;
  addShoppingItem(householdId: number, userId: number, item: { name: string; amount?: string; unit?: string; category?: string; source?: string; sourceId?: number; productData?: string }): Promise<ShoppingListItem>;
  bulkAddShoppingItems(householdId: number, userId: number, items: { name: string; amount?: string; unit?: string; category?: string; source?: string; sourceId?: number }[]): Promise<ShoppingListItem[]>;
  syncRecipeShoppingItems(householdId: number, userId: number, items: { name: string; amount?: string; unit?: string; category?: string; sourceId?: number }[]): Promise<ShoppingListItem[]>;
  toggleShoppingItem(id: number, householdId: number, userId: number, checked: boolean): Promise<ShoppingListItem | undefined>;
  deleteShoppingItem(id: number, householdId: number): Promise<void>;
  clearCheckedShoppingItems(householdId: number): Promise<void>;
  clearAllShoppingItems(householdId: number): Promise<void>;
  clearRecipeShoppingItems(householdId: number): Promise<void>;
  updateShoppingItemProduct(id: number, householdId: number, productData: string, imageUrl?: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async init(): Promise<void> {
    // Each statement must be a separate pool.query() — node-postgres multi-statement
    // strings are unreliable (only last result returned, errors may silently skip).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS households (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        invite_code TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`INSERT INTO households (id, name, invite_code) VALUES (1, 'Home', 'HOME0001') ON CONFLICT DO NOTHING`);
    await pool.query(`SELECT setval('households_id_seq', GREATEST((SELECT MAX(id) FROM households), 1))`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS household_id INTEGER REFERENCES households(id)`);
    await pool.query(`UPDATE users SET household_id = 1 WHERE household_id IS NULL`);
    await pool.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS household_id INTEGER REFERENCES households(id)`);
    await pool.query(`UPDATE recipes SET household_id = 1 WHERE household_id IS NULL`);
    await pool.query(`ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS household_id INTEGER REFERENCES households(id)`);
    await pool.query(`UPDATE weekly_plans SET household_id = 1 WHERE household_id IS NULL`);
    await pool.query(`ALTER TABLE pantry_staples ADD COLUMN IF NOT EXISTS household_id INTEGER REFERENCES households(id)`);
    await pool.query(`UPDATE pantry_staples SET household_id = 1 WHERE household_id IS NULL`);

    // Email + password reset columns
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expiry TIMESTAMP`);
    // Monthly usage windows (finite tier caps)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_calls_month INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS copilot_calls_month INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS imports_month INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS usage_month_key TEXT`);

    // User preference columns added for onboarding v2
    await pool.query(`ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS cooking_styles TEXT[] DEFAULT '{}'`);
    await pool.query(`ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS household_size INTEGER DEFAULT 2`);

    // AI cleaning pipeline columns (added after initial deploy)
    await pool.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS is_processed BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS raw_instructions TEXT`);
    await pool.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS sections JSONB`);
    await pool.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS cleaned_steps JSONB`);
    await pool.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS total_prep_time INTEGER`);
    await pool.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS total_cook_time INTEGER`);
    await pool.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS tips TEXT[]`);
    await pool.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS cuisine_type TEXT`);
    await pool.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS dietary_flags TEXT[] DEFAULT '{}'`);
    await pool.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS meal_meta TEXT`);

    // Weekly plan meta column
    await pool.query(`ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS meal_meta TEXT`);

    // Meal reactions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meal_reactions (
        id SERIAL PRIMARY KEY,
        week_start TEXT NOT NULL,
        slot_key TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        UNIQUE(week_start, slot_key, user_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS meal_reactions_week_idx ON meal_reactions(week_start)`);

    // Global AI usage — single-row counter behind the daily spend circuit breaker
    await pool.query(`
      CREATE TABLE IF NOT EXISTS global_ai_usage (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        calls_today INTEGER NOT NULL DEFAULT 0,
        reset_date TEXT,
        soft_alerted_date TEXT,
        hard_alerted_date TEXT
      )
    `);
    await pool.query(`INSERT INTO global_ai_usage (id) VALUES (1) ON CONFLICT DO NOTHING`);

    // First-party product analytics events
    await pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        event TEXT NOT NULL,
        properties JSONB,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS events_event_created_idx ON events(event, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS events_user_idx ON events(user_id)`);

    // Performance indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS onboarding_swipes_user_idx ON onboarding_swipes(user_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS copilot_sessions_user_session_idx ON copilot_sessions(user_id, session_id, timestamp DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS recipes_cuisine_difficulty_idx ON recipes(cuisine_type, difficulty)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS users_ai_reset_idx ON users(id, ai_calls_reset_date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS shopping_list_items_household_checked_idx ON shopping_list_items(household_id, checked)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS activity_log_user_created_idx ON activity_log(user_id, created_at DESC)`);
  }

  // Households
  async createHousehold(name: string, inviteCode: string): Promise<Household> {
    const rows = await db.insert(households).values({ name, inviteCode }).returning();
    return rows[0];
  }

  async getHousehold(id: number): Promise<Household | undefined> {
    const rows = await db.select().from(households).where(eq(households.id, id));
    return rows[0];
  }

  async getHouseholdByInviteCode(code: string): Promise<Household | undefined> {
    const rows = await db.select().from(households).where(eq(households.inviteCode, code));
    return rows[0];
  }

  async getHouseholdMembers(householdId: number): Promise<User[]> {
    return await db.select().from(users).where(eq(users.householdId, householdId));
  }

  async setUserHousehold(userId: number, householdId: number): Promise<void> {
    await db.update(users).set({ householdId }).where(eq(users.id, userId));
  }

  async updateHouseholdName(householdId: number, name: string): Promise<void> {
    await db.update(households).set({ name }).where(eq(households.id, householdId));
  }

  async updateHouseholdInviteCode(householdId: number, inviteCode: string): Promise<void> {
    await db.update(households).set({ inviteCode }).where(eq(households.id, householdId));
  }

  async updateUserPassword(userId: number, hashedPassword: string): Promise<void> {
    await db.update(users).set({ password: hashedPassword }).where(eq(users.id, userId));
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.email, email));
    return rows[0];
  }

  async setUserEmail(userId: number, email: string): Promise<void> {
    await db.update(users).set({ email }).where(eq(users.id, userId));
  }

  async setUserAvatar(userId: number, avatar: string): Promise<void> {
    await db.update(users).set({ avatar } as any).where(eq(users.id, userId));
  }

  async setResetToken(userId: number, token: string, expiry: Date): Promise<void> {
    await db.update(users).set({ resetToken: token, resetTokenExpiry: expiry }).where(eq(users.id, userId));
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.resetToken, token));
    const user = rows[0];
    if (!user || !user.resetTokenExpiry) return undefined;
    if (new Date() > user.resetTokenExpiry) return undefined; // expired
    return user;
  }

  async clearResetToken(userId: number): Promise<void> {
    await db.update(users).set({ resetToken: null, resetTokenExpiry: null }).where(eq(users.id, userId));
  }

  // Users & AI Limits
  async getUser(id: number): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.id, id));
    return rows[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.username, username));
    return rows[0];
  }

  async createUser(user: InsertUser): Promise<User> {
    const rows = await db.insert(users).values(user).returning();
    return rows[0];
  }

  async getUserAiUsage(userId: number) {
    const user = await this.getUser(userId);
    if (!user) throw new Error("User not found");
    return {
      aiCallsToday: user.aiCallsToday,
      aiCallsResetDate: user.aiCallsResetDate,
      copilotCallsToday: user.copilotCallsToday,
      copilotResetDate: user.copilotResetDate,
      aiCallsMonth: user.aiCallsMonth,
      copilotCallsMonth: user.copilotCallsMonth,
      importsMonth: user.importsMonth,
      usageMonthKey: user.usageMonthKey,
      subscriptionTier: user.subscriptionTier,
    };
  }

  // Atomic increment (SQL `col + 1`) — never a read-then-write, so concurrent bursts can't
  // lose updates. The reset-if-new-day helper runs first in the middleware, so the reset
  // date is already today by the time we get here. Returns the new count.
  async incrementAiCalls(userId: number): Promise<{ newCount: number }> {
    const rows = await db.update(users)
      .set({
        aiCallsToday: sql`${users.aiCallsToday} + 1`,
        aiCallsMonth: sql`${users.aiCallsMonth} + 1`,
      })
      .where(eq(users.id, userId))
      .returning();
    if (!rows[0]) throw new Error("User not found");
    return { newCount: rows[0].aiCallsToday };
  }

  async incrementCopilotCalls(userId: number): Promise<{ newCount: number }> {
    const rows = await db.update(users)
      .set({
        copilotCallsToday: sql`${users.copilotCallsToday} + 1`,
        copilotCallsMonth: sql`${users.copilotCallsMonth} + 1`,
      })
      .where(eq(users.id, userId))
      .returning();
    if (!rows[0]) throw new Error("User not found");
    return { newCount: rows[0].copilotCallsToday };
  }

  async incrementImportCalls(userId: number): Promise<{ newCount: number }> {
    const rows = await db.update(users)
      .set({ importsMonth: sql`${users.importsMonth} + 1` })
      .where(eq(users.id, userId))
      .returning();
    if (!rows[0]) throw new Error("User not found");
    return { newCount: rows[0].importsMonth };
  }

  async resetAiCallsIfNewDay(userId: number): Promise<void> {
    const user = await this.getUser(userId);
    if (!user) return;
    const todayStr = new Date().toISOString().split('T')[0];
    if (user.aiCallsResetDate !== todayStr) {
      await db.update(users).set({ aiCallsToday: 0, aiCallsResetDate: todayStr }).where(eq(users.id, userId));
    }
  }

  async resetCopilotCallsIfNewDay(userId: number): Promise<void> {
    const user = await this.getUser(userId);
    if (!user) return;
    const todayStr = new Date().toISOString().split('T')[0];
    if (user.copilotResetDate !== todayStr) {
      await db.update(users).set({ copilotCallsToday: 0, copilotResetDate: todayStr }).where(eq(users.id, userId));
    }
  }

  // All three monthly counters share one "YYYY-MM" key and reset together on the
  // calendar-month boundary — same lazy pattern as the daily helpers above.
  async resetMonthlyCountersIfNewMonth(userId: number): Promise<void> {
    const user = await this.getUser(userId);
    if (!user) return;
    const monthKey = new Date().toISOString().slice(0, 7);
    if (user.usageMonthKey !== monthKey) {
      await db.update(users)
        .set({ aiCallsMonth: 0, copilotCallsMonth: 0, importsMonth: 0, usageMonthKey: monthKey })
        .where(eq(users.id, userId));
    }
  }

  // ── Global AI usage (daily spend circuit breaker) ──────────────────────────
  // Single-row table (id = 1). Same date-string reset semantics as the per-user
  // helpers, but folded into one atomic upsert per operation so the new-day reset
  // and the read/increment can't interleave under concurrency.

  async getGlobalAiCallsToday(): Promise<number> {
    const todayStr = new Date().toISOString().split('T')[0];
    const { rows } = await pool.query(
      `INSERT INTO global_ai_usage (id, calls_today, reset_date) VALUES (1, 0, $1)
       ON CONFLICT (id) DO UPDATE SET
         calls_today = CASE WHEN global_ai_usage.reset_date IS DISTINCT FROM $1 THEN 0 ELSE global_ai_usage.calls_today END,
         reset_date = $1
       RETURNING calls_today`,
      [todayStr]
    );
    return rows[0].calls_today;
  }

  async incrementGlobalAiCalls(units: number): Promise<void> {
    const todayStr = new Date().toISOString().split('T')[0];
    await pool.query(
      `INSERT INTO global_ai_usage (id, calls_today, reset_date) VALUES (1, $2, $1)
       ON CONFLICT (id) DO UPDATE SET
         calls_today = CASE WHEN global_ai_usage.reset_date IS DISTINCT FROM $1 THEN $2 ELSE global_ai_usage.calls_today + $2 END,
         reset_date = $1`,
      [todayStr, units]
    );
  }

  // ── Product analytics ──────────────────────────────────────────────────────
  // Fire-and-forget: analytics failures must never affect the request path, so
  // this swallows (and logs) its own errors and never throws.
  async logEvent(userId: number | null, event: string, properties?: Record<string, unknown>): Promise<void> {
    try {
      await db.insert(events).values({ userId, event, properties: properties ?? null });
    } catch (err) {
      console.error("[analytics] logEvent failed:", (err as any)?.message);
    }
  }

  // Basic funnel query for the admin/dev summary: event counts over the last N days.
  async getEventCounts(days: number): Promise<Array<{ event: string; count: number }>> {
    const { rows } = await pool.query(
      `SELECT event, COUNT(*)::int AS count
       FROM events
       WHERE created_at > NOW() - ($1 || ' days')::interval
       GROUP BY event ORDER BY count DESC`,
      [String(days)]
    );
    return rows;
  }

  // Atomically claims today's soft/hard alert: true for exactly one caller per day,
  // so warnings and Sentry captures fire once instead of per request.
  async claimGlobalAiAlert(kind: "soft" | "hard"): Promise<boolean> {
    const col = kind === "hard" ? "hard_alerted_date" : "soft_alerted_date";
    const todayStr = new Date().toISOString().split('T')[0];
    const result = await pool.query(
      `UPDATE global_ai_usage SET ${col} = $1 WHERE id = 1 AND ${col} IS DISTINCT FROM $1`,
      [todayStr]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async updateUserSubscriptionTier(userId: number, tier: string): Promise<void> {
    await db.update(users).set({ subscriptionTier: tier }).where(eq(users.id, userId));
  }

  async setStripeCustomer(userId: number, customerId: string): Promise<void> {
    await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));
  }

  async setStripeSubscription(userId: number, subscriptionId: string | null): Promise<void> {
    await db.update(users).set({ stripeSubscriptionId: subscriptionId }).where(eq(users.id, userId));
  }

  async getUserByStripeCustomerId(customerId: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.stripeCustomerId, customerId));
    return rows[0];
  }

  async deleteUserData(userId: number, householdId: number): Promise<void> {
    // Run the whole deletion inside a transaction so any failure rolls the
    // entire operation back. Previously this ran as independent statements and
    // could leave the account half-deleted (user row gone, household + recipes
    // orphaned) when a foreign-key constraint fired on shopping_list_items or
    // snack_wishlist (both FK to households.id and were never deleted).
    await db.transaction(async (tx) => {
      const members = await tx.select().from(users).where(eq(users.householdId, householdId));
      const isSoleMember = members.length === 1;

      if (isSoleMember) {
        // Household is being torn down — remove household-scoped rows that FK to
        // households.id (and may FK to users.id) before the user/household rows.
        await tx.delete(shoppingListItems).where(eq(shoppingListItems.householdId, householdId));
        await tx.delete(snackWishlist).where(eq(snackWishlist.householdId, householdId));
        await tx.delete(pantryStaples).where(eq(pantryStaples.householdId, householdId));
        await tx.delete(weeklyPlans).where(eq(weeklyPlans.householdId, householdId));
        await tx.delete(recipes).where(eq(recipes.householdId, householdId));
        await tx.delete(householdTasteProfile).where(eq(householdTasteProfile.householdId, householdId));
      } else {
        // Household survives — preserve shared rows but null out references to the
        // departing user so the users-row delete can proceed.
        await tx.update(shoppingListItems).set({ addedBy: null }).where(eq(shoppingListItems.addedBy, userId));
        await tx.update(shoppingListItems).set({ checkedBy: null }).where(eq(shoppingListItems.checkedBy, userId));
        await tx.update(snackWishlist).set({ addedBy: null }).where(eq(snackWishlist.addedBy, userId));
      }

      // User-scoped data (all FK to users.id).
      await tx.delete(events).where(eq(events.userId, userId));
      await tx.delete(activityLog).where(eq(activityLog.userId, userId));
      await tx.delete(copilotSessions).where(eq(copilotSessions.userId, userId));
      await tx.delete(mealReactions).where(eq(mealReactions.userId, userId));
      await tx.delete(onboardingSwipes).where(eq(onboardingSwipes.userId, userId));
      await tx.delete(userOnboarding).where(eq(userOnboarding.userId, userId));
      await tx.delete(userPreferences).where(eq(userPreferences.userId, userId));
      await tx.delete(userTasteProfile).where(eq(userTasteProfile.userId, userId));

      // The user row itself.
      await tx.delete(users).where(eq(users.id, userId));

      // Finally the household, now that nothing references it.
      if (isSoleMember) {
        await tx.delete(households).where(eq(households.id, householdId));
      }
    });
  }

  // Preferences & Onboarding
  async getUserPreferences(userId: number) {
    const rows = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
    return rows[0] || null;
  }

  async upsertUserPreferences(userId: number, prefs: Partial<UserPreference>): Promise<void> {
    const existing = await this.getUserPreferences(userId);
    if (existing) {
      await db.update(userPreferences).set({ ...prefs, updatedAt: new Date() }).where(eq(userPreferences.userId, userId));
    } else {
      await db.insert(userPreferences).values({ userId, ...prefs } as any);
    }
  }

  async getOnboardingState(userId: number) {
    const rows = await db.select().from(userOnboarding).where(eq(userOnboarding.userId, userId));
    return rows[0] || null;
  }

  async createOnboardingState(userId: number) {
    const rows = await db.insert(userOnboarding).values({ userId }).returning();
    return rows[0];
  }

  async updateOnboardingStep(userId: number, step: number): Promise<void> {
    await db.update(userOnboarding).set({ currentStep: step }).where(eq(userOnboarding.userId, userId));
  }

  async setOnboardingMode(userId: number, cookingMode: 'cook' | 'eater'): Promise<void> {
    await db.update(userOnboarding).set({ cookingMode, currentStep: 2 }).where(eq(userOnboarding.userId, userId));
  }

  async completeOnboarding(userId: number): Promise<void> {
    const existing = await this.getOnboardingState(userId);
    if (!existing) {
      await db.insert(userOnboarding).values({ userId, completed: true, completedAt: new Date() });
    } else {
      await db.update(userOnboarding).set({ completed: true, completedAt: new Date() }).where(eq(userOnboarding.userId, userId));
    }
  }

  async saveOnboardingSwipe(userId: number, swipe: any): Promise<void> {
    await db.insert(onboardingSwipes).values({ userId, ...swipe });
  }

  async getOnboardingSwipes(userId: number) {
    return await db.select().from(onboardingSwipes).where(eq(onboardingSwipes.userId, userId)).orderBy(onboardingSwipes.createdAt);
  }

  async getOnboardingSwipeCount(userId: number): Promise<number> {
    const rows = await this.getOnboardingSwipes(userId);
    return rows.length;
  }

  // Taste Profiles
  async getUserTasteProfile(userId: number) {
    const rows = await db.select().from(userTasteProfile).where(eq(userTasteProfile.userId, userId));
    return rows[0] || null;
  }

  async upsertUserTasteProfile(userId: number, profile: Partial<DbUserTasteProfile>): Promise<void> {
    const existing = await this.getUserTasteProfile(userId);
    if (existing) {
      await db.update(userTasteProfile).set({ ...profile, lastUpdated: new Date() }).where(eq(userTasteProfile.userId, userId));
    } else {
      await db.insert(userTasteProfile).values({ userId, ...profile } as any);
    }
  }

  async getHouseholdTasteProfile(householdId: number) {
    const rows = await db.select().from(householdTasteProfile).where(eq(householdTasteProfile.householdId, householdId));
    return rows[0] || null;
  }

  async upsertHouseholdTasteProfile(householdId: number, profile: Partial<any>): Promise<void> {
    const existing = await this.getHouseholdTasteProfile(householdId);
    if (existing) {
      await db.update(householdTasteProfile).set({ ...profile, updatedAt: new Date() }).where(eq(householdTasteProfile.householdId, householdId));
    } else {
      await db.insert(householdTasteProfile).values({ householdId, ...profile } as any);
    }
  }

  async getAllHouseholdMemberProfiles(householdId: number) {
    const members = await this.getHouseholdMembers(householdId);
    if (members.length === 0) return [];
    const memberIds = members.map(m => m.id);
    return await db.select().from(userTasteProfile).where(inArray(userTasteProfile.userId, memberIds));
  }

  async incrementCuisineSignal(userId: number, cuisineType: string): Promise<void> {
    let profile = await this.getUserTasteProfile(userId);
    if (!profile) {
      await this.upsertUserTasteProfile(userId, { cookingMode: 'eater', cuisineSignals: {}, likedCuisines: [] });
      profile = await this.getUserTasteProfile(userId);
      if (!profile) return;
    }
    const signals = (profile.cuisineSignals as Record<string, number>) || {};
    signals[cuisineType] = (signals[cuisineType] || 0) + 1;

    let liked = [...(profile.likedCuisines || [])];
    if (signals[cuisineType] >= 2 && !liked.includes(cuisineType)) {
      liked.push(cuisineType);
    }

    await db.update(userTasteProfile).set({ cuisineSignals: signals, likedCuisines: liked }).where(eq(userTasteProfile.userId, userId));
  }

  async getRecentMealNames(householdId: number, limit: number = 14): Promise<string[]> {
    // Scoped to the household so we never read another household's recipe names
    const plans = await db.select().from(weeklyPlans)
      .where(eq(weeklyPlans.householdId, householdId))
      .orderBy(desc(weeklyPlans.id)).limit(4);
    const nameSet = new Set<string>();
    const recipeIdSet = new Set<number>();
    for (const plan of plans) {
      try {
        const meals = JSON.parse(plan.meals) as Record<string, number | string>;
        for (const val of Object.values(meals)) {
          if (!val) continue;
          if (typeof val === 'string') nameSet.add(val);
          else if (typeof val === 'number') recipeIdSet.add(val);
        }
      } catch { /* skip malformed */ }
    }
    if (recipeIdSet.size > 0) {
      const recipes = await this.getRecipesByIds([...recipeIdSet], householdId);
      for (const r of recipes) nameSet.add(r.name);
    }
    return [...nameSet].slice(0, limit);
  }

  // Copilot History
  async getCopilotHistory(userId: number, sessionId: string, limit: number = 20) {
    return await db.select().from(copilotSessions)
                   .where(and(eq(copilotSessions.userId, userId), eq(copilotSessions.sessionId, sessionId)))
                   .orderBy(desc(copilotSessions.timestamp))
                   .limit(limit);
  }

  async saveCopilotMessage(userId: number, sessionId: string, message: any): Promise<number> {
    const rows = await db.insert(copilotSessions).values({
      userId,
      sessionId,
      role: message.role,
      content: message.content,
      proposedAction: message.proposedAction || null
    }).returning({ id: copilotSessions.id });
    return rows[0].id;
  }

  async updateProposedActionStatus(userId: number, sessionId: string, messageId: number, status: 'applied' | 'dismissed'): Promise<void> {
    // SEC-011: scope by userId + sessionId so users can't mutate other sessions
    const rows = await db.select().from(copilotSessions).where(
      and(
        eq(copilotSessions.id, messageId),
        eq(copilotSessions.userId, userId),
        eq(copilotSessions.sessionId, sessionId),
      )
    );
    const msg = rows[0];
    if (msg && msg.proposedAction) {
      const action = msg.proposedAction as any;
      action.status = status;
      await db.update(copilotSessions).set({ proposedAction: action }).where(eq(copilotSessions.id, messageId));
    }
  }

  // Recipes & Plans
  async getRecipes(householdId: number): Promise<Recipe[]> {
    return await db.select().from(recipes).where(eq(recipes.householdId, householdId));
  }

  async getRecipe(id: number, householdId?: number): Promise<Recipe | undefined> {
    const condition = householdId !== undefined
      ? and(eq(recipes.id, id), eq(recipes.householdId, householdId))
      : eq(recipes.id, id);
    const rows = await db.select().from(recipes).where(condition);
    return rows[0];
  }

  async getRecipesByIds(ids: number[], householdId: number): Promise<Recipe[]> {
    if (ids.length === 0) return [];
    return db.select().from(recipes).where(
      and(inArray(recipes.id, ids), eq(recipes.householdId, householdId))
    );
  }

  async createRecipe(recipe: InsertRecipe): Promise<Recipe> {
    const rows = await db.insert(recipes).values({ ...recipe, isProcessed: recipe.isProcessed ?? false }).returning();
    return rows[0];
  }

  async updateRecipe(id: number, householdId: number, recipe: Partial<InsertRecipe>): Promise<Recipe | undefined> {
    const rows = await db.update(recipes).set(recipe)
      .where(and(eq(recipes.id, id), eq(recipes.householdId, householdId)))
      .returning();
    return rows[0];
  }

  async updateRecipeNutrition(id: number, nutritionJson: string): Promise<void> {
    await db.update(recipes).set({ nutritionData: nutritionJson } as any).where(eq(recipes.id, id));
  }

  async deleteRecipe(id: number, householdId: number): Promise<void> {
    await db.delete(recipes).where(and(eq(recipes.id, id), eq(recipes.householdId, householdId)));
  }

  async toggleFavorite(id: number, householdId: number): Promise<Recipe | undefined> {
    const existing = await this.getRecipe(id, householdId);
    if (!existing) return undefined;
    const rows = await db.update(recipes).set({ isFavorite: existing.isFavorite ? 0 : 1 })
      .where(and(eq(recipes.id, id), eq(recipes.householdId, householdId)))
      .returning();
    return rows[0];
  }

  async getWeeklyPlans(householdId: number): Promise<WeeklyPlan[]> {
    return await db.select().from(weeklyPlans).where(eq(weeklyPlans.householdId, householdId));
  }

  async getWeeklyPlan(weekStart: string, householdId: number): Promise<WeeklyPlan | undefined> {
    const rows = await db.select().from(weeklyPlans)
      .where(and(eq(weeklyPlans.weekStart, weekStart), eq(weeklyPlans.householdId, householdId)));
    return rows[0];
  }

  async upsertWeeklyPlan(plan: InsertWeeklyPlan): Promise<WeeklyPlan> {
    const existing = await this.getWeeklyPlan(plan.weekStart, plan.householdId);
    if (existing) {
      const updateSet: Record<string, any> = { meals: plan.meals };
      if ((plan as any).mealMeta !== undefined) updateSet.mealMeta = (plan as any).mealMeta;
      const rows = await db.update(weeklyPlans).set(updateSet).where(eq(weeklyPlans.id, existing.id)).returning();
      return rows[0];
    }
    const rows = await db.insert(weeklyPlans).values(plan).returning();
    return rows[0];
  }

  async deleteWeeklyPlan(id: number, householdId: number): Promise<void> {
    await db.delete(weeklyPlans).where(and(eq(weeklyPlans.id, id), eq(weeklyPlans.householdId, householdId)));
  }

  async getPantryStaples(householdId: number): Promise<PantryStaple[]> {
    return await db.select().from(pantryStaples).where(eq(pantryStaples.householdId, householdId));
  }

  async createPantryStaple(staple: InsertPantryStaple): Promise<PantryStaple> {
    const rows = await db.insert(pantryStaples).values(staple).returning();
    return rows[0];
  }

  async deletePantryStaple(id: number, householdId: number): Promise<void> {
    await db.delete(pantryStaples).where(and(eq(pantryStaples.id, id), eq(pantryStaples.householdId, householdId)));
  }

  async seedDefaultData(): Promise<void> {
    const existingRecipes = await this.getRecipes(1);
    if (existingRecipes.length > 0) return;

    const staples = [
      { householdId: 1, name: "Salt", category: "spices" },
      { householdId: 1, name: "Black pepper", category: "spices" },
      { householdId: 1, name: "Garlic powder", category: "spices" },
      { householdId: 1, name: "Olive oil", category: "oils" },
      { householdId: 1, name: "Soy sauce", category: "condiments" },
      { householdId: 1, name: "Rice", category: "grains" }
    ];
    for (const s of staples) {
      await db.insert(pantryStaples).values(s);
    }
  }

  async logActivity(userId: number, action: string, recipeId?: number | null, recipeName?: string | null): Promise<void> {
    await db.insert(activityLog).values({ userId, action, recipeId: recipeId ?? null, recipeName: recipeName ?? null });
  }

  async getRecentActivity(householdId: number, limit = 40): Promise<(ActivityLogEntry & { username: string; avatar: string | null })[]> {
    // Get user IDs for this household, then filter activity log
    const members = await this.getHouseholdMembers(householdId);
    const memberIds = members.map(m => m.id);
    if (memberIds.length === 0) return [];
    const rows = await db.select().from(activityLog)
      .where(memberIds.length === 1
        ? eq(activityLog.userId, memberIds[0])
        : inArray(activityLog.userId, memberIds))
      .orderBy(desc(activityLog.createdAt))
      .limit(limit);
    const userMap = new Map<number, { username: string; avatar: string | null }>(
      members.map(m => [m.id, { username: m.username, avatar: (m as any).avatar ?? null }])
    );
    return rows.map(r => ({
      ...r,
      username: userMap.get(r.userId)?.username ?? "Someone",
      avatar: userMap.get(r.userId)?.avatar ?? null,
    }));
  }

  async upsertReaction(weekStart: string, slotKey: string, userId: number, emoji: string): Promise<void> {
    await db.insert(mealReactions)
      .values({ weekStart, slotKey, userId, emoji })
      .onConflictDoUpdate({
        target: [mealReactions.weekStart, mealReactions.slotKey, mealReactions.userId],
        set: { emoji },
      });
  }

  async deleteReaction(weekStart: string, slotKey: string, userId: number): Promise<void> {
    await db.delete(mealReactions).where(
      and(
        eq(mealReactions.weekStart, weekStart),
        eq(mealReactions.slotKey, slotKey),
        eq(mealReactions.userId, userId),
      )
    );
  }

  async getReactionsForWeek(weekStart: string, householdId: number): Promise<MealReaction[]> {
    // Only return reactions from members of the same household
    const householdUsers = await db.select({ id: users.id }).from(users)
      .where(eq(users.householdId, householdId));
    const userIds = householdUsers.map(u => u.id);
    if (userIds.length === 0) return [];
    return await db.select().from(mealReactions).where(
      and(eq(mealReactions.weekStart, weekStart), inArray(mealReactions.userId, userIds))
    );
  }

  // ── Snack Wishlist ─────────────────────────────────────────────────────────

  async getSnackWishlist(householdId: number): Promise<SnackWishlistItem[]> {
    return await db.select().from(snackWishlist)
      .where(eq(snackWishlist.householdId, householdId))
      .orderBy(snackWishlist.createdAt);
  }

  async addSnackWishlistItem(householdId: number, userId: number, item: { name: string; brand?: string; notes?: string; imageUrl?: string; productData?: string }): Promise<SnackWishlistItem> {
    const rows = await db.insert(snackWishlist).values({
      householdId,
      addedBy: userId,
      name: item.name,
      brand: item.brand ?? null,
      notes: item.notes ?? null,
      imageUrl: item.imageUrl ?? null,
      productData: item.productData ?? null,
    }).returning();
    return rows[0];
  }

  async deleteSnackWishlistItem(id: number, householdId: number): Promise<void> {
    await db.delete(snackWishlist).where(and(eq(snackWishlist.id, id), eq(snackWishlist.householdId, householdId)));
  }

  // ── Persistent Shopping List ───────────────────────────────────────────────

  async getShoppingList(householdId: number): Promise<ShoppingListItem[]> {
    return await db.select().from(shoppingListItems)
      .where(eq(shoppingListItems.householdId, householdId))
      .orderBy(shoppingListItems.createdAt);
  }

  async addShoppingItem(householdId: number, userId: number, item: { name: string; amount?: string; unit?: string; category?: string; source?: string; sourceId?: number; productData?: string }): Promise<ShoppingListItem> {
    const rows = await db.insert(shoppingListItems).values({
      householdId,
      addedBy: userId,
      name: item.name,
      amount: item.amount ?? null,
      unit: item.unit ?? null,
      category: item.category ?? "other",
      source: item.source ?? "manual",
      sourceId: item.sourceId ?? null,
      productData: item.productData ?? null,
    }).returning();
    return rows[0];
  }

  async bulkAddShoppingItems(householdId: number, userId: number, items: { name: string; amount?: string; unit?: string; category?: string; source?: string; sourceId?: number }[]): Promise<ShoppingListItem[]> {
    if (items.length === 0) return [];
    const rows = await db.insert(shoppingListItems).values(
      items.map(item => ({
        householdId,
        addedBy: userId,
        name: item.name,
        amount: item.amount ?? null,
        unit: item.unit ?? null,
        category: item.category ?? "other",
        source: item.source ?? "manual",
        sourceId: item.sourceId ?? null,
      }))
    ).returning();
    return rows;
  }

  async toggleShoppingItem(id: number, householdId: number, userId: number, checked: boolean): Promise<ShoppingListItem | undefined> {
    const rows = await db.update(shoppingListItems)
      .set({ checked, checkedBy: checked ? userId : null, checkedAt: checked ? new Date() : null })
      .where(and(eq(shoppingListItems.id, id), eq(shoppingListItems.householdId, householdId)))
      .returning();
    return rows[0];
  }

  async deleteShoppingItem(id: number, householdId: number): Promise<void> {
    await db.delete(shoppingListItems).where(and(eq(shoppingListItems.id, id), eq(shoppingListItems.householdId, householdId)));
  }

  async clearCheckedShoppingItems(householdId: number): Promise<void> {
    await db.delete(shoppingListItems).where(and(eq(shoppingListItems.householdId, householdId), eq(shoppingListItems.checked, true)));
  }

  async clearAllShoppingItems(householdId: number): Promise<void> {
    await db.delete(shoppingListItems).where(eq(shoppingListItems.householdId, householdId));
  }

  async clearRecipeShoppingItems(householdId: number): Promise<void> {
    await db.delete(shoppingListItems).where(
      and(eq(shoppingListItems.householdId, householdId), eq(shoppingListItems.source, "recipe"))
    );
  }

  async syncRecipeShoppingItems(householdId: number, userId: number, items: { name: string; amount?: string; unit?: string; category?: string; sourceId?: number }[]): Promise<ShoppingListItem[]> {
    // Atomic swap: delete the household's existing recipe-sourced items and insert the
    // new set in a single transaction, so a mid-operation failure can never leave the
    // list emptied. Manual/wishlist items (source != 'recipe') are never touched.
    // Mirrors the transactional deleteUserData pattern.
    return await db.transaction(async (tx) => {
      await tx.delete(shoppingListItems).where(
        and(eq(shoppingListItems.householdId, householdId), eq(shoppingListItems.source, "recipe"))
      );
      if (items.length === 0) return [];
      const rows = await tx.insert(shoppingListItems).values(
        items.map(item => ({
          householdId,
          addedBy: userId,
          name: item.name,
          amount: item.amount ?? null,
          unit: item.unit ?? null,
          category: item.category ?? "other",
          source: "recipe",
          sourceId: item.sourceId ?? null,
        }))
      ).returning();
      return rows;
    });
  }

  async updateShoppingItemProduct(id: number, householdId: number, productData: string, imageUrl?: string): Promise<void> {
    await db.update(shoppingListItems)
      .set({ productData, ...(imageUrl ? {} : {}) } as any)
      .where(and(eq(shoppingListItems.id, id), eq(shoppingListItems.householdId, householdId)));
  }
}

export const storage = new DatabaseStorage();
