/**
 * Server-side AI provider layer for the Vercel serverless functions.
 *
 * SECURITY: this file reads keys from process.env WITHOUT a VITE_ prefix, so
 * Vite never inlines them into the browser bundle. Previously the client called
 * Gemini/Groq/xAI directly with VITE_* keys, which meant every key shipped
 * inside the public JS and anyone could extract and spend them.
 *
 * Required Vercel environment variables (Project → Settings → Environment
 * Variables). Each accepts ONE key or several comma/space-separated keys, which
 * multiplies the free-tier quota because we rotate on 429/503:
 *   GEMINI_API_KEY   (Google Gemini)
 *   NVIDIA_API_KEY   (NVIDIA NIM: z-ai/glm-5.2, DeepSeek-R1; keys start with "nvapi-")
 *   GROQ_API_KEY     (Groq Cloud, keys start with "gsk_")
 *   XAI_API_KEY      (xAI / Grok, keys start with "xai-")
 */

import { PROVIDER_ORDER, type TaskCategory } from './router.js';
import { logTelemetry } from './telemetry.js';

const splitKeys = (raw?: string): string[] =>
  (raw || '').split(/[,\s]+/).map((k) => k.trim()).filter(Boolean);

export const GEMINI_KEYS = () => splitKeys(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY);
export const NVIDIA_KEYS = () => splitKeys(process.env.NVIDIA_API_KEY || process.env.VITE_NVIDIA_API_KEY);
export const GROQ_KEYS = () => splitKeys(process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY);
export const XAI_KEYS = () => splitKeys(process.env.XAI_API_KEY || process.env.VITE_XAI_API_KEY);

/** All OpenAI-compatible fallback / alternate keys (NVIDIA first, then Groq, then xAI). */
export const FALLBACK_KEYS = () => [...NVIDIA_KEYS(), ...GROQ_KEYS(), ...XAI_KEYS()];

const KEY_GETTERS_BY_PROVIDER: Record<'nvidia' | 'groq' | 'xai', () => string[]> = {
  nvidia: NVIDIA_KEYS,
  groq: GROQ_KEYS,
  xai: XAI_KEYS,
};

/**
 * Phase 1.1 — same key pool as FALLBACK_KEYS, but reordered by the
 * deterministic router's PROVIDER_ORDER for the given task category.
 * A "reasoning" request tries NVIDIA (GLM-5.2 / DeepSeek-R1) keys before
 * Groq/xAI; a "fast" request keeps the original Groq-before-NVIDIA order.
 */
export const orderedFallbackKeys = (category: TaskCategory = 'fast'): string[] =>
  (PROVIDER_ORDER[category] || PROVIDER_ORDER.fast)
    .filter((p): p is 'nvidia' | 'groq' | 'xai' => p !== 'gemini')
    .flatMap((p) => KEY_GETTERS_BY_PROVIDER[p]());

export const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
export const GEMINI_MODEL = GEMINI_MODELS[0];

/** Endpoint + model for an OpenAI-compatible key, resolved by its prefix. */
export function providerFor(key: string): {
  url: string;
  model: string;
  models: string[];
  params?: { temperature?: number; top_p?: number; max_tokens?: number; seed?: number };
} {
  const cleanKey = (key || '').trim();

  // NVIDIA NIM (GLM-5.2, DeepSeek-R1, Llama 3.3)
  if (cleanKey.startsWith('nvapi-')) {
    return {
      url: 'https://integrate.api.nvidia.com/v1/chat/completions',
      model: 'z-ai/glm-5.2',
      models: ['z-ai/glm-5.2', 'deepseek-ai/deepseek-r1', 'meta/llama-3.3-70b-instruct'],
      params: {
        // Was temperature 1 / top_p 1 (maximum randomness). This is a tutoring
        // app whose own system prompt says "never invent facts" — high sampling
        // makes answers inconsistent between identical questions and raises the
        // confabulation rate. Aligned with the other providers.
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 16384,
        seed: 42,
      },
    };
  }

  if (cleanKey.startsWith('xai-')) {
    return {
      url: 'https://api.x.ai/v1/chat/completions',
      model: 'grok-2-latest',
      models: ['grok-2-latest'],
      params: { temperature: 0.7, top_p: 0.95 },
    };
  }

  return {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    params: { temperature: 0.7, top_p: 0.95 },
  };
}

