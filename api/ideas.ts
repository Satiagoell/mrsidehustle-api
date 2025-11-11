import OpenAI from "openai";

export const config = { runtime: "nodejs20.x" };

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const { age, location, strengths, enjoys, skillset, hoursPerWeek, seedBudget } = await req.json();
  if (age == null || !location || !strengths || !enjoys || !skillset ||
      hoursPerWeek == null || seedBudget == null) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
  }

  const system = `You are Mr.SideHustle, an energetic strategist who creates realistic, upbeat side-hustle ideas.
- Use real tools/platforms where relevant.
- Encourage action and include first steps.
- Output ONLY valid JSON with exactly 3 ideas, each with 10 sections in the required order.`;

  const user = { age, location, strengths, enjoys, skillset, hoursPerWeek, seedBudget };

  const prompt = `User profile:\\n${JSON.stringify(user, null, 2)}
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

  try {
    const r = await client.responses.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      response_format: { type: "json_object" },
      input: [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ]
    });

    const text = r.output_text || "";
    const data = JSON.parse(text);
    if (!Array.isArray(data?.ideas) || data.ideas.length !== 3) {
      throw new Error("Invalid model output");
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // For production, replace * with your frontend origin
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: "Failed to generate ideas", detail: e?.message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
}
