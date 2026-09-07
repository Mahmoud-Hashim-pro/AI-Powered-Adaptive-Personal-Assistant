// Accessibility / Sign-Studio AI helpers.
//
// SECURITY: these used to call the Gemini/Groq/xAI REST APIs straight from the
// browser using VITE_GEMINI_API_KEY / VITE_GROQ_API_KEY / VITE_XAI_API_KEY.
// Vite inlines every VITE_* variable into the production bundle, so those keys
// were readable by anyone who opened the deployed JS. They now go through our
// own serverless function at /api/gemini/generateContent, which holds the keys
// in server-only env vars (GEMINI_API_KEY / GROQ_API_KEY / XAI_API_KEY) and does
// the model + key rotation and the Groq/xAI fallback there.
//
// The vision/audio helpers still need a multimodal model, so a request carrying
// inlineData is Gemini-only and degrades gracefully ("" on failure) exactly as
// before — every caller's existing fallback path is unchanged.

import { getAuthHeaders } from './gemini';

/** Text helper. The server does Gemini → Groq/xAI failover, so this is just a
 *  text-only `parts` request. "" on failure, same contract as before. */
async function callText(prompt: string): Promise<string> {
  return callGemini([{ text: prompt }]);
}

/** Strip a `data:<mime>;base64,` prefix if present, returning raw base64. */
function rawBase64(data: string): string {
  const i = data.indexOf("base64,");
  return i >= 0 ? data.slice(i + 7) : data;
}

/**
 * Common caller for the serverless endpoint at /api/gemini/generateContent.
 *
 * The request now goes to our own serverless function, which holds the provider
 * keys and performs the model + key rotation and the Groq/xAI text fallback
 * server-side. Returns "" on any failure, matching the previous contract so all
 * the existing graceful-degradation paths still work.
 */
async function callGemini(parts: any[]): Promise<string> {
  // 1. Try serverless backend
  try {
    const headers = await getAuthHeaders();
    const res = await fetch("/api/gemini/generateContent", {
      method: "POST",
      headers,
      body: JSON.stringify({ parts }),
    });
    if (res.ok && (res.headers.get("Content-Type") || "").includes("application/json")) {
      const d = await res.json();
      if (d?.result) return d.result;
    }
  } catch {
    /* fall through to direct */
  }

  // 2. Direct Gemini fallback
  // Honours user-configured key in localStorage, or optional VITE_GEMINI_API_KEY environment variable.
  const geminiKey = (typeof localStorage !== 'undefined' ? localStorage.getItem('cognify_gemini_api_key') || localStorage.getItem('gemini_api_key') : '') || ((typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY) || '');
  if (geminiKey) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts }] }),
      });
      if (res.ok) {
        const d = await res.json();
        return d?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
    } catch {
      /* fall through to groq */
    }
  }

  // 3. Direct Groq fallback (text-only)
  // Server-only — the Groq/NVIDIA/xAI failover lives in /api/gemini/*, so no
  // fallback key is read in the browser.
  const groqKey = '';
  const isTextOnly = !parts.some((p: any) => p?.inlineData);
  if (groqKey && isTextOnly) {
    try {
      const prompt = parts.map((p: any) => p?.text || '').join('\n').trim();
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (res.ok) {
        const d = await res.json();
        return d?.choices?.[0]?.message?.content || "";
      }
    } catch {
      /* ignore */
    }
  }

  return "";
}

/** Pull the first JSON object/array out of a model reply (handles ```json fences and trailing prose). */
function parseJson<T>(text: string, fallback: T): T {
  if (!text) return fallback;
  try {
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();
    
    const startObj = candidate.indexOf('{');
    const startArr = candidate.indexOf('[');
    const start = (startObj !== -1 && startArr !== -1)
      ? Math.min(startObj, startArr)
      : (startObj !== -1 ? startObj : startArr);
      
    const endObj = candidate.lastIndexOf('}');
    const endArr = candidate.lastIndexOf(']');
    const end = Math.max(endObj, endArr);
    
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    }
    return JSON.parse(candidate) as T;
  } catch {
    return fallback;
  }
}