/**
 * Strip chain-of-thought from reasoning models.
 *
 * The NVIDIA model list includes deepseek-r1 and nemotron-*-reasoning, which
 * emit their internal monologue wrapped in <think>...</think> before the real
 * answer. Nothing removed it, so a student could see the model thinking out
 * loud ("let me consider whether this level is right...") above their answer.
 * Handles the still-open tag too, which is what a truncated stream leaves.
 */
export function stripReasoning(text: string): string {
  if (!text || typeof text !== 'string') return typeof text === 'string' ? text : '';
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // An unterminated <think> means everything after it is still reasoning.
  const open = out.search(/<think>/i);
  if (open >= 0) out = out.slice(0, open);
  return out.replace(/^\s+/, '');
}

export interface StudentStatePayload {
  activePedagogy?: 'analogies' | 'scaffolded' | 'worked_example' | 'socratic' | 'advanced_rigor';
  learningStrain?: {
    possibleStruggle: number;
    confidence: number;
    signals: string[];
  };
  activeInterventions?: Record<string, {
    conceptId: string;
    strategy: string;
    action: string;
    reason: string;
    recommendedAction?: string;
  }>;
  conceptMastery?: Record<string, {
    conceptId: string;
    accuracy: number;
    attempts: number;
    confidence: number;
  }>;
}

export interface Profile {
  level?: string; role?: string; field?: string; language?: string;
  accessibilityMode?: string;
  chatThreads?: { id?: string; title?: string; lastMessageSnippet?: string }[];
  activeThreadId?: string;
  iqScore?: number;
  preferredPedagogyStyle?: string;
  studentState?: StudentStatePayload;
  spatialMemories?: any[];
  memory?: {
    enabled?: boolean;
    preferredLanguage?: string;
    explanationStyle?: string;
    learningGoals?: string[];
    knownPreferences?: string[];
    explicitConfirmedInfo?: string[];
  };
}
export interface Msg { id?: string; role: string; content: string }

function formatSpatialMemoriesBlock(memories?: any[]): string {
  if (!Array.isArray(memories) || memories.length === 0) return '';
  let block = '\n## COGNIFY SPATIAL MEMORY (PHYSICAL OBJECT LOCATIONS REMEMBERED BY VISION COMPANION)\n';
  block += '- The following physical items and their last-observed locations have been recorded for this student:\n';
  for (const m of memories.slice(0, 8)) {
    const loc = [m.surface, m.room, m.relativePosition?.direction ? `(${m.relativePosition.direction})` : ''].filter(Boolean).join(', ');
    const timeDesc = m.lastSeenIso ? new Date(m.lastSeenIso).toLocaleTimeString() : 'recently';
    block += `  * ${m.objectName || 'Item'}: on ${loc || 'surface'} [Observed at: ${timeDesc}]\n`;
  }
  block += '- INSTRUCTION: If the user asks where an object is located, reference its last known location accurately and state that it was the position observed at that time.\n';
  return block;
}

function formatStudentMemoryBlock(memory?: Profile['memory']): string {
  if (!memory || memory.enabled !== true) return '';

  const goals = Array.isArray(memory.learningGoals) && memory.learningGoals.length
    ? memory.learningGoals.map((g) => `- ${g}`).join('\n')
    : '- None specified';

  const prefs = Array.isArray(memory.knownPreferences) && memory.knownPreferences.length
    ? memory.knownPreferences.map((p) => `- ${p}`).join('\n')
    : '- None specified';

  const confirmed = Array.isArray(memory.explicitConfirmedInfo) && memory.explicitConfirmedInfo.length
    ? memory.explicitConfirmedInfo.map((c) => `- ${c}`).join('\n')
    : '- None specified';

  return `\n## COGNIFY STUDENT MEMORY
- Preferred Language: ${memory.preferredLanguage || 'English'}
- Explanation Style: ${memory.explanationStyle || 'Practical examples first'}
- Current Learning Goals:
${goals}
- Known Preferences:
${prefs}
- Explicitly Confirmed Student Facts:
${confirmed}\n`;
}

/**
 * CognitiveStage represents a dynamic pedagogical baseline initialized during onboarding.
 * IMPORTANT: This is NOT a diagnostic assessment of the student's fixed intelligence, mental capacity, or IQ.
 * It is solely an adaptive pedagogical calibration used to tailor the initial explanation style,
 * tone, and scaffolding, which evolves dynamically based on student interaction and mastery.
 */
