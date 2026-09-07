import { isConfigured, model } from './_gemini.js';

export default function handler(_req, res) {
  res.status(200).json({
    ok: true,
    configured: isConfigured,
    provider: 'gemini',
    model,
  });
}
