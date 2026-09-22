// All session content — from Final_Organic_Social_Analysis_Master_v4.xlsx.
// Edit text here if you want to change a question — then commit on GitHub (Vercel redeploys).
//
// QUIZ question fields:
//   id   unique id          r    round key (see ROUNDS)
//   type "rg" (Red/Green) or "mcq" (multiple choice, up to 4 options)
//   t    statement / question        opts  options (mcq only)
//   a    correct answer: "R" / "G" for rg — "A" / "B" / "C" / "D" for mcq
//   e    why (shown after reveal)    d     discussion prompt    pts  points

// Up to 10 teams. The trainer picks how many (4–10) from the Lobby. Default: 5.
const TEAMS = "ABCDEFGHIJ".split("").map((l, i) => ({ id: "T" + (i + 1), name: "Team " + l }));
const DEFAULT_TEAMS = 5;

const EMOJIS = ["🦊","🐙","🦄","🐯","🐸","🐼","🦁","🐧","🐝","🦉","🐬","🌵","🍩","☕","🥐","🚀","🐱","🐶","🐨","🐵","🦋","🐢","🦈","🐲","👾","🤖","👻","🎃","⚡","🔥","🌈","⭐","🍕","🍔","🧁","🍉","🎮","🎧","📸","💎"];

// Order = order of the session. kind: round (Red/Green game), app (transfer example), bonus (question bank)
const ROUNDS = {
  "1":     { name: "Round 1", rule: "Context before judgment", level: "Level 1 — Basic recognition", takeaway: "Context before judgment.", kind: "round" },
  "RATES": { name: "Post A vs Post B", rule: "Raw numbers vs rates", level: "Morning Club · scale vs efficiency", takeaway: "Raw numbers tell scale. Rates tell efficiency.", kind: "app" },
  "2":     { name: "Round 2", rule: "Raw numbers vs rates", level: "Level 2 — Applied", takeaway: "Scale and efficiency answer different questions.", kind: "round" },
  "PULSE": { name: "PULSE Fitness", rule: "Objective decides the KPI", level: "Transfer example · Stories", takeaway: "The primary proof of lead generation is a real lead action.", kind: "app" },
  "3":     { name: "KPI Round", rule: "Objective decides the KPI", level: "Level 2 → 3", takeaway: "The KPI follows the intended action — not the deepest metric.", kind: "round" },
  "QB":    { name: "QUICKBITE Delivery", rule: "Find the first drop-off", level: "Transfer example · Stories", takeaway: "Find where the journey weakened first.", kind: "app" },
  "4":     { name: "Round 4", rule: "Find the first drop-off", level: "Level 3 — Analytical", takeaway: "Don't jump to conclusions. Diagnosis = hypothesis.", kind: "round" },
  "VOLT":  { name: "VOLT Electronics", rule: "Turn numbers into action", level: "Transfer example · Insight vs hypothesis", takeaway: "Numbers describe. Insights explain. Actions improve.", kind: "app" },
  "F":     { name: "Final Flag", rule: "Turn numbers into action", level: "Final statement", takeaway: "Turn numbers into action.", kind: "round" },
  "BANK":  { name: "Bonus Quiz", rule: "Leveled question bank", level: "Use it if you have extra time", takeaway: "Context → Objective → Drop-off → Action.", kind: "bonus" },
};

