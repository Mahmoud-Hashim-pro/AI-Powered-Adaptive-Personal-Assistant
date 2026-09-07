import { UserProfile, Message } from "../types";
import { toast } from "../components/Toast";
import { auth } from "../lib/firebase";

// SECURITY: provider keys are NEVER read in the browser any more.
//
// They used to come from VITE_GEMINI_API_KEY / VITE_GROQ_API_KEY /
// VITE_XAI_API_KEY. Vite inlines every VITE_* variable into the production
// bundle at build time, so all of those keys were extractable from the public
// JS — anyone could read them from the deployed site and spend the quota.
// (.env being gitignored protects the repo, not the shipped bundle.)
//
// All provider calls now go through our own serverless functions under /api/,
// which hold the keys in server-only Vercel environment variables:
//   GEMINI_API_KEY, GROQ_API_KEY, XAI_API_KEY   (note: no VITE_ prefix)
// The Gemini → Groq → xAI failover and multi-key rotation moved server-side too,
// so there is no longer any in-browser fallback that could need a key.
const splitKeys = (raw?: string): string[] =>
  (raw || '').split(/[,\s]+/).map((k) => k.trim()).filter(Boolean);

export async function getAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = await auth.currentUser?.getIdToken(forceRefresh);
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch (err) {
    console.warn('[Cognify] Failed to retrieve Firebase ID token:', err);
  }
  return headers;
}

export function getGeminiKeys(): string[] {
  // Provider keys live server-side in /api/gemini/*. For in-browser direct fallback
  // (e.g. static hosting without API routes), honour user-pasted key first, then
  // optional VITE_GEMINI_API_KEY environment variable.
  const localKey = typeof localStorage !== 'undefined' ? localStorage.getItem('cognify_gemini_api_key') || localStorage.getItem('gemini_api_key') || '' : '';
  const envKey = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY) || '';
  return splitKeys(localKey || envKey);
}

export function getGroqKeys(): string[] {
  const localKey = typeof localStorage !== 'undefined' ? localStorage.getItem('cognify_groq_api_key') || localStorage.getItem('groq_api_key') || '' : '';
  const envKey = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GROQ_API_KEY) || '';
  return splitKeys(localKey || envKey);
}

export function getNvidiaKeys(): string[] {
  // Server-only: handled by /api/gemini/* so the key never reaches the browser.
  return [];
}

export function getXaiKeys(): string[] {
  // Server-only: handled by /api/gemini/* so the key never reaches the browser.
  return [];
}

/** First key (used to build the initial request URL). "" if none configured. */
function geminiPrimaryKey(): string {
  return getGeminiKeys()[0] || "";
}

/** First available fallback key (NVIDIA, Groq, or xAI). "" if none. */
function fallbackPrimaryKey(): string {
  return [...getNvidiaKeys(), ...getGroqKeys(), ...getXaiKeys()][0] || "";
}
const groqPrimaryKey = fallbackPrimaryKey;

/** Resolve the OpenAI-compatible endpoint + model for a key, by its prefix. */
function providerFor(key: string): {
  url: string;
  model: string;
  models: string[];
  params?: { temperature?: number; top_p?: number; max_tokens?: number; seed?: number };
} {
  const cleanKey = (key || "").trim();

  // NVIDIA NIM (GLM-5.2, DeepSeek-R1)
  if (cleanKey.startsWith("nvapi-")) {
    return {
      url: "https://integrate.api.nvidia.com/v1/chat/completions",
      model: "z-ai/glm-5.2",
      models: ["z-ai/glm-5.2", "deepseek-ai/deepseek-r1", "meta/llama-3.3-70b-instruct"],
      params: {
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 16384,
        seed: 42,
      },
    };
  }

  if (cleanKey.startsWith("xai-")) {
    return {
      url: "https://api.x.ai/v1/chat/completions",
      model: "grok-2-latest",
      models: ["grok-2-latest"],
      params: { temperature: 0.7, top_p: 0.95 },
    };
  }

  // default: Groq
  return {
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    params: { temperature: 0.7, top_p: 0.95 },
  };
}

// The /api/* routes now EXIST as Vercel serverless functions (see /api/gemini/*),
// so always use them — they hold the provider keys server-side. `null` means
// "not probed yet"; a non-OK/HTML response flips it to false, which now only
// disables pointless retries (there is no in-browser key path to fall back to).
let backendUp: boolean | null = null;

// Known-good Gemini model IDs, tried in order — the first that responds wins.
// (There is NO "gemini-3.5-flash"; using a non-existent model 404s silently.)
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];
/** Primary Gemini model (used by non-streaming one-shot helpers). */
const GEMINI_MODEL = GEMINI_MODELS[0];

// One-time visibility into AI config (never logs the key values themselves), so
// a "the chat silently does nothing" problem is diagnosable from DevTools.
console.info(
  `[Cognify AI] Gemini key: ${getGeminiKeys().length ? "set" : "MISSING"} · ` +
  `Groq/xAI fallback: ${getGroqKeys().length || getXaiKeys().length ? "set" : "none"} · model: ${GEMINI_MODEL}`,
);

