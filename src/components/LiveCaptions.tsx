import { localize } from '../lib/translations';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic, MicOff, Sparkles, RefreshCw, X, Volume2, MessageSquare,
  History, Maximize2, Trash2, ChevronRight, Heart, Settings,
  Plus, Copy, Check, Zap, Activity, Brain, Repeat2, Target,
  ChevronDown, BarChart2, BookOpen, PlayCircle, StopCircle,
  AlertTriangle, CheckCircle2, Clock, Waves, Pencil
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { geminiService } from '../services/geminiService';
import { toast } from './Toast';
import {
  loadPronDict, savePronDict, applyPronunciation, learnFromCorrection,
  mergeMappings, dictToMappings, type PronDict,
} from '../lib/adaptiveSpeech';

interface LiveCaptionsProps {
  language?: string;
  onClose: () => void;
}

interface SoundboardItem {
  id: string;
  emoji: string;
  textEn: string;
  textAr: string;
}

interface EuphoniaPattern {
  id: string;
  phrase: string;
  translation: string;
}

interface TranscriptSegment {
  id: string;
  raw: string;
  decoded: string;
  confidence: 'high' | 'medium' | 'low';
  confidencePct?: number;       // numeric confidence (0-100) from the AI corrector
  alternatives?: string[];      // alternative interpretations for uncertain words
  intent?: string;
  timestamp: string;
}

interface CalibrationPhrase {
  id: string;
  text: string;
  recorded: boolean;
  audioBlob?: Blob;
}

// Training phrases modeled after Project Relate's onboarding approach
const CALIBRATION_PHRASES: CalibrationPhrase[] = [
  { id: 'c1', text: "Yes", recorded: false },
  { id: 'c2', text: "No", recorded: false },
  { id: 'c3', text: "Thank you", recorded: false },
  { id: 'c4', text: "I need help", recorded: false },
  { id: 'c5', text: "Please repeat that", recorded: false },
  { id: 'c6', text: "I don't understand", recorded: false },
  { id: 'c7', text: "Can you write it down?", recorded: false },
  { id: 'c8', text: "I am in pain", recorded: false },
  { id: 'c9', text: "Call a doctor", recorded: false },
  { id: 'c10', text: "I want to go home", recorded: false },
];

const SOUNDBOARD_DATA: Record<'essentials' | 'needs' | 'social' | 'emergencies', SoundboardItem[]> = {
  essentials: [
    { id: 'yes', emoji: '👍', textEn: "Yes", textAr: "نعم" },
    { id: 'no', emoji: '👎', textEn: "No", textAr: "لا" },
    { id: 'thanks', emoji: '🙏', textEn: "Thank you so much", textAr: "شكراً جزيلاً لك" },
    { id: 'sorry', emoji: '🙇', textEn: "Sorry", textAr: "عذراً / أسف" },
    { id: 'hello', emoji: '👋', textEn: "Hello, nice to see you", textAr: "مرحباً، يسعدني رؤيتك" },
    { id: 'goodbye', emoji: '👋', textEn: "Goodbye", textAr: "مع السلامة" },
    { id: 'agree', emoji: '🤝', textEn: "I agree with that", textAr: "أنا أتفق مع هذا" },
    { id: 'ok', emoji: '👌', textEn: "Okay, perfect", textAr: "حسناً، ممتاز" }
  ],
  needs: [
    { id: 'help', emoji: '🆘', textEn: "I need assistance, please", textAr: "أحتاج إلى مساعدة من فضلك" },
    { id: 'bathroom', emoji: '🚽', textEn: "Where is the restroom?", textAr: "أين دورة المياه؟" },
    { id: 'hungry', emoji: '🍔', textEn: "I am hungry", textAr: "أنا جائع" },
    { id: 'thirsty', emoji: '🥤', textEn: "I am thirsty", textAr: "أنا عطشان" },
    { id: 'rest', emoji: '🛌', textEn: "I need to rest for a bit", textAr: "أريد أن أرتاح قليلاً" },
    { id: 'water', emoji: '💧', textEn: "Can I have some water?", textAr: "هل يمكنني الحصول على بعض الماء؟" },
    { id: 'write', emoji: '📝', textEn: "Can you write it down?", textAr: "هل يمكنك كتابتها؟" }
  ],
  social: [
    { id: 'meet', emoji: '😊', textEn: "Nice to meet you", textAr: "سعيد بلقائك" },
    { id: 'moment', emoji: '⏱️', textEn: "One moment, please", textAr: "لحظة واحدة من فضلك" },
    { id: 'tool', emoji: '🗣️', textEn: "I am using this tool to communicate", textAr: "أنا أستخدم هذه المنصة للتواصل" },
    { id: 'slow', emoji: '🐢', textEn: "Could you speak a bit slower?", textAr: "تكلم ببطء أكثر من فضلك" },
    { id: 'how_are_you', emoji: '❤️', textEn: "How are you today?", textAr: "كيف حالك اليوم?" },
    { id: 'welcome', emoji: '🌸', textEn: "You are welcome", textAr: "على الرحب والسعة" }
  ],
  emergencies: [
    { id: 'emergency', emoji: '🚨', textEn: "This is an emergency, I need urgent help", textAr: "هذه حالة طارئة، أحتاج لمساعدة عاجلة" },
    { id: 'sick', emoji: '🤢', textEn: "I feel very sick", textAr: "أشعر بمرض شديد" },
    { id: 'call', emoji: '📞', textEn: "Please call my emergency contact", textAr: "برجاء الاتصال برقم الطوارئ الخاص بي" },
    { id: 'medicine', emoji: '💊', textEn: "I need my medication", textAr: "أريد تناول دوائي" },
    { id: 'pain', emoji: '💥', textEn: "I am in high pain", textAr: "أشعر بألم شديد" },
    { id: 'danger', emoji: '⚠️', textEn: "Wait, this is dangerous", textAr: "انتظر، هذا خطر" }
  ]
};

