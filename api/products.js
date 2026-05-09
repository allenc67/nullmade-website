export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const key    = process.env.PRINTIFY_API_KEY;
  const shopId = process.env.PRINTIFY_SHOP_ID || "27475599";

  if (!key) {
    return res.status(500).json({ error: "PRINTIFY_API_KEY not configured in Vercel environment" });
  }

  try {
    const r = await fetch(
      `https://api.printify.com/v1/shops/${shopId}/products.json?limit=50`,
      { headers: { Authorization: `Bearer ${key}` } }
    );
    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({ error: `Printify error ${r.status}`, detail: txt.slice(0, 200) });
    }

    const data     = await r.json();
    const products = (data.data || [])
      .filter(p => p.visible)
      .map(p => ({
        id:       p.id,
        title:    p.title,
        image:    p.images?.[0]?.src || "",
        price:    ((p.variants?.[0]?.price || 2800) / 100).toFixed(2),
        etsy_url: p.external?.handle || "https://www.etsy.com/shop/NullMade",
        tags:     (p.tags || []).slice(0, 3),
      }));

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