/** Compact adaptive system prompt (shared by the Groq fallback). */
function buildPersona(profile: UserProfile): string {
  let memoryBlock = '';
  if (profile.memory && profile.memory.enabled === true) {
    const goals = Array.isArray(profile.memory.learningGoals) && profile.memory.learningGoals.length
      ? profile.memory.learningGoals.map((g) => `- ${g}`).join('\n')
      : '- None specified';
    const prefs = Array.isArray(profile.memory.knownPreferences) && profile.memory.knownPreferences.length
      ? profile.memory.knownPreferences.map((p) => `- ${p}`).join('\n')
      : '- None specified';
    const confirmed = Array.isArray(profile.memory.explicitConfirmedInfo) && profile.memory.explicitConfirmedInfo.length
      ? profile.memory.explicitConfirmedInfo.map((c) => `- ${c}`).join('\n')
      : '- None specified';

    memoryBlock = `\n## COGNIFY STUDENT MEMORY\n- Language: ${profile.memory.preferredLanguage || 'English'}\n- Style: ${profile.memory.explanationStyle || 'Practical examples first'}\n- Goals:\n${goals}\n- Preferences:\n${prefs}\n- Confirmed Facts:\n${confirmed}`;
  }

  let cognitiveBlock = '';
  const level = (profile.level || 'Intermediate').trim();

  if (level === 'Basic') {
    cognitiveBlock = `\n## COGNITIVE CALIBRATION: FOUNDATIONAL (STAGE: أدنى مرحلة - تأسيسي ومبسط جداً)
- CORE MENTALITY: Treat the student as someone who genuinely struggles with academic abstraction, complex jargon, and theories. Explain with extreme simplicity, warmth, and patience.
- TONE & LANGUAGE ("الكلام بالبلدي وبدون تعقيد"):
  * If speaking in Arabic or Egyptian, speak "بالبلدي" (natural, colloquial, warm, down-to-earth Egyptian/Arabic dialect).
  * Strictly avoid confusing jargon, complicated theorems, dense academic phrasing, or overwhelming formulas.
  * Always use everyday real-life metaphors and examples ("أمثلة بلدي ملموسة" - e.g. شراء طلبات من السوق، حنفية مياه وخرطوم، سلك ولمبة، فكة الفلوس، ركوب مواصلات، كوباية شاي).
  * Keep explanations bite-sized, gentle, and one clear concept at a time.`;
  } else if (level === 'Advanced') {
    cognitiveBlock = `\n## COGNITIVE CALIBRATION: SOCRATIC & DEEP RIGOR (STAGE: أعلى مرحلة - متقدم وعبقري)
- CORE MENTALITY: The student is intellectually sharp, grasps concepts rapidly, and is bored by standard textbook summaries.
- GO BEYOND TEXTBOOK THEORY TO GLOBAL INDUSTRY IMPACT ("يطلع معاه للعالم والشركات العالمية"):
  * Do NOT stop at textbook scientific theory. Relate concepts directly to how top world-class tech companies and frontier labs (e.g. Google, OpenAI, Meta, DeepMind, NVIDIA, Microsoft, Apple) actually build, engineer, and deploy this in high-scale real-world production ("الشركات العالمية بتعمل كذا في الواقع العملي").
  * Analyze architectural trade-offs, algorithmic complexity (Big-O), distributed systems challenges, hardware constraints, and cutting-edge innovations.
  * EXPAND HORIZONS ("يفتح له مدارك كتير لكل حاجة"): Ask deep, thought-provoking Socratic questions, challenge edge cases, and encourage innovative problem-solving. Treat them as an intellectual peer.`;
  } else {
    cognitiveBlock = `\n## COGNITIVE CALIBRATION: BALANCED (STAGE: المرحلة المتوسطة)
- CORE MENTALITY: The student has solid foundational knowledge and is ready for structured scientific inquiry and interactive dialogue.
- SCIENTIFIC & INTERACTIVE GIVE-AND-TAKE ("طريقة علمية + ياخد ويدي في الكلام + يفتح معاه شوية"):
  * Explain concepts using sound scientific methodologies, clear logical cause-and-effect, and structured technical reasoning.
  * Keep the discussion interactive and engaging ("ياخد ويدي معاه" - e.g., "تعال نشوف النتيجة دي...", "فكر معايا في السبب العلمي اللي يخلي ده يحصل...").
  * Moderately widen their horizons ("يفتح معاه شوية") with practical industrial use cases, real-world engineering workflows, and applied examples.`;
  }

  // EXPLICIT USER STYLE OVERRIDE (HIGHEST PRIORITY OVER DEFAULT LEVEL)
  cognitiveBlock += `\n## EXPLICIT USER STYLE OVERRIDE (CRITICAL - HIGHEST PRIORITY):
- If the user explicitly asks you to speak in a specific manner or style, YOU MUST IMMEDIATELY OBEY THEIR WISH REGARDLESS OF DEFAULT LEVEL OR STAGE:
  * If a user in the Foundational/Basic tier asks: "لا اتكلم معايا بطريقة علمية وأكاديمية" -> Switch immediately to formal, rigorous scientific mode as requested.
  * If a user in the Advanced tier asks: "كلمني بالبلدي وببساطة ومن غير تعقيد" -> Switch immediately to ultra-simple, colloquial "بلدي" mode with everyday analogies.
  * Any direct in-conversation style instruction from the student ALWAYS supersedes the default calibrated level.`;

  if (profile.preferredPedagogyStyle === 'analogies') {
    cognitiveBlock += `\n## ACTIVE PEDAGOGICAL STYLE: VISUAL ANALOGIES & METAPHORS
- Anchor explanations in physical, real-world analogies (mailboxes, water pipes, maps).
- Prioritize visual mental models and intuitive concepts before syntax.`;
  } else if (profile.preferredPedagogyStyle === 'technical') {
    cognitiveBlock += `\n## ACTIVE PEDAGOGICAL STYLE: DEEP TECHNICAL & ACADEMIC RIGOR
- Be concise, dense, and precise. Reference time/space complexity (Big-O), memory layout, and formal specifications.`;
  } else if (profile.preferredPedagogyStyle === 'scaffolded') {
    cognitiveBlock += `\n## ACTIVE PEDAGOGICAL STYLE: STEP-BY-STEP SCAFFOLDING
- Deconstruct the problem into numbered, sequential micro-milestones with quick comprehension checks.`;
  } else if (profile.preferredPedagogyStyle === 'socratic') {
    cognitiveBlock += `\n## ACTIVE PEDAGOGICAL STYLE: SOCRATIC INQUIRY
- Guide the student by asking 1-2 targeted probing questions so they deduce the solution inductively.`;
  }

  return `You are Cognify, an adaptive AI mentor. Answer the most correct, useful answer calibrated to THIS user.
- Level: ${profile.level} | Role: ${profile.role} | Field: ${profile.field}
- Reply in the SAME language/dialect as the user's last message (French in -> reply in natural French; Egyptian Arabic in -> reply in natural Egyptian Arabic; English in -> reply in English).
- If the user asks about traveling in France or French phrases, provide practical French phrasing, cultural etiquette (always start with 'Bonjour Madame/Monsieur'), and phonetic pronunciation guides in Arabic letters and English.
- Basic: simple, analogies, no jargon. Intermediate: normal, brief reasoning. Advanced: rigorous, direct.
- Answer first, no filler openers. Be honest if unsure; never invent facts.${memoryBlock}${cognitiveBlock}`;
}

