// api/ideas.ts
// Vercel Node.js Serverless Function (Project preset: “Other”; no build step)
// Make sure the Vercel project has OPENAI_API_KEY set in Environment Variables.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ⚠️ In production, replace * with your deployed frontend origin
const ALLOW_ORIGIN = "*";

/* ---------------------------- helpers: quality ---------------------------- */

function sanitizeText(s: string): string {
  if (!s) return s;
  // Remove emojis & non-basic symbols
  s = s.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, "");
  // Trim/compress spaces
  s = s.replace(/\s+/g, " ").trim();
  // Ban hype words
  const banned = [
    /guaranteed/gi, /effortless/gi, /overnight/gi, /get\s*rich/gi,
    /no\s*risk/gi, /passive\s*income/gi, /100%\s*success/gi,
    /secret\s*hack/gi, /viral\s*overnight/gi
  ];
  for (const rx of banned) s = s.replace(rx, "");
  // Cap to ~3 sentences for scannability
  const sentences = s.split(/(?<=\.)\s+/).slice(0, 3);
  return sentences.join(" ").trim();
}

function clampIdea(idea: any) {
  idea.title = sanitizeText(String(idea.title || "")).slice(0, 70);
  idea.tagline = sanitizeText(String(idea.tagline || "")).slice(0, 120);
  idea.difficulty = Math.min(10, Math.max(1, Number(idea.difficulty) || 1));
  idea.worthiness = Math.min(10, Math.max(1, Number(idea.worthiness) || 1));

  if (Array.isArray(idea.sections)) {
    idea.sections = idea.sections.map((sec: any) => ({
      heading: sanitizeText(String(sec?.heading || "")),
      body: sanitizeText(String(sec?.body || "")).slice(0, 550)
    })).slice(0, 10);
  }
  if (Array.isArray(idea.firstThreeSteps)) {
    idea.firstThreeSteps = idea.firstThreeSteps.map((s: string) =>
      sanitizeText(String(s || "")).slice(0, 140)
    ).slice(0, 3);
  }
  if (idea?.insights) {
    const ins = idea.insights;
    ins.feasibility = sanitizeText(String(ins.feasibility || "")).slice(0, 240);
    if (ins.numbers) {
      const n = ins.numbers;
      for (const k of ["price","cogs","marginPct","startupCost","monthlyCost"]) {
        if (typeof n[k] === "number") n[k] = Number(n[k].toFixed(2));
      }
      if (typeof n.breakEvenCustomers === "number") {
        n.breakEvenCustomers = Math.max(0, Math.round(n.breakEvenCustomers));
      }
    }
    if (Array.isArray(ins.validation)) ins.validation = ins.validation.map(sanitizeText).slice(0,3);
    if (Array.isArray(ins.risks)) ins.risks = ins.risks.map(sanitizeText).slice(0,3);
    if (Array.isArray(ins.tooling)) {
      ins.tooling = ins.tooling.map((t: any) => ({
        name: sanitizeText(String(t?.name || "")).slice(0, 40),
        use: sanitizeText(String(t?.use || "")).slice(0, 120),
        estMonthly: typeof t?.estMonthly === "number" ? Number(t.estMonthly.toFixed(2)) : 0
      })).slice(0, 6);
    }
    if (ins.kpis) {
      ins.kpis.week1 = sanitizeText(String(ins.kpis.week1 || "")).slice(0, 120);
      ins.kpis.month1 = sanitizeText(String(ins.kpis.month1 || "")).slice(0, 140);
      ins.kpis.quarter1 = sanitizeText(String(ins.kpis.quarter1 || "")).slice(0, 160);
    }
  }
  return idea;
}

function isTooSimilar(a: string, b: string): boolean {
  a = (a || "").toLowerCase(); b = (b || "").toLowerCase();
  const tokensA = new Set(a.split(/\W+/).filter(Boolean));
  const tokensB = new Set(b.split(/\W+/).filter(Boolean));
  let overlap = 0;
  for (const t of tokensA) if (tokensB.has(t)) overlap++;
  const denom = Math.max(1, Math.min(tokensA.size, tokensB.size));
  return overlap / denom > 0.6;
}