export const geminiService = {
  async translateSign(imageData: string, language: string = "English", level: string = "Basic") {
    // STRICT anti-hallucination prompt. A single webcam frame is ambiguous, so
    // the model MUST refuse unless it sees a clear, deliberate sign — otherwise
    // it invents sentences ("the mobile device is secured…") from random hands.
    const prompt = `You read sign language (ASL fingerspelling A–Z / 0–9 and common word signs) from a single webcam frame.

STRICT RULES — follow exactly:
1. Reply ONLY with the single word or short sign the hand is CLEARLY and DELIBERATELY forming, in ${language}, calibrated to a ${level} reader.
2. If the hand is at rest, mid-transition, blurry, ambiguous, holding an object/phone, or you are AT ALL unsure — reply with EXACTLY: [NO_SIGN]
3. NEVER describe the scene, the person, the room, objects, or the phone. NEVER guess. NEVER write a full sentence or narration.
4. When uncertain, ALWAYS prefer [NO_SIGN]. A wrong word is worse than [NO_SIGN].

Reply with just the sign, or [NO_SIGN]. Nothing else.`;
    return callGemini([
      { text: prompt },
      { inlineData: { mimeType: "image/jpeg", data: rawBase64(imageData) } },
    ]);
  },

  async enhanceCaptions(text: string, language: string = "English") {
    const prompt = `Clean up and punctuate this live caption into a clear ${language} sentence. Fix obvious speech-to-text errors but keep the meaning. Reply with ONLY the cleaned text:\n\n${text}`;
    return (await callText(prompt)) || text;
  },

  async transcribeAudio(audioData: string, language: string = "English", mimeType: string = "audio/webm") {
    const prompt = `Transcribe this audio accurately into ${language}. Reply with ONLY the transcription.`;
    const out = await callGemini([
      { text: prompt },
      { inlineData: { mimeType, data: rawBase64(audioData) } },
    ]);
    if (!out) throw new Error("Failed to transcribe audio");
    return out;
  },

  async generateSignSequence(text: string, language: string = "English") {
    const prompt = `Convert this ${language} sentence into a simple sign-language gloss sequence (UPPERCASE keywords in signing order, no grammar words). Reply with ONLY the gloss:\n\n${text}`;
    return (await callText(prompt)) || text;
  },

  async optimizeSignScript(text: string, language: string = "English") {
    const prompt = `Rewrite this ${language} script so it is clear and easy to sign: short sentences, concrete words, signing order. Reply with ONLY the rewritten script:\n\n${text}`;
    return (await callText(prompt)) || text;
  },

  async askGeneralQuestion(text: string, _language: string = "English") {
    // Mirror the QUESTION's language (fixes "Arabic in → English out").
    const prompt = `Answer the following clearly and concisely. IMPORTANT: reply in the SAME language and dialect as the question — if it's Arabic (incl. Egyptian), answer in Arabic; if English, answer in English.\n\nQuestion: ${text}`;
    return (await callText(prompt)) || "";
  },

  async generateQuickReplies(text: string, language: string = "English"): Promise<string[]> {
    const prompt = `Someone just said: "${text}". Suggest 3 short, natural ${language} replies the listener could send back. Reply with ONLY a JSON array of strings, e.g. ["...","...","..."].`;
    const out = await callText(prompt);
    return parseJson<string[]>(out, []);
  },

  async decodeDysarthria(
    text: string,
    profile: string = "General",
    language: string = "English",
    customMappings: Array<{ phrase: string; translation: string }> = [],
  ) {
    const mappings = customMappings.length
      ? `\nKnown personal mappings (phrase => meaning): ${customMappings.map((m) => `"${m.phrase}" => "${m.translation}"`).join(", ")}`
      : "";
    const prompt = `This ${language} text comes from a speaker with dysarthria/atypical speech (profile: ${profile}). Infer the intended meaning and rewrite it as clear ${language}. Reply with ONLY the corrected sentence.${mappings}\n\nText: ${text}`;
    return (await callText(prompt)) || text;
  },

  async correctTranscript(
    text: string,
    language: string = "Auto-Detect",
    profile: string = "Standard",
    customMappings: Array<{ phrase: string; translation: string }> = [],
    context: string[] = [],
  ): Promise<{ corrected: string; confidence: number; alternatives: string[] }> {
    const fallback = { corrected: text, confidence: 60, alternatives: [] as string[] };
    const mappings = customMappings.length
      ? ` Known personal mappings: ${customMappings.map((m) => `"${m.phrase}" => "${m.translation}"`).join(", ")}.`
      : "";
    const ctx = context.length ? ` Recent context: ${context.slice(-3).join(" | ")}.` : "";
    const prompt = `Correct this speech-to-text transcript (language: ${language}, speaker profile: ${profile}).${mappings}${ctx} Reply with ONLY JSON: {"corrected": string, "confidence": number 0-100, "alternatives": string[]}.\n\nTranscript: ${text}`;
    const out = await callText(prompt);
    const parsed = parseJson<Partial<typeof fallback>>(out, {});
    return {
      corrected: parsed.corrected || text,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 60,
      alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives : [],
    };
  },

  async decodeEuphoniaAudio(
    audioData: string,
    profile: string = "General",
    language: string = "English",
    customMappings: Array<{ phrase: string; translation: string }> = [],
    mimeType: string = "audio/webm",
  ) {
    const mappings = customMappings.length
      ? `\nKnown personal mappings: ${customMappings.map((m) => `"${m.phrase}" => "${m.translation}"`).join(", ")}`
      : "";
    const prompt = `This audio is from a speaker with atypical/impaired speech (profile: ${profile}). Listen carefully and transcribe the intended meaning as clear ${language}. Reply with ONLY the transcription.${mappings}`;
    const out = await callGemini([
      { text: prompt },
      { inlineData: { mimeType, data: rawBase64(audioData) } },
    ]);
    if (!out) throw new Error("Failed to decode Euphonia raw audio");
    return out;
  },

  async generateRawText(prompt: string): Promise<string> {
    return (await callText(prompt)) || "";
  },
};
