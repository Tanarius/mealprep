import "dotenv/config";
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  enabled: !!process.env.SENTRY_DSN,
  tracesSampleRate: 0.2,
});

import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

// Fail fast in production if critical secrets are missing
if (process.env.NODE_ENV === "production") {
  const required = [
    "SESSION_SECRET",
    "DATABASE_URL",
    "CLIENT_URL",
  ];
  const billing = [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_MONTHLY",
    "STRIPE_PRICE_ANNUAL",
  ];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`FATAL: ${key} env var is required in production`);
      process.exit(1);
    }
  }
  for (const key of billing) {
    if (!process.env[key]) {
      console.warn(`WARN: ${key} is not set — Stripe billing will not work`);
    }
  }
  // Soft warn-list, like billing: missing values never block boot — the global AI
  // circuit breaker falls back to its built-in defaults (see middleware/aiRateLimit.ts).
  for (const key of ["AI_DAILY_SOFT_LIMIT", "AI_DAILY_HARD_LIMIT"]) {
    if (!process.env[key]) {
      console.warn(`WARN: ${key} is not set — using the built-in default for the global AI breaker`);
    }
  }
}

const app = express();
const httpServer = createServer(app);

// Railway (and most PaaS) terminate SSL at their proxy and forward HTTP internally.
// Without this, req.secure is always false and express-session won't set Secure cookies.
app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Security headers (helmet)
app.use(
  helmet({
    contentSecurityPolicy: process.env.NODE_ENV === "production" ? {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        // Explicit connect-src so client-side XHR/fetch/beacon aren't left to the
        // default-src 'self' fallback. Sentry's browser SDK (error/tracing/replay) POSTs
        // events to its ingest host; without this they're blocked in production.
        connectSrc: [
          "'self'",
          "https://*.ingest.sentry.io",
          "https://*.ingest.us.sentry.io",
          "https://*.ingest.de.sentry.io",
        ],
        fontSrc: ["'self'", "https:", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        imgSrc: [
          "'self'", "data:", "blob:", "https:",
          "https://spoonacular.com",
          "https://img.spoonacular.com",
          "https://spoonacular.com/recipeImages",
          "https://images.unsplash.com",
          "https://cdn.pixabay.com",
          "https://img.freepik.com",
          "https://www.themealdb.com",
          "https://edamam-product-images.s3.amazonaws.com",
        ],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "https:", "'unsafe-inline'"],
        upgradeInsecureRequests: [],
      },
    } : false,
    crossOriginEmbedderPolicy: false,
  })
);

// Larger body limit only for screenshot import (images are bigger than normal JSON).
// The client downscales first, so this is a backstop, not the common path.
app.use("/api/ai/import-from-social", express.json({ limit: "8mb", verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));

// Body parsing with size limits (prevents large-payload DoS)
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// Global API rate limit — 300 req/min per IP
app.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please slow down." },
  })
);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

// Request logger — never logs response bodies (prevents leaking tokens/invite codes/profiles)
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  res.on("finish", () => {
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${Date.now() - start}ms`);
    }
  });
  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  // Sentry error handler must come before the generic error handler
  if (process.env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(app);
  }

  // Global error handler — never leak stack traces to clients
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = status < 500 || status === 503 || status === 429
      ? (err.message || "Bad request")
      : "Internal server error";
    if (status >= 500) console.error("Server error:", err);
    if (!res.headersSent) res.status(status).json({ error: message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({ port, host: "0.0.0.0" }, () => {
    log(`serving on port ${port}`);
  });
})();
