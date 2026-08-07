/**
 * Global AI usage storage — the counter behind the daily spend circuit breaker.
 *
 * Mirrors ai-quota-atomicity.test.ts: the increment and the read must each be a SINGLE
 * SQL statement that folds the new-day reset into the write (date-compare CASE inside
 * the upsert), never a read-then-write — so concurrent bursts can't lose updates and
 * the reset can't interleave with an increment. The pg Pool is mocked with a query spy
 * so we can assert the statement shape and parameters.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const query = vi.fn(async () => ({ rows: [{ calls_today: 0 }], rowCount: 1 }));
  return { query, MockPool: class { query = query; } };
});

vi.mock("pg", () => ({ Pool: h.MockPool }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));

import { storage } from "../storage";

const TODAY = new Date().toISOString().split("T")[0];

beforeEach(() => {
  vi.clearAllMocks();
  h.query.mockResolvedValue({ rows: [{ calls_today: 42 }], rowCount: 1 });
});

describe("global AI usage storage", () => {
  it("getGlobalAiCallsToday is one atomic upsert that zeroes on a new day and returns the count", async () => {
    const count = await storage.getGlobalAiCallsToday();
    expect(h.query).toHaveBeenCalledTimes(1);
    const [sql, params] = h.query.mock.calls[0];
    expect(sql).toContain("ON CONFLICT (id) DO UPDATE");
    expect(sql).toContain("IS DISTINCT FROM");
    expect(sql).toContain("THEN 0");
    expect(sql).toContain("RETURNING calls_today");
    expect(params).toEqual([TODAY]);
    expect(count).toBe(42);
  });

  it("incrementGlobalAiCalls is one atomic upsert using SQL-side addition with the unit weight", async () => {
    await storage.incrementGlobalAiCalls(5);
    expect(h.query).toHaveBeenCalledTimes(1);
    const [sql, params] = h.query.mock.calls[0];
    expect(sql).toContain("ON CONFLICT (id) DO UPDATE");
    // SQL-side `calls_today + $2` — the added amount is a parameter, not a client-computed total
    expect(sql).toContain("calls_today + $2");
    expect(sql).toContain("IS DISTINCT FROM");
    expect(params).toEqual([TODAY, 5]);
  });

  it("claimGlobalAiAlert claims atomically and reports whether this caller won", async () => {
    h.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    expect(await storage.claimGlobalAiAlert("soft")).toBe(true);
    let [sql, params] = h.query.mock.calls[0];
    expect(sql).toContain("soft_alerted_date IS DISTINCT FROM $1");
    expect(params).toEqual([TODAY]);

    h.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await storage.claimGlobalAiAlert("hard")).toBe(false);
    [sql] = h.query.mock.calls[1];
    expect(sql).toContain("hard_alerted_date IS DISTINCT FROM $1");
  });
});
