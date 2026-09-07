import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { buildTranslationPrompt, gemini, isConfigured, model, parseImageDataUrl } from '../api/_gemini.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '8mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    configured: isConfigured,
    provider: 'gemini',
    model,
  });
});

app.post('/api/translate-page', async (req, res) => {
  if (!gemini) {
    return res.status(400).json({
      error: 'GEMINI_API_KEY is not set. Add it to .env and restart the app.',
    });
  }

  const { documentId, pageNumber, imageDataUrl } = req.body || {};

  if (!documentId || !Number.isInteger(pageNumber) || !imageDataUrl) {
    return res.status(400).json({
      error: 'documentId, pageNumber, and imageDataUrl are required.',
    });
  }

  const image = parseImageDataUrl(imageDataUrl);

  if (!image) {
    return res.status(400).json({
      error: 'imageDataUrl must be a base64 image data URL.',
    });
  }

  try {
    const response = await gemini.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: buildTranslationPrompt(documentId, pageNumber),
            },
            {
              inlineData: {
                mimeType: image.mimeType,
                data: image.data,
              },
            },
          ],
        },
      ],
    });

    res.json({
      pageNumber,
      koreanText: response.text?.trim() || '번역할 본문이 없습니다.',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error?.message || 'Failed to translate this page.',
    });
  }
});

app.use(express.static(path.join(projectRoot, 'dist')));

app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(projectRoot, 'dist', 'index.html'));
});

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Translation server running at http://127.0.0.1:${port}`);
});

server.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

server.ref();

const keepAlive = setInterval(() => {}, 60_000);
keepAlive.ref();