// ──────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ──────────────────────────────────────────────────────────────────────────
export default function LiveCaptions({ language = 'en-US', onClose }: LiveCaptionsProps) {
  const [activeLang, setActiveLang] = useState<string>(language);
  // Derive language flags directly from the BCP-47 code (e.g. "fr-FR", "ar-EG")
  const isAr = activeLang.toLowerCase().startsWith('ar');
  const isFr = activeLang.toLowerCase().startsWith('fr');
  const dir = isAr ? 'rtl' : 'ltr';
  // ── Core listening state
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  // Mirror of `transcript` so the recognizer effect doesn't need it as a dep
  // (having it as a dep re-created the recognizer on every word → dropped audio).
  const transcriptRef = useRef('');
  // Always points at the freshest processUtterance closure (over repeat-mode,
  // dictionaries, context) so the once-registered onresult handler doesn't run a
  // stale copy. Assigned in the render body just after processUtterance is defined.
  const processUtteranceRef = useRef<((t: string) => Promise<void>) | undefined>(undefined);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [volume, setVolume] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // ── Mode selector: 'listen' | 'euphonia' | 'calibrate' | 'board'
  const [activeMode, setActiveMode] = useState<'listen' | 'euphonia' | 'calibrate' | 'board'>('listen');

  // ── Segment history (Project Relate-style: each utterance becomes a card)
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [isDecoding, setIsDecoding] = useState(false);

  // ── Adaptive pronunciation: a per-user word dictionary that grows from edits
  const [pronDict, setPronDict] = useState<PronDict>(() => loadPronDict());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // ── Repeat mode: AI restates what it heard in clear synthesized voice
  const [repeatModeOn, setRepeatModeOn] = useState(false);
  const [lastRepeated, setLastRepeated] = useState('');

  // ── Speech profile for impairment type
  const [speechProfile, setSpeechProfile] = useState<string>(() =>
    localStorage.getItem('cognify_speech_profile') || 'Standard'
  );

  // ── Euphonia (direct audio) state
  const [isRecordingEuphonia, setIsRecordingEuphonia] = useState(false);
  const [euphoniaTimer, setEuphoniaTimer] = useState(0);

  // ── Calibration session state
  const [calibrationPhrases, setCalibrationPhrases] = useState<CalibrationPhrase[]>(CALIBRATION_PHRASES);
  const [calibrationIndex, setCalibrationIndex] = useState(0);
  const [isCalibrationRecording, setIsCalibrationRecording] = useState(false);
  const [calibrationTimer, setCalibrationTimer] = useState(0);
  const [calibrationComplete, setCalibrationComplete] = useState(false);
  const [calibrationAudioBlobs, setCalibrationAudioBlobs] = useState<{phraseId: string; blob: Blob}[]>([]);

  // ── Phoneme pattern mappings
  const [euphoniaPatterns, setEuphoniaPatterns] = useState<EuphoniaPattern[]>(() => {
    try {
      const saved = localStorage.getItem('cognify_euphonia_patterns');
      return saved ? JSON.parse(saved) : [
        { id: 'ep1', phrase: "wa wa", translation: "Can I have some water?" },
        { id: 'ep2', phrase: "baf roo", translation: "Where is the restroom?" },
        { id: 'ep3', phrase: "hoh", translation: "I want to go home" },
        { id: 'ep4', phrase: "hep me", translation: "Please help me" }
      ];
    } catch { return []; }
  });
  const [newPattern, setNewPattern] = useState('');
  const [newTranslation, setNewTranslation] = useState('');
  const [showPatternsPanel, setShowPatternsPanel] = useState(false);

  // ── Soundboard
  const [activeTab, setActiveTab] = useState<'essentials' | 'needs' | 'social' | 'emergencies' | 'favorites'>('essentials');
  const [favorites, setFavorites] = useState<SoundboardItem[]>(() => {
    try {
      const saved = localStorage.getItem('cognify_speech_presets');
      return saved ? JSON.parse(saved) : [
        { id: 'fav1', emoji: '🏡', textEn: "I am ready to go home", textAr: "أنا جاهز للذهاب إلى المنزل" },
        { id: 'fav2', emoji: '☕', textEn: "I would love some coffee", textAr: "أود بعض القهوة" },
        { id: 'fav3', emoji: '⚕️', textEn: "May I have my medicine please?", textAr: "هل يمكنني الحصول على الدواء من فضلك؟" }
      ];
    } catch { return []; }
  });
  const [customText, setCustomText] = useState('');
  const [showBigMode, setShowBigMode] = useState(false);
  const [aiSmartReplies, setAiSmartReplies] = useState<string[]>([]);
  const [isGeneratingReplies, setIsGeneratingReplies] = useState(false);

  // ── Settings
  const [pauseThreshold, setPauseThreshold] = useState<number>(() =>
    Number(localStorage.getItem('cognify_pause_threshold') || 2500)
  );
  const [speechRate, setSpeechRate] = useState<number>(() =>
    Number(localStorage.getItem('cognify_speech_rate') || 1.0)
  );
  const [speechPitch, setSpeechPitch] = useState<number>(() =>
    Number(localStorage.getItem('cognify_speech_pitch') || 1.0)
  );
  const [showSettings, setShowSettings] = useState(false);
  const [copiedState, setCopiedState] = useState(false);
  const [speechHistory, setSpeechHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('cognify_speech_history');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // ── Refs
  const recognitionRef = useRef<any>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const segmentsEndRef = useRef<HTMLDivElement | null>(null);
  // The getUserMedia stream feeding the level meter. Closing the AudioContext
  // does NOT stop these tracks, so we hold + stop them explicitly (else the mic
  // stays live and the browser indicator stays on after listening ends).
  const levelStreamRef = useRef<MediaStream | null>(null);

  const isArabic = language.startsWith('ar');

  // ── Persist settings
  useEffect(() => { localStorage.setItem('cognify_speech_history', JSON.stringify(speechHistory)); }, [speechHistory]);
  useEffect(() => { localStorage.setItem('cognify_speech_presets', JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => { localStorage.setItem('cognify_euphonia_patterns', JSON.stringify(euphoniaPatterns)); }, [euphoniaPatterns]);
  useEffect(() => { savePronDict(pronDict); }, [pronDict]);
  useEffect(() => { localStorage.setItem('cognify_pause_threshold', String(pauseThreshold)); }, [pauseThreshold]);
  useEffect(() => { localStorage.setItem('cognify_speech_rate', String(speechRate)); }, [speechRate]);
  useEffect(() => { localStorage.setItem('cognify_speech_pitch', String(speechPitch)); }, [speechPitch]);
  useEffect(() => { localStorage.setItem('cognify_speech_profile', speechProfile); }, [speechProfile]);

  // Auto-scroll segments
  useEffect(() => {
    segmentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [segments]);

  // ──────────────────────────────────────────────────────────────────────
  // AUDIO LEVEL TRACKING
  // ──────────────────────────────────────────────────────────────────────
  const startAudioLevelTracking = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      levelStreamRef.current = stream;
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      const updateLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setVolume(avg);
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();
    } catch (e) { console.error("Audio visualizer failed:", e); }
  };

  const stopAudioLevelTracking = () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    // Stop the mic tracks — closing the AudioContext alone leaves them live.
    levelStreamRef.current?.getTracks().forEach((t) => t.stop());
    levelStreamRef.current = null;
    // Guard against double-close (onerror then onend both call this).
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') audioContextRef.current.close();
    audioContextRef.current = null;
    setVolume(0);
  };

  // ──────────────────────────────────────────────────────────────────────
  // SPEECH SYNTHESIS (TTS)
  // ──────────────────────────────────────────────────────────────────────
  const speakText = useCallback((text: string) => {
    if (!text.trim()) return;
    if (!('speechSynthesis' in window)) {
      setError("Speech output isn't supported on this browser.");
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const run = () => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = language;
        utterance.rate = speechRate;
        utterance.pitch = speechPitch;
        const voices = window.speechSynthesis.getVoices();
        const voice = voices.find(v => v.lang.toLowerCase().startsWith(isAr ? 'ar' : 'en'));
        if (voice) utterance.voice = voice;
        window.speechSynthesis.speak(utterance);
      };
      // Voices load asynchronously on first use — if we speak before they're
      // ready, the first (possibly emergency) phrase is silent. Wait for them.
      if (window.speechSynthesis.getVoices().length === 0) {
        let spoken = false;
        const fire = () => { if (!spoken) { spoken = true; run(); } window.speechSynthesis.onvoiceschanged = null; };
        window.speechSynthesis.onvoiceschanged = fire;
        setTimeout(fire, 300); // fallback if the event never fires
      } else {
        setTimeout(run, 50);
      }
    } catch (err) { console.error("TTS failure:", err); }
  }, [language, speechRate, speechPitch, isArabic]);

  // Stop any in-progress speech and pending timers when the panel closes, so
  // TTS doesn't keep talking over the next screen and no callback fires after
  // unmount.
  useEffect(() => () => {
    if ('speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch { /* ignore */ } }
    if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
    // Tear down any in-progress recording so closing the panel mid-record doesn't
    // leak the mic or fire setState/API calls after unmount.
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    const mr = mediaRecorderRef.current;
    if (mr) {
      try {
        mr.onstop = null;                              // prevent post-unmount processUtterance / Gemini call
        mr.stream?.getTracks().forEach((t) => t.stop()); // release the mic immediately
        if (mr.state !== 'inactive') mr.stop();
      } catch { /* ignore */ }
    }
  }, []);

  // ──────────────────────────────────────────────────────────────────────
  // CONTINUOUS SPEECH RECOGNITION
  // ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Live captions need a supported browser such as Chrome, Edge, or Safari.");
      return;
    }
    recognitionRef.current = new SpeechRecognition();
    const recognition = recognitionRef.current;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = activeLang;

    recognition.onstart = () => { setIsListening(true); setError(null); startAudioLevelTracking(); };
    recognition.onerror = (event: any) => {
      // Map every error code to a clear message — otherwise captions just stop
      // mid-conversation with no explanation (common on hospital networks).
      const code = event?.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') setError("Microphone access denied. Enable permissions in your browser settings.");
      else if (code === 'audio-capture') setError("No microphone found. Please connect one and try again.");
      else if (code === 'network') setError("Speech service unreachable — check the internet connection.");
      else if (code === 'no-speech' || code === 'aborted') { /* benign — no message */ }
      else setError("Speech recognition stopped. Tap the mic to retry.");
      setIsListening(false);
      stopAudioLevelTracking();
    };
    recognition.onend = () => { setIsListening(false); stopAudioLevelTracking(); };

    recognition.onresult = (event: any) => {
      let finalStr = '';
      let interimStr = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalStr += text;
        else interimStr += text;
      }
      if (finalStr) {
        setTranscript(prev => { const next = (prev + ' ' + finalStr).trim(); transcriptRef.current = next; return next; });
        setInterimTranscript('');
      } else {
        setInterimTranscript(interimStr);
      }
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = setTimeout(async () => {
        // transcriptRef.current already contains any finalStr committed above, so
        // don't re-append it (that duplicated the last phrase, e.g. "I need water
        // I need water"). Only the still-uncommitted interimStr must be appended.
        const fullText = interimStr ? (transcriptRef.current + ' ' + interimStr).trim() : transcriptRef.current.trim();
        if (fullText.length > 2) {
          // Call through a ref so mid-session changes to repeat-mode / dictionaries /
          // context are honored without recreating the recognizer (which drops words).
          await processUtteranceRef.current?.(fullText);
        }
      }, pauseThreshold);
    };

    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
      stopAudioLevelTracking();
    };
    // NOTE: `transcript` intentionally NOT a dep — recreating the recognizer
    // mid-sentence dropped words. We read the latest via transcriptRef instead.
  }, [activeLang, speechProfile, pauseThreshold]);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      try { recognitionRef.current?.start(); } catch (e) { console.error("Mic start failed:", e); }
    }
  };

  // ──────────────────────────────────────────────────────────────────────
  // PROCESS AN UTTERANCE → SEGMENT CARD
  // Determines confidence, decodes if needed, optionally repeats
  // ──────────────────────────────────────────────────────────────────────
  const processUtterance = async (rawText: string) => {
    if (!rawText.trim()) return;
    setIsDecoding(true);

    // Step 0: Apply the user's learned pronunciation dictionary instantly
    // (offline, free) before any AI step. `rawText` stays the original "heard".
    const adapted = applyPronunciation(rawText, pronDict);
    // Merge learned words into the personalization signals handed to the model.
    const mappings = [...euphoniaPatterns, ...dictToMappings(pronDict)];

    let decoded = adapted;
    let confidence: 'high' | 'medium' | 'low' = 'high';
    let confidencePct = 100;
    let alternatives: string[] = [];
    let intent: string | undefined;

    try {
      // Step 1: Local pattern matching (instant)
      const cleanIn = adapted.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?\"']/g, "").trim();
      const localMatch = euphoniaPatterns.find(p => {
        const cleanP = p.phrase.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?\"']/g, "").trim();
        return cleanIn === cleanP || cleanIn.includes(cleanP) || cleanP.includes(cleanIn);
      });

      if (localMatch) {
        decoded = localMatch.translation;
        confidence = 'high';
        confidencePct = 100;
      } else {
        // Step 2: Context-aware AI correction (returns confidence + alternatives).
        // Recent decoded lines are passed as conversation context.
        const context = segments.slice(-4).map(s => s.decoded);
        const result = await geminiService.correctTranscript(
          adapted, language, speechProfile, mappings, context,
        );
        decoded = result.corrected || adapted;
        confidencePct = result.confidence;
        alternatives = result.alternatives || [];
        confidence = confidencePct >= 80 ? 'high' : confidencePct >= 55 ? 'medium' : 'low';
      }

      // Step 4: Detect communicative intent (brief async call)
      fetchIntent(decoded).then(i => {
        if (i) {
          setSegments(prev => prev.map(s => s.raw === rawText ? { ...s, intent: i } : s));
        }
      });

      // Step 5: Auto-repeat if mode is on
      if (repeatModeOn && decoded) {
        setLastRepeated(decoded);
        speakText(decoded);
      }

      // Step 6: Smart replies — on-demand only (via the button) to save API quota.
      // (was auto-firing on every utterance)

    } catch (e) {
      console.error("Process utterance error:", e);
      confidence = 'low';
    } finally {
      setIsDecoding(false);
    }

    const newSegment: TranscriptSegment = {
      id: Date.now().toString(),
      raw: rawText,
      decoded,
      confidence,
      confidencePct,
      alternatives,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setSegments(prev => [...prev.slice(-20), newSegment]); // Keep last 20
    transcriptRef.current = '';
    setTranscript('');
    setInterimTranscript('');
  };
  // Keep the ref pointing at the latest closure every render (see declaration).
  processUtteranceRef.current = processUtterance;

  // ──────────────────────────────────────────────────────────────────────
  // USER CORRECTION → LEARN (continuously updates the pronunciation dictionary)
  // ──────────────────────────────────────────────────────────────────────
  const startEditSegment = (seg: TranscriptSegment) => {
    setEditingId(seg.id);
    setEditValue(seg.decoded);
  };

  // Apply a corrected decode to a segment and learn the word-level difference.
  const commitCorrection = (seg: TranscriptSegment, corrected: string) => {
    if (!corrected || corrected === seg.decoded) return;
    setSegments(prev =>
      prev.map(s =>
        s.id === seg.id
          ? { ...s, decoded: corrected, confidence: 'high', confidencePct: 100, alternatives: [] }
          : s,
      ),
    );

    const learned = learnFromCorrection(seg.raw, corrected);
    if (learned.length) {
      const { dict, added } = mergeMappings(pronDict, learned);
      if (added.length) {
        setPronDict(dict);
        toast.success(
          added.map(m => `"${m.from}" → "${m.to}"`).join('  ·  '),
          `Learned ${added.length} pronunciation${added.length > 1 ? 's' : ''}`,
        );
      }
    }
  };

  const saveEditSegment = (seg: TranscriptSegment) => {
    const corrected = editValue.trim();
    setEditingId(null);
    commitCorrection(seg, corrected);
  };

  const applyAlternative = (seg: TranscriptSegment, alt: string) =>
    commitCorrection(seg, alt.trim());

  // ──────────────────────────────────────────────────────────────────────
  // INTENT DETECTION (lightweight)
  // ──────────────────────────────────────────────────────────────────────
  const fetchIntent = async (text: string): Promise<string | null> => {
    const lower = text.toLowerCase();
    if (/help|emergency|pain|sick|call|urgent|danger/i.test(lower)) return '🚨 Urgent';
    if (/\?|what|where|when|how|who|can you/i.test(lower)) return '❓ Question';
    if (/yes|agree|ok|sure|please|thank/i.test(lower)) return '✅ Agreement';
    if (/no|don\'t|won\'t|stop|wait/i.test(lower)) return '🚫 Refusal';
    if (/feel|pain|hurt|sick|tired|hungry|thirsty/i.test(lower)) return '💬 Need';
    return null;
  };

  // ──────────────────────────────────────────────────────────────────────
  // SMART REPLIES
  // ──────────────────────────────────────────────────────────────────────
  const fetchSmartReplies = async (text: string) => {
    if (text.length < 8) return;
    setIsGeneratingReplies(true);
    try {
      const suggestions = await geminiService.generateQuickReplies(text, language);
      if (Array.isArray(suggestions) && suggestions.length > 0) setAiSmartReplies(suggestions);
    } catch (e) { console.error("Quick replies error:", e); }
    finally { setIsGeneratingReplies(false); }
  };

  // ──────────────────────────────────────────────────────────────────────
  // PROJECT EUPHONIA: DIRECT AUDIO RECORDING
  // ──────────────────────────────────────────────────────────────────────
  const startEuphoniaRecord = async () => {
    try {
      if (isListening) { recognitionRef.current?.stop(); setIsListening(false); }
      setError(null);
      audioChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
                       MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        setIsDecoding(true);
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Content = (reader.result as string).split(',')[1];
          try {
            const result = await geminiService.decodeEuphoniaAudio(
              base64Content, speechProfile, language, euphoniaPatterns, mediaRecorder.mimeType || 'audio/webm'
            );
            if (result?.trim()) {
              await processUtterance(result.trim());
            } else {
              setError("No speech detected. Try speaking more clearly or adjusting your speech profile.");
            }
          } catch (err) {
            setError("Audio decoding failed. Check your microphone and try again.");
          } finally { setIsDecoding(false); }
        };
      };

      mediaRecorder.start();
      setIsRecordingEuphonia(true);
      setEuphoniaTimer(0);
      startAudioLevelTracking();
      recordingTimerRef.current = setInterval(() => {
        setEuphoniaTimer(prev => {
          if (prev >= 7) { stopEuphoniaRecord(); return 7; }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      setError("Cannot access microphone. Check browser permissions.");
    }
  };

  const stopEuphoniaRecord = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
    setIsRecordingEuphonia(false);
    stopAudioLevelTracking();
  };

  // ──────────────────────────────────────────────────────────────────────
  // CALIBRATION SESSION (Project Relate-style guided phrase recording)
  // ──────────────────────────────────────────────────────────────────────
  const startCalibrationRecord = async () => {
    if (calibrationIndex >= calibrationPhrases.length) return;
    try {
      audioChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
                       MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());

        // Save this phrase recording
        const phrase = calibrationPhrases[calibrationIndex];
        setCalibrationAudioBlobs(prev => [...prev, { phraseId: phrase.id, blob }]);

        // Try to decode it and auto-register as a pattern
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64Content = (reader.result as string).split(',')[1];
          try {
            const decoded = await geminiService.decodeEuphoniaAudio(
              base64Content, speechProfile, language, [], mediaRecorder.mimeType || 'audio/webm'
            );
            if (decoded && decoded.trim() && decoded !== phrase.text) {
              // Auto-register: what AI heard → what was intended
              const newPat: EuphoniaPattern = {
                id: 'cal_' + phrase.id + '_' + Date.now(),
                phrase: decoded.trim(),
                translation: phrase.text
              };
              setEuphoniaPatterns(prev => {
                const exists = prev.find(p => p.phrase.toLowerCase() === decoded.trim().toLowerCase());
                return exists ? prev : [...prev, newPat];
              });
            }
          } catch (e) { console.error("Calibration decode error:", e); }
        };

        // Mark phrase as recorded and advance
        setCalibrationPhrases(prev => prev.map((p, i) => i === calibrationIndex ? { ...p, recorded: true } : p));
        const nextIdx = calibrationIndex + 1;
        if (nextIdx >= calibrationPhrases.length) {
          setCalibrationComplete(true);
        } else {
          setCalibrationIndex(nextIdx);
        }
        setIsCalibrationRecording(false);
        setCalibrationTimer(0);
      };

      mediaRecorder.start();
      setIsCalibrationRecording(true);
      setCalibrationTimer(0);
      recordingTimerRef.current = setInterval(() => {
        setCalibrationTimer(prev => {
          if (prev >= 4) { stopCalibrationRecord(); return 4; }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      setError("Cannot access microphone for calibration.");
    }
  };

  const stopCalibrationRecord = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
    setIsCalibrationRecording(false);
  };

  const resetCalibration = () => {
    setCalibrationPhrases(CALIBRATION_PHRASES);
    setCalibrationIndex(0);
    setCalibrationComplete(false);
    setCalibrationAudioBlobs([]);
  };

  // ──────────────────────────────────────────────────────────────────────
  // SOUNDBOARD HELPERS
  // ──────────────────────────────────────────────────────────────────────
  const handleCustomSpeak = (text: string) => {
    if (!text.trim()) return;
    speakText(text);
    setSpeechHistory(prev => [text, ...prev.filter(i => i !== text)].slice(0, 8));
  };

  const handleAddCustomPreset = () => {
    if (!customText.trim()) return;
    setFavorites(prev => [...prev, { id: 'user_' + Date.now(), emoji: '⭐', textEn: customText, textAr: customText }]);
    setCustomText('');
  };

  const copyLatestCaption = () => {
    const latest = segments[segments.length - 1];
    if (!latest) return;
    navigator.clipboard.writeText(latest.decoded);
    setCopiedState(true);
    setTimeout(() => setCopiedState(false), 2000);
  };

  // ──────────────────────────────────────────────────────────────────────
  // CONFIDENCE BADGE
  // ──────────────────────────────────────────────────────────────────────
  const ConfidenceBadge = ({ level }: { level: 'high' | 'medium' | 'low' }) => {
    const config = {
      high: { color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', label: 'Clear', icon: '●●●' },
      medium: { color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20', label: 'Decoded', icon: '●●○' },
      low: { color: 'text-red-400 bg-red-500/10 border-red-500/20', label: 'Unclear', icon: '●○○' },
    }[level];
    return (
      <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${config.color}`}>
        <span className="font-mono text-[8px]">{config.icon}</span>
        {config.label}
      </span>
    );
  };

  // ──────────────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────────────
  const isActive = isListening || isRecordingEuphonia || isCalibrationRecording;
  const currentModeIsEuphonia = activeMode === 'euphonia';
  const currentModeIsListen = activeMode === 'listen';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-neutral-950 text-white flex flex-col lg:flex-row items-stretch overflow-hidden"
    >
      {/* ================================================================
          LEFT COLUMN: Caption Display + Microphone Controls
      ================================================================ */}
      <div className="flex-1 flex flex-col bg-neutral-950 border-r border-white/5 overflow-hidden">

        {/* ── Top bar: Mode Tabs ── */}
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3 border-b border-white/5 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Continuous Listen */}
            <button
              onClick={() => { setActiveMode('listen'); if (isRecordingEuphonia) stopEuphoniaRecord(); }}
              className={`text-[10px] md:text-[11px] font-black uppercase tracking-wider py-2 px-3 border rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                activeMode === 'listen'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                  : 'border-transparent text-neutral-400 hover:text-white hover:bg-bg-card/5'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              Live Listen
            </button>

            {/* Euphonia Direct Audio */}
            <button
              onClick={() => { setActiveMode('euphonia'); if (isListening) recognitionRef.current?.stop(); }}
              className={`text-[10px] md:text-[11px] font-black uppercase tracking-wider py-2 px-3 border rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                activeMode === 'euphonia'
                  ? 'border-purple-500/40 bg-purple-500/10 text-purple-400'
                  : 'border-transparent text-neutral-400 hover:text-white hover:bg-bg-card/5'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              Euphonia AI
            </button>

            {/* Calibration */}
            <button
              onClick={() => setActiveMode('calibrate')}
              className={`text-[10px] md:text-[11px] font-black uppercase tracking-wider py-2 px-3 border rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                activeMode === 'calibrate'
                  ? 'border-sky-500/40 bg-sky-500/10 text-sky-400'
                  : 'border-transparent text-neutral-400 hover:text-white hover:bg-bg-card/5'
              }`}
            >
              <Target className="w-3.5 h-3.5" />
              Voice Training
              {calibrationComplete && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
            </button>
          </div>

          <div className="flex items-center gap-3">
            {/* Listening Language Switcher */}
            <div className="flex items-center bg-white/5 border border-white/10 rounded-xl p-0.5">
              {[
                { code: 'fr-FR', label: '🇫🇷 FR', title: 'French (France)' },
                { code: 'en-US', label: '🇬🇧 EN', title: 'English (US)' },
                { code: 'ar-EG', label: '🇪🇬 AR', title: 'Arabic (Egypt)' },
              ].map(({ code, label, title }) => (
                <button
                  key={code}
                  onClick={() => setActiveLang(code)}
                  title={title}
                  className={`text-[10px] font-bold px-2 py-1 rounded-lg transition-all ${
                    activeLang === code
                      ? 'bg-primary text-white shadow-sm font-black'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Repeat Mode Toggle */}
            <button
              onClick={() => setRepeatModeOn(prev => !prev)}
              title="Repeat Mode: AI speaks back what it hears in a clear voice"
              className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider py-1.5 px-3 border rounded-xl transition-all cursor-pointer ${
                repeatModeOn
                  ? 'border-orange-500/40 bg-orange-500/10 text-orange-400'
                  : 'border-white/10 text-neutral-500 hover:text-white hover:bg-bg-card/5'
              }`}
            >
              <Repeat2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Repeat</span>
            </button>

            {/* Live status dot */}
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-600'}`} />
              <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 hidden sm:block">
                {isCalibrationRecording ? 'Recording…' : isRecordingEuphonia ? 'Decoding…' : isListening ? 'Listening' : 'Standby'}
              </span>
            </div>

            <button onClick={onClose} className="lg:hidden p-2 rounded-full bg-bg-card/5 hover:bg-bg-card/10 border border-white/10">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Speech Profile Selector (compact pill row) ── */}
        <div className="px-4 py-2.5 border-b border-white/5 flex items-center gap-2 overflow-x-auto scrollbar-hide">
          <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 whitespace-nowrap">Profile:</span>
          {(['Standard', 'Dysarthria', 'Stutter', 'Aphasia', 'Kanevsky'] as const).map(p => (
            <button
              key={p}
              onClick={() => setSpeechProfile(p)}
              className={`text-[10px] font-bold px-3 py-1 rounded-full border whitespace-nowrap transition-all cursor-pointer ${
                speechProfile === p
                  ? 'border-purple-500/50 bg-purple-500/15 text-purple-300'
                  : 'border-white/10 text-neutral-500 hover:text-white hover:border-white/20'
              }`}
            >
              {p === 'Kanevsky' ? 'Severe Dysarthria' : p}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════
            LISTEN MODE: Transcript segments + live waveform
        ══════════════════════════════════════════════════════════════ */}
        {(activeMode === 'listen' || activeMode === 'euphonia') && (
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Segment history */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              <AnimatePresence initial={false}>
                {segments.length === 0 && !isDecoding && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center h-full text-center py-16 px-8"
                  >
                    {activeMode === 'listen' ? (
                      <>
                        <Waves className="w-10 h-10 text-neutral-700 mb-4" />
                        <p className="text-neutral-400 text-sm font-semibold">Tap the microphone to start listening</p>
                        <p className="text-neutral-600 text-xs mt-2 max-w-xs">
                          Each utterance appears as a card with confidence scoring and AI decoding
                        </p>
                      </>
                    ) : (
                      <>
                        <Zap className="w-10 h-10 text-accent mb-4" />
                        <p className="text-neutral-400 text-sm font-semibold">Tap the record button below</p>
                        <p className="text-neutral-600 text-xs mt-2 max-w-xs">
                          Euphonia AI analyzes raw audio frame-by-frame, bypassing standard speech recognition
                        </p>
                      </>
                    )}
                  </motion.div>
                )}

                {segments.map((seg) => (
                  <motion.div
                    key={seg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-neutral-900 border border-white/5 rounded-2xl p-4 group hover:border-white/10 transition-all"
                  >
                    {/* Decoded text — large and readable, or an inline editor */}
                    {editingId === seg.id ? (
                      <div className="flex items-center gap-2 mb-3">
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEditSegment(seg);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="flex-1 bg-neutral-800 border border-emerald-500/40 rounded-xl px-3 py-2 text-lg md:text-xl font-bold text-white outline-none focus:border-emerald-500"
                        />
                        <button
                          onClick={() => saveEditSegment(seg)}
                          title="Save & learn"
                          className="p-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          title="Cancel"
                          className="p-2 rounded-lg bg-bg-card/5 text-neutral-400 hover:text-white"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <p className="text-xl md:text-2xl font-bold text-white leading-snug mb-3">
                        "{seg.decoded}"
                      </p>
                    )}

                    {/* Meta row */}
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <ConfidenceBadge level={seg.confidence} />
                        {typeof seg.confidencePct === 'number' && (
                          <span className="text-[10px] font-mono font-bold text-neutral-500">
                            {seg.confidencePct}%
                          </span>
                        )}
                        {seg.intent && (
                          <span className="text-[10px] font-bold text-neutral-400 bg-bg-card/5 border border-white/10 px-2 py-0.5 rounded-full">
                            {seg.intent}
                          </span>
                        )}
                        <span className="text-[10px] text-neutral-600 font-mono">{seg.timestamp}</span>
                      </div>

                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {/* Show raw if different */}
                        {seg.raw !== seg.decoded && (
                          <span className="text-[10px] text-neutral-600 italic truncate max-w-[140px]">
                            heard: "{seg.raw}"
                          </span>
                        )}
                        <button
                          onClick={() => startEditSegment(seg)}
                          className="p-1.5 rounded-lg bg-bg-card/5 hover:bg-bg-card/10 text-neutral-400 hover:text-emerald-400 transition-all"
                          title="Fix this — the app learns your pronunciation"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => speakText(seg.decoded)}
                          className="p-1.5 rounded-lg bg-bg-card/5 hover:bg-bg-card/10 text-neutral-400 hover:text-white transition-all"
                          title="Speak this aloud"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => { navigator.clipboard.writeText(seg.decoded); }}
                          className="p-1.5 rounded-lg bg-bg-card/5 hover:bg-bg-card/10 text-neutral-400 hover:text-white transition-all"
                          title="Copy"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Alternative interpretations for uncertain words */}
                    {editingId !== seg.id && seg.alternatives && seg.alternatives.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">
                          Did you mean
                        </span>
                        {seg.alternatives.map((alt, i) => (
                          <button
                            key={i}
                            onClick={() => applyAlternative(seg, alt)}
                            title="Use this — the app learns from it"
                            className="text-xs px-2.5 py-1 rounded-full bg-bg-card/5 border border-white/10 text-neutral-300 hover:bg-emerald-500/20 hover:border-emerald-500/40 hover:text-emerald-300 transition-all"
                          >
                            {alt}
                          </button>
                        ))}
                      </div>
                    )}
                  </motion.div>
                ))}

                {/* Live interim */}
                {(interimTranscript || isDecoding) && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="bg-neutral-900/50 border border-white/5 border-dashed rounded-2xl p-4"
                  >
                    {isDecoding ? (
                      <div className="flex items-center gap-2 text-purple-400">
                        <Brain className="w-4 h-4 animate-pulse" />
                        <span className="text-sm font-semibold">AI reconstructing speech…</span>
                      </div>
                    ) : (
                      <p className="text-lg text-neutral-400 italic">{interimTranscript}</p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
              <div ref={segmentsEndRef} />
            </div>

            {/* ── Repeat mode indicator ── */}
            {repeatModeOn && lastRepeated && (
              <div className="mx-4 mb-2 px-4 py-2.5 bg-orange-500/10 border border-orange-500/20 rounded-xl flex items-center gap-2">
                <Repeat2 className="w-4 h-4 text-orange-400 flex-shrink-0" />
                <p className="text-sm text-orange-200 truncate">Repeated: "{lastRepeated}"</p>
              </div>
            )}

            {/* ── Error banner ── */}
            {error && (
              <div className="mx-4 mb-2 px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <p className="text-xs text-red-300">{error}</p>
                <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-white"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}

            {/* ── Microphone button + waveform ── */}
            <div className="flex flex-col items-center gap-3 py-5 border-t border-white/5 bg-neutral-950/50">
              <div className="relative">
                {/* Pulse rings */}
                <AnimatePresence>
                  {isActive && volume > 5 && (
                    <>
                      <motion.div
                        initial={{ scale: 1, opacity: 0.4 }}
                        animate={{ scale: 1 + volume / 90, opacity: 0 }}
                        transition={{ duration: 0.4, repeat: Infinity }}
                        className={`absolute inset-0 rounded-full ${currentModeIsEuphonia ? 'bg-purple-500/30' : 'bg-emerald-500/25'}`}
                      />
                      <motion.div
                        initial={{ scale: 1, opacity: 0.2 }}
                        animate={{ scale: 1 + volume / 50, opacity: 0 }}
                        transition={{ duration: 0.7, repeat: Infinity, delay: 0.15 }}
                        className={`absolute inset-0 rounded-full ${currentModeIsEuphonia ? 'bg-purple-500/20' : 'bg-emerald-500/15'}`}
                      />
                    </>
                  )}
                </AnimatePresence>

                {activeMode === 'listen' ? (
                  <button
                    onClick={toggleListening}
                    className={`w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center shadow-xl z-10 relative transition-all cursor-pointer ${
                      isListening
                        ? 'bg-emerald-500 text-black scale-105 shadow-emerald-500/40'
                        : 'bg-bg-card text-black hover:bg-neutral-100'
                    }`}
                  >
                    {isListening ? <MicOff className="w-7 md:w-8 h-7 md:h-8" /> : <Mic className="w-7 md:w-8 h-7 md:h-8" />}
                  </button>
                ) : (
                  <button
                    onClick={isRecordingEuphonia ? stopEuphoniaRecord : startEuphoniaRecord}
                    disabled={isDecoding}
                    className={`w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center shadow-xl z-10 relative transition-all cursor-pointer disabled:opacity-50 ${
                      isRecordingEuphonia
                        ? 'bg-red-600 text-white scale-105 shadow-red-500/40'
                        : 'bg-gradient-to-tr from-purple-500 to-primary text-white hover:scale-102'
                    }`}
                  >
                    {isRecordingEuphonia ? (
                      <span className="relative flex h-5 w-5">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-red-300 opacity-75 animate-ping" />
                        <span className="relative inline-flex rounded-full h-4 w-4 bg-bg-card" />
                      </span>
                    ) : (
                      <Zap className="w-7 md:w-8 h-7 md:h-8" />
                    )}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
                  {activeMode === 'listen'
                    ? (isListening ? 'Tap to stop' : 'Tap to listen')
                    : (isRecordingEuphonia ? `Recording… ${euphoniaTimer}s / 7s` : (isDecoding ? 'Decoding audio…' : 'Tap for Euphonia decode'))
                  }
                </p>
                {segments.length > 0 && (
                  <button
                    onClick={() => setSegments([])}
                    className="text-[10px] text-neutral-600 hover:text-red-400 font-bold uppercase tracking-wider"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            CALIBRATION MODE: Project Relate-style guided recording
        ══════════════════════════════════════════════════════════════ */}
        {activeMode === 'calibrate' && (
          <div className="flex-1 flex flex-col overflow-y-auto px-4 py-6 space-y-6">
            {calibrationComplete ? (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-10 space-y-4">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                </div>
                <h2 className="text-2xl font-black text-white">Voice Profile Ready</h2>
                <p className="text-neutral-400 text-sm max-w-xs mx-auto">
                  AI-LA has learned your speech patterns. {calibrationAudioBlobs.length} phrases recorded and {euphoniaPatterns.filter(p => p.id.startsWith('cal_')).length} patterns auto-mapped.
                </p>
                <p className="text-xs text-emerald-400 font-semibold">Switch to Live Listen or Euphonia AI to start communicating.</p>
                <button
                  onClick={resetCalibration}
                  className="text-xs text-neutral-500 hover:text-white border border-white/10 px-4 py-2 rounded-full"
                >
                  Retrain from Scratch
                </button>
              </motion.div>
            ) : (
              <>
                {/* Progress */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-neutral-400 font-bold uppercase tracking-wider">Voice Training Session</span>
                    <span className="text-sky-400 font-black">{calibrationIndex} / {calibrationPhrases.length}</span>
                  </div>
                  <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-sky-500 rounded-full"
                      animate={{ width: `${(calibrationIndex / calibrationPhrases.length) * 100}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-neutral-500">
                    Read each phrase aloud naturally — exactly as you speak. AI will learn your unique patterns.
                  </p>
                </div>

                {/* Current phrase */}
                <div className="bg-sky-500/5 border border-sky-500/20 rounded-2xl p-6 text-center space-y-4">
                  <span className="text-[10px] font-black uppercase tracking-widest text-sky-500">Say this phrase</span>
                  <h2 className="text-3xl md:text-4xl font-black text-white leading-tight">
                    "{calibrationPhrases[calibrationIndex]?.text}"
                  </h2>

                  {isCalibrationRecording ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-center gap-2 text-red-400">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                        <span className="font-bold text-sm">Recording… {calibrationTimer}s</span>
                      </div>
                      <button
                        onClick={stopCalibrationRecord}
                        className="w-14 h-14 rounded-full bg-red-600 text-white flex items-center justify-center mx-auto shadow-lg shadow-red-500/30"
                      >
                        <StopCircle className="w-7 h-7" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={startCalibrationRecord}
                      className="w-16 h-16 rounded-full bg-sky-500 text-white flex items-center justify-center mx-auto hover:bg-sky-400 shadow-lg shadow-sky-500/30 transition-all"
                    >
                      <Mic className="w-7 h-7" />
                    </button>
                  )}
                  <p className="text-xs text-neutral-500">
                    {isCalibrationRecording ? 'Recording stops automatically after 4 seconds' : 'Tap the mic, speak, recording stops automatically'}
                  </p>
                </div>

                {/* Phrase list with checkmarks */}
                <div className="space-y-1.5">
                  {calibrationPhrases.map((phrase, idx) => (
                    <div key={phrase.id} className={`flex items-center gap-3 px-3 py-2 rounded-xl border transition-all ${
                      idx === calibrationIndex ? 'border-sky-500/30 bg-sky-500/5' :
                      phrase.recorded ? 'border-emerald-500/15 bg-emerald-500/5' :
                      'border-white/5 opacity-40'
                    }`}>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-black ${
                        phrase.recorded ? 'bg-emerald-500/20 text-emerald-400' :
                        idx === calibrationIndex ? 'bg-sky-500/20 text-sky-400' :
                        'bg-bg-card/5 text-neutral-600'
                      }`}>
                        {phrase.recorded ? '✓' : idx + 1}
                      </span>
                      <span className={`text-sm font-semibold ${
                        phrase.recorded ? 'text-emerald-300' :
                        idx === calibrationIndex ? 'text-white' : 'text-neutral-500'
                      }`}>
                        {phrase.text}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ================================================================
          RIGHT COLUMN: Vocal Assistant (Soundboard + Smart Replies)
      ================================================================ */}
      <div className="flex-1 lg:max-w-[460px] bg-neutral-900 border-l border-white/5 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between bg-neutral-900 sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <Volume2 className="w-5 h-5 text-purple-400" />
            <div>
              <h3 className="text-sm font-bold text-white">Vocal Speech Assistant</h3>
              <p className="text-[11px] text-neutral-500">Tap any card to speak it aloud</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded-full border transition-colors ${showSettings ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-bg-card/5 border-white/10 text-neutral-400 hover:text-white'}`}
            >
              <Settings className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="hidden lg:flex p-2 rounded-full bg-bg-card/5 hover:bg-bg-card/10 border border-white/10 text-neutral-400">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          {/* ── Settings Panel ── */}
          {showSettings && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              className="bg-neutral-950/60 p-4 rounded-2xl border border-white/5 space-y-4"
            >
              <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider block">Pronunciation & Capture</span>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-400">Silence Threshold</span>
                  <span className="text-emerald-400 font-mono">{(pauseThreshold / 1000).toFixed(1)}s</span>
                </div>
                <input type="range" min="1000" max="6500" step="500" value={pauseThreshold}
                  onChange={e => setPauseThreshold(Number(e.target.value))}
                  className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                <p className="text-[10px] text-neutral-600">Extend for stutters/blocks</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-neutral-400">Voice Rate</span>
                    <span className="text-purple-400 font-mono">{speechRate.toFixed(1)}x</span>
                  </div>
                  <input type="range" min="0.5" max="1.8" step="0.1" value={speechRate}
                    onChange={e => setSpeechRate(Number(e.target.value))}
                    className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-purple-500" />
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-neutral-400">Voice Pitch</span>
                    <span className="text-purple-400 font-mono">{speechPitch.toFixed(1)}</span>
                  </div>
                  <input type="range" min="0.5" max="1.5" step="0.1" value={speechPitch}
                    onChange={e => setSpeechPitch(Number(e.target.value))}
                    className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-purple-500" />
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Custom Speech Input ── */}
          <div className="space-y-2 bg-neutral-950/40 p-4 rounded-2xl border border-white/5">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider">Type to Speak</span>
            </div>
            <textarea
              value={customText}
              onChange={e => setCustomText(e.target.value)}
              placeholder={isAr ? "اكتب شيئاً لنطقه بالصوت…" : "Type a sentence to speak aloud…"}
              dir={dir}
              className="w-full text-sm bg-neutral-950 border border-white/10 rounded-xl p-3 focus:outline-none focus:border-purple-500/50 text-white placeholder-neutral-600 resize-none h-16"
            />
            <div className="flex items-center gap-2 justify-end flex-wrap">
              {customText.trim() && (
                <button onClick={() => setCustomText('')} className="text-xs text-neutral-500 hover:text-white px-2 py-1.5 rounded-lg bg-bg-card/5">
                  Clear
                </button>
              )}
              <button onClick={handleAddCustomPreset} disabled={!customText.trim()}
                className="flex items-center gap-1 text-xs font-semibold text-purple-400 bg-purple-500/10 disabled:opacity-40 hover:bg-purple-500/20 px-3 py-1.5 rounded-lg border border-purple-500/15 transition-all">
                <Plus className="w-3.5 h-3.5" /> Save
              </button>
              <button onClick={() => setShowBigMode(true)} disabled={!customText.trim()}
                className="flex items-center gap-1 text-xs font-bold text-neutral-300 bg-neutral-800 disabled:opacity-40 hover:bg-neutral-700 px-3 py-1.5 rounded-lg border border-white/5 transition-all">
                <Maximize2 className="w-3.5 h-3.5" /> Big
              </button>
              <button onClick={() => { handleCustomSpeak(customText); setCustomText(''); }} disabled={!customText.trim()}
                className="flex items-center gap-1.5 text-xs font-black text-black bg-bg-card hover:bg-neutral-100 disabled:opacity-40 px-4 py-1.5 rounded-lg transition-all">
                <Volume2 className="w-3.5 h-3.5" /> Speak
              </button>
            </div>
          </div>

          {/* ── AI Smart Replies ── */}
          {(aiSmartReplies.length > 0 || isGeneratingReplies) && (
            <div className="space-y-2 bg-neutral-950/40 p-4 rounded-2xl border border-white/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-yellow-400" />
                  <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider">AI Suggested Replies</span>
                </div>
                <button onClick={() => fetchSmartReplies(segments[segments.length - 1]?.decoded || 'Hello')}
                  disabled={isGeneratingReplies}
                  className="p-1 text-[10px] uppercase font-black text-neutral-500 hover:text-white bg-bg-card/5 rounded-md hover:bg-bg-card/10 disabled:opacity-40">
                  <RefreshCw className={`w-3 h-3 ${isGeneratingReplies ? 'animate-spin' : ''}`} />
                </button>
              </div>
              {isGeneratingReplies ? (
                <div className="flex items-center gap-2 py-3 text-xs text-neutral-500">
                  <RefreshCw className="w-3 h-3 animate-spin text-yellow-400" />
                  Generating context-aware replies…
                </div>
              ) : (
                <div className="grid gap-1.5">
                  {aiSmartReplies.map((reply, idx) => (
                    <motion.button key={idx} whileTap={{ scale: 0.98 }}
                      onClick={() => handleCustomSpeak(reply)}
                      className="text-left w-full p-2.5 rounded-xl bg-yellow-500/8 hover:bg-yellow-500/15 border border-yellow-500/15 text-yellow-100 text-xs font-semibold transition-all flex items-center justify-between gap-2">
                      <span>{reply}</span>
                      <Volume2 className="w-3.5 h-3.5 opacity-50 flex-shrink-0" />
                    </motion.button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Soundboard ── */}
          <div className="space-y-3">
            <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider">Quick Phrase Deck</span>
            <div className="flex flex-wrap gap-1 p-1 bg-neutral-950 rounded-xl border border-white/5">
              {(['essentials', 'needs', 'social', 'favorites', 'emergencies'] as const).map(cat => (
                <button key={cat} onClick={() => setActiveTab(cat)}
                  className={`text-[10px] py-1.5 px-2.5 rounded-lg font-bold transition-all flex-1 text-center truncate cursor-pointer ${
                    activeTab === cat ? 'bg-neutral-800 text-white shadow' : 'text-neutral-500 hover:text-white'
                  }`}>
                  {cat === 'essentials' ? 'Basics' : cat === 'favorites' ? 'My Phrases' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {((activeTab === 'favorites' ? favorites : SOUNDBOARD_DATA[activeTab as keyof typeof SOUNDBOARD_DATA]) || []).map(item => {
                const phrase = isArabic ? item.textAr : item.textEn;
                const color = activeTab === 'emergencies' ? 'hover:border-rose-500/40 hover:bg-rose-500/8' :
                              activeTab === 'needs' ? 'hover:border-orange-500/40 hover:bg-orange-500/8' :
                              activeTab === 'social' ? 'hover:border-green-500/40 hover:bg-green-500/8' :
                              activeTab === 'favorites' ? 'hover:border-purple-500/40 hover:bg-purple-500/8 border-purple-500/10' :
                              'hover:border-blue-500/40 hover:bg-primary/8';
                return (
                  <div key={item.id} className="relative group">
                    <motion.button whileTap={{ scale: 0.97 }}
                      onClick={() => speakText(phrase)}
                      className={`w-full flex flex-col items-center justify-center p-3 text-center bg-neutral-950 border border-white/5 rounded-2xl transition-all cursor-pointer ${color}`}>
                      <span className="text-xl mb-1.5">{item.emoji}</span>
                      <span className="text-xs font-bold leading-tight line-clamp-2">{phrase}</span>
                    </motion.button>
                    {activeTab === 'favorites' && (
                      <button onClick={e => { e.stopPropagation(); setFavorites(p => p.filter(f => f.id !== item.id)); }}
                        className="absolute top-1 right-1 p-1 bg-rose-500/20 text-rose-400 hover:bg-rose-600 hover:text-white rounded-full opacity-0 group-hover:opacity-100 transition-all border border-rose-500/20">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                );
              })}
              {activeTab === 'favorites' && favorites.length === 0 && (
                <div className="col-span-2 text-center py-6 text-[11px] text-neutral-600 italic">
                  Type a sentence above and tap "Save" to add your own phrases here
                </div>
              )}
            </div>
          </div>

          {/* ── Phoneme Pattern Training ── */}
          <div className="bg-neutral-950/40 p-4 rounded-2xl border border-purple-500/15 space-y-3">
            <button onClick={() => setShowPatternsPanel(!showPatternsPanel)}
              className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider">Phoneme Pattern Dictionary</span>
                <span className="text-[10px] text-purple-400 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded-full font-black">
                  {euphoniaPatterns.length}
                </span>
              </div>
              <ChevronDown className={`w-4 h-4 text-neutral-500 transition-transform ${showPatternsPanel ? 'rotate-180' : ''}`} />
            </button>

            {showPatternsPanel && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="space-y-3 overflow-hidden">
                <p className="text-[10px] text-neutral-500 leading-relaxed">
                  Map what standard speech-to-text hears you say → what you actually mean. Matched instantly, no AI call needed.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-neutral-500 block mb-1">STT hears:</span>
                    <input type="text" placeholder="e.g. wa wa" value={newPattern}
                      onChange={e => setNewPattern(e.target.value)}
                      className="w-full text-xs bg-neutral-950 border border-white/10 rounded-lg p-2 text-white focus:outline-none focus:border-purple-500 placeholder-neutral-700" />
                  </div>
                  <div>
                    <span className="text-[10px] text-neutral-500 block mb-1">You mean:</span>
                    <input type="text" placeholder="e.g. I need water" value={newTranslation}
                      onChange={e => setNewTranslation(e.target.value)}
                      className="w-full text-xs bg-neutral-950 border border-white/10 rounded-lg p-2 text-white focus:outline-none focus:border-purple-500 placeholder-neutral-700" />
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (!newPattern.trim() || !newTranslation.trim()) return;
                    setEuphoniaPatterns(prev => [...prev, { id: 'ep_' + Date.now(), phrase: newPattern.trim(), translation: newTranslation.trim() }]);
                    setNewPattern(''); setNewTranslation('');
                  }}
                  disabled={!newPattern.trim() || !newTranslation.trim()}
                  className="w-full text-[11px] font-bold text-white bg-purple-600 disabled:opacity-40 hover:bg-purple-500 py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all">
                  <Plus className="w-3.5 h-3.5" /> Add Pattern
                </button>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {euphoniaPatterns.map(pat => (
                    <div key={pat.id} className="flex items-center justify-between bg-neutral-950/80 p-2 border border-white/5 rounded-xl group/p">
                      <div className="text-[11px] flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-purple-300 font-mono truncate">"{pat.phrase}"</span>
                        <span className="text-neutral-600 flex-shrink-0">→</span>
                        <span className="text-emerald-400 font-semibold truncate">{pat.translation}</span>
                      </div>
                      <button onClick={() => setEuphoniaPatterns(prev => prev.filter(p => p.id !== pat.id))}
                        className="text-neutral-600 hover:text-rose-400 ml-2 flex-shrink-0 opacity-0 group-hover/p:opacity-100 transition-opacity">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </div>

          {/* ── Speech History ── */}
          {speechHistory.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-neutral-500">
                  <History className="w-3.5 h-3.5" />
                  <span className="text-xs font-bold uppercase tracking-wider">Recent Phrases</span>
                </div>
                <button onClick={() => setSpeechHistory([])} className="text-[10px] text-neutral-600 hover:text-rose-400 flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Clear
                </button>
              </div>
              <div className="space-y-1">
                {speechHistory.map((phrase, i) => (
                  <motion.button key={i} whileHover={{ x: 2 }} onClick={() => speakText(phrase)}
                    className="text-left w-full px-3 py-2 text-xs bg-neutral-950/30 hover:bg-neutral-950/70 border border-white/5 rounded-xl text-neutral-400 hover:text-white transition-all flex items-center justify-between">
                    <span className="truncate pr-4">{phrase}</span>
                    <Volume2 className="w-3 h-3 text-neutral-600 flex-shrink-0" />
                  </motion.button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-3 border-t border-white/5 text-center text-[10px] text-neutral-600 flex items-center justify-center gap-1.5">
          <span>Built for independence & inclusion</span>
          <Heart className="w-2.5 h-2.5 text-rose-500/60 animate-pulse" />
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          FULL-SCREEN BIG TEXT MODE
      ══════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showBigMode && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-neutral-950 flex flex-col justify-between p-8">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase text-yellow-500 tracking-widest bg-yellow-500/10 border border-yellow-500/20 px-3 py-1 rounded-full">
                Visual Board
              </span>
              <button onClick={() => setShowBigMode(false)} className="p-3 rounded-full bg-bg-card/5 hover:bg-bg-card/10 border border-white/10">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 flex items-center justify-center text-center px-4">
              <h1 dir={dir} className="text-5xl md:text-7xl lg:text-9xl font-black leading-relaxed text-white select-none break-words">
                {customText}
              </h1>
            </div>
            <div className="flex items-center justify-center gap-4">
              <button onClick={() => speakText(customText)}
                className="flex items-center gap-2 px-6 py-3 bg-bg-card text-black font-black uppercase text-xs tracking-widest rounded-full hover:bg-neutral-100 shadow-2xl">
                <Volume2 className="w-4 h-4" /> Speak Aloud
              </button>
              <button onClick={() => setShowBigMode(false)}
                className="px-6 py-3 bg-neutral-800 text-white font-black uppercase text-xs tracking-widest rounded-full hover:bg-neutral-700">
                Close
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
