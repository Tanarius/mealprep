import { useEffect } from "react";

const scrollTo = (id: string) =>
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

// ─── Scroll-reveal hook ───────────────────────────────────────────────────

function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".fade-in-up");
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            const delay = Number(el.dataset.fadeDelay ?? 0);
            setTimeout(() => {
              el.style.opacity = "1";
              el.style.transform = "translateY(0)";
            }, delay);
            obs.unobserve(el);
          }
        });
      },
      { threshold: 0.15 }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);
}

// ─── Hero floating cards ───────────────────────────────────────────────────

function RecipeCard() {
  return (
    <div className="hero-card" style={{ "--rot": "-8deg", "--dur": "7s", "--delay": "0s", top: "16%", left: "2.5%" } as React.CSSProperties}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#F5EDE3", marginBottom: 5 }}>Chicken Tacos</div>
      <div style={{ fontSize: 11, color: "#9A8A7A", marginBottom: 8 }}>🌮 Tex-Mex · 25 min</div>
      <span style={{ background: "#C96A3A", color: "#F5EDE3", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>Quick</span>
    </div>
  );
}

function ShoppingCard() {
  return (
    <div className="hero-card" style={{ "--rot": "6deg", "--dur": "9s", "--delay": "2s", top: "16%", right: "2.5%" } as React.CSSProperties}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#F5EDE3", marginBottom: 10 }}>🛒 This week</div>
      <div style={{ fontSize: 11, color: "#3D8A5A", marginBottom: 5 }}>✓ Chicken breast</div>
      <div style={{ fontSize: 11, color: "#9A8A7A", marginBottom: 5 }}>Broccoli</div>
      <div style={{ fontSize: 11, color: "#9A8A7A" }}>Rice</div>
    </div>
  );
}

function PlanCard() {
  return (
    <div className="hero-card" style={{ "--rot": "4deg", "--dur": "8s", "--delay": "1s", bottom: "20%", left: "2.5%" } as React.CSSProperties}>
      <div style={{ fontSize: 11, color: "#9A8A7A", marginBottom: 6 }}>Tuesday</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#F5EDE3" }}>🌙 Pasta Carbonara</div>
    </div>
  );
}

// ─── App UI mocks ──────────────────────────────────────────────────────────

function PlannerMock() {
  const days = ["M", "T", "W", "T", "F"];
  const meals = ["Pasta", "Tacos", "Salad", "Curry", "Pizza"];
  const colors = ["#1C1410", "#C96A3A", "#1C1410", "#3D5A47", "#1C1410"];
  const borders = ["#3A2A20", "rgba(201,106,58,0.5)", "#3A2A20", "rgba(61,90,71,0.5)", "#3A2A20"];
  const bottomBars = ["#3A2A20", "#C96A3A", "#3A2A20", "#3D5A47", "#3A2A20"];
  return (
    <div style={{ background: "#2A1F18", borderRadius: 14, padding: 20, border: "1px solid #3A2A20", boxShadow: "inset 0 2px 12px rgba(0,0,0,0.2)" }}>
      <div style={{ fontSize: 12, color: "#9A8A7A", marginBottom: 12, fontWeight: 600 }}>Week of Jun 2</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
        {days.map((d, i) => (
          <div key={i}>
            <div style={{ textAlign: "center", fontSize: 11, color: "#9A8A7A", marginBottom: 6, fontWeight: 600 }}>{d}</div>
            <div
              className={i === 1 ? "planner-pulse" : ""}
              style={{
                background: colors[i],
                border: `1px solid ${borders[i]}`,
                borderBottom: `3px solid ${bottomBars[i]}`,
                borderRadius: 8, padding: "10px 4px",
                textAlign: "center", fontSize: 11,
                color: "#F5EDE3", minHeight: 42,
                display: "flex", alignItems: "center",
                justifyContent: "center", fontWeight: 500,
              }}
            >
              {meals[i]}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, padding: "8px 10px", background: "#1C1410", borderRadius: 8, fontSize: 11, color: "#9A8A7A" }}>
        🛒 <span style={{ color: "#C96A3A", fontWeight: 600 }}>23 items</span> added to shopping list
      </div>
    </div>
  );
}

function HouseholdMock() {
  const members: Array<{ name: string; color: string; note: string }> = [
    { name: "Ana",   color: "#C96A3A", note: "Added Margherita Pizza" },
    { name: "Luis",  color: "#3D5A47", note: "Planned Wed dinner" },
    { name: "Sofia", color: "#7B5EA7", note: "Checked off 6 items" },
  ];
  return (
    <div style={{ background: "#2A1F18", borderRadius: 14, padding: 20, border: "1px solid #3A2A20", boxShadow: "inset 0 2px 12px rgba(0,0,0,0.2)" }}>
      <div style={{ fontSize: 12, color: "#9A8A7A", marginBottom: 12, fontWeight: 600 }}>The Martinez household</div>
      <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
        {members.map(({ name, color }) => (
          <div key={name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
            <div style={{
              width: 40, height: 40, borderRadius: "50%",
              background: color,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, fontWeight: 700, color: "#F5EDE3",
              boxShadow: `0 0 0 3px rgba(201,106,58,0.2), 0 0 16px ${color}44`,
            }}>
              {name[0]}
            </div>
            <span style={{ fontSize: 10, color: "#9A8A7A" }}>{name}</span>
          </div>
        ))}
      </div>
      {members.map(({ name, color, note }) => (
        <div key={name} style={{ fontSize: 11, color: "#9A8A7A", padding: "7px 10px", background: "#1C1410", borderRadius: 7, marginBottom: 6, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0, display: "inline-block", boxShadow: `0 0 6px ${color}` }} />
          <span><strong style={{ color: "#F5EDE3" }}>{name}</strong> {note}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Landing page ──────────────────────────────────────────────────────────

export default function LandingPage() {
  useScrollReveal();

  const features: Array<{
    tag: string; tagColor: string; tagBg: string;
    heading: string; body: string;
    mock: React.ReactNode; mockFirst: boolean;
  }> = [
    {
      tag: "✨ Built-in assistant",
      tagColor: "#C96A3A", tagBg: "rgba(201,106,58,0.12)",
      heading: "Your whole week, planned in minutes",
      body: "Drag, drop, done. Build your meal week visually and let Simmer generate your shopping list automatically.",
      mock: <PlannerMock />, mockFirst: true,
    },
    {
      tag: "👨‍👩‍👧‍👦 Household accounts",
      tagColor: "#3D8A5A", tagBg: "rgba(61,90,71,0.15)",
      heading: "Built for whoever's at your table",
      body: "Family of four. Two roommates. Solo but meal prepping for the week. Simmer adapts to your household, not the other way around.",
      mock: <HouseholdMock />, mockFirst: true,
    },
  ];

  const freeFeatures = [
    "Meal planning & weekly planner",
    "Recipe library (unlimited)",
    "Shopping list generation",
    "Nutrition data on recipes",
    "Household sharing (2 members)",
    "30 suggestions / month",
    "100 assistant messages / month",
  ];

  const proFeatures = [
    "Everything in Free",
    "500 suggestions / month",
    "1,000 assistant messages / month",
    "100 screenshot imports / month",
    "Up to 6 household members",
    "Full activity feed history",
  ];

  const painPoints = [
    { icon: "😤", heading: "Tired of 'what's for dinner?'",       body: "The same question, every single night. Simmer ends it.",     border: "#C96A3A" },
    { icon: "🛒", heading: "Grocery runs that miss half the list", body: "Your shopping list builds itself from your week's meals.",    border: "#3D5A47" },
    { icon: "🤝", heading: "Planning for one but cooking for many", body: "Simmer works for your whole household, whoever that is.",     border: "#C96A3A" },
  ];

  const stats = [
    { top: "Free to start",  bottom: "No credit card" },
    { top: "5 min setup",    bottom: "Start planning today" },
    { top: "Any household",  bottom: "Families · Roommates · Anyone" },
  ];

  return (
    <>
      <style>{`
        @keyframes lp-float-card {
          0%,100% { transform: rotate(var(--rot, 0deg)) translateY(0px); }
          50%      { transform: rotate(var(--rot, 0deg)) translateY(-14px); }
        }
        @keyframes gentle-pulse {
          0%,100% { opacity: 1; }
          50%      { opacity: 0.6; }
        }
        @keyframes sparkle-anim {
          0%,100% { transform: scale(1) rotate(0deg); }
          50%      { transform: scale(1.3) rotate(15deg); }
        }
        @keyframes pulse-glow {
          0%,100% { box-shadow: 0 4px 24px rgba(201,106,58,0.3), 0 0 0 0 rgba(201,106,58,0.4); }
          50%      { box-shadow: 0 4px 24px rgba(201,106,58,0.3), 0 0 0 12px rgba(201,106,58,0); }
        }
        .hero-card {
          position: absolute;
          background: #2A1F18;
          border: 1px solid #3D2E24;
          border-radius: 12px;
          padding: 12px 16px;
          width: 170px;
          opacity: 0.85;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          animation: lp-float-card var(--dur, 8s) ease-in-out var(--delay, 0s) infinite;
        }
        @media (max-width: 860px) { .hero-card { display: none; } }
        .fade-in-up {
          opacity: 0;
          transform: translateY(24px);
          transition: opacity 0.6s ease, transform 0.6s ease;
        }
        .pain-card {
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          cursor: default;
        }
        .pain-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 20px 48px rgba(0,0,0,0.4) !important;
        }
        .planner-pulse { animation: gentle-pulse 3s ease-in-out infinite; }
        .sparkle-icon  { display: inline-block; animation: sparkle-anim 2.5s ease-in-out infinite; }
        .lp-cta-pulse  { animation: pulse-glow 3s ease-in-out infinite; }
        .lp-nav-btn {
          background: none; border: none; cursor: pointer;
          font-family: inherit; font-size: 14px; color: #9A8A7A;
          padding: 0; transition: color 0.15s;
        }
        .lp-nav-btn:hover { color: #F5EDE3; }
        .lp-nav-link { font-size: 14px; color: #9A8A7A; text-decoration: none; transition: color 0.15s; }
        .lp-nav-link:hover { color: #F5EDE3; }
        .lp-cta-primary {
          background: #C96A3A; color: #F5EDE3;
          text-decoration: none; display: inline-block;
          transition: opacity 0.15s;
        }
        .lp-cta-primary:hover { opacity: 0.88; }
        .lp-cta-outline {
          background: transparent; border: 1px solid #3A2A20; color: #F5EDE3;
          cursor: pointer; font-family: inherit;
          transition: border-color 0.15s, background 0.15s;
        }
        .lp-cta-outline:hover { border-color: rgba(201,106,58,0.5); background: rgba(201,106,58,0.06); }
        .lp-footer-link { color: #5A4A3A; text-decoration: none; transition: color 0.15s; }
        .lp-footer-link:hover { color: #9A8A7A; }
        .pro-card-glow { box-shadow: 0 0 40px rgba(201,106,58,0.15), 0 0 0 2px #C96A3A; }
      `}</style>

      <div style={{ background: "#1C1410", color: "#F5EDE3", minHeight: "100vh", fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>

        {/* ── NAV ──────────────────────────────────────────────── */}
        <nav style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
          height: 62, padding: "0 32px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: "1px solid rgba(61,46,36,0.5)",
          background: "rgba(28,20,16,0.85)", backdropFilter: "blur(12px)",
        }}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em" }}>
            <span style={{ color: "#C96A3A" }}>S</span>immer
          </div>
          <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
            <button className="lp-nav-btn" onClick={() => scrollTo("features")}>Features</button>
            <button className="lp-nav-btn" onClick={() => scrollTo("pricing")}>Pricing</button>
            <a href="/#/auth" className="lp-nav-link">Sign in</a>
            <a href="/#/auth" style={{ background: "#C96A3A", color: "#F5EDE3", padding: "9px 20px", borderRadius: 9, fontSize: 14, fontWeight: 600, textDecoration: "none", transition: "opacity 0.15s" }}>
              Get started
            </a>
          </div>
        </nav>

        {/* ── HERO ─────────────────────────────────────────────── */}
        <section style={{
          minHeight: "100vh",
          display: "flex", alignItems: "center", justifyContent: "center",
          position: "relative", overflow: "hidden", paddingTop: 62,
          background: "#1C1410",
        }}>
          {/* Terracotta radial glow */}
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(201,106,58,0.12) 0%, transparent 70%)", pointerEvents: "none" }} />

          {/* Floating UI cards */}
          <RecipeCard />
          <ShoppingCard />
          <PlanCard />

          <div style={{ textAlign: "center", maxWidth: 660, padding: "0 24px", position: "relative", zIndex: 1 }}>
            <div className="fade-in-up" style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "rgba(61,90,71,0.2)", border: "1px solid rgba(61,90,71,0.4)",
              borderRadius: 20, padding: "6px 18px", fontSize: 13, color: "#3D8A5A",
              marginBottom: 28, fontWeight: 600,
            }}>
              ✨ Meal planning for real households
            </div>

            <h1 className="fade-in-up" data-fade-delay="100" style={{
              fontSize: "clamp(48px, 9vw, 72px)", fontWeight: 800,
              lineHeight: 1.06, marginBottom: 22, letterSpacing: "-0.035em",
            }}>
              Good things<br />
              <span style={{ color: "#C96A3A", textShadow: "0 0 60px rgba(201,106,58,0.4)" }}>simmer.</span>
            </h1>

            <p className="fade-in-up" data-fade-delay="200" style={{
              fontSize: "clamp(16px, 2.5vw, 19px)", color: "#9A8A7A",
              lineHeight: 1.65, margin: "0 auto 38px", maxWidth: 520,
            }}>
              Meal planning for real households — families, roommates, partners, whoever.
              No more "what's for dinner."
            </p>

            <div className="fade-in-up" data-fade-delay="300" style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 22 }}>
              <a href="/#/auth" className="lp-cta-primary" style={{ padding: "14px 30px", borderRadius: 10, fontSize: 16, fontWeight: 700 }}>Start for free</a>
              <button className="lp-cta-outline" onClick={() => scrollTo("features")} style={{ padding: "14px 30px", borderRadius: 10, fontSize: 16, fontWeight: 600 }}>
                See how it works
              </button>
            </div>

            <p className="fade-in-up" data-fade-delay="400" style={{ fontSize: 13, color: "#5A4A3A", margin: 0 }}>
              Free to start. No credit card required.
            </p>
          </div>
        </section>

        {/* ── PAIN POINTS ──────────────────────────────────────── */}
        <section style={{ padding: "90px 24px", maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 24 }}>
            {painPoints.map(({ icon, heading, body, border }, i) => (
              <div
                key={heading}
                className="pain-card fade-in-up"
                data-fade-delay={String(i * 100)}
                style={{
                  background: "#2A1F18", borderRadius: 18,
                  padding: 30, border: "1px solid #3D2E24",
                  borderLeft: `3px solid ${border}`,
                }}
              >
                <div style={{ fontSize: 34, marginBottom: 14 }}>{icon}</div>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: "#F5EDE3", lineHeight: 1.35 }}>{heading}</h3>
                <p style={{ fontSize: 14, color: "#9A8A7A", lineHeight: 1.6, margin: 0 }}>{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── FEATURES ─────────────────────────────────────────── */}
        <section id="features" style={{ background: "#201814", padding: "80px 24px 90px" }}>
          <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <div className="fade-in-up" style={{ textAlign: "center", marginBottom: 70 }}>
              <h2 style={{ fontSize: "clamp(28px, 5vw, 42px)", fontWeight: 900, letterSpacing: "-0.025em", marginBottom: 10 }}>
                Everything your kitchen needs
              </h2>
              <div style={{ width: 60, height: 3, background: "#C96A3A", margin: "0 auto", borderRadius: 2 }} />
            </div>

            {features.map(({ tag, tagColor, tagBg, heading, body, mock, mockFirst }, i) => {
              const copyBlock = (
                <div className="fade-in-up" data-fade-delay={String(i * 100)} style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <div style={{ display: "inline-block", background: tagBg, color: tagColor, borderRadius: 20, padding: "4px 14px", fontSize: 12, fontWeight: 700, marginBottom: 16, alignSelf: "flex-start" }}>
                    {tag}
                  </div>
                  <h3 style={{ fontSize: "clamp(22px, 3.5vw, 28px)", fontWeight: 800, marginBottom: 14, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
                    {heading}
                  </h3>
                  <p style={{ fontSize: 15, color: "#9A8A7A", lineHeight: 1.75, margin: 0 }}>{body}</p>
                </div>
              );
              const mockBlock = (
                <div className="fade-in-up" data-fade-delay={String(i * 100 + 100)}>{mock}</div>
              );
              return (
                <div key={i} style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: 52, alignItems: "center",
                  marginBottom: i < features.length - 1 ? 80 : 0,
                }}>
                  {mockFirst ? <>{mockBlock}{copyBlock}</> : <>{copyBlock}{mockBlock}</>}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── PRICING ──────────────────────────────────────────── */}
        <section id="pricing" style={{ padding: "80px 24px", maxWidth: 820, margin: "0 auto" }}>
          <div className="fade-in-up" style={{ textAlign: "center", marginBottom: 36 }}>
            <h2 style={{ fontSize: "clamp(28px, 5vw, 42px)", fontWeight: 900, marginBottom: 10, letterSpacing: "-0.025em" }}>
              Simple, honest pricing
            </h2>
            <p style={{ color: "#9A8A7A", fontSize: 15, margin: 0 }}>Start free, upgrade when you're ready.</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
            {/* Free */}
            <div className="fade-in-up" style={{ background: "#2A1F18", borderRadius: 22, padding: 34, border: "1px dashed #3A2A20", display: "flex", flexDirection: "column" }}>
              <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Free</h3>
              <div style={{ fontSize: 40, fontWeight: 900, marginBottom: 2, letterSpacing: "-0.03em" }}>$0</div>
              <div style={{ fontSize: 14, color: "#9A8A7A", marginBottom: 30 }}>forever</div>
              <div style={{ flex: 1 }}>
                {freeFeatures.map(f => (
                  <div key={f} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 13 }}>
                    <span style={{ color: "#3D8A5A", flexShrink: 0, fontWeight: 700, marginTop: 1 }}>✓</span>
                    <span style={{ fontSize: 14, color: "#9A8A7A", lineHeight: 1.4 }}>{f}</span>
                  </div>
                ))}
              </div>
              <a href="/#/auth" style={{ display: "block", textAlign: "center", background: "#2E2018", border: "1px solid #3A2A20", color: "#F5EDE3", padding: "13px 0", borderRadius: 10, fontSize: 15, fontWeight: 700, textDecoration: "none", marginTop: 30 }}>
                Get started free
              </a>
            </div>

            {/* Pro */}
            <div className="pro-card-glow fade-in-up" data-fade-delay="100" style={{ background: "#2A1F18", borderRadius: 22, padding: 34, position: "relative", display: "flex", flexDirection: "column" }}>
              <div style={{ position: "absolute", top: -14, left: "50%", transform: "translateX(-50%)", background: "#C96A3A", color: "#F5EDE3", borderRadius: 10, padding: "5px 20px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
                <span className="sparkle-icon" style={{ fontSize: 12 }}>✨</span> Most popular
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Simmer Pro</h3>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 2 }}>
                <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: "-0.03em" }}>$4.99</div>
                <div style={{ fontSize: 14, color: "#9A8A7A" }}>/ mo</div>
              </div>
              <div style={{ fontSize: 13, color: "#9A8A7A", marginBottom: 30 }}>
                billed monthly
              </div>
              <div style={{ flex: 1 }}>
                {proFeatures.map(f => (
                  <div key={f} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 13 }}>
                    <span style={{ color: "#C96A3A", flexShrink: 0, fontWeight: 700, marginTop: 1 }}>✓</span>
                    <span style={{ fontSize: 14, color: "#9A8A7A", lineHeight: 1.4 }}>{f}</span>
                  </div>
                ))}
              </div>
              <a href="/#/auth" style={{ display: "block", textAlign: "center", background: "#C96A3A", color: "#F5EDE3", padding: "13px 0", borderRadius: 10, fontSize: 15, fontWeight: 700, textDecoration: "none", marginTop: 30 }}>
                Start for free
              </a>
              <p style={{ fontSize: 12, color: "#5A4A3A", textAlign: "center", margin: "12px 0 0" }}>$4.99/month. Cancel anytime.</p>
            </div>
          </div>
        </section>

        {/* ── SOCIAL PROOF ─────────────────────────────────────── */}
        <section style={{ background: "#201814", padding: "80px 24px" }}>
          <div style={{ maxWidth: 820, margin: "0 auto", textAlign: "center" }}>
            <div className="fade-in-up" style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", color: "#5A4A3A", marginBottom: 16, textTransform: "uppercase" }}>
              Early Access
            </div>
            <h2 className="fade-in-up" data-fade-delay="100" style={{ fontSize: "clamp(24px, 4vw, 36px)", fontWeight: 900, marginBottom: 48, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
              Join the households already planning smarter
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20 }}>
              {stats.map(({ top, bottom }, i) => (
                <div
                  key={top}
                  className="fade-in-up"
                  data-fade-delay={String(i * 100)}
                  style={{ background: "#2A1F18", border: "1px solid #3D2E24", borderRadius: 14, padding: "24px 20px", textAlign: "center" }}
                >
                  <div style={{ fontSize: 17, fontWeight: 800, color: "#F5EDE3", marginBottom: 6 }}>{top}</div>
                  <div style={{ fontSize: 13, color: "#9A8A7A" }}>{bottom}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FINAL CTA ────────────────────────────────────────── */}
        <section style={{ padding: "80px 24px 90px", maxWidth: 720, margin: "0 auto" }}>
          <div className="fade-in-up" style={{
            background: "linear-gradient(135deg, #2A1F18 0%, #1C1410 100%)",
            borderRadius: 26, padding: "72px 40px",
            textAlign: "center", border: "1px solid #3A2A20",
            position: "relative", overflow: "hidden",
          }}>
            {/* Watermark */}
            <div style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              fontSize: 200, fontWeight: 900, color: "#C96A3A",
              opacity: 0.03, pointerEvents: "none",
              letterSpacing: "-0.05em", whiteSpace: "nowrap", lineHeight: 1,
              userSelect: "none",
            }}>
              simmer.
            </div>
            <div style={{ position: "relative", zIndex: 1 }}>
              <h2 style={{ fontSize: "clamp(30px, 6vw, 44px)", fontWeight: 900, marginBottom: 14, letterSpacing: "-0.025em" }}>
                Feed your people.
              </h2>
              <p style={{ fontSize: 16, color: "#9A8A7A", marginBottom: 36 }}>
                Join Simmer and take dinner off your plate.
              </p>
              <a href="/#/auth" className="lp-cta-primary lp-cta-pulse" style={{ padding: "16px 48px", borderRadius: 13, fontSize: 18, fontWeight: 700 }}>
                Get started for free
              </a>
            </div>
          </div>
        </section>

        {/* ── FOOTER ───────────────────────────────────────────── */}
        <footer style={{ borderTop: "1px solid #2A1F18", padding: "26px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16, maxWidth: 1000, margin: "0 auto", fontSize: 13, color: "#5A4A3A" }}>
          <div style={{ fontWeight: 700 }}>
            <span style={{ color: "#C96A3A" }}>Simmer</span>
            <span> — Good things simmer.</span>
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            <a href="/#/privacy" className="lp-footer-link">Privacy Policy</a>
            <a href="/#/terms"   className="lp-footer-link">Terms</a>
            <a href="/#/pricing" className="lp-footer-link">Pricing</a>
          </div>
          <div>© 2026 Simmer</div>
          <div style={{ flexBasis: "100%", textAlign: "center", fontSize: 12, color: "#5A4A3A", opacity: 0.85 }}>
            Simmer's assistant is powered by AI.
          </div>
        </footer>

      </div>
    </>
  );
}
