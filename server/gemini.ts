import { GoogleGenAI } from "@google/genai";
import { UserProfile, Message } from "../src/types";

let aiInstance: GoogleGenAI | null = null;

function getAI() {
  if (!aiInstance) {
    const raw = (process.env.GEMINI_API_KEY || '').trim();
    const primaryKey = raw.split(/[,\s]+/)[0]?.trim();
    if (!primaryKey) {
      throw new Error('GEMINI_API_KEY is not configured in server environment.');
    }
    aiInstance = new GoogleGenAI({ apiKey: primaryKey });
  }
  return aiInstance;
}

// Retry transient Gemini failures (503 overloaded / 429 rate-limited) with backoff.
async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e);
      const transient = /503|overloaded|UNAVAILABLE|429|RESOURCE_EXHAUSTED|rate limit/i.test(msg);
      if (!transient || attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, 700 * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

// Model-call wrappers with built-in transient-error retry.
const genContent = (args: any) => withRetry(() => getAI().models.generateContent(args));
const genContentStream = (args: any) => withRetry(() => getAI().models.generateContentStream(args));

const getSystemInstruction = (profile: UserProfile, otherThreadsSummary: string = 'None') => {
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

  return `
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
  4) Be concise — a few short sentences, not a paragraph. No flowery/"vivid" language, no markdown, no tables — this is read aloud by TTS. CRITICAL: Never output markdown asterisks (**), bullet points, or section headings (do NOT write "**Hazards:** None" or "**Visible Text:** None" or "**Scene Description:**"). Speak directly in natural conversational prose.` : ''}
${(profile.accessibilityMode === 'Vocal-Deaf' || profile.accessibilityMode === 'Sign-Only') ? `- User is deaf. Short, visual sentences.` : ''}
${profile.accessibilityMode === 'Speech' ? `- Output is read aloud by TTS: smooth speakable prose, no tables, no symbol clutter, no markdown noise.` : ''}
${studentMemoryBlock}${cognitiveBlock}
## THREAD MEMORY
Summaries of the user's other threads are below. Use them ONLY if the user explicitly asks about past conversations. Otherwise ignore them completely — never volunteer them, especially not on greetings.
${otherThreadsSummary}

## TOOLS
Call generateImage only when the user asks for an image.
`;
};

export async function evaluateQuizPOV(question: string, pov: string): Promise<boolean> {
  try {
    const ai = getAI();
    const prompt = `A user answered a logic trick question: 
Question: "${question}"
Their custom reasoning: "${pov}" 

Is their reasoning somewhat logical, creative, or functionally identifying the trick/anomaly? 
Reply with EXACTLY ONE WORD: either "YES" or "NO".`;
    const response = await genContent({
       model: "gemini-2.5-flash",
       contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    return response.text?.trim().toUpperCase().includes("YES") ?? true;
  } catch (error) {
    console.error('POV Eval Error', error);
    return true; // Fallback to accepting it if AI fails
  }
}

interface QuizItem {
  id: number;
  text: string;
  options: string[];
}

/** Extract the first JSON array from a model response (tolerates ``` fences). */
function extractJsonArray(raw: string): any[] {
  if (!raw) return [];
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
}

/**
 * Translate quiz questions (text + options) into the target language while
 * keeping the SAME number and ORDER of options so the caller can still score
 * by position. Returns [{id, text, options}].
 */
export async function translateQuiz(
  questions: QuizItem[],
  language: string,
): Promise<QuizItem[]> {
  if (!language || language === "English" || !Array.isArray(questions)) {
    return questions || [];
  }
  try {
    const ai = getAI();
    const dialect =
      language === "Egyptian Ammiya" ? " (Egyptian colloquial Arabic)" : "";
    const prompt = `Translate these IQ/logic quiz questions into ${language}${dialect}.
Rules:
- Keep the EXACT same number of options, in the SAME order.
- Preserve numbers, sequences and proper nouns; translate naturally otherwise.
- Keep each question solvable (do not reveal the answer).
- Return ONLY a JSON array of {"id": number, "text": string, "options": string[]}. No markdown.

Input: ${JSON.stringify(
      questions.map((q) => ({ id: q.id, text: q.text, options: q.options })),
    )}`;
    const response = await genContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const parsed = extractJsonArray(response.text?.trim() || "");
    return parsed.length ? (parsed as QuizItem[]) : questions;
  } catch (error) {
    console.error("Quiz translation error", error);
    return questions; // graceful fallback to original (English)
  }
}

