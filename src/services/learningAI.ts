// ==========================================
// Adaptive Learning AI Engine
// Generates exercises, analyzes answers, adapts difficulty
// ==========================================

import {
  SubjectType, DifficultyLevel, TeachingMethod, Exercise, ExerciseConfig,
  ExerciseResult, AIAnalysis, SubjectProfile, LearningProfile, VisualAidData,
} from '../types/learning';
import { getGeminiKeys, getGroqKeys, getXaiKeys, getNvidiaKeys, getAuthHeaders } from './gemini';

// ── AI Call Helper ─────────────────────────
async function callAI(prompt: string): Promise<string> {
  // Try backend proxy first
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/gemini/generateContent', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        parts: [{ text: prompt }],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.result) return data.result;
      if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        return data.candidates[0].content.parts[0].text;
      }
    }
  } catch { /* fall through */ }

  // Direct Gemini API fallback
  const keys = getGeminiKeys();
  if (keys.length > 0) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${keys[0]}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
          }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }
    } catch { /* fall through */ }
  }

  // OpenAI-compatible fallback (Groq/NVIDIA/xAI)
  const fallbackKeys = [...getNvidiaKeys(), ...getGroqKeys(), ...getXaiKeys()];
  if (fallbackKeys.length > 0) {
    const key = fallbackKeys[0];
    const isNvidia = key.startsWith('nvapi-');
    const isGroq = key.startsWith('gsk_');
    const url = isNvidia
      ? 'https://integrate.api.nvidia.com/v1/chat/completions'
      : isGroq
        ? 'https://api.groq.com/openai/v1/chat/completions'
        : 'https://api.x.ai/v1/chat/completions';
    const model = isNvidia ? 'deepseek-ai/deepseek-r1' : isGroq ? 'llama-3.3-70b-versatile' : 'grok-2-latest';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 2048,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data?.choices?.[0]?.message?.content || '';
      }
    } catch { /* fall through */ }
  }

  return '';
}

