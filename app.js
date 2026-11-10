(() => {
  "use strict";

  const CATS = ["Ορεκτικά", "Σαλάτες", "Σούπες", "Ζυμαρικά & Ριζότο", "Κυρίως κρεατικά", "Ψάρια & Θαλασσινά", "Λαχανικά & Συνοδευτικά", "Σάλτσες & Βάσεις", "Γλυκά", "Αρτοποιία", "Ποτά & Κοκτέιλ", "Άλλο"];
  const ALLERGENS = ["Γλουτένη", "Καρκινοειδή", "Αυγά", "Ψάρια", "Αράπικα φιστίκια", "Σόγια", "Γάλα", "Ξηροί καρποί", "Σέλινο", "Μουστάρδα", "Σουσάμι", "Θειώδη", "Λούπινο", "Μαλάκια"];
  const UNITS = ["g", "gr", "γρ", "γρ.", "kg", "κιλό", "κιλά", "mg", "ml", "l", "lt", "λτ", "cl", "dl", "τεμ", "τεμ.", "τεμάχια", "κ.σ.", "κσ", "κ.γ.", "κγ", "φλ.", "φλιτζάνι", "φλιτζάνια", "πρέζα", "ματσάκι", "ματσάκια", "σκελίδα", "σκελίδες", "φύλλα", "κλωνάρια", "κλωνάρι", "φέτες", "φέτα", "oz", "lb", "tbsp", "tsp", "cup", "pcs"];

  const S = { restaurants: [], recipes: [], sel: "all", q: "", cat: "", view: "list", id: null, scale: null, edit: null, loaded: false, user: null, isAdmin: false, viewing: null, chefs: null, profile: null, prices: {}, teams: [], order: null, orderQ: "", units: "orig", notifs: [], activity: {} };
  try { if (localStorage.getItem("units") === "metric") S.units = "metric"; } catch { /* ignore */ }
  // ---------- language (Greek interface, translated to English through i18n.js) ----------
  let LANG = "el";
  try { LANG = localStorage.getItem("lang") || "el"; } catch { /* ignore */ }
  if (LANG !== "en" || !window.I18N_EN) LANG = "el";
  const LOCALE = LANG === "en" ? "en-GB" : "el-GR";
  document.documentElement.lang = LANG;
  const GREEK = /[\u0370-\u03ff\u1f00-\u1fff]/;
  function trCore(core) {
    const d = window.I18N_EN;
    if (Object.prototype.hasOwnProperty.call(d.exact, core)) return d.exact[core];
    for (const [re, tpl] of d.patterns) {
      const m = core.match(re);
      if (!m) continue;
      const out = tpl.replace(/\$(\d)/g, (_, i) => { const g = m[+i] || ""; return (GREEK.test(g) && trCore(g)) || g; });
      if (out !== core) return out;
    }
    return null;
  }
  function trText(s) {
    if (LANG !== "en" || !s || !GREEK.test(s)) return null;
    const core = s.trim();
    const r = trCore(core);
    return r == null ? null : s.slice(0, s.indexOf(core)) + r + s.slice(s.indexOf(core) + core.length);
  }
  const tr = (s) => trText(s) ?? s;
  function translateTree(root) {
    if (LANG !== "en") return;
    const skip = (el) => el && el.closest && el.closest("textarea, script, style, [translate=no]");
    if (root.nodeType === 3) { if (!skip(root.parentElement)) { const t = trText(root.data); if (t != null && t !== root.data) root.data = t; } return; }
    if (root.nodeType !== 1 || skip(root)) return;
    const els = [root, ...root.querySelectorAll("[placeholder], [aria-label], [title]")];
    els.forEach((el) => ["placeholder", "aria-label", "title"].forEach((a) => {
      const v = el.getAttribute && el.getAttribute(a); const t = v && trText(v); if (t != null && t !== v) el.setAttribute(a, t);
    }));
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { if (skip(n.parentElement)) continue; const t = trText(n.data); if (t != null && t !== n.data) n.data = t; }
  }
  if (LANG === "en") {
    translateTree(document.documentElement);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData") translateTree(m.target);
        else if (m.type === "attributes") translateTree(m.target);
        else m.addedNodes.forEach((n) => translateTree(n));
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "aria-label", "title"] });
  }
  async function setLang(l) {
    try { localStorage.setItem("lang", l); } catch { /* ignore */ }
    LANG = l;
    if (typeof syncPushLang === "function" && S.user) await syncPushLang();
    location.reload();
  }
  const $ = (id) => document.getElementById(id);
  const main = $("main");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = (n, d) => Number(n).toLocaleString(LOCALE, { maximumFractionDigits: d });

  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600); }
  function notice(msg) { const n = $("notice"); n.textContent = msg || ""; n.hidden = !msg; }

  // ---------- Supabase ----------
  const cfg = window.APP_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR-");
  if (!configured || !window.supabase) { $("setupView").hidden = false; return; }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

  // DB rows (snake_case) <-> app objects
  const fromRest = (r) => ({ id: r.id, name: r.name, city: r.city, years: r.years, role: r.role, createdAt: r.created_at });
  const fromRec = (r) => ({
    id: r.id, restaurantId: r.restaurant_id || "", title: r.title, category: r.category,
    yieldQty: r.yield_qty != null ? Number(r.yield_qty) : null, yieldUnit: r.yield_unit, prepMin: r.prep_min, cookMin: r.cook_min,
    ingredients: r.ingredients || [], steps: r.steps || [], allergens: r.allergens || [], notes: r.notes || "", createdAt: r.created_at,
    plate: r.plate || "", platingSteps: r.plating_steps || [], platingPhotoPath: r.plating_photo_path || null,
    components: Array.isArray(r.components) ? r.components : [],
    photoPath: r.photo_path || null, sellPrice: r.sell_price != null ? Number(r.sell_price) : null, shareToken: r.share_token || null,
  });
  const toRec = (d) => ({
    restaurant_id: d.restaurantId || null, title: d.title, category: d.category || "Άλλο",
    yield_qty: d.yieldQty ?? null, yield_unit: d.yieldUnit || "", prep_min: d.prepMin != null ? Math.round(d.prepMin) : null, cook_min: d.cookMin != null ? Math.round(d.cookMin) : null,
    ingredients: d.ingredients || [], steps: d.steps || [], allergens: d.allergens || [], notes: d.notes || "", updated_at: new Date().toISOString(),
    plate: d.plate || "", plating_steps: d.platingSteps || [], components: d.components || [],
  });

  async function loadAll() {
    const team = S.viewing && S.viewing.team ? S.viewing : null;
    const owner = S.viewing && !team ? S.viewing.id : S.user.id;
    const [r, p] = await Promise.all([
      team ? sb.from("restaurants").select("*").eq("id", team.restaurantId) : sb.from("restaurants").select("*").eq("user_id", owner).order("name"),
      team ? sb.from("recipes").select("*").eq("restaurant_id", team.restaurantId).order("title") : sb.from("recipes").select("*").eq("user_id", owner).order("title"),
      loadPrices(owner),
    ]);
    if (r.error || p.error) { notice("Δεν φόρτωσαν οι συνταγές. Έλεγξε τη σύνδεσή σου και ανανέωσε τη σελίδα."); S.loaded = true; render(); return; }
    notice("");
    S.restaurants = r.data.map(fromRest);
    S.recipes = p.data.map(fromRec);
    S.loaded = true;
    if (S.view !== "form") render(); else renderRail();
    signPhotos();
  }
  function check(res) { if (res.error) throw res.error; return res.data; }

  // ---------- ingredient parsing & scaling ----------
  function parseQty(s) {
    s = s.replace(",", ".");
    if (/^\d+\/\d+$/.test(s)) { const [a, b] = s.split("/").map(Number); return b ? a / b : null; }
    if (s === "½") return 0.5; if (s === "¼") return 0.25; if (s === "¾") return 0.75;
    const n = Number(s); return isFinite(n) ? n : null;
  }
  function parseIngredients(text) {
    return text.split("\n").map((l) => l.trim().replace(/^[-•*·▪●]\s*/, "")).filter(Boolean).map((line) => {
      const m = line.match(/^(\d+(?:[.,]\d+)?(?:\/\d+)?|[½¼¾])\s*(.*)$/);
      if (!m) return { qty: null, unit: "", name: line };
      const qty = parseQty(m[1]);
      let rest = m[2].trim(), unit = "";
      const first = rest.split(/\s+/)[0] || "";
      if (UNITS.includes(first.toLowerCase())) { unit = first; rest = rest.slice(first.length).trim(); }
      return { qty, unit, name: rest || line };
    });
  }
  const ingToLine = (i) => [i.qty != null ? String(i.qty).replace(".", ",") : "", i.unit, i.name].filter(Boolean).join(" ");
  function fmtQty(qty, unit) {
    if (qty == null) return { q: "", u: unit || "" };
    let u = unit || "", n = qty; const lu = u.toLowerCase();
    if (["g", "gr", "γρ", "γρ."].includes(lu) && n >= 1000) { n /= 1000; u = "kg"; }
    else if (lu === "ml" && n >= 1000) { n /= 1000; u = "l"; }
    else if (["kg", "κιλό", "κιλά"].includes(lu) && n < 1) { n *= 1000; u = "g"; }
    else if (["l", "lt", "λτ"].includes(lu) && n < 1) { n *= 1000; u = "ml"; }
    const d = n >= 100 ? 0 : n >= 10 ? 1 : 2;
    return { q: nf(n, d), u };
  }
  const restName = (id) => (S.restaurants.find((r) => r.id === id) || {}).name || "Χωρίς εστιατόριο";

  // ---------- rendering ----------
  function renderRail() {
    const counts = {}; S.recipes.forEach((r) => (counts[r.restaurantId || ""] = (counts[r.restaurantId || ""] || 0) + 1));
    let h = `<button class="r ${S.sel === "all" ? "on" : ""}" data-sel="all"><span class="rn">Όλες οι συνταγές</span><span class="rc">${S.recipes.length}</span></button>`;
    S.restaurants.forEach((r) => {
      const meta = [r.role, r.city, r.years].filter(Boolean).join(" · ");
      h += `<button class="r ${S.sel === r.id ? "on" : ""}" data-sel="${esc(r.id)}"><span class="rn">${esc(r.name)}</span><span class="rc">${counts[r.id] || 0}</span>${meta ? `<span class="rm">${esc(meta)}</span>` : ""}</button>`;
    });
    if (counts[""]) h += `<button class="r ${S.sel === "" ? "on" : ""}" data-sel=""><span class="rn">Χωρίς εστιατόριο</span><span class="rc">${counts[""]}</span></button>`;
    $("rail").innerHTML = h;
    const tr = $("teamRail");
    if (tr) {
      tr.hidden = !S.teams.length;
      tr.querySelector(".rail").innerHTML = S.teams.map((t) => `<button class="r ${S.viewing && S.viewing.teamId === t.team_id ? "on" : ""}" data-team="${esc(t.team_id)}"><span class="rn">${esc(t.team_name)}</span><span class="rm">Σεφ: ${esc(t.owner_name || t.owner_email)}</span></button>`).join("");
    }
  }

  function filtered() {
    const q = S.q.trim().toLowerCase();
    return S.recipes.filter((r) => {
      if (S.sel !== "all" && (r.restaurantId || "") !== S.sel) return false;
      if (S.cat && r.category !== S.cat) return false;
      if (!q) return true;
      const hay = [r.title, r.category, r.notes, restName(r.restaurantId), ...(r.ingredients || []).map((i) => i.name)].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  function renderList() {
    const rest = S.restaurants.find((r) => r.id === S.sel);
    const list = filtered();
    let head = "";
    if (rest) {
      const meta = [rest.role, rest.city, rest.years].filter(Boolean).join(" · ");
      head = `<div class="rest-head"><div><h2>${esc(rest.name)}</h2>${meta ? `<p>${esc(meta)}</p>` : ""}</div>
        <div class="sheet-actions"><button class="btn" data-act="team">Ομάδα κουζίνας</button><button class="btn" data-act="edit-rest">Επεξεργασία</button><button class="btn danger" data-act="del-rest">Διαγραφή</button></div></div>`;
    }
    const tools = `<div class="toolbar">
      <input type="search" id="q" placeholder="Αναζήτηση συνταγής ή υλικού…" value="${esc(S.q)}" aria-label="Αναζήτηση">
      <select id="cat" aria-label="Κατηγορία"><option value="">Όλες οι κατηγορίες</option>${CATS.map((c) => `<option ${S.cat === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
    </div>`;
    let body;
    if (!S.loaded) body = `<div class="empty"><h3>Φόρτωση συνταγών…</h3></div>`;
    else if (!S.recipes.length && S.viewing) body = `<div class="empty"><h3>Δεν υπάρχουν ακόμα συνταγές εδώ</h3></div>`;
    else if (!S.recipes.length) body = `<div class="empty"><h3>Δεν έχεις γράψει ακόμα καμία συνταγή</h3>Πρόσθεσε πρώτα τα εστιατόρια που έχεις δουλέψει και μετά γράψε τις συνταγές σου.<br>Οι άλλοι μάγειρες δεν βλέπουν τις συνταγές σου.<br><button class="btn primary" data-act="new">+ Νέα συνταγή</button> <button class="btn" data-act="import">Ανέβασμα έτοιμης συνταγής</button></div>`;
    else if (!list.length) body = `<div class="empty"><h3>Καμία συνταγή εδώ</h3>${S.q || S.cat ? "Δοκίμασε άλλη αναζήτηση ή κατηγορία." : "Δεν υπάρχουν ακόμα συνταγές σε αυτό το εστιατόριο."}<br><button class="btn primary" data-act="new">+ Νέα συνταγή</button></div>`;
    else body = `<div class="grid">${list.map((r) => {
      const t = (r.prepMin || 0) + (r.cookMin || 0);
      return `<button class="card ${r.photoPath ? "has-photo" : ""}" data-open="${esc(r.id)}">
        ${r.photoPath ? `<span class="card-photo">${photoImg(thumbOf(r.photoPath))}</span>` : ""}
        <span class="tag">${esc(r.category || "Άλλο")}</span>
        <h3>${esc(r.title)}</h3>
        <div class="meta">${S.sel === "all" ? `<span>${esc(restName(r.restaurantId))}</span>` : ""}
          ${r.yieldQty ? `<span>Απόδοση <b>${esc(nf(r.yieldQty, 2))} ${esc(r.yieldUnit || "")}</b></span>` : ""}
          ${t ? `<span><b>${t}′</b></span>` : ""}
          <span><b>${(r.ingredients || []).length}</b> υλικά</span></div>
      </button>`;
    }).join("")}</div>`;
    main.innerHTML = head + tools + body;
    const q = $("q");
    q.addEventListener("input", () => { S.q = q.value; const pos = q.selectionStart; renderList(); const nq = $("q"); nq.focus(); nq.setSelectionRange(pos, pos); });
    $("cat").addEventListener("change", (e) => { S.cat = e.target.value; renderList(); });
  }

  // Component recipes shown under the main recipe (as written, not scaled).
  function componentsHtml(r) {
    const comps = (r.components || []).filter((c) => c.name || (c.ingredients || []).length || (c.steps || []).length);
    if (!comps.length) return "";
    return `<section class="components">
      <div class="sec-title"><span>Συνταγές συστατικών</span></div>
      ${comps.map((c) => {
        const st = compStats(c);
        const ings = (c.ingredients || []).map((i) => { const f = showQty(i.qty, i.unit); return `<tr><td class="q">${esc(f.q)}<span>${esc(f.u)}</span></td><td>${esc(i.name)}</td></tr>`; }).join("");
        return `<div class="comp" id="comp-${esc(priceKey(c.name).replace(/\s+/g, "-"))}">
          <h3>${esc(c.name || "")}${st.weight ? ` <small>Παρτίδα ≈ ${esc(fmtBase("m", st.weight).q)} ${esc(fmtBase("m", st.weight).u)}</small>` : ""}</h3>
          <div class="comp-body">
            <div>${ings ? `<table class="ing"><tbody>${ings}</tbody></table>` : ""}</div>
            <div>${(c.steps || []).length ? `<ol class="steps">${c.steps.map((x) => `<li><span>${esc(x)}</span></li>`).join("")}</ol>` : ""}</div>
          </div></div>`;
      }).join("")}
    </section>`;
  }

  // "Στήσιμο πιάτου": serving plate, plating steps and a reference photo.
  function platingHtml(r, photoHtml) {
    const steps = r.platingSteps || [];
    if (!r.plate && !steps.length && !photoHtml) return "";
    return `<section class="plating">
      <div class="sec-title"><span>Στήσιμο πιάτου</span></div>
      <div class="plating-grid">
        ${photoHtml ? `<div class="plating-photo">${photoHtml}</div>` : ""}
        <div class="plating-text">
          ${r.plate ? `<p class="plate-line"><small>Πιάτο σερβιρίσματος</small><b>${esc(r.plate)}</b></p>` : ""}
          ${steps.length ? `<ol class="steps">${steps.map((x) => `<li><span>${esc(x)}</span></li>`).join("")}</ol>` : ""}
        </div>
      </div>
    </section>`;
  }

  function renderDetail() {
    const r = S.recipes.find((x) => x.id === S.id);
    if (!r) { S.view = "list"; return render(); }
    const base = r.yieldQty || 0;
    const target = S.scale ?? base;
    const factor = base && target ? target / base : 1;
    const scaled = Math.abs(factor - 1) > 1e-9;
    const ings = (r.ingredients || []).map((i) => {
      const f = showQty(i.qty != null ? i.qty * factor : null, i.unit);
      return `<tr><td class="q">${esc(f.q)}<span>${esc(f.u)}</span></td><td>${esc(i.name)}${findComp(r, i.name) ? ' <span class="comp-ref">συνταγή ↓</span>' : ""}</td></tr>`;
    }).join("");
    const facts = [
      ["Εστιατόριο", restName(r.restaurantId)],
      r.yieldQty ? ["Απόδοση", `${nf(r.yieldQty, 2)} ${r.yieldUnit || ""}`] : null,
      r.prepMin ? ["Προετοιμασία", `${r.prepMin}′`] : null,
      r.cookMin ? ["Μαγείρεμα", `${r.cookMin}′`] : null,
    ].filter(Boolean);
    main.innerHTML = `<div style="margin-bottom:12px"><button class="btn ghost" data-act="back">← Πίσω στις συνταγές</button></div>
    <article class="sheet">
      ${r.photoPath ? `<div class="hero-photo">${photoImg(r.photoPath)}</div>` : ""}
      <div class="sheet-head">
        <span class="tag">${esc(r.category || "Άλλο")}</span>
        <h2>${esc(r.title)}</h2>
        <div class="facts">${facts.map(([k, v]) => `<div class="fact"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join("")}</div>
        ${(r.allergens || []).length ? `<div class="allergens" aria-label="Αλλεργιογόνα">${r.allergens.map((a) => `<span>${esc(a)}</span>`).join("")}</div>` : ""}
        <div class="sheet-actions">
          <button class="btn" data-act="edit">Επεξεργασία</button>
          <button class="btn" data-act="share">${r.shareToken ? "Κοινοποιημένη ✓" : "Κοινοποίηση"}</button>
          <button class="btn" data-act="dup">Αντιγραφή</button>
          <button class="btn danger" data-act="del">Διαγραφή</button>
        </div>
      </div>
      <div class="sheet-body">
        <section>
          <div class="sec-title"><span>Υλικά</span>
            ${base ? `<label class="scaler">Για <input id="scale" type="number" min="0" step="any" inputmode="decimal" value="${esc(target)}"> ${esc(r.yieldUnit || "")}
              ${scaled ? `<button class="btn ghost" data-act="reset-scale" style="padding:2px 8px">Επαναφορά</button>` : ""}</label>` : ""}
          </div>
          ${ings ? `<div class="units-row">${unitToggle()}</div><table class="ing ${scaled ? "scaled" : ""}"><tbody>${ings}</tbody></table>` : `<p class="sheet-sub">Δεν έχουν γραφτεί υλικά.</p>`}
        </section>
        <section>
          <div class="sec-title"><span>Εκτέλεση</span></div>
          ${(r.steps || []).length ? `<ol class="steps">${r.steps.map((s) => `<li><span>${esc(s)}</span></li>`).join("")}</ol>` : `<p class="sheet-sub">${(r.components || []).length ? "Η εκτέλεση είναι στις συνταγές συστατικών, παρακάτω." : "Δεν έχουν γραφτεί βήματα."}</p>`}
          ${r.notes ? `<div class="ticket"><strong>Σημειώσεις σεφ</strong>${esc(r.notes)}</div>` : ""}
        </section>
      </div>
      ${componentsHtml(r)}
      ${platingHtml(r, r.platingPhotoPath ? photoImg(r.platingPhotoPath) : "")}
      ${S.viewing && S.viewing.team ? "" : `<section class="costing" id="costBox">${costingHtml(r, factor, target)}</section>`}
    </article>`;
    const sc = $("scale");
    if (sc) sc.addEventListener("change", () => { const v = parseFloat(sc.value.replace(",", ".")); S.scale = v > 0 ? v : null; renderDetail(); });
    wireCosting(r, factor, target);
  }

  function compEditHtml(c) {
    return `<div class="comp-edit">
      <div class="comp-edit-head"><input class="comp-name" value="${esc(c.name || "")}" placeholder="π.χ. Σάλτσα ταχίνι" aria-label="Όνομα συστατικού">
        <button type="button" class="btn ghost" data-comp-rm="1">Αφαίρεση</button></div>
      <label class="f">Υλικά<textarea class="comp-ings mono" rows="5" placeholder="190 g ταχίνι&#10;40 g σόγια&#10;60 g χυμός λάιμ">${esc((c.ingredients || []).map(ingToLine).join("\n"))}</textarea></label>
      <label class="f">Εκτέλεση<textarea class="comp-steps" rows="3" placeholder="Χτυπάμε όλα τα υλικά στο thermomix">${esc((c.steps || []).join("\n"))}</textarea></label>
    </div>`;
  }

  function renderForm() {
    const e = S.edit || {};
    const restOpts = `<option value="">Χωρίς εστιατόριο</option>` + S.restaurants.map((r) => `<option value="${esc(r.id)}" ${e.restaurantId === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("");
    main.innerHTML = `<form class="form" id="recForm" novalidate>
      <h2>${e.id ? "Επεξεργασία συνταγής" : "Νέα συνταγή"}</h2>
      <div class="photo-box" id="photoBox"></div>
      <div class="row">
        <label class="f" style="grid-column: 1 / -1">Όνομα πιάτου<input id="f-title" required value="${esc(e.title)}" placeholder="π.χ. Ριζότο μανιταριών με τρούφα"></label>
      </div>
      <div class="row">
        <label class="f">Εστιατόριο<select id="f-rest">${restOpts}</select></label>
        <label class="f">Κατηγορία<select id="f-cat">${CATS.map((c) => `<option ${(e.category || "Κυρίως κρεατικά") === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
      </div>
      <div class="row">
        <label class="f">Απόδοση<input id="f-yq" type="number" min="0" step="any" inputmode="decimal" value="${esc(e.yieldQty ?? "")}" placeholder="10"></label>
        <label class="f">Μονάδα απόδοσης<input id="f-yu" value="${esc(e.yieldUnit ?? "μερίδες")}" placeholder="μερίδες, kg, lt"></label>
        <label class="f">Προετοιμασία (λεπτά)<input id="f-prep" type="number" min="0" inputmode="numeric" value="${esc(e.prepMin ?? "")}"></label>
        <label class="f">Μαγείρεμα (λεπτά)<input id="f-cook" type="number" min="0" inputmode="numeric" value="${esc(e.cookMin ?? "")}"></label>
      </div>
      <label class="f">Υλικά <span class="hint">Ένα ανά γραμμή: ποσότητα, μονάδα, υλικό. π.χ. «500 g αλεύρι» ή «2 τεμ αυγά». Έτσι υπολογίζονται αυτόματα οι ποσότητες για άλλες μερίδες.</span>
        <textarea id="f-ing" class="mono" rows="8" placeholder="320 g ρύζι carnaroli&#10;1 lt ζωμός λαχανικών&#10;80 g παρμεζάνα&#10;αλάτι, πιπέρι">${esc((e.ingredients || []).map(ingToLine).join("\n"))}</textarea></label>
      <label class="f">Εκτέλεση <span class="hint">Ένα βήμα ανά γραμμή.</span>
        <textarea id="f-steps" rows="7" placeholder="Σοτάρουμε το κρεμμύδι σε βούτυρο…">${esc((e.steps || []).join("\n"))}</textarea></label>
      <fieldset class="comps-field"><legend>Συνταγές συστατικών</legend>
        <p class="hint" style="margin:0">Για συστατικά του πιάτου που φτιάχνονται χωριστά, π.χ. σάλτσες, γλάσα, πουρέδες. Αν το όνομα είναι ίδιο με ένα υλικό του πιάτου (π.χ. «45 g σάλτσα ταχίνι»), συνδέονται αυτόματα στην κοστολόγηση και στην παραγγελία.</p>
        <div id="compList">${(e.components || []).map(compEditHtml).join("")}</div>
        <button type="button" class="btn" id="compAdd">+ Προσθήκη συνταγής συστατικού</button>
      </fieldset>
      <fieldset><legend>Αλλεργιογόνα</legend><div class="checks">${ALLERGENS.map((a, i) => `<label><input type="checkbox" id="al-${i}" value="${esc(a)}" ${(e.allergens || []).includes(a) ? "checked" : ""}> ${esc(a)}</label>`).join("")}</div></fieldset>
      <label class="f">Σημειώσεις σεφ <span class="hint">Μυστικά, πλέιτινγκ, συντήρηση, προμηθευτές.</span>
        <textarea id="f-notes" rows="3">${esc(e.notes)}</textarea></label>
      <fieldset class="plating-field"><legend>Στήσιμο πιάτου</legend>
        <div class="photo-box" id="platingBox"></div>
        <label class="f">Πιάτο σερβιρίσματος<input id="f-plate" value="${esc(e.plate)}" placeholder="π.χ. Βαθύ λευκό πιάτο 28 εκ."></label>
        <label class="f">Βήματα στησίματος <span class="hint">Ένα βήμα ανά γραμμή, με τη σειρά που μπαίνουν στο πιάτο.</span>
          <textarea id="f-plating" rows="4" placeholder="Η σάλτσα στο κέντρο με κουτάλι&#10;Το ψάρι από πάνω, με την πέτσα προς τα πάνω&#10;Μικροχόρταρα και λίγες σταγόνες λάδι">${esc((e.platingSteps || []).join("\n"))}</textarea></label>
      </fieldset>
      <div id="f-err" class="err" hidden></div>
      <div class="form-actions">
        <button type="button" class="btn" data-act="cancel-form">Ακύρωση</button>
        <button type="submit" class="btn primary" id="f-save">Αποθήκευση</button>
      </div>
    </form>`;
    $("recForm").addEventListener("submit", saveRecipe);
    renderPhotoBox(); renderPlatingBox();
    $("compAdd").addEventListener("click", () => { $("compList").insertAdjacentHTML("beforeend", compEditHtml({})); const all = $("compList").querySelectorAll(".comp-name"); all[all.length - 1].focus(); });
    $("compList").addEventListener("click", (ev) => { const b = ev.target.closest("[data-comp-rm]"); if (b) b.closest(".comp-edit").remove(); });
    if (!e.title) $("f-title").focus();
  }

  function render() {
    document.body.classList.toggle("readonly", !!S.viewing);
    document.querySelector(".app").classList.toggle("admin-mode", S.view === "admin" || S.view === "order");
    renderBanner();
    renderRail();
    if (S.view === "admin") renderAdmin();
    else if (S.view === "order") renderOrder();
    else if (S.view === "detail") renderDetail();
    else if (S.view === "form") renderForm();
    else renderList();
  }

  // ---------- actions ----------
  function writeError(e) {
    if (e && /fetch|network/i.test(e.message || "")) return "Δεν υπάρχει σύνδεση στο ίντερνετ. Δοκίμασε ξανά σε λίγο.";
    if (e && (e.code === "PGRST301" || /JWT/i.test(e.message || ""))) return "Η σύνδεσή σου έληξε. Αποσυνδέσου και συνδέσου ξανά.";
    return "Δεν αποθηκεύτηκε. Δοκίμασε ξανά.";
  }

  async function saveRecipe(ev) {
    ev.preventDefault();
    const err = $("f-err");
    const title = $("f-title").value.trim();
    if (!title) { err.textContent = "Γράψε όνομα πιάτου για να αποθηκευτεί η συνταγή."; err.hidden = false; return; }
    const num = (id) => { const v = parseFloat($(id).value.replace(",", ".")); return isFinite(v) && v > 0 ? v : null; };
    const data = {
      title, restaurantId: $("f-rest").value, category: $("f-cat").value,
      yieldQty: num("f-yq"), yieldUnit: $("f-yu").value.trim(), prepMin: num("f-prep"), cookMin: num("f-cook"),
      ingredients: parseIngredients($("f-ing").value),
      steps: $("f-steps").value.split("\n").map((s) => s.trim()).filter(Boolean),
      allergens: ALLERGENS.filter((_, i) => $("al-" + i).checked),
      notes: $("f-notes").value.trim(),
      plate: $("f-plate").value.trim(),
      platingSteps: $("f-plating").value.split("\n").map((x) => x.trim()).filter(Boolean),
      components: [...document.querySelectorAll("#compList .comp-edit")].map((el) => ({
        name: el.querySelector(".comp-name").value.trim(),
        ingredients: parseIngredients(el.querySelector(".comp-ings").value),
        steps: el.querySelector(".comp-steps").value.split("\n").map((x) => x.trim()).filter(Boolean),
      })).filter((c) => c.name || c.ingredients.length || c.steps.length),
    };
    const btn = $("f-save"); btn.disabled = true; btn.textContent = "Αποθήκευση…";
    try {
      const id = S.edit && S.edit.id;
      const row = id
        ? check(await sb.from("recipes").update(toRec(data)).eq("id", id).select().single())
        : check(await sb.from("recipes").insert(toRec(data)).select().single());
      let rec = fromRec(row);
      let photoFailed = false;
      try { rec = await applyPhotoChange(rec, S.edit); } catch (pe) { console.error(pe); photoFailed = true; }
      S.recipes = S.recipes.filter((r) => r.id !== rec.id).concat(rec).sort((a, b) => a.title.localeCompare(b.title, "el"));
      S.edit = null; S.id = rec.id; S.scale = null; S.view = "detail";
      toast(photoFailed ? "Η συνταγή αποθηκεύτηκε, αλλά η φωτογραφία δεν ανέβηκε. Δοκίμασε ξανά." : "Η συνταγή αποθηκεύτηκε"); render(); window.scrollTo(0, 0);
    } catch (e) {
      btn.disabled = false; btn.textContent = "Αποθήκευση";
      err.textContent = writeError(e); err.hidden = false;
    }
  }

  function modal(html, onReady) { const o = $("overlay"); o.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`; o.hidden = false; onReady && onReady(o); }
  function closeModal() { const o = $("overlay"); o.hidden = true; o.innerHTML = ""; }
  $("overlay").addEventListener("click", (e) => { if (e.target.id === "overlay" || e.target.dataset.act === "close") closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("overlay").hidden) closeModal(); });

  function confirmBox(title, text, okLabel, onOk) {
    modal(`<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="form-actions"><button class="btn" data-act="close">Ακύρωση</button><button class="btn danger solid" id="okBtn">${esc(okLabel)}</button></div>`, () => {
      $("okBtn").addEventListener("click", async () => { $("okBtn").disabled = true; try { await onOk(); closeModal(); } catch (e) { closeModal(); toast(writeError(e)); } });
    });
  }

  function restaurantForm(r) {
    r = r || {};
    modal(`<h3>${r.id ? "Επεξεργασία εστιατορίου" : "Νέο εστιατόριο"}</h3>
      <form id="restForm" style="display:flex;flex-direction:column;gap:12px" novalidate>
        <label class="f">Όνομα<input id="r-name" value="${esc(r.name)}" placeholder="π.χ. Ψαροταβέρνα Ο Γιάννης"></label>
        <div class="row">
          <label class="f">Πόλη<input id="r-city" value="${esc(r.city)}" placeholder="Αθήνα"></label>
          <label class="f">Χρονιές<input id="r-years" value="${esc(r.years)}" placeholder="2019–2022"></label>
        </div>
        <label class="f">Θέση<input id="r-role" value="${esc(r.role)}" placeholder="Sous chef, Chef de partie…"></label>
        <div id="r-err" class="err" hidden></div>
        <div class="form-actions"><button type="button" class="btn" data-act="close">Ακύρωση</button><button class="btn primary" id="r-save">Αποθήκευση</button></div>
      </form>`, () => {
      $("r-name").focus();
      $("restForm").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const name = $("r-name").value.trim(), err = $("r-err");
        if (!name) { err.textContent = "Γράψε το όνομα του εστιατορίου."; err.hidden = false; return; }
        const data = { name, city: $("r-city").value.trim(), years: $("r-years").value.trim(), role: $("r-role").value.trim(), updated_at: new Date().toISOString() };
        $("r-save").disabled = true;
        try {
          const row = r.id
            ? check(await sb.from("restaurants").update(data).eq("id", r.id).select().single())
            : check(await sb.from("restaurants").insert(data).select().single());
          const rest = fromRest(row);
          S.restaurants = S.restaurants.filter((x) => x.id !== rest.id).concat(rest).sort((a, b) => a.name.localeCompare(b.name, "el"));
          if (!r.id) { S.sel = rest.id; S.view = "list"; }
          closeModal(); toast("Το εστιατόριο αποθηκεύτηκε"); render();
        } catch (e) { $("r-save").disabled = false; err.textContent = writeError(e); err.hidden = false; }
      });
    });
  }

  function newRecipe() {
    S.edit = { restaurantId: S.restaurants.some((r) => r.id === S.sel) ? S.sel : "" };
    S.view = "form"; render(); window.scrollTo(0, 0);
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu-wrap")) toggleMenu(false);
    const t = e.target.closest("[data-sel],[data-open],[data-act],[data-chef],[data-team]");
    if (!t || t.closest("#overlay")) return;
    if (t.dataset.chef) { openChef(t.dataset.chef); return; }
    if (t.dataset.team) { openTeam(t.dataset.team); return; }
    if (t.dataset.act === "units") { setUnits(t.dataset.u); if (S.view === "detail") renderDetail(); return; }
    if (t.dataset.act === "order") { toggleMenu(false); S.order = null; S.view = "order"; render(); window.scrollTo(0, 0); return; }
    if (t.dataset.act === "leave-team") { leaveTeam(); return; }
    if (t.dataset.act === "admin") { openAdmin(); return; }
    if (t.dataset.act === "my-notebook") { S.viewing = null; S.view = "list"; S.sel = "all"; S.loaded = false; render(); loadAll(); return; }
    if (S.viewing && ["new", "import", "edit", "dup", "del", "edit-rest", "del-rest", "share", "team"].includes(t.dataset.act)) return;
    if (t.dataset.sel !== undefined) { S.sel = t.dataset.sel; S.view = "list"; render(); return; }
    if (t.dataset.open) { S.id = t.dataset.open; S.scale = null; S.view = "detail"; render(); window.scrollTo(0, 0); return; }
    const r = S.recipes.find((x) => x.id === S.id);
    const rest = S.restaurants.find((x) => x.id === S.sel);
    switch (t.dataset.act) {
      case "new": newRecipe(); break;
      case "share": shareDialog(r); break;
      case "team": teamDialog(rest); break;
      case "import": importDialog(); break;
      case "back": S.view = "list"; render(); break;
      case "reset-scale": S.scale = null; renderDetail(); break;
      case "edit": S.edit = { ...r }; S.view = "form"; render(); break;
      case "dup": S.edit = { ...r, id: undefined, photoPath: null, platingPhotoPath: null, shareToken: null, title: r.title + " (αντίγραφο)" }; S.view = "form"; render(); break;
      case "cancel-form": if (S.edit && S.edit.newPhoto) URL.revokeObjectURL(S.edit.newPhoto.preview); if (S.edit && S.edit.newPlating) URL.revokeObjectURL(S.edit.newPlating.preview); S.view = S.edit && S.edit.id ? "detail" : "list"; S.edit = null; render(); break;
      case "del":
        confirmBox("Διαγραφή συνταγής;", `Η συνταγή «${r.title}» θα σβηστεί οριστικά.`, "Διαγραφή", async () => {
          check(await sb.from("recipes").delete().eq("id", r.id));
          removePhotoFiles(r.photoPath);
          if (r.platingPhotoPath) sb.storage.from(BUCKET).remove([r.platingPhotoPath]).catch(() => {});
          S.recipes = S.recipes.filter((x) => x.id !== r.id); S.view = "list"; render(); toast("Η συνταγή διαγράφηκε");
        }); break;
      case "edit-rest": restaurantForm(rest); break;
      case "del-rest": {
        const mine = S.recipes.filter((x) => x.restaurantId === rest.id);
        confirmBox("Διαγραφή εστιατορίου;", mine.length ? `Οι ${mine.length} συνταγές του θα μείνουν στο τετράδιο, στην ενότητα «Χωρίς εστιατόριο».` : `Το «${rest.name}» θα σβηστεί από τη λίστα.`, "Διαγραφή", async () => {
          check(await sb.from("restaurants").delete().eq("id", rest.id));
          S.restaurants = S.restaurants.filter((x) => x.id !== rest.id);
          mine.forEach((x) => (x.restaurantId = ""));
          S.sel = "all"; render(); toast("Το εστιατόριο διαγράφηκε");
        }); break;
      }
    }
  });
  $("newRecipeBtn").addEventListener("click", newRecipe);
  $("importBtn").addEventListener("click", importDialog);
  $("importRecipeMenu").addEventListener("click", importDialog);
  $("addRestBtn").addEventListener("click", () => restaurantForm());

  // ---------- dish photos ----------
  // Files live in the private bucket at <user id>/<recipe id>/<time>.jpg, with a small copy *_t.jpg for the cards.
  const BUCKET = "recipe-photos";
  const photoUrls = {}; // path -> { url, at }
  const thumbOf = (p) => p.replace(/\.jpg$/, "_t.jpg");
  function photoImg(path) {
    const u = photoUrls[path];
    return `<img data-photo="${esc(path)}" alt="" loading="lazy" ${u ? `src="${esc(u.url)}"` : ""}>`;
  }
  async function signPhotos(extra) {
    const now = Date.now();
    const paths = (extra || []).filter(Boolean);
    S.recipes.forEach((r) => { if (r.photoPath) paths.push(r.photoPath, thumbOf(r.photoPath)); if (r.platingPhotoPath) paths.push(r.platingPhotoPath); });
    if (S.profile && S.profile.avatar_path) paths.push(S.profile.avatar_path);
    (S.chefs || []).forEach((c) => { if (c.avatar_path) paths.push(c.avatar_path); });
    const need = paths.filter((p) => !photoUrls[p] || now - photoUrls[p].at > 50 * 60 * 1000);
    if (!need.length) return;
    for (let i = 0; i < need.length; i += 100) {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need.slice(i, i + 100), 3600);
      if (error || !data) continue;
      data.forEach((d) => { if (d.signedUrl && d.path) photoUrls[d.path] = { url: d.signedUrl, at: now }; });
    }
    document.querySelectorAll("img[data-photo]").forEach((img) => {
      const u = photoUrls[img.dataset.photo];
      if (u && img.getAttribute("src") !== u.url) img.src = u.url;
    });
  }
  window.addEventListener("focus", () => { if (S.user) signPhotos(); });

  // Shrinks a picture to a JPEG no wider/taller than `max` pixels.
  async function resizeImage(file, max, quality) {
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch {
      src = await new Promise((res, rej) => {
        const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error("bad_image"));
        img.src = URL.createObjectURL(file);
      });
    }
    const w = src.width, h = src.height;
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", quality));
    if (!blob) throw new Error("bad_image");
    return blob;
  }

  function renderPhotoBox() {
    const box = $("photoBox"); if (!box) return;
    const e = S.edit || {};
    const current = e.newPhoto ? e.newPhoto.preview : (!e.removePhoto && e.photoPath && photoUrls[e.photoPath] ? photoUrls[e.photoPath].url : null);
    const hasPhoto = e.newPhoto || (!e.removePhoto && e.photoPath);
    box.innerHTML = `
      <div class="photo-preview ${hasPhoto ? "" : "empty"}">${hasPhoto ? (current ? `<img src="${esc(current)}" alt="Φωτογραφία πιάτου">` : `<span>Φόρτωση φωτογραφίας…</span>`) : `<span>Χωρίς φωτογραφία</span>`}</div>
      <div class="photo-actions">
        <label class="btn" for="photoInput">${hasPhoto ? "Αλλαγή φωτογραφίας" : "+ Φωτογραφία πιάτου"}</label>
        ${hasPhoto ? `<button type="button" class="btn ghost" id="photoRemove">Αφαίρεση</button>` : ""}
        <input type="file" id="photoInput" accept="image/*" hidden>
        <span class="hint" id="photoMsg"></span>
      </div>`;
    $("photoInput").addEventListener("change", async (ev) => {
      const file = ev.target.files[0]; ev.target.value = "";
      if (!file) return;
      const msg = $("photoMsg"); msg.textContent = "Επεξεργασία φωτογραφίας…";
      try {
        const large = await resizeImage(file, 1600, 0.85);
        const thumb = await resizeImage(large, 480, 0.8);
        if (e.newPhoto) URL.revokeObjectURL(e.newPhoto.preview);
        e.newPhoto = { large, thumb, preview: URL.createObjectURL(large) };
        e.removePhoto = false;
        renderPhotoBox();
      } catch { msg.textContent = "Δεν άνοιξε η φωτογραφία. Δοκίμασε JPG ή PNG."; }
    });
    const rm = $("photoRemove");
    if (rm) rm.addEventListener("click", () => {
      if (e.newPhoto) { URL.revokeObjectURL(e.newPhoto.preview); e.newPhoto = null; }
      else e.removePhoto = true;
      renderPhotoBox();
    });
  }

  function removePhotoFiles(path) {
    if (path) sb.storage.from(BUCKET).remove([path, thumbOf(path)]).catch(() => {});
  }

  // After the recipe row is saved: upload a new photo or remove the old one.
  async function applyPhotoChange(rec, edit) {
    return applyPlatingPhoto(await applyMainPhoto(rec, edit), edit);
  }
  async function applyPlatingPhoto(rec, edit) {
    const old = edit && edit.id ? edit.platingPhotoPath : null;
    if (edit && edit.newPlating) {
      const path = `${S.user.id}/${rec.id}/plating-${Date.now()}.jpg`;
      check(await sb.storage.from(BUCKET).upload(path, edit.newPlating.large, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false }));
      photoUrls[path] = { url: edit.newPlating.preview, at: Date.now() };
      check(await sb.from("recipes").update({ plating_photo_path: path }).eq("id", rec.id));
      if (old) sb.storage.from(BUCKET).remove([old]).catch(() => {});
      setTimeout(signPhotos, 1500);
      return { ...rec, platingPhotoPath: path };
    }
    if (edit && edit.removePlating && old) {
      check(await sb.from("recipes").update({ plating_photo_path: null }).eq("id", rec.id));
      sb.storage.from(BUCKET).remove([old]).catch(() => {});
      return { ...rec, platingPhotoPath: null };
    }
    return rec;
  }
  function renderPlatingBox() {
    const box = $("platingBox"); if (!box) return;
    const e = S.edit || {};
    const has = e.newPlating || (!e.removePlating && e.platingPhotoPath);
    const src = e.newPlating ? e.newPlating.preview : (has && photoUrls[e.platingPhotoPath] ? photoUrls[e.platingPhotoPath].url : null);
    box.innerHTML = `
      <div class="photo-preview ${has ? "" : "empty"}">${has ? (src ? `<img src="${esc(src)}" alt="Στημένο πιάτο">` : `<span>Φόρτωση φωτογραφίας…</span>`) : `<span>Χωρίς φωτογραφία</span>`}</div>
      <div class="photo-actions">
        <label class="btn" for="platingInput">${has ? "Αλλαγή φωτογραφίας" : "+ Φωτογραφία στησίματος"}</label>
        ${has ? `<button type="button" class="btn ghost" id="platingRemove">Αφαίρεση</button>` : ""}
        <input type="file" id="platingInput" accept="image/*" hidden>
        <span class="hint" id="platingMsg"></span>
      </div>`;
    $("platingInput").addEventListener("change", async (ev) => {
      const file = ev.target.files[0]; ev.target.value = "";
      if (!file) return;
      $("platingMsg").textContent = "Επεξεργασία φωτογραφίας…";
      try {
        const large = await resizeImage(file, 1600, 0.85);
        if (e.newPlating) URL.revokeObjectURL(e.newPlating.preview);
        e.newPlating = { large, preview: URL.createObjectURL(large) }; e.removePlating = false;
        renderPlatingBox();
      } catch { $("platingMsg").textContent = "Δεν άνοιξε η φωτογραφία. Δοκίμασε JPG ή PNG."; }
    });
    const rm = $("platingRemove");
    if (rm) rm.addEventListener("click", () => {
      if (e.newPlating) { URL.revokeObjectURL(e.newPlating.preview); e.newPlating = null; } else e.removePlating = true;
      renderPlatingBox();
    });
  }
  async function applyMainPhoto(rec, edit) {
    const old = edit && edit.id ? edit.photoPath : null;
    if (edit && edit.newPhoto) {
      const path = `${S.user.id}/${rec.id}/${Date.now()}.jpg`;
      const opts = { contentType: "image/jpeg", cacheControl: "31536000", upsert: false };
      check(await sb.storage.from(BUCKET).upload(path, edit.newPhoto.large, opts));
      check(await sb.storage.from(BUCKET).upload(thumbOf(path), edit.newPhoto.thumb, opts));
      photoUrls[path] = { url: edit.newPhoto.preview, at: Date.now() };
      photoUrls[thumbOf(path)] = { url: edit.newPhoto.preview, at: Date.now() };
      check(await sb.from("recipes").update({ photo_path: path }).eq("id", rec.id));
      removePhotoFiles(old);
      setTimeout(signPhotos, 1500);
      return { ...rec, photoPath: path };
    }
    if (edit && edit.removePhoto && old) {
      check(await sb.from("recipes").update({ photo_path: null }).eq("id", rec.id));
      removePhotoFiles(old);
      return { ...rec, photoPath: null };
    }
    return rec;
  }

  // ---------- import recipes from a photo, PDF, Word file or text ----------
  const fileToBase64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  let mammothLoading = null;
  function loadMammoth() {
    if (window.mammoth) return Promise.resolve(window.mammoth);
    mammothLoading = mammothLoading || new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";
      s.onload = () => res(window.mammoth); s.onerror = () => { mammothLoading = null; rej(new Error("load")); };
      document.head.appendChild(s);
    });
    return mammothLoading;
  }

  // Free, offline fallback for plain text: finds title, ingredients, steps and notes by their headings.
  function parseRecipeText(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim().replace(/^[-•*·▪●]\s*/, "")).filter(Boolean);
    const clean = (l) => l.replace(/[*#_]/g, "").trim();
    const head = (l, words) => new RegExp(`^(${words})(?=[\\s:.]|$)[^\\n]{0,30}$`, "iu").test(clean(l));
    const ING = "υλικά|υλικα|συστατικά|συστατικα|ingredients";
    const STEP = "εκτέλεση|εκτελεση|οδηγίες|οδηγιες|τρόπος|τροπος|παρασκευή|παρασκευη|διαδικασία|διαδικασια|method|directions|instructions|preparation|steps";
    const NOTE = "σημειώσεις|σημειωσεις|σημείωση|σημειωση|tips|notes|μυστικά|μυστικα";
    const PLATE = "στήσιμο|στησιμο|πλέιτινγκ|πλειτινγκ|σερβίρισμα|σερβιρισμα|plating|presentation";
    const COMP = "συνταγές|συνταγες|συνταγές συστατικών|συνταγες συστατικων|βάσεις|βασεις|sub-recipes|subrecipes|recipes|components|mise en place";
    const isIng = (l) => /^(\d|[½¼¾])/.test(l) && l.length < 80;
    const nextIsIng = (k) => k + 1 < lines.length && isIng(lines[k + 1]);
    const looksLikeName = (l, k) => l.length <= 45 && !/[.!;:,]$/.test(l) && !isIng(l) && nextIsIng(k);
    const strip = (l) => l.replace(/^(\d+|[α-ω])[.)]\s*/i, "");
    let title = "", section = "", yieldQty = null, yieldUnit = "μερίδες";
    const ings = [], steps = [], notes = [], plating = [], comps = [];
    let cur = null, inComps = false;
    lines.forEach((l, k) => {
      const per = clean(l).match(/^(?:ανά|ανα|per)\s+(πιάτο|πιατο|μερίδα|μεριδα|plate|portion|serving)$/i);
      if (per) { yieldQty = 1; yieldUnit = /μερ|portion|serving/i.test(per[1]) ? "μερίδα" : "πιάτο"; return; }
      const y = l.match(/(\d+(?:[.,]\d+)?)\s*(μερίδες|μερίδα|μεριδες|άτομα|ατομα|portions|servings)/i);
      if (y && !yieldQty && !inComps) { yieldQty = parseFloat(y[1].replace(",", ".")); yieldUnit = /άτομ|ατομ/i.test(y[2]) ? "άτομα" : "μερίδες"; if (l.length < 30) return; }
      if (head(l, COMP) && title) { inComps = true; cur = null; return; }
      if (head(l, NOTE)) { inComps = false; section = "note"; return; }
      if (head(l, PLATE)) { inComps = false; section = "plate"; return; }
      if (inComps) {
        if (head(l, STEP)) { if (cur) cur.sect = "step"; return; }
        if (head(l, ING)) { if (cur) cur.sect = "ing"; return; }
        if (!cur || (looksLikeName(l, k) && (cur.ings.length || cur.steps.length))) { cur = { name: clean(l), ings: [], steps: [], sect: "ing" }; comps.push(cur); return; }
        if (isIng(l) && cur.sect === "ing") { cur.ings.push(l); return; }
        cur.sect = "step"; cur.steps.push(strip(l)); return;
      }
      if (head(l, ING)) { section = "ing"; return; }
      if (head(l, STEP)) { section = "step"; return; }
      if (!title && !section) { title = clean(l); return; }
      if (section === "ing") ings.push(l);
      else if (section === "step") steps.push(strip(l));
      else if (section === "note") notes.push(l);
      else if (section === "plate") plating.push(strip(l));
      else if (isIng(l) && l.length < 60) ings.push(l);
      else steps.push(l.replace(/^(\d+)[.)]\s*/, ""));
    });
    if (!title && !ings.length && !steps.length && !comps.length) return [];
    // Title in capitals (e.g. "PAKCHOI") reads better in normal case.
    if (title && title === title.toUpperCase() && /[A-Za-zΑ-Ωα-ω]/.test(title)) title = title.charAt(0) + title.slice(1).toLowerCase();
    return [{ title: title || "Συνταγή χωρίς όνομα", category: "Άλλο", yieldQty, yieldUnit: yieldQty ? yieldUnit : "μερίδες", prepMin: null, cookMin: null,
      ingredients: parseIngredients(ings.join("\n")), steps, allergens: [], notes: notes.join("\n"), plate: "", platingSteps: plating,
      components: comps.map((c) => ({ name: c.name, ingredients: parseIngredients(c.ings.join("\n")), steps: c.steps })) }];
  }

  const fromAi = (r) => ({
    title: String(r.title || "Συνταγή χωρίς όνομα"), category: CATS.includes(r.category) ? r.category : "Άλλο",
    yieldQty: typeof r.yield_qty === "number" && r.yield_qty > 0 ? r.yield_qty : null, yieldUnit: r.yield_unit || (r.yield_qty ? "μερίδες" : ""),
    prepMin: Number.isFinite(r.prep_min) && r.prep_min > 0 ? r.prep_min : null, cookMin: Number.isFinite(r.cook_min) && r.cook_min > 0 ? r.cook_min : null,
    ingredients: (Array.isArray(r.ingredients) ? r.ingredients : []).filter((i) => i && i.name).map((i) => ({ qty: typeof i.qty === "number" ? i.qty : null, unit: i.unit || "", name: String(i.name) })),
    steps: (Array.isArray(r.steps) ? r.steps : []).map(String).filter(Boolean),
    allergens: (Array.isArray(r.allergens) ? r.allergens : []).filter((a) => ALLERGENS.includes(a)),
    notes: r.notes || "",
  });

  const AI_ERRORS = {
    not_configured: null, bad_api_key: null, // fall back to the simple reader
    too_large: "Το αρχείο είναι πολύ μεγάλο. Δοκίμασε μικρότερο PDF ή μία σελίδα τη φορά.",
    unsupported_file: "Αυτός ο τύπος αρχείου δεν υποστηρίζεται. Δοκίμασε φωτογραφία, PDF, Word ή κείμενο.",
    too_long: "Το αρχείο έχει πάρα πολλές συνταγές μαζί. Ανέβασέ το σε μικρότερα κομμάτια.",
    busy: "Η υπηρεσία είναι απασχολημένη. Δοκίμασε ξανά σε ένα λεπτό.",
    refused: "Δεν μπόρεσε να διαβαστεί αυτό το αρχείο. Δοκίμασε να επικολλήσεις το κείμενο.",
  };

  // Returns { recipes } or { error } (error text for the user) or { fallback: true } when smart reading is unavailable.
  async function readWithAi(body) {
    try {
      const { data, error } = await sb.functions.invoke("import-recipe", { body });
      if (!error) return { recipes: (data.recipes || []).map(fromAi) };
      let code = "";
      try { code = (await error.context.json()).error; } catch { /* function missing or offline */ }
      if (!code || code in AI_ERRORS && AI_ERRORS[code] === null) return { fallback: true };
      return { error: AI_ERRORS[code] || "Κάτι δεν πήγε καλά στη μετατροπή. Δοκίμασε ξανά." };
    } catch { return { fallback: true }; }
  }

  // Checks once whether smart reading (photos, PDF) is switched on. An empty request is free.
  let aiReady = null;
  async function checkAi() {
    if (aiReady !== null) return aiReady;
    try {
      const { error } = await sb.functions.invoke("import-recipe", { body: {} });
      let code = "";
      if (error) { try { code = (await error.context.json()).error || ""; } catch { /* not deployed */ } }
      aiReady = code === "empty" || code === "bad_request";
    } catch { aiReady = false; }
    return aiReady;
  }

  async function importDialog() {
    toggleMenu(false);
    const ai = await checkAi();
    modal(`<h3>Ανέβασμα συνταγής</h3>
      ${ai ? `<p>Φωτογραφία από το τετράδιό σου, PDF, Word ή κείμενο. Η εφαρμογή τη διαβάζει και τη μετατρέπει σε συνταγή, για να την ελέγξεις πριν την αποθηκεύσεις.</p>`
        : `<p>Ανέβασε αρχείο Word ή κείμενο, ή επικόλλησε τη συνταγή. Η εφαρμογή βρίσκει όνομα, υλικά, βήματα και σημειώσεις, για να την ελέγξεις πριν την αποθηκεύσεις. Βοηθάει να έχει επικεφαλίδες «Υλικά» και «Εκτέλεση».</p>`}
      <div class="import-pick">
        ${ai ? `<label class="btn" for="imp-camera">Φωτογραφία</label>` : ""}
        <label class="btn" for="imp-file">${ai ? "Αρχείο (PDF, Word, κείμενο)" : "Αρχείο (Word, κείμενο)"}</label>
        <input type="file" id="imp-camera" accept="image/*" capture="environment" hidden>
        <input type="file" id="imp-file" accept="${ai ? "image/*,application/pdf,.pdf," : ""}.docx,.txt,.md,text/plain" hidden>
      </div>
      <div id="imp-chosen" class="hint" hidden></div>
      <label class="f">ή επικόλλησε το κείμενο<textarea id="imp-text" rows="6" placeholder="Μουσακάς&#10;Υλικά&#10;1,5 kg μελιτζάνες&#10;…&#10;Εκτέλεση&#10;…"></textarea></label>
      <div id="imp-err" class="err" hidden></div>
      <div id="imp-status" class="ok" hidden></div>
      <div class="form-actions"><button class="btn" data-act="close">Ακύρωση</button><button class="btn primary" id="imp-go">Μετατροπή σε συνταγή</button></div>`, () => {
      let chosen = null;
      const pick = (ev) => {
        chosen = ev.target.files[0] || null; ev.target.value = "";
        const c = $("imp-chosen"); c.hidden = !chosen; c.textContent = chosen ? `Επιλέχθηκε: ${chosen.name}` : "";
      };
      $("imp-camera").addEventListener("change", pick);
      $("imp-file").addEventListener("change", pick);
      $("imp-go").addEventListener("click", async () => {
        const err = $("imp-err"), status = $("imp-status"), go = $("imp-go");
        err.hidden = true;
        let text = $("imp-text").value.trim();
        if (!chosen && !text) { err.textContent = "Διάλεξε φωτογραφία ή αρχείο, ή επικόλλησε το κείμενο της συνταγής."; err.hidden = false; return; }
        go.disabled = true; status.hidden = false; status.textContent = "Διαβάζω τη συνταγή… Μπορεί να πάρει έως ένα λεπτό.";
        try {
          const body = {};
          if (chosen) {
            const name = chosen.name.toLowerCase();
            if (chosen.type.startsWith("image/")) {
              body.file = { media_type: "image/jpeg", data: await fileToBase64(await resizeImage(chosen, 2000, 0.85)) };
            } else if (chosen.type === "application/pdf" || name.endsWith(".pdf")) {
              if (chosen.size > 9 * 1024 * 1024) throw new Error(AI_ERRORS.too_large);
              body.file = { media_type: "application/pdf", data: await fileToBase64(chosen) };
            } else if (name.endsWith(".docx")) {
              const m = await loadMammoth();
              const r = await m.extractRawText({ arrayBuffer: await chosen.arrayBuffer() });
              text = [r.value, text].filter(Boolean).join("\n\n");
            } else if (name.endsWith(".doc")) {
              throw new Error("Τα παλιά αρχεία .doc δεν διαβάζονται. Άνοιξέ το στο Word και αποθήκευσέ το ως .docx.");
            } else {
              text = [await chosen.text(), text].filter(Boolean).join("\n\n");
            }
          }
          if (text) body.text = text;
          let result = ai ? await readWithAi(body) : { fallback: true };
          if (result.fallback) {
            if (!text) throw new Error("Η ανάγνωση φωτογραφιών και PDF δεν είναι ενεργή. Ανέβασε Word ή επικόλλησε το κείμενο της συνταγής.");
            result = { recipes: parseRecipeText(text) };
          }
          if (result.error) throw new Error(result.error);
          if (!result.recipes.length) throw new Error("Δεν βρήκα συνταγή σε αυτό. Δοκίμασε πιο καθαρή φωτογραφία ή επικόλλησε το κείμενο.");
          closeModal();
          reviewImported(result.recipes);
        } catch (e) {
          status.hidden = true; go.disabled = false;
          err.textContent = e && e.message && /[α-ω]/i.test(e.message) ? e.message : "Δεν άνοιξε το αρχείο. Δοκίμασε ξανά ή επικόλλησε το κείμενο.";
          err.hidden = false;
        }
      });
    });
  }

  function reviewImported(list) {
    const restId = S.restaurants.some((r) => r.id === S.sel) ? S.sel : "";
    if (list.length === 1) {
      S.edit = { ...list[0], restaurantId: restId };
      S.view = "form"; render(); window.scrollTo(0, 0);
      toast("Έλεγξε τη συνταγή και πάτα Αποθήκευση");
      return;
    }
    const restOpts = `<option value="">Χωρίς εστιατόριο</option>` + S.restaurants.map((r) => `<option value="${esc(r.id)}" ${restId === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("");
    modal(`<h3>Βρέθηκαν ${list.length} συνταγές</h3>
      <p>Διάλεξε ποιες θα αποθηκευτούν. Μετά μπορείς να ανοίξεις την καθεμία και να τη διορθώσεις.</p>
      <label class="f">Εστιατόριο<select id="imp-rest">${restOpts}</select></label>
      <div class="import-list">${list.map((r, i) => `<label><input type="checkbox" id="imp-${i}" checked> <span><b>${esc(r.title)}</b><small>${r.ingredients.length} υλικά · ${r.steps.length} βήματα</small></span></label>`).join("")}</div>
      <div id="imp-err" class="err" hidden></div>
      <div class="form-actions"><button class="btn" data-act="close">Ακύρωση</button><button class="btn primary" id="imp-save">Αποθήκευση</button></div>`, () => {
      $("imp-save").addEventListener("click", async () => {
        const rest = $("imp-rest").value;
        const rows = list.filter((_, i) => $("imp-" + i).checked).map((r) => toRec({ ...r, restaurantId: rest }));
        if (!rows.length) { closeModal(); return; }
        $("imp-save").disabled = true;
        try {
          check(await sb.from("recipes").insert(rows));
          closeModal(); S.view = "list"; S.sel = rest || "all"; await loadAll();
          toast(`Αποθηκεύτηκαν ${rows.length} συνταγές`);
        } catch (e) { $("imp-save").disabled = false; const er = $("imp-err"); er.textContent = writeError(e); er.hidden = false; }
      });
    });
  }

  // ---------- units: conversion to grams / ml ----------
  const UNIT_INFO = {
    g: ["m", 1], gr: ["m", 1], "γρ": ["m", 1], "γρ.": ["m", 1], kg: ["m", 1000], "κιλό": ["m", 1000], "κιλά": ["m", 1000], mg: ["m", 0.001], oz: ["m", 28.35], lb: ["m", 453.6],
    ml: ["v", 1], l: ["v", 1000], lt: ["v", 1000], "λτ": ["v", 1000], cl: ["v", 10], dl: ["v", 100],
    "κ.σ.": ["v", 15], "κσ": ["v", 15], tbsp: ["v", 15], "κ.γ.": ["v", 5], "κγ": ["v", 5], tsp: ["v", 5],
    "φλ.": ["v", 240], "φλιτζάνι": ["v", 240], "φλιτζάνια": ["v", 240], cup: ["v", 240],
    "τεμ": ["c", 1], "τεμ.": ["c", 1], "τεμάχια": ["c", 1], pcs: ["c", 1],
  };
  const unitInfo = (u) => { const x = UNIT_INFO[(u || "").trim().toLowerCase()]; return x ? { dim: x[0], f: x[1] } : null; };
  function fmtBase(dim, base) {
    let n = base, u = dim === "m" ? "g" : dim === "v" ? "ml" : "τεμ";
    if (dim === "m" && n >= 1000) { n /= 1000; u = "kg"; }
    if (dim === "v" && n >= 1000) { n /= 1000; u = "l"; }
    const d = n >= 100 ? 0 : n >= 10 ? 1 : 2;
    return { q: nf(n, d), u };
  }
  function showQty(qty, unit) {
    if (qty != null && S.units === "metric") { const info = unitInfo(unit); if (info) return fmtBase(info.dim, qty * info.f); }
    return fmtQty(qty, unit);
  }
  function unitToggle() {
    return `<span class="seg" role="group" aria-label="Μονάδες">
      <button type="button" data-act="units" data-u="orig" class="${S.units !== "metric" ? "on" : ""}">Όπως γράφτηκαν</button>
      <button type="button" data-act="units" data-u="metric" class="${S.units === "metric" ? "on" : ""}">g / ml</button></span>`;
  }

  // ---------- costing (food cost) ----------
  const priceKey = (name) => String(name || "").split(",")[0].trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
  const euro = (n) => n == null || !isFinite(n) ? "—" : n.toLocaleString(LOCALE, { style: "currency", currency: "EUR" });
  const PRICE_DIM = { kg: "m", l: "v", "τεμ": "c" };
  async function loadPrices(ownerId) {
    const { data, error } = await sb.from("ingredient_prices").select("*").eq("user_id", ownerId);
    S.prices = {};
    if (!error) (data || []).forEach((p) => { S.prices[p.name_key] = { name: p.name, price: Number(p.price), unit: p.unit }; });
  }
  // Cost of one ingredient line after scaling. Returns { cost, approx } or null when it can't be priced.
  // Component recipes ("συνταγές συστατικών"): a main ingredient like "45 g σάλτσα ταχίνι"
  // links to the component named "Σάλτσα ταχίνι" of the same recipe.
  const findComp = (r, name) => r && (r.components || []).find((c) => c.name && priceKey(c.name) === priceKey(name));
  function compStats(c) {
    let weight = 0, cost = 0, missing = 0;
    (c.ingredients || []).forEach((i) => {
      if (i.qty == null) return;
      const info = unitInfo(i.unit);
      if (info && info.dim !== "c") weight += i.qty * info.f;
      const lc = lineCost(i, 1);
      if (lc) cost += lc.cost; else missing++;
    });
    return { weight, cost, missing };
  }
  function lineCost(i, factor, r) {
    const comp = findComp(r, i.name);
    if (comp && i.qty != null) {
      const info = unitInfo(i.unit), st = compStats(comp);
      if (info && info.dim !== "c" && st.weight > 0) return { cost: i.qty * factor * info.f * (st.cost / st.weight), approx: st.missing > 0, comp: comp.name };
    }
    const p = S.prices[priceKey(i.name)];
    if (!p || i.qty == null) return null;
    const pdim = PRICE_DIM[p.unit];
    const info = unitInfo(i.unit);
    if (!info) return pdim === "c" && !i.unit ? { cost: i.qty * factor * p.price, approx: false } : null;
    const base = i.qty * factor * info.f;
    if (info.dim === pdim) return { cost: pdim === "c" ? base * p.price : (base / 1000) * p.price, approx: false };
    if (pdim !== "c" && info.dim !== "c") return { cost: (base / 1000) * p.price, approx: true }; // g <-> ml, as if water
    return null;
  }
  const isPortions = (u) => /μερίδ|μεριδ|άτομ|ατομ|πιάτ|πιατ|portion|serving|plate|τεμ/i.test(u || "");
  function guessPriceUnit(i) { const info = unitInfo(i.unit); return info ? (info.dim === "v" ? "l" : info.dim === "c" ? "τεμ" : "kg") : (i.unit ? "kg" : "τεμ"); }

  function costingHtml(r, factor, target) {
    const ro = !!S.viewing;
    let total = 0, missing = 0, approx = false;
    const row = (i, idx, f, c) => {
      const p = S.prices[priceKey(i.name)];
      const q = showQty(i.qty != null ? i.qty * f : null, i.unit);
      const unit = p ? p.unit : guessPriceUnit(i);
      if (c && c.comp) return `<tr>
        <td class="c-name">${esc(i.name)}<small>${esc([q.q, q.u].filter(Boolean).join(" "))}</small></td>
        <td class="c-price"><span class="hint">από «${esc(c.comp)}»</span></td>
        <td class="c-cost">${euro(c.cost)}${c.approx ? "*" : ""}</td></tr>`;
      return `<tr>
        <td class="c-name">${esc(i.name)}<small>${esc([q.q, q.u].filter(Boolean).join(" "))}</small></td>
        <td class="c-price"><input id="price-${idx}" type="number" min="0" step="0.01" inputmode="decimal" placeholder="τιμή" value="${p ? esc(p.price) : ""}" ${ro ? "disabled" : ""} aria-label="Τιμή για ${esc(i.name)}">
          <select id="punit-${idx}" ${ro ? "disabled" : ""} aria-label="Μονάδα τιμής">${["kg", "l", "τεμ"].map((u) => `<option ${u === unit ? "selected" : ""}>${u}</option>`).join("")}</select></td>
        <td class="c-cost">${i.qty == null ? '<span class="hint">—</span>' : c ? euro(c.cost) + (c.approx ? "*" : "") : '<span class="hint">χωρίς τιμή</span>'}</td>
      </tr>`;
    };
    let rows = pricedLines(r).filter((x) => !x.comp).map((x) => {
      const c = lineCost(x.i, factor, r);
      if (x.i.qty != null) { if (c) { total += c.cost; approx = approx || c.approx; } else missing++; }
      return row(x.i, x.idx, factor, c);
    }).join("");
    (r.components || []).forEach((comp) => {
      const st = compStats(comp);
      const lines = pricedLines(r).filter((x) => x.comp === comp);
      if (!lines.length) return;
      rows += `<tr class="comp-row"><td colspan="3"><b>${esc(comp.name)}</b><small>${st.weight ? `Παρτίδα ≈ ${esc(fmtBase("m", st.weight).q)} ${esc(fmtBase("m", st.weight).u)} · ` : ""}${euro(st.cost)}${st.weight ? ` · ${euro(st.cost / st.weight * 1000)} / kg` : ""}</small></td></tr>`
        + lines.map((x) => row(x.i, x.idx, 1, lineCost(x.i, 1))).join("");
    });
    const portions = isPortions(r.yieldUnit) && target ? target : null;
    const perPortion = portions ? total / portions : null;
    const sell = r.sellPrice;
    const fc = perPortion && sell ? (perPortion / sell) * 100 : null;
    const fcClass = fc == null ? "" : fc <= 30 ? "good" : fc <= 35 ? "warn" : "bad";
    return `<div class="sec-title"><span>Κοστολόγηση</span><span class="hint">τιμές χωρίς ΦΠΑ, ανά kg / l / τεμ</span></div>
      ${rows ? `<div class="table-scroll"><table class="cost"><tbody>${rows}</tbody></table></div>` : `<p class="sheet-sub">Πρόσθεσε υλικά για να υπολογιστεί το κόστος.</p>`}
      <div class="cost-sum">
        <div><small>Κόστος${target && r.yieldQty ? ` για ${esc(nf(target, 2))} ${esc(r.yieldUnit || "")}` : ""}</small><b>${euro(total)}</b></div>
        ${portions ? `<div><small>Ανά μερίδα</small><b>${euro(perPortion)}</b></div>` : r.yieldQty && target ? `<div><small>Ανά ${esc(r.yieldUnit || "μονάδα")}</small><b>${euro(total / target)}</b></div>` : ""}
        ${portions ? `<label><small>Τιμή πώλησης / μερίδα</small><input id="sellPrice" type="number" min="0" step="0.1" inputmode="decimal" value="${sell != null ? esc(sell) : ""}" placeholder="€" ${ro ? "disabled" : ""}></label>
        <div class="fc ${fcClass}"><small>Food cost</small><b>${fc == null ? "—" : nf(fc, 1) + "%"}</b></div>
        <div><small>Μικτό κέρδος / μερίδα</small><b>${perPortion != null && sell ? euro(sell - perPortion) : "—"}</b></div>` : ""}
      </div>
      ${missing ? `<p class="hint">${missing} υλικά δεν έχουν τιμή ακόμα. Γράψε την τιμή τους και θα μπει σε όλες τις συνταγές σου.</p>` : ""}
      ${approx ? `<p class="hint">* Υπολογισμός με μετατροπή όγκου σε βάρος (σαν νερό), κατά προσέγγιση.</p>` : ""}
      ${!portions && r.yieldQty ? `<p class="hint">Για κόστος ανά μερίδα και food cost, βάλε «μερίδες» ως μονάδα απόδοσης.</p>` : ""}`;
  }
  // Every ingredient line that can carry a price: main ingredients (not linked to a component) and component ingredients.
  function pricedLines(r) {
    const out = [];
    (r.ingredients || []).forEach((i) => out.push({ i, comp: null, idx: out.length }));
    (r.components || []).forEach((comp) => (comp.ingredients || []).forEach((i) => out.push({ i, comp, idx: out.length })));
    return out;
  }
  function wireCosting(r, factor, target) {
    const box = $("costBox"); if (!box || S.viewing) return;
    pricedLines(r).forEach(({ i, idx }) => {
      if (!$("price-" + idx)) return;
      const save = async () => {
        const raw = $("price-" + idx).value.trim().replace(",", ".");
        const unit = $("punit-" + idx).value;
        const key = priceKey(i.name);
        try {
          if (raw === "") {
            if (!S.prices[key]) return;
            check(await sb.from("ingredient_prices").delete().eq("user_id", S.user.id).eq("name_key", key));
            delete S.prices[key];
          } else {
            const price = parseFloat(raw);
            if (!(price >= 0)) return;
            const name = String(i.name).split(",")[0].trim();
            check(await sb.from("ingredient_prices").upsert({ user_id: S.user.id, name_key: key, name, price, unit, updated_at: new Date().toISOString() }));
            S.prices[key] = { name, price, unit };
          }
          box.innerHTML = costingHtml(r, factor, target); wireCosting(r, factor, target);
        } catch (e) { toast(writeError(e)); }
      };
      $("price-" + idx).addEventListener("change", save);
      $("punit-" + idx).addEventListener("change", () => { if ($("price-" + idx).value.trim()) save(); });
    });
    const sp = $("sellPrice");
    if (sp) sp.addEventListener("change", async () => {
      const v = parseFloat(sp.value.replace(",", "."));
      const sell = v > 0 ? v : null;
      try {
        check(await sb.from("recipes").update({ sell_price: sell }).eq("id", r.id));
        r.sellPrice = sell; box.innerHTML = costingHtml(r, factor, target); wireCosting(r, factor, target);
      } catch (e) { toast(writeError(e)); }
    });
  }

  function pricesDialog() {
    toggleMenu(false);
    const rows = () => Object.entries(S.prices).sort((a, b) => a[1].name.localeCompare(b[1].name, "el"))
      .map(([k, p]) => `<div class="price-row" data-key="${esc(k)}"><span>${esc(p.name)}</span>
        <input type="number" min="0" step="0.01" inputmode="decimal" value="${esc(p.price)}" aria-label="Τιμή">
        <select aria-label="Μονάδα">${["kg", "l", "τεμ"].map((u) => `<option ${u === p.unit ? "selected" : ""}>${u}</option>`).join("")}</select>
        <button type="button" class="btn ghost" data-rm="1" aria-label="Αφαίρεση">✕</button></div>`).join("");
    modal(`<h3>Τιμές υλικών</h3>
      <p>Τιμές χωρίς ΦΠΑ. Κάθε τιμή ισχύει σε όλες τις συνταγές σου όπου υπάρχει το υλικό.</p>
      <div class="price-list" id="priceList">${rows() || '<p class="hint">Δεν έχεις βάλει ακόμα τιμές. Πρόσθεσε εδώ ή από την κοστολόγηση μιας συνταγής.</p>'}</div>
      <form class="price-row add" id="priceAdd" novalidate>
        <input id="pa-name" placeholder="Υλικό, π.χ. ντομάτα" aria-label="Υλικό">
        <input id="pa-price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="€" aria-label="Τιμή">
        <select id="pa-unit" aria-label="Μονάδα"><option>kg</option><option>l</option><option>τεμ</option></select>
        <button class="btn primary">Προσθήκη</button>
      </form>
      <div class="form-actions"><button class="btn" data-act="close">Κλείσιμο</button></div>`, () => {
      const list = $("priceList");
      const persist = async (key, name, price, unit) => {
        check(await sb.from("ingredient_prices").upsert({ user_id: S.user.id, name_key: key, name, price, unit, updated_at: new Date().toISOString() }));
        S.prices[key] = { name, price, unit };
      };
      list.addEventListener("change", async (ev) => {
        const row = ev.target.closest(".price-row"); if (!row) return;
        const key = row.dataset.key, p = S.prices[key];
        const price = parseFloat(row.querySelector("input").value.replace(",", "."));
        if (!(price >= 0)) return;
        try { await persist(key, p.name, price, row.querySelector("select").value); toast("Αποθηκεύτηκε"); } catch (e) { toast(writeError(e)); }
      });
      list.addEventListener("click", async (ev) => {
        const b = ev.target.closest("[data-rm]"); if (!b) return;
        const row = b.closest(".price-row"), key = row.dataset.key;
        try { check(await sb.from("ingredient_prices").delete().eq("user_id", S.user.id).eq("name_key", key)); delete S.prices[key]; row.remove(); } catch (e) { toast(writeError(e)); }
      });
      $("priceAdd").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const name = $("pa-name").value.trim(), price = parseFloat($("pa-price").value.replace(",", "."));
        if (!name || !(price >= 0)) { toast("Γράψε υλικό και τιμή."); return; }
        try { await persist(priceKey(name), name, price, $("pa-unit").value); closeModal(); pricesDialog(); } catch (e) { toast(writeError(e)); }
      });
    });
  }

  // ---------- share a recipe with a link ----------
  const randomToken = (n) => { const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; const b = crypto.getRandomValues(new Uint8Array(n)); return Array.from(b, (x) => a[x % a.length]).join(""); };
  const appUrl = () => location.origin + location.pathname;
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast("Αντιγράφηκε"); return true; }
    catch { toast("Δεν έγινε αντιγραφή. Πάτησε παρατεταμένα πάνω στο κείμενο."); return false; }
  }
  function shareDialog(r) {
    const paint = () => {
      const link = r.shareToken ? `${appUrl()}?share=${r.shareToken}` : "";
      modal(`<h3>Κοινοποίηση συνταγής</h3>
        ${link ? `<p>Όποιος έχει αυτόν τον σύνδεσμο βλέπει τη συνταγή «${esc(r.title)}», χωρίς λογαριασμό. Δεν βλέπει τιμές, κόστος ή τις άλλες συνταγές σου.</p>
          <input class="field mono" id="shareLink" readonly value="${esc(link)}" aria-label="Σύνδεσμος">
          <div class="form-actions" style="justify-content:flex-start">
            <button class="btn primary" id="shareCopy">Αντιγραφή συνδέσμου</button>
            ${navigator.share ? `<button class="btn" id="shareSend">Αποστολή…</button>` : ""}
            <button class="btn danger" id="shareStop">Σταμάτα την κοινοποίηση</button>
          </div>`
        : `<p>Φτιάξε σύνδεσμο για να στείλεις τη συνταγή «${esc(r.title)}» σε συνάδελφο, π.χ. με Viber ή WhatsApp. Θα τη βλέπει χωρίς λογαριασμό, χωρίς τιμές και κόστος.</p>
          <div class="form-actions" style="justify-content:flex-start"><button class="btn primary" id="shareMake">Δημιουργία συνδέσμου</button></div>`}
        <div class="form-actions"><button class="btn" data-act="close">Κλείσιμο</button></div>`, () => {
        const setToken = async (tok) => {
          try { check(await sb.from("recipes").update({ share_token: tok }).eq("id", r.id)); r.shareToken = tok; paint(); }
          catch (e) { toast(writeError(e)); }
        };
        if ($("shareMake")) $("shareMake").addEventListener("click", () => setToken(randomToken(24)));
        if ($("shareCopy")) $("shareCopy").addEventListener("click", () => copyText(link));
        if ($("shareLink")) $("shareLink").addEventListener("focus", (e) => e.target.select());
        if ($("shareSend")) $("shareSend").addEventListener("click", () => navigator.share({ title: r.title, text: tr(`Συνταγή: ${r.title}`), url: link }).catch(() => {}));
        if ($("shareStop")) $("shareStop").addEventListener("click", async () => { await setToken(null); toast("Ο σύνδεσμος δεν λειτουργεί πια"); });
      });
    };
    paint();
  }

  // Public page for a shared recipe (no sign-in).
  async function renderSharePage(tok) {
    $("authView").hidden = true; $("appView").hidden = true; $("setupView").hidden = true;
    const view = $("shareView"); view.hidden = false;
    const box = $("shareBox");
    box.innerHTML = `<div class="empty"><h3>Φόρτωση συνταγής…</h3></div>`;
    const { data, error } = await sb.rpc("get_shared_recipe", { tok });
    if (error || !data) {
      box.innerHTML = `<div class="empty"><h3>Η συνταγή δεν βρέθηκε</h3>Ο σύνδεσμος μπορεί να έχει σταματήσει να ισχύει. Ζήτα από τον μάγειρα να σου στείλει νέο.</div>`;
      return;
    }
    const r = fromRec({ ...data, id: "shared" });
    let photoUrl = null;
    if (r.photoPath) { const s = await sb.storage.from(BUCKET).createSignedUrl(r.photoPath, 3600); photoUrl = s.data && s.data.signedUrl; }
    let platingUrl = null;
    if (r.platingPhotoPath) { const s = await sb.storage.from(BUCKET).createSignedUrl(r.platingPhotoPath, 3600); platingUrl = s.data && s.data.signedUrl; }
    let target = r.yieldQty || 0;
    const paint = () => {
      const factor = r.yieldQty && target ? target / r.yieldQty : 1;
      const ings = r.ingredients.map((i) => { const f = showQty(i.qty != null ? i.qty * factor : null, i.unit); return `<tr><td class="q">${esc(f.q)}<span>${esc(f.u)}</span></td><td>${esc(i.name)}</td></tr>`; }).join("");
      const facts = [
        data.chef_name ? ["Σεφ", data.chef_name] : null,
        data.restaurant ? ["Εστιατόριο", data.restaurant] : null,
        r.yieldQty ? ["Απόδοση", `${nf(r.yieldQty, 2)} ${r.yieldUnit || ""}`] : null,
        r.prepMin ? ["Προετοιμασία", `${r.prepMin}′`] : null,
        r.cookMin ? ["Μαγείρεμα", `${r.cookMin}′`] : null,
      ].filter(Boolean);
      box.innerHTML = `<article class="sheet">
        ${photoUrl ? `<div class="hero-photo"><img src="${esc(photoUrl)}" alt=""></div>` : ""}
        <div class="sheet-head"><span class="tag">${esc(r.category || "Άλλο")}</span><h2>${esc(r.title)}</h2>
          <div class="facts">${facts.map(([k, v]) => `<div class="fact"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join("")}</div>
          ${r.allergens.length ? `<div class="allergens">${r.allergens.map((a) => `<span>${esc(a)}</span>`).join("")}</div>` : ""}</div>
        <div class="sheet-body">
          <section><div class="sec-title"><span>Υλικά</span>
            ${r.yieldQty ? `<label class="scaler">Για <input id="scale" type="number" min="0" step="any" inputmode="decimal" value="${esc(target)}"> ${esc(r.yieldUnit || "")}</label>` : ""}</div>
            <div class="units-row">${unitToggle()}</div>
            ${ings ? `<table class="ing"><tbody>${ings}</tbody></table>` : ""}</section>
          <section><div class="sec-title"><span>Εκτέλεση</span></div>
            ${r.steps.length ? `<ol class="steps">${r.steps.map((s) => `<li><span>${esc(s)}</span></li>`).join("")}</ol>` : ""}
            ${r.notes ? `<div class="ticket"><strong>Σημειώσεις σεφ</strong>${esc(r.notes)}</div>` : ""}</section>
        </div>
        ${componentsHtml(r)}
        ${platingHtml(r, platingUrl ? `<img src="${esc(platingUrl)}" alt="">` : "")}</article>
        <div class="share-cta">Θέλεις κι εσύ να κρατάς τις συνταγές σου οργανωμένες; <a class="btn primary" href="${esc(appUrl())}">Φτιάξε το δικό σου Τετράδιο Κουζίνας</a></div>`;
      const sc = $("scale");
      if (sc) sc.addEventListener("change", () => { const v = parseFloat(sc.value.replace(",", ".")); target = v > 0 ? v : r.yieldQty; paint(); });
      box.querySelectorAll("[data-act=units]").forEach((b) => b.addEventListener("click", () => { setUnits(b.dataset.u); paint(); }));
    };
    document.title = tr(`${r.title} · Τετράδιο Κουζίνας`);
    paint();
  }
  function setUnits(u) { S.units = u === "metric" ? "metric" : "orig"; try { localStorage.setItem("units", S.units); } catch { /* ignore */ } }

  // ---------- kitchen teams ----------
  async function loadTeams() {
    const { data, error } = await sb.rpc("my_teams");
    S.teams = error ? [] : (data || []);
    renderRail();
  }
  function openTeam(teamId) {
    const t = S.teams.find((x) => x.team_id === teamId); if (!t) return;
    S.viewing = { team: true, teamId: t.team_id, restaurantId: t.restaurant_id, name: t.team_name, ownerName: t.owner_name || t.owner_email };
    S.view = "list"; S.sel = "all"; S.q = ""; S.cat = ""; S.loaded = false; S.recipes = []; S.restaurants = [];
    render(); loadAll(); window.scrollTo(0, 0);
  }
  const inviteCode = () => randomToken(8).toUpperCase().replace(/[^A-Z2-9]/g, "X");

  async function teamDialog(rest) {
    modal(`<h3>Ομάδα κουζίνας</h3><div id="teamBox"><p>Φόρτωση…</p></div>`, async () => {
      const box = $("teamBox");
      const { data: rows, error } = await sb.from("teams").select("*").eq("restaurant_id", rest.id).eq("owner_id", S.user.id);
      if (error) { box.innerHTML = `<p class="err">${esc(writeError(error))}</p>`; return; }
      const team = rows && rows[0];
      if (!team) {
        box.innerHTML = `<p>Δώσε στην ομάδα σου στο «${esc(rest.name)}» πρόσβαση στις συνταγές αυτού του εστιατορίου. Βλέπουν μόνο αυτές, χωρίς τιμές και κόστος, και δεν μπορούν να τις αλλάξουν.</p>
          <div class="form-actions"><button class="btn" data-act="close">Ακύρωση</button><button class="btn primary" id="teamCreate">Δημιουργία ομάδας</button></div>`;
        $("teamCreate").addEventListener("click", async () => {
          $("teamCreate").disabled = true;
          try { check(await sb.from("teams").insert({ restaurant_id: rest.id, name: rest.name, invite_code: inviteCode() })); closeModal(); teamDialog(rest); }
          catch (e) { $("teamCreate").disabled = false; toast(writeError(e)); }
        });
        return;
      }
      const link = `${appUrl()}?join=${team.invite_code}`;
      const { data: members } = await sb.rpc("team_member_list", { tid: team.id });
      box.innerHTML = `<p>Στείλε τον κωδικό ή τον σύνδεσμο στους μάγειρες της ομάδας σου. Αφού μπουν, βλέπουν τις συνταγές του «${esc(rest.name)}», μόνο για ανάγνωση.</p>
        <div class="invite"><small>Κωδικός ομάδας</small><b id="inviteCode">${esc(team.invite_code)}</b></div>
        <div class="form-actions" style="justify-content:flex-start">
          <button class="btn primary" id="teamCopy">Αντιγραφή συνδέσμου</button>
          ${navigator.share ? `<button class="btn" id="teamSend">Αποστολή…</button>` : ""}
          <button class="btn ghost" id="teamNewCode">Νέος κωδικός</button>
        </div>
        <h4>Μέλη (${(members || []).length})</h4>
        <div class="members">${(members || []).map((m) => `<div class="member"><span class="avatar sm initials">${esc(initials(m.full_name || m.email))}</span>
          <span class="member-name"><b>${esc(m.full_name || m.email)}</b>${m.full_name ? `<small>${esc(m.email)}</small>` : ""}</span>
          <button class="btn ghost" data-remove="${esc(m.user_id)}">Αφαίρεση</button></div>`).join("") || '<p class="hint">Δεν έχει μπει κανείς ακόμα.</p>'}</div>
        <div class="form-actions"><button class="btn danger" id="teamEnd">Διάλυση ομάδας</button><button class="btn" data-act="close">Κλείσιμο</button></div>`;
      $("teamCopy").addEventListener("click", () => copyText(link));
      if ($("teamSend")) $("teamSend").addEventListener("click", () => navigator.share({ title: tr("Τετράδιο Κουζίνας"), text: tr(`Μπες στην ομάδα κουζίνας «${team.name}» με κωδικό ${team.invite_code}`), url: link }).catch(() => {}));
      $("teamNewCode").addEventListener("click", async () => {
        try { check(await sb.from("teams").update({ invite_code: inviteCode() }).eq("id", team.id)); toast("Ο παλιός κωδικός δεν ισχύει πια"); closeModal(); teamDialog(rest); } catch (e) { toast(writeError(e)); }
      });
      box.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", async () => {
        try { check(await sb.from("team_members").delete().eq("team_id", team.id).eq("user_id", b.dataset.remove)); b.closest(".member").remove(); toast("Αφαιρέθηκε από την ομάδα"); } catch (e) { toast(writeError(e)); }
      }));
      $("teamEnd").addEventListener("click", () => {
        confirmBox("Διάλυση ομάδας;", "Τα μέλη δεν θα βλέπουν πια τις συνταγές αυτού του εστιατορίου. Οι συνταγές σου μένουν όπως είναι.", "Διάλυση", async () => {
          check(await sb.from("teams").delete().eq("id", team.id)); toast("Η ομάδα διαλύθηκε");
        });
      });
    });
  }

  function joinDialog(code) {
    toggleMenu(false);
    modal(`<h3>Μπες σε ομάδα κουζίνας</h3>
      <p>Γράψε τον κωδικό που σου έδωσε ο σεφ. Θα βλέπεις τις συνταγές του εστιατορίου του, μόνο για ανάγνωση.</p>
      <form id="joinForm" style="display:flex;flex-direction:column;gap:12px" novalidate>
        <label class="f">Κωδικός ομάδας<input id="joinCode" class="mono" autocomplete="off" autocapitalize="characters" value="${esc(code || "")}" placeholder="π.χ. K7QX2MPA"></label>
        <div id="joinErr" class="err" hidden></div>
        <div class="form-actions"><button type="button" class="btn" data-act="close">Ακύρωση</button><button class="btn primary" id="joinGo">Είσοδος</button></div>
      </form>`, () => {
      $("joinForm").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const err = $("joinErr"); err.hidden = true;
        const c = $("joinCode").value.trim();
        if (!c) { err.textContent = "Γράψε τον κωδικό."; err.hidden = false; return; }
        $("joinGo").disabled = true;
        const { data, error } = await sb.rpc("join_team", { code: c });
        $("joinGo").disabled = false;
        if (error || !data) { err.textContent = "Κάτι δεν πήγε καλά. Δοκίμασε ξανά."; err.hidden = false; return; }
        if (!data.ok) { err.textContent = data.error === "own_team" ? "Αυτή είναι δική σου ομάδα." : "Δεν βρέθηκε ομάδα με αυτόν τον κωδικό. Έλεγξέ τον με τον σεφ."; err.hidden = false; return; }
        closeModal(); await loadTeams(); toast(`Μπήκες στην ομάδα «${data.name}»`); openTeam(data.team_id);
      });
    });
  }
  async function leaveTeam() {
    const v = S.viewing; if (!v || !v.team) return;
    confirmBox("Αποχώρηση από την ομάδα;", `Δεν θα βλέπεις πια τις συνταγές της ομάδας «${v.name}».`, "Αποχώρηση", async () => {
      check(await sb.from("team_members").delete().eq("team_id", v.teamId).eq("user_id", S.user.id));
      S.viewing = null; S.view = "list"; S.loaded = false; await loadTeams(); render(); loadAll(); toast("Αποχώρησες από την ομάδα");
    });
  }

  // ---------- order list ----------
  function saveOrder() { try { localStorage.setItem("order-" + S.user.id, JSON.stringify(S.order)); } catch { /* ignore */ } }
  function loadOrder() { try { S.order = JSON.parse(localStorage.getItem("order-" + S.user.id) || "{}") || {}; } catch { S.order = {}; } }
  function orderLines() {
    const buckets = new Map(), noQty = new Map();
    let total = 0, priced = 0;
    S.recipes.forEach((r) => {
      const amount = S.order[r.id]; if (!(amount > 0)) return;
      const factor = r.yieldQty ? amount / r.yieldQty : amount;
      const add = (i, factor, rr) => {
        const comp = findComp(rr, i.name);
        if (comp && i.qty != null) {
          const info = unitInfo(i.unit), st = compStats(comp);
          if (info && info.dim !== "c" && st.weight > 0) { (comp.ingredients || []).forEach((ci) => add(ci, (i.qty * factor * info.f) / st.weight, null)); return; }
        }
        const key = priceKey(i.name); if (!key) return;
        const label = String(i.name).split(",")[0].trim();
        if (i.qty == null) { if (!noQty.has(key)) noQty.set(key, label); return; }
        const info = unitInfo(i.unit);
        const bk = info ? `${key}|${info.dim}` : `${key}|u:${(i.unit || "").toLowerCase()}`;
        const b = buckets.get(bk) || { label, dim: info ? info.dim : null, unit: i.unit || "", amount: 0, cost: 0, hasCost: true };
        b.amount += info ? i.qty * factor * info.f : i.qty * factor;
        const c = lineCost(i, factor);
        if (c) b.cost += c.cost; else b.hasCost = false;
        buckets.set(bk, b);
      };
      (r.ingredients || []).forEach((i) => add(i, factor, r));
    });
    const lines = [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label, "el")).map((b) => {
      const f = b.dim ? fmtBase(b.dim, b.amount) : { q: nf(b.amount, b.amount >= 100 ? 0 : 2), u: b.unit };
      if (b.hasCost) { total += b.cost; priced++; }
      return { label: b.label, q: f.q, u: f.u, cost: b.hasCost ? b.cost : null };
    });
    return { lines, noQty: [...noQty.values()].sort((a, b) => a.localeCompare(b, "el")), total, priced };
  }
  function orderText() {
    const { lines, noQty } = orderLines();
    return [tr("Παραγγελία " + new Date().toLocaleDateString(LOCALE)), ...lines.map((l) => `- ${l.q} ${tr(l.u)} ${l.label}`.replace(/\s+/g, " ")), ...noQty.map((n) => `- ${n}`)].join("\n");
  }
  function renderOrderResult() {
    const box = $("orderResult"); if (!box) return;
    const { lines, noQty, total, priced } = orderLines();
    const chosen = S.recipes.filter((r) => S.order[r.id] > 0).length;
    if (!chosen) { box.innerHTML = `<div class="empty"><h3>Διάλεξε συνταγές</h3>Τσέκαρε τα πιάτα και γράψε πόσες μερίδες θα φτιάξεις. Η λίστα αθροίζει τα υλικά όλων μαζί.</div>`; return; }
    box.innerHTML = `<div class="sec-title"><span>Λίστα για ${chosen} ${chosen === 1 ? "συνταγή" : "συνταγές"}</span></div>
      <table class="order"><tbody>${lines.map((l) => `<tr><td class="q">${esc(l.q)}<span>${esc(l.u)}</span></td><td>${esc(l.label)}</td><td class="c-cost">${l.cost != null ? euro(l.cost) : ""}</td></tr>`).join("")}
      ${noQty.map((n) => `<tr><td class="q"><span>—</span></td><td>${esc(n)}</td><td></td></tr>`).join("")}</tbody></table>
      ${priced ? `<div class="cost-sum"><div><small>Κόστος (υλικά με τιμή)</small><b>${euro(total)}</b></div></div>` : ""}
      <div class="form-actions no-print" style="justify-content:flex-start">
        <button class="btn primary" id="orderCopy">Αντιγραφή</button>
        ${navigator.share ? `<button class="btn" id="orderSend">Αποστολή…</button>` : ""}
        <button class="btn" id="orderPrint">Εκτύπωση</button>
        <button class="btn ghost" id="orderClear">Καθαρισμός</button>
      </div>`;
    $("orderCopy").addEventListener("click", () => copyText(orderText()));
    if ($("orderSend")) $("orderSend").addEventListener("click", () => navigator.share({ title: tr("Παραγγελία"), text: orderText() }).catch(() => {}));
    $("orderPrint").addEventListener("click", () => window.print());
    $("orderClear").addEventListener("click", () => { S.order = {}; saveOrder(); renderOrder(); });
  }
  function renderOrder() {
    if (!S.order) loadOrder();
    const q = (S.orderQ || "").toLowerCase();
    const list = S.recipes.filter((r) => !q || r.title.toLowerCase().includes(q));
    main.innerHTML = `<div class="rest-head no-print"><div><h2>Λίστα παραγγελίας</h2><p>Διάλεξε πιάτα και μερίδες· τα υλικά αθροίζονται σε μία λίστα για τον προμηθευτή.</p></div>
        <div class="sheet-actions"><button class="btn" data-act="back">← Πίσω στις συνταγές</button></div></div>
      <div class="order-grid">
        <section class="order-pick no-print">
          <input type="search" class="field" id="orderQ" placeholder="Αναζήτηση πιάτου…" value="${esc(S.orderQ || "")}" aria-label="Αναζήτηση">
          <div class="pick-list">${list.map((r) => {
            const on = S.order[r.id] > 0;
            const unit = r.yieldQty ? (r.yieldUnit || "μερίδες") : "φορές";
            return `<div class="pick ${on ? "on" : ""}"><label><input type="checkbox" data-pick="${esc(r.id)}" ${on ? "checked" : ""}> <span>${esc(r.title)}</span></label>
              <span class="pick-amt"><input type="number" min="0" step="any" inputmode="decimal" data-amt="${esc(r.id)}" value="${on ? esc(S.order[r.id]) : esc(r.yieldQty || 1)}" aria-label="Ποσότητα για ${esc(r.title)}"> <small>${esc(unit)}</small></span></div>`;
          }).join("") || '<p class="hint">Δεν υπάρχουν συνταγές.</p>'}</div>
        </section>
        <section class="order-out" id="orderResult"></section>
      </div>`;
    renderOrderResult();
    const qi = $("orderQ");
    qi.addEventListener("input", () => { S.orderQ = qi.value; const pos = qi.selectionStart; renderOrder(); const n = $("orderQ"); n.focus(); n.setSelectionRange(pos, pos); });
    main.querySelectorAll("[data-pick]").forEach((cb) => cb.addEventListener("change", () => {
      const id = cb.dataset.pick, amt = parseFloat(main.querySelector(`[data-amt="${id}"]`).value.replace(",", "."));
      if (cb.checked) S.order[id] = amt > 0 ? amt : 1; else delete S.order[id];
      cb.closest(".pick").classList.toggle("on", cb.checked);
      saveOrder(); renderOrderResult();
    }));
    main.querySelectorAll("[data-amt]").forEach((inp) => inp.addEventListener("input", () => {
      const id = inp.dataset.amt, v = parseFloat(inp.value.replace(",", "."));
      const cb = main.querySelector(`[data-pick="${id}"]`);
      if (v > 0) { S.order[id] = v; cb.checked = true; cb.closest(".pick").classList.add("on"); } else { delete S.order[id]; cb.checked = false; cb.closest(".pick").classList.remove("on"); }
      saveOrder(); renderOrderResult();
    }));
  }

  // ---------- notifications: bell, phone push, chef activity ----------
  function relTime(d) {
    if (!d) return LANG === "en" ? "never" : "ποτέ";
    const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
    const en = LANG === "en";
    if (s < 60) return en ? "just now" : "μόλις τώρα";
    if (s < 3600) { const m = Math.round(s / 60); return en ? `${m} min ago` : `πριν ${m}′`; }
    if (s < 86400) { const h = Math.round(s / 3600); return en ? `${h} h ago` : `πριν ${h} ${h === 1 ? "ώρα" : "ώρες"}`; }
    const dd = Math.round(s / 86400);
    if (dd < 30) return en ? `${dd} d ago` : `πριν ${dd} ${dd === 1 ? "μέρα" : "μέρες"}`;
    return new Date(d).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" });
  }
  function notifText(n) {
    const p = n.params || {}, en = LANG === "en";
    switch (n.kind) {
      case "team_join": return en ? { title: "New team member", body: `${p.name} joined the team “${p.team}”.` } : { title: "Νέο μέλος στην ομάδα", body: `${p.name} μπήκε στην ομάδα «${p.team}».` };
      case "team_recipe": return en ? { title: `New recipe · ${p.team}`, body: p.title } : { title: `Νέα συνταγή · ${p.team}`, body: p.title };
      case "new_chef": return en ? { title: "New chef", body: `${p.email} signed up.` } : { title: "Νέος μάγειρας", body: `${p.email} γράφτηκε στην εφαρμογή.` };
      case "chef_active": return en ? { title: "Chef online", body: `${p.name} just opened the app.` } : { title: "Μάγειρας online", body: `${p.name} άνοιξε τώρα την εφαρμογή.` };
      default: return { title: n.kind, body: "" };
    }
  }
  function renderBell() {
    const unread = S.notifs.filter((n) => !n.read_at).length;
    const b = $("bellBadge");
    b.hidden = !unread; b.textContent = unread > 9 ? "9+" : String(unread);
  }
  let notifChannel = null;
  async function loadNotifs() {
    const { data, error } = await sb.from("notifications").select("*").eq("user_id", S.user.id).order("created_at", { ascending: false }).limit(50);
    S.notifs = error ? [] : (data || []);
    renderBell();
    if (notifChannel) sb.removeChannel(notifChannel);
    notifChannel = sb.channel("notif-" + S.user.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${S.user.id}` }, (payload) => {
        if (!payload.new || S.notifs.some((n) => n.id === payload.new.id)) return;
        S.notifs.unshift(payload.new); renderBell();
        const t = notifText(payload.new); toast(`${t.title}: ${t.body}`);
        if (payload.new.kind === "team_recipe" || payload.new.kind === "team_join") loadTeams();
      }).subscribe();
  }

  // Phone notifications (Web Push)
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function b64ToBytes(s) { const p = "=".repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); }
  async function pushState() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return isIos() && !isStandalone() ? "ios-install" : "unsupported";
    if (Notification.permission === "denied") return "denied";
    try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); return sub ? "on" : "off"; } catch { return "off"; }
  }
  async function enablePush() {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error(LANG === "en" ? "Notifications were not allowed." : "Δεν δόθηκε άδεια για ειδοποιήσεις.");
    const { data: key, error } = await sb.rpc("vapid_public_key");
    if (error || !key) throw new Error(LANG === "en" ? "Notifications are not available right now." : "Οι ειδοποιήσεις δεν είναι διαθέσιμες αυτή τη στιγμή.");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    const j = sub.toJSON();
    check(await sb.from("push_subscriptions").upsert({ endpoint: j.endpoint, user_id: S.user.id, p256dh: j.keys.p256dh, auth: j.keys.auth, lang: LANG }));
  }
  async function disablePush() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
  }
  async function syncPushLang() {
    try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await sb.from("push_subscriptions").update({ lang: LANG }).eq("endpoint", sub.endpoint); } catch { /* ignore */ }
  }

  async function notifDialog() {
    toggleMenu(false);
    const state = await pushState();
    const en = LANG === "en";
    const pushHtml = {
      on: `<span>${en ? "Phone notifications are <b>on</b> on this device." : "Οι ειδοποιήσεις στο κινητό είναι <b>ενεργές</b> σε αυτή τη συσκευή."}</span><button class="btn ghost" id="pushOff">${en ? "Turn off" : "Απενεργοποίηση"}</button>`,
      off: `<span>${en ? "Get notifications on this device even when the app is closed." : "Λάβε ειδοποιήσεις σε αυτή τη συσκευή, ακόμα κι όταν η εφαρμογή είναι κλειστή."}</span><button class="btn primary" id="pushOn">${en ? "Turn on" : "Ενεργοποίηση"}</button>`,
      denied: `<span>${en ? "Notifications are blocked for this site. Allow them in your browser or phone settings." : "Οι ειδοποιήσεις είναι μπλοκαρισμένες. Επίτρεψέ τες από τις ρυθμίσεις του browser ή του κινητού."}</span>`,
      "ios-install": `<span>${en ? "On iPhone, first add the app to your Home Screen (Share → Add to Home Screen), open it from there, and turn notifications on." : "Στο iPhone, πρώτα πρόσθεσε την εφαρμογή στην αρχική οθόνη (Κοινή χρήση → Προσθήκη στην οθόνη αφετηρίας), άνοιξέ την από εκεί και ενεργοποίησε τις ειδοποιήσεις."}</span>`,
      unsupported: `<span>${en ? "This browser doesn't support phone notifications." : "Αυτός ο browser δεν υποστηρίζει ειδοποιήσεις στο κινητό."}</span>`,
    }[state];
    const items = S.notifs.map((n) => {
      const t = notifText(n);
      return `<button class="notif ${n.read_at ? "" : "unread"}" data-notif="${esc(n.id)}"><b>${esc(t.title)}</b><span>${esc(t.body)}</span><small>${esc(relTime(n.created_at))}</small></button>`;
    }).join("");
    modal(`<h3>${en ? "Notifications" : "Ειδοποιήσεις"}</h3>
      <div class="push-box">${pushHtml}</div>
      <div id="pushErr" class="err" hidden></div>
      <div class="notif-list">${items || `<p class="hint">${en ? "No notifications yet." : "Δεν έχεις ειδοποιήσεις ακόμα."}</p>`}</div>
      <div class="form-actions"><button class="btn" data-act="close">${en ? "Close" : "Κλείσιμο"}</button></div>`, (o) => {
      const fail = (e) => { const er = $("pushErr"); er.textContent = (e && e.message) || (en ? "Something went wrong." : "Κάτι δεν πήγε καλά."); er.hidden = false; };
      if ($("pushOn")) $("pushOn").addEventListener("click", async () => { $("pushOn").disabled = true; try { await enablePush(); toast(en ? "Phone notifications on" : "Οι ειδοποιήσεις ενεργοποιήθηκαν"); closeModal(); notifDialog(); } catch (e) { $("pushOn").disabled = false; fail(e); } });
      if ($("pushOff")) $("pushOff").addEventListener("click", async () => { try { await disablePush(); closeModal(); notifDialog(); } catch (e) { fail(e); } });
      o.querySelectorAll("[data-notif]").forEach((b) => b.addEventListener("click", () => {
        const n = S.notifs.find((x) => x.id === b.dataset.notif); if (!n) return;
        closeModal();
        const p = n.params || {};
        if (n.kind === "team_recipe" && p.team_id) openTeam(p.team_id);
        else if (n.kind === "team_join" && p.restaurant_id) { S.viewing = null; S.view = "list"; S.sel = p.restaurant_id; S.loaded = false; render(); loadAll(); }
        else if ((n.kind === "new_chef" || n.kind === "chef_active") && S.isAdmin) openAdmin();
      }));
    });
    // Mark everything as read once the list has been shown.
    if (S.notifs.some((n) => !n.read_at)) {
      const now = new Date().toISOString();
      S.notifs.forEach((n) => { if (!n.read_at) n.read_at = now; });
      renderBell();
      sb.from("notifications").update({ read_at: now }).eq("user_id", S.user.id).is("read_at", null).then(() => {});
    }
  }

  // Tells the server this chef is using the app (every few minutes while it's open).
  let activityTimer = null;
  function startActivity() {
    const ping = () => { if (S.user && document.visibilityState === "visible") sb.rpc("touch_activity").then(() => {}); };
    ping();
    clearInterval(activityTimer);
    activityTimer = setInterval(ping, 4 * 60 * 1000);
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.user) sb.rpc("touch_activity").then(() => {}); });

  // ---------- menu: backup, import, install, logout ----------
  function toggleMenu(open) { $("menu").hidden = !open; $("menuBtn").setAttribute("aria-expanded", String(open)); }
  $("menuBtn").addEventListener("click", () => toggleMenu($("menu").hidden));

  $("backupBtn").addEventListener("click", () => {
    toggleMenu(false);
    const data = JSON.stringify({ exported: new Date().toISOString(), restaurants: S.restaurants, recipes: S.recipes }, null, 2);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.download = `syntages-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("Το αντίγραφο κατέβηκε");
  });

  // Import a backup file (also the one from the claude.ai version). Adds everything as new entries.
  $("importFile").addEventListener("change", async (ev) => {
    toggleMenu(false);
    const file = ev.target.files[0]; ev.target.value = "";
    if (!file) return;
    let json;
    try { json = JSON.parse(await file.text()); } catch { toast("Το αρχείο δεν είναι αντίγραφο του Τετραδίου."); return; }
    const rests = Array.isArray(json.restaurants) ? json.restaurants : [];
    const recs = Array.isArray(json.recipes) ? json.recipes : [];
    if (!rests.length && !recs.length) { toast("Το αρχείο δεν έχει συνταγές."); return; }
    confirmBox("Εισαγωγή αντιγράφου;", `Θα προστεθούν ${rests.length} εστιατόρια και ${recs.length} συνταγές.`, "Εισαγωγή", async () => {
      const idMap = {};
      for (const r of rests) {
        if (!r || !r.name) continue;
        const row = check(await sb.from("restaurants").insert({ name: String(r.name), city: r.city || "", years: r.years || "", role: r.role || "" }).select().single());
        idMap[r.id] = row.id;
      }
      const rows = recs.filter((r) => r && r.title).map((r) => toRec({
        ...r, restaurantId: idMap[r.restaurantId] || "",
        ingredients: Array.isArray(r.ingredients) ? r.ingredients : [], steps: Array.isArray(r.steps) ? r.steps : [], allergens: Array.isArray(r.allergens) ? r.allergens : [],
      }));
      for (let i = 0; i < rows.length; i += 100) check(await sb.from("recipes").insert(rows.slice(i, i + 100)));
      await loadAll(); toast("Η εισαγωγή ολοκληρώθηκε");
    });
  });

  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; $("installBtn").hidden = false; });
  $("installBtn").addEventListener("click", async () => { toggleMenu(false); if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $("installBtn").hidden = true; });

  $("logoutBtn").addEventListener("click", async () => { toggleMenu(false); clearInterval(activityTimer); if (notifChannel) { sb.removeChannel(notifChannel); notifChannel = null; } await sb.auth.signOut(); });
  $("bellBtn").addEventListener("click", notifDialog);
  $("langBtn").textContent = LANG === "en" ? "Ελληνικά" : "English";
  $("langBtn").addEventListener("click", () => { toggleMenu(false); setLang(LANG === "en" ? "el" : "en"); });
  $("authLang").textContent = LANG === "en" ? "Ελληνικά" : "English";
  $("authLang").addEventListener("click", () => setLang(LANG === "en" ? "el" : "en"));
  $("profileBtn").addEventListener("click", () => profileDialog(false));
  $("pricesBtn").addEventListener("click", pricesDialog);
  $("joinBtn").addEventListener("click", () => joinDialog(""));

  // ---------- auth ----------
  let authMode = "login"; // login | signup | forgot | reset
  function setAuthMode(mode) {
    authMode = mode;
    const texts = {
      login: ["Συνδέσου για να δεις τις συνταγές σου.", "Σύνδεση", "Δεν έχω λογαριασμό"],
      signup: ["Φτιάξε λογαριασμό με το email σου. Οι άλλοι μάγειρες δεν βλέπουν τις συνταγές σου. Ο διαχειριστής της εφαρμογής έχει πρόσβαση για υποστήριξη.", "Δημιουργία λογαριασμού", "Έχω ήδη λογαριασμό"],
      forgot: ["Γράψε το email σου και θα σου στείλουμε σύνδεσμο για νέο κωδικό.", "Αποστολή συνδέσμου", "Πίσω στη σύνδεση"],
      reset: ["Γράψε τον νέο σου κωδικό.", "Αποθήκευση κωδικού", "Πίσω στη σύνδεση"],
    }[mode];
    $("authIntro").textContent = texts[0];
    $("a-submit").textContent = texts[1];
    $("toSignup").textContent = texts[2];
    $("toForgot").hidden = mode !== "login";
    $("emailRow").hidden = mode === "reset";
    $("passRow").hidden = mode === "forgot";
    $("a-pass").autocomplete = mode === "login" ? "current-password" : "new-password";
    $("a-pass").previousSibling.textContent = mode === "reset" ? "Νέος κωδικός" : "Κωδικός";
    $("a-err").hidden = true; $("a-ok").hidden = true;
  }
  $("toSignup").addEventListener("click", () => setAuthMode(authMode === "login" ? "signup" : "login"));
  $("toForgot").addEventListener("click", () => setAuthMode("forgot"));

  function authErr(e) {
    const m = (e && e.message) || "";
    if (/invalid login/i.test(m)) return "Λάθος email ή κωδικός.";
    if (/not confirmed/i.test(m)) return "Πρώτα επιβεβαίωσε το email σου από τον σύνδεσμο που σου στείλαμε.";
    if (/already registered/i.test(m)) return "Υπάρχει ήδη λογαριασμός με αυτό το email. Πάτα «Έχω ήδη λογαριασμό».";
    if (/password/i.test(m)) return "Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.";
    if (/rate limit/i.test(m)) return "Πολλές προσπάθειες. Περίμενε λίγα λεπτά και δοκίμασε ξανά.";
    if (/fetch|network/i.test(m)) return "Δεν υπάρχει σύνδεση στο ίντερνετ.";
    return "Κάτι δεν πήγε καλά. Δοκίμασε ξανά.";
  }

  $("authForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = $("a-email").value.trim(), password = $("a-pass").value;
    const err = $("a-err"), ok = $("a-ok"), btn = $("a-submit");
    err.hidden = true; ok.hidden = true;
    if (authMode !== "reset" && !/^\S+@\S+\.\S+$/.test(email)) { err.textContent = "Γράψε ένα σωστό email."; err.hidden = false; return; }
    if (authMode !== "forgot" && password.length < 6) { err.textContent = "Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες."; err.hidden = false; return; }
    btn.disabled = true;
    const redirectTo = location.origin + location.pathname;
    try {
      if (authMode === "login") {
        const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error;
      } else if (authMode === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } }); if (error) throw error;
        if (!data.session) { ok.textContent = "Σου στείλαμε email. Πάτα τον σύνδεσμο μέσα για να ενεργοποιηθεί ο λογαριασμός και μετά συνδέσου."; ok.hidden = false; }
      } else if (authMode === "forgot") {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo }); if (error) throw error;
        ok.textContent = "Αν υπάρχει λογαριασμός με αυτό το email, σου στείλαμε σύνδεσμο για νέο κωδικό."; ok.hidden = false;
      } else if (authMode === "reset") {
        const { error } = await sb.auth.updateUser({ password }); if (error) throw error;
        toast("Ο κωδικός άλλαξε"); showApp();
      }
    } catch (e) { err.textContent = authErr(e); err.hidden = false; }
    btn.disabled = false;
  });

  function showAuth(mode) { $("appView").hidden = true; $("authView").hidden = false; setAuthMode(mode || "login"); }
  function showApp() {
    $("authView").hidden = true; $("appView").hidden = false;
    $("whoEmail").textContent = (S.user && S.user.email) || "";
    renderMenuButton(); render(); loadAll(); checkAdmin(); loadProfile(); loadTeams(); loadNotifs(); startActivity();
    let pending = null; try { pending = localStorage.getItem("pendingJoin"); localStorage.removeItem("pendingJoin"); } catch { /* ignore */ }
    if (pending) setTimeout(() => joinDialog(pending), 600);
  }

  // ---------- owner / admin view ----------
  // ---------- chef profile: name and photo ----------
  const initials = (name) => (name || "?").trim().split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
  function avatarHtml(path, name, cls) {
    const u = path && photoUrls[path];
    return path
      ? `<span class="${cls}"><img data-photo="${esc(path)}" alt="" ${u ? `src="${esc(u.url)}"` : ""}></span>`
      : `<span class="${cls} initials" aria-hidden="true">${esc(initials(name))}</span>`;
  }
  function renderMenuButton() {
    const p = S.profile || {};
    const name = p.full_name || "";
    $("menuBtn").innerHTML = `<span class="menu-name">${esc(name || "Το προφίλ μου")}</span>${avatarHtml(p.avatar_path, name || (S.user && S.user.email), "avatar md")}`;
    $("whoEmail").textContent = [name, S.user && S.user.email].filter(Boolean).join(" · ");
  }
  let profilePrompted = false;
  async function loadProfile() {
    const { data, error } = await sb.from("profiles").select("*").eq("user_id", S.user.id).maybeSingle();
    if (error) return;
    S.profile = data || null;
    renderMenuButton();
    if (S.profile && S.profile.avatar_path) signPhotos();
    if (!S.profile && !profilePrompted) { profilePrompted = true; profileDialog(true); }
  }

  // Square crop for profile pictures.
  async function squareImage(file, size) {
    const big = await resizeImage(file, 1200, 0.9);
    const img = await createImageBitmap(big);
    const side = Math.min(img.width, img.height);
    const c = document.createElement("canvas"); c.width = c.height = size;
    c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.88));
    if (!blob) throw new Error("bad_image");
    return blob;
  }

  function profileDialog(first) {
    toggleMenu(false);
    const p = S.profile || {};
    let newPhoto = null, removePhoto = false;
    modal(`<h3>${first ? "Καλώς ήρθες! Φτιάξε το προφίλ σου" : "Το προφίλ μου"}</h3>
      ${first ? "<p>Βάλε το όνομά σου και, αν θέλεις, μια φωτογραφία σου.</p>" : ""}
      <form id="profForm" style="display:flex;flex-direction:column;gap:14px" novalidate>
        <div class="prof-photo">
          <span id="profAvatar"></span>
          <div class="photo-actions">
            <label class="btn" for="profFile" id="profPick"></label>
            <button type="button" class="btn ghost" id="profRemove">Αφαίρεση</button>
            <input type="file" id="profFile" accept="image/*" hidden>
            <span class="hint" id="profMsg"></span>
          </div>
        </div>
        <label class="f">Ονοματεπώνυμο<input id="profName" autocomplete="name" value="${esc(p.full_name)}" placeholder="π.χ. Γιάννης Παπαδάκης"></label>
        <p class="hint" style="margin:0">Λογαριασμός: ${esc(S.user.email)}</p>
        <div id="profErr" class="err" hidden></div>
        <div class="form-actions"><button type="button" class="btn" data-act="close">${first ? "Αργότερα" : "Ακύρωση"}</button><button class="btn primary" id="profSave">Αποθήκευση</button></div>
      </form>`, () => {
      const paint = () => {
        const has = newPhoto || (!removePhoto && p.avatar_path);
        const name = $("profName").value || S.user.email;
        $("profAvatar").innerHTML = newPhoto
          ? `<span class="avatar lg"><img src="${esc(newPhoto.preview)}" alt=""></span>`
          : avatarHtml(removePhoto ? null : p.avatar_path, name, "avatar lg");
        $("profPick").textContent = has ? "Αλλαγή φωτογραφίας" : "+ Φωτογραφία";
        $("profRemove").hidden = !has;
      };
      paint();
      $("profName").addEventListener("input", () => { if (!newPhoto && (removePhoto || !p.avatar_path)) paint(); });
      $("profFile").addEventListener("change", async (ev) => {
        const file = ev.target.files[0]; ev.target.value = "";
        if (!file) return;
        $("profMsg").textContent = "Επεξεργασία φωτογραφίας…";
        try {
          const blob = await squareImage(file, 512);
          if (newPhoto) URL.revokeObjectURL(newPhoto.preview);
          newPhoto = { blob, preview: URL.createObjectURL(blob) }; removePhoto = false;
          $("profMsg").textContent = ""; paint();
        } catch { $("profMsg").textContent = "Δεν άνοιξε η φωτογραφία. Δοκίμασε JPG ή PNG."; }
      });
      $("profRemove").addEventListener("click", () => {
        if (newPhoto) { URL.revokeObjectURL(newPhoto.preview); newPhoto = null; } else removePhoto = true;
        paint();
      });
      if (!first) $("profName").focus();
      $("profForm").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const err = $("profErr"); err.hidden = true;
        const full_name = $("profName").value.trim();
        if (!full_name) { err.textContent = "Γράψε το όνομά σου."; err.hidden = false; return; }
        $("profSave").disabled = true;
        try {
          let avatar_path = removePhoto ? null : (p.avatar_path || null);
          if (newPhoto) {
            avatar_path = `${S.user.id}/avatar/${Date.now()}.jpg`;
            check(await sb.storage.from(BUCKET).upload(avatar_path, newPhoto.blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false }));
            photoUrls[avatar_path] = { url: newPhoto.preview, at: Date.now() };
          }
          const row = check(await sb.from("profiles").upsert({ user_id: S.user.id, full_name, avatar_path, updated_at: new Date().toISOString() }).select().single());
          if (p.avatar_path && p.avatar_path !== avatar_path) sb.storage.from(BUCKET).remove([p.avatar_path]).catch(() => {});
          S.profile = row;
          if (S.chefs) { const me = S.chefs.find((c) => c.id === S.user.id); if (me) { me.full_name = full_name; me.avatar_path = avatar_path; } }
          closeModal(); renderMenuButton(); render(); toast("Το προφίλ αποθηκεύτηκε");
          setTimeout(() => signPhotos(), 1500);
        } catch (e) { $("profSave").disabled = false; err.textContent = writeError(e); err.hidden = false; }
      });
    });
  }

  async function checkAdmin() {
    const { data, error } = await sb.rpc("is_admin");
    S.isAdmin = !error && data === true;
    $("adminBtn").hidden = !S.isAdmin;
  }
  function renderBanner() {
    const b = $("viewBanner");
    if (!S.viewing) { b.hidden = true; return; }
    b.hidden = false;
    if (S.viewing.team) {
      b.innerHTML = `<span>Ομάδα κουζίνας: <b>${esc(S.viewing.name)}</b> · σεφ ${esc(S.viewing.ownerName)} · μόνο ανάγνωση</span>
        <span class="banner-actions"><button class="btn" data-act="my-notebook">Οι δικές μου συνταγές</button><button class="btn ghost" data-act="leave-team">Αποχώρηση</button></span>`;
      return;
    }
    b.innerHTML = `<span class="banner-who">${avatarHtml(S.viewing.avatar, S.viewing.name || S.viewing.email, "avatar sm")}<span>Συνταγές: <b>${esc(S.viewing.name || S.viewing.email)}</b> · μόνο ανάγνωση</span></span>
      <span class="banner-actions"><button class="btn" data-act="admin">← Όλοι οι μάγειρες</button><button class="btn ghost" data-act="my-notebook">Οι δικές μου συνταγές</button></span>`;
  }
  async function openAdmin() {
    S.viewing = null; S.view = "admin"; S.chefs = null; render(); window.scrollTo(0, 0);
    const [{ data, error }, act] = await Promise.all([sb.rpc("admin_chef_list"), sb.rpc("admin_activity")]);
    if (error) { S.chefs = []; notice("Δεν φόρτωσε η λίστα μαγείρων. Ανανέωσε τη σελίδα."); }
    else S.chefs = data || [];
    S.activity = {}; ((act && act.data) || []).forEach((a) => { S.activity[a.user_id] = a.last_seen_at; });
    if (S.view === "admin") renderAdmin();
    signPhotos();
  }
  const isOnline = (d) => !!d && Date.now() - new Date(d).getTime() < 6 * 60 * 1000;
  setInterval(async () => {
    if (S.view !== "admin" || !S.isAdmin || document.visibilityState !== "visible") return;
    const act = await sb.rpc("admin_activity");
    if (!act.error) { S.activity = {}; (act.data || []).forEach((a) => { S.activity[a.user_id] = a.last_seen_at; }); if (S.view === "admin") renderAdmin(); }
  }, 60 * 1000);
  function openChef(id) {
    const chef = (S.chefs || []).find((c) => c.id === id);
    if (!chef) return;
    if (chef.id === S.user.id) { S.viewing = null; }
    else S.viewing = { id: chef.id, email: chef.email, name: chef.full_name, avatar: chef.avatar_path };
    S.view = "list"; S.sel = "all"; S.q = ""; S.cat = ""; S.loaded = false; S.recipes = []; S.restaurants = [];
    render(); loadAll(); window.scrollTo(0, 0);
  }
  function renderAdmin() {
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" }) : "—";
    const head = `<div class="rest-head"><div><h2>Διαχείριση</h2><p>Όλοι οι μάγειρες της εφαρμογής. Πάτα έναν για να δεις τις συνταγές του.</p></div>
      <div class="sheet-actions"><button class="btn" data-act="my-notebook">Οι δικές μου συνταγές</button></div></div>`;
    if (!S.chefs) { main.innerHTML = head + `<div class="empty"><h3>Φόρτωση μαγείρων…</h3></div>`; return; }
    const tot = S.chefs.reduce((a, c) => ({ r: a.r + Number(c.recipes), e: a.e + Number(c.restaurants) }), { r: 0, e: 0 });
    const stats = `<div class="facts admin-stats">
      <div class="fact"><small>Μάγειρες</small><b>${S.chefs.length}</b></div>
      <div class="fact"><small>Συνταγές</small><b>${tot.r}</b></div>
      <div class="fact"><small>Εστιατόρια</small><b>${tot.e}</b></div>
      <div class="fact"><small>Online τώρα</small><b>${S.chefs.filter((c) => isOnline(S.activity[c.id])).length}</b></div></div>`;
    const rows = S.chefs.map((c) => `<button class="chef" data-chef="${esc(c.id)}">
        ${avatarHtml(c.avatar_path, c.full_name || c.email, "avatar")}
        <span class="chef-main"><b>${esc(c.full_name || c.email)}</b>${c.id === S.user.id ? ' <span class="example">ΕΣΥ</span>' : ""}
          ${c.full_name ? `<small>${esc(c.email)}</small>` : ""}
          <small class="${isOnline(S.activity[c.id]) ? "online" : ""}">${isOnline(S.activity[c.id]) ? "● Online τώρα" : "Ενεργός " + esc(relTime(S.activity[c.id] || c.last_sign_in_at))}</small>
          <small>Μέλος από ${esc(fmtDate(c.created_at))}</small></span>
        <span class="chef-num"><b>${Number(c.recipes)}</b><small>συνταγές</small></span>
        <span class="chef-num"><b>${Number(c.restaurants)}</b><small>εστιατόρια</small></span>
      </button>`).join("");
    main.innerHTML = head + stats + `<div class="chefs">${rows || '<div class="empty">Δεν υπάρχουν ακόμα μάγειρες.</div>'}</div>`;
  }

  const params = new URLSearchParams(location.search);
  const SHARE = params.get("share");
  if (params.get("join")) {
    try { localStorage.setItem("pendingJoin", params.get("join")); } catch { /* ignore */ }
    history.replaceState(null, "", location.pathname);
  }
  if (SHARE) renderSharePage(SHARE);

  sb.auth.onAuthStateChange((event, session) => {
    if (SHARE) return;
    if (event === "PASSWORD_RECOVERY") { S.user = session && session.user; showAuth("reset"); return; }
    const uid = session && session.user && session.user.id;
    if (uid && (!S.user || S.user.id !== uid)) {
      S.user = session.user; S.restaurants = []; S.recipes = []; S.loaded = false; S.view = "list"; S.sel = "all"; S.viewing = null; S.isAdmin = false; S.chefs = null; S.profile = null; profilePrompted = false; S.teams = []; S.order = null; S.prices = {}; S.notifs = []; $("adminBtn").hidden = true;
      if (authMode !== "reset" || $("authView").hidden) setTimeout(showApp, 0);
    } else if (!uid) {
      S.user = null; S.restaurants = []; S.recipes = []; S.loaded = false; S.viewing = null; S.isAdmin = false; S.chefs = null; S.profile = null; $("adminBtn").hidden = true;
      showAuth("login");
    }
  });

  // ---------- offline shell ----------
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
})();
