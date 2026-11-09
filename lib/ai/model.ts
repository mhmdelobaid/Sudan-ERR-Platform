// One door for the AI reading (F1 upload, F4/F5 region reading).
// Claude when ANTHROPIC_API_KEY is set (default model: Haiku), otherwise Gemini (GEMINI_API_KEY).
// The returned object has the Gemini SDK's shape — generateContent(content) → { response: { text() } } —
// so the existing call sites keep working unchanged. Keys stay on the server; nothing here runs in the browser.
import { GoogleGenerativeAI } from '@google/generative-ai';

export type AiProvider = 'claude' | 'gemini';

export function aiProvider(): AiProvider | null {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return 'claude';
  if (process.env.GEMINI_API_KEY?.trim()) return 'gemini';
  return null;
}

/** Shown to people when no key is set (the screens translate code 'ai_not_configured'). */
export const AI_NOT_CONFIGURED = 'AI reading is not set up on the server yet (no AI key). Fill the form by hand for now.';

export type ModelOptions = {
  /** Gemini model id; Claude uses CLAUDE_MODEL or Haiku */
  model: string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Ask for JSON only (Gemini: responseMimeType) */
  json?: boolean;
};

type GenResult = { response: { text: () => string } };
export type AiModel = { generateContent: (content: any) => Promise<GenResult> };

export function getAiModel(opts: ModelOptions): AiModel {
  const provider = aiProvider();
  if (provider === 'claude') return claudeModel(opts);
  if (provider === 'gemini') {
    return new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string).getGenerativeModel({
      model: opts.model,
      ...(opts.systemInstruction ? { systemInstruction: opts.systemInstruction } : {}),
      generationConfig: {
        ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
        ...(opts.json ? { responseMimeType: 'application/json' } : {}),
        ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
      },
    }) as unknown as AiModel;
  }
  throw Object.assign(new Error(AI_NOT_CONFIGURED), { code: 'ai_not_configured' });
}

// ---- Claude (Messages API over fetch; no extra package) -----------------------------------------
const CLAUDE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function toClaudeBlocks(content: any): any[] {
  // Gemini accepts: a string, an array of strings/parts, or { contents: [{ role, parts }] }
  let parts: any[] = [];
  if (typeof content === 'string') parts = [content];
  else if (Array.isArray(content)) parts = content;
  else if (content?.contents) parts = content.contents.flatMap((c: any) => c.parts || []);
  else if (content) parts = [content];

  const blocks: any[] = [];
  for (const p of parts) {
    if (typeof p === 'string') {
      if (p.trim()) blocks.push({ type: 'text', text: p });
    } else if (p?.text != null) {
      if (String(p.text).trim()) blocks.push({ type: 'text', text: String(p.text) });
    } else if (p?.inlineData?.data) {
      const mime = String(p.inlineData.mimeType || '').toLowerCase();
      if (mime === 'application/pdf') {
        blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.inlineData.data } });
      } else if (CLAUDE_IMAGE_TYPES.has(mime === 'image/jpg' ? 'image/jpeg' : mime)) {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: mime === 'image/jpg' ? 'image/jpeg' : mime, data: p.inlineData.data } });
      } else {
        throw new Error(`Unsupported file type for AI reading: ${mime || 'unknown'}`);
      }
    } else if (p?.fileData) {
      throw new Error('Large-file upload is Gemini-only; send the file inline for Claude');
    }
  }
  // Claude reads files best when they come before the instructions
  return blocks.sort((a, b) => (a.type === 'text' ? 1 : 0) - (b.type === 'text' ? 1 : 0));
}

function stripFences(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : t;
}

function claudeModel(opts: ModelOptions): AiModel {
  return {
    async generateContent(content: any): Promise<GenResult> {
      const system = [
        opts.systemInstruction || '',
        opts.json ? 'Reply with valid JSON only: no code fences, no explanations.' : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY as string,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: process.env.CLAUDE_MODEL?.trim() || 'claude-haiku-5-5',
          max_tokens: Math.min(opts.maxOutputTokens || 8192, 16000),
          ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
          ...(system ? { system } : {}),
          messages: [{ role: 'user', content: toClaudeBlocks(content) }],
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Same wording the retry helper looks for on overload / rate limits
        const msg = data?.error?.message || res.statusText;
        throw new Error(`[${res.status}] Claude: ${msg}`);
      }
      const text = (data.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');
      const out = opts.json ? stripFences(text) : text;
      return { response: { text: () => out } };
    },
  };
}
