/**
 * Shared text-to-speech helper.
 *
 * Consolidates the Arabic / Egyptian-aware voice selection that was previously
 * duplicated across AccessibilityOverlay, LogicSandbox and ChatInterface, and
 * powers the "read selected region aloud" feature.
 */

const LANG_MAP: Record<string, string> = {
  English: "en-US",
  Arabic: "ar-SA",
  "Egyptian Ammiya": "ar-EG",
  French: "fr-FR",
  Spanish: "es-ES",
  German: "de-DE",
  Italian: "it-IT",
  Portuguese: "pt-BR",
  Russian: "ru-RU",
  Chinese: "zh-CN",
  Japanese: "ja-JP",
  fr: "fr-FR",
  en: "en-US",
  ar: "ar-SA",
};

/** Strip sign markers, markdown noise, robotic vision headers, and symbol artifacts so speech sounds natural. */
export function cleanForSpeech(text: string): string {
  if (!text) return "";
  return text
    // Strip sign avatar markers
    .replace(/\[Signs:.*?\]/g, "")
    // Clean robotic boilerplate headers in English
    .replace(/\*\*Hazards:\*\*\s*(None detected[^\n.]*|None[^\n.]*)[.]?/gi, "No hazards around you.")
    .replace(/Hazards:\s*(None detected[^\n.]*|None[^\n.]*)[.]?/gi, "No hazards around you.")
    .replace(/\*\*Visible Text:\*\*\s*(None[^\n.]*|N\/A[^\n.]*)[.]?/gi, "")
    .replace(/Visible Text:\s*(None[^\n.]*|N\/A[^\n.]*)[.]?/gi, "")
    .replace(/\*\*(Scene Description|Description):\*\*/gi, "")
    .replace(/(Scene Description|Description):/gi, "")
    // Clean robotic boilerplate headers in Arabic
    .replace(/\*\*المخاطر:\*\*\s*(لا توجد[^\n.]*|لا يوجد[^\n.]*)[.]?/gi, "مفيش أخطار حواليك.")
    .replace(/المخاطر:\s*(لا توجد[^\n.]*|لا يوجد[^\n.]*)[.]?/gi, "مفيش أخطار حواليك.")
    .replace(/\*\*النصوص( المكتوبة)?:\*\*\s*(لا توجد[^\n.]*|لا يوجد[^\n.]*)[.]?/gi, "")
    .replace(/النصوص( المكتوبة)?:\s*(لا توجد[^\n.]*|لا يوجد[^\n.]*)[.]?/gi, "")
    .replace(/\*\*(وصف المشهد|الوصف):\*\*/gi, "")
    .replace(/(وصف المشهد|الوصف):/gi, "")
    // Clean robotic boilerplate headers in French
    .replace(/\*\*Dangers?:\*\*\s*(Aucun[^\n.]*)[.]?/gi, "Aucun danger autour de vous.")
    .replace(/Dangers?:\s*(Aucun[^\n.]*)[.]?/gi, "Aucun danger autour de vous.")
    .replace(/\*\*Textes?( visibles?)?:\*\*\s*(Aucun[^\n.]*)[.]?/gi, "")
    .replace(/Textes?( visibles?)?:\s*(Aucun[^\n.]*)[.]?/gi, "")
    .replace(/\*\*(Description de la scène|Description):\*\*/gi, "")
    .replace(/(Description de la scène|Description):/gi, "")
    // Strip spoken symbol words (asterisk / star / استريك / نجمة)
    .replace(/(?:^|\s+)(asterisk|استريك|نجمة|بوليت)(?=\s+|$)/giu, " ")
    // Strip markdown formatting symbols (*, #, _, `, ~, [], (), <>)
    .replace(/[*+#_`~\[\]()<>]/g, "")
    // Strip bullet dashes and clean spacing
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+-\s+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Voices whose names hint at higher-quality / neural engines — preferred when
// available (esp. important for Arabic & French, where device voices vary widely).
const QUALITY_HINTS = /google|microsoft|natural|neural|online|enhanced|premium|siri|hoda|salma|naayf|laila|thomas|amelie|amélie|hortense|julie|paul|denise|audrey|aurelie|aurélie|siwis|virginie|alain/i;

function rank(v: SpeechSynthesisVoice, lower: string): number {
  const exact = v.lang.toLowerCase() === lower;
  const base = v.lang.toLowerCase().startsWith(lower.split("-")[0]);
  if (!exact && !base) return -1;
  let score = exact ? 2 : 1;
  if (QUALITY_HINTS.test(v.name)) score += 4;
  if (!v.localService) score += 2; // online voices are usually higher quality
  return score;
}

let cachedVoices: SpeechSynthesisVoice[] = [];
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  cachedVoices = window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoices = window.speechSynthesis.getVoices();
  };
}

function pickVoice(targetLang: string): SpeechSynthesisVoice | undefined {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined;
  const voices = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices();
  const lower = targetLang.toLowerCase();
  let best: SpeechSynthesisVoice | undefined;
  let bestScore = 0;
  for (const v of voices) {
    const s = rank(v, lower);
    if (s > bestScore) { bestScore = s; best = v; }
  }
  return best;
}

/** Build a configured utterance with the best voice for the given language. */
export function buildUtterance(
  text: string,
  language?: string,
): SpeechSynthesisUtterance {
  const clean = cleanForSpeech(text);
  const utterance = new SpeechSynthesisUtterance(clean);
  const hasArabic = /[؀-ۿ]/.test(clean);
  const isFrench =
    language === "French" ||
    language === "fr" ||
    language === "fr-FR" ||
    (!hasArabic && (
      /[àâäéèêëîïôöùûüçœæ]/i.test(clean) ||
      /\b(bonjour|bonsoir|merci|s'il vous plaît|sil vous plait|croissant|gare|métro|metro|madame|monsieur|oui|non|pardon|excusez-moi|combien|où est|ou est|je voudrais|l'addition|chambre|hôtel|pharmacie)\b/i.test(clean)
    ));

  if (hasArabic) {
    const isEgyptian =
      language === "Egyptian Ammiya" ||
      clean.includes("يا باشا") ||
      clean.includes("تمام") ||
      clean.includes("ازيك") ||
      clean.includes("عامل ايه") ||
      clean.includes("بخير") ||
      clean.includes("شكرا");
    const defaultLang = isEgyptian ? "ar-EG" : "ar-SA";
    utterance.lang = defaultLang;
    const voice = pickVoice(defaultLang) || pickVoice("ar-SA") || pickVoice("ar-EG") || pickVoice("ar");
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = "ar-EG";
    }
    utterance.rate = 0.92;
    utterance.pitch = 1.0;
  } else if (isFrench) {
    const defaultLang = "fr-FR";
    utterance.lang = defaultLang;
    const voice = pickVoice(defaultLang) || pickVoice("fr");
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = "fr-FR";
    }
    utterance.rate = 0.95; // Fluid, natural French speed
    utterance.pitch = 1.0;
  } else {
    const defaultLang = LANG_MAP[language || "English"] || "en-US";
    utterance.lang = defaultLang;
    const voice = pickVoice(defaultLang);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
  }

  return utterance;
}