// ── Parse JSON from AI response ────────────
function parseJSON<T>(raw: string): T | null {
  try {
    // Extract JSON from markdown code blocks if present
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const cleaned = jsonMatch ? jsonMatch[1].trim() : raw.trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

// ── Generate Adaptive Exercise ─────────────
export async function generateAdaptiveExercise(config: ExerciseConfig, profile: SubjectProfile): Promise<Exercise | null> {
  const { subject, difficulty, teachingMethod, language } = config;
  const lang = language === 'ar' ? 'Arabic' : 'English';
  const weakStr = profile.weakTopics.length > 0 ? `Focus on weak areas: ${profile.weakTopics.join(', ')}.` : '';
  const avoidStr = profile.strongTopics.length > 0 ? `The child is strong in: ${profile.strongTopics.join(', ')}, so focus elsewhere.` : '';

  const subjectPrompts: Record<SubjectType, string> = {
    math: `Generate a math question for a child. Difficulty ${difficulty}/5. Types: counting, addition, subtraction, multiplication, comparison, word problems. For low difficulty (1-2), use single-digit numbers. For medium (3), use double-digit. For high (4-5), use multi-step problems.${difficulty <= 2 ? ' Include a visual aid with counting objects (emoji like 🍎 or ⭐).' : ''}`,
    reading: `Generate a reading exercise. Difficulty ${difficulty}/5. Level 1: single letters/syllables. Level 2: simple words. Level 3: short sentences. Level 4: paragraphs. Level 5: complex passages. Include pronunciation hints.`,
    writing: `Generate a writing exercise. Difficulty ${difficulty}/5. Level 1: complete missing letters in a word. Level 2: arrange letters to form a word. Level 3: complete a sentence with missing words. Level 4: write a sentence from a prompt. Level 5: write a short paragraph.`,
    memory: `Generate a memory/sequence exercise. Difficulty ${difficulty}/5. Level 1: remember 3 items. Level 2: 4 items. Level 3: 5 items. Level 4: 6 items. Level 5: 7+ items. Use emojis, colors, or numbers as items.`,
    comprehension: `Generate a reading comprehension exercise. Difficulty ${difficulty}/5. Provide a short passage (${difficulty * 20} words) and 1 question about it. For low difficulty, use simple factual questions. For high difficulty, use inferential questions.`,
    science: `Generate a science question for a child. Difficulty ${difficulty}/5. Topics: water cycle, plants, animals, human body, weather, simple machines. Break concepts into simple steps with emojis. Ask a question to test understanding.`,
    english: `Generate an English vocabulary/grammar exercise. Difficulty ${difficulty}/5. Level 1: match word to image/emoji. Level 2: complete the word. Level 3: arrange words into a sentence. Level 4: fill in the blank in a sentence. Level 5: translate or write a sentence.`,
  };

  const prompt = `You are an AI tutor for children with learning difficulties. ${subjectPrompts[subject]}

${weakStr} ${avoidStr}

Teaching method preference: ${teachingMethod}.
Language: ${lang}

Return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "question": "the question text in ${lang}",
  ${language === 'ar' ? '"questionArabic": "same question in Arabic",' : '"questionArabic": "Arabic translation of question",'}
  "type": "multiple_choice",
  "options": ["option1", "option2", "option3", "option4"],
  "optionsArabic": ["خيار1", "خيار2", "خيار3", "خيار4"],
  "correctAnswer": "the correct option text",
  "hint": "a helpful hint in ${lang}",
  "hintArabic": "Arabic hint",
  "explanation": "why this answer is correct in ${lang}",
  "explanationArabic": "Arabic explanation",
  "topic": "specific topic name",
  "visualAid": null
}

${teachingMethod === 'visual' || difficulty <= 2 ? `For visualAid, use: {"type": "counting_objects", "emoji": "🍎", "count": 5, "secondCount": 3}` : 'Set visualAid to null.'}`;

  const raw = await callAI(prompt);
  if (!raw) return null;

  const parsed = parseJSON<any>(raw);
  if (!parsed || !parsed.question || !parsed.correctAnswer) return null;

  return {
    id: `ex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    subject,
    difficulty,
    question: parsed.question,
    questionArabic: parsed.questionArabic,
    type: parsed.type || 'multiple_choice',
    options: parsed.options,
    optionsArabic: parsed.optionsArabic,
    correctAnswer: parsed.correctAnswer,
    hint: parsed.hint,
    hintArabic: parsed.hintArabic,
    visualAid: parsed.visualAid,
    explanation: parsed.explanation,
    explanationArabic: parsed.explanationArabic,
    topic: parsed.topic || subject,
  };
}

// ── Analyze Child's Answer ─────────────────
export async function analyzeAnswer(
  exercise: Exercise,
  childAnswer: string,
  profile: SubjectProfile,
): Promise<AIAnalysis> {
  const prompt = `You are an AI tutor analyzing a child's answer to an exercise.

Exercise: "${exercise.question}"
Correct answer: "${exercise.correctAnswer}"
Child's answer: "${childAnswer}"
Subject: ${exercise.subject}
Current difficulty: ${exercise.difficulty}/5
Child's accuracy rate: ${(profile.accuracyRate * 100).toFixed(0)}%
Consecutive correct: ${profile.consecutiveCorrect}
Consecutive incorrect: ${profile.consecutiveIncorrect}

Analyze the answer and return ONLY valid JSON:
{
  "isCorrect": true/false,
  "mistakeType": "concept" | "calculation" | "understanding" | "careless" | "spelling" | "grammar" | "vocabulary" | null,
  "explanation": "brief explanation of why wrong (or praise if correct)",
  "explanationArabic": "Arabic version",
  "suggestedDifficulty": ${exercise.difficulty},
  "suggestedMethod": "text" | "visual" | "audio" | "repetition",
  "encouragement": "a warm, encouraging message for the child",
  "encouragementArabic": "Arabic encouragement",
  "visualAidNeeded": false,
  "topicStrength": "weak" | "developing" | "strong"
}

Rules for suggestedDifficulty:
- If correct and consecutive correct >= 3: increase by 1 (max 5)
- If incorrect and consecutive incorrect >= 2: decrease by 1 (min 1)
- Otherwise: keep same

Rules for suggestedMethod:
- If incorrect and current method is "text": suggest "visual"
- If incorrect twice with "visual": suggest "repetition"
- If correct: keep current method`;

  const raw = await callAI(prompt);
  const parsed = parseJSON<AIAnalysis>(raw);

  if (parsed) return parsed;

  // Fallback: basic analysis without AI
  const isCorrect = childAnswer.trim().toLowerCase() === exercise.correctAnswer.trim().toLowerCase();
  let suggestedDifficulty = exercise.difficulty;
  if (isCorrect && profile.consecutiveCorrect >= 2) {
    suggestedDifficulty = Math.min(5, exercise.difficulty + 1) as DifficultyLevel;
  } else if (!isCorrect && profile.consecutiveIncorrect >= 1) {
    suggestedDifficulty = Math.max(1, exercise.difficulty - 1) as DifficultyLevel;
  }

  return {
    isCorrect,
    mistakeType: isCorrect ? undefined : 'understanding',
    explanation: isCorrect ? 'Great job!' : `The correct answer is: ${exercise.correctAnswer}`,
    explanationArabic: isCorrect ? 'أحسنت!' : `الإجابة الصحيحة هي: ${exercise.correctAnswer}`,
    suggestedDifficulty,
    suggestedMethod: isCorrect ? profile.preferredMethod : 'visual',
    encouragement: isCorrect ? 'You\'re doing amazing! Keep going! 🌟' : 'Don\'t worry, you\'re learning! Let\'s try again! 💪',
    encouragementArabic: isCorrect ? 'رائع! استمر! 🌟' : 'لا تقلق، أنت تتعلم! حاول مرة أخرى! 💪',
    visualAidNeeded: !isCorrect && exercise.difficulty <= 3,
    topicStrength: isCorrect ? 'developing' : 'weak',
  };
}

// ── Adapt Difficulty (Pure Function) ───────
export function adaptDifficulty(profile: SubjectProfile, lastResult: ExerciseResult): DifficultyLevel {
  const { consecutiveCorrect, consecutiveIncorrect, currentDifficulty } = profile;

  if (lastResult.isCorrect) {
    const newConsecutive = consecutiveCorrect + 1;
    if (newConsecutive >= 3 && lastResult.responseTimeMs < profile.avgResponseTimeMs * 1.2) {
      return Math.min(5, currentDifficulty + 1) as DifficultyLevel;
    }
  } else {
    const newConsecutive = consecutiveIncorrect + 1;
    if (newConsecutive >= 2) {
      return Math.max(1, currentDifficulty - 1) as DifficultyLevel;
    }
  }

  return currentDifficulty;
}

// ── Detect Learning Style ──────────────────
export function detectLearningStyle(results: ExerciseResult[]): 'visual' | 'auditory' | 'kinesthetic' | 'repetition' {
  if (results.length < 5) return 'visual'; // Default for new learners

  const methodToStyleMap: Record<TeachingMethod, 'visual' | 'auditory' | 'kinesthetic' | 'repetition'> = {
    visual: 'visual',
    audio: 'auditory',
    interactive: 'kinesthetic',
    repetition: 'repetition',
    text: 'visual',
  };

  const styleAccuracy: Record<'visual' | 'auditory' | 'kinesthetic' | 'repetition', { correct: number; total: number }> = {
    visual: { correct: 0, total: 0 },
    auditory: { correct: 0, total: 0 },
    kinesthetic: { correct: 0, total: 0 },
    repetition: { correct: 0, total: 0 },
  };

  for (const r of results.slice(-20)) {
    const style = methodToStyleMap[r.teachingMethodUsed] || 'visual';
    styleAccuracy[style].total++;
    if (r.isCorrect) styleAccuracy[style].correct++;
  }

  let bestStyle: 'visual' | 'auditory' | 'kinesthetic' | 'repetition' = 'visual';
  let bestRate = -1;
  for (const [style, stats] of Object.entries(styleAccuracy) as ['visual' | 'auditory' | 'kinesthetic' | 'repetition', { correct: number; total: number }][]) {
    if (stats.total > 0) {
      const rate = stats.correct / stats.total;
      if (rate > bestRate) {
        bestRate = rate;
        bestStyle = style;
      }
    }
  }

  return bestStyle;
}

// ── Generate Fallback Exercise (No AI needed) ──
export function generateLocalExercise(subject: SubjectType, difficulty: DifficultyLevel, language: 'en' | 'ar'): Exercise {
  const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (subject === 'math') {
    return generateLocalMathExercise(id, difficulty, language);
  }
  if (subject === 'memory') {
    return generateLocalMemoryExercise(id, difficulty, language);
  }

  // Generic fallback
  return {
    id,
    subject,
    difficulty,
    question: language === 'ar' ? 'تمرين تفاعلي' : 'Interactive Exercise',
    type: 'multiple_choice',
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 'A',
    topic: subject,
  };
}

function generateLocalMathExercise(id: string, difficulty: DifficultyLevel, language: 'en' | 'ar'): Exercise {
  const maxNum = [10, 20, 50, 100, 200][difficulty - 1];
  const a = Math.floor(Math.random() * maxNum) + 1;
  const b = Math.floor(Math.random() * Math.min(a, maxNum / 2)) + 1;
  const ops = difficulty <= 2 ? ['+'] : difficulty <= 3 ? ['+', '-'] : ['+', '-', '×'];
  const op = ops[Math.floor(Math.random() * ops.length)];

  let answer: number;
  let questionText: string;

  switch (op) {
    case '-':
      answer = a - b;
      questionText = `${a} - ${b} = ?`;
      break;
    case '×':
      const m1 = Math.floor(Math.random() * 12) + 1;
      const m2 = Math.floor(Math.random() * 12) + 1;
      answer = m1 * m2;
      questionText = `${m1} × ${m2} = ?`;
      break;
    default:
      answer = a + b;
      questionText = `${a} + ${b} = ?`;
  }

  const wrongAnswers = new Set<number>();
  while (wrongAnswers.size < 3) {
    const offset = Math.floor(Math.random() * 5) + 1;
    const wrong = Math.random() > 0.5 ? answer + offset : Math.max(0, answer - offset);
    if (wrong !== answer) wrongAnswers.add(wrong);
  }

  const options = [answer.toString(), ...Array.from(wrongAnswers).map(String)].sort(() => Math.random() - 0.5);

  const visualAid: VisualAidData | undefined = difficulty <= 2 && op === '+'
    ? { type: 'counting_objects', emoji: '🍎', count: Math.min(a, 10), secondCount: Math.min(b, 10) }
    : undefined;

  return {
    id,
    subject: 'math',
    difficulty,
    question: language === 'ar' ? `ما ناتج ${questionText.replace('?', '؟')}` : `What is ${questionText}`,
    questionArabic: `ما ناتج ${questionText.replace('?', '؟')}`,
    type: 'multiple_choice',
    options,
    correctAnswer: answer.toString(),
    hint: language === 'ar' ? 'حاول العد على أصابعك!' : 'Try counting on your fingers!',
    hintArabic: 'حاول العد على أصابعك!',
    visualAid,
    explanation: language === 'ar' ? `الإجابة الصحيحة هي ${answer}` : `The correct answer is ${answer}`,
    explanationArabic: `الإجابة الصحيحة هي ${answer}`,
    topic: op === '+' ? 'addition' : op === '-' ? 'subtraction' : 'multiplication',
  };
}

function generateLocalMemoryExercise(id: string, difficulty: DifficultyLevel, language: 'en' | 'ar'): Exercise {
  const emojis = ['🍎', '🌟', '🎈', '🐱', '🌈', '🎵', '🦋', '🌻', '🍕', '🚀'];
  const count = Math.min(difficulty + 2, 8);
  const shuffled = [...emojis].sort(() => Math.random() - 0.5);
  const sequence = shuffled.slice(0, count);
  const correctAnswer = sequence.join(' ');

  // Create wrong sequences by swapping elements
  const options = [correctAnswer];
  for (let i = 0; i < 3; i++) {
    const wrong = [...sequence];
    const idx1 = Math.floor(Math.random() * wrong.length);
    const idx2 = (idx1 + 1 + Math.floor(Math.random() * (wrong.length - 1))) % wrong.length;
    [wrong[idx1], wrong[idx2]] = [wrong[idx2], wrong[idx1]];
    options.push(wrong.join(' '));
  }

  return {
    id,
    subject: 'memory',
    difficulty,
    question: language === 'ar'
      ? `تذكر هذا الترتيب: ${sequence.join(' ')} — ثم اختر الترتيب الصحيح`
      : `Remember this sequence: ${sequence.join(' ')} — then choose the correct order`,
    questionArabic: `تذكر هذا الترتيب: ${sequence.join(' ')} — ثم اختر الترتيب الصحيح`,
    type: 'multiple_choice',
    options: options.sort(() => Math.random() - 0.5),
    correctAnswer,
    topic: 'sequence_recall',
  };
}

// ── Generate Progress Summary ──────────────
export async function generateProgressSummary(profile: LearningProfile): Promise<string> {
  const subjects = Object.entries(profile.subjects)
    .map(([s, p]) => `${s}: accuracy=${(p.accuracyRate * 100).toFixed(0)}%, difficulty=${p.currentDifficulty}/5, sessions=${p.sessionsCompleted}`)
    .join('\n');

  const prompt = `Summarize this child's learning progress in 3-4 sentences. Be encouraging and specific.

${subjects}

Overall: ${profile.totalSessionsCompleted} sessions, ${profile.totalTimeSpentMinutes} minutes, ${profile.streakDays} day streak.
Learning style preference: ${profile.preferredLearningStyle}.

Write in both English and Arabic. Format:
English summary here.
---
Arabic summary here.`;

  const raw = await callAI(prompt);
  return raw || 'Keep up the great work! 🌟\n---\nاستمر في العمل الرائع! 🌟';
}
