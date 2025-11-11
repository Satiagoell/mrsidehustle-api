// api/ideas.ts
// Vercel Node.js Serverless Function (Project preset: “Other”; no build step)
// Make sure the Vercel project has OPENAI_API_KEY set in Environment Variables.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ⚠️ In production, replace * with your deployed frontend origin
const ALLOW_ORIGIN = "*";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // --- Parse & validate body ---
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

    // --- Prompt content ---
    const system = `You are Mr.SideHustle, an energetic strategist who creates realistic, upbeat side-hustle ideas.
- Base suggestions on real tools/platforms/market practices (e.g., Stripe, Gumroad, Shopify, Fiverr, Canva, Airtable).
- Encourage action and keep copy concise and mobile-friendly.
- Output ONLY valid JSON that matches the provided JSON Schema.`;

    const userProfile = {
      age,
      location,
      strengths,
      enjoys,
      skillset,
      hoursPerWeek,
      seedBudget,
    };

    const prompt = `User profile (verbatim JSON):
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

Avoid guarantees. Use reasonable assumptions and well-known tools/services where relevant. Keep everything concise.`;

    // --- OpenAI Responses API with Structured Outputs (JSON Schema) ---
    const ai = await client.responses.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      // Structured output: enforce JSON via schema (new API: text.format.json_schema)
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
        { role: "user", content: prompt }
      ]
    });

    // --- Parse model output ---
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

    // --- Lightweight validation ---
    if (!Array.isArray(data?.ideas) || data.ideas.length !== 3) {
      return res.status(500).json({
        error: "Invalid model output",
        detail: "Expected `ideas` array with exactly 3 items."
      });
    }

    // Optional: final clamp on difficult/worthiness ranges
    for (const idea of data.ideas) {
      idea.difficulty = Math.min(10, Math.max(1, Number(idea.difficulty) || 1));
      idea.worthiness = Math.min(10, Math.max(1, Number(idea.worthiness) || 1));
    }

    return res.status(200).json(data);
  } catch (err: any) {
    return res.status(500).json({
      error: "FUNCTION_INVOCATION_FAILED",
      detail: err?.message || String(err)
    });
  }
}
