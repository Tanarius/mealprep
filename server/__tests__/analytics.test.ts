/**
 * Product analytics storage — logEvent is fire-and-forget and must NEVER throw:
 * an analytics failure must never break the request path that logged it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const values = vi.fn(async () => [{}]);
  const insert = vi.fn(() => ({ values }));
  return { values, insert, mockDb: { insert } };
});

vi.mock("pg", () => ({ Pool: class MockPool { query = vi.fn(async () => ({ rows: [], rowCount: 0 })); } }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => h.mockDb }));

import { storage } from "../storage";

beforeEach(() => vi.clearAllMocks());

describe("storage.logEvent", () => {
  it("inserts the event with userId and properties", async () => {
    await storage.logEvent(7, "week_planned", { weekStart: "2026-08-03" });
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(h.values).toHaveBeenCalledWith({ userId: 7, event: "week_planned", properties: { weekStart: "2026-08-03" } });
  });

  it("defaults properties to null", async () => {
    await storage.logEvent(7, "onboarding_completed");
    expect(h.values).toHaveBeenCalledWith({ userId: 7, event: "onboarding_completed", properties: null });
  });

  it("NEVER throws — a failed insert is swallowed and logged", async () => {
    h.values.mockRejectedValueOnce(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(storage.logEvent(7, "registered")).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
