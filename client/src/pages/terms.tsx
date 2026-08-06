import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Link>

        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: April 2026</p>

        <div className="space-y-8 text-sm leading-relaxed text-foreground/90">

          <section>
            <h2 className="text-lg font-semibold mb-3">1. Acceptance of Terms</h2>
            <p>By creating an account or using Simmer ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">2. Description of Service</h2>
            <p>Simmer is a household meal planning application that provides AI-assisted recipe discovery, weekly meal planning, shopping list generation, and pantry management. Some features require a paid Premium subscription.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">3. User Accounts</h2>
            <ul className="list-disc list-inside space-y-2 text-foreground/80">
              <li>You must provide accurate information when creating an account.</li>
              <li>You are responsible for maintaining the security of your password.</li>
              <li>You may not share your account credentials or use another user's account.</li>
              <li>You must be at least 13 years old to use the Service.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">4. Subscriptions and Billing</h2>
            <p className="mb-3">Simmer offers a free tier and a Premium subscription ($4.99/month). Billing is processed by Stripe. By subscribing, you agree to recurring charges until you cancel.</p>
            <ul className="list-disc list-inside space-y-2 text-foreground/80">
              <li>You may cancel your subscription at any time through the billing portal.</li>
              <li>Cancellation takes effect at the end of your current billing period.</li>
              <li>Refunds are not provided for partial billing periods.</li>
              <li>One Premium subscription covers all members of your household.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">5. Acceptable Use</h2>
            <p className="mb-3">You agree not to:</p>
            <ul className="list-disc list-inside space-y-2 text-foreground/80">
              <li>Use the Service for any unlawful purpose.</li>
              <li>Attempt to gain unauthorized access to any part of the Service.</li>
              <li>Upload malicious content or attempt to disrupt the Service.</li>
              <li>Scrape, copy, or redistribute content from the Service without permission.</li>
              <li>Use automated tools to make excessive API requests.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">6. Content</h2>
            <p>You retain ownership of recipes and content you create. By uploading content, you grant us a limited license to store and display it to you and your household members. We do not sell your recipes or personal data to third parties.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">7. AI Features</h2>
            <p>Simmer uses AI to suggest recipes and assist with meal planning. AI suggestions are provided "as is" â€” you should verify ingredients, allergens, and cooking instructions before use. We are not responsible for the accuracy of AI-generated content.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">8. Disclaimer of Warranties</h2>
            <p>The Service is provided "as is" without warranties of any kind. We do not guarantee uninterrupted access, data accuracy, or fitness for a particular purpose.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">9. Limitation of Liability</h2>
            <p>To the fullest extent permitted by law, Simmer shall not be liable for indirect, incidental, special, or consequential damages arising from your use of the Service, including but not limited to loss of data or loss of profits.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">10. Changes to Terms</h2>
            <p>We may update these Terms at any time. Continued use of the Service after changes constitutes acceptance of the updated Terms. We will notify users of material changes via email if an email address is on file.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">11. Contact</h2>
            <p>For questions about these Terms, contact us at <a href="mailto:hello@simmer.kitchen" className="text-primary hover:underline">hello@simmer.kitchen</a>.</p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-border text-xs text-muted-foreground flex gap-4">
          <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
          <Link href="/" className="hover:underline">Back to Simmer</Link>
        </div>
      </div>
    </div>
  );
}