export interface SpeakCallbacks {
  onStart?: () => void;
  onEnd?: () => void;
  /** err carries a short machine-readable reason when known: 'unsupported' |
   *  'empty' | 'synth-error' | 'silent-fail' (speak() never actually started). */
  onError?: (err?: string) => void;
}

/** True if the platform's speechSynthesis has at least one Arabic voice installed. */
export function hasArabicVoice(): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const voices = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices();
  return voices.some((v) => v.lang.toLowerCase().startsWith("ar"));
}

/** True if the platform's speechSynthesis has at least one French voice installed. */
export function hasFrenchVoice(): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const voices = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices();
  return voices.some((v) => v.lang.toLowerCase().startsWith("fr"));
}

/**
 * Speak text aloud, cancelling any current speech first.
 *
 * Previously this failed silently whenever speechSynthesis was unsupported,
 * had no matching voice, or was blocked by the browser (most browsers require
 * speechSynthesis.speak() to first happen inside a real user gesture — a
 * dwell/blink-triggered call from the eye-gaze board does not count as one,
 * so the very first call in a session can be silently dropped). Callers that
 * care whether the phrase was actually spoken should pass onError.
 */
// Keep active utterances in memory to prevent Chromium garbage collection mid-speech
const activeUtterances = new Set<SpeechSynthesisUtterance>();

export function speak(
  text: string,
  language?: string,
  cb?: SpeakCallbacks,
): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    cb?.onError?.("unsupported");
    return;
  }
  const utterance = buildUtterance(text, language);
  if (!utterance.text) {
    cb?.onError?.("empty");
    return;
  }

  activeUtterances.add(utterance);
  const cleanup = () => {
    activeUtterances.delete(utterance);
  };

  let started = false;
  let finished = false;

  utterance.onstart = () => {
    started = true;
    cb?.onStart?.();
  };

  utterance.onend = () => {
    finished = true;
    cleanup();
    cb?.onEnd?.();
  };

  utterance.onerror = (e: any) => {
    cleanup();
    if (e?.error === 'canceled' || e?.error === 'interrupted') return;
    cb?.onError?.("synth-error");
  };

  window.speechSynthesis.cancel();
  // Small delay works around a Chrome bug where speak() right after cancel() is dropped.
  setTimeout(() => {
    window.speechSynthesis.speak(utterance);
    // Some browsers/webviews drop speak() entirely (no event fires at all) when
    // it's blocked — most commonly the very first call outside a user gesture,
    // or no voice is installed for the requested language. Detect that silent
    // failure instead of pretending the phrase was spoken.
    setTimeout(() => {
      if (!started && !finished && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
        cleanup();
        cb?.onError?.("silent-fail");
      }
    }, 500);
  }, 60);
}

/** Stop any ongoing speech. */
export function cancelSpeech(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    activeUtterances.clear();
  }
}

/**
 * "Unlocks" speechSynthesis inside a real user gesture (e.g. the button that
 * starts the eye tracker). Call this once per session from an onClick handler
 * before relying on dwell/blink-triggered speak() calls, since some browsers
 * silently refuse the very first speak() that happens outside a user gesture.
 */
export function unlockSpeechSynthesis(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const unlock = new SpeechSynthesisUtterance("");
    unlock.volume = 0;
    window.speechSynthesis.speak(unlock);
  } catch {
    /* ignore */
  }
}

export function isSpeaking(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && window.speechSynthesis.speaking;
}
