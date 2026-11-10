(() => {
  "use strict";

  const CATS = ["Ορεκτικά", "Σαλάτες", "Σούπες", "Ζυμαρικά & Ριζότο", "Κυρίως κρεατικά", "Ψάρια & Θαλασσινά", "Λαχανικά & Συνοδευτικά", "Σάλτσες & Βάσεις", "Γλυκά", "Αρτοποιία", "Ποτά & Κοκτέιλ", "Άλλο"];
  const ALLERGENS = ["Γλουτένη", "Καρκινοειδή", "Αυγά", "Ψάρια", "Αράπικα φιστίκια", "Σόγια", "Γάλα", "Ξηροί καρποί", "Σέλινο", "Μουστάρδα", "Σουσάμι", "Θειώδη", "Λούπινο", "Μαλάκια"];
  const UNITS = ["g", "gr", "γρ", "γρ.", "kg", "κιλό", "κιλά", "mg", "ml", "l", "lt", "λτ", "cl", "dl", "τεμ", "τεμ.", "τεμάχια", "κ.σ.", "κσ", "κ.γ.", "κγ", "φλ.", "φλιτζάνι", "φλιτζάνια", "πρέζα", "ματσάκι", "ματσάκια", "σκελίδα", "σκελίδες", "φύλλα", "κλωνάρια", "κλωνάρι", "φέτες", "φέτα", "oz", "lb", "tbsp", "tsp", "cup", "pcs"];

  const S = { restaurants: [], recipes: [], sel: "all", q: "", cat: "", view: "list", id: null, scale: null, edit: null, loaded: false, user: null, isAdmin: false, viewing: null, chefs: null, profile: null };
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
    photoPath: r.photo_path || null,
  });
  const toRec = (d) => ({
    restaurant_id: d.restaurantId || null, title: d.title, category: d.category || "Άλλο",
    yield_qty: d.yieldQty ?? null, yield_unit: d.yieldUnit || "", prep_min: d.prepMin != null ? Math.round(d.prepMin) : null, cook_min: d.cookMin != null ? Math.round(d.cookMin) : null,
    ingredients: d.ingredients || [], steps: d.steps || [], allergens: d.allergens || [], notes: d.notes || "", updated_at: new Date().toISOString(),
  });

  async function loadAll() {
    const owner = S.viewing ? S.viewing.id : S.user.id;
    const [r, p] = await Promise.all([
      sb.from("restaurants").select("*").eq("user_id", owner).order("name"),
      sb.from("recipes").select("*").eq("user_id", owner).order("title"),
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
      ${r.photoPath ? `<div class="hero-photo">${photoImg(r.photoPath)}</div>` : ""}
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
    renderPhotoBox();
    if (!e.title) $("f-title").focus();
  }

  function render() {
    document.body.classList.toggle("readonly", !!S.viewing);
    document.querySelector(".app").classList.toggle("admin-mode", S.view === "admin");
    renderBanner();
    renderRail();
    if (S.view === "admin") renderAdmin();
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
    const t = e.target.closest("[data-sel],[data-open],[data-act],[data-chef]");
    if (!t || t.closest("#overlay")) return;
    if (t.dataset.chef) { openChef(t.dataset.chef); return; }
    if (t.dataset.act === "admin") { openAdmin(); return; }
    if (t.dataset.act === "my-notebook") { S.viewing = null; S.view = "list"; S.sel = "all"; S.loaded = false; render(); loadAll(); return; }
    if (S.viewing && ["new", "import", "edit", "dup", "del", "edit-rest", "del-rest"].includes(t.dataset.act)) return;
    if (t.dataset.sel !== undefined) { S.sel = t.dataset.sel; S.view = "list"; render(); return; }
    if (t.dataset.open) { S.id = t.dataset.open; S.scale = null; S.view = "detail"; render(); window.scrollTo(0, 0); return; }
    const r = S.recipes.find((x) => x.id === S.id);
    const rest = S.restaurants.find((x) => x.id === S.sel);
    switch (t.dataset.act) {
      case "new": newRecipe(); break;
      case "import": importDialog(); break;
      case "back": S.view = "list"; render(); break;
      case "reset-scale": S.scale = null; renderDetail(); break;
      case "edit": S.edit = { ...r }; S.view = "form"; render(); break;
      case "dup": S.edit = { ...r, id: undefined, photoPath: null, title: r.title + " (αντίγραφο)" }; S.view = "form"; render(); break;
      case "cancel-form": if (S.edit && S.edit.newPhoto) URL.revokeObjectURL(S.edit.newPhoto.preview); S.view = S.edit && S.edit.id ? "detail" : "list"; S.edit = null; render(); break;
      case "del":
        confirmBox("Διαγραφή συνταγής;", `Η συνταγή «${r.title}» θα σβηστεί οριστικά.`, "Διαγραφή", async () => {
          check(await sb.from("recipes").delete().eq("id", r.id));
          removePhotoFiles(r.photoPath);
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
    S.recipes.forEach((r) => { if (r.photoPath) paths.push(r.photoPath, thumbOf(r.photoPath)); });
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
    const lines = text.split(/\r?\n/).map((l) => l.trim());
    const head = (l, words) => new RegExp(`^(${words})(?=[\\s:.]|$)[^\\n]{0,30}$`, "iu").test(l.replace(/[*#_]/g, "").trim());
    const ING = "υλικά|υλικα|συστατικά|συστατικα|ingredients";
    const STEP = "εκτέλεση|εκτελεση|οδηγίες|οδηγιες|τρόπος|τροπος|παρασκευή|παρασκευη|διαδικασία|διαδικασια|method|directions|instructions|preparation|steps";
    const NOTE = "σημειώσεις|σημειωσεις|σημείωση|σημειωση|tips|notes|μυστικά|μυστικα";
    let title = "", section = "", ings = [], steps = [], notes = [], yieldQty = null, yieldUnit = "μερίδες";
    for (const raw of lines) {
      if (!raw) continue;
      const l = raw.replace(/^[-•*·▪●]\s*/, "");
      const y = l.match(/(\d+(?:[.,]\d+)?)\s*(μερίδες|μερίδα|μεριδες|άτομα|ατομα|portions|servings)/i);
      if (y && !yieldQty) { yieldQty = parseFloat(y[1].replace(",", ".")); yieldUnit = /άτομ|ατομ/i.test(y[2]) ? "άτομα" : "μερίδες"; if (l.length < 30) continue; }
      if (head(l, ING)) { section = "ing"; continue; }
      if (head(l, STEP)) { section = "step"; continue; }
      if (head(l, NOTE)) { section = "note"; continue; }
      if (!title && !section) { title = l.replace(/[*#_]/g, "").trim(); continue; }
      if (section === "ing") ings.push(l);
      else if (section === "step") steps.push(l.replace(/^(\d+|[α-ω])[.)]\s*/i, ""));
      else if (section === "note") notes.push(l);
      else if (/^\d/.test(l) && l.length < 60) ings.push(l);
      else steps.push(l.replace(/^(\d+)[.)]\s*/, ""));
    }
    if (!title && !ings.length && !steps.length) return [];
    return [{ title: title || "Συνταγή χωρίς όνομα", category: "Άλλο", yieldQty, yieldUnit: yieldQty ? yieldUnit : "μερίδες", prepMin: null, cookMin: null,
      ingredients: parseIngredients(ings.join("\n")), steps, allergens: [], notes: notes.join("\n") }];
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
  $("profileBtn").addEventListener("click", () => profileDialog(false));

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
    renderMenuButton(); render(); loadAll(); checkAdmin(); loadProfile();
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
    b.innerHTML = `<span class="banner-who">${avatarHtml(S.viewing.avatar, S.viewing.name || S.viewing.email, "avatar sm")}<span>Συνταγές: <b>${esc(S.viewing.name || S.viewing.email)}</b> · μόνο ανάγνωση</span></span>
      <span class="banner-actions"><button class="btn" data-act="admin">← Όλοι οι μάγειρες</button><button class="btn ghost" data-act="my-notebook">Οι δικές μου συνταγές</button></span>`;
  }
  async function openAdmin() {
    S.viewing = null; S.view = "admin"; S.chefs = null; render(); window.scrollTo(0, 0);
    const { data, error } = await sb.rpc("admin_chef_list");
    if (error) { S.chefs = []; notice("Δεν φόρτωσε η λίστα μαγείρων. Ανανέωσε τη σελίδα."); }
    else S.chefs = data || [];
    if (S.view === "admin") renderAdmin();
    signPhotos();
  }
  function openChef(id) {
    const chef = (S.chefs || []).find((c) => c.id === id);
    if (!chef) return;
    if (chef.id === S.user.id) { S.viewing = null; }
    else S.viewing = { id: chef.id, email: chef.email, name: chef.full_name, avatar: chef.avatar_path };
    S.view = "list"; S.sel = "all"; S.q = ""; S.cat = ""; S.loaded = false; S.recipes = []; S.restaurants = [];
    render(); loadAll(); window.scrollTo(0, 0);
  }
  function renderAdmin() {
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString("el-GR", { day: "numeric", month: "short", year: "numeric" }) : "—";
    const head = `<div class="rest-head"><div><h2>Διαχείριση</h2><p>Όλοι οι μάγειρες της εφαρμογής. Πάτα έναν για να δεις τις συνταγές του.</p></div>
      <div class="sheet-actions"><button class="btn" data-act="my-notebook">Οι δικές μου συνταγές</button></div></div>`;
    if (!S.chefs) { main.innerHTML = head + `<div class="empty"><h3>Φόρτωση μαγείρων…</h3></div>`; return; }
    const tot = S.chefs.reduce((a, c) => ({ r: a.r + Number(c.recipes), e: a.e + Number(c.restaurants) }), { r: 0, e: 0 });
    const stats = `<div class="facts admin-stats">
      <div class="fact"><small>Μάγειρες</small><b>${S.chefs.length}</b></div>
      <div class="fact"><small>Συνταγές</small><b>${tot.r}</b></div>
      <div class="fact"><small>Εστιατόρια</small><b>${tot.e}</b></div></div>`;
    const rows = S.chefs.map((c) => `<button class="chef" data-chef="${esc(c.id)}">
        ${avatarHtml(c.avatar_path, c.full_name || c.email, "avatar")}
        <span class="chef-main"><b>${esc(c.full_name || c.email)}</b>${c.id === S.user.id ? ' <span class="example">ΕΣΥ</span>' : ""}
          ${c.full_name ? `<small>${esc(c.email)}</small>` : ""}
          <small>Μέλος από ${esc(fmtDate(c.created_at))} · τελευταία σύνδεση ${esc(fmtDate(c.last_sign_in_at))}</small></span>
        <span class="chef-num"><b>${Number(c.recipes)}</b><small>συνταγές</small></span>
        <span class="chef-num"><b>${Number(c.restaurants)}</b><small>εστιατόρια</small></span>
      </button>`).join("");
    main.innerHTML = head + stats + `<div class="chefs">${rows || '<div class="empty">Δεν υπάρχουν ακόμα μάγειρες.</div>'}</div>`;
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") { S.user = session && session.user; showAuth("reset"); return; }
    const uid = session && session.user && session.user.id;
    if (uid && (!S.user || S.user.id !== uid)) {
      S.user = session.user; S.restaurants = []; S.recipes = []; S.loaded = false; S.view = "list"; S.sel = "all"; S.viewing = null; S.isAdmin = false; S.chefs = null; S.profile = null; profilePrompted = false; $("adminBtn").hidden = true;
      if (authMode !== "reset" || $("authView").hidden) setTimeout(showApp, 0);
    } else if (!uid) {
      S.user = null; S.restaurants = []; S.recipes = []; S.loaded = false; S.viewing = null; S.isAdmin = false; S.chefs = null; S.profile = null; $("adminBtn").hidden = true;
      showAuth("login");
    }
  });

  // ---------- offline shell ----------
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
})();