const RG = [
  // ---- Round 1 — Level 1 (order mixed so answers don't alternate)
  { id: "r1a", r: "1", type: "rg", a: "R", pts: 1, t: "A Morning Club post reached 200K people, so it was successful.", e: "Reach alone cannot prove success; we need the objective, who was reached, and what happened after reach.", d: "What information is missing before we judge?" },
  { id: "r1c", r: "1", type: "rg", a: "R", pts: 1, t: "1M views means 1M potential customers.", e: "A view does not automatically equal a relevant audience member, lead, or customer.", d: "What would make a view more valuable?" },
  { id: "r1b", r: "1", type: "rg", a: "G", pts: 1, t: "Before judging a result, we need to know the content objective.", e: "The objective gives the number its meaning.", d: "Can the same metric mean success for one post and failure for another?" },
  { id: "r1d", r: "1", type: "rg", a: "G", pts: 1, t: "If the objective is Discovery, Non-follower Reach can be more useful than Likes.", e: "It is closer to proving that new people discovered the content.", d: "Why are Likes not the best proof of Discovery?" },

  // ---- Post A vs Post B (Raw numbers vs rates)
  { id: "ap1", r: "RATES", type: "mcq", a: "B", pts: 2, t: "Post A: 100K Reach + 1K Profile Visits. Post B: 20K Reach + 800 Profile Visits. Which is more efficient at generating Profile Visits?", opts: ["Post A", "Post B", "Same", "Cannot calculate"], e: "A = 1% Profile Visit Rate; B = 4%. A has more scale, B has more efficiency.", d: "So which post performed better? (It depends on the question.)" },

  // ---- Round 2 — Level 2 (Rates)
  { id: "r2b", r: "2", type: "rg", a: "G", pts: 1, t: "Rates help us compare posts with different reach sizes.", e: "Rates show efficiency relative to the relevant base.", d: "What does the raw number tell us that the rate does not?" },
  { id: "r2d", r: "2", type: "rg", a: "G", pts: 1, t: "A post can have lower scale but higher efficiency.", e: "Post B reached 20K with a 4% Profile Visit Rate; Post A reached 100K with 1%. Smaller scale, higher efficiency.", d: "When would Post A still be the 'better' post?" },
  { id: "r2a", r: "2", type: "rg", a: "R", pts: 1, t: "The post with more Shares is always the better post.", e: "Without a denominator, the objective and context, a larger raw number can mislead.", d: "Which rate would help us compare?" },
  { id: "r2c", r: "2", type: "rg", a: "R", pts: 1, t: "Raw numbers are useless once we calculate rates.", e: "Raw numbers tell scale; rates tell efficiency. Neither replaces the other.", d: "Give one example of scale and one of efficiency." },

  // ---- PULSE Fitness (transfer)
  { id: "ap2", r: "PULSE", type: "mcq", a: "C", pts: 2, t: "PULSE Fitness promotes a Free Trial Session in Stories. Objective: Lead Generation. Best Primary KPI?", opts: ["Reach", "Likes", "Trial Bookings", "Saves"], e: "The objective is a real lead action. Replies / Link Clicks can be secondary or diagnostic.", d: "Which metric here could be Secondary, and which Diagnostic?" },

  // ---- KPI Round — Level 2 → 3
  { id: "r3a", r: "3", type: "rg", a: "R", pts: 1, t: "Every metric should be treated as a KPI.", e: "A KPI is selected because it matters to a specific objective; not every metric is equally important.", d: "Give a metric that matters but is not the Primary KPI." },
  { id: "r3b", r: "3", type: "rg", a: "R", pts: 1, t: "Secondary KPI and Diagnostic Metrics are the same thing.", e: "Secondary KPI = extra indicator of quality / a nearby outcome. Diagnostics = help explain performance.", d: "Name one Secondary KPI and one Diagnostic for a Discovery Reel." },
  { id: "r3c", r: "3", type: "rg", a: "G", pts: 1, t: "A Diagnostic Metric can come from another stage in the journey.", e: "Diagnostics are chosen because they help explain performance, not because they sit in the same stage as the KPI.", d: "Example: which earlier-stage metric could explain weak Website Clicks?" },
  { id: "r3d", r: "3", type: "rg", a: "R", pts: 1, t: "If the CTA is “Visit our profile,” Website Clicks should automatically be the Primary KPI.", e: "The KPI should follow the intended action. With a profile CTA, Profile Visit Rate fits the job — not an arbitrary deeper metric.", d: "When would Website Click Rate become the right Primary KPI?" },

  // ---- QUICKBITE (transfer)
  { id: "ap3", r: "QB", type: "mcq", a: "C", pts: 3, t: "QUICKBITE Stories: first-frame views high, completion low, replies low, order clicks very low. Where is the first visible drop-off?", opts: ["Business Action", "Intent", "Attention / Consumption", "Discovery"], e: "People start the sequence but don't continue — the earliest visible weakness is consumption. Don't jump straight to checkout friction.", d: "What could cause it? (sequence length, continuation, relevance, offer clarity)" },

  // ---- Round 4 — Level 3
  { id: "r4b", r: "4", type: "rg", a: "G", pts: 1, t: "High Profile Visits + Low Website Clicks may indicate a problem after the content.", e: "The content created curiosity, but the next step may be weak: profile, CTA, offer, or path.", d: "Where is the likely first drop-off?" },
  { id: "r4a", r: "4", type: "rg", a: "R", pts: 1, t: "High Reach + Low Retention proves the algorithm is the problem.", e: "The pattern points to an attention/content issue first — and diagnosis is still a hypothesis, not proof.", d: "Which content factors would you inspect first?" },
  { id: "r4c", r: "4", type: "rg", a: "R", pts: 1, t: "If the Primary KPI misses target, changing the Topic should be the first action.", e: "A missed target needs diagnosis before changing the topic.", d: "Which supporting metrics would you read first?" },
  { id: "r4d", r: "4", type: "rg", a: "G", pts: 1, t: "Strong downstream Intent can coexist with weak top-of-funnel efficiency.", e: "Stages can perform differently: few people may be reached efficiently, yet those reached move strongly toward intent.", d: "In that case, what would you try to improve first?" },

  // ---- VOLT (transfer)
  { id: "ap4", r: "VOLT", type: "mcq", a: "C", pts: 3, t: "VOLT comparison carousel: high Saves & Shares, low Product Page Clicks. Which is the INSIGHT (not a hypothesis)?", opts: ["The CTA is too weak", "The audience dislikes the product", "Comparison content creates reference/share value but weak product exploration", "The landing page is broken"], e: "C describes a meaningful pattern supported by the data without claiming the cause. A, B and D are hypotheses until we have more evidence.", d: "How would you test hypothesis A?" },

  // ---- Final
  { id: "fin", r: "F", type: "rg", a: "R", pts: 1, t: "Analytics is about reporting what happened.", e: "Analytics is about understanding what happened so we can decide what to do next.", d: "Complete the sentence: analytics should end with…" },

  // ---- Bonus quiz — Leveled Question Bank
  { id: "b01", r: "BANK", type: "mcq", a: "B", pts: 1, t: "Which metric best represents unique people/accounts reached?", opts: ["Impressions", "Reach", "Saves", "DMs"], e: "Reach counts unique people/accounts reached; Impressions count total appearances.", d: "" },
  { id: "b02", r: "BANK", type: "mcq", a: "C", pts: 1, t: "Which behavior is closest to a Save?", opts: ["I liked it", "I want to see more from this account", "I may need this later", "I want to buy now"], e: "Saves are a utility / reference behavior.", d: "" },
  { id: "b03", r: "BANK", type: "mcq", a: "A", pts: 1, t: "Which is the most direct attention metric for a Reel?", opts: ["Retention", "Profile Visits", "Qualified Leads", "Followers"], e: "Retention directly reflects continued video viewing.", d: "" },
  { id: "b04", r: "BANK", type: "mcq", a: "B", pts: 2, t: "Morning Club publishes an Office Breakfast Checklist. Objective: Utility. Best Primary KPI?", opts: ["Likes", "Save Rate", "Followers", "DMs"], e: "The job is to be useful enough to return to.", d: "" },
  { id: "b05", r: "BANK", type: "mcq", a: "B", pts: 2, t: "A Carousel has good Reach but weak Saves and Shares. What should you inspect first?", opts: ["Video Retention", "Value / structure", "Sales follow-up", "Follower count"], e: "For a carousel, weak value/share behavior is more relevant than video retention.", d: "" },
  { id: "b06", r: "BANK", type: "mcq", a: "B", pts: 2, t: "Which statement is correct?", opts: ["KPI = 4% and Target = Website Click Rate", "KPI = Website Click Rate and Target = 4%", "KPI and Target are the same", "Target is always a benchmark"], e: "KPI is what you measure; Target is the value you want to reach.", d: "" },
  { id: "b07", r: "BANK", type: "mcq", a: "B", pts: 3, t: "A subscription post gets high Profile Visits but low Website Clicks. Objective = Consideration. The CTA asks users to visit the website. Which Primary KPI fits?", opts: ["Profile Visit Rate", "Website Click Rate", "Likes", "Reach"], e: "The intended next step is website exploration, so the KPI should match that action.", d: "" },
  { id: "b08", r: "BANK", type: "mcq", a: "B", pts: 3, t: "Primary KPI misses target, but Secondary KPI and Intent signals are strong. What should you do FIRST?", opts: ["Change the topic immediately", "Diagnose the gap using supporting metrics", "Boost the post", "Delete it"], e: "A missed KPI does not tell you the cause.", d: "" },
  { id: "b09", r: "BANK", type: "rg", a: "R", pts: 3, t: "A business focused on sales should make Conversion the Primary KPI for every post.", e: "The business goal sets priority, but each content piece can have a different objective and KPI.", d: "" },
];

