// api/claude.js — Vercel Serverless Function
// Supports Anthropic Claude, Groq, and OpenAI. Provider is chosen via the
// X-AI-Provider header sent by the frontend. API keys are stored as Vercel
// environment variables — never exposed to the browser.
//
// Required env vars (set whichever providers you use):
//   ANTHROPIC_API_KEY   — https://console.anthropic.com
//   GROQ_API_KEY        — https://console.groq.com  (free tier available)
//   OPENAI_API_KEY      — https://platform.openai.com

const SYSTEM_PROMPT =
  'You are an elite social media marketing strategist with 15+ years experience. ' +
  'You know what actually drives growth, engagement, and monetization across all platforms. ' +
  'You understand Nigerian creators and the Naija hustle. ' +
  'Give practical, specific, actionable content — never generic filler. ' +
  'Format clearly with sections when needed. Be direct and confident.';

// ── Provider configs ─────────────────────────────────────────────────────────

const PROVIDERS = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-20250514',
    buildHeaders: (key) => ({
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
    buildBody: ({ prompt, systemPrompt, maxTokens, model }) =>
      JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: maxTokens || 1500,
        system: systemPrompt || SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
    extractText: (data) => data.content?.[0]?.text || '',
  },

  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    envKey: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
    buildHeaders: (key) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    }),
    buildBody: ({ prompt, systemPrompt, maxTokens, model }) =>
      JSON.stringify({
        model: model || 'llama-3.3-70b-versatile',
        max_tokens: maxTokens || 1500,
        messages: [
          { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
    extractText: (data) => data.choices?.[0]?.message?.content || '',
  },

  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
    buildHeaders: (key) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    }),
    buildBody: ({ prompt, systemPrompt, maxTokens, model }) =>
      JSON.stringify({
        model: model || 'gpt-4o-mini',
        max_tokens: maxTokens || 1500,
        messages: [
          { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
    extractText: (data) => data.choices?.[0]?.message?.content || '',
  },
};

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AI-Provider');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Determine provider — header wins, fallback to body, then default
  const providerName = (
    req.headers['x-ai-provider'] ||
    req.body?.provider ||
    'groq'
  ).toLowerCase();

  const provider = PROVIDERS[providerName];
  if (!provider) {
    return res.status(400).json({
      error: `Unknown provider "${providerName}". Use: anthropic | groq | openai`,
    });
  }

  const apiKey = process.env[provider.envKey];
  if (!apiKey) {
    return res.status(500).json({
      error: `${provider.envKey} is not configured in Vercel environment variables. ` +
             `Add it at: https://vercel.com/dashboard → your project → Settings → Environment Variables`,
    });
  }

  const { prompt, systemPrompt, maxTokens, model } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'Missing prompt in request body' });

  try {
    const response = await fetch(provider.url, {
      method: 'POST',
      headers: provider.buildHeaders(apiKey),
      body: provider.buildBody({ prompt, systemPrompt, maxTokens, model }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error(`[${providerName}] API error:`, response.status, errData);
      return res.status(response.status).json({
        error: errData?.error?.message ||
               errData?.error?.msg ||
               `${providerName} API returned ${response.status}`,
      });
    }

    const data = await response.json();
    const text = provider.extractText(data);
    return res.status(200).json({ text, provider: providerName });

  } catch (err) {
    console.error(`[${providerName}] handler error:`, err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
