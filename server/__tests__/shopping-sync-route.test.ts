/**
 * Route-contract tests for POST /api/snacks/shopping/sync-recipe-items — the atomic
 * recipe-item sync that replaced the unsafe delete-then-bulk flow.
 *
 * Mounts the REAL snacks router with storage mocked (per the suite's no-real-DB rule),
 * a header-driven fake auth middleware (so we can vary household per request), and a
 * no-op rate limiter. Verifies: householdId comes from the authenticated user (never the
 * body), an empty array is allowed (clears recipe items), 80 items succeed (well past the
 * /bulk 50 cap), the 300 cap and item validation reject with 400 and no write, and that
 * one household's sync can only target its own householdId.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Header-driven auth so each request can act as a different household/user.
vi.mock("../middleware/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = {
      id: Number(req.headers["x-user"] ?? 1),
      householdId: Number(req.headers["x-household"] ?? 1),
    };
    next();
  },
  authedUser: (req: any) => req.user,
}));

// No-op rate limiter — the real bulkRateLimit would 429 across the file's requests.
vi.mock("express-rate-limit", () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../storage", () => ({
  storage: {
    syncRecipeShoppingItems: vi.fn(),
  },
}));

import snacksRouter from "../routes/snacks";
import { storage } from "../storage";

const s = storage as unknown as { syncRecipeShoppingItems: ReturnType<typeof vi.fn> };
const URL = "/api/snacks/shopping/sync-recipe-items";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/snacks", snacksRouter);
  a.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: err.message }));
  return a;
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/snacks/shopping/sync-recipe-items", () => {
  it("takes householdId/userId from the authenticated user, not the request body", async () => {
    s.syncRecipeShoppingItems.mockResolvedValue([{ id: 1 }]);
    await request(app())
      .post(URL)
      .set("x-household", "7").set("x-user", "3")
      .send({ items: [{ name: "Eggs" }], householdId: 999, userId: 999 })
      .expect(200);
    expect(s.syncRecipeShoppingItems).toHaveBeenCalledWith(7, 3, expect.any(Array));
  });

  it("allows an empty items array (an empty plan validly clears recipe items)", async () => {
    s.syncRecipeShoppingItems.mockResolvedValue([]);
    const res = await request(app())
      .post(URL)
      .set("x-household", "1").set("x-user", "1")
      .send({ items: [] })
      .expect(200);
    expect(res.body).toEqual({ count: 0, items: [] });
    expect(s.syncRecipeShoppingItems).toHaveBeenCalledWith(1, 1, []);
  });

  it("accepts 80 items — well past the /bulk 50-item cap", async () => {
    const items = Array.from({ length: 80 }, (_, i) => ({ name: `Item ${i}` }));
    s.syncRecipeShoppingItems.mockResolvedValue(items.map((x, i) => ({ id: i, ...x })));
    const res = await request(app())
      .post(URL)
      .set("x-household", "1").set("x-user", "1")
      .send({ items })
      .expect(200);
    expect(res.body.count).toBe(80);
    expect(s.syncRecipeShoppingItems.mock.calls[0][2]).toHaveLength(80);
  });

  it("rejects payloads over the 300 cap with 400 and never writes", async () => {
    const items = Array.from({ length: 301 }, (_, i) => ({ name: `Item ${i}` }));
    await request(app())
      .post(URL)
      .set("x-household", "1").set("x-user", "1")
      .send({ items })
      .expect(400);
    expect(s.syncRecipeShoppingItems).not.toHaveBeenCalled();
  });

  it("rejects a malformed item (missing name) with 400 and never writes", async () => {
    await request(app())
      .post(URL)
      .set("x-household", "1").set("x-user", "1")
      .send({ items: [{ amount: "2 cups" }] })
      .expect(400);
    expect(s.syncRecipeShoppingItems).not.toHaveBeenCalled();
  });

  it("isolation: each household's sync targets only its own householdId", async () => {
    s.syncRecipeShoppingItems.mockResolvedValue([]);
    await request(app()).post(URL).set("x-household", "1").set("x-user", "1").send({ items: [{ name: "A" }] }).expect(200);
    await request(app()).post(URL).set("x-household", "2").set("x-user", "2").send({ items: [{ name: "B" }] }).expect(200);
    expect(s.syncRecipeShoppingItems).toHaveBeenNthCalledWith(1, 1, 1, expect.any(Array));
    expect(s.syncRecipeShoppingItems).toHaveBeenNthCalledWith(2, 2, 2, expect.any(Array));
  });
});
