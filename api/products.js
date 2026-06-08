// Map Printify blueprint_id → NullMade product category
const BLUEPRINT_CATEGORY = {
  // Shirts / tees
  6:    "shirts",   // Unisex Heavy Cotton Tee (Gildan 5000) — NullMade's flagship
  71:   "shirts",   // Bella+Canvas 3001 (Printful)
  9:    "shirts",   // Unisex Jersey Short Sleeve Tee
  // Mugs
  68:   "mugs",     // Mug 11oz (legacy)
  425:  "mugs",     // Mug 15oz
  78:   "mugs",     // Mug
  478:  "mugs",     // Ceramic Mug (11oz/15oz) — current factory
  // Posters
  5:    "posters",
  282:  "posters",
  // Candles
  1192: "candles",   // (legacy mapping — not a real candle blueprint)
  1408: "candles",   // (legacy)
  1379: "candles",   // Printed Mint Tin Candles — current factory (4oz + 8oz, Black/Gold/Silver)
};

// Extra mockup placeholder IDs we push to Etsy that Printify's product DB
// doesn't store. Same map the hub uses to enrich Etsy listings — kept in sync.
const EXTRA_CDN_PLACEHOLDERS = {
  478: [6311, 6312, 101798],   // mug — handle-right 3/4 + handle-left 3/4 + back
  // shirts already use multiple Printify-stored mockups; no synthesis needed
};

// Blueprint mapping IS the source of truth — NullMade's catalog reuses the
// same design title (with "Tee" in it) across the t-shirt, mug, and poster
// variants. The title can't be trusted as a category signal.
// Fall back to title-detection ONLY when the blueprint is unknown.
function categoryFromTitle(title) {
  if (!title) return null;
  const t = String(title).toLowerCase();
  if (/\b(tin\s*candle|candle)\b/.test(t)) return "candles";
  if (/\b(poster|art\s*print|wall\s*print)\b/.test(t)) return "posters";
  if (/\b(mug|ceramic\s*cup)\b/.test(t))   return "mugs";
  if (/\b(tee|t-shirt|shirt)\b/.test(t))   return "shirts";
  return null;
}

function categoryFor(blueprintId, title) {
  const fromBlueprint = BLUEPRINT_CATEGORY[blueprintId];
  if (fromBlueprint) return fromBlueprint;
  // Unknown blueprint — fall back to title heuristics.
  return categoryFromTitle(title) || "other";
}