const SAY = [
  { id: "A", pat: [["Reach", "up"], ["Retention", "down"]], human: "A lot of people saw us, but we could not keep them.", humanAr: "وصلنا لناس كتير، بس ماقدرناش نخليهم يكملوا.", meaning: "Distribution is strong; Attention is weak.", action: "Review opening / hook / pacing / relevance.", variant: "Carousel version: Reach good + Saves/Shares weak → value/structure issue?" },
  { id: "B", pat: [["Profile Visits", "up"], ["Website Clicks", "down"]], human: "They checked us out, but did not take the next step.", humanAr: "دخلوا يعرفوا إحنا مين، بس ماخدوش الخطوة اللي بعدها.", meaning: "Curiosity exists; the next-step path is weak.", action: "Review profile clarity / CTA / offer / link path.", variant: "Stories version: replies high + booking clicks low → conversation exists, action path weak." },
  { id: "C", pat: [["Likes", "up"], ["Qualified Leads", "zero"]], human: "People liked the content, but it did not create business movement.", humanAr: "الناس حبت المحتوى، بس محدش اتحرك Business-wise.", meaning: "Engagement exists; Business Action is weak.", action: "Check objective, audience quality, CTA and lead path.", variant: "Shares high + follows low → content travels but brand connection may be weak." },
];
const SAY_RUBRIC = [["h", "Human translation", 2], ["m", "Analysis", 2], ["a", "First action", 1]];

