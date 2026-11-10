// Supabase Edge Function "send-push": sends Web Push notifications to phones.
// Called by the database (pg_net) when a notification is created. The body carries the
// subscriptions and the VAPID keys, so the function itself holds no secrets.
// With {"generate": true} it returns a new VAPID key pair (used once at setup).
import webpush from "npm:web-push@3.6.7";

type Sub = { endpoint: string; p256dh: string; auth: string; lang: string };

const TEXT: Record<string, Record<string, (p: Record<string, string>) => { title: string; body: string }>> = {
  el: {
    team_join: (p) => ({ title: "Νέο μέλος στην ομάδα", body: `${p.name} μπήκε στην ομάδα «${p.team}».` }),
    team_recipe: (p) => ({ title: `Νέα συνταγή · ${p.team}`, body: p.title }),
    new_chef: (p) => ({ title: "Νέος μάγειρας", body: `${p.email} γράφτηκε στο MyRecipes.gr.` }),
    chef_active: (p) => ({ title: "Μάγειρας online", body: `${p.name} άνοιξε τώρα την εφαρμογή.` }),
  },
  en: {
    team_join: (p) => ({ title: "New team member", body: `${p.name} joined the team “${p.team}”.` }),
    team_recipe: (p) => ({ title: `New recipe · ${p.team}`, body: p.title }),
    new_chef: (p) => ({ title: "New chef", body: `${p.email} signed up to MyRecipes.gr.` }),
    chef_active: (p) => ({ title: "Chef online", body: `${p.name} just opened the app.` }),
  },
};
const APP_URL = "https://mydezine.github.io/TETRADIO-KOUZINAS/";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: { generate?: boolean; send?: boolean; kind?: string; params?: Record<string, string>; vapid?: { pub: string; priv: string }; subs?: Sub[] };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  if (body.generate) return json(webpush.generateVAPIDKeys());

  if (!body.send || !body.vapid?.pub || !body.vapid?.priv || !Array.isArray(body.subs) || !body.kind) return json({ error: "bad_request" }, 400);
  webpush.setVapidDetails(APP_URL, body.vapid.pub, body.vapid.priv);

  const gone: string[] = [];
  let sent = 0;
  await Promise.all(body.subs.map(async (s) => {
    const lang = TEXT[s.lang] ? s.lang : "el";
    const make = TEXT[lang][body.kind!];
    if (!make) return;
    const { title, body: text } = make(body.params ?? {});
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body: text, url: APP_URL, kind: body.kind, params: body.params ?? {} }), { TTL: 86400 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(s.endpoint);
      else console.error("push failed", code);
    }
  }));

  // Forget phones that unsubscribed or reinstalled.
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (gone.length && url && key) {
    const list = gone.map((e) => `"${e.replace(/"/g, '\\"')}"`).join(",");
    await fetch(`${url}/rest/v1/push_subscriptions?endpoint=in.(${encodeURIComponent(list)})`, {
      method: "DELETE", headers: key.startsWith("eyJ") ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key },
    }).catch(() => {});
  }
  return json({ sent, gone: gone.length });
});
