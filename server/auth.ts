import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import { User } from "@shared/schema";
import { generateInviteCode } from "./utils/invite";
import { sendPasswordResetEmail } from "./services/email";
import crypto from "crypto";

// Strict rate limits for auth endpoints
const authRateLimit = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  max: 10,
  message: { error: "Too many attempts. Please wait 15 minutes before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerRateLimit = rateLimit({
  windowMs: 60 * 60_000, // 1 hour
  max: 5,
  message: { error: "Too many registrations from this IP. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Never send the password field to the client.
// Also normalize stale daily counters: the DB only zeroes aiCallsToday/copilotCallsToday
// lazily on the next AI call (resetAiCallsIfNewDay in the rate-limit middlewares), so a
// returning user's stored counts are yesterday's until then. Displaying them as-is shows
// stale usage; report 0 whenever the stored reset date isn't today. Read-only — the real
// reset still happens on the AI path.
export function safeUser(user: any) {
  if (!user) return user;
  const { password: _pw, ...safe } = user;
  const todayStr = new Date().toISOString().split("T")[0];
  if (safe.aiCallsResetDate !== todayStr) safe.aiCallsToday = 0;
  if (safe.copilotResetDate !== todayStr) safe.copilotCallsToday = 0;
  return safe;
}

const PgSession = connectPgSimple(session);

export function setupAuth(app: Express) {
  const sessionPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });

  // Setup session
  app.use(
    session({
      secret: process.env.SESSION_SECRET!,
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      },
      store: new PgSession({
        pool: sessionPool,
        tableName: "session",
        createTableIfMissing: true,
      }),
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        if (!user) return done(null, false, { message: "Invalid username or password" });
        // One-time migration path: if DB still has a plaintext password from before
        // bcrypt was enforced, upgrade it now and let the user in. Once every
        // pre-migration account has logged in this block becomes unreachable.
        if (!user.password?.startsWith('$2b$') && !user.password?.startsWith('$2a$')) {
          if (user.password !== password) return done(null, false, { message: "Invalid username or password" });
          const hashed = await bcrypt.hash(password, 12);
          await storage.updateUserPassword(user.id, hashed);
          console.warn(`[auth] upgraded plaintext password for user ${user.id} to bcrypt`);
          // Reload user so session carries the hashed password, not the plaintext one
          const upgraded = await storage.getUser(user.id);
          return done(null, upgraded ?? user);
        }
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return done(null, false, { message: "Invalid username or password" });
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    })
  );

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  // Auth routes
  app.post("/api/register", registerRateLimit, async (req, res, next) => {
    try {
      const { username, password } = req.body;
      if (!username || typeof username !== "string" || username.length < 3 || username.length > 30) {
        return res.status(400).json({ error: "Username must be 3–30 characters" });
      }
      if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
        return res.status(400).json({ error: "Username may only contain letters, numbers, _ . -" });
      }
      if (!password || typeof password !== "string" || password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      // Validate email up front — before any DB writes — so a missing or
      // malformed email returns 400 immediately rather than stranding a
      // half-created account (user row + household exist but email is blank).
      const email = (req.body.email ?? "").trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
      if (!email || !emailRegex.test(email)) {
        return res.status(400).json({ error: "A valid email address is required" });
      }
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(400).json({ error: "Username already exists" });
      }
      const existingEmail = await storage.getUserByEmail(email);
      if (existingEmail) {
        return res.status(400).json({ error: "An account with this email already exists" });
      }

      // Resolve household: join existing via inviteCode, or create a new one
      let householdId: number;
      const rawCode = (req.body.inviteCode ?? "").trim().toUpperCase();
      if (rawCode) {
        const hh = await storage.getHouseholdByInviteCode(rawCode);
        if (!hh) return res.status(400).send("Invalid invite code");
        householdId = hh.id;
      } else {
        const code = generateInviteCode();
        const hh = await storage.createHousehold(`${req.body.username}'s Home`, code);
        householdId = hh.id;
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      const user = await storage.createUser({ username, password: hashedPassword });
      await storage.setUserHousehold(user.id, householdId);

      await storage.setUserEmail(user.id, email);
      const updatedUser = await storage.getUser(user.id);

      req.login(updatedUser!, (err) => {
        if (err) return next(err);
        res.status(201).json(safeUser(updatedUser));
      });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/login", authRateLimit, passport.authenticate("local"), (req, res) => {
    res.json(safeUser(req.user));
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  app.patch("/api/auth/password", async (req, res, next) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword || newPassword.length < 6)
        return res.status(400).json({ error: "New password must be at least 6 characters" });
      const user = await storage.getUser((req.user as any).id);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (!user.password?.startsWith('$2b$') && !user.password?.startsWith('$2a$')) {
        // Account predates bcrypt migration — user must log out and back in to upgrade first
        return res.status(400).json({ error: "Please log out and log back in before changing your password." });
      }
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) return res.status(400).json({ error: "Current password is incorrect" });
      const hashed = await bcrypt.hash(newPassword, 12);
      await storage.updateUserPassword(user.id, hashed);
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  app.get("/api/user", (req, res) => {
    if (req.isAuthenticated()) {
      res.json(safeUser(req.user));
    } else {
      res.status(401).send("Not authenticated");
    }
  });

  // ── Password reset ──────────────────────────────────────────────
  const forgotRateLimit = rateLimit({ windowMs: 15 * 60_000, max: 5,
    message: { error: "Too many requests. Try again later." } });

  app.post("/api/auth/forgot-password", forgotRateLimit, async (req, res, next) => {
    try {
      const email = (req.body.email ?? "").trim().toLowerCase();
      if (!email) return res.status(400).json({ error: "Email required" });

      // Always respond with success to avoid leaking whether email exists
      const user = await storage.getUserByEmail(email);
      if (user) {
        const token = crypto.randomBytes(32).toString("hex");
        const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 min
        await storage.setResetToken(user.id, token, expiry);
        try {
          await sendPasswordResetEmail(email, token);
        } catch (emailErr) {
          // Log server-side but do NOT re-throw — the user-facing response must
          // stay generic regardless of send outcome to prevent email enumeration.
          console.error("[forgot-password] email send failed:", emailErr);
        }
      }
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  const resetRateLimit = rateLimit({ windowMs: 15 * 60_000, max: 10,
    message: { error: "Too many requests. Try again later." } });

  app.post("/api/auth/reset-password", resetRateLimit, async (req, res, next) => {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword || newPassword.length < 8)
        return res.status(400).json({ error: "Token and a password of 8+ characters are required" });

      const user = await storage.getUserByResetToken(token);
      if (!user) return res.status(400).json({ error: "Reset link is invalid or has expired" });

      const hashed = await bcrypt.hash(newPassword, 12);
      await storage.updateUserPassword(user.id, hashed);
      await storage.clearResetToken(user.id);
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  // Update avatar (authenticated)
  app.patch("/api/auth/avatar", async (req, res, next) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { avatar } = req.body;
      const VALID_AVATAR_STYLES = new Set([
        "adventurer", "adventurerNeutral", "avataaars", "bigEars", "bigEarsNeutral",
        "bigSmile", "bottts", "croodles", "funEmoji", "icons", "identicon", "initials",
        "lorelei", "micah", "miniavs", "openPeeps", "personas", "pixelArt", "shapes", "thumbs"
      ]);
      if (!avatar || typeof avatar !== "string" || !VALID_AVATAR_STYLES.has(avatar))
        return res.status(400).json({ error: "Invalid avatar" });
      await storage.setUserAvatar((req.user as any).id, avatar);
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  // Update email (authenticated)
  app.patch("/api/auth/email", async (req, res, next) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const email = (req.body.email ?? "").trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
      if (!email || !emailRegex.test(email))
        return res.status(400).json({ error: "Valid email required" });
      await storage.setUserEmail((req.user as any).id, email);
      res.json({ success: true });
    } catch (err: any) {
      if (err.code === "23505") return res.status(400).json({ error: "Email already in use" });
      next(err);
    }
  });

  app.delete("/api/auth/account", async (req, res, next) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const user = req.user as any;
      const { password } = req.body;

      // Require password confirmation
      if (!password) return res.status(400).json({ error: "Password required to delete account" });

      const isValid = user.password?.startsWith("$2")
        ? await bcrypt.compare(password, user.password)
        : user.password === password; // legacy plaintext (migration path)

      if (!isValid) return res.status(400).json({ error: "Incorrect password" });

      // Destroy session first so the user is logged out
      await new Promise<void>((resolve, reject) =>
        req.logout((err) => (err ? reject(err) : resolve()))
      );

      // Delete all user and household data
      await storage.deleteUserData(user.id, user.householdId);

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });
}