const BOXES = [
  { id: "A", level: "Easy", format: "Reel", content: "“Why your breakfast makes you hungry again by 11 AM”", objective: "Discovery",
    metrics: ["Reach", "Likes", "Non-follower Reach", "Shares", "Retention", "Profile Visits"], trap: "Likes",
    primary: "Non-follower Reach / Rate", secondary: "Share Rate", diag: "Retention · hook / packaging as factors",
    why: "The objective is reaching NEW relevant people; likes are not the closest proof.",
    ex: { p: ["Non-follower Reach"], s: ["Shares"], d: ["Retention"] } },
  { id: "B", level: "Medium", format: "Carousel", content: "“Office Breakfast Checklist”", objective: "Utility",
    metrics: ["Reach", "Likes", "Saves", "Shares", "Profile Visits", "Comments"], trap: "Likes",
    primary: "Save Rate", secondary: "Share Rate", diag: "Profile Visits / Comments can help diagnose",
    why: "The content job is reference value — useful enough to return to.",
    ex: { p: ["Saves"], s: ["Shares"], d: ["Profile Visits", "Comments"] } },
  { id: "C", level: "Medium+", format: "Carousel / Static", content: "“Daily ordering vs Monthly Breakfast Plan — which costs less?”", objective: "Consideration",
    metrics: ["Reach", "Saves", "Profile Visits", "Website Clicks", "DMs", "Likes"], trap: "Likes",
    primary: "Depends on the CTA: Profile Visit Rate or Website Click Rate", secondary: "Profile Visits / DMs", diag: "CTA · offer clarity · profile path",
    why: "Consideration should show deeper exploration. Define the intended next step first.",
    ex: { p: ["Website Clicks", "Profile Visits"], s: ["Profile Visits", "DMs"], d: [] } },
  { id: "D", level: "Hard", format: "Stories", content: "“Breakfast catering for teams of 10–50”", objective: "Lead Generation",
    metrics: ["Story Views", "Replies", "Link Clicks", "Total DMs", "Qualified Enquiries", "Bookings"], trap: "Total DMs",
    primary: "Qualified Enquiries / Bookings", secondary: "Link Clicks / DMs", diag: "Offer clarity · qualification · booking friction",
    why: "The objective is real sales-opportunity creation, not just conversations.",
    ex: { p: ["Qualified Enquiries", "Bookings"], s: ["Link Clicks", "Total DMs"], d: [] } },
];
const BOX_RUBRIC = [["p", "Primary KPI (0 if trap picked)", 4], ["s", "Secondary KPI", 2], ["d", "Diagnostic", 2], ["w", "Why", 2]];

const BOSS_CASE = {
  brand: "Morning Club", offer: "Monthly Breakfast Subscription", objective: "Consideration",
  kpi: "Website Click Rate", target: 4, actual: 2.1,
  data: [["Reach", "HIGH", "hi"], ["Saves", "HIGH", "hi"], ["Profile Visits", "HIGH", "hi"], ["Comments", "MANY PRICE QUESTIONS", "md"], ["Website Clicks", "LOW", "lo"], ["DMs", "MEDIUM", "md"]],
};
const DROP_OPTIONS = ["Reach → Attention / Consumption", "Attention → Engagement", "Engagement → Profile Visit", "Profile Visit → Website Click", "Website Click → Subscription"];
const BOSS_Q = [
  ["Did the KPI hit target?", "No. 2.1% vs 4% target → gap of -1.9 percentage points.", 2, "yesno"],
  ["Where is the first visible drop-off?", "After Profile Visit and before Website Click.", 4, "drop"],
  ["What is your diagnosis?", "Hypotheses: CTA, offer clarity, pricing clarity, profile / link path friction.", 5, "text"],
  ["What evidence supports it?", "Saves and Profile Visits are high (curiosity/consideration) while Website Clicks are low; many comments ask about price.", 5, "text"],
  ["What is the insight?", "The content creates curiosity and consideration, but the next step toward the subscription is not strong enough.", 4, "text"],
  ["What action would you take?", "Improve CTA, offer / pricing clarity and the profile/link path — don't change the topic automatically.", 5, "text"],
  ["What would you test next?", "CTA A/B, offer framing, price explanation, subscription comparison, link path.", 5, "text"],
];

const MAX = { say: 15, box: 10, boss: 30 };

module.exports = { TEAMS, DEFAULT_TEAMS, EMOJIS, ROUNDS, RG, SAY, SAY_RUBRIC, BOXES, BOX_RUBRIC, BOSS_CASE, BOSS_Q, DROP_OPTIONS, MAX };
