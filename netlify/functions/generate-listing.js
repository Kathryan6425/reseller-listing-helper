"use strict";

/*
 * Reseller Listing Helper — listing writer (Netlify Function)
 *
 * Receives JSON:
 *   { text?: string, imageBase64?: string, imageMime?: string,
 *     style?: string, currentListing?: object }
 *
 * - New listing:  send text and/or a photo -> returns a full listing.
 * - Rewrite:      send style ("shorter" | "more detail" | "friendlier")
 *                 plus currentListing -> returns the listing with a
 *                 rewritten title/description (price is preserved).
 *
 * Calls Google's Gemini API (free tier). The key comes from the
 * GEMINI_API_KEY environment variable in Netlify — never hardcode it here.
 */

// Google retires model names over time, so try current ones in order —
// a 404 just means "that name is gone", and we move on to the next.
// Fastest, least-contended models first.
const MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-3.8-flash",
];
function apiUrl(model) {
  return (
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    model +
    ":generateContent"
  );
}

const PLATFORMS = ["Depop", "Facebook Marketplace", "Vinted"];

const JSON_SHAPE =
  '{ "itemName": string, "brand": string, "size": string, "condition": string, ' +
  '"title": string, "description": string, "price": number, "priceLow": number, ' +
  '"priceHigh": number, "platform": string, "category": string }';

const ROUTING_RULE =
  'Choose "platform" by this rule: clothing, shoes and fashion accessories -> "Depop"; ' +
  'computer parts and PC/electronics components -> "Facebook Marketplace"; ' +
  'everything else -> "Vinted".';

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}

function buildGeneratePrompt(text) {
  return [
    "You are an expert reseller listing writer helping a casual seller move items quickly.",
    text
      ? "The seller describes the item as: " + JSON.stringify(text)
      : "Identify the item from the attached photo.",
    "Write a complete marketplace listing for it.",
    ROUTING_RULE,
    'Return STRICT JSON only — no markdown, no code fences, no commentary — in exactly this shape: ' +
      JSON_SHAPE +
      ".",
    "Rules:",
    "- title: searchable and buyer-friendly, include brand, item type, size and standout keywords, max about 80 characters.",
    "- description: ready to paste, warm and honest, 3-6 short lines. Mention condition and any visible wear honestly. End with a friendly note like 'Message me with questions!'",
    "- price: a fair USED resale price in USD (a plain number, no $ sign) that the item should actually sell for. priceLow and priceHigh: a realistic low-high range around it.",
    '- condition: one of "New with tags", "Like new", "Good", "Fair" — judge from the photo/description, be honest.',
    '- brand and size: fill in if you can tell; use "" if unknown. category: a short category like "Clothing", "Shoes", "Computer Parts", "Home Goods", "Toys".',
  ].join("\n");
}

function buildRewritePrompt(style, current) {
  const styleGuide = {
    shorter: "noticeably shorter and punchier — cut every word that isn't earning its place",
    "more detail": "richer and more detailed — add selling points, features and helpful specifics that are true of this item",
    friendlier: "warmer and friendlier — personable, like a nice neighbor selling at a yard sale",
  };
  return [
    "You are an expert reseller listing writer. Rewrite this listing's title and description.",
    "Style requested: " + (styleGuide[style] || style) + ".",
    "Keep the exact same item, brand, size, condition, platform, category and prices — only the words change.",
    "Current listing JSON: " + JSON.stringify(current),
    "Return STRICT JSON only — no markdown, no code fences, no commentary — in exactly this shape: " +
      JSON_SHAPE +
      ".",
  ].join("\n");
}

function cleanListing(raw, fallback) {
  const num = (v, fb) => {
    const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.]/g, "")) : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fb;
  };
  const str = (v, fb) => (typeof v === "string" && v.trim() ? v.trim() : fb || "");
  const out = {
    itemName: str(raw.itemName, fallback.itemName),
    brand: str(raw.brand, fallback.brand),
    size: str(raw.size, fallback.size),
    condition: str(raw.condition, fallback.condition),
    title: str(raw.title, fallback.title),
    description: str(raw.description, fallback.description),
    price: num(raw.price, fallback.price || 0),
    priceLow: num(raw.priceLow, fallback.priceLow || 0),
    priceHigh: num(raw.priceHigh, fallback.priceHigh || 0),
    platform: PLATFORMS.includes(raw.platform) ? raw.platform : fallback.platform || "Vinted",
    category: str(raw.category, fallback.category),
  };
  if (out.priceLow && out.priceHigh && out.priceLow > out.priceHigh) {
    const t = out.priceLow; out.priceLow = out.priceHigh; out.priceHigh = t;
  }
  return out;
}

