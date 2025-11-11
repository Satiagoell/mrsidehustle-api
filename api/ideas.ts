import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

// No config field needed; the project is Node runtime by default

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS (adjust origin once you know your frontend domain)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Vercel Node functions provide req.body (string or object)
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { age, location, strengths, enjoys, skillset, hoursPerWeek, seedBudget } = body;

    if (
      age == null || !location || !strengths || !enjoys || !skillset ||
      hoursPerWeek == null || seedBudget == null
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // --- Uncomment this stub to smoke-test without OpenAI first ---
    // return res.status(200).json({
    //   ideas: Array.from({ length: 3 }).map((_, i) => ({
    //     title: `Stub Idea ${i + 1}`,
    //     tagline: "Upbeat and realistic",
    //     sections: Array.from({ length: 10 }).map(() => ({ heading: "H", body: "B" })),
    //     difficulty: 4,
    //     worthiness: 8,
    //     firstThreeSteps: ["Step 1", "Step 2", "Step 3"]
    //   }))
    // });

    const system = `You are Mr.SideHustle, an energetic strategist who creates realistic, upbeat side-hustle ideas.
- Use real tools/platforms where relevant.
- Encourage action and include first steps.
- Output ONLY valid JSON with exactly 3 ideas, each with 10 sections in the required order.`;

    const user = { age, location, strengths, enjoys, skillset, hoursPerWeek, seedBudget };

    const prompt = `User profile:\n${JSON.stringify(user, null, 2)}
Return JSON with:
- ideas: [3 items]
- each idea has: title, tagline, sections(10 in the required order), difficulty, worthiness, firstThreeSteps(3)
Required section headings (exact order):
1 The customer problem
2 The product/service
3 Ideal customer
4 What must be built
5 Revenue potential
6 Pricing strategy
7 Finding customers
8 Time commitment
9 Difficulty (1–10): short reason
10 Worthiness (1–10): short reason
Keep it concise, mobile-friendly, and realistic.`;

    const ai = await client.responses.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      response_format: { type: "json_object" },
      input: [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ]
    });

    const text = ai.output_text || "";
    const data = JSON.parse(text);

    if (!Array.isArray(data?.ideas) || data.ideas.length !== 3) {
      return res.status(500).json({ error: "Invalid model output" });
    }

    return res.status(200).json(data);
  } catch (err: any) {
    // Surface a friendly JSON error (and not an HTML crash page)
    return res.status(500).json({
      error: "FUNCTION_INVOCATION_FAILED",
      detail: err?.message || String(err)
    });
  }
}