// Stream a chat completion from Groq (OpenAI-compatible). Yields {text, done}.
async function* generateGroqStream(
  message: string,
  profile: UserProfile,
  history: Message[],
  apiKey: string,
  signal?: AbortSignal,
) {
  const mapped = history
    .filter((m) => m.id !== "welcome" && m.content?.trim())
    .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }));
  // The caller's history already ends with the just-sent user message; we add it
  // again below. Drop the trailing duplicate so it isn't sent twice.
  const lastM = mapped[mapped.length - 1];
  const dedupedMapped = (lastM?.role === "user" && lastM.content === message) ? mapped.slice(0, -1) : mapped;
  const messages = [
    { role: "system", content: buildPersona(profile) },
    ...dedupedMapped,
    { role: "user", content: message },
  ];

  const { url, model, models, params } = providerFor(apiKey);
  let res: Response | null = null;
  for (const m of models || [model]) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: m,
        messages,
        temperature: params?.temperature ?? 0.7,
        ...(params?.top_p ? { top_p: params.top_p } : {}),
        ...(params?.max_tokens ? { max_tokens: params.max_tokens } : {}),
        ...(params?.seed ? { seed: params.seed } : {}),
        stream: true,
      }),
      signal,
    });
    if (r.ok && r.body) { res = r; break; }
    const errText = await r.text().catch(() => "");
    console.error(`Fallback provider model "${m}" failed (${r.status}):`, errText.slice(0, 300));
    if (r.status === 401 || r.status === 403) break; // bad key — no point trying other models
  }

  if (!res || !res.body) {
    yield { text: "⚠️ AI is busy right now. Please try again in a moment.", done: true, error: true };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullText = "";
  // Keep partial text if the stream is interrupted, instead of throwing.
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const chunk = json.choices?.[0]?.delta?.content || "";
          if (chunk) {
            fullText += chunk;
            yield { text: fullText, done: false };
          }
        } catch {
          /* ignore partial json */
        }
      }
    }
  } catch (e) {
    console.error('Fallback stream interrupted — keeping partial text:', e);
  } finally {
    // Stop early -> generator .return() -> cancel the reader so the provider
    // stops streaming/generating instead of running on after the user hit Stop.
    reader.cancel().catch(() => {});
  }
  yield { text: fullText, done: true };
}

// Retry transient Gemini errors (503 overloaded / 429 rate-limited) with
// exponential backoff, rotating across keys if more than one is configured.
async function fetchGeminiWithRetry(
  url: string,
  init: RequestInit,
  retries = 3,
): Promise<Response> {
  let res = await fetch(url, init);
  let attempt = 0;
  let keyIdx = 0;
  while ((res.status === 503 || res.status === 429) && attempt < retries) {
    // Short wait — we rotate to a fresh key each retry, so no long backoff is needed.
    await new Promise((r) => setTimeout(r, 250));
    attempt++;
    const keys = getGeminiKeys();
    if (keys.length > 1) {
      keyIdx = (keyIdx + 1) % keys.length;
      url = url.replace(/([?&]key=)[^&]+/, `$1${keys[keyIdx]}`);
    }
    res = await fetch(url, init);
  }
  return res;
}

export async function generateBenchmarkComparison(
  originalMessage: string,
  userMessage: string,
  profile: UserProfile
): Promise<string> {
  const isAr = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';
  const prompt = `You are an evaluation assistant. Compare two answers to the same question and explain, briefly and concretely, how they differ in correctness, depth and clarity for a ${profile.level} ${profile.field} learner.

Question / original answer:
${originalMessage}

Alternative answer:
${userMessage}

Write a short markdown comparison (bullets are fine) in ${profile.language || 'English'}. Be specific; no preamble.`;

  // 1) Optional backend (skipped on static deploys where backendUp === false).
  if (backendUp !== false) {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/gemini/generateBenchmarkComparison', {
        method: 'POST',
        headers,
        body: JSON.stringify({ originalMessage, userMessage, profile })
      });
      const isHtml = res.headers.get('Content-Type')?.includes('text/html');
      if (res.ok && !isHtml) {
        const data = await res.json();
        if (data.result) return data.result;
      }
    } catch { /* fall through to direct providers */ }
  }

  // 2) Direct Gemini (static hosting).
  const apiKey = geminiPrimaryKey();
  if (apiKey) {
    try {
      const response = await fetchGeminiWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
        },
      );
      if (response.ok) {
        const d = await response.json();
        const txt = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (txt) return txt;
      }
    } catch { /* fall through to Groq */ }
  }

  // 3) Groq fallback.
  const groqKey = groqPrimaryKey();
  if (groqKey) {
    const txt = await groqChat([{ role: 'user', content: prompt }], groqKey);
    if (txt) return txt;
  }

  return isAr
    ? '⚠️ تعذّر إنشاء المقارنة الآن. جرّب تاني بعد لحظات.'
    : '⚠️ Couldn’t generate the comparison right now. Please try again in a moment.';
}