// Given a Printify mockup URL and a target placeholder ID, swap the placeholder
// part. Example:
//   https://images.printify.com/mockup/{pid}/{vid}/6310/{fname}
// → https://images.printify.com/mockup/{pid}/{vid}/6311/{fname}
function swapPlaceholder(src, newPh) {
  return src.replace(/(\/mockup\/[^/]+\/[^/]+)\/\d+\//, `$1/${newPh}/`);
}

// Module-scope cache. Survives across invocations of the same warm function
// instance (Vercel keeps functions warm for ~5-15 min after the last call).
// Layered with Vercel's edge cache (Cache-Control: s-maxage), this means most
// requests skip Printify entirely. Only the first cold function on a fresh
// region pays the ~3-9s Printify API cost.
const CACHE_TTL_MS       = 10 * 60 * 1000;   // 10 min — fresh window
const CACHE_STALE_MS     = 60 * 60 * 1000;   // 1 hour — stale fallback if Printify is slow/down
let _cached = null;        // { products, fetchedAt }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const key    = process.env.PRINTIFY_API_KEY;
  const shopId = process.env.PRINTIFY_SHOP_ID || "27475599";

  if (!key) {
    return res.status(500).json({ error: "PRINTIFY_API_KEY not configured in Vercel environment" });
  }

  // FAST PATH: fresh in-memory cache hit.
  if (_cached && Date.now() - _cached.fetchedAt < CACHE_TTL_MS) {
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
    res.setHeader("X-Memory-Cache", "HIT");
    return res.json(_cached.products);
  }

  try {
    const r = await fetch(
      `https://api.printify.com/v1/shops/${shopId}/products.json?limit=50`,
      { headers: { Authorization: `Bearer ${key}` } }
    );
    if (!r.ok) {
      // STALE FALLBACK: if Printify errored and we have cached data (any age
      // up to 1 hour), serve it rather than failing the page entirely.
      if (_cached && Date.now() - _cached.fetchedAt < CACHE_STALE_MS) {
        res.setHeader("Cache-Control", "s-maxage=60");
        res.setHeader("X-Memory-Cache", "STALE-FALLBACK");
        return res.json(_cached.products);
      }
      const txt = await r.text();
      return res.status(r.status).json({ error: `Printify error ${r.status}`, detail: txt.slice(0, 200) });
    }

    const data = await r.json();
    const products = (data.data || [])
      // Must be visible in Printify AND actually published to Etsy (has a real
      // listing URL). Skip drafts / unpublished products — otherwise the
      // "Shop on Etsy" button falls back to the generic shop URL, which kills
      // conversion (user clicks on "Frog Mascot Tee" but lands on the homepage).
      .filter(p => p.visible && p.external?.handle && /etsy\.com\/listing\//i.test(p.external.handle))
      .map(p => {
        const rawImages = (p.images || []).map(img => ({
          src:         img.src,
          variant_ids: img.variant_ids || [],
          is_default:  !!img.is_default,
          position:    img.position,
        }));
        const primary = rawImages.find(i => i.is_default)?.src || rawImages[0]?.src || "";

        // Base image URLs from Printify
        const imageUrls = rawImages.slice(0, 12).map(i => i.src);

        // For categories where we inject extra mockup angles into Etsy via CDN,
        // also include those URLs here so the website modal gallery matches Etsy.
        const extraPlaceholders = EXTRA_CDN_PLACEHOLDERS[p.blueprint_id] || [];
        if (extraPlaceholders.length && imageUrls.length > 0) {
          // Dedupe: don't synthesize a URL that's already in the array
          const existingPh = new Set();
          for (const u of imageUrls) {
            const m = u.match(/\/mockup\/[^/]+\/[^/]+\/(\d+)\//);
            if (m) existingPh.add(m[1]);
          }
          const base = imageUrls[0];
          for (const ph of extraPlaceholders) {
            if (existingPh.has(String(ph))) continue;
            imageUrls.push(swapPlaceholder(base, ph));
          }
        }

        return {
          id:           p.id,
          title:        p.title,
          description:  (p.description || "").replace(/<[^>]+>/g, " ").slice(0, 280).trim(),
          tags:         (p.tags || []).slice(0, 5),
          image:        primary,
          images:       imageUrls,
          price:        ((p.variants?.find(v => v.is_enabled)?.price || 2399) / 100).toFixed(2),
          etsy_url:     p.external?.handle || "https://www.etsy.com/shop/NullMade",
          created_at:   p.created_at || p.updated_at || null,
          blueprint_id: p.blueprint_id,
          category:     categoryFor(p.blueprint_id, p.title),
        };
      })
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    // Refresh in-memory cache + tell edge to cache 10 min fresh / 30 min stale.
    _cached = { products, fetchedAt: Date.now() };
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
    res.setHeader("X-Memory-Cache", "MISS-REFRESHED");
    res.json(products);
  } catch (e) {
    // NETWORK FALLBACK: serve stale cache if Printify is unreachable.
    if (_cached && Date.now() - _cached.fetchedAt < CACHE_STALE_MS) {
      res.setHeader("Cache-Control", "s-maxage=60");
      res.setHeader("X-Memory-Cache", "STALE-NETWORK-ERROR");
      return res.json(_cached.products);
    }
    res.status(500).json({ error: e.message });
  }
}
