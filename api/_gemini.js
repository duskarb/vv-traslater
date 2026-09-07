import { GoogleGenAI } from '@google/genai';

export const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const apiKey = process.env.GEMINI_API_KEY;

export const isConfigured = Boolean(apiKey && apiKey !== 'your-gemini-api-key-here');
export const gemini = isConfigured ? new GoogleGenAI({ apiKey }) : null;

export function parseImageDataUrl(imageDataUrl) {
  const match = String(imageDataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;

  return {
    mimeType: match[1],
    data: match[2],
  };
}

export function buildTranslationPrompt(documentId, pageNumber) {
  return [
    'You are translating one page of an English PDF into Korean.',
    'Read the visible English text in the image and translate it naturally into Korean.',
    'Preserve paragraph breaks and reading order where possible.',
    'Do not invent missing text.',
    'If the page has no readable body text, answer exactly: 번역할 본문이 없습니다.',
    `Document id: ${documentId}`,
    `Page: ${pageNumber}`,
  ].join('\n');
}
