/**
 * Stripe billing routes.
 *
 * POST /api/billing/create-checkout  — start a Checkout session (auth required)
 * POST /api/billing/portal           — open Customer Portal (auth required, must have Stripe customer)
 * POST /api/billing/webhook          — Stripe webhook (no auth, signature-verified)
 *
 * Environment variables required:
 *   STRIPE_SECRET_KEY       — sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET   — whsec_... (from Stripe Dashboard → Webhooks)
 *   STRIPE_PRICE_MONTHLY    — price_... for $4.99/month recurring
 *   STRIPE_PRICE_ANNUAL     — optional; annual plan is not currently offered in the UI
 *   CLIENT_URL              — full origin for success/cancel redirects (e.g. https://simmer.up.railway.app)
 */

import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { storage } from "../storage";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw Object.assign(new Error("STRIPE_SECRET_KEY is not configured"), { status: 503 });
  return new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
}

// The origin we redirect back to after Checkout. Falls back to localhost for dev.
function clientOrigin(): string {
  return (process.env.CLIENT_URL || "http://localhost:5000").replace(/\/$/, "");
}

// ── Create Checkout Session ──────────────────────────────────────────────────
router.post("/create-checkout", requireAuth, async (req: Request, res: Response) => {
  try {
    const stripe = getStripe();
    const user = req.user!;
    const { plan } = req.body; // "monthly" | "annual"

    const priceId = plan === "annual"
      ? process.env.STRIPE_PRICE_ANNUAL
      : process.env.STRIPE_PRICE_MONTHLY;

    if (!priceId) {
      return res.status(503).json({ error: `STRIPE_PRICE_${(plan === "annual" ? "ANNUAL" : "MONTHLY").toUpperCase()} is not configured` });
    }

    // Reuse existing Stripe customer if we already have one
    let customerId: string | undefined = user.stripeCustomerId ?? undefined;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { userId: String(user.id), householdId: String(user.householdId) },
      });
      customerId = customer.id;
      await storage.setStripeCustomer(user.id, customerId);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${clientOrigin()}/#/?upgraded=true`,
      cancel_url: `${clientOrigin()}/#/profile`,
      subscription_data: {
        metadata: { userId: String(user.id), householdId: String(user.householdId) },
      },
      allow_promotion_codes: true,
    });

    storage.logEvent(user.id, "checkout_started", { plan: plan === "annual" ? "annual" : "monthly" });
    res.json({ url: session.url });
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("Stripe checkout error:", err.message);
    res.status(500).json({ error: "Could not create checkout session" });
  }
});

// ── Customer Portal ──────────────────────────────────────────────────────────
router.post("/portal", requireAuth, async (req: Request, res: Response) => {
  try {
    const stripe = getStripe();
    const user = req.user!;

    if (!user.stripeCustomerId) {
      return res.status(400).json({ error: "No active subscription found" });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${clientOrigin()}/#/profile`,
    });

    res.json({ url: session.url });
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("Stripe portal error:", err.message);
    res.status(500).json({ error: "Could not open billing portal" });
  }
});

// ── Webhook ──────────────────────────────────────────────────────────────────
// Must be mounted BEFORE the requireAuth middleware (it's public, signature-verified).
// Uses req.rawBody (Buffer) captured in index.ts via express.json's verify callback.
router.post("/webhook", async (req: Request, res: Response) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not configured — webhook ignored");
    return res.status(200).json({ received: true }); // don't 500, Stripe retries
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).json({ error: "Missing stripe-signature header" });

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    // req.rawBody is captured by the express.json verify callback in index.ts
    event = stripe.webhooks.constructEvent(req.rawBody as Buffer, sig, webhookSecret);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  try {
    switch (event.type) {

      // Payment succeeded → set user premium
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;

        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;

        const user = await storage.getUserByStripeCustomerId(customerId);
        if (!user) { console.error("Webhook: no user for customer", customerId); break; }

        await Promise.all([
          storage.updateUserSubscriptionTier(user.id, "premium"),
          storage.setStripeSubscription(user.id, subscriptionId),
        ]);
        storage.logEvent(user.id, "subscription_activated");
        console.log(`[billing] User ${user.id} upgraded to premium via checkout`);
        break;
      }

      // Active subscription confirmed (also fires on first payment)
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = (invoice.customer as string);
        // In Stripe API 2026-03-25.dahlia, subscription ID lives on parent.subscription_details
        const subRef = invoice.parent?.subscription_details?.subscription;
        const subscriptionId = typeof subRef === "string" ? subRef : (subRef as any)?.id ?? null;

        const user = await storage.getUserByStripeCustomerId(customerId);
        if (!user) break;

        // Only act if this is a recurring payment (keep premium active)
        if (user.subscriptionTier !== "premium") {
          await storage.updateUserSubscriptionTier(user.id, "premium");
        }
        if (subscriptionId) {
          await storage.setStripeSubscription(user.id, subscriptionId);
        }
        break;
      }

      // Subscription cancelled or expired → revert to free
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = (sub.customer as string);

        const user = await storage.getUserByStripeCustomerId(customerId);
        if (!user) break;

        await Promise.all([
          storage.updateUserSubscriptionTier(user.id, "free"),
          storage.setStripeSubscription(user.id, null),
        ]);
        console.log(`[billing] User ${user.id} reverted to free (subscription deleted)`);
        break;
      }

      // Payment failed — log it. Don't immediately downgrade (Stripe retries for some days).
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = (invoice.customer as string);
        const user = await storage.getUserByStripeCustomerId(customerId);
        console.warn(`[billing] Payment failed for user ${user?.id ?? customerId}`);
        break;
      }

      default:
        // Silently ignore other events
        break;
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
    // Still return 200 — we don't want Stripe to retry for our own handler bugs
  }

  res.json({ received: true });
});

export default router;
