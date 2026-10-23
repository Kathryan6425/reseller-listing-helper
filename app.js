"use strict";

/* Reseller Listing Helper — public v2
   Accounts + shelves live in Supabase (each user sees only their own rows,
   enforced again by Row Level Security on the server).
   AI listing writing happens in the Netlify function: netlify/functions/generate-listing.js
   Site values come from config.js -> window.RLH_CONFIG.
*/

const FUNCTION_URL = "/.netlify/functions/generate-listing";
const STATUSES = ["Draft", "Ready", "Listed", "Sold"];

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);

function money(n) {
  const v = Number(n) || 0;
  return "$" + (Math.round(v * 100) / 100).toLocaleString("en-US");
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------- Supabase setup ---------- */
const cfg = window.RLH_CONFIG || {};
const supabaseReady = Boolean(
  cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase
);
let sb = null;
if (supabaseReady) {
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
}

/* ---------- state ---------- */
let currentUser = null;
let listings = [];       // this user's listings, newest first (camelCase shape)
let pendingPhoto = null; // { sendDataUrl, thumbDataUrl } after picking a photo
let openId = null;       // listing id shown in the detail sheet

/* ---------- row <-> app shape ---------- */
function rowToListing(r) {
  return {
    id: r.id,
    status: r.status || "Draft",
    createdAt: r.created_at ? Date.parse(r.created_at) : Date.now(),
    thumb: r.photo_thumb || "",
    itemName: r.item_name || "",
    brand: r.brand || "",
    size: r.size || "",
    condition: r.condition || "",
    title: r.title || "",
    description: r.description || "",
    price: Number(r.price) || 0,
    priceLow: Number(r.price_low) || 0,
    priceHigh: Number(r.price_high) || 0,
    platform: r.platform || "Vinted",
    category: r.category || ""
  };
}

function listingToRow(l) {
  return {
    user_id: currentUser.id,
    item_name: l.itemName || "",
    brand: l.brand || "",
    size: l.size || "",
    condition: l.condition || "",
    title: l.title || "",
    description: l.description || "",
    price: Number(l.price) || 0,
    price_low: Number(l.priceLow) || 0,
    price_high: Number(l.priceHigh) || 0,
    platform: l.platform || "Vinted",
    category: l.category || "",
    status: STATUSES.includes(l.status) ? l.status : "Draft",
    photo_thumb: l.thumb || null,
    updated_at: new Date().toISOString()
  };
}

/* ---------- data (all scoped to the signed-in user) ---------- */
async function loadListings() {
  if (!currentUser) return;
  const { data, error } = await sb
    .from("listings")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });
  if (error) {
    toast("Couldn't load your shelf — check your signal and refresh.");
    return;
  }
  listings = (data || []).map(rowToListing);
  render();
}

function newUuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function insertListing(l) {
  const row = listingToRow(l);
  // The app picks the id up front and does NOT ask the server to echo the
  // row back: the echo (big photo included) is exactly what breaks on a
  // weak signal and made good saves look like failures. A duplicate-id
  // reply means an earlier try actually landed — that counts as saved.
  const id = l.id && !String(l.id).startsWith("local-") ? l.id : newUuid();
  row.id = id;
  const { error } = await sb.from("listings").insert(row);
  if (error && error.code !== "23505") {
    const code = error.code ? ` (code ${error.code})` : "";
    throw new Error("Your listing was written but couldn't be saved to your shelf — try again." + code);
  }
  const saved = Object.assign({}, l, { id });
  delete saved.unsaved;
  return saved;
}

async function updateListing(l) {
  const { error } = await sb
    .from("listings")
    .update(listingToRow(l))
    .eq("id", l.id)
    .eq("user_id", currentUser.id);
  if (error) throw new Error("Couldn't save that change — check your signal and try again.");
}

async function deleteListing(id) {
  const { error } = await sb
    .from("listings")
    .delete()
    .eq("id", id)
    .eq("user_id", currentUser.id);
  if (error) throw new Error("Couldn't delete that listing — try again.");
}