export async function generateProactiveInsights(
  profile: UserProfile,
  recentMessages: Message[]
): Promise<string> {
  const isAr = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';
  const recent = recentMessages
    .filter((m) => m.content?.trim())
    .slice(-6)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');
  const prompt = `Based on this learner (level: ${profile.level}, field: ${profile.field}, role: ${profile.role}) and their recent conversation, give 2-4 SHORT, specific, encouraging proactive study insights to help them grow. Write in ${profile.language || 'English'}. Each line starts with "* ". No preamble.\n\nRecent conversation:\n${recent || '(none yet)'}`;

  // 1) Backend (only if this build actually has one — static deploys skip it)
  if (backendUp !== false) {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/gemini/generateProactiveInsights', {
        method: 'POST',
        headers,
        body: JSON.stringify({ profile, recentMessages })
      });
      const isHtml = res.headers.get('Content-Type')?.includes('text/html');
      if (res.ok && !isHtml) {
        const data = await res.json();
        if (data.result) return data.result;
      }
    } catch { /* fall through */ }
  }

  // 2) Direct Gemini (static hosting)
  const apiKey = geminiPrimaryKey();
  if (apiKey) {
    try {
      const response = await fetchGeminiWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
        },
      );
      if (response.ok) {
        const d = await response.json();
        const txt = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (txt) return txt;
      }
    } catch { /* fall through */ }
  }

  // 3) Groq fallback
  const groqKey = groqPrimaryKey();
  if (groqKey) {
    const txt = await groqChat([{ role: 'user', content: prompt }], groqKey);
    if (txt) return txt;
  }

  return isAr
    ? '* ركّز على نقاط ضعفك واعمل تمارين منتظمة في مجالك.\n* راجع آخر اللي اتعلمته كل أسبوع.'
    : '* Keep practicing regularly in your field and target your weak spots.\n* Review what you learned each week.';
}

// Non-streaming Groq completion → returns the full text ("" on failure).
async function groqChat(
  messages: { role: string; content: string }[],
  apiKey: string,
): Promise<string> {
  try {
    const { url, model } = providerFor(apiKey);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0.7 }),
    });
    if (!res.ok) return "";
    const d = await res.json();
    return d.choices?.[0]?.message?.content || "";
  } catch {
    return "";
  }
}

// Generate a short, content-based chat title (3-6 words) from the first
// exchange — like ChatGPT's auto-naming. Falls back to a trimmed message.
export async function generateChatTitle(
  userMessage: string,
  aiReply: string,
  language?: string,
): Promise<string> {
  const fallback = userMessage.trim().slice(0, 40);
  const prompt = `Create a SHORT title (3 to 6 words) summarizing this conversation's topic. ${
    language ? `Write it in ${language}.` : 'Use the same language as the user.'
  } Reply with ONLY the title — no quotes, no trailing punctuation, no "Title:" prefix.

User: ${userMessage.slice(0, 500)}
Assistant: ${aiReply.slice(0, 500)}`;

  const clean = (t: string) =>
    t.replace(/^["'#\s]+|["'.\s]+$/g, '').replace(/^title:\s*/i, '').split('\n')[0].slice(0, 60).trim();

  // Direct Gemini → Groq fallback.
  const apiKey = geminiPrimaryKey();
  if (apiKey) {
    try {
      const res = await fetchGeminiWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
        },
      );
      if (res.ok) {
        const d = await res.json();
        const txt = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (txt) return clean(txt) || fallback;
      }
    } catch { /* fall through */ }
  }
  const groqKey = groqPrimaryKey();
  if (groqKey) {
    const txt = await groqChat([{ role: 'user', content: prompt }], groqKey);
    if (txt) return clean(txt) || fallback;
  }
  return fallback;
}

export async function generateLogicResponse(
  message: string,
  profile: UserProfile,
  moduleName: string,
  history: { role: 'user' | 'model', parts: { text: string }[] }[] = []
): Promise<string> {
  const isAr = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';

  // Direct (no-backend) path: Gemini → Groq. Used when there's no backend, and
  // as the fallback when a backend request fails.
  const direct = async (): Promise<string> => {
    let text = "";
    const apiKey = geminiPrimaryKey();
    if (apiKey) {
      try {
        const prompt = `You are a Logic Tutor on ${moduleName}.\nUser Profile: ${JSON.stringify(profile)}\nUser: ${message}`;
        const response = await fetchGeminiWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] })
        });
        if (response.ok) {
          const d = await response.json();
          text = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
        }
      } catch { /* fall through to Groq */ }
    }
    if (!text) {
      const groqKey = groqPrimaryKey();
      if (groqKey) {
        text = await groqChat([
          { role: "system", content: `You are a Logic Tutor for the "${moduleName}" module. ${buildPersona(profile)}` },
          { role: "user", content: message },
        ], groqKey);
      }
    }
    return text || (isAr
      ? "⚠️ الذكاء مشغول دلوقتي بسبب الضغط. جرّب كمان شوية 🙏"
      : "⚠️ The AI is busy right now. Please try again in a moment 🙏");
  };

  if (backendUp === false) return direct();

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/gemini/generateLogicResponse', {
      method: 'POST',
      headers,
      body: JSON.stringify({ message, profile, moduleName, history })
    });
    const isHtml = res.headers.get('Content-Type')?.includes('text/html');
    if (!res.ok || isHtml) {
      if (isHtml || res.status === 404) backendUp = false;
      return direct();
    }
    const data = await res.json();
    return data.result;
  } catch {
    return direct();
  }
}