export type CognitiveStage = 'foundational' | 'developing' | 'proficient' | 'advanced';

export function resolveCognitiveStage(level?: string): CognitiveStage {
  const norm = (level || '').trim().toLowerCase();
  if (norm === 'basic' || norm === 'foundational') return 'foundational';
  if (norm === 'intermediate' || norm === 'developing') return 'developing';
  if (norm === 'proficient') return 'proficient';
  if (norm === 'advanced' || norm === 'genius') return 'advanced';
  return 'developing';
}

function formatCognitiveCalibration(style?: string, level?: string): string {
  let res = '';
  const stage = resolveCognitiveStage(level);

  res += `\n## PEDAGOGICAL CALIBRATION BASELINE (DYNAMIC ONBOARDING BASELINE - NOT A MEASUREMENT OF MENTAL CAPACITY OR IQ)\n`;
  res += `- This calibration is an adaptive instructional preference baseline for tone and scaffolding.\n`;
  res += `- It is NOT a permanent classification or clinical evaluation of the student's cognitive capabilities.\n`;

  if (stage === 'foundational') {
    res += `\n## COGNITIVE CALIBRATION: FOUNDATIONAL (STAGE: مرحلة التأسيس والمبسط جداً)
- CORE MENTALITY: Treat the student as someone who genuinely struggles with academic abstraction, complex jargon, and theories. Explain with extreme simplicity, warmth, and patience.
- TONE & LANGUAGE ("الكلام بالبلدي وبدون تعقيد"):
  * If speaking in Arabic or Egyptian, speak "بالبلدي" (natural, colloquial, warm, down-to-earth Egyptian/Arabic dialect).
  * Strictly avoid confusing jargon, complicated theorems, dense academic phrasing, or overwhelming formulas.
  * Always use everyday real-life metaphors and examples ("أمثلة بلدي ملموسة" - e.g. شراء طلبات من السوق، حنفية مياه وخرطوم، سلك ولمبة، فكة الفلوس، ركوب مواصلات، كوباية شاي).
  * Keep explanations bite-sized, gentle, and one clear concept at a time.`;
  } else if (stage === 'advanced') {
    res += `\n## COGNITIVE CALIBRATION: SOCRATIC & DEEP RIGOR (STAGE: المرحلة المتقدمة والبحثية)
- CORE MENTALITY: The student is intellectually sharp, grasps concepts rapidly, and is bored by standard textbook summaries.
- GO BEYOND TEXTBOOK THEORY TO GLOBAL INDUSTRY IMPACT ("يطلع معاه للعالم والشركات العالمية"):
  * Do NOT stop at textbook scientific theory. Relate concepts directly to how top world-class tech companies and frontier labs (e.g. Google, OpenAI, Meta, DeepMind, NVIDIA, Microsoft, Apple) actually build, engineer, and deploy this in high-scale real-world production ("الشركات العالمية بتعمل كذا في الواقع العملي").
  * Analyze architectural trade-offs, algorithmic complexity (Big-O), distributed systems challenges, hardware constraints, and cutting-edge innovations.
  * EXPAND HORIZONS ("يفتح له مدارك كتير لكل حاجة"): Ask deep, thought-provoking Socratic questions, challenge edge cases, and encourage innovative problem-solving. Treat them as an intellectual peer.`;
  } else if (stage === 'proficient') {
    res += `\n## COGNITIVE CALIBRATION: PROFICIENT & APPLIED (STAGE: مرحلة التمكن الهندسي)
- CORE MENTALITY: The student has mastered core concepts and is ready for rigorous engineering standards, code efficiency, and deep architectural trade-offs.
- TECHNICAL DEPTH & REAL-WORLD PRACTICES:
  * Integrate industry standards, design patterns, testing strategies, and edge-case resilience.
  * Provide concise, rigorous explanations with concrete syntax and operational flow.`;
  } else {
    res += `\n## COGNITIVE CALIBRATION: BALANCED (STAGE: المرحلة المتنامية والمتوسطة)
- CORE MENTALITY: The student has solid foundational knowledge and is ready for structured scientific inquiry and interactive dialogue.
- SCIENTIFIC & INTERACTIVE GIVE-AND-TAKE ("طريقة علمية + ياخد ويدي في الكلام + يفتح معاه شوية"):
  * Explain concepts using sound scientific methodologies, clear logical cause-and-effect, and structured technical reasoning.
  * Keep the discussion interactive and engaging ("ياخد ويدي معاه" - e.g., "تعال نشوف النتيجة دي...", "فكر معايا في السبب العلمي اللي يخلي ده يحصل...").
  * Moderately widen their horizons ("يفتح معاه شوية") with practical industrial use cases, real-world engineering workflows, and applied examples.`;
  }

  // EXPLICIT USER STYLE OVERRIDE (HIGHEST PRIORITY OVER DEFAULT LEVEL)
  res += `\n## EXPLICIT USER STYLE OVERRIDE (CRITICAL - HIGHEST PRIORITY):
- If the user explicitly asks you to speak in a specific manner or style, YOU MUST IMMEDIATELY OBEY THEIR WISH REGARDLESS OF DEFAULT LEVEL OR STAGE:
  * If a user in the Foundational/Basic tier asks: "لا اتكلم معايا بطريقة علمية وأكاديمية" -> Switch immediately to formal, rigorous scientific mode as requested.
  * If a user in the Advanced tier asks: "كلمني بالبلدي وببساطة ومن غير تعقيد" -> Switch immediately to ultra-simple, colloquial "بلدي" mode with everyday analogies.
  * Any direct in-conversation style instruction from the student ALWAYS supersedes the default calibrated level.`;

  if (style === 'analogies') {
    res += `\n## ACTIVE PEDAGOGICAL STYLE: VISUAL ANALOGIES & METAPHORS
- Anchor explanations in physical, real-world analogies (mailboxes, water pipes, maps).
- Prioritize visual mental models and intuitive concepts before syntax.`;
  } else if (style === 'technical') {
    res += `\n## ACTIVE PEDAGOGICAL STYLE: DEEP TECHNICAL & ACADEMIC RIGOR
- Be concise, dense, and precise. Reference time/space complexity (Big-O), memory layout, and formal specifications.`;
  } else if (style === 'scaffolded') {
    res += `\n## ACTIVE PEDAGOGICAL STYLE: STEP-BY-STEP SCAFFOLDING
- Deconstruct the problem into numbered, sequential micro-milestones with quick comprehension checks.`;
  } else if (style === 'socratic') {
    res += `\n## ACTIVE PEDAGOGICAL STYLE: SOCRATIC INQUIRY
- Guide the student by asking 1-2 targeted probing questions so they deduce the solution inductively.`;
  }

  return res;
}

