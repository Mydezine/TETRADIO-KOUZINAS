// Supabase Edge Function "import-recipe".
// Turns a photo, PDF or pasted text of a recipe into structured recipes using Claude.
// Needs the secret ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets).
import Anthropic from "npm:@anthropic-ai/sdk@1.0.0";

const CATS = ["Ορεκτικά", "Σαλάτες", "Σούπες", "Ζυμαρικά & Ριζότο", "Κυρίως κρεατικά", "Ψάρια & Θαλασσινά", "Λαχανικά & Συνοδευτικά", "Σάλτσες & Βάσεις", "Γλυκά", "Αρτοποιία", "Ποτά & Κοκτέιλ", "Άλλο"];
const ALLERGENS = ["Γλουτένη", "Καρκινοειδή", "Αυγά", "Ψάρια", "Αράπικα φιστίκια", "Σόγια", "Γάλα", "Ξηροί καρποί", "Σέλινο", "Μουστάρδα", "Σουσάμι", "Θειώδη", "Λούπινο", "Μαλάκια"];
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BASE64 = 12_000_000; // ~9 MB file

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["recipes"],
  properties: {
    recipes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "category", "yield_qty", "yield_unit", "prep_min", "cook_min", "ingredients", "steps", "allergens", "notes"],
        properties: {
          title: { type: "string" },
          category: { type: "string", enum: CATS },
          yield_qty: { type: ["number", "null"] },
          yield_unit: { type: "string" },
          prep_min: { type: ["integer", "null"] },
          cook_min: { type: ["integer", "null"] },
          ingredients: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["qty", "unit", "name"],
              properties: { qty: { type: ["number", "null"] }, unit: { type: "string" }, name: { type: "string" } },
            },
          },
          steps: { type: "array", items: { type: "string" } },
          allergens: { type: "array", items: { type: "string", enum: ALLERGENS } },
          notes: { type: "string" },
        },
      },
    },
  },
};

const SYSTEM = `You convert professional chefs' recipes into structured data for a Greek recipe notebook app.
The input may be a photo of a handwritten or printed page, a PDF, or pasted text, in Greek or another language.

- Extract every recipe in the input. If there is no recipe, return an empty "recipes" array.
- Keep the chef's own wording and language. Do not translate, embellish or invent ingredients, quantities or steps.
- Fix only obvious reading or OCR mistakes.
- Ingredients: one per entry. qty is a number (convert fractions like 1/2 to 0.5, decimal commas to dots) or null when there is no quantity ("αλάτι", "λίγο λάδι"). unit is the unit as written, normalised to short forms when clear (g, kg, ml, l, τεμ, κ.σ., κ.γ., πρέζα); empty string when there is none. name is the ingredient with any preparation notes ("κρεμμύδι, ψιλοκομμένο").
- Sub-recipes inside one recipe (e.g. "Για τη σάλτσα:") stay in the same recipe: put the section name in the ingredient name or as a step.
- steps: one action per entry, without numbering.
- yield_qty / yield_unit: portions or quantity the recipe makes ("10", "μερίδες"), null and "" if not stated.
- prep_min / cook_min: minutes if stated or clearly implied, else null.
- category: the closest one from the list.
- allergens: only those clearly present in the ingredients (EU 14 allergens).
- notes: tips, plating, storage, suppliers or anything else the chef wrote that is not an ingredient or step. Empty string if none.
- title: the dish name as written. If missing, give a short descriptive name in the input's language.`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);

  // Only signed-in users of this project may use it.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? "";
  if (!supabaseUrl || !auth.startsWith("Bearer ")) return reply({ error: "not_signed_in" }, 401);
  const who = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { authorization: auth, apikey } });
  if (!who.ok) return reply({ error: "not_signed_in" }, 401);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return reply({ error: "not_configured" }, 503);

  let input: { text?: string; file?: { data: string; media_type: string } };
  try { input = await req.json(); } catch { return reply({ error: "bad_request" }, 400); }

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.file) {
    const { data, media_type } = input.file;
    if (typeof data !== "string" || data.length > MAX_BASE64) return reply({ error: "too_large" }, 413);
    if (media_type === "application/pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
    } else if (IMAGE_TYPES.includes(media_type)) {
      content.push({ type: "image", source: { type: "base64", media_type: media_type as "image/jpeg", data } });
    } else return reply({ error: "unsupported_file" }, 415);
  }
  const text = typeof input.text === "string" ? input.text.trim().slice(0, 100_000) : "";
  if (text) content.push({ type: "text", text: `<recipe_source>\n${text}\n</recipe_source>` });
  if (!content.length) return reply({ error: "empty" }, 400);
  content.push({ type: "text", text: "Extract the recipes from the material above." });

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason === "refusal") return reply({ error: "refused" }, 422);
    if (response.stop_reason === "max_tokens") return reply({ error: "too_long" }, 422);
    const out = response.content.find((b) => b.type === "text");
    if (!out || out.type !== "text") return reply({ error: "no_result" }, 502);
    const parsed = JSON.parse(out.text);
    return reply({ recipes: Array.isArray(parsed.recipes) ? parsed.recipes : [] });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return reply({ error: "bad_api_key" }, 503);
    if (e instanceof Anthropic.RateLimitError) return reply({ error: "busy" }, 429);
    if (e instanceof Anthropic.BadRequestError) return reply({ error: "bad_input", detail: e.message }, 400);
    if (e instanceof Anthropic.APIError) return reply({ error: "ai_unavailable" }, 502);
    console.error(e);
    return reply({ error: "server_error" }, 500);
  }
});