async function* generateAdaptiveResponseStreamClient(
  message: string,
  profile: UserProfile,
  history: Message[],
  attachments: { name: string, type: string, data: string }[] = [],
  apiKey: string,
  signal?: AbortSignal
) {
  const otherThreadsSummary = profile.chatThreads
    ?.filter(t => t.id !== profile.activeThreadId)
    .map(t => `Thread "${t.title}": ${t.lastMessageSnippet || 'No summary'}`)
    .join('\n') || 'None';

  let studentMemoryBlock = '';
  if (profile.memory && profile.memory.enabled === true) {
    const goals = Array.isArray(profile.memory.learningGoals) && profile.memory.learningGoals.length
      ? profile.memory.learningGoals.map((g) => `- ${g}`).join('\n')
      : '- None specified';
    const prefs = Array.isArray(profile.memory.knownPreferences) && profile.memory.knownPreferences.length
      ? profile.memory.knownPreferences.map((p) => `- ${p}`).join('\n')
      : '- None specified';
    const confirmed = Array.isArray(profile.memory.explicitConfirmedInfo) && profile.memory.explicitConfirmedInfo.length
      ? profile.memory.explicitConfirmedInfo.map((c) => `- ${c}`).join('\n')
      : '- None specified';

    studentMemoryBlock = `
## COGNIFY STUDENT MEMORY
- Preferred Explanation Language: ${profile.memory.preferredLanguage || 'English'}
- Explanation Style Preference: ${profile.memory.explanationStyle || 'Practical examples first'}
- Current Learning Goals:
${goals}
- Known Preferences:
${prefs}
- Explicitly Confirmed Student Facts:
${confirmed}
`;
  }

  let spatialMemoryBlock = '';
  if (Array.isArray(profile.spatialMemories) && profile.spatialMemories.length > 0) {
    spatialMemoryBlock = '\n## COGNIFY SPATIAL MEMORY (PHYSICAL OBJECT LOCATIONS REMEMBERED BY VISION COMPANION)\n' +
      '- The following physical items and their last-observed locations have been recorded for this student:\n' +
      profile.spatialMemories.slice(0, 8).map(m => `  * ${m.objectName || 'Item'}: on ${[m.surface, m.room, m.relativePosition?.direction ? `(${m.relativePosition.direction})` : ''].filter(Boolean).join(', ') || 'surface'} [Observed at: ${m.lastSeenIso ? new Date(m.lastSeenIso).toLocaleTimeString() : 'recently'}]`).join('\n') +
      '\n- INSTRUCTION: If the user asks where an object is located, reference its last known location accurately and state that it was the position observed at that time.\n';
  }

  let cognitiveBlock = '';
  const clientLevel = (profile.level || 'Intermediate').trim();
  if (clientLevel === 'Basic') {
    cognitiveBlock += `\n## COGNITIVE CALIBRATION: FOUNDATIONAL
- Break complex concepts into intuitive, bite-sized components with concrete analogies.
- Emphasize foundational clarity, intuitive explanations, and frequent comprehension checkpoints.`;
  } else if (clientLevel === 'Advanced') {
    cognitiveBlock += `\n## COGNITIVE CALIBRATION: SOCRATIC & DEEP RIGOR
- Deliver high-density analytical reasoning, formal proofs, structural abstractions, and edge cases.
- Use Socratic inquiry to challenge assumptions and probe advanced mathematical/algorithmic implications.`;
  } else {
    cognitiveBlock += `\n## COGNITIVE CALIBRATION: BALANCED
- Deliver structured explanations balancing conceptual intuition, real-world context, and logical progression.`;
  }

  if (profile.preferredPedagogyStyle === 'analogies') {
    cognitiveBlock += `\n## PEDAGOGICAL STYLE: VISUAL ANALOGIES & METAPHORS
- Anchor explanations in physical, real-world analogies (mailboxes, water pipes, maps).
- Prioritize visual mental models and intuitive concepts before syntax.`;
  } else if (profile.preferredPedagogyStyle === 'technical') {
    cognitiveBlock += `\n## PEDAGOGICAL STYLE: DEEP TECHNICAL & ACADEMIC RIGOR
- Be concise, dense, and precise. Reference time/space complexity (Big-O), memory layout, and formal specifications.`;
  } else if (profile.preferredPedagogyStyle === 'scaffolded') {
    cognitiveBlock += `\n## PEDAGOGICAL STYLE: STEP-BY-STEP SCAFFOLDING
- Deconstruct the problem into numbered, sequential micro-milestones with quick comprehension checks.`;
  } else if (profile.preferredPedagogyStyle === 'socratic') {
    cognitiveBlock += `\n## PEDAGOGICAL STYLE: SOCRATIC INQUIRY
- Guide the student by asking 1-2 targeted probing questions so they deduce the solution inductively.`;
  }

  const systemInstruction = `
You are Cognify, an adaptive AI mentor. Your only goal: the most correct, useful answer possible, calibrated to THIS user.

## USER
- Level: ${profile.level} | Role: ${profile.role} (${profile.educationLevel || 'N/A'})
- Field: ${profile.field}
- Context: ${profile.role === 'Student' ? `${profile.faculty} @ ${profile.university}` : `${profile.jobTitle} @ ${profile.work}`}
- Preferred language: ${profile.language || 'English'}
- Accessibility mode: ${profile.accessibilityMode}

## CALIBRATION (highest priority)
- Basic: short sentences, everyday analogies, zero jargon, one idea at a time.
- Intermediate: normal professional vocabulary, show brief reasoning.
- Advanced: be rigorous and direct, skip the basics, engage with nuance, trade-offs and edge cases.
- Anchor examples in the user's field (${profile.field}) whenever natural.

## LANGUAGE MIRRORING (strict)
- User's configured language: ${profile.language || 'English'}.
- When initiating study help or if query language is ambiguous, reply in ${profile.language || 'English'}.
Always reply in the same language AND dialect as the user's LAST message:
- English → English.
- فصحى → فصحى.
- مصري (علامات: "ازيك"، "عايز"، "ليه"، "ازاي") → رد بمصري طبيعي وودود ("تمام يا باشا"، "خليني أقولك على حاجة"...) مع الحفاظ على دقة المصطلحات التقنية — ممكن تكتب المصطلح الإنجليزي بين قوسين.
- French → French (naturel, fluide et idiomatique).
- Spanish / German / Italian / Portuguese / Russian / Chinese / Japanese → reply naturally in that language.
- If the user's configured language is French ("French") and query language is ambiguous, reply in French.
- If the user switches language mid-conversation, switch immediately.

## ANSWER STYLE
- Answer the question FIRST, then add context. No filler openers ("Great question!", "Sure!").
- Simple question → 1-4 sentences of plain prose. Use bullets/headers ONLY when the answer is genuinely multi-part.
- If the input is messy, misspelled or mixed-language, infer the intent and answer it. Never say you can't understand.
- If asked the same thing again, explain it from a different angle — never repeat your previous wording.
- If you are not certain about a fact, say so briefly. Never invent facts, sources or numbers.

## ACCESSIBILITY
${profile.accessibilityMode === 'Visual' ? `- USER IS BLIND. Describing an image/photo is a practical task, not a creative one:
  1) Say FIRST if anything looks like a hazard (traffic, stairs, obstacles, fire, spills, sharp/hot objects) — one short sentence, before anything else.
  2) Read any visible text VERBATIM (labels, signs, medicine dosage, prices, dates) — do not paraphrase or summarize numbers/instructions.
  3) Then describe what matters practically: what/who is there, roughly where (left/right/near/far, or clock position like "at 2 o'clock"), not colors or aesthetics unless asked.
  4) Be concise — a few short sentences, not a paragraph. No flowery/"vivid" language, no markdown, no tables — this is read aloud by TTS.` : ''}
${(profile.accessibilityMode === 'Vocal-Deaf' || profile.accessibilityMode === 'Sign-Only') ? `- User is deaf. Short, visual sentences.` : ''}
${profile.accessibilityMode === 'Speech' ? `- Output is read aloud by TTS: smooth speakable prose, no tables, no symbol clutter, no markdown noise.` : ''}
${studentMemoryBlock}${spatialMemoryBlock}${cognitiveBlock}
## THREAD MEMORY
Summaries of the user's other threads are below. Use them ONLY if the user explicitly asks about past conversations. Otherwise ignore them completely — never volunteer them, especially not on greetings.
${otherThreadsSummary}
`;

  const contents: any[] = [];
  const historyForModel = history
    .filter(m => m.id !== 'welcome')
    .filter(m => m.content?.trim())
    .map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

  const cleanHistory = historyForModel[0]?.role === 'model' ? historyForModel.slice(1) : historyForModel;
  // The caller passes the just-sent user message as the LAST item of `history`,
  // and we also append it explicitly below (with its attachments). Drop that
  // trailing duplicate so the question isn't sent to the model twice — that
  // both wastes tokens/quota and muddies the context.
  const last = cleanHistory[cleanHistory.length - 1];
  const dedupedHistory = (last?.role === 'user' && last.parts?.[0]?.text === message)
    ? cleanHistory.slice(0, -1)
    : cleanHistory;
  contents.push(...dedupedHistory);

  const currentParts: any[] = [{ text: message }];
  attachments.forEach(file => {
    const rawData = typeof file.data === 'string' ? file.data.replace(/^data:[^;]+;base64,/, '') : file.data;
    currentParts.push({
      inlineData: {
        mimeType: file.type,
        data: rawData
      }
    });
  });
  contents.push({ role: 'user', parts: currentParts });

  const body = JSON.stringify({
    contents,
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      temperature: 0.7,
      topP: 0.95
    }
  });

  // Try each known-good model until one responds. A wrong model 404s, so this
  // also protects us if Google retires a model. Log the real reason on failure
  // so it's never an invisible "the chat just broke".
  let res: Response | null = null;
  let lastStatus = 0; // real HTTP status of the last failed attempt (res is null on failure)
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const r = await fetchGeminiWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal
    });
    if (r.ok && r.body) { res = r; break; }
    lastStatus = r.status;
    const errText = await r.text().catch(() => "");
    console.error(`Gemini model "${model}" failed (${r.status}):`, errText.slice(0, 300));
    if (r.status === 400 || r.status === 401 || r.status === 403) break; // bad key/request — other models won't help
  }

  if (!res || !res.ok) {
    // Gemini failed (overloaded/rate-limited) → automatically fall back to Groq.
    const groqKey = groqPrimaryKey();
    if (groqKey) {
      // Signal the fallback so the UI can warn if attachments (images/PDFs) were
      // sent — the text-only fallback provider can't see them.
      yield { text: '', done: false, usedFallback: true };
      yield* generateGroqStream(message, profile, history, groqKey, signal);
      return;
    }
    const isArabic = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';
    const status = res?.status ?? lastStatus; // res is null here, so use the captured status
    if (status === 503) {
      toast.error(
        isArabic
          ? "منصة Google Gemini غير متوفرة حالياً بسبب زيادة الضغط (رمز 503). يرجى المحاولة بعد لحظات."
          : "Google Gemini is currently rate-limited or overloaded (503 Service Unavailable). Please try again shortly.",
        isArabic ? "الخدمة مثقلة بالأحمال" : "Gemini Overloaded"
      );
      yield {
        text: isArabic
          ? "⚠️ منصة Google Gemini غير متوفرة حالياً بسبب زيادة الضغط (رمز 503)."
          : "⚠️ Google Gemini is currently overloaded (503 Service Unavailable).",
        done: true,
        error: true
      };
    } else {
      toast.error(
        isArabic
          ? `عذراً، فشل الاتصال بخوادم الذكاء الاصطناعي (رمز ${status}). تأكد من صحة مفتاح الـ API.`
          : `AI gateway communication error (Status: ${status}). Please verify your custom API key.`,
        isArabic ? "فشل بوابة الذكاء" : "Gateway Error"
      );
      yield {
        text: isArabic
          ? `⚠️ عذراً، فشل الاتصال بخوادم الذكاء الاصطناعي (رمز ${status}).`
          : `⚠️ AI gateway communication error (Status: ${status}).`,
        done: true,
        error: true
      };
    }
    return;
  }

  if (!res.body) {
    yield { text: "Couldn't connect to the AI. Please try again.", done: true, error: true };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = '';
  let fullText = '';

  // If the network drops mid-stream, DON'T throw (that would discard everything
  // already written). Keep what we have and finalize it gracefully.
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6));
            const chunkText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (chunkText) {
              fullText += chunkText;
              yield { text: fullText, done: false };
            }
          } catch (e) {
            // ignore parsing streams error
          }
        }
      }
    }
  } catch (e) {
    console.error('Gemini stream interrupted — keeping partial text:', e);
  } finally {
    // When the consumer stops early (Stop button -> generator .return()), cancel
    // the reader so the HTTP stream closes and Google stops generating (and billing).
    reader.cancel().catch(() => {});
  }

  yield { text: fullText, done: true };
}