function formatStudentStateBlock(state?: StudentStatePayload): string {
  if (!state) return '';
  let block = '';

  const strain = state.learningStrain;
  const interventions = state.activeInterventions ? Object.values(state.activeInterventions) : [];
  const activeIntervention = interventions.length > 0 ? interventions[0] : null;

  block += '\n## REAL-TIME COGNITIVE & PEDAGOGICAL STATE (EVIDENCE-BASED LEARNING ENGINE)\n';
  if (state.activePedagogy) {
    block += `- Active Pedagogical Mode: ${state.activePedagogy.toUpperCase()}\n`;
  }

  if (strain) {
    const strugglePct = Math.round(strain.possibleStruggle * 100);
    const signalList = strain.signals && strain.signals.length > 0 ? strain.signals.join(', ') : 'none';
    block += `- Current Learning Strain: ${strugglePct}% struggle likelihood (Confidence: ${Math.round(strain.confidence * 100)}%, Signals: ${signalList})\n`;
    if (strain.possibleStruggle > 0.5) {
      block += `- INSTRUCTION FOR LEARNING STRAIN: The student is experiencing observable difficulty. Slow down pacing, lower cognitive load, avoid presenting multiple complex steps simultaneously, and offer warm encouragement.\n`;
    }
  }

  if (activeIntervention) {
    block += `\n## ACTIVE INTERVENTION DIRECTIVE:
- Strategy: ${activeIntervention.strategy}
- Target Concept: ${activeIntervention.conceptId}
- Diagnosed Root Cause: ${activeIntervention.reason}
${activeIntervention.recommendedAction ? `- Specific Remediation Action: ${activeIntervention.recommendedAction}\n` : ''}`;
    if (activeIntervention.action === 'review_prerequisite') {
      block += `- CRITICAL: The student is stumbling because of a foundation gap in "${activeIntervention.conceptId}". Before advancing, briefly explain and solidify this prerequisite using concrete real-world intuition.\n`;
    } else if (activeIntervention.strategy === 'worked_example') {
      block += `- CRITICAL: Provide a complete step-by-step worked example with thorough inline commentary before asking the student to solve on their own.\n`;
    } else if (activeIntervention.strategy === 'analogies') {
      block += `- CRITICAL: Anchor your explanation in an intuitive, physical real-world metaphor first before mentioning any code, math, or formal terms.\n`;
    }
  }

  return block;
}

