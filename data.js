// api/data.js — Vercel Serverless Function
// Handles all Supabase data operations: save, load, delete.
// Uses Supabase REST API directly (no SDK needed, works in edge functions too).

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // Service role key (has full access)

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({
      error: 'Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel environment variables.',
      configured: false
    });
  }

  const supabaseHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Prefer': 'return=representation'
  };

  try {
    // ── GET: Load data ──
    if (req.method === 'GET') {
      const { table, user_key, limit = 50 } = req.query;

      if (!table) return res.status(400).json({ error: 'Missing table param' });

      let url = `${SUPABASE_URL}/rest/v1/${table}?limit=${limit}&order=created_at.desc`;
      if (user_key) url += `&user_key=eq.${encodeURIComponent(user_key)}`;

      const r = await fetch(url, { headers: supabaseHeaders });
      const rows = await r.json();

      if (!r.ok) {
        // Table may not exist yet — return empty gracefully
        if (rows?.code === '42P01') return res.status(200).json({ rows: [], note: 'Table not found — run setup SQL' });
        return res.status(r.status).json({ error: rows?.message || 'Supabase fetch error' });
      }

      return res.status(200).json({ rows: Array.isArray(rows) ? rows : [] });
    }

    // ── POST: Save / Upsert data ──
    if (req.method === 'POST') {
      const { action, table, data } = req.body;

      if (!table || !data) return res.status(400).json({ error: 'Missing table or data' });

      // Add timestamps
      const payload = {
        ...data,
        created_at: data.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      let url = `${SUPABASE_URL}/rest/v1/${table}`;
      let method = 'POST';

      // Upsert on user_key if provided (for state backups)
      if (data.user_key) {
        url += `?on_conflict=user_key`;
        method = 'POST';
        supabaseHeaders['Prefer'] = 'resolution=merge-duplicates,return=representation';
      }

      const r = await fetch(url, {
        method,
        headers: supabaseHeaders,
        body: JSON.stringify(payload)
      });

      const result = await r.json();

      if (!r.ok) {
        // Table may not exist yet
        if (result?.code === '42P01') {
          return res.status(200).json({ ok: false, note: 'Table not found — run setup SQL in Supabase dashboard', setup_needed: true });
        }
        return res.status(r.status).json({ error: result?.message || 'Supabase save error' });
      }

      return res.status(200).json({ ok: true, data: Array.isArray(result) ? result[0] : result });
    }

    // ── DELETE ──
    if (req.method === 'DELETE') {
      const { table, id } = req.query;
      if (!table || !id) return res.status(400).json({ error: 'Missing table or id' });

      const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
      const r = await fetch(url, { method: 'DELETE', headers: supabaseHeaders });

      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: err?.message || 'Delete failed' });
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('data.js error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