export async function* generateAdaptiveResponseStream(
  message: string,
  profile: UserProfile,
  history: Message[],
  attachments: { name: string, type: string, data: string }[] = [],
  signal?: AbortSignal,
  studentState?: any
) {
  // Once we know there's no backend, go straight to the direct path.
  if (backendUp === false) {
    const apiKey = geminiPrimaryKey();
    if (apiKey) { yield* generateAdaptiveResponseStreamClient(message, profile, history, attachments, apiKey, signal); return; }
    const groqKey = groqPrimaryKey();
    if (groqKey) { yield* generateGroqStream(message, profile, history, groqKey, signal); return; }
    const ar = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';
    yield { text: ar ? '⚠️ مفيش مفتاح ذكاء اصطناعي متفعّل.' : '⚠️ No AI key configured.', done: true, error: true };
    return;
  }
  try {
    let headers = await getAuthHeaders();

    let res = await fetch('/api/gemini/generateAdaptiveResponseStream', {
      method: 'POST',
      headers,
      body: JSON.stringify({ message, profile, history, attachments, studentState }),
      signal
    });

    // If 401 Unauthorized occurs while logged in, attempt a one-time force refresh of the Firebase token
    if (res.status === 401 && auth.currentUser) {
      headers = await getAuthHeaders(true);
      if (headers['Authorization']) {
        res = await fetch('/api/gemini/generateAdaptiveResponseStream', {
          method: 'POST',
          headers,
          body: JSON.stringify({ message, profile, history, attachments, studentState }),
          signal
        });
      }
    }

    const isHtml = res.headers.get('Content-Type')?.includes('text/html') || false;
    const isMissingBackend = isHtml || res.status === 404;

    if (!res.ok || isMissingBackend) {
      if (isMissingBackend) {
        backendUp = false; // genuinely no serverless backend on this host
      }
      const apiKey = geminiPrimaryKey();
      if (apiKey) {
        yield* generateAdaptiveResponseStreamClient(message, profile, history, attachments, apiKey, signal);
        return;
      }
      // No Gemini key configured → use Groq directly if available.
      const groqKey = groqPrimaryKey();
      if (groqKey) {
        yield* generateGroqStream(message, profile, history, groqKey, signal);
        return;
      }

      const isArabic = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';
      const isFrench = profile.language === 'French' || (profile.language as any) === 'fr';
      
      if (!isMissingBackend) {
        if (res.status === 401) {
          const authErrMsg = isArabic
            ? "انتهت صلاحية جلسة تسجيل الدخول أو تعذر التحقق من الهوية (رمز 401). يرجى تسجيل الخروج ثم الدخول مجدداً."
            : isFrench
            ? "La session d'authentification a expiré ou est invalide (Code 401). Veuillez vous reconnecter."
            : "Authentication session expired or invalid (Status: 401). Please sign out and sign back in.";
          toast.error(authErrMsg, isArabic ? "خطأ في المصادقة" : "Authentication Required");
          yield { text: `⚠️ **${authErrMsg}**`, done: true, error: true };
          return;
        } else if (res.status === 503) {
          const serviceErrMsg = isArabic 
            ? "فشل الاتصال: مفتاح الذكاء الاصطناعي غير متوفر على السيرفر أو أن الخدمة مجهدة حالياً (503). يمكنك وضع مفتاحك الخاص في الإعدادات."
            : isFrench
            ? "Service IA indisponible : Aucune clé API configurée sur le serveur ou service surchargé (503). Vous pouvez renseigner votre clé dans les Paramètres."
            : "AI service unavailable: No active API key found on server or provider is overloaded (503). You can configure your own key in Settings.";
          toast.error(serviceErrMsg, isArabic ? "الخدمة غير متوفرة" : "AI Service Unavailable");
          yield { text: `⚠️ **${serviceErrMsg}**`, done: true, error: true };
          return;
        } else if (res.status >= 500) {
          toast.error(
            isArabic
              ? `حدث خطأ تقني داخلي في خادم الاتصال (رمز ${res.status}).`
              : isFrench
              ? `Une erreur interne est survenue sur le serveur (Code ${res.status}).`
              : `Internal gateway error occurred on the server (Status: ${res.status}).`,
            isArabic ? "خطأ الاتصال مفقود" : "Internal Gateway Fault"
          );
        } else {
          toast.warning(
            isArabic
              ? `لم تكتمل العملية بنجاح (رمز الاستجابة: ${res.status}).`
              : `Request failed with response status: ${res.status}.`,
            isArabic ? "فشل طلب الخدمة" : "Request Failure"
          );
        }
      }

      const cloudRunUrl = "https://ais-pre-yrqajcztyb24fektpr6ddb-78152961995.europe-west1.run.app";
      const explanationText = isArabic 
        ? `⚠️ **تنبيه هام حول بيئة التشغيل من كوجنيفي:**
        
أنت تقوم حاليًا بتصفح التطبيق عبر استضافة ساكنة بدون خادم خلفي نشط (Static Hosting)، وهي لا تدعم الـ Express Backend اللازم لتشغيل وظائف الذكاء الاصطناعي السحابية.

للحصول على كامل أداء كوجنيفي، من فضلك افتح رابط التشغيل المباشر والكامل للـ Full-Stack على منصة **Cloud Run** من جوجل:
👉 **[زيارة رابط التشغيل المتكامل والكامل من هنا](${cloudRunUrl})**

*إذا كنت تفضل استخدام Vercel، يمكنك ببساطة وضع مفتاحك الخاص للذكاء الاصطناعي باسم \`VITE_GEMINI_API_KEY\` في إعدادات البيئة بـ Vercel أو في صفحة الإعدادات بالتطبيق ليعمل معك مباشرة.*`
        : `⚠️ **Cognify Deployment Warning:**

You are currently accessing the application on a Static Host without an active API backend. This environment does not run server-side AI endpoints.

To experience Cognify's full-stack features, please use our fully integrated **Cloud Run** preview URL:
👉 **[Open the Full-Stack Cloud Run App Here](${cloudRunUrl})**

*If you prefer to host on Vercel, you can configure your own Gemini API key inside Vercel's environment variables as \`VITE_GEMINI_API_KEY\` or enter it directly in Settings to enable in-browser processing.*`;

      yield { text: explanationText, done: true, error: true };
      return;
    }

    if (!res.body) {
      yield { text: "Couldn't connect to the AI. Please try again.", done: true, error: true };
      return;
    }

    backendUp = true; // backend is real — keep using it

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.replace('data: ', '');
            try {
              const chunk = JSON.parse(jsonStr);
              yield chunk;
            } catch (e) {
              console.error("Stream parsing error", e);
            }
          }
        }
      }
    } finally {
      // Stop early -> cancel the server stream so it stops proxying tokens.
      reader.cancel().catch(() => {});
    }
  } catch (err: any) {
    // User pressed Stop (AbortController) — not a real error, don't toast.
    if (err?.name === 'AbortError') { yield { text: '', done: true }; return; }
    const isArabic = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';
    toast.error(
      isArabic
        ? "تعذّر الاتصال بالخادم. تأكّد من اتصالك بالإنترنت وحاول مرة أخرى."
        : "Couldn't reach the server. Check your connection and try again.",
      isArabic ? "خطأ في الاتصال" : "Connection Error"
    );
    yield { text: `Error: ${err.message}`, done: true, error: true };
  }
}