function parseModelJson(text) {
  if (!text) throw new Error("empty model response");
  let t = String(text).trim();
  // Strip code fences if the model added them anyway.
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(t);
  } catch (e) {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw e;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Please POST to this endpoint." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, {
      error:
        "The AI key isn't set up on the server yet (missing GEMINI_API_KEY). " +
        "Site owner: add it in Netlify under Site settings → Environment variables, then redeploy.",
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return jsonResponse(400, { error: "That request didn't come through right — please try again." });
  }

  const { text, imageBase64, imageMime, style, currentListing } = body || {};
  const isRewrite = Boolean(style && currentListing);

  if (!isRewrite && !text && !imageBase64) {
    return jsonResponse(400, { error: "Add a photo or describe the item first." });
  }

  const prompt = isRewrite
    ? buildRewritePrompt(style, currentListing)
    : buildGeneratePrompt(text);

  const parts = [{ text: prompt }];
  if (!isRewrite && imageBase64) {
    parts.push({
      inline_data: {
        mime_type: imageMime || "image/jpeg",
        data: imageBase64,
      },
    });
  }

  const requestBody = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.6,
      responseMimeType: "application/json",
    },
  });

  let geminiRes = null;
  let networkFailed = false;
  const startedAt = Date.now();
  for (const model of MODELS) {
    if (Date.now() - startedAt > 25000) break; // stay well inside the host's time limit
    let res;
    try {
      res = await fetch(apiUrl(model), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: requestBody,
        signal: AbortSignal.timeout(9000), // never let one slow model eat the whole budget
      });
    } catch (e) {
      networkFailed = true;
      continue; // timed out or unreachable — try the next model
    }
    if (res.status === 404) continue; // model name retired/unknown — try the next one
    if (res.ok) {
      geminiRes = res;
      break;
    }
    geminiRes = res; // busy/overloaded etc. — remember it, but try the next model too
  }

  if (!geminiRes) {
    if (networkFailed) {
      return jsonResponse(502, { error: "Couldn't reach the AI writer just now — check back in a moment and try again." });
    }
    return jsonResponse(502, { error: "The AI writer had a problem (404) — try again in a moment." });
  }

  if (!geminiRes.ok) {
    let detail = "";
    try {
      const errBody = await geminiRes.json();
      detail = (errBody && errBody.error && errBody.error.message) || "";
    } catch (e) { /* ignore */ }
    if (geminiRes.status === 400 && /API key/i.test(detail)) {
      return jsonResponse(502, { error: "The AI key on the server looks invalid — site owner, double-check GEMINI_API_KEY in Netlify." });
    }
    if (geminiRes.status === 429) {
      return jsonResponse(502, { error: "The free AI is busy right now (rate limit) — wait a minute and try again." });
    }
    return jsonResponse(502, { error: "The AI writer had a problem (" + geminiRes.status + ") — try again in a moment." });
  }

  let data;
  try {
    data = await geminiRes.json();
  } catch (e) {
    return jsonResponse(502, { error: "The AI writer sent back something unreadable — try again." });
  }

  const partsOut =
    data && data.candidates && data.candidates[0] && data.candidates[0].content
      ? data.candidates[0].content.parts
      : null;
  const modelText = Array.isArray(partsOut)
    ? partsOut.map((p) => p.text || "").join("")
    : "";

  let parsed;
  try {
    parsed = parseModelJson(modelText);
  } catch (e) {
    return jsonResponse(502, { error: "The AI writer's answer didn't come out right — tap the button and try once more." });
  }

  const fallback = isRewrite ? cleanListing(currentListing, {}) : {};
  const listing = cleanListing(parsed, fallback);

  // Rewrites never change the money unless the model went wildly off — keep hers.
  if (isRewrite) {
    listing.price = fallback.price;
    listing.priceLow = fallback.priceLow;
    listing.priceHigh = fallback.priceHigh;
    listing.platform = fallback.platform || listing.platform;
  }

  return jsonResponse(200, listing);
};
