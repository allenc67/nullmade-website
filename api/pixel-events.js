// GET /api/pixel-events?since=<unix_ms>&limit=<n>&key=<shared_secret>
//
// Read-side endpoint for the agent hub. Returns events newer than `since`,
// in newest-first order, capped at `limit` (default 500, max 2000).
//
// Light shared-secret auth via `?key=` query param or `x-hub-key` header.

import { createClient } from 'redis';

const HUB_KEY = process.env.HUB_POLL_KEY || 'nullmade-hub-poll-key-change-me';

let _client = null;
async function getRedis() {
  if (_client && _client.isOpen) return _client;
  const url = process.env.KV_REDIS_URL || process.env.REDIS_URL || process.env.KV_URL;
  if (!url) throw new Error('KV_REDIS_URL not configured');
  _client = createClient({ url, socket: { tls: url.startsWith('rediss://'), reconnectStrategy: 1000 } });
  _client.on('error', () => {});
  await _client.connect();
  return _client;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hub-key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'GET only' });

  const provided = req.query.key || req.headers['x-hub-key'] || '';
  if (provided !== HUB_KEY) {
    return res.status(401).json({ ok: false, msg: 'unauthorized' });
  }

  const since = Number(req.query.since || 0);
  const limit = Math.min(Math.max(Number(req.query.limit || 500), 1), 2000);

  try {
    const r = await getRedis();
    const raw = await r.lRange('nm:events', 0, limit - 1);
    const events = [];
    for (const item of raw || []) {
      try {
        const e = typeof item === 'string' ? JSON.parse(item) : item;
        if (e && (!since || e.ts > since)) events.push(e);
      } catch { /* skip malformed */ }
    }
    return res.status(200).json({
      ok:       true,
      count:    events.length,
      newest_ts: events[0]?.ts || 0,
      events,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, msg: String(e).slice(0, 200) });
  }
}