/** The adaptive system prompt. Kept in step with the client's previous inline version. */
export function buildPersona(
  profile: Profile,
  otherThreads = '',
  explicitStudentState?: StudentStatePayload
): string {
  const a11y = profile.accessibilityMode;
  const memoryBlock = formatStudentMemoryBlock(profile.memory);
  const spatialBlock = formatSpatialMemoriesBlock(profile.spatialMemories);
  const effectiveState = explicitStudentState || profile.studentState;
  const stateBlock = formatStudentStateBlock(effectiveState);
  const effectivePedagogy = effectiveState?.activePedagogy || profile.preferredPedagogyStyle;
  const cognitiveBlock = formatCognitiveCalibration(effectivePedagogy, profile.level);
  return `You are Cognify, an adaptive AI mentor. Give the most correct, useful answer calibrated to THIS user.
- Level: ${profile.level || 'Basic'} | Role: ${profile.role || 'Student'} | Field: ${profile.field || 'General'} | Configured Language: ${profile.language || 'English'}

## LANGUAGE
- Configured Interface Language: ${profile.language || 'English'}.
- If the query language is ambiguous, or when initiating greetings or study guidance, reply in the user's configured language (${profile.language || 'English'}).
- Reply in the SAME language/dialect as the user's last message.
- Egyptian Arabic in → reply in natural Egyptian Arabic; Modern Standard in → reply in Modern Standard.
- French in → reply in natural, fluent, idiomatic French.
- English in → reply in natural English.
- Spanish / German / Italian / Portuguese / Russian / Chinese / Japanese in → reply naturally in that language.
- If the user's configured language is French ("French") and query language is ambiguous, reply in French.
- If the user switches language mid-conversation, switch immediately.

## FRANCE TRAVEL & SPOKEN FRENCH ASSISTANCE
- When the user asks about traveling in France, communicating with locals, or French phrases:
  1) Emphasize French cultural politeness: In France, it is essential to always start any interaction with "Bonjour Madame" or "Bonjour Monsieur" and conclude with "Merci beaucoup, bonne journée !".
  2) For any French phrase provided, include an Arabic phonetic pronunciation guide (النطق الصوتي بالحروف العربية) and English phonetics so the traveler can say it naturally.
  3) Provide authentic, real-world spoken phrases that French locals actually use.

## ANSWER STYLE
- Answer the question FIRST, then add context. No filler openers.
- Simple question → 1-4 sentences of plain prose. Bullets/headers ONLY when genuinely multi-part.
- If the input is messy or mixed-language, infer the intent and answer it.
- If you are not certain, say so briefly. Never invent facts, sources or numbers.
${a11y === 'Visual' ? '\n## ACCESSIBILITY\n- USER IS BLIND. Describing an image/photo is a practical task, not a creative one:\n  1) Say FIRST if anything looks like a hazard (traffic, stairs, obstacles, fire, spills, sharp/hot objects) — one short sentence, before anything else.\n  2) Read any visible text VERBATIM (labels, signs, medicine dosage, prices, dates) — do not paraphrase or summarize numbers/instructions.\n  3) Then describe what matters practically: what/who is there, roughly where (left/right/near/far, or clock position like "at 2 o\'clock"), not colors or aesthetics unless asked.\n  4) Be concise — a few short sentences, not a paragraph. No flowery/"vivid" language, no markdown, no tables — this is read aloud by TTS.' : ''}${a11y === 'Vocal-Deaf' || a11y === 'Sign-Only' ? '\n## ACCESSIBILITY\n- User is deaf. Short, visual sentences.' : ''}${a11y === 'Speech' ? '\n## ACCESSIBILITY\n- Output is read aloud by TTS: smooth speakable prose, no tables, no markdown noise.' : ''}${memoryBlock}${spatialBlock}${stateBlock}${cognitiveBlock}
${otherThreads ? `\n## THREAD MEMORY\nSummaries of the user's other threads. Use them ONLY if explicitly asked about past conversations.\n${otherThreads}\n` : ''}`;
}

