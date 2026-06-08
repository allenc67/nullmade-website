// Returns the visitor's 2-letter country code from Vercel's edge geolocation
// header. The storefront uses this to promote US-only perks (free shipping)
// only to US visitors. No API keys needed — just reads the request header.
// Falls back to "" (unknown) if the header isn't present, in which case the
// client keeps the honest "U.S." wording rather than hiding the perk.
export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const country = (req.headers["x-vercel-ip-country"] || "").toString().toUpperCase();
  res.status(200).json({ country });
}
