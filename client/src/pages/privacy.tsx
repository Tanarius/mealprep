import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Link>

        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: April 2026</p>

        <div className="space-y-8 text-sm leading-relaxed text-foreground/90">

          <section>
            <h2 className="text-lg font-semibold mb-3">1. Information We Collect</h2>
            <p className="mb-3">We collect information you provide directly:</p>
            <ul className="list-disc list-inside space-y-2 text-foreground/80">
              <li><strong>Account data:</strong> username, optional email address, hashed password</li>
              <li><strong>Household data:</strong> recipes, weekly meal plans, pantry items, shopping lists</li>
              <li><strong>Preferences:</strong> cuisine preferences, dietary restrictions, cooking style</li>
              <li><strong>Usage data:</strong> activity log (recipes added, plans updated) retained for 90 days</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">2. How We Use Your Information</h2>
            <ul className="list-disc list-inside space-y-2 text-foreground/80">
              <li>To provide and improve the Service</li>
              <li>To personalize AI recipe suggestions based on your taste profile</li>
              <li>To generate shopping lists and meal plans for your household</li>
              <li>To process payments through Stripe (we never see or store card numbers)</li>
              <li>To send password reset emails (only if you provide an email address)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">3. AI Processing</h2>
            <p>When you use AI features (Kitchen Copilot, recipe suggestions, social media imports), your inputs are sent to Anthropic's Claude API for processing. Inputs may include recipe text, uploaded food images, and your taste preferences. Anthropic's privacy policy governs their handling of this data. We do not store AI conversation transcripts beyond your active session.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">4. Third-Party Services</h2>
            <ul className="list-disc list-inside space-y-2 text-foreground/80">
              <li><strong>Stripe:</strong> Handles all payment processing. We store only your Stripe customer ID and subscription status, never your card details.</li>
              <li><strong>Anthropic Claude:</strong> Powers AI features. Recipe content and images you submit may be processed by Anthropic.</li>
              <li><strong>Spoonacular / Edamam:</strong> Used for recipe search. Search queries (cuisine, meal type, preferences) are sent to these services.</li>
              <li><strong>Neon PostgreSQL:</strong> Our database provider. Your data is stored on encrypted servers.</li>
              <li><strong>Resend:</strong> Used to send password reset emails. Your email address is transmitted only when a reset is requested.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">5. Data Sharing</h2>
            <p>We do not sell, rent, or share your personal information with third parties for marketing purposes. Data is shared only with the service providers listed above, as necessary to operate the Service.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">6. Household Data</h2>
            <p>When you join a household, other household members can see shared recipes, meal plans, pantry items, and shopping lists. They cannot see your password or personal account settings.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">7. Data Retention</h2>
            <p>We retain your data as long as your account is active. You may delete your account at any time from the Profile page, which permanently deletes all associated data. Activity logs are automatically pruned after 90 days.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">8. Your Rights</h2>
            <p className="mb-3">You have the right to:</p>
            <ul className="list-disc list-inside space-y-2 text-foreground/80">
              <li>Access the personal data we hold about you</li>
              <li>Correct inaccurate data via your profile settings</li>
              <li>Delete your account and all associated data</li>
              <li>Export your recipe library (contact us)</li>
            </ul>
            <p className="mt-3">To exercise these rights, use the account settings in the app or contact us at <a href="mailto:hello@simmer.kitchen" className="text-primary hover:underline">hello@simmer.kitchen</a>.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">9. Cookies and Storage</h2>
            <p>We use session cookies for authentication (httpOnly, Secure in production). We use localStorage to save UI preferences (theme, dismissed banners, shopping list state). We do not use third-party tracking or advertising cookies.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">10. Security</h2>
            <p>Passwords are hashed with bcrypt (cost 12) and never stored in plaintext. All production traffic is served over HTTPS. Session tokens are stored in httpOnly cookies not accessible to JavaScript.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">11. Children</h2>
            <p>The Service is not directed at children under 13. We do not knowingly collect personal information from children under 13. If you believe a child has provided us their information, please contact us to have it removed.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">12. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify users of significant changes via email (if provided) or a notice in the app.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">13. Contact</h2>
            <p>For privacy inquiries: <a href="mailto:hello@simmer.kitchen" className="text-primary hover:underline">hello@simmer.kitchen</a></p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-border text-xs text-muted-foreground flex gap-4">
          <Link href="/terms" className="hover:underline">Terms of Service</Link>
          <Link href="/" className="hover:underline">Back to Simmer</Link>
        </div>
      </div>
    </div>
  );
}