export function threadsSummary(profile: Profile): string {
  return (profile.chatThreads || [])
    .filter((t) => t.id !== profile.activeThreadId)
    .map((t) => `Thread "${t.title}": ${t.lastMessageSnippet || 'No summary'}`)
    .join('\n');
}

/** Gemini `contents`, with the trailing duplicate of the current message removed. */
export function buildContents(message: string, history: Msg[], attachments: any[] = []) {
  const safeHistory = Array.isArray(history) ? history : [];
  const safeAttachments = Array.isArray(attachments) ? attachments : [];
  const mapped = safeHistory
    .filter((m) => m && m.id !== 'welcome' && m.content?.trim())
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
  const clean = mapped[0]?.role === 'model' ? mapped.slice(1) : mapped;
  const last = clean[clean.length - 1];
  const deduped = last?.role === 'user' && last.parts?.[0]?.text === message ? clean.slice(0, -1) : clean;

  const parts: any[] = [{ text: message }];
  for (const f of safeAttachments) {
    if (f?.data && f?.type) {
      const cleanData = typeof f.data === 'string' ? f.data.replace(/^data:[^;]+;base64,/, '') : f.data;
      parts.push({ inlineData: { mimeType: f.type, data: cleanData } });
    }
  }
  return [...deduped, { role: 'user', parts }];
}

/** OpenAI-compatible messages, same trailing-duplicate guard. */
export function buildOpenAIMessages(message: string, system: string, history: Msg[]) {
  const safeHistory = Array.isArray(history) ? history : [];
  const mapped = safeHistory
    .filter((m) => m && m.id !== 'welcome' && m.content?.trim())
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
  const last = mapped[mapped.length - 1];
  const deduped = last?.role === 'user' && last.content === message ? mapped.slice(0, -1) : mapped;
  return [{ role: 'system', content: system }, ...deduped, { role: 'user', content: message }];
}

