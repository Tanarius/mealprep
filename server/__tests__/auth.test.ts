/**
 * Auth security tests — prove that passwords are NEVER stored or compared as plaintext.
 *
 * These run with no database. Storage is fully mocked. Sessions use an in-memory store.
 * Supertest drives real HTTP requests through the Express/Passport stack so the tests
 * exercise the exact same code paths that run in production.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcrypt";

// ── Module mocks (hoisted by vitest before any imports) ──────────────────────

// Replace PgSession with express-session's MemoryStore so tests need no DB.
// connect-pg-simple exports a factory: (session) => StoreClass
vi.mock("connect-pg-simple", () => ({
  default: (sessionModule: any) => sessionModule.MemoryStore,
}));

// Prevent the Pool constructor from trying to open a real PG connection.
vi.mock("pg", () => ({
  Pool: class MockPool { connect() {} end() {} },
}));

// Mock all storage methods — tests inject whatever return values they need.
vi.mock("../storage", () => ({
  storage: {
    getUserByUsername: vi.fn(),
    getUser: vi.fn(),
    createUser: vi.fn(),
    updateUserPassword: vi.fn(),
    setUserHousehold: vi.fn(),
    setUserEmail: vi.fn(),
    getHouseholdByInviteCode: vi.fn(),
    createHousehold: vi.fn(),
    getUserByEmail: vi.fn(),
    setResetToken: vi.fn(),
    getUserByResetToken: vi.fn(),
    clearResetToken: vi.fn(),
    getHouseholdMembers: vi.fn(async () => []),
    logEvent: vi.fn(async () => {}),
  },
}));

vi.mock("../services/email", () => ({
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock("../utils/invite", () => ({
  generateInviteCode: vi.fn().mockReturnValue("TESTCODE"),
}));

// ── Test helpers ─────────────────────────────────────────────────────────────

process.env.SESSION_SECRET = "test-secret-not-used-in-production";

// Import after mocks are registered
import { storage } from "../storage";
import { setupAuth } from "../auth";

type MockedStorage = {
  [K in keyof typeof storage]: ReturnType<typeof vi.fn>;
};

const s = storage as unknown as MockedStorage;

function createApp() {
  const app = express();
  app.use(express.json());
  setupAuth(app);
  return app;
}

// A pre-hashed bcrypt password for reuse across tests (cost 4 = fast in CI)
const PLAINTEXT = "hunter22"; // 8 chars — meets the registration minimum
const HASHED = await bcrypt.hash(PLAINTEXT, 4);

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Registration ────────────────────────────────────────────────────────────

describe("POST /api/register — password storage", () => {
  it("calls createUser with a bcrypt hash, never the plaintext password", async () => {
    const newUser = { id: 1, username: "alice", householdId: 1 };
    s.getUserByUsername.mockResolvedValue(null);
    s.createHousehold.mockResolvedValue({ id: 1 });
    s.createUser.mockResolvedValue(newUser);
    s.setUserHousehold.mockResolvedValue(undefined);
    s.setUserEmail.mockResolvedValue(undefined);
    s.getUser.mockResolvedValue(newUser);

    await request(createApp())
      .post("/api/register")
      .send({ username: "alice", password: PLAINTEXT, email: "alice@example.com" });

    expect(s.createUser).toHaveBeenCalledOnce();

    const [{ password: stored }] = s.createUser.mock.calls[0] as [{ password: string }][];

    // Must NOT be plaintext
    expect(stored).not.toBe(PLAINTEXT);
    // Must be a bcrypt hash
    expect(stored).toMatch(/^\$2[ab]\$/);
    // Must verify correctly
    expect(await bcrypt.compare(PLAINTEXT, stored)).toBe(true);
  });

  it("rejects passwords shorter than 8 characters before touching storage", async () => {
    const res = await request(createApp())
      .post("/api/register")
      .send({ username: "alice", password: "short", email: "alice@example.com" });

    expect(res.status).toBe(400);
    expect(s.createUser).not.toHaveBeenCalled();
  });
});

// ─── Login — already-hashed account ─────────────────────────────────────────

describe("POST /api/login — bcrypt account", () => {
  it("authenticates a valid bcrypt password and never touches updateUserPassword", async () => {
    s.getUserByUsername.mockResolvedValue({ id: 1, username: "alice", password: HASHED, householdId: 1 });
    s.getUser.mockResolvedValue({ id: 1, username: "alice", householdId: 1 });

    const res = await request(createApp())
      .post("/api/login")
      .send({ username: "alice", password: PLAINTEXT });

    expect(res.status).toBe(200);
    // Proof: never tried to upgrade an already-hashed password
    expect(s.updateUserPassword).not.toHaveBeenCalled();
  });

  it("rejects a wrong password and never calls updateUserPassword", async () => {
    s.getUserByUsername.mockResolvedValue({ id: 1, username: "alice", password: HASHED, householdId: 1 });

    const res = await request(createApp())
      .post("/api/login")
      .send({ username: "alice", password: "wrongpassword" });

    expect(res.status).toBe(401);
    expect(s.updateUserPassword).not.toHaveBeenCalled();
  });
});

// ─── Login — legacy plaintext upgrade ────────────────────────────────────────

describe("POST /api/login — legacy plaintext upgrade", () => {
  it("upgrades a plaintext password to bcrypt on first login", async () => {
    const legacyUser = { id: 2, username: "bob", password: "oldpass", householdId: 1 };
    s.getUserByUsername.mockResolvedValue(legacyUser);
    s.updateUserPassword.mockResolvedValue(undefined);
    // getUser is called by deserializeUser after the upgrade
    s.getUser.mockResolvedValue({ ...legacyUser, password: HASHED });

    await request(createApp())
      .post("/api/login")
      .send({ username: "bob", password: "oldpass" });

    // Upgrade must have been called exactly once
    expect(s.updateUserPassword).toHaveBeenCalledOnce();

    const [, savedHash] = s.updateUserPassword.mock.calls[0] as [number, string];

    // The value written to the DB must be a bcrypt hash, not the plaintext
    expect(savedHash).not.toBe("oldpass");
    expect(savedHash).toMatch(/^\$2[ab]\$/);
    expect(await bcrypt.compare("oldpass", savedHash)).toBe(true);
  });

  it("does NOT upgrade when the wrong plaintext is supplied", async () => {
    const legacyUser = { id: 2, username: "bob", password: "oldpass", householdId: 1 };
    s.getUserByUsername.mockResolvedValue(legacyUser);

    const res = await request(createApp())
      .post("/api/login")
      .send({ username: "bob", password: "notoldpass" });

    expect(res.status).toBe(401);
    // Wrong password — must not write anything to the DB
    expect(s.updateUserPassword).not.toHaveBeenCalled();
  });
});

// ─── Password change ─────────────────────────────────────────────────────────

describe("PATCH /api/auth/password — via authenticated session", () => {
  // Helper: log in as a fresh bcrypt-hashed user and return an agent with a valid session.
  async function loginAgent(app: express.Express) {
    const user = { id: 3, username: "carol", password: HASHED, householdId: 1 };
    s.getUserByUsername.mockResolvedValue(user);
    s.getUser.mockResolvedValue(user);

    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "carol", password: PLAINTEXT });
    return agent;
  }

  it("rejects a change request when the DB row still has a plaintext password", async () => {
    const app = createApp();
    const agent = await loginAgent(app);

    // Simulate: PATCH handler fetches user from DB and finds a plaintext password
    s.getUser.mockResolvedValue({ id: 3, username: "carol", password: "stillplaintext", householdId: 1 });

    const res = await agent
      .patch("/api/auth/password")
      .send({ currentPassword: "stillplaintext", newPassword: "newpassword123" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/log out and log back in/i);
    // Must not have written a new password
    expect(s.updateUserPassword).not.toHaveBeenCalled();
  });

  it("changes password correctly — compares with bcrypt and stores a new bcrypt hash", async () => {
    const app = createApp();
    const agent = await loginAgent(app);

    // PATCH handler fetches fresh user (bcrypt hash in DB)
    s.getUser.mockResolvedValue({ id: 3, username: "carol", password: HASHED, householdId: 1 });
    s.updateUserPassword.mockResolvedValue(undefined);

    const res = await agent
      .patch("/api/auth/password")
      .send({ currentPassword: PLAINTEXT, newPassword: "brand-new-password!" });

    expect(res.status).toBe(200);
    expect(s.updateUserPassword).toHaveBeenCalledOnce();

    const [, newHash] = s.updateUserPassword.mock.calls[0] as [number, string];

    // New hash must be bcrypt
    expect(newHash).toMatch(/^\$2[ab]\$/);
    expect(await bcrypt.compare("brand-new-password!", newHash)).toBe(true);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(createApp())
      .patch("/api/auth/password")
      .send({ currentPassword: PLAINTEXT, newPassword: "anything" });

    expect(res.status).toBe(401);
    expect(s.updateUserPassword).not.toHaveBeenCalled();
  });
});