/* ---------- auth UI ---------- */
function setAuthMsg(msg, isError, isGood) {
  const el = $("authMsg");
  el.textContent = msg || "";
  el.classList.toggle("error", !!isError);
  el.classList.toggle("good", !!isGood);
}

function showSignedOut() {
  $("setupNotice").hidden = true;
  $("authCard").hidden = false;
  $("userBar").hidden = true;
  $("appShell").hidden = true;
}

function showSignedIn() {
  $("setupNotice").hidden = true;
  $("authCard").hidden = true;
  $("userBar").hidden = false;
  $("appShell").hidden = false;
  $("userEmail").textContent = currentUser.email || "";
}

function showSetupNotice() {
  $("setupNotice").hidden = false;
  $("authCard").hidden = true;
  $("userBar").hidden = true;
  $("appShell").hidden = true;
}

async function handleAuthChange(session) {
  currentUser = session && session.user ? session.user : null;
  if (currentUser) {
    showSignedIn();
    await loadListings();
  } else {
    listings = [];
    closeDetail();
    showSignedOut();
  }
}

$("signInBtn").addEventListener("click", async () => {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  if (!email || !password) {
    setAuthMsg("Type your email and password first.", true);
    return;
  }
  setAuthMsg("Signing you in…");
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    setAuthMsg(friendlyAuthError(error), true);
    return;
  }
  setAuthMsg("");
  toast("Welcome back! 👋");
});

$("signUpBtn").addEventListener("click", async () => {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  if (!email || !password) {
    setAuthMsg("Type an email and a password to make your account.", true);
    return;
  }
  if (password.length < 6) {
    setAuthMsg("Passwords need at least 6 characters.", true);
    return;
  }
  setAuthMsg("Creating your account…");
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) {
    setAuthMsg(friendlyAuthError(error), true);
    return;
  }
  if (data && data.user && !data.session) {
    // Supabase wants the email confirmed before the first sign-in.
    setAuthMsg("Account made! 🎉 Now check your email and tap the confirm link, then come back and sign in.", false, true);
  } else {
    setAuthMsg("");
    toast("Account made — you're in! 🎉");
  }
});

$("signOutBtn").addEventListener("click", async () => {
  await sb.auth.signOut();
  toast("Signed out. See you soon! 👋");
});

function friendlyAuthError(error) {
  const m = (error && error.message) || "";
  if (/invalid login credentials/i.test(m)) return "That email/password combo didn't match. Try again — or tap Create account if you're new.";
  if (/already registered/i.test(m)) return "That email already has an account — tap Sign in instead.";
  if (/email not confirmed/i.test(m)) return "Almost there — tap the confirm link in your email first, then sign in.";
  return m || "Something went wrong — try again in a moment.";
}

/* ---------- mode tabs ---------- */
let mode = "photo";
$("tabPhoto").addEventListener("click", () => setMode("photo"));
$("tabType").addEventListener("click", () => setMode("type"));
function setMode(m) {
  mode = m;
  $("tabPhoto").classList.toggle("active", m === "photo");
  $("tabType").classList.toggle("active", m === "type");
  $("panelPhoto").hidden = m !== "photo";
  $("panelType").hidden = m !== "type";
}

/* ---------- photo handling ---------- */
// A real button + a real click: the most reliable way to open the
// camera / photo library from a mobile browser or in-app webview.
$("photoBtn").addEventListener("click", () => {
  $("photoInput").click();
});

$("photoInput").addEventListener("change", async (ev) => {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return; // no photo picked — the area stays ready to tap again
  setCaptureMsg("Getting your photo ready…");
  try {
    const full = await downscale(file, 1024, 0.82);
    const thumb = await downscale(file, 420, 0.72);
    pendingPhoto = { sendDataUrl: full, thumbDataUrl: thumb };
    const img = $("photoPreview");
    img.src = thumb;
    img.hidden = false;
    $("photoPlaceholder").hidden = true;
    $("clearPhotoBtn").hidden = false;
    setCaptureMsg("");
  } catch (e) {
    setCaptureMsg("That photo didn't work — try another one.", true);
  }
});

$("clearPhotoBtn").addEventListener("click", () => {
  pendingPhoto = null;
  $("photoInput").value = "";
  $("photoPreview").hidden = true;
  $("photoPlaceholder").hidden = false;
  $("clearPhotoBtn").hidden = true;
});