/** POST to Gemini, rotating keys and models on 429/503. Returns the first OK response. */
export async function geminiFetch(
  path: string,
  body: string,
  opts: { stream?: boolean; category?: TaskCategory } = {},
): Promise<{ res: Response | null; status: number }> {
  const keys = GEMINI_KEYS();
  let lastStatus = 0;
  for (const model of GEMINI_MODELS) {
    for (const key of keys.length ? keys : ['']) {
      if (!key) break;
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:${path}` +
        (opts.stream ? '?alt=sse&key=' : '?key=') + key;
      const t0 = Date.now();
      let r: Response;
      try {
        r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      } catch (err) {
        lastStatus = 0;
        logTelemetry({ provider: 'gemini', model, category: opts.category, latencyMs: Date.now() - t0, inputChars: body.length, success: false, error: String(err) });
        continue;
      }
      logTelemetry({ provider: 'gemini', model, category: opts.category, latencyMs: Date.now() - t0, inputChars: body.length, success: r.ok, status: r.status });
      if (r.ok && (!opts.stream || r.body)) return { res: r, status: r.status };
      lastStatus = r.status;
      // 400 = bad request payload — another key/model won't help.
      if (r.status === 400) return { res: null, status: 400 };
      // 401/403 = bad key or exhausted quota — try next key in the pool.
      if (r.status === 401 || r.status === 403) continue;
    }
  }
  return { res: null, status: lastStatus };
}

/**
 * Non-streaming chat via the OpenAI-compatible fallbacks. "" when all fail.
 * `category` (from the Phase 1.1 router) decides which provider's keys are
 * tried first — see orderedFallbackKeys. Every attempt is logged via
 * telemetry.ts regardless of outcome.
 */
export async function fallbackChat(messages: any[], category: TaskCategory = 'fast'): Promise<string> {
  const inputChars = Array.isArray(messages)
    ? messages.reduce((sum, m) => sum + (typeof m?.content === 'string' ? m.content.length : 0), 0)
    : 0;

  for (const key of orderedFallbackKeys(category)) {
    const { url, models, params } = providerFor(key);
    for (const model of models) {
      const t0 = Date.now();
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            messages,
            temperature: params?.temperature ?? 0.7,
            top_p: params?.top_p ?? 0.95,
            ...(params?.max_tokens ? { max_tokens: params.max_tokens } : {}),
            ...(params?.seed ? { seed: params.seed } : {}),
          }),
        });
        if (!r.ok) {
          logTelemetry({
            provider: url.includes('nvidia') ? 'nvidia' : url.includes('groq') ? 'groq' : 'xai',
            model, category, latencyMs: Date.now() - t0, inputChars,
            success: false, status: r.status,
          });
          continue;
        }
        const j: any = await r.json();
        const txt = stripReasoning(j?.choices?.[0]?.message?.content || '');
        logTelemetry({
          provider: url.includes('nvidia') ? 'nvidia' : url.includes('groq') ? 'groq' : 'xai',
          model, category, latencyMs: Date.now() - t0, inputChars, outputChars: txt.length,
          success: !!txt, status: r.status,
        });
        if (txt) return txt;
      } catch (err) {
        logTelemetry({
          provider: url.includes('nvidia') ? 'nvidia' : url.includes('groq') ? 'groq' : 'xai',
          model, category, latencyMs: Date.now() - t0, inputChars,
          success: false, error: String(err),
        });
      }
    }
  }
  return '';
}

/** One-shot text generation: Gemini first, then the OpenAI-compatible fallbacks. */
export async function generateText(prompt: string, system?: string): Promise<string> {
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: { temperature: 0.7, topP: 0.95 },
  });
  const { res } = await geminiFetch('generateContent', body);
  if (res) {
    const j: any = await res.json().catch(() => null);
    const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (txt) return txt;
  }
  return fallbackChat([
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: prompt },
  ]);
}

/** Read and JSON-parse a request body that may arrive parsed or raw. */
export async function readBody(req: any): Promise<any> {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  if (req.readableEnded || req.complete) return {};
  return await new Promise((resolve) => {
    let raw = '';
    const MAX_BYTES = 10 * 1024 * 1024; // 10MB
    const timer = setTimeout(() => resolve({}), 15000);
    req.on('data', (c: any) => {
      raw += c;
      if (raw.length > MAX_BYTES) {
        clearTimeout(timer);
        resolve({});
      }
    });
    req.on('end', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); }
    });
    req.on('error', () => {
      clearTimeout(timer);
      resolve({});
    });
  });
}

import { verifyRequestAuth } from './authGuard.js';
import { checkRateLimit } from './rateLimiter.js';

/** Shared guard: POST only, authentication, provider key check, and dual-tier rate limiting (IP + User). */
export async function guard(req: any, res: any): Promise<boolean> {
  // If already authenticated and guarded upstream (e.g. in Express middleware), proceed immediately
  if (req.authenticatedUid) {
    return true;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return false;
  }

  // 1. Authentication Verification (Strict Firebase ID Token Check)
  const auth = await verifyRequestAuth(req);
  if (!auth.authenticated || !auth.uid) {
    res.status(401).json({ error: auth.error || 'Authentication required. Please sign in to access Cognify AI.' });
    return false;
  }
  req.authenticatedUid = auth.uid;

  // 2. Provider Key Check
  if (!GEMINI_KEYS().length && !FALLBACK_KEYS().length) {
    res.status(503).json({
      error: 'No AI provider key configured on the server. Set GEMINI_API_KEY (and optionally GROQ_API_KEY / XAI_API_KEY) in the Vercel project environment variables.',
    });
    return false;
  }

  // 3. IP Rate Limiting (DDoS & Scraper Defense: 100 requests/minute)
  const clientIp = req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown_ip';
  const ipRateLimit = checkRateLimit(`ip:${clientIp}`, 100);
  if (typeof res.setHeader === 'function') {
    res.setHeader('X-RateLimit-Limit-IP', '100');
    res.setHeader('X-RateLimit-Remaining-IP', String(ipRateLimit.remaining));
  }
  if (!ipRateLimit.allowed) {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Retry-After', Math.ceil(ipRateLimit.resetMs / 1000).toString());
    }
    res.status(429).json({ error: 'Too many requests from this IP address. Please slow down.' });
    return false;
  }

  // 4. User-Level Rate Limiting (Account Quota Defense: 60 requests/minute)
  const userRateLimit = checkRateLimit(`user:${auth.uid}`, 60);
  if (typeof res.setHeader === 'function') {
    res.setHeader('X-RateLimit-Limit-User', '60');
    res.setHeader('X-RateLimit-Remaining-User', String(userRateLimit.remaining));
  }
  if (!userRateLimit.allowed) {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Retry-After', Math.ceil(userRateLimit.resetMs / 1000).toString());
    }
    res.status(429).json({ error: 'User rate limit exceeded. Please wait a moment before sending more requests.' });
    return false;
  }

  return true;
}