function ensureDistinct(ideas: any[]) {
  for (let i=0;i<ideas.length;i++){
    for (let j=i+1;j<ideas.length;j++){
      if (isTooSimilar(ideas[i].title, ideas[j].title) ||
          isTooSimilar(ideas[i].sections?.[1]?.body || "", ideas[j].sections?.[1]?.body || "")) {
        // minimally tweak title to prevent near-duplication
        ideas[j].title = (ideas[j].title || "Idea") + " — Alt";
      }
    }
  }
  return ideas;
}

/* -------------------------------- handler -------------------------------- */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Parse & validate
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { age, location, strengths, enjoys, skillset, hoursPerWeek, seedBudget } = body;

    if (
      age == null ||
      !location ||
      !strengths ||
      !enjoys ||
      !skillset ||
      hoursPerWeek == null ||
      seedBudget == null
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Locale hint (EU vs non-EU)
    const isEU = /\b(AT|BE|BG|HR|CY|CZ|DK|EE|FI|FR|DE|GR|HU|IE|IT|LV|LT|LU|MT|NL|PL|PT|RO|SK|SI|ES|SE|EU|Netherlands|Germany|France|Spain|Italy|Belgium|Portugal|Ireland|Austria|Poland|Czech|Sweden|Finland|Denmark|Greece)\b/i
      .test(String(location));
    const localeHint = isEU
      ? "Use euros (€) and EU/GDPR-friendly examples where relevant."
      : "Use local currency if obvious; otherwise USD.";

    // Prompt
    const system = `You are Mr.SideHustle, an energetic strategist who creates realistic, upbeat side-hustle ideas.
- Base suggestions on real tools/platforms/market practices (e.g., Stripe, Gumroad, Shopify, Fiverr, Canva, Airtable).
- Encourage action and keep copy concise and mobile-friendly.
- Output ONLY valid JSON that matches the provided JSON Schema.`;

    const userProfile = { age, location, strengths, enjoys, skillset, hoursPerWeek, seedBudget };

    const qualityRubric = `Quality rubric (apply before you output):
- Uniqueness: the 3 ideas must be clearly different in product, customer, and acquisition.
- Clarity: each section should be 1–3 short sentences, plain language, no jargon.
- Grounding: include real, commonly-used tools/services and plausible costs; avoid niche/unverified tools.
- No hype: avoid words like “guaranteed, effortless, passive income, overnight, get rich”; no emojis.
- Numbers: show price/COGS/margin/breakeven with simple round numbers (0–2 decimals max).
- Locale: ${isEU ? "prefer € and EU-friendly examples" : "use local currency if obvious; else USD"}.
- Actionable: firstThreeSteps are do-today steps with verbs.`;

    const prompt = `${localeHint}

User profile (verbatim JSON):
${JSON.stringify(userProfile, null, 2)}

Create exactly 3 side-hustle ideas tailored to this user. Keep tone positive and realistic.

For each idea, include 10 sections with these exact headings and order:
1) The customer problem
2) The product/service
3) Ideal customer
4) What must be built
5) Revenue potential
6) Pricing strategy
7) Finding customers
8) Time commitment
9) Difficulty (1–10): short reason
10) Worthiness (1–10): short reason

Also include an "insights" object per idea with:
- feasibility: time-to-first-$ estimate & quick take (<= 240 chars).
- numbers: price, cogs, marginPct, breakEvenCustomers, startupCost, monthlyCost (ballpark).
- validation: 3 tiny experiments to prove demand.
- risks: top 3 risks in short phrases.
- tooling: 2–6 tools with purpose and estimated monthly cost.
- kpis: week1, month1, quarter1 targets (one-liners).

Before you produce JSON, run this silent checklist internally:
- [ ] 3 distinct ideas (no overlapping titles or nearly identical products).
- [ ] Each section ≤ 3 short sentences, no hype words, no emojis.
- [ ] Include realistic tools/costs; avoid guarantees.
- [ ] Difficulty/Worthiness 1–10 with a brief reason.
- [ ] Numbers present and rounded sensibly (0–2 decimals).
- [ ] First 3 steps are do-today steps.

Only after passing this, output the final JSON that matches the schema.`;

    // OpenAI Responses API with Structured Outputs (JSON Schema)
    const ai = await client.responses.create({
      model: "gpt-4o-mini",
      temperature: 0.5,
      top_p: 0.9,
      text: {
        format: {
          type: "json_schema",
          name: "mr_sidehustle_canvas",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["ideas"],
            properties: {
              ideas: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "title",
                    "tagline",
                    "sections",
                    "difficulty",
                    "worthiness",
                    "firstThreeSteps",
                    "insights"
                  ],
                  properties: {
                    title: { type: "string", maxLength: 70 },
                    tagline: { type: "string", maxLength: 120 },
                    sections: {
                      type: "array",
                      minItems: 10,
                      maxItems: 10,
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["heading", "body"],
                        properties: {
                          heading: { type: "string" },
                          body: { type: "string", maxLength: 550 }
                        }
                      }
                    },
                    difficulty: { type: "integer", minimum: 1, maximum: 10 },
                    worthiness: { type: "integer", minimum: 1, maximum: 10 },
                    firstThreeSteps: {
                      type: "array",
                      minItems: 3,
                      maxItems: 3,
                      items: { type: "string", maxLength: 140 }
                    },
                    insights: {
                      type: "object",
                      additionalProperties: false,
                      required: ["feasibility","numbers","validation","risks","tooling","kpis"],
                      properties: {
                        feasibility: { type: "string", maxLength: 240 },
                        numbers: {
                          type: "object",
                          additionalProperties: false,
                          required: ["price","cogs","marginPct","breakEvenCustomers","startupCost","monthlyCost"],
                          properties: {
                            price: { type: "number" },
                            cogs: { type: "number" },
                            marginPct: { type: "number" },
                            breakEvenCustomers: { type: "integer" },
                            startupCost: { type: "number" },
                            monthlyCost: { type: "number" }
                          }
                        },
                        validation: {
                          type: "array",
                          minItems: 3,
                          maxItems: 3,
                          items: { type: "string", maxLength: 140 }
                        },
                        risks: {
                          type: "array",
                          minItems: 3,
                          maxItems: 3,
                          items: { type: "string", maxLength: 140 }
                        },
                        tooling: {
                          type: "array",
                          minItems: 2,
                          maxItems: 6,
                          items: {
                            type: "object",
                            additionalProperties: false,
                            required: ["name","use","estMonthly"],
                            properties: {
                              name: { type: "string", maxLength: 40 },
                              use: { type: "string", maxLength: 120 },
                              estMonthly: { type: "number" }
                            }
                          }
                        },
                        kpis: {
                          type: "object",
                          additionalProperties: false,
                          required: ["week1","month1","quarter1"],
                          properties: {
                            week1: { type: "string", maxLength: 120 },
                            month1: { type: "string", maxLength: 140 },
                            quarter1: { type: "string", maxLength: 160 }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      input: [
        { role: "system", content: system },
        { role: "user", content: qualityRubric },
        { role: "user", content: prompt }
      ]
    });

    // Parse model output
    const text = ai.output_text || "";
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: "Invalid model output (not JSON)",
        detail: text.slice(0, 500)
      });
    }

    // Validate shape and apply final clamps
    if (!Array.isArray(data?.ideas) || data.ideas.length !== 3) {
      return res.status(500).json({
        error: "Invalid model output",
        detail: "Expected `ideas` array with exactly 3 items."
      });
    }

    data.ideas = data.ideas.map(clampIdea);
    data.ideas = ensureDistinct(data.ideas);

    return res.status(200).json(data);
  } catch (err: any) {
    return res.status(500).json({
      error: "FUNCTION_INVOCATION_FAILED",
      detail: err?.message || String(err)
    });
  }
}
