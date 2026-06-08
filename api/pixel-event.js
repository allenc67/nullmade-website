// POST /api/pixel-event — public beacon endpoint
//
// Receives pixel events from the nullmade.com client-side JS and stores them
// in Vercel Redis (via Marketplace). The agent hub polls /api/pixel-events
// on a 30-second cadence to pull fresh events into the Command Deck.
//
// Storage model:
//   - Each event appended to a Redis list "nm:events" via LPUSH (newest at left)
//   - List trimmed to last 5000 events via LTRIM (so we stay under 30 MB)
//   - Each event is JSON: {ts, event, product_id, title, value, referrer, ua}

import { createClient } from 'redis';

// Reuse the connection across invocations on the same Vercel function instance
let _client = null;
async function getRedis() {
  if (_client && _client.isOpen) return _client;
  const url = process.env.KV_REDIS_URL || process.env.REDIS_URL || process.env.KV_URL;
  if (!url) throw new Error('KV_REDIS_URL not configured');
  _client = createClient({ url, socket: { tls: url.startsWith('rediss://'), reconnectStrategy: 1000 } });
  _client.on('error', () => { /* swallow per-instance errors */ });
  await _client.connect();
  return _client;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    const ev = {
      ts:         Date.now(),
      event:      String(body.event      || 'Unknown').slice(0, 40),
      product_id: String(body.product_id || '').slice(0, 40),
      title:      String(body.title      || '').slice(0, 100),
      value:      Number(body.value      || 0),
      referrer:   String(body.referrer   || '').slice(0, 300),
      ua:         (req.headers['user-agent'] || '').slice(0, 200),
      ip_prefix:  ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').slice(0, 8),
    };

    const r = await getRedis();
    await r.lPush('nm:events', JSON.stringify(ev));
    // Eventually-consistent trim — don't await, saves a roundtrip
    r.lTrim('nm:events', 0, 4999).catch(() => {});

    return res.status(200).json({ ok: true });
  } catch (e) {
    // Beacons are fire-and-forget — never error-out the client
    return res.status(200).json({ ok: false, msg: String(e).slice(0, 200) });
  }
}
