// api/ideas.ts
// Vercel Node.js serverless function (Framework preset: "Other"; no build step)
// Make sure your Vercel project has OPENAI_API_KEY set in Environment Variables.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Optional: tighten this to your frontend origin once deployed (e.g., https://mrsidehustle-web.vercel.app)
const ALLOW_ORIGIN = "*";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Parse JSON body safely
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { age, location, strengths, enjoys, skillset, hoursPerWeek, seedBudget } = body;

    // Basic validation
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

    // === Prompting ===
    const system = `You are Mr.SideHustle, an energetic strategist who creates realistic, upbeat side-hustle ideas.
- Base suggestions on real tools/platforms/market practices (e.g., Stripe, Gumroad, Shopify, Fiverr, Canva, Airtable).
- Be encouraging and action-oriented.
- Output must be concise and mobile-friendly.
- Output ONLY valid JSON matching the provided schema.`;

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

Each idea also includes:
- difficulty (integer 1–10)
- worthiness (integer 1–10)
- firstThreeSteps (array of exactly 3 short, concrete steps)

Avoid guarantees. Use reasonable assumptions and well-known tools or services where relevant. Keep copy tight and scannable.`;

    // === OpenAI Responses API with Structured Outputs (JSON Schema) ===
    const ai = await client.responses.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      // Structured output: enforce JSON via schema
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
                  required: ["title", "tagline", "sections", "difficulty", "worthiness", "firstThreeSteps"],
                  properties: {
                    title: { type: "string" },
                    tagline: { type: "string" },
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
                          body: { type: "string" }
                        }
                      }
                    },
                    difficulty: { type: "integer", minimum: 1, maximum: 10 },
                    worthiness: { type: "integer", minimum: 1, maximum: 10 },
                    firstThreeSteps: {
                      type: "array",
                      minItems: 3,
                      maxItems: 3,
                      items: { type: "string" }
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

    // Extract JSON text
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

    // Lightweight validation
    if (!Array.isArray(data?.ideas) || data.ideas.length !== 3) {
      return res.status(500).json({
        error: "Invalid model output",
        detail: "Expected `ideas` array with exactly 3 items."
      });
    }

    return res.status(200).json(data);
  } catch (err: any) {
    return res.status(500).json({
      error: "FUNCTION_INVOCATION_FAILED",
      detail: err?.message || String(err)
    });
  }
}