// Shrink a photo on a canvas so big iPhone photos send fast and store small.
function downscale(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (err) { reject(err); }
    };
    img.onerror = reject;
    img.src = url;
  });
}

const captureMsg = $("captureMsg");
function setCaptureMsg(msg, isError) {
  captureMsg.textContent = msg || "";
  captureMsg.classList.toggle("error", !!isError);
}

/* ---------- create a listing ---------- */
const generateBtn = $("generateBtn");
generateBtn.addEventListener("click", async () => {
  if (!currentUser) {
    toast("Sign in first so your listing lands on your shelf.");
    return;
  }
  const text = $("textInput").value.trim();
  if (mode === "photo" && !pendingPhoto) {
    setCaptureMsg("Add a photo first — or tap “Type it” if you'd rather describe it.", true);
    return;
  }
  if (mode === "type" && !text) {
    setCaptureMsg("Tell me what the item is first.", true);
    return;
  }

  const payload = {};
  if (mode === "photo" && pendingPhoto) {
    const parts = pendingPhoto.sendDataUrl.split(",");
    payload.imageBase64 = parts[1];
    payload.imageMime = (parts[0].match(/data:(.*?);/) || [])[1] || "image/jpeg";
    if (text) payload.text = text;
  } else {
    payload.text = text;
  }

  generateBtn.disabled = true;
  setCaptureMsg("Writing your listing… this can take a few seconds. ✨");
  try {
    const data = await callFunction(payload);
    const drafted = {
      id: newUuid(),
      createdAt: Date.now(),
      status: "Draft",
      thumb: pendingPhoto ? pendingPhoto.thumbDataUrl : "",
      itemName: data.itemName || "",
      brand: data.brand || "",
      size: data.size || "",
      condition: data.condition || "",
      title: data.title || "",
      description: data.description || "",
      price: Number(data.price) || 0,
      priceLow: Number(data.priceLow) || 0,
      priceHigh: Number(data.priceHigh) || 0,
      platform: data.platform || "Vinted",
      category: data.category || ""
    };
    // Saving can fail on a weak signal or a dropped sign-in — retry once,
    // and if it still fails, keep the written listing on this phone and
    // open it anyway. The words are never lost; Save finishes the job.
    let saved = null;
    try {
      saved = await insertListing(drafted);
    } catch (e1) {
      await new Promise((r) => setTimeout(r, 1200));
      try { saved = await insertListing(drafted); } catch (e2) { saved = null; }
    }
    if (saved) {
      listings.unshift(saved);
      render();
      setCaptureMsg("");
      // reset capture area for the next one
      $("textInput").value = "";
      $("clearPhotoBtn").click();
      openDetail(saved.id);
      toast("Listing drafted! It's on your shelf. 🎉");
    } else {
      const local = Object.assign({}, drafted, { unsaved: true });
      listings.unshift(local);
      render();
      setCaptureMsg("");
      $("textInput").value = "";
      $("clearPhotoBtn").click();
      openDetail(local.id);
      toast("Written! It couldn't reach your shelf yet — tap Save changes to finish saving it.");
    }
  } catch (err) {
    // Keep the photo/text right where it was so she can just retry.
    setCaptureMsg(err.message || "Something went wrong — tap the button to try again.", true);
  } finally {
    generateBtn.disabled = false;
  }
});

async function callFunction(payload) {
  let res;
  try {
    res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    throw new Error("Couldn't reach the listing writer — check your signal and try again.");
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* handled below */ }
  if (!res.ok || !data || data.error) {
    throw new Error((data && data.error) || "The listing writer had a hiccup — try again in a moment.");
  }
  return data;
}

/* ---------- shelf ---------- */
const shelfEl = $("shelf");
const emptyEl = $("emptyShelf");