export interface AssessmentQuestion {
  id: number;
  type: "mcq" | "open";
  text: string;
  options: string[];
  correctAnswer: string;
}

/**
 * Generate a field-specific knowledge assessment to measure a learner's level
 * in their chosen domain. Returns a mix of multiple-choice and one short
 * open-ended question, written directly in the requested language.
 */
export async function generateAssessment(
  field: string,
  language: string = "English",
  level: string = "Basic",
  count: number = 8,
): Promise<AssessmentQuestion[]> {
  const domain = (field || "").trim() || "General Knowledge";
  try {
    const ai = getAI();
    const dialect =
      language === "Egyptian Ammiya" ? " (Egyptian colloquial Arabic)" : "";
    const mcqCount = Math.max(1, count - 1);
    const prompt = `You are an expert examiner creating a focused assessment for a learner whose field/track is: "${domain}".
Generate exactly ${count} questions that test REAL core knowledge, concepts and terminology SPECIFIC to "${domain}".
STRICT rules:
- Every question MUST be clearly about "${domain}" — its concepts, tools, theories or practice.
- DO NOT use generic IQ, riddles, trick questions, math puzzles or general trivia.
- Level: ${level} (foundational core concepts of the field for "Basic").
- Write EVERYTHING (questions and options) in ${language}${dialect}.
- ${mcqCount} multiple-choice (exactly 4 distinct options, EXACTLY ONE correct) + 1 short open-ended question asking them to explain a key concept in "${domain}".
- Accurate and unambiguous.
Return ONLY a JSON array; each item:
{"id": number, "type": "mcq" | "open", "text": string, "options": string[] (4 for mcq, [] for open), "correctAnswer": string (the exact correct option for mcq, or a concise model answer for open)}`;

    const response = await genContent({
      model: "gemini-2.5-flash",
      contents: [{ text: prompt }],
      config: { responseMimeType: "application/json" },
    });
    const parsed = JSON.parse(response.text?.trim() || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((q: any, i: number) => ({
        id: typeof q.id === "number" ? q.id : i + 1,
        type: q.type === "open" ? ("open" as const) : ("mcq" as const),
        text: String(q.text || ""),
        options: Array.isArray(q.options) ? q.options.map(String) : [],
        correctAnswer: String(q.correctAnswer || ""),
      }))
      .filter((q) => q.text && (q.type === "open" || q.options.length >= 2));
  } catch (e) {
    console.error("generateAssessment error:", e);
    return [];
  }
}

export async function generateBenchmarkComparison(
  originalMessage: string,
  userMessage: string,
  profile: UserProfile
): Promise<string> {
  try {
    const ai = getAI();
    // NOTE: this used to instruct the model to "act as ChatGPT (GPT-4)" and to
    // emit a "## ChatGPT Response" section. No OpenAI model is contacted anywhere
    // in this project, so that output was our own model impersonating a competitor
    // and being shown to the user as a third-party assessment. It is now an
    // honest self-review, which is what it always actually was.
    const prompt = `You are a strict reviewer performing a SECOND-PASS review of an AI tutor's answer.
The user asked: "${userMessage}"
The assistant (Cognify) replied: "${originalMessage}"

Write an independent, higher-quality answer to the same question for this learner:
User Level: ${profile.level}
User Field: ${profile.field}

Respond in this EXACT format:
## Improved Answer
[Your own stronger answer — structured, clear, accurate.]

## Critique
[Briefly: what the original answer did well, and what yours does better or differently.]
`;

    const response = await genContent({
      model: "gemini-2.5-flash",
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    return response.text || "Failed to generate comparison. Please try again.";
  } catch (error) {
    console.error("Benchmark error:", error);
    return "An error occurred while generating the comparison. Please wait and try again.";
  }
}

export async function generateProactiveInsights(
  profile: UserProfile,
  recentMessages: Message[] = []
): Promise<string> {
  try {
    const ai = getAI();
    const safeMessages = Array.isArray(recentMessages) ? recentMessages : [];
    const context = safeMessages.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n');
    const prompt = `You are a proactive AI mentor. The user is a ${profile.level} in the field of ${profile.field}.
Based on their recent conversation:
${context || 'No recent conversation.'}

Proactively generate 3 highly relevant study materials, actionable insights, or next steps tailored specifically to their profile and current focus. Format as a concise, engaging markdown list.`;

    const response = await genContent({
      model: "gemini-2.5-flash",
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    return response.text || "No insights available at the moment.";
  } catch (error) {
    console.error("Insights error:", error);
    return "Failed to generate insights. Please try again.";
  }
}

export async function generateLogicResponse(
  message: string,
  profile: UserProfile,
  moduleName: string,
  history: { role: 'user' | 'model', parts: { text: string }[] }[] = []
) {
  try {
    const ai = getAI();
    const model = "gemini-2.5-flash";
    
    const systemInstruction = `
You are the Cognify Advanced Logic Tutor, a production-grade AI designed to train logic and analytical skills focusing on "${moduleName}".

Student Academic Level: ${profile.level || 'Intermediate'}

Preferred Interaction Language: ${profile.language || 'English'} (MANDATORY: You MUST reply in this language/dialect).

========================
STRICT LANGUAGE RULES
========================
1. LANGUAGE MATCHING: If the Preferred Interaction Language is "Arabic", use Modern Standard Arabic. If "Egyptian Ammiya", use Egyptian Arabic. 
2. BIPOLAR MIRRORING: Despite rule 1, if the user switches languages mid-conversation, you MUST match their current language/dialect immediately.
3. ADAPTIVE LOGIC: For technical terms in ${profile.field || 'the field'}, you may provide the English term in parentheses after its Arabic translation if it enhances clarity.
4. EGYPTIAN AMMIYAH: Use warm local phrasing if detected.

========================
PRODUCTION PRIORITIES (SMART & FLEXIBLE)
========================
1. UNDERSTANDING & INTENT:
- Understand user intent clearly even if input is messy, repeated, or poorly formatted. Focus on meaning, not exact wording.
- Never say you cannot understand messy input. Always try to interpret the user correctly.

2. RAG & CONTEXT USAGE:
- Use provided context (metadata, history, or knowledge) as helpful reference only.
- DO NOT copy from the context. Always rephrase and explain in your own words.
- Combine information intelligently if multiple sources exist.

3. DYNAMIC RESPONSE STYLE:
- Adapt explanation length: Simple question -> short answer. Complex question -> clear, structured explanation.
- Be flexible and natural. Avoid robotic, repetitive, or formulaic phrasing.

4. READABILITY & FORMATTING:
- Always use a clean, structured format. Use short sentences.
- Prefer bullet points for multiple ideas to stay visually easy to read.
- Remove redundancy and unnecessary filler info.

5. MEMORY & BEHAVIOR:
- Do NOT repeat previous answers from history.
- If a question is repeated, re-explain using a different angle or a simpler approach.
- Be helpful, calm, and clear.

6. LOGIC TUTORING (SOCRATIC):
- Guide them step-by-step with hints. Do not just give answers.
- TEACH *HOW* TO THINK: Use mental models and analogies tailored to their level.

Make the experience feel like sitting with a brilliant, patient mentor who is stretching their brain's capacity.
`;

    const chatHistory = history.map(h => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: h.parts
    }));

    const response = await genContent({
      model,
      contents: [
        ...chatHistory,
        { role: 'user', parts: [{ text: message }] }
      ],
      config: {
        systemInstruction,
        temperature: 0.4,
        thinkingConfig: { thinkingBudget: -1 }
      }
    });

    return response.text || "Logic module encountered an error (empty response).";
  } catch (error) {
    console.error("Error generating logic response:", error);
    return "The logic training uplink experienced an error. Please try again.";
  }
}

// NOTE: the old generateAdaptiveResponseStream / generateAdaptiveResponse
// functions that used to live here were removed — chat now goes through
// api/gemini/generateAdaptiveResponse(Stream).ts via server/routes.ts, the
// same Phase 1 (Router + Telemetry + multi-provider fallback) implementation
// used in production on Vercel. See server/routes.ts for the wiring.