export async function generateAdaptiveResponse(
  message: string,
  profile: UserProfile,
  history: Message[],
  attachments: { name: string, type: string, data: string }[] = [],
  studentState?: any
) {
  const isAr = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';

  // Direct (no-backend) path: stream from Gemini/Groq and collect the full text.
  const direct = async (): Promise<string> => {
    let text = "";
    for await (const chunk of generateAdaptiveResponseStream(message, profile, history, attachments, undefined, studentState)) {
      if (chunk.text) text = chunk.text;
    }
    return text || (isAr
      ? "⚠️ الذكاء مشغول دلوقتي. جرّب تاني 🙏"
      : "⚠️ The AI is busy right now. Please try again in a moment 🙏");
  };

  if (backendUp === false) return direct();

  try {
    let headers = await getAuthHeaders();

    let res = await fetch('/api/gemini/generateAdaptiveResponse', {
      method: 'POST',
      headers,
      body: JSON.stringify({ message, profile, history, attachments, studentState })
    });

    if (res.status === 401 && auth.currentUser) {
      headers = await getAuthHeaders(true);
      if (headers['Authorization']) {
        res = await fetch('/api/gemini/generateAdaptiveResponse', {
          method: 'POST',
          headers,
          body: JSON.stringify({ message, profile, history, attachments, studentState })
        });
      }
    }

    const isHtml = res.headers.get('Content-Type')?.includes('text/html');
    if (!res.ok || isHtml) {
      if (isHtml || res.status === 404) backendUp = false;
      return direct();
    }
    const data = await res.json();
    return data.result;
  } catch {
    return direct();
  }
}
