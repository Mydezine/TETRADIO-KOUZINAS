(() => {
  "use strict";

  const CATS = ["Ορεκτικά", "Σαλάτες", "Σούπες", "Ζυμαρικά & Ριζότο", "Κυρίως κρεατικά", "Ψάρια & Θαλασσινά", "Λαχανικά & Συνοδευτικά", "Σάλτσες & Βάσεις", "Γλυκά", "Αρτοποιία", "Ποτά & Κοκτέιλ", "Άλλο"];
  const ALLERGENS = ["Γλουτένη", "Καρκινοειδή", "Αυγά", "Ψάρια", "Αράπικα φιστίκια", "Σόγια", "Γάλα", "Ξηροί καρποί", "Σέλινο", "Μουστάρδα", "Σουσάμι", "Θειώδη", "Λούπινο", "Μαλάκια"];
  const UNITS = ["g", "gr", "γρ", "γρ.", "kg", "κιλό", "κιλά", "mg", "ml", "l", "lt", "λτ", "cl", "dl", "τεμ", "τεμ.", "τεμάχια", "κ.σ.", "κσ", "κ.γ.", "κγ", "φλ.", "φλιτζάνι", "φλιτζάνια", "πρέζα", "ματσάκι", "ματσάκια", "σκελίδα", "σκελίδες", "φύλλα", "κλωνάρια", "κλωνάρι", "φέτες", "φέτα", "oz", "lb", "tbsp", "tsp", "cup", "pcs"];

  const S = { restaurants: [], recipes: [], sel: "all", q: "", cat: "", view: "list", id: null, scale: null, edit: null, loaded: false, user: null };
  const $ = (id) => document.getElementById(id);
  const main = $("main");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = (n, d) => Number(n).toLocaleString("el-GR", { maximumFractionDigits: d });

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
  });
  const toRec = (d) => ({
    restaurant_id: d.restaurantId || null, title: d.title, category: d.category || "Άλλο",
    yield_qty: d.yieldQty ?? null, yield_unit: d.yieldUnit || "", prep_min: d.prepMin != null ? Math.round(d.prepMin) : null, cook_min: d.cookMin != null ? Math.round(d.cookMin) : null,
    ingredients: d.ingredients || [], steps: d.steps || [], allergens: d.allergens || [], notes: d.notes || "", updated_at: new Date().toISOString(),
  });

  async function loadAll() {
    const [r, p] = await Promise.all([
      sb.from("restaurants").select("*").order("name"),
      sb.from("recipes").select("*").order("title"),
    ]);
    if (r.error || p.error) { notice("Δεν φόρτωσαν οι συνταγές. Έλεγξε τη σύνδεσή σου και ανανέωσε τη σελίδα."); S.loaded = true; render(); return; }
    notice("");
    S.restaurants = r.data.map(fromRest);
    S.recipes = p.data.map(fromRec);
    S.loaded = true;
    if (S.view !== "form") render(); else renderRail();
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
    return text.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
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
        <div class="sheet-actions"><button class="btn" data-act="edit-rest">Επεξεργασία</button><button class="btn danger" data-act="del-rest">Διαγραφή</button></div></div>`;
    }
    const tools = `<div class="toolbar">
      <input type="search" id="q" placeholder="Αναζήτηση συνταγής ή υλικού…" value="${esc(S.q)}" aria-label="Αναζήτηση">
      <select id="cat" aria-label="Κατηγορία"><option value="">Όλες οι κατηγορίες</option>${CATS.map((c) => `<option ${S.cat === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
    </div>`;
    let body;
    if (!S.loaded) body = `<div class="empty"><h3>Φόρτωση συνταγών…</h3></div>`;
    else if (!S.recipes.length) body = `<div class="empty"><h3>Δεν έχεις γράψει ακόμα καμία συνταγή</h3>Πρόσθεσε πρώτα τα εστιατόρια που έχεις δουλέψει και μετά γράψε τις συνταγές σου.<br>Τις συνταγές σου τις βλέπεις μόνο εσύ.<br><button class="btn primary" data-act="new">+ Νέα συνταγή</button></div>`;
    else if (!list.length) body = `<div class="empty"><h3>Καμία συνταγή εδώ</h3>${S.q || S.cat ? "Δοκίμασε άλλη αναζήτηση ή κατηγορία." : "Δεν υπάρχουν ακόμα συνταγές σε αυτό το εστιατόριο."}<br><button class="btn primary" data-act="new">+ Νέα συνταγή</button></div>`;
    else body = `<div class="grid">${list.map((r) => {
      const t = (r.prepMin || 0) + (r.cookMin || 0);
      return `<button class="card" data-open="${esc(r.id)}">
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

  function renderDetail() {
    const r = S.recipes.find((x) => x.id === S.id);
    if (!r) { S.view = "list"; return render(); }
    const base = r.yieldQty || 0;
    const target = S.scale ?? base;
    const factor = base && target ? target / base : 1;
    const scaled = Math.abs(factor - 1) > 1e-9;
    const ings = (r.ingredients || []).map((i) => {
      const f = fmtQty(i.qty != null ? i.qty * factor : null, i.unit);
      return `<tr><td class="q">${esc(f.q)}<span>${esc(f.u)}</span></td><td>${esc(i.name)}</td></tr>`;
    }).join("");
    const facts = [
      ["Εστιατόριο", restName(r.restaurantId)],
      r.yieldQty ? ["Απόδοση", `${nf(r.yieldQty, 2)} ${r.yieldUnit || ""}`] : null,
      r.prepMin ? ["Προετοιμασία", `${r.prepMin}′`] : null,
      r.cookMin ? ["Μαγείρεμα", `${r.cookMin}′`] : null,
    ].filter(Boolean);
    main.innerHTML = `<div style="margin-bottom:12px"><button class="btn ghost" data-act="back">← Πίσω στις συνταγές</button></div>
    <article class="sheet">
      <div class="sheet-head">
        <span class="tag">${esc(r.category || "Άλλο")}</span>
        <h2>${esc(r.title)}</h2>
        <div class="facts">${facts.map(([k, v]) => `<div class="fact"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join("")}</div>
        ${(r.allergens || []).length ? `<div class="allergens" aria-label="Αλλεργιογόνα">${r.allergens.map((a) => `<span>${esc(a)}</span>`).join("")}</div>` : ""}
        <div class="sheet-actions">
          <button class="btn" data-act="edit">Επεξεργασία</button>
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
          ${ings ? `<table class="ing ${scaled ? "scaled" : ""}"><tbody>${ings}</tbody></table>` : `<p class="sheet-sub">Δεν έχουν γραφτεί υλικά.</p>`}
        </section>
        <section>
          <div class="sec-title"><span>Εκτέλεση</span></div>
          ${(r.steps || []).length ? `<ol class="steps">${r.steps.map((s) => `<li><span>${esc(s)}</span></li>`).join("")}</ol>` : `<p class="sheet-sub">Δεν έχουν γραφτεί βήματα.</p>`}
          ${r.notes ? `<div class="ticket"><strong>Σημειώσεις σεφ</strong>${esc(r.notes)}</div>` : ""}
        </section>
      </div>
    </article>`;
    const sc = $("scale");
    if (sc) sc.addEventListener("change", () => { const v = parseFloat(sc.value.replace(",", ".")); S.scale = v > 0 ? v : null; renderDetail(); });
  }

  function renderForm() {
    const e = S.edit || {};
    const restOpts = `<option value="">Χωρίς εστιατόριο</option>` + S.restaurants.map((r) => `<option value="${esc(r.id)}" ${e.restaurantId === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("");
    main.innerHTML = `<form class="form" id="recForm" novalidate>
      <h2>${e.id ? "Επεξεργασία συνταγής" : "Νέα συνταγή"}</h2>
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
      <fieldset><legend>Αλλεργιογόνα</legend><div class="checks">${ALLERGENS.map((a, i) => `<label><input type="checkbox" id="al-${i}" value="${esc(a)}" ${(e.allergens || []).includes(a) ? "checked" : ""}> ${esc(a)}</label>`).join("")}</div></fieldset>
      <label class="f">Σημειώσεις σεφ <span class="hint">Μυστικά, πλέιτινγκ, συντήρηση, προμηθευτές.</span>
        <textarea id="f-notes" rows="3">${esc(e.notes)}</textarea></label>
      <div id="f-err" class="err" hidden></div>
      <div class="form-actions">
        <button type="button" class="btn" data-act="cancel-form">Ακύρωση</button>
        <button type="submit" class="btn primary" id="f-save">Αποθήκευση</button>
      </div>
    </form>`;
    $("recForm").addEventListener("submit", saveRecipe);
    $("f-title").focus();
  }

  function render() {
    renderRail();
    if (S.view === "detail") renderDetail();
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
    };
    const btn = $("f-save"); btn.disabled = true; btn.textContent = "Αποθήκευση…";
    try {
      const id = S.edit && S.edit.id;
      const row = id
        ? check(await sb.from("recipes").update(toRec(data)).eq("id", id).select().single())
        : check(await sb.from("recipes").insert(toRec(data)).select().single());
      const rec = fromRec(row);
      S.recipes = S.recipes.filter((r) => r.id !== rec.id).concat(rec).sort((a, b) => a.title.localeCompare(b.title, "el"));
      S.edit = null; S.id = rec.id; S.scale = null; S.view = "detail";
      toast("Η συνταγή αποθηκεύτηκε"); render(); window.scrollTo(0, 0);
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
    const t = e.target.closest("[data-sel],[data-open],[data-act]");
    if (!t || t.closest("#overlay")) return;
    if (t.dataset.sel !== undefined) { S.sel = t.dataset.sel; S.view = "list"; render(); return; }
    if (t.dataset.open) { S.id = t.dataset.open; S.scale = null; S.view = "detail"; render(); window.scrollTo(0, 0); return; }
    const r = S.recipes.find((x) => x.id === S.id);
    const rest = S.restaurants.find((x) => x.id === S.sel);
    switch (t.dataset.act) {
      case "new": newRecipe(); break;
      case "back": S.view = "list"; render(); break;
      case "reset-scale": S.scale = null; renderDetail(); break;
      case "edit": S.edit = { ...r }; S.view = "form"; render(); break;
      case "dup": S.edit = { ...r, id: undefined, title: r.title + " (αντίγραφο)" }; S.view = "form"; render(); break;
      case "cancel-form": S.view = S.edit && S.edit.id ? "detail" : "list"; S.edit = null; render(); break;
      case "del":
        confirmBox("Διαγραφή συνταγής;", `Η συνταγή «${r.title}» θα σβηστεί οριστικά.`, "Διαγραφή", async () => {
          check(await sb.from("recipes").delete().eq("id", r.id));
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
  $("addRestBtn").addEventListener("click", () => restaurantForm());

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

  $("logoutBtn").addEventListener("click", async () => { toggleMenu(false); await sb.auth.signOut(); });

  // ---------- auth ----------
  let authMode = "login"; // login | signup | forgot | reset
  function setAuthMode(mode) {
    authMode = mode;
    const texts = {
      login: ["Συνδέσου για να δεις τις συνταγές σου.", "Σύνδεση", "Δεν έχω λογαριασμό"],
      signup: ["Φτιάξε λογαριασμό με το email σου. Τις συνταγές σου θα τις βλέπεις μόνο εσύ.", "Δημιουργία λογαριασμού", "Έχω ήδη λογαριασμό"],
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
    render(); loadAll();
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") { S.user = session && session.user; showAuth("reset"); return; }
    const uid = session && session.user && session.user.id;
    if (uid && (!S.user || S.user.id !== uid)) {
      S.user = session.user; S.restaurants = []; S.recipes = []; S.loaded = false; S.view = "list"; S.sel = "all";
      if (authMode !== "reset" || $("authView").hidden) setTimeout(showApp, 0);
    } else if (!uid) {
      S.user = null; S.restaurants = []; S.recipes = []; S.loaded = false;
      showAuth("login");
    }
  });

  // ---------- offline shell ----------
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
})();