function render() {
  renderStats();
  if (!listings.length) {
    shelfEl.innerHTML = "";
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  shelfEl.innerHTML = listings.map((l) => {
    const thumb = l.thumb
      ? `<img class="listing-thumb" src="${l.thumb}" alt="">`
      : `<div class="listing-thumb-none">🏷️</div>`;
    const bits = [l.platform, l.category, l.condition].filter(Boolean).join(" · ");
    return `
      <button class="listing-card" type="button" data-open="${esc(l.id)}">
        ${thumb}
        <span class="listing-main">
          <span class="listing-title">${esc(l.title || l.itemName || "Untitled item")}</span>
          <span class="listing-meta">${esc(bits)}${l.unsaved ? " · ⏳ not saved yet" : ""}</span>
        </span>
        <span class="listing-side">
          <span class="price-tag">${money(l.price)}</span>
          <span class="stamp stamp-${esc(l.status)}">${esc(l.status)}</span>
        </span>
      </button>`;
  }).join("");
  shelfEl.querySelectorAll("[data-open]").forEach((el) => {
    el.addEventListener("click", () => openDetail(el.getAttribute("data-open")));
  });
}

function renderStats() {
  const sum = (arr) => arr.reduce((a, l) => a + (Number(l.price) || 0), 0);
  const waiting = listings.filter((l) => l.status === "Draft" || l.status === "Ready");
  const listed = listings.filter((l) => l.status === "Listed");
  const sold = listings.filter((l) => l.status === "Sold");
  $("statWaitingCount").textContent = waiting.length;
  $("statWaitingMoney").textContent = money(sum(waiting));
  $("statListedCount").textContent = listed.length;
  $("statListedMoney").textContent = money(sum(listed));
  $("statSoldCount").textContent = sold.length;
  $("statSoldMoney").textContent = money(sum(sold));
}

/* ---------- detail sheet ---------- */
function getListing(id) { return listings.find((l) => l.id === id) || null; }

function openDetail(id) {
  const l = getListing(id);
  if (!l) return;
  openId = id;
  $("dPhoto").hidden = !l.thumb;
  if (l.thumb) $("dPhoto").src = l.thumb;
  $("detailTitle").textContent = l.itemName || "Listing";
  $("dStatus").textContent = String(l.status).toUpperCase();
  $("dStatus").className = "stamp stamp-" + l.status;
  $("dPlatform").textContent = l.platform || "";
  $("dTitle").value = l.title || "";
  $("dDescription").value = l.description || "";
  $("dPrice").value = l.price || "";
  $("dPriceRange").textContent =
    l.priceLow || l.priceHigh ? `Suggested range: ${money(l.priceLow)} – ${money(l.priceHigh)}` : "";
  $("dPlatformSelect").value = ["Depop", "Facebook Marketplace", "Vinted"].includes(l.platform) ? l.platform : "Vinted";
  $("dBrand").value = l.brand || "";
  $("dSize").value = l.size || "";
  $("dCondition").value = l.condition || "";
  $("dCategory").value = l.category || "";
  $("rewriteMsg").textContent = "";
  markStatusButtons(l.status);
  $("detailOverlay").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeDetail() {
  if ($("detailOverlay").hidden) return;
  $("detailOverlay").hidden = true;
  document.body.style.overflow = "";
  openId = null;
}
$("closeDetailBtn").addEventListener("click", closeDetail);
$("detailOverlay").addEventListener("click", (ev) => { if (ev.target === $("detailOverlay")) closeDetail(); });

function markStatusButtons(status) {
  $("statusRow").querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.getAttribute("data-status") === status);
  });
}

// Status changes save right away — no separate save tap needed.
$("statusRow").querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", async () => {
    const l = getListing(openId);
    if (!l) return;
    if (l.unsaved) {
      toast("Save it to your shelf first — tap Save changes.");
      return;
    }
    const previous = l.status;
    l.status = b.getAttribute("data-status");
    try {
      await updateListing(l);
    } catch (err) {
      l.status = previous;
      toast(err.message);
      return;
    }
    render();
    $("dStatus").textContent = String(l.status).toUpperCase();
    $("dStatus").className = "stamp stamp-" + l.status;
    markStatusButtons(l.status);
    if (l.status === "Sold") toast("Sold! 🎉 That money is counted up top.");
  });
});

