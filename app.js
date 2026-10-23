"use strict";

/* Reseller Listing Helper — public v1
   Listings live in this browser's localStorage (no accounts, no database).
   AI listing writing happens in the Netlify function: netlify/functions/generate-listing.js
*/

const STORE_KEY = "rlh_listings_v1";
const FUNCTION_URL = "/.netlify/functions/generate-listing";
const STATUSES = ["Draft", "Ready", "Listed", "Sold"];

/* ---------- state ---------- */
let listings = loadListings();
let pendingPhoto = null; // { sendDataUrl, thumbDataUrl } after picking a photo
let openId = null;        // listing id shown in the detail sheet

function loadListings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveListings() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(listings));
  } catch (e) {
    toast("Storage is full — try deleting an old listing with a photo.");
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function money(n) {
  const v = Number(n) || 0;
  return "$" + (Math.round(v * 100) / 100).toLocaleString("en-US");
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------- elements ---------- */
const $ = (id) => document.getElementById(id);
const shelfEl = $("shelf");
const emptyEl = $("emptyShelf");
const captureMsg = $("captureMsg");
const generateBtn = $("generateBtn");

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
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
$("photoInput").addEventListener("change", async (ev) => {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
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

function setCaptureMsg(msg, isError) {
  captureMsg.textContent = msg || "";
  captureMsg.classList.toggle("error", !!isError);
}

/* ---------- create a listing ---------- */
generateBtn.addEventListener("click", async () => {
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
    const listing = {
      id: uid(),
      status: "Draft",
      createdAt: Date.now(),
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
    listings.unshift(listing);
    saveListings();
    render();
    setCaptureMsg("");
    // reset capture area for the next one
    $("textInput").value = "";
    $("clearPhotoBtn").click();
    openDetail(listing.id);
    toast("Listing drafted! It's on your shelf. 🎉");
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
          <span class="listing-meta">${esc(bits)}</span>
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
  b.addEventListener("click", () => {
    const l = getListing(openId);
    if (!l) return;
    l.status = b.getAttribute("data-status");
    saveListings();
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

$("saveDetailBtn").addEventListener("click", () => {
  const l = getListing(openId);
  if (!l) return;
  readDetailInto(l);
  saveListings();
  render();
  toast("Saved ✓");
  closeDetail();
});

$("deleteBtn").addEventListener("click", () => {
  const l = getListing(openId);
  if (!l) return;
  if (!confirm("Delete this listing for good?")) return;
  listings = listings.filter((x) => x.id !== openId);
  saveListings();
  render();
  closeDetail();
  toast("Deleted.");
});

/* ---------- rewrites ---------- */
document.querySelectorAll("[data-style]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const l = getListing(openId);
    if (!l) return;
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
      saveListings();
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
render();
