import { buildTranslationPrompt, gemini, isConfigured, model, parseImageDataUrl } from './_gemini.js';

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  if (!isConfigured || !gemini) {
    return res.status(400).json({
      error: 'GEMINI_API_KEY is not set. Add it to Vercel environment variables and redeploy.',
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

    return res.status(200).json({
      pageNumber,
      koreanText: response.text?.trim() || '번역할 본문이 없습니다.',
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: error?.message || 'Failed to translate this page.',
    });
  }
}