function readDetailInto(l) {
  l.title = $("dTitle").value.trim();
  l.description = $("dDescription").value.trim();
  l.price = Number($("dPrice").value) || 0;
  l.platform = $("dPlatformSelect").value;
  l.brand = $("dBrand").value.trim();
  l.size = $("dSize").value.trim();
  l.condition = $("dCondition").value.trim();
  l.category = $("dCategory").value.trim();
}

$("saveDetailBtn").addEventListener("click", async () => {
  const l = getListing(openId);
  if (!l) return;
  readDetailInto(l);
  if (l.unsaved) {
    // This listing only lives on this phone so far — Save means "put it
    // on the cloud shelf," i.e. insert instead of update.
    try {
      const saved = await insertListing(l);
      const idx = listings.findIndex((x) => x.id === l.id);
      if (idx >= 0) listings[idx] = saved;
      openId = saved.id;
    } catch (err) {
      toast(err.message);
      return;
    }
    render();
    toast("Saved to your shelf ✓");
    closeDetail();
    return;
  }
  try {
    await updateListing(l);
  } catch (err) {
    toast(err.message);
    return;
  }
  render();
  toast("Saved ✓");
  closeDetail();
});

$("deleteBtn").addEventListener("click", async () => {
  const l = getListing(openId);
  if (!l) return;
  if (!confirm("Delete this listing for good?")) return;
  if (l.unsaved) {
    listings = listings.filter((x) => x.id !== openId);
    render();
    closeDetail();
    toast("Deleted.");
    return;
  }
  try {
    await deleteListing(openId);
  } catch (err) {
    toast(err.message);
    return;
  }
  listings = listings.filter((x) => x.id !== openId);
  render();
  closeDetail();
  toast("Deleted.");
});

/* ---------- rewrites ---------- */
document.querySelectorAll("[data-style]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const l = getListing(openId);
    if (!l) return;
    if (l.unsaved) {
      toast("Save it to your shelf first — tap Save changes.");
      return;
    }
    readDetailInto(l); // rewrite what's on screen, including her edits
    const style = btn.getAttribute("data-style");
    const msgEl = $("rewriteMsg");
    document.querySelectorAll("[data-style]").forEach((b) => (b.disabled = true));
    msgEl.textContent = "Rewriting…";
    msgEl.classList.remove("error");
    try {
      const data = await callFunction({ style, currentListing: l });
      if (data.title) { l.title = data.title; $("dTitle").value = data.title; }
      if (data.description) { l.description = data.description; $("dDescription").value = data.description; }
      await updateListing(l); // rewrite-save writes through to the cloud shelf
      render();
      msgEl.textContent = "Done — how's that read?";
    } catch (err) {
      msgEl.textContent = err.message || "Rewrite didn't work — try again.";
      msgEl.classList.add("error");
    } finally {
      document.querySelectorAll("[data-style]").forEach((b) => (b.disabled = false));
    }
  });
});

/* ---------- copy buttons ---------- */
async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(label + " copied — go paste it! 📋");
  } catch (e) {
    // Fallback for older browsers / non-secure contexts
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast(label + " copied — go paste it! 📋"); }
    catch (err) { toast("Copy didn't work here — long-press the text to copy it."); }
    ta.remove();
  }
}

document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const which = btn.getAttribute("data-copy");
    if (which === "title") copyText($("dTitle").value, "Title");
    if (which === "description") copyText($("dDescription").value, "Description");
  });
});

$("copyFullBtn").addEventListener("click", () => {
  const l = getListing(openId);
  if (!l) return;
  readDetailInto(l);
  const lines = [l.title, "", l.description, "", "Price: " + money(l.price)];
  if (l.brand) lines.push("Brand: " + l.brand);
  if (l.size) lines.push("Size: " + l.size);
  if (l.condition) lines.push("Condition: " + l.condition);
  copyText(lines.join("\n"), "Full listing");
});

/* ---------- go ---------- */
(async function init() {
  if (!supabaseReady) {
    showSetupNotice();
    return;
  }
  showSignedOut(); // safe default until the session check comes back
  const { data } = await sb.auth.getSession();
  await handleAuthChange(data ? data.session : null);
  sb.auth.onAuthStateChange((_event, session) => {
    handleAuthChange(session);
  });
})();
