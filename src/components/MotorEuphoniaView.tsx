import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  UserProfile, VocalSoundTriggerConfig, AACCardItem, HeadTrackingConfig, VocalTriggerAction,
} from '../types';
import { createZip, downloadBlob } from '../lib/zipWriter';
import {
  vocalSoundEngine, LiveAudioMetrics, loadVocalTriggers, DEFAULT_VOCAL_TRIGGERS,
} from '../lib/vocalSoundTrigger';
import { FacialHeadTracker, PointerPosition, FacialGestureState, DEFAULT_HEAD_TRACKING_CONFIG } from '../lib/facialHeadTracker';
import { speak, cancelSpeech, unlockSpeechSynthesis, hasArabicVoice } from '../lib/tts';
import { geminiService } from '../services/geminiService';
import { toast } from './Toast';
import { localize } from '../lib/translations';
import { doc, setDoc } from 'firebase/firestore';
import { db, cleanDataForFirestore } from '../lib/firebase';
import {
  EmergencyContact,
  loadContacts,
  saveContacts,
  makePhoneCall,
  isValidContactPhone,
  sendWhatsAppMessage,
  WHATSAPP_QUICK_MESSAGES,
} from '../lib/contacts';
import {
  EuphoniaPhraseDef,
  loadEuphoniaPhraseBank,
  getCategoryIcon,
} from '../lib/euphoniaPhraseBank';
import {
  euphoniaRecorder,
  LocalIndexedDbStorageAdapter,
  RestUploadStorageAdapter,
  EuphoniaStorageAdapter,
  EuphoniaAudioSample,
} from '../lib/euphoniaRecorder';

/** Shared default adapter — constructed once, not on every render. */
const DEFAULT_LOCAL_ADAPTER = new LocalIndexedDbStorageAdapter();

// ─── Single-switch auto scanning ──────────────────────────────────────────────
// For students who cannot drive the gaze pointer at all. The app walks the
// selectable targets itself and the student makes ONE action to choose; any
// existing trigger doubles as that switch (blink, smile, a vocal sound, the
// Space/Enter a physical switch emulates, or the big on-screen button).
//
// Row-column is the default: linear scanning over a 40-key Arabic keyboard is
// ~a minute per pass, while row-then-column gets to any key in two choices.
const SCAN_HL = 'cognify-scan-hl';
const SCAN_HL_ROW = 'cognify-scan-hl-row';
/** Stop after this many cycles with no selection, rather than moving forever. */
const SCAN_MAX_PASSES = 3;
/** Two switch sources firing at once (a blink that is also a smile) is one press. */
const SCAN_SWITCH_DEBOUNCE_MS = 350;

/**
 * Layer a saved/synced trigger set over the defaults, matched by id.
 *
 * Keeping the defaults as the base means a trigger added in a later build shows
 * up for students whose profile predates it, instead of them being stuck with
 * whatever set was current the day they first opened the app.
 */
function mergeTriggers(saved?: VocalSoundTriggerConfig[]): VocalSoundTriggerConfig[] | null {
  if (!saved || !saved.length) return null;
  return DEFAULT_VOCAL_TRIGGERS.map((d) => ({ ...d, ...(saved.find((x) => x.id === d.id) || {}) }));
}

/** What each vocal action does, for the picker. */
const VOCAL_ACTION_LABELS: { value: VocalTriggerAction; en: string; ar: string }[] = [
  { value: 'select',      en: 'Select what is highlighted', ar: 'اختيار العنصر المحدد' },
  { value: 'next',        en: 'Next screen',                ar: 'الشاشة التالية' },
  { value: 'previous',    en: 'Previous screen',            ar: 'الشاشة السابقة' },
  { value: 'back',        en: 'Close the open window',      ar: 'إغلاق النافذة المفتوحة' },
  { value: 'speak-aloud', en: 'Speak the typed text',       ar: 'نطق النص المكتوب' },
  { value: 'clear',       en: 'Clear the text',             ar: 'مسح النص' },
  { value: 'ask-ai',      en: 'Ask the AI',                 ar: 'اسأل المساعد الذكي' },
  { value: 'emergency',   en: 'Emergency call',             ar: 'اتصال طوارئ' },
];

const TAB_ORDER = [
  'keyboard', 'euphonia-studio', 'smart-room',
  'pain-sensory', 'class-ai', 'custom-bank', 'eye-games',
] as const;
import {
  transcribe,
  getEuphoniaApiUrl,
  setEuphoniaApiUrl,
  checkEuphoniaApiHealth,
} from '../lib/euphoniaApi';
import {
  Activity,
  Mic,
  MicOff,
  Volume2,
  Camera,
  CameraOff,
  RefreshCw,
  Sparkles,
  Sliders,
  Send,
  Bell,
  BookOpen,
  Heart,
  Smile,
  Eye,
  SlidersHorizontal,
  Phone,
  PhoneCall,
  MessageCircle,
  Users,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Download,
  ScanLine,
  AlertCircle,
  Clock,
  Play,
  X,
  Keyboard as KeyboardIcon,
  Delete,
  Space,
  Languages,
  ArrowRight,
  Lightbulb,
  Tv,
  Wind,
  Bed,
  BellRing,
  Thermometer,
  Zap,
  Check,
  Target,
  Palette,
  VolumeX,
  GraduationCap,
  MessageSquare,
  BookmarkPlus,
  Gamepad2,
  Maximize2,
  Minimize2,
  Trophy,
  Gauge,
  Radio,
  Award,
  Layers,
  EyeOff,
  Columns2,
  LayoutGrid
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import GazeBlinkKeyboard from './GazeBlinkKeyboard';

interface MotorEuphoniaViewProps {
  profile: UserProfile;
  onSendMessage?: (text: string) => void;
}

// Color Theme Profiles
type ColorTheme = 'amber' | 'cyan' | 'emerald' | 'monochrome';

// Arabic Keyboard Layout Rows (High Contrast & Clear Grid)
const AR_KEYBOARD_ROWS = [
  ['١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩', '٠'],
  ['ض', 'ص', 'ث', 'ق', 'ف', 'غ', 'ع', 'ه', 'خ', 'ح', 'ج', 'د'],
  ['ش', 'س', 'ي', 'ب', 'ل', 'ا', 'ت', 'ن', 'م', 'ك', 'ط'],
  ['ئ', 'ء', 'ؤ', 'ر', 'لا', 'ى', 'ة', 'و', 'ز', 'ظ', 'ذ'],
  ['؟', '!', '،', '.']
];

// English Keyboard Layout Rows
const EN_KEYBOARD_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
  ['?', '!', ',', '.']
];

// Arabic Predictive Autocomplete dictionary
const AR_PREDICTIONS: Record<string, string[]> = {
  'ا': ['أنا بخير شكراً', 'أحتاج مساعدة عاجلة', 'أريد شرب ماء', 'أستاذ ممكن سؤال؟', 'السلام عليكم'],
  'أ': ['أنا بخير شكراً', 'أحتاج مساعدة عاجلة', 'أريد شرب ماء', 'أستاذ ممكن سؤال؟', 'أين المرافق؟'],
  'اح': ['أحتاج مساعدة', 'أحتاج ماء', 'أحتاج الذهاب للطبيب'],
  'شك': ['شكراً جزيلاً', 'شكراً لك', 'شكراً على المساعدة'],
  'لو': ['لو سمحت ساعدني', 'لو تفضلت بالماء', 'لو سمحت اضبط السرير'],
  'مس': ['مساعدة من فضلك', 'مساء الخير', 'مستعد للدرس'],
  'عا': ['عايز مساعدة', 'عندي سؤال دراسي', 'عاجل جداً'],
  'من': ['من فضلك', 'ممكن توضيح المفهوم', 'ممكن إعادة النقطة'],
  'ما': ['ماما تعالي', 'ماء للشرب', 'ماشي شكراً'],
  'مر': ['مرافق تعال', 'مرحباً بكم'],
  'دك': ['دكتور احتاجك', 'دقيقة واحدة'],
  'ار': ['أريد تعديل الجلسة', 'أريد النوم', 'أريد الراحة'],
};

const EN_PREDICTIONS: Record<string, string[]> = {
  'i': ['I need help', 'I am fine, thanks', 'I want water', 'I have a question'],
  'h': ['Help please', 'Hello everyone', 'How are you?', 'Home comfort'],
  't': ['Thank you very much', 'Thanks for help', 'Today was good', 'Time for rest'],
  'p': ['Please help me', 'Please call caregiver', 'Problem here'],
  'w': ['Water please', 'WhatsApp message', 'Where are you?', 'What is next?'],
  'c': ['Call doctor now', 'Caregiver assistance', 'Can you explain?'],
};

// Steve Saling Smart Room Automation items
const SMART_ROOM_ITEMS = [
  { id: 'room-light', icon: '💡', labelAr: 'إضاءة الغرفة', labelEn: 'Room Lights', phraseAr: 'لو سمحت قم بتبديل إضاءة الغرفة.', phraseEn: 'Please toggle the room lights.' },
  { id: 'room-tv', icon: '📺', labelAr: 'التلفاز / الشاشة', labelEn: 'TV / Display', phraseAr: 'لو سمحت شغل التلفاز أو شاشة العرض.', phraseEn: 'Please turn on the TV.' },
  { id: 'room-ac', icon: '❄️', labelAr: 'المكيف / التبريد', labelEn: 'AC / Fan', phraseAr: 'لو سمحت شغل المكيف واضبط الحرارة.', phraseEn: 'Please adjust the air conditioning.' },
  { id: 'room-bed-up', icon: '🛏️', labelAr: 'رفع السرير', labelEn: 'Raise Bed', phraseAr: 'لو سمحت ارفع مسند الظهر بالسرير.', phraseEn: 'Please raise the back of my bed.' },
  { id: 'room-bed-down', icon: '🛌', labelAr: 'تمديد السرير', labelEn: 'Flat Bed', phraseAr: 'لو سمحت اجعل السرير في وضع النوم المستوي.', phraseEn: 'Please adjust bed flat for resting.' },
  { id: 'room-alarm', icon: '🔔', labelAr: 'نداء الممرض / إنذار', labelEn: 'Nurse Call Alarm', phraseAr: 'نداء عاجل! أحتاج المرافق أو الممرض فوراً!', phraseEn: 'Urgent assistance needed! Nurse call!', isAlarm: true },
];

// Pain & Sensory Feedback Board
const SENSORY_PAIN_ITEMS = [
  { id: 'pain-head', icon: '🤕', labelAr: 'صداع / ألم بالرأس', phraseAr: 'أشعر بصداع وألم في رأسي، أحتاج مسكن.' },
  { id: 'pain-stomach', icon: '🤢', labelAr: 'ألم بالمعدة / غثيان', phraseAr: 'أشعر بألم في معدتي وغثيان.' },
  { id: 'pain-back', icon: '🩹', labelAr: 'ألم بالظهر / ضغط', phraseAr: 'أشعر بألم وضغط في ظهري، يرجى تعديل وضعيتي.' },
  { id: 'sensory-cold', icon: '🥶', labelAr: 'أشعر بالبرد الشديد', phraseAr: 'أشعر بالبرد الشديد، لو سمحت غطني ببطانية.' },
  { id: 'sensory-hot', icon: '🥵', labelAr: 'أشعر بالحر الشديد', phraseAr: 'أشعر بالحر الشديد، يرجى تشغيل المروحة.' },
  { id: 'sensory-tired', icon: '🥱', labelAr: 'مرهق / أريد النوم', phraseAr: 'أشعر بالإرهاق وأريد النوم والراحة الآن.' },
];

// Default Personal Phrase Bank
const DEFAULT_CUSTOM_PHRASES = [
  { id: 'cp-1', textAr: 'صباح الخير للجميع، يوم سعيد.', icon: '☀️' },
  { id: 'cp-2', textAr: 'أريد مراجعة ملخص درس اليوم.', icon: '📚' },
  { id: 'cp-3', textAr: 'هل يمكن فتح النافذة قليلاً لتجديد الهواء؟', icon: '🪟' },
  { id: 'cp-4', textAr: 'أحبكم جميعاً وشكراً لدعمكم المستمر.', icon: '❤️' },
  { id: 'cp-5', textAr: 'أحتاج شاحن الهاتف والكمبيوتر لو سمحت.', icon: '🔌' },
];

// Steve Saling / Euphonia Quick Need Action Cards
const QUICK_NEEDS = [
  { id: 'need-help', icon: '🚨', labelAr: 'طوارئ / مساعدة', labelEn: 'Emergency / Help', phraseAr: 'أحتاج إلى مساعدة عاجلة من المرافق لو سمحت.', phraseEn: 'I need urgent assistance please.' },
  { id: 'need-water', icon: '💧', labelAr: 'أحتاج ماء', labelEn: 'Need Water', phraseAr: 'أحتاج إلى شرب ماء من فضلك.', phraseEn: 'I would like a drink of water please.' },
  { id: 'need-adjust', icon: '🪑', labelAr: 'تعديل الجلسة', labelEn: 'Adjust Position', phraseAr: 'لو سمحت ساعدني في تعديل وضعية جلوسي.', phraseEn: 'Please help me adjust my position.' },
  { id: 'comm-yes', icon: '✅', labelAr: 'نعم تماماً', labelEn: 'Yes, Exactly', phraseAr: 'نعم، هذا صحيح تماماً.', phraseEn: 'Yes, exactly.' },
  { id: 'comm-no', icon: '❌', labelAr: 'لا، ليس هذا', labelEn: 'No, Not This', phraseAr: 'لا، ليس هذا ما أقصده.', phraseEn: 'No, not this.' },
  { id: 'ai-explain', icon: '💡', labelAr: 'اشرح الدرس', labelEn: 'Explain Simply', phraseAr: 'هل يمكنك شرح المفهوم الأساسي بتشبيه بسيط؟', phraseEn: 'Can you explain simply?', isAi: true },
];

// Project Euphonia Training Phrase Set (Google Project Euphonia Architecture)
interface EuphoniaPhraseItem {
  id: string;
  phraseAr: string;
  phraseEn: string;
  category: string;
  icon: string;
  samplesRecorded: number;
}

const DEFAULT_EUPHONIA_PHRASES: EuphoniaPhraseItem[] = [
  { id: 'eup-1', phraseAr: 'أريد شرب ماء من فضلك', phraseEn: 'I want water please', category: 'basic', icon: '💧', samplesRecorded: 3 },
  { id: 'eup-2', phraseAr: 'أحتاج مساعدة عاجلة من المرافق', phraseEn: 'I need urgent assistance', category: 'emergency', icon: '🚨', samplesRecorded: 3 },
  { id: 'eup-3', phraseAr: 'نعم، هذا صحيح تماماً', phraseEn: 'Yes, exactly', category: 'response', icon: '✅', samplesRecorded: 3 },
  { id: 'eup-4', phraseAr: 'لا، ليس هذا ما أريده', phraseEn: 'No, not this', category: 'response', icon: '❌', samplesRecorded: 3 },
  { id: 'eup-5', phraseAr: 'أشعر بألم وأريد تعديل وضعيتي', phraseEn: 'I am in pain, adjust position', category: 'medical', icon: '🩹', samplesRecorded: 2 },
  { id: 'eup-6', phraseAr: 'ماما تعالي أحتاجك', phraseEn: 'Mom please come', category: 'family', icon: '👩‍👧', samplesRecorded: 1 },
];

// Game 1 Target Bubbles list
const GAME_BUBBLES = [
  { id: 'b-1', char: 'أ', x: 20, y: 30, color: 'bg-amber-400 text-slate-950' },
  { id: 'b-2', char: 'ب', x: 70, y: 25, color: 'bg-emerald-400 text-slate-950' },
  { id: 'b-3', char: 'ج', x: 35, y: 70, color: 'bg-indigo-400 text-white' },
  { id: 'b-4', char: 'د', x: 80, y: 65, color: 'bg-rose-400 text-white' },
  { id: 'b-5', char: 'هـ', x: 50, y: 45, color: 'bg-cyan-400 text-slate-950' },
];

export default function MotorEuphoniaView({ profile, onSendMessage }: MotorEuphoniaViewProps) {
  const getInitialMotorLang = (): 'ar' | 'en' | 'fr' => {
    if (profile.language === 'French') return 'fr';
    if (profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya') return 'ar';
    return 'en';
  };
  const [motorLang, setMotorLang] = useState<'ar' | 'en' | 'fr'>(getInitialMotorLang);

  useEffect(() => {
    setMotorLang(getInitialMotorLang());
  }, [profile.language]);

  const isArabic = motorLang === 'ar';
  const isFrench = motorLang === 'fr';

  const tMotor = (en: string, ar: string, fr?: string) => {
    if (motorLang === 'ar') return ar;
    if (motorLang === 'fr') return fr || localize('French', en, ar);
    return en;
  };

  // Active Category Tab (Includes Eye Keyboard, Studio, Smart Room, Sensory, AI Class, Custom Bank & Eye Games)
  const [activeTab, setActiveTab] = useState<
    'keyboard' | 'euphonia-studio' | 'smart-room' | 'pain-sensory' | 'class-ai' | 'custom-bank' | 'eye-games'
  >('keyboard');

  // Flexible UI Layout Mode: 'docked' (Sidebar on Left) | 'floating' (Full Width Keyboard with Floating Mini PIP) | 'hidden' (100% Full Width Focused)
  // Default changed from 'floating' to 'docked': floating mode is a `position:
  // fixed` panel with no reserved space in the page layout, so it used to sit
  // ON TOP of the main content by default — for a dwell/gaze-clicking user,
  // any target that happened to be under it was literally unreachable, and
  // sighted users saw text clipped behind it (e.g. tab labels cut off).
  // 'floating' is still available as an opt-in via the toggle below for users
  // who want the extra width and don't mind a floating camera.
  const [sidebarMode, setSidebarMode] = useState<'docked' | 'floating' | 'hidden'>('docked');
  const [cameraCorner, setCameraCorner] = useState<'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'minimized'>('top-right');
  const [showQuickNeedsRow, setShowQuickNeedsRow] = useState(true);

  // Theme state
  const [theme, setTheme] = useState<ColorTheme>('amber');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Previously isFullscreen was only ever set optimistically inside
  // toggleFullScreenMode() — never corrected against reality. Exiting via
  // the OS/Escape key (not this screen's own button) left it stuck true
  // forever: wrong icon, and any layout that branches on isFullscreen
  // staying wrong until the user happened to press the button twice.
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Tracking states
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isAudioEngineActive, setIsAudioEngineActive] = useState(false);
  const [cursorPos, setCursorPos] = useState<PointerPosition>({
    x: typeof window !== 'undefined' ? window.innerWidth / 2 : 400,
    y: typeof window !== 'undefined' ? window.innerHeight / 2 : 300,
    normalizedX: 0.5,
    normalizedY: 0.5,
  });
  const [dwellProgress, setDwellProgress] = useState(0);
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  // LIVE REFS for the tracker callbacks.
  //
  // FacialHeadTracker.start() receives its callbacks ONCE and keeps them for the
  // whole session, so anything they close over is frozen at that render. That is
  // why dwelling on Speak / Ask AI / WhatsApp did nothing and blink-to-click
  // never fired: handleCardTrigger was a stale copy and hoveredCardId was stuck
  // at its initial null. Mouse clicks went through a different path, which is
  // why desktop testing never caught it. These refs are re-pointed on every
  // render, and the callbacks read `.current` instead of the captured value.
  const cameraBusyRef = useRef(false); // in-flight guard for startCamera()
  const mountedRef = useRef(true);     // guards async callbacks after unmount
  const pendingTimersRef = useRef<any[]>([]); // every timer, cleared on unmount
  const calibAbortRef = useRef(0);            // generation id for the calibration chain
  const sharedAudioCtxRef = useRef<AudioContext | null>(null); // one context for all cues
  const [showCenterDot, setShowCenterDot] = useState(false); // "look at centre" recenter
  /** setTimeout that is cancelled automatically when the view unmounts. */
  const trackedTimeout = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      pendingTimersRef.current = pendingTimersRef.current.filter((t) => t !== id);
      if (mountedRef.current) fn();
    }, ms);
    pendingTimersRef.current.push(id);
    return id;
  };
  const hoveredCardIdRef = useRef<string | null>(null);
  const handleCardTriggerRef = useRef<(id: string) => void>(() => {});
  const checkHoverTargetRef = useRef<(pos: PointerPosition) => void>(() => {});
  const handleVocalTriggerRef = useRef<(t: VocalSoundTriggerConfig) => void>(() => {});

  // Auto-scan runtime state. `scanActive` is whether the scan is currently
  // moving; headConfig.autoScanEnabled is the persisted setting.
  const [scanActive, setScanActive] = useState(false);
  const [scanTickCount, setScanTickCount] = useState(0);         // re-render so the UI follows
  const scanActiveRef = useRef(false);
  const scanRowsRef = useRef<string[][]>([]);
  const scanPhaseRef = useRef<'row' | 'item'>('row');
  const scanRowIdxRef = useRef(0);
  const scanItemIdxRef = useRef(0);
  const scanPassesRef = useRef(0);
  const scanTimerRef = useRef<number | null>(null);
  const scanSwitchRef = useRef<() => void>(() => {});
  const scanLastSwitchRef = useRef(0);
  const headConfigRef = useRef<HeadTrackingConfig>(DEFAULT_HEAD_TRACKING_CONFIG);
  const scanBlockedRef = useRef(false);
  const scanApiRef = useRef<{ start: () => void; stop: (e?: boolean) => void; resync: () => void }>({
    start: () => {}, stop: () => {}, resync: () => {},
  });
  /** What the scan is currently highlighting, so it can be re-applied after any
   *  React render that would otherwise wipe the class off. */
  const scanPaintedRef = useRef<{ ids: string[]; cls: string }>({ ids: [], cls: SCAN_HL });
  const [gestureState, setGestureState] = useState<FacialGestureState>({
    isSmiling: false,
    isMouthOpen: false,
    isEyebrowRaised: false,
    isBlinking: false,
    confidence: 0,
  });

  // 9-Point Medical Eye Calibration state
  const [showCalibrationModal, setShowCalibrationModal] = useState(false);
  const [calibrationPointIndex, setCalibrationPointIndex] = useState(0);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibAccuracy, setCalibAccuracy] = useState<number | null>(null);
  // Whether the LAST calibration attempt actually produced a usable mapping.
  // The end-of-calibration panel used to show a green tick and "99.4%" no matter
  // what — including directly above a red "calibration failed" toast and a
  // "Calibration accuracy: 0%" readout.
  const [calibSucceeded, setCalibSucceeded] = useState<boolean | null>(null);

  // Google Project Euphonia 100-Phrase Bank & Model Training State
  const [euphoniaPhraseBank, setEuphoniaPhraseBank] = useState<EuphoniaPhraseDef[]>([]);
  const [euphoniaTrainingState, setEuphoniaTrainingState] = useState<Record<string, number>>({});
  const [euphoniaCategoryFilter, setEuphoniaCategoryFilter] = useState<string>('all');
  const [recordingPhraseId, setRecordingPhraseId] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [isEuphoniaLiveListening, setIsEuphoniaLiveListening] = useState(false);
  const [euphoniaMatchedPhrase, setEuphoniaMatchedPhrase] = useState<string | null>(null);
  const [euphoniaMatchSource, setEuphoniaMatchSource] = useState<'custom-model' | 'browser-fallback' | null>(null);
  const [euphoniaApiUrlInput, setEuphoniaApiUrlInput] = useState(() => getEuphoniaApiUrl());
  // The SAVED url, separate from the draft text above. The storage-adapter
  // effect used to key on the draft while reading the persisted value, so
  // pressing "Save & Test" never re-ran it: the toast said "Connected to your
  // custom model" while every sample kept going to local IndexedDB, silently,
  // until someone went looking for the training data.
  const [euphoniaApiUrl, setEuphoniaApiUrlState] = useState(() => getEuphoniaApiUrl());
  const [euphoniaApiHealthy, setEuphoniaApiHealthy] = useState<boolean | null>(null);
  const [isExportingSamples, setIsExportingSamples] = useState(false);

  // Storage adapter: REST if an API URL is configured, otherwise local
  // IndexedDB so recording still works fully offline / pre-backend.
  // Module-level default so the ref stays non-null (this project has
  // strictNullChecks off, so a nullable ref would not be type-checked at its
  // call sites) while avoiding the per-render construction the previous
  // `useRef(new LocalIndexedDbStorageAdapter())` did on every single render.
  const storageAdapterRef = useRef<EuphoniaStorageAdapter>(DEFAULT_LOCAL_ADAPTER);

  useEffect(() => {
    storageAdapterRef.current = euphoniaApiUrl
      ? new RestUploadStorageAdapter(euphoniaApiUrl)
      : new LocalIndexedDbStorageAdapter();
  }, [euphoniaApiUrl]);

  // Load the 100-phrase bank once on mount.
  useEffect(() => {
    loadEuphoniaPhraseBank().then(async (bank) => {
      setEuphoniaPhraseBank(bank);
      const counts: Record<string, number> = {};
      for (const p of bank) {
        try {
          counts[p.id] = await storageAdapterRef.current.countForPhrase(p.id);
        } catch {
          counts[p.id] = 0;
        }
      }
      setEuphoniaTrainingState(counts);
    });
  }, []);

  // One-time check: warn early if this device has no Arabic voice installed
  useEffect(() => {
    const t = setTimeout(() => {
      if (isArabic && !hasArabicVoice()) {
        toast.error(
          isArabic
            ? '⚠️ لا يوجد صوت عربي مثبت على هذا الجهاز — النطق الصوتي لن يعمل. ثبّت حزمة لغة عربية من إعدادات النظام.'
            : '⚠️ No Arabic voice found on this device — speech output will not work.'
        );
      }
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Eye Game State
  const [gameScore, setGameScore] = useState(0);
  const [gamePoppedIds, setGamePoppedIds] = useState<string[]>([]);
  const [reactionBenchmarkMs, setReactionBenchmarkMs] = useState<number | null>(null);
  const reactionStartTimeRef = useRef<number>(Date.now());
  const reactionSamplesRef = useRef<number[]>([]); // per-bubble times, averaged

  // Audio metrics
  const [audioMetrics, setAudioMetrics] = useState<LiveAudioMetrics>({
    volume: 0,
    peakFrequency: 0,
    isTriggering: false,
  });
  // Was read-only: nothing ever called setTriggers, so every student got the
  // same fixed pitches. Now editable, calibrated from the student's own voice,
  // and synced to their profile.
  const [triggers, setTriggers] = useState<VocalSoundTriggerConfig[]>(
    () => mergeTriggers(profile?.vocalTriggers) || loadVocalTriggers(),
  );
  const [capturingTriggerId, setCapturingTriggerId] = useState<string | null>(null);
  const audioMetricsRef = useRef<LiveAudioMetrics | null>(null);
  const vocalSyncTimerRef = useRef<number | null>(null);
  const vocalSyncPendingRef = useRef<VocalSoundTriggerConfig[] | null>(null);
  const flushVocalRef = useRef<() => void>(() => {});
  /** Current triggers, so the calibration routine — which awaits ~2.6s of audio
   *  before writing — cannot save a list captured before that wait. */
  const triggersRef = useRef<VocalSoundTriggerConfig[]>([]);

  // Settings
  const [headConfig, setHeadConfig] = useState<HeadTrackingConfig>(() => {
    // Order matters: the synced profile wins, then the local cache, then the
    // defaults. Everything is spread over DEFAULT_HEAD_TRACKING_CONFIG so a
    // config saved by an older build still picks up keys added since (a stored
    // object missing autoScanMode would otherwise leave it undefined forever).
    try {
      if (profile?.headTrackingConfig) {
        return { ...DEFAULT_HEAD_TRACKING_CONFIG, ...profile.headTrackingConfig };
      }
      const saved = localStorage.getItem('cognify_head_config');
      return saved
        ? { ...DEFAULT_HEAD_TRACKING_CONFIG, ...JSON.parse(saved) }
        : DEFAULT_HEAD_TRACKING_CONFIG;
    } catch {
      return DEFAULT_HEAD_TRACKING_CONFIG;
    }
  });
  /** Pending cloud write, so a slider drag is not one Firestore write per pixel. */
  const headSyncTimerRef = useRef<number | null>(null);
  const headSyncPendingRef = useRef<HeadTrackingConfig | null>(null);
  const flushHeadConfigRef = useRef<() => void>(() => {});

  // Custom Phrase Bank
  const [customPhrases, setCustomPhrases] = useState(() => {
    try {
      const saved = localStorage.getItem('cognify_custom_phrases');
      return saved ? JSON.parse(saved) : DEFAULT_CUSTOM_PHRASES;
    } catch {
      return DEFAULT_CUSTOM_PHRASES;
    }
  });
  const [newPhraseInput, setNewPhraseInput] = useState('');

  // Eye-Gaze Arabic Virtual Keyboard State
  const [typedText, setTypedText] = useState('');
  const [kbLang, setKbLang] = useState<'ar' | 'en'>('ar');
  const [suggestedWords, setSuggestedWords] = useState<string[]>([
    'أنا بخير شكراً', 'أحتاج مساعدة عاجلة', 'أريد شرب ماء', 'شكراً جزيلاً', 'ماما تعالي', 'دكتور احتاجك'
  ]);

  // Smart Room status simulations
  const [roomLightOn, setRoomLightOn] = useState(false);
  const [roomTvOn, setRoomTvOn] = useState(false);
  const [roomAcOn, setRoomAcOn] = useState(false);

  // AI Class / Teacher Live Listener State
  const [isListeningToTeacher, setIsListeningToTeacher] = useState(false);
  const [teacherHeardSpeech, setTeacherHeardSpeech] = useState('');
  const [aiGeneratedClassOptions, setAiGeneratedClassOptions] = useState<string[]>([
    'نعم، فهمت هذا الجزء تماماً.',
    'ممكن إعادة شرح النقطة الأخيرة بمثال؟',
    'أنا جاهز للإجابة عن السؤال.',
    'عندي استفسار عن التطبيق العملي.'
  ]);

  // Mobile Contacts & WhatsApp Modals
  const [contacts, setContacts] = useState<EmergencyContact[]>(loadContacts);
  const [showContactPickerModal, setShowContactPickerModal] = useState(false);
  // Editable phone-number setup — a real number was previously impossible to
  // enter anywhere in the app (see contacts.ts). A caregiver/parent typically
  // does this one-time setup, so it's a plain form, not gaze/blink-driven.
  const [showManageContactsModal, setShowManageContactsModal] = useState(false);
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [selectedContactForWa, setSelectedContactForWa] = useState<EmergencyContact | null>(null);
  const [customWaMessage, setCustomWaMessage] = useState('');
  const [isListeningForContactName, setIsListeningForContactName] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);

  // Debounce lock for phone calls
  const isDialingRef = useRef(false);

  // Dysarthric Speech AI decoding
  const [isRecordingSpeech, setIsRecordingSpeech] = useState(false);
  const [speechTranscript, setSpeechTranscript] = useState('');
  const [aiResponseText, setAiResponseText] = useState('');
  const [isProcessingAi, setIsProcessingAi] = useState(false);

  // Mouse Dwell simulation for testing without camera
  const mouseDwellStartRef = useRef<number>(0);
  const mouseHoverTargetRef = useRef<string | null>(null);

  // Scientific Eye-Tracking Architecture Modal State
  const [showScientificArchitectureModal, setShowScientificArchitectureModal] = useState(false);
  const [eyeLiveMetrics, setEyeLiveMetrics] = useState<any>(null);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const trackerRef = useRef<FacialHeadTracker | null>(null);
  const voiceContactRecRef = useRef<any>(null);
  const teacherRecRef = useRef<any>(null);

  // Keep the magnetic-snap cache in sync with the visible tab
  useEffect(() => {
    const t = setTimeout(() => trackerRef.current?.refreshSnapTargetsCache(), 60);
    return () => clearTimeout(t);
  }, [activeTab]);

  /**
   * Central speech helper: every place in this view that should say something
   * out loud goes through here instead of calling speak() directly. This is
   * what surfaces a toast when a phrase silently fails to speak (no Arabic
   * voice installed, speechSynthesis blocked outside a user gesture, etc.)
   * instead of the card just doing nothing.
   */
  const speakSafe = (text: string, overrideLang?: string) => {
    if (!text?.trim()) return;
    const voiceLang = overrideLang || (motorLang === 'ar' ? (profile.language || 'Egyptian Ammiya') : 'English');
    speak(text, voiceLang, {
      onError: (reason) => {
        const msg =
          reason === 'unsupported'
            ? (isArabic ? '⚠️ المتصفح لا يدعم النطق الصوتي' : '⚠️ This browser does not support speech output')
            : reason === 'silent-fail'
            ? (isArabic
                ? '⚠️ تعذر نطق الجملة. تأكد من وجود صوت عربي مثبت على الجهاز وأن الصوت غير مكتوم'
                : '⚠️ Could not speak. Check that an English or Arabic voice is installed and the device is not muted')
            : (isArabic ? '⚠️ حدث خطأ أثناء النطق الصوتي' : '⚠️ Speech output error');
        toast.error(msg);
      },
    });
  };

  /**
   * ONE shared AudioContext for every cue.
   *
   * Each helper used to do `new AudioContext()` per sound and never close it.
   * Browsers cap the number of live contexts, so after a session of clicks,
   * alarms and calibrations creation started failing silently: no click
   * confirmation on selection, and the nurse-call alarm played nothing — the
   * student got no confirmation their emergency call had registered.
   */
  const getAudioCtx = (): AudioContext | null => {
    try {
      // After unmount the shared context has already been closed. Creating a
      // fresh one here (a recording still finishing, a queued cue) leaked a
      // context that nothing would ever close, and enough of those hit the
      // browser's live-context cap — after which no audio cue plays at all,
      // including the nurse-call alarm.
      if (!mountedRef.current) return null;
      if (!sharedAudioCtxRef.current) {
        const C = window.AudioContext || (window as any).webkitAudioContext;
        if (!C) return null;
        sharedAudioCtxRef.current = new C();
      }
      const ctx = sharedAudioCtxRef.current;
      // Autoplay policy can leave it suspended until a gesture.
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    } catch {
      return null;
    }
  };

  // Audio click sound for eye-blink confirmation
  const playBlinkClickSound = () => {
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.09);
    } catch {
      /* ignore */
    }
  };

  // Pop Bubble Sound Effect
  const playPopSound = () => {
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch {
      /* ignore */
    }
  };

  // High-priority Nurse Alarm Sound
  const playNurseAlarmSound = () => {
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const now = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(1200, now + i * 0.25);
        osc.frequency.setValueAtTime(900, now + i * 0.25 + 0.12);
        gain.gain.setValueAtTime(0.4, now + i * 0.25);
        gain.gain.linearRampToValueAtTime(0.01, now + i * 0.25 + 0.24);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.25);
        osc.stop(now + i * 0.25 + 0.25);
      }
    } catch {
      /* ignore */
    }
  };

  // Toggle Browser Fullscreen
  const toggleFullScreenMode = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Auto-start camera when view mounts.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isCameraActive && videoRef.current) {
        toggleCamera();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // Unlock speech synthesis on the first REAL user gesture.
  //
  // toggleCamera() calls unlockSpeechSynthesis(), but the auto-start above fires
  // it from a timer rather than a gesture, so the browser's autoplay policy
  // refuses the unlock and the FIRST phrase the student speaks is silently
  // dropped — the card highlights and the toast claims it was spoken, but
  // nothing comes out. Any genuine interaction repairs it.
  useEffect(() => {
    let done = false;
    const unlock = () => {
      if (done) return;
      done = true;
      try { unlockSpeechSynthesis(); } catch { /* ignore */ }
      remove();
    };
    const events: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'touchstart'];
    const remove = () => events.forEach((e) => document.removeEventListener(e, unlock));
    events.forEach((e) => document.addEventListener(e, unlock, { once: true, passive: true }));
    return remove;
  }, []);

  // Mouse movement fallback listener
  useEffect(() => {
    if (isCameraActive) return;

    let dwellInterval: any = null;

    const handleMouseMove = (e: MouseEvent) => {
      const pos = {
        x: e.clientX,
        y: e.clientY,
        normalizedX: e.clientX / window.innerWidth,
        normalizedY: e.clientY / window.innerHeight,
      };
      setCursorPos(pos);
      checkHoverTarget(pos);
    };

    dwellInterval = setInterval(() => {
      if (mouseHoverTargetRef.current && mouseDwellStartRef.current > 0) {
        const elapsed = Date.now() - mouseDwellStartRef.current;
        const prog = Math.min(1, elapsed / headConfig.dwellTimeMs);
        setDwellProgress(prog);

        if (prog >= 1) {
          const target = mouseHoverTargetRef.current;
          mouseHoverTargetRef.current = null;
          mouseDwellStartRef.current = 0;
          setDwellProgress(0);
          handleCardTrigger(target);
        }
      } else {
        setDwellProgress(0);
      }
    }, 50);

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (dwellInterval) clearInterval(dwellInterval);
    };
  }, [isCameraActive, headConfig.dwellTimeMs]);

  // Update word autocomplete suggestions when typedText changes
  useEffect(() => {
    const lastWord = typedText.trim().split(/\s+/).pop()?.toLowerCase() || '';
    if (!lastWord) {
      setSuggestedWords(
        kbLang === 'ar'
          ? ['أنا بخير شكراً', 'أحتاج مساعدة عاجلة', 'أريد شرب ماء', 'شكراً جزيلاً', 'ماما تعالي', 'دكتور احتاجك']
          : ['I need help', 'Thank you', 'Please help', 'Water please', 'Call caregiver']
      );
      return;
    }

    const dict = kbLang === 'ar' ? AR_PREDICTIONS : EN_PREDICTIONS;
    const matchedKey = Object.keys(dict).find((k) => lastWord.startsWith(k));
    if (matchedKey) {
      setSuggestedWords(dict[matchedKey]);
    } else {
      setSuggestedWords([]);
    }
  }, [typedText, kbLang]);

  // Save head tracking config
  const updateHeadConfig = (newCfg: Partial<HeadTrackingConfig>) => {
    const updated = { ...headConfig, ...newCfg };
    setHeadConfig(updated);
    trackerRef.current?.updateConfig(updated);
    // Local first: it is instant, and it keeps the tuning working offline and
    // through a failed network write.
    try {
      localStorage.setItem('cognify_head_config', JSON.stringify(updated));
    } catch {
      /* ignore */
    }
    // Then the cloud, debounced. The sensitivity and scan-speed sliders fire on
    // every drag step, which would otherwise be a Firestore write per pixel.
    headSyncPendingRef.current = updated;
    if (headSyncTimerRef.current !== null) clearTimeout(headSyncTimerRef.current);
    headSyncTimerRef.current = window.setTimeout(() => {
      headSyncTimerRef.current = null;
      flushHeadConfigSync();
    }, 1000);
  };

  /** Change one vocal trigger: live engine, local cache, then the profile. */
  const updateTrigger = (id: string, patch: Partial<VocalSoundTriggerConfig>) => {
    const base = triggersRef.current.length ? triggersRef.current : triggers;
    const updated = base.map((t) => (t.id === id ? { ...t, ...patch } : t));
    setTriggers(updated);
    // setTriggers on the engine also writes localStorage, and takes effect on
    // the running mic immediately — no restart needed mid-calibration.
    vocalSoundEngine.setTriggers(updated);
    vocalSyncPendingRef.current = updated;
    if (vocalSyncTimerRef.current !== null) clearTimeout(vocalSyncTimerRef.current);
    vocalSyncTimerRef.current = window.setTimeout(() => {
      vocalSyncTimerRef.current = null;
      flushVocalSync();
    }, 1000);
  };

  const flushVocalSync = () => {
    const pending = vocalSyncPendingRef.current;
    if (!pending || !profile?.uid) return;
    vocalSyncPendingRef.current = null;
    setDoc(
      doc(db, `users/${profile.uid}`),
      cleanDataForFirestore({ vocalTriggers: pending }),
      { merge: true },
    ).catch(() => { /* local cache still holds it; the next change retries */ });
  };

  /**
   * Tune a trigger to the sound the student can actually make.
   *
   * Asking a caregiver to pick a frequency in Hz is not a real option, and the
   * shipped defaults (220 / 750 / 1600 Hz) only fire for a voice that happens to
   * land there — a quiet breathy hum at 140Hz matched nothing at all. This
   * listens to the student instead and takes the median of what it hears.
   */
  const captureVocalTrigger = async (id: string) => {
    if (!isAudioEngineActive) {
      toast.error(
        isArabic
          ? 'شغّل «أصوات إيفونيا» الأول علشان الميكروفون يشتغل'
          : 'Turn on Vocal Sounds first so the microphone is live'
      );
      return;
    }
    setCapturingTriggerId(id);
    toast.info(isArabic ? 'اعمل صوتك دلوقتي واستمر...' : 'Make your sound now and hold it...');

    const samples: { f: number; v: number }[] = [];
    await new Promise<void>((resolve) => {
      const t0 = Date.now();
      const iv = window.setInterval(() => {
        const m = audioMetricsRef.current;
        // Ignore silence and sub-vocal rumble; we want the held tone only.
        if (m && m.volume > 0.03 && m.peakFrequency > 60) samples.push({ f: m.peakFrequency, v: m.volume });
        if (Date.now() - t0 > 2600 || !mountedRef.current) { clearInterval(iv); resolve(); }
      }, 50);
    });
    if (!mountedRef.current) return;
    setCapturingTriggerId(null);

    if (samples.length < 6) {
      toast.error(
        isArabic ? 'مسمعتش صوت واضح — قرّب من الميكروفون وجرّب تاني' : 'No clear sound heard — move closer and try again'
      );
      return;
    }
    const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const f = Math.round(med(samples.map((x) => x.f)));
    const v = med(samples.map((x) => x.v));
    updateTrigger(id, {
      targetFrequencyHz: f,
      // Sit under what they actually produced, so an ordinary effort still fires
      // rather than demanding their loudest possible sound every time.
      minEnergyThreshold: Math.min(0.2, Math.max(0.02, Number((v * 0.6).toFixed(3)))),
    });
    toast.success(isArabic ? `تم الضبط على ${f} هرتز` : `Tuned to ${f} Hz`);
  };

  /** Push the pending config to the student's profile. Safe to call after
   *  unmount: it touches no React state. */
  const flushHeadConfigSync = () => {
    const pending = headSyncPendingRef.current;
    if (!pending || !profile?.uid) return;
    headSyncPendingRef.current = null;
    setDoc(
      doc(db, `users/${profile.uid}`),
      cleanDataForFirestore({ headTrackingConfig: pending }),
      { merge: true },
    ).catch(() => {
      // Offline or rules rejected it — localStorage still holds the tuning, so
      // this device keeps working and the next change retries.
    });
  };

  // Start / Stop Camera Tracking
  const toggleCamera = async () => {
    unlockSpeechSynthesis();

    if (isCameraActive) {
      trackerRef.current?.stop();
      trackerRef.current = null;
      setIsCameraActive(false);
      return;
    }

    if (!videoRef.current) return;
    // Re-entrancy guard: the on-screen button and the auto-start effect could
    // both fire (isCameraActive is only set AFTER getUserMedia resolves), which
    // built two trackers. The second overwrote trackerRef, so "Stop Camera"
    // could only ever stop one — the other kept the webcam LED on and a second
    // FaceMesh running at 60fps, fighting over the cursor.
    if (cameraBusyRef.current) return;
    cameraBusyRef.current = true;
    try { trackerRef.current?.stop(); } catch { /* nothing running */ }

    const tracker = new FacialHeadTracker(headConfig);
    trackerRef.current = tracker;

    const ok = await tracker.start(
      videoRef.current,
      {
        onPointerMove: (pos, prog) => {
          setCursorPos(pos);
          setDwellProgress(prog);
          checkHoverTargetRef.current(pos);
        },
        onDwellComplete: (targetId) => {
          // The tracker sets its own hover target from magnetic snapping, so
          // guarding checkHoverTarget alone is not enough to keep dwell from
          // firing underneath an active scan.
          if (scanActiveRef.current) return;
          handleCardTriggerRef.current(targetId);
        },
        onGesture: (gesture) => {
          setGestureState(gesture);
          if (gesture.metrics) {
            setEyeLiveMetrics(gesture.metrics);
          }
          const hovered = hoveredCardIdRef.current;
          // While scanning, every gesture is just "press the switch".
          if (scanActiveRef.current) {
            if (gesture.isBlinking || gesture.isSmiling) scanSwitchRef.current();
            return;
          }
          if (gesture.isBlinking) {
            if (hovered) {
              playBlinkClickSound();
              // Tell the tracker this target has just fired. Without it the
              // dwell timer kept running underneath and fired the SAME key
              // again ~1.4s later if the student paused on it: "سس" for "س".
              trackerRef.current?.notifyExternalTrigger(hovered);
              handleCardTriggerRef.current(hovered);
            }
          } else if (gesture.isSmiling) {
            if (hovered) {
              trackerRef.current?.notifyExternalTrigger(hovered);
              handleCardTriggerRef.current(hovered);
            }
          }
        },
        onCalibrationStatus: (status) => {
          setCalibAccuracy(status.accuracyEstimate);
        },
        onError: (code) => {
          // Face tracking could not load. Say so and shut the camera off rather
          // than leaving a live camera with a pointer that never moves.
          if (!mountedRef.current) return;
          toast.error(
            isArabic
              ? 'تعذّر تحميل محرك تتبّع الوجه. راجع الاتصال بالإنترنت وحاول تاني.'
              : 'Face-tracking engine failed to load. Check the connection and try again.',
            isArabic ? 'تتبّع العين غير متاح' : 'Eye tracking unavailable',
          );
          console.error('[MotorEuphonia] face mesh:', code);
          try { trackerRef.current?.stop(); } catch { /* ignore */ }
          trackerRef.current = null;
          setIsCameraActive(false);
        },
      },
      overlayCanvasRef.current
    );

    cameraBusyRef.current = false;

    // Left the Motor screen while the webcam was still opening. Don't toast onto
    // whatever screen they are on now — and, more importantly, don't leave a
    // camera running for a view that no longer exists.
    if (!mountedRef.current) {
      try { trackerRef.current?.stop(); } catch { /* ignore */ }
      trackerRef.current = null;
      return;
    }

    if (ok) {
      setIsCameraActive(true);
      toast.success(isArabic ? 'تم تفعيل تتبع العين - انظر للحرف وأغمض عينك لكتابته' : 'Eye-Gaze active - look and blink to type');
    } else {
      // start() released the stream itself; make sure no half-built tracker
      // is left behind holding a camera.
      try { trackerRef.current?.stop(); } catch { /* ignore */ }
      trackerRef.current = null;
      toast.error(
        isArabic
          ? 'تعذر تشغيل تتبع العين. يمكنك المتابعة باستخدام الصوت أو لوحة المفاتيح.'
          : "Eye tracking isn't available. You can continue using voice or keyboard."
      );
    }
  };

  /**
   * Free the microphone for a SpeechRecognition session, and give back a
   * function that restores it.
   *
   * The vocal-sound engine holds its own exclusive getUserMedia stream, and on
   * several browsers a second concurrent mic consumer then fails to start —
   * "No microphone available, or it is in use by another feature", or nothing
   * at all. Only the atypical-speech path released it; "Listen to Teacher" and
   * "Speak Name" did not.
   *
   * Restoring matters as much as releasing: for a student who cannot blink
   * reliably the vocal engine IS their click, so a recognition session that
   * silently left it off took away their only way to select anything.
   */
  const releaseMicForRecognition = (): (() => void) => {
    if (!isAudioEngineActive) return () => {};
    vocalSoundEngine.stop();
    setIsAudioEngineActive(false);
    return () => {
      if (!mountedRef.current) return;
      vocalSoundEngine
        .start((t) => handleVocalTriggerRef.current(t), (m) => { audioMetricsRef.current = m; setAudioMetrics(m); })
        .then((ok) => { if (ok && mountedRef.current) setIsAudioEngineActive(true); })
        .catch(() => { /* the student can switch it back on by hand */ });
    };
  };

  /**
   * Get the recorded training set out of the browser.
   *
   * With no custom-model URL configured (the default), every clip goes to local
   * IndexedDB. The Studio counts them up to "3/3 complete" and tells the student
   * to train a personalized model on their data — while that data had no way
   * out of the browser profile that recorded it.
   */
  const exportEuphoniaTrainingData = async () => {
    const adapter = storageAdapterRef.current as any;
    if (typeof adapter?.exportAllAsZipEntries !== 'function') {
      toast.info(
        isArabic
          ? 'التسجيلات محفوظة على الخادم المخصص، حمّلها من هناك'
          : 'Samples are stored on your custom model server — download them there'
      );
      return;
    }
    setIsExportingSamples(true);
    try {
      const raw: { key: string; blob: Blob }[] = await adapter.exportAllAsZipEntries();
      if (!raw.length) {
        toast.error(isArabic ? 'لا توجد تسجيلات محفوظة بعد' : 'No recorded samples yet');
        return;
      }
      // Keys are `${phraseId}__${timestamp}` — split on the LAST separator, so
      // a phrase id that itself contains "__" is not truncated.
      const phraseIdOf = (key: string) => {
        const cut = String(key).lastIndexOf('__');
        return (cut > 0 ? String(key).slice(0, cut) : String(key)) || 'unknown';
      };
      // Ids reach the archive as folder names, so strip anything a path cannot
      // carry rather than emitting an entry no unzip tool will extract.
      const safe = (v: string) => v.replace(/[^\w؀-ۿ.-]+/g, '_').slice(0, 60) || 'unknown';

      // Group by phrase so the folder layout is what a training pipeline wants.
      const seen: Record<string, number> = {};
      const entries = raw.map(({ key, blob }) => {
        const phraseId = phraseIdOf(key);
        seen[phraseId] = (seen[phraseId] || 0) + 1;
        const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'mp4' : 'webm';
        return { name: `${safe(phraseId)}/take-${seen[phraseId]}.${ext}`, blob };
      });
      // A manifest, so whoever trains the model knows what each clip says.
      const manifest = raw.map(({ key }, i) => ({
        file: entries[i].name,
        key,
        phraseId: phraseIdOf(key),
        phraseText: euphoniaPhraseBank.find((ph) => ph.id === phraseIdOf(key))?.text || '',
      }));
      entries.push({
        name: 'manifest.json',
        blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
      });

      const zip = await createZip(entries);
      downloadBlob(zip, `cognify-euphonia-training-${raw.length}-samples.zip`);
      toast.success(
        isArabic ? `تم تصدير ${raw.length} تسجيل` : `Exported ${raw.length} samples`
      );
    } catch (err) {
      toast.error(isArabic ? 'تعذّر تصدير التسجيلات' : 'Could not export the samples');
    } finally {
      if (mountedRef.current) setIsExportingSamples(false);
    }
  };

  // Start / Stop Euphonia Vocal Sound Engine
  const toggleAudioEngine = async () => {
    if (isAudioEngineActive) {
      vocalSoundEngine.stop();
      setIsAudioEngineActive(false);
      return;
    }

    const ok = await vocalSoundEngine.start(
      (trig) => {
        handleVocalTriggerRef.current(trig);
      },
      (metrics) => {
        if (!mountedRef.current) return;
        audioMetricsRef.current = metrics;
        setAudioMetrics(metrics);
      }
    );

    if (!mountedRef.current) return;
    if (ok) {
      setIsAudioEngineActive(true);
      toast.success(isArabic ? 'تم تفعيل معالج إيفونيا للأصوات الصوتية' : 'Euphonia vocal sound trigger active');
    } else {
      toast.error(isArabic ? 'تعذر الوصول إلى الميكروفون' : 'Could not access microphone');
    }
  };

  // Google Project Euphonia: Record Sample for Phrase with MediaRecorder
  const recordEuphoniaSample = (phrase: EuphoniaPhraseDef) => {
    if (euphoniaRecorder.isRecording()) return;

    setRecordingPhraseId(phrase.id);
    toast.info(isArabic ? 'سجّل الآن بنبرتك الطبيعية...' : 'Recording now...');

    euphoniaRecorder.start(phrase.id, phrase.text, {
      onLevel: (rms) => { if (mountedRef.current) setMicLevel(rms); },
      onError: (err) => {
        console.error(err);
        if (!mountedRef.current) return;
        setRecordingPhraseId(null);
        toast.error(isArabic ? 'تعذر الوصول إلى الميكروفون' : 'Could not access microphone');
      },
      onStop: async (sample: EuphoniaAudioSample) => {
        if (!mountedRef.current) return;
        setRecordingPhraseId(null);
        setMicLevel(0);

        if (sample.durationMs < 400) {
          toast.error(isArabic ? 'التسجيل قصير جداً، حاول مرة أخرى' : 'Recording too short, try again');
          return;
        }

        try {
          await storageAdapterRef.current.upload(sample);
          if (!mountedRef.current) return;
          setEuphoniaTrainingState((prev) => ({
            ...prev,
            [phrase.id]: (prev[phrase.id] || 0) + 1,
          }));
          playBlinkClickSound();
          toast.success(isArabic ? '✅ تم حفظ العينة الصوتية بنجاح' : 'Sample saved');
        } catch (err) {
          console.error(err);
          if (mountedRef.current) toast.error(isArabic ? 'فشل حفظ العينة الصوتية' : 'Failed to save sample');
        }
      },
    });
  };

  // Google Project Euphonia: Live Listener using Personalized Model + Browser Fallback
  const toggleEuphoniaLiveListener = async () => {
    if (isEuphoniaLiveListening) {
      euphoniaRecorder.stop();
      setIsEuphoniaLiveListening(false);
      return;
    }

    setIsEuphoniaLiveListening(true);
    setEuphoniaMatchedPhrase(null);
    toast.info(isArabic ? 'جاري الاستماع لصوتك...' : 'Listening...');

    euphoniaRecorder.start('live-match', '(live)', {
      onLevel: (rms) => { if (mountedRef.current) setMicLevel(rms); },
      onError: (err) => {
        console.error(err);
        if (!mountedRef.current) return;
        setIsEuphoniaLiveListening(false);
        toast.error(isArabic ? 'تعذر الوصول إلى الميكروفون' : 'Could not access microphone');
      },
      onStop: async (sample: EuphoniaAudioSample) => {
        if (!mountedRef.current) return;
        setIsEuphoniaLiveListening(false);
        setMicLevel(0);

        try {
          const result = await transcribe({
            audioBlob: sample.blob,
            langCode: motorLang === 'fr' ? 'fr-FR' : (profile?.language === 'Egyptian Ammiya' ? 'ar-EG' : isArabic ? 'ar-SA' : 'en-US'),
          });
          if (!mountedRef.current) return;

          setEuphoniaMatchSource(result.source);

          const normalized = result.text.trim();
          const match = euphoniaPhraseBank.find(
            (p) => p.text.includes(normalized) || normalized.includes(p.text)
          );

          const finalText = match ? match.text : normalized;
          setEuphoniaMatchedPhrase(finalText);
          speakSafe(finalText);

          toast.success(
            result.source === 'custom-model'
              ? (isArabic ? `🎯 (نموذجك المخصص): "${finalText}"` : `🎯 (your model): "${finalText}"`)
              : (isArabic ? `🎯 "${finalText}"` : `🎯 "${finalText}"`)
          );
        } catch (err) {
          console.error(err);
          if (mountedRef.current) toast.error(isArabic ? 'تعذر فهم الصوت، حاول مرة أخرى' : 'Could not understand audio, try again');
        }
      },
    });

    trackedTimeout(() => {
      if (euphoniaRecorder.isRecording()) euphoniaRecorder.stop();
    }, 3000);
  };

  // Settings: save + health-check the API URL
  const handleSaveEuphoniaApiUrl = async () => {
    try {
      setEuphoniaApiUrl(euphoniaApiUrlInput);
      setEuphoniaApiUrlState(euphoniaApiUrlInput.trim()); // drives the adapter effect
      toast.info(isArabic ? 'جاري التحقق من الاتصال...' : 'Checking connection...');
      const healthy = await checkEuphoniaApiHealth(euphoniaApiUrlInput);
      if (!mountedRef.current) return;
      setEuphoniaApiHealthy(healthy);
      toast[healthy ? 'success' : 'error'](
        healthy
          ? (isArabic ? '✅ متصل بنموذجك المخصص' : '✅ Connected to your custom model')
          : (isArabic ? '⚠️ تعذر الوصول للخادم — سيتم استخدام المتصفح مؤقتاً' : '⚠️ Unreachable — using browser ASR for now')
      );
    } catch (err) {
      if (mountedRef.current) {
        setEuphoniaApiHealthy(false);
        toast.error(isArabic ? 'خطأ أثناء فحص الرابط' : 'Error checking API endpoint');
      }
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      trackerRef.current?.stop();
      trackerRef.current = null;
      vocalSoundEngine.stop();
      cancelSpeech();
      try { voiceContactRecRef.current?.stop(); } catch { /* ignore */ }
      try { teacherRecRef.current?.stop(); } catch { /* ignore */ }
      // euphoniaRecRef was declared and never assigned, so this stopped nothing
      // and the mic stayed live after leaving the screen. The real recorder is
      // the module-level singleton.
      try { euphoniaRecorder.stop(); } catch { /* ignore */ }
      // Every setTimeout in this view was untracked: a calibration-failure toast
      // could pop up on a later screen ~11s after leaving, and an emergency-call
      // timer could still open a tel: link from wherever the student now was.
      pendingTimersRef.current.forEach((id) => clearTimeout(id));
      pendingTimersRef.current = [];
      try { sharedAudioCtxRef.current?.close(); } catch { /* ignore */ }
      sharedAudioCtxRef.current = null;
    };
  }, []);

  // Check which card, key, or modal item the cursor is hovering over
  const checkHoverTarget = (pos: PointerPosition) => {
    // While auto-scan is driving, the scan owns the hover. Otherwise the gaze
    // pointer yanks the highlight off whatever the scan just landed on.
    if (scanActiveRef.current) return;
    // Was: querySelectorAll + getBoundingClientRect on EVERY element, every
    // frame. That forces a full layout recompute per element ~60x/second, which
    // is the heaviest single cost on the low-end tablets these students use —
    // and it is why the cursor lagged worst exactly when tracking was active.
    // One hit test does the same job.
    const hit = document.elementFromPoint(pos.x, pos.y) as HTMLElement | null;
    const foundId: string | null =
      (hit?.closest('[data-aac-id]') as HTMLElement | null)?.getAttribute('data-aac-id') ?? null;

    if (foundId !== hoveredCardIdRef.current) {
      hoveredCardIdRef.current = foundId;
      setHoveredCardId(foundId);
      if (isCameraActive) {
        trackerRef.current?.setHoverTarget(foundId);
      } else {
        mouseHoverTargetRef.current = foundId;
        mouseDwellStartRef.current = foundId ? Date.now() : 0;
      }
    }
  };

  // ─── Auto-scan engine ─────────────────────────────────────────────────────

  /** Every selectable target on screen, grouped into geometric rows. */
  const collectScanRows = (): string[][] => {
    // A modal can opt in with data-scan-root so the scan stays inside it
    // instead of walking targets buried behind the overlay.
    const root: ParentNode = document.querySelector('[data-scan-root]') || document;
    const items: { id: string; top: number; left: number }[] = [];
    root.querySelectorAll<HTMLElement>('[data-aac-id]').forEach((el) => {
      const id = el.getAttribute('data-aac-id');
      if (!id) return;
      const r = el.getBoundingClientRect();
      // display:none collapses to 0x0. Deliberately NOT filtered on the
      // viewport: an item scrolled out of view is still reachable, because
      // highlighting it scrolls it back in.
      if (r.width < 8 || r.height < 8) return;
      if (getComputedStyle(el).visibility === 'hidden') return;
      items.push({ id, top: r.top, left: r.left });
    });
    if (!items.length) return [];

    if ((headConfigRef.current.autoScanMode || 'row-column') === 'linear') {
      return [items.sort((a, b) => a.top - b.top || a.left - b.left).map((i) => i.id)];
    }

    // Row tolerance scales with the grid actually on screen, so the same code
    // groups a dense keyboard and a page of large phrase cards correctly.
    const tops = items.map((i) => i.top).sort((a, b) => a - b);
    const span = (tops[tops.length - 1] - tops[0]) || 1;
    const tol = Math.max(14, Math.min(60, span / Math.max(4, items.length / 4)));

    const rows: { top: number; items: typeof items }[] = [];
    for (const it of [...items].sort((a, b) => a.top - b.top || a.left - b.left)) {
      const row = rows.find((r) => Math.abs(r.top - it.top) <= tol);
      if (row) row.items.push(it);
      else rows.push({ top: it.top, items: [it] });
    }
    return rows.map((r) => r.items.sort((a, b) => a.left - b.left).map((i) => i.id));
  };

  /**
   * Re-apply whatever the scan is currently highlighting.
   *
   * The class is added imperatively (threading scan state through all 26 render
   * sites would buy nothing), but React owns className on these buttons — so the
   * moment it re-renders one, it rewrites className and the class is gone.
   * Setting the scan hover is itself a state change, which re-renders exactly
   * the element being highlighted: the item highlight was applied and then
   * stripped milliseconds later, every single tick. Row highlighting survived
   * only because those elements' className never changed, which is what made it
   * look like the feature worked.
   */
  const applyScanPaint = (): HTMLElement | null => {
    document.querySelectorAll('.' + SCAN_HL).forEach((e) => e.classList.remove(SCAN_HL));
    document.querySelectorAll('.' + SCAN_HL_ROW).forEach((e) => e.classList.remove(SCAN_HL_ROW));
    const { ids, cls } = scanPaintedRef.current;
    if (!ids.length) return null;
    const wanted = new Set(ids);
    let first: HTMLElement | null = null;
    document.querySelectorAll<HTMLElement>('[data-aac-id]').forEach((el) => {
      const id = el.getAttribute('data-aac-id');
      if (!id || !wanted.has(id)) return;
      el.classList.add(cls);
      if (!first) first = el;
    });
    return first;
  };

  const clearScanPaint = () => {
    scanPaintedRef.current = { ids: [], cls: SCAN_HL };
    applyScanPaint();
  };

  const paintScan = (ids: string[], cls: string) => {
    scanPaintedRef.current = { ids, cls };
    const first = applyScanPaint();
    if (first) first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const setScanHover = (id: string | null) => {
    hoveredCardIdRef.current = id;
    setHoveredCardId(id);
  };

  const enterRowPhase = () => {
    scanPhaseRef.current = 'row';
    scanRowIdxRef.current = -1;
    scanItemIdxRef.current = -1;
    scanPassesRef.current = 0;
    // The switch label is derived from scanPhaseRef, so a phase change that
    // does not force a render leaves the button advertising the wrong action
    // — "Select this" while the scan is actually back to choosing a row.
    setScanTickCount((t) => t + 1);
  };

  const stopScan = (exhausted = false) => {
    if (scanTimerRef.current !== null) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    scanActiveRef.current = false;
    clearScanPaint();
    setScanHover(null);
    setScanActive(false);
    setScanTickCount((t) => t + 1);
    if (exhausted && mountedRef.current) {
      toast.info(
        isArabic
          ? 'تم إيقاف المسح مؤقتًا — اضغط المفتاح لاستئنافه'
          : 'Scanning paused — press the switch to resume'
      );
    }
  };

  const scanAdvance = (depth = 0) => {
    if (!scanActiveRef.current || !mountedRef.current) return;
    // Calibration owns the whole screen and the tracker; scanning underneath it
    // would fight for the pointer. Hold position and pick up afterwards.
    if (scanBlockedRef.current) return;

    let rows = scanRowsRef.current;
    if (!rows.length) {
      rows = collectScanRows();
      scanRowsRef.current = rows;
      enterRowPhase();
      if (!rows.length) return;
    }

    if (scanPhaseRef.current === 'row' && rows.length > 1) {
      scanRowIdxRef.current += 1;
      if (scanRowIdxRef.current >= rows.length) {
        scanPassesRef.current += 1;
        if (scanPassesRef.current >= SCAN_MAX_PASSES) { stopScan(true); return; }
        // Re-snapshot between passes: a tab switch or a scroll may have changed
        // what is on screen since the pass began.
        rows = collectScanRows();
        scanRowsRef.current = rows;
        if (!rows.length) { stopScan(); return; }
        scanRowIdxRef.current = 0;
      }
      // No single card is hovered while choosing a ROW, or a blink here would
      // fire a card instead of picking the row.
      setScanHover(null);
      paintScan(rows[scanRowIdxRef.current] || [], SCAN_HL_ROW);
    } else {
      if (rows.length === 1) scanPhaseRef.current = 'item';
      const row = rows[Math.max(0, scanRowIdxRef.current)] || [];
      if (!row.length) {
        enterRowPhase();
        // Move on in the SAME tick rather than leaving the screen unhighlighted
        // for a full interval. Depth-capped so a pathological layout cannot spin.
        if (depth < 2) scanAdvance(depth + 1);
        return;
      }
      scanItemIdxRef.current += 1;
      if (scanItemIdxRef.current >= row.length) {
        scanItemIdxRef.current = 0;
        scanPassesRef.current += 1;
        if (scanPassesRef.current >= SCAN_MAX_PASSES) {
          // Give up on this row and let them choose a different one.
          if (rows.length > 1) {
            enterRowPhase();
            if (depth < 2) scanAdvance(depth + 1);
            return;
          }
          stopScan(true);
          return;
        }
      }
      const id = row[scanItemIdxRef.current];
      setScanHover(id ?? null);
      paintScan(id ? [id] : [], SCAN_HL);
    }
    setScanTickCount((t) => t + 1);
  };

  /** Self-rescheduling, so a change to the interval slider takes effect at once. */
  const scheduleScan = () => {
    if (scanTimerRef.current !== null) clearTimeout(scanTimerRef.current);
    const ms = Math.max(600, Math.min(5000, headConfigRef.current.autoScanIntervalMs || 1400));
    scanTimerRef.current = window.setTimeout(() => {
      scanAdvance();
      if (scanActiveRef.current) scheduleScan();
    }, ms);
  };

  const startScan = () => {
    const rows = collectScanRows();
    if (!rows.length) return;
    scanRowsRef.current = rows;
    enterRowPhase();
    if (rows.length === 1) scanPhaseRef.current = 'item';
    scanActiveRef.current = true;
    setScanActive(true);
    scanAdvance();      // land on the first target at once, no dead wait
    scheduleScan();
  };

  /** The single action the student makes. Blink, smile, a vocal sound,
   *  Space/Enter, and the on-screen button all arrive here. */
  const scanSwitch = () => {
    const now = Date.now();
    if (now - scanLastSwitchRef.current < SCAN_SWITCH_DEBOUNCE_MS) return;
    scanLastSwitchRef.current = now;

    if (!scanActiveRef.current) { startScan(); return; }   // resume after a pause

    const rows = scanRowsRef.current;
    if (!rows.length) { stopScan(); return; }
    scanPassesRef.current = 0;

    if (scanPhaseRef.current === 'row' && rows.length > 1) {
      scanPhaseRef.current = 'item';
      scanItemIdxRef.current = -1;
      scanAdvance();
      scheduleScan();
      return;
    }

    const id = (rows[Math.max(0, scanRowIdxRef.current)] || [])[scanItemIdxRef.current];
    if (!id) return;
    playBlinkClickSound();
    handleCardTriggerRef.current(id);
    // Activating may switch tabs or open a modal, so rebuild from scratch and
    // go back to choosing a row.
    if (scanTimerRef.current !== null) { clearTimeout(scanTimerRef.current); scanTimerRef.current = null; }
    clearScanPaint();
    setScanHover(null);
    trackedTimeout(() => {
      if (!scanActiveRef.current || !mountedRef.current) return;
      scanRowsRef.current = collectScanRows();
      enterRowPhase();
      if (scanRowsRef.current.length === 1) scanPhaseRef.current = 'item';
      scanAdvance();
      scheduleScan();
    }, 350);
  };

  const cycleTab = (dir: 1 | -1) => {
    const i = TAB_ORDER.indexOf(activeTab as any);
    const n = (i + dir + TAB_ORDER.length) % TAB_ORDER.length;
    setActiveTab(TAB_ORDER[n] as any);
  };

  /** Close the topmost open modal. False when there was nothing to close. */
  const closeTopModal = (): boolean => {
    if (showContactPickerModal) { setShowContactPickerModal(false); return true; }
    if (showWhatsAppModal) { setShowWhatsAppModal(false); return true; }
    if (showConfigModal) { setShowConfigModal(false); return true; }
    if (showScientificArchitectureModal) { setShowScientificArchitectureModal(false); return true; }
    return false;
  };

  /** Rebuild the target list and restart from the row phase. Used whenever the
   *  layout underneath the scan changes (tab switch, modal, orientation). */
  const resyncScan = () => {
    if (!scanActiveRef.current || !mountedRef.current) return;
    scanRowsRef.current = collectScanRows();
    enterRowPhase();
    if (scanRowsRef.current.length === 1) scanPhaseRef.current = 'item';
    scanAdvance();
    scheduleScan();
  };

  // Handle Vocal Trigger actions
  const handleVocalTriggerAction = (trig: VocalSoundTriggerConfig) => {
    const label = isArabic ? trig.nameAr : trig.name;
    // Read the LIVE hover. This whole handler used to be captured once, when the
    // mic was switched on, so 'select' either did nothing or re-fired whichever
    // card happened to be under the cursor at that instant — for the rest of the
    // session, nurse-call alarm and phone contacts included.
    const hovered = hoveredCardIdRef.current;
    let handled = true;

    switch (trig.action) {
      case 'select':
        if (scanActiveRef.current) scanSwitchRef.current();
        else if (hovered) {
          trackerRef.current?.notifyExternalTrigger(hovered);
          handleCardTriggerRef.current(hovered);
        } else handled = false;
        break;
      case 'ask-ai': startAtypicalSpeechRecognition(); break;
      case 'emergency': triggerPrimaryEmergencyCall(); break;
      case 'speak-aloud': handleSpeakTypedText(); break;
      case 'clear': handleClearText(); break;
      case 'next': cycleTab(1); break;
      case 'previous': cycleTab(-1); break;
      case 'back': handled = closeTopModal(); break;
      default: handled = false;
    }

    // Toast AFTER dispatch. It used to fire first and always claim success, so
    // the shipped "High Tone" default (mapped to `next`, which nothing
    // implemented) still told the student it had been heard and acted on.
    if (handled) {
      toast.info(`${isArabic ? 'إشارة صوتية: ' : 'Vocal Trigger: '}${label}`);
    } else {
      toast.warning(
        isArabic ? `«${label}» لم يُنفَّذ — لا يوجد هدف محدد` : `"${label}" did nothing — no target selected`
      );
    }
  };

  // Trigger primary emergency SOS call with debounce
  const triggerPrimaryEmergencyCall = () => {
    if (isDialingRef.current) return;
    isDialingRef.current = true;

    const primary = contacts.find((c) => c.isPrimaryEmergency) || contacts[0];
    if (!primary) { isDialingRef.current = false; return; }

    // Previously this always announced "Calling [caregiver]" and dialed
    // whatever was in primary.phone — including the shipped placeholder
    // numbers nothing in the UI could ever change, so the app confidently
    // lied about placing a call that went nowhere. Check first.
    if (!isValidContactPhone(primary.phone)) {
      isDialingRef.current = false;
      speakSafe(
        isArabic
          ? `لا يوجد رقم محفوظ لـ ${primary.nameAr}. من فضلك افتح إدارة جهات الاتصال وأضف رقم.`
          : `No number saved for ${primary.nameEn}. Please open Manage Contacts and add one.`
      );
      toast.warning(
        isArabic ? `مفيش رقم محفوظ لـ ${primary.nameAr}` : `No number saved for ${primary.nameEn}`,
        isArabic ? 'إعداد ناقص' : 'Setup needed'
      );
      setShowContactPickerModal(true);
      setShowManageContactsModal(true);
      return;
    }

    speakSafe(
      isArabic ? `جاري الاتصال برقم ${primary.nameAr}` : `Calling emergency ${primary.nameEn}`
    );
    toast.success(isArabic ? `اتصال طوارئ: ${primary.nameAr}` : `SOS Call: ${primary.nameEn}`);
    trackedTimeout(() => {
      makePhoneCall(primary.phone);
      isDialingRef.current = false;
    }, 1200);
  };

  // Open Hands-Free Contact Picker
  const openContactPicker = () => {
    setShowContactPickerModal(true);
  };

  // Voice listener to dial by name
  const startVoiceContactListener = () => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      toast.error(isArabic ? 'المتصفح لا يدعم التعرف على الصوت' : 'Speech recognition not supported in browser');
      return;
    }

    try {
      cancelSpeech();
      const restoreMic = releaseMicForRecognition();
      const rec = new SpeechRec();
      voiceContactRecRef.current = rec;
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = profile.language === 'Egyptian Ammiya' ? 'ar-EG' : isArabic ? 'ar-SA' : 'en-US';

      rec.onstart = () => {
        setIsListeningForContactName(true);
        toast.info(isArabic ? 'تحدث الآن... انطق اسم الشخص' : 'Listening...');
      };

      rec.onresult = (e: any) => {
        const spoken = e.results[0][0].transcript.trim().toLowerCase();
        setIsListeningForContactName(false);
        matchAndCallContact(spoken);
      };

      rec.onerror = (e: any) => {
        setIsListeningForContactName(false);
        const reason = e?.error || 'unknown';
        toast.error(
          isArabic
            ? reason === 'not-allowed'
              ? 'تم رفض إذن الميكروفون'
              : reason === 'no-speech'
              ? 'لم يتم رصد أي صوت، حاول مرة أخرى'
              : `تعذر التعرف على الصوت (${reason})`
            : `Speech recognition failed (${reason})`
        );
      };
      rec.onend = () => { setIsListeningForContactName(false); restoreMic(); };
      rec.start();
    } catch {
      setIsListeningForContactName(false);
    }
  };

  // Match spoken word with contact list and dial
  const matchAndCallContact = (spoken: string) => {
    if (isDialingRef.current) return;

    const match = contacts.find(
      (c) =>
        spoken.includes(c.nameAr.toLowerCase()) ||
        spoken.includes(c.nameEn.toLowerCase()) ||
        (spoken.includes('ماما') && c.nameAr.includes('ماما')) ||
        (spoken.includes('مرافق') && c.nameAr.includes('المرافق')) ||
        (spoken.includes('دكتور') && c.nameAr.includes('الدكتور')) ||
        (spoken.includes('إسعاف') && c.nameAr.includes('الإسعاف'))
    );

    if (match) {
      if (!isValidContactPhone(match.phone)) {
        toast.warning(
          isArabic ? `مفيش رقم محفوظ لـ ${match.nameAr}` : `No number saved for ${match.nameEn}`,
          isArabic ? 'إعداد ناقص' : 'Setup needed'
        );
        setShowManageContactsModal(true);
        return;
      }
      isDialingRef.current = true;
      speakSafe(isArabic ? `جاري الاتصال بـ ${match.nameAr}` : `Calling ${match.nameEn}`);
      toast.success(isArabic ? `تم التعرف: اتصال بـ ${match.nameAr}` : `Calling ${match.nameEn}`);
      trackedTimeout(() => {
        makePhoneCall(match.phone);
        setShowContactPickerModal(false);
        isDialingRef.current = false;
      }, 1200);
    } else {
      toast.info(isArabic ? `لم نجد جهة اتصال مطابقة لـ "${spoken}"` : `No contact matched "${spoken}"`);
    }
  };

  // Teacher / Classroom Speech Listener & Auto-Response Generator
  const startTeacherClassListener = () => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      toast.error(isArabic ? 'المتصفح لا يدعم التعرف على الصوت' : 'Speech recognition not supported in browser');
      return;
    }

    try {
      cancelSpeech();
      const restoreMic = releaseMicForRecognition();
      const rec = new SpeechRec();
      teacherRecRef.current = rec;
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = profile.language === 'Egyptian Ammiya' ? 'ar-EG' : isArabic ? 'ar-SA' : 'en-US';

      rec.onstart = () => {
        setIsListeningToTeacher(true);
        toast.info(isArabic ? 'جاري الاستماع لما يقوله المعلم في الغرفة...' : 'Listening to teacher in room...');
      };

      rec.onresult = async (e: any) => {
        const spoken = e.results[0][0].transcript;
        setTeacherHeardSpeech(spoken);
        setIsListeningToTeacher(false);

        // Call Gemini to generate 4 instant quick student answer options
        try {
          const prompt = `A teacher just said this in class: "${spoken}". The student is non-verbal (quadriplegic using eye-tracking). Generate 4 distinct, concise, smart Arabic response options that the student might want to say back (e.g. Agreement/Explanation, Question, Need help, Ready). Return ONLY a JSON array of 4 short Arabic strings, without markdown. Example: ["نعم فهمت هذا المفهوم تماماً.", "هل يمكن توضيح النقطة الأخيرة؟", "أنا جاهز للإجابة.", "عندي سؤال حول التطبيق." ]`;
          const rawResp = await geminiService.askGeneralQuestion(prompt, 'Arabic');
          try {
            const cleanJson = rawResp.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleanJson);
            if (Array.isArray(parsed) && parsed.length >= 2) {
              setAiGeneratedClassOptions(parsed);
              toast.success(isArabic ? 'تم توليد خيارات الرد الذكية بنجاح' : 'AI generated responses ready');
            }
          } catch {
            setAiGeneratedClassOptions([
              `نعم، بخصوص "${spoken}" فهمت تماماً.`,
              'ممكن إعادة توضيح هذه النقطة؟',
              'أنا جاهز للإجابة عن السؤال.',
              'شكراً جزيلاً أستاذ.'
            ]);
          }
        } catch {
          /* fallback */
        }
      };

      rec.onerror = (e: any) => {
        setIsListeningToTeacher(false);
        const reason = e?.error || 'unknown';
        toast.error(
          isArabic
            ? reason === 'not-allowed'
              ? 'تم رفض إذن الميكروفون'
              : reason === 'no-speech'
              ? 'لم يتم رصد أي صوت'
              : `تعذر التعرف على الصوت (${reason})`
            : `Speech recognition failed (${reason})`
        );
      };
      rec.onend = () => { setIsListeningToTeacher(false); restoreMic(); };
      rec.start();
    } catch {
      setIsListeningToTeacher(false);
    }
  };

  // Real 9-Point Affine Calibration Runner
  const CALIBRATION_TARGETS_NORM = [
    { x: 0.10, y: 0.12 }, { x: 0.50, y: 0.12 }, { x: 0.90, y: 0.12 },
    { x: 0.10, y: 0.50 }, { x: 0.50, y: 0.50 }, { x: 0.90, y: 0.50 },
    { x: 0.10, y: 0.88 }, { x: 0.50, y: 0.88 }, { x: 0.90, y: 0.88 },
  ];

  const runNinePointCalibration = () => {
    if (!trackerRef.current || !isCameraActive) {
      toast.error(isArabic ? 'شغّل الكاميرا أولاً' : 'Start the camera first');
      return;
    }

    trackerRef.current.resetCalibration();
    setShowCalibrationModal(true);
    setIsCalibrating(true);
    setCalibrationPointIndex(0);
    // A second press of the calibration button supersedes the first, so two
    // chains can never interleave against one tracker.
    const myRun = ++calibAbortRef.current;

    const DWELL_MS = 1200;

    const runPoint = (index: number) => {
      // Cancel (or unmount) aborts the chain. Previously the dots disappeared
      // but the sequence kept running invisibly and then overwrote the mapping
      // with samples taken while the student was no longer looking at any
      // target — leaving the pointer worse than before they started.
      if (calibAbortRef.current !== myRun || !mountedRef.current) return;
      if (index >= CALIBRATION_TARGETS_NORM.length) {
        const status = trackerRef.current?.finalizeCalibration();
        setIsCalibrating(false);
        setCalibAccuracy(status?.accuracyEstimate ?? null);
        setCalibSucceeded(!!status?.isCalibrated);

        if (status?.isCalibrated) {
          toast.success(
            isArabic
              ? `تمت المعايرة بنجاح — دقة تقديرية ${Math.round((status.accuracyEstimate || 0) * 100)}%`
              : `Calibration complete — ~${Math.round((status.accuracyEstimate || 0) * 100)}% accuracy`
          );
        } else {
          toast.error(
            isArabic
              ? 'تعذرت المعايرة، جرّب مرة أخرى وثبّت رأسك أكثر'
              : 'Calibration failed — try again and keep your head steadier'
          );
        }
        trackedTimeout(() => setShowCalibrationModal(false), 1400);
        return;
      }

      setCalibrationPointIndex(index);
      trackerRef.current?.beginCalibrationPoint();

      trackedTimeout(() => {
        if (calibAbortRef.current !== myRun) return;
        const target = CALIBRATION_TARGETS_NORM[index];
        const committed = trackerRef.current?.commitCalibrationPoint(target.x, target.y);
        if (committed) playBlinkClickSound();
        runPoint(index + 1);
      }, DWELL_MS);
    };

    trackedTimeout(() => runPoint(0), 400);
  };

  // Add new phrase to custom bank
  const handleAddCustomPhrase = () => {
    if (!newPhraseInput.trim()) return;
    const newP = {
      id: `cp-${Date.now()}`,
      textAr: newPhraseInput.trim(),
      icon: '💬',
    };
    const updated = [newP, ...customPhrases];
    setCustomPhrases(updated);
    try {
      localStorage.setItem('cognify_custom_phrases', JSON.stringify(updated));
    } catch {
      /* ignore */
    }
    setNewPhraseInput('');
    toast.success(isArabic ? 'تمت إضافة العبارة لبنكك الشخصي' : 'Phrase added to personal bank');
  };

  const handleDeleteCustomPhrase = (id: string) => {
    const updated = customPhrases.filter((p: any) => p.id !== id);
    setCustomPhrases(updated);
    try {
      localStorage.setItem('cognify_custom_phrases', JSON.stringify(updated));
    } catch {
      /* ignore */
    }
  };

  // Virtual Keyboard Actions
  const handleKeyClick = (char: string) => {
    setTypedText((prev) => prev + char);
  };

  const handleBackspace = () => {
    setTypedText((prev) => prev.slice(0, -1));
  };

  const handleSpace = () => {
    setTypedText((prev) => prev + ' ');
  };

  const handleClearText = () => {
    setTypedText('');
  };

  const handleSelectWordSuggestion = (word: string) => {
    setTypedText(word + ' ');
    speakSafe(word);
  };

  const handleSpeakTypedText = () => {
    if (!typedText.trim()) return;
    speakSafe(typedText);
    toast.success(isArabic ? 'تم نطق النص' : 'Spoken aloud');
  };

  const handleSendTypedToAI = async () => {
    if (!typedText.trim()) return;
    setIsProcessingAi(true);
    try {
      const response = await geminiService.askGeneralQuestion(typedText, profile?.language || 'Arabic');
      if (!mountedRef.current) return;
      setAiResponseText(response);
      speakSafe(response);
      if (onSendMessage) {
        onSendMessage(typedText);
      }
    } catch (err) {
      if (mountedRef.current) toast.error(isArabic ? 'خطأ في معالجة الذكاء الاصطناعي' : 'AI processing error');
    } finally {
      if (mountedRef.current) setIsProcessingAi(false);
    }
  };

  const handleSendTypedToWhatsApp = () => {
    if (!typedText.trim()) return;
    setCustomWaMessage(typedText);
    setSelectedContactForWa(null);
    setShowWhatsAppModal(true);
  };

  // Execute selected AAC Card / Key / Tab
  const handleCardTrigger = async (cardId: string) => {
    // 0. Top Category Tabs
    if (cardId === 'tab-keyboard') {
      setActiveTab('keyboard');
      return;
    }
    if (cardId === 'tab-euphonia-studio') {
      setActiveTab('euphonia-studio');
      return;
    }
    if (cardId === 'tab-smart-room') {
      setActiveTab('smart-room');
      return;
    }
    if (cardId === 'tab-pain-sensory') {
      setActiveTab('pain-sensory');
      return;
    }
    if (cardId === 'tab-class-ai') {
      setActiveTab('class-ai');
      return;
    }
    if (cardId === 'tab-custom-bank') {
      setActiveTab('custom-bank');
      return;
    }
    if (cardId === 'tab-eye-games') {
      setActiveTab('eye-games');
      reactionStartTimeRef.current = Date.now();
      return;
    }

    // Pop Eye Game Bubble
    if (cardId.startsWith('game-bubble-')) {
      const bId = cardId.replace('game-bubble-', '');
      if (!gamePoppedIds.includes(bId)) {
        playPopSound();
        const reactionTime = Date.now() - reactionStartTimeRef.current;
        // Restart the clock for the NEXT bubble. Without this the timer ran from
        // the start of the round, so each pop reported a bigger number than the
        // last (800ms, 2400ms, 5000ms...) and a therapist reading it as a
        // benchmark would think the student was deteriorating.
        reactionStartTimeRef.current = Date.now();
        reactionSamplesRef.current.push(reactionTime);
        const samples = reactionSamplesRef.current;
        setReactionBenchmarkMs(Math.round(samples.reduce((a, b) => a + b, 0) / samples.length));
        setGamePoppedIds((prev) => [...prev, bId]);
        setGameScore((prev) => prev + 10);
        toast.success(`🎯 +10 نقاط! سرعة النظر: ${reactionTime}ms`);
      }
      return;
    }

    // Euphonia Phrase Trigger
    if (cardId.startsWith('eup-phrase-')) {
      const eupId = cardId.replace('eup-phrase-', '');
      const item = euphoniaPhraseBank.find((p) => p.id === eupId);
      if (item) {
        speakSafe(item.text);
        toast.success(`🎙️ "${item.text}"`);
      }
      return;
    }

    // 1. Virtual Keyboard Key Dwell/Blink Triggers
    if (cardId.startsWith('kb-key-')) {
      const char = cardId.replace('kb-key-', '');
      handleKeyClick(char);
      return;
    }
    if (cardId.startsWith('kb-word-')) {
      const word = cardId.replace('kb-word-', '');
      handleSelectWordSuggestion(word);
      return;
    }
    if (cardId === 'kb-space') {
      handleSpace();
      return;
    }
    if (cardId === 'kb-backspace') {
      handleBackspace();
      return;
    }
    if (cardId === 'kb-clear') {
      handleClearText();
      return;
    }
    if (cardId === 'kb-speak') {
      handleSpeakTypedText();
      return;
    }
    if (cardId === 'kb-askai') {
      handleSendTypedToAI();
      return;
    }
    if (cardId === 'kb-whatsapp') {
      handleSendTypedToWhatsApp();
      return;
    }
    if (cardId === 'kb-call') {
      openContactPicker();
      return;
    }
    if (cardId === 'kb-switchlang' || cardId === 'motor-lang-toggle') {
      const next: 'ar' | 'en' | 'fr' = motorLang === 'ar' ? 'en' : motorLang === 'en' ? 'fr' : 'ar';
      setMotorLang(next);
      setKbLang(next === 'ar' ? 'ar' : 'en');
      toast.info(
        next === 'fr'
          ? '🇫🇷 Langue française activée'
          : next === 'ar'
          ? '🇪🇬 تم التحويل للغة العربية'
          : '🇬🇧 Switched to English'
      );
      return;
    }

    // 6. Quick Needs Cards
    const need = QUICK_NEEDS.find((n) => n.id === cardId);
    if (need) {
      const phrase = isArabic ? need.phraseAr : need.phraseEn;
      speakSafe(phrase);
      if (need.isAi) {
        setIsProcessingAi(true);
        try {
          const resp = await geminiService.askGeneralQuestion(phrase, motorLang === 'ar' ? (profile.language || 'Arabic') : 'English');
          setAiResponseText(resp);
          speakSafe(resp);
        } catch {
          /* ignore */
        } finally {
          setIsProcessingAi(false);
        }
      }
      return;
    }

    // 7. Contact calls from modal
    if (cardId.startsWith('call-contact-')) {
      if (isDialingRef.current) return;
      isDialingRef.current = true;

      const contactId = cardId.replace('call-contact-', '');
      const target = contacts.find((c) => c.id === contactId);
      if (target) {
        if (!isValidContactPhone(target.phone)) {
          isDialingRef.current = false;
          toast.warning(
            isArabic ? `مفيش رقم محفوظ لـ ${target.nameAr}` : `No number saved for ${target.nameEn}`,
            isArabic ? 'إعداد ناقص' : 'Setup needed'
          );
          setShowManageContactsModal(true);
          return;
        }
        speakSafe(isArabic ? `جاري الاتصال بـ ${target.nameAr}` : `Calling ${target.nameEn}`);
        trackedTimeout(() => {
          makePhoneCall(target.phone);
          setShowContactPickerModal(false);
          isDialingRef.current = false;
        }, 1200);
        return;
      }
      isDialingRef.current = false;
    }

    // 8. WhatsApp contact selection
    if (cardId.startsWith('wa-contact-')) {
      const contactId = cardId.replace('wa-contact-', '');
      const target = contacts.find((c) => c.id === contactId);
      if (target) {
        setSelectedContactForWa(target);
        speakSafe(isArabic ? `اختر الرسالة لـ ${target.nameAr}` : `Select message for ${target.nameEn}`);
        return;
      }
    }

    // 9. WhatsApp message template selection
    if (cardId.startsWith('wa-msg-')) {
      const msgId = cardId.replace('wa-msg-', '');
      const template = WHATSAPP_QUICK_MESSAGES.find((m) => m.id === msgId);
      if (template && selectedContactForWa) {
        const text = isArabic ? template.textAr : template.textEn;
        if (!isValidContactPhone(selectedContactForWa.phone)) {
          toast.warning(
            isArabic ? `مفيش رقم محفوظ لـ ${selectedContactForWa.nameAr}` : `No number saved for ${selectedContactForWa.nameEn}`,
            isArabic ? 'إعداد ناقص' : 'Setup needed'
          );
          setShowManageContactsModal(true);
          return;
        }
        sendWhatsAppMessage(selectedContactForWa.phone, text);
        toast.success(isArabic ? 'جاري فتح واتساب لإرسال الرسالة' : 'Opening WhatsApp');
        setShowWhatsAppModal(false);
        setSelectedContactForWa(null);
        return;
      }
    }
  };

  // Re-point the tracker's live refs on EVERY render so its long-lived callbacks
  // always invoke the current closures (see the ref declarations above).
  handleCardTriggerRef.current = handleCardTrigger;
  checkHoverTargetRef.current = checkHoverTarget;
  handleVocalTriggerRef.current = handleVocalTriggerAction;
  scanSwitchRef.current = scanSwitch;
  scanApiRef.current = { start: startScan, stop: stopScan, resync: resyncScan };
  flushHeadConfigRef.current = flushHeadConfigSync;
  flushVocalRef.current = flushVocalSync;
  triggersRef.current = triggers;
  headConfigRef.current = headConfig;
  // Calibration takes over the whole screen and drives the tracker itself, so
  // the scan holds position rather than fighting it.
  scanBlockedRef.current = showCalibrationModal || isCalibrating;


  // Deliberately no dependency array: this must run after every render, because
  // any state change in this component re-renders the highlighted button and
  // rewrites its className.
  useEffect(() => {
    if (scanActiveRef.current) applyScanPaint();
  });

  // Adopt tuning changed on ANOTHER device. The profile arrives through App's
  // onSnapshot listener, so this is what makes the settings actually follow the
  // student rather than merely being backed up.
  useEffect(() => {
    const remote = profile?.headTrackingConfig;
    if (!remote) return;
    // Never fight a change this device is still debouncing — that would undo
    // the slider the caregiver is dragging right now.
    if (headSyncPendingRef.current) return;
    const merged = { ...DEFAULT_HEAD_TRACKING_CONFIG, ...remote };
    if (JSON.stringify(merged) === JSON.stringify(headConfig)) return;
    setHeadConfig(merged);
    trackerRef.current?.updateConfig(merged);
    try {
      localStorage.setItem('cognify_head_config', JSON.stringify(merged));
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(profile?.headTrackingConfig)]);

  // First run on an account that predates syncing: push whatever this device
  // already had, so an existing student's tuning is adopted rather than lost.
  useEffect(() => {
    if (!profile?.uid || profile.headTrackingConfig) return;
    try {
      if (!localStorage.getItem('cognify_head_config')) return;
    } catch { return; }
    headSyncPendingRef.current = headConfig;
    flushHeadConfigRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid]);

  // Adopt vocal tuning changed on another device.
  useEffect(() => {
    const remote = mergeTriggers(profile?.vocalTriggers);
    if (!remote) return;
    if (vocalSyncPendingRef.current) return;   // don't undo a change in flight
    if (JSON.stringify(remote) === JSON.stringify(triggers)) return;
    setTriggers(remote);
    vocalSoundEngine.setTriggers(remote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(profile?.vocalTriggers)]);

  // Accounts that predate syncing: adopt whatever this device already had.
  useEffect(() => {
    if (!profile?.uid || profile.vocalTriggers) return;
    const local = loadVocalTriggers();
    if (JSON.stringify(local) === JSON.stringify(DEFAULT_VOCAL_TRIGGERS)) return;
    vocalSyncPendingRef.current = mergeTriggers(local) || local;
    flushVocalRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid]);

  // A change made in the last second before leaving must not be dropped.
  useEffect(() => () => {
    if (headSyncTimerRef.current !== null) {
      clearTimeout(headSyncTimerRef.current);
      headSyncTimerRef.current = null;
    }
    if (vocalSyncTimerRef.current !== null) {
      clearTimeout(vocalSyncTimerRef.current);
      vocalSyncTimerRef.current = null;
    }
    flushHeadConfigRef.current();
    flushVocalRef.current();
  }, []);

  // Run the scan for as long as the setting is on. The short delay lets the
  // tab that is being switched into finish laying out before we snapshot it.
  useEffect(() => {
    if (!headConfig.autoScanEnabled) {
      scanApiRef.current.stop();
      return undefined;
    }
    const t = window.setTimeout(() => scanApiRef.current.start(), 250);
    return () => {
      clearTimeout(t);
      scanApiRef.current.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headConfig.autoScanEnabled, headConfig.autoScanMode]);

  // A physical switch almost always presents itself as a keyboard: Space or
  // Enter. Text fields keep their own spacebar.
  useEffect(() => {
    if (!headConfig.autoScanEnabled) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      scanSwitchRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [headConfig.autoScanEnabled]);

  // The visible targets change completely between tabs, and on rotate/resize.
  useEffect(() => {
    if (!headConfig.autoScanEnabled) return undefined;
    const t = window.setTimeout(() => scanApiRef.current.resync(), 220);
    const onResize = () => scanApiRef.current.resync();
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, showContactPickerModal, headConfig.autoScanEnabled]);

  /** What the switch will do if pressed right now. */
  const scanStatusLabel = useMemo(() => {
    if (!scanActive) return isArabic ? 'ابدأ المسح' : 'Start scanning';
    if (scanPhaseRef.current === 'row' && scanRowsRef.current.length > 1) {
      return isArabic ? 'اختر هذا الصف' : 'Choose this row';
    }
    return isArabic ? 'اختر هذا الزر' : 'Select this';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanActive, scanTickCount, isArabic]);

  // Atypical / Dysarthric Speech Recording
  const startAtypicalSpeechRecognition = () => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      toast.error(isArabic ? 'المتصفح لا يدعم التعرف على الصوت' : 'Speech recognition not supported in browser');
      return;
    }

    // The vocal-sound engine holds its own exclusive getUserMedia audio
    // stream. On some browsers/devices a second concurrent mic consumer
    // (native SpeechRecognition) then silently fails to start — this looked
    // like "the mic is broken" with zero feedback. Free the mic first.
    const restoreMic = releaseMicForRecognition();

    try {
      const rec = new SpeechRec();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = profile.language === 'Egyptian Ammiya' ? 'ar-EG' : isArabic ? 'ar-SA' : 'en-US';

      rec.onstart = () => {
        setIsRecordingSpeech(true);
        toast.info(isArabic ? 'جاري الاستماع... تحدث بأسلوبك الطبيعي' : 'Listening...');
      };

      rec.onresult = async (e: any) => {
        const rawTranscript = e.results[0][0].transcript;
        setSpeechTranscript(rawTranscript);
        setIsRecordingSpeech(false);

        setIsProcessingAi(true);
        try {
          const compensatedPrompt = `The following speech was transcribed from a user with motor/speech impairment (dysarthria/atypical speech): "${rawTranscript}". Interpret intended meaning and respond concisely in ${profile.language || 'Egyptian Arabic'}.`;
          const answer = await geminiService.askGeneralQuestion(compensatedPrompt, profile.language || 'Arabic');
          setAiResponseText(answer);
          speakSafe(answer);
          if (onSendMessage) {
            onSendMessage(rawTranscript);
          }
        } catch (err) {
          console.error(err);
        } finally {
          setIsProcessingAi(false);
        }
      };

      rec.onerror = (e: any) => {
        setIsRecordingSpeech(false);
        const reason = e?.error || 'unknown';
        const arMsg =
          reason === 'not-allowed' || reason === 'permission-denied'
            ? 'تم رفض إذن الميكروفون — يرجى السماح بالوصول للميكروفون من إعدادات المتصفح'
            : reason === 'audio-capture'
            ? 'لا يوجد ميكروفون متاح، أو أنه مستخدم بواسطة ميزة أخرى — أوقفها وحاول مرة أخرى'
            : reason === 'no-speech'
            ? 'لم يتم رصد أي صوت، حاول التحدث بصوت أعلى بالقرب من الميكروفون'
            : `تعذر التعرف على الصوت (${reason})`;
        const enMsg =
          reason === 'not-allowed' || reason === 'permission-denied'
            ? 'Microphone permission denied — allow mic access in browser settings'
            : reason === 'audio-capture'
            ? 'No microphone available, or it is in use by another feature'
            : reason === 'no-speech'
            ? 'No speech detected — try speaking louder, closer to the mic'
            : `Speech recognition failed (${reason})`;
        toast.error(isArabic ? arMsg : enMsg);
      };
      rec.onend = () => { setIsRecordingSpeech(false); restoreMic(); };
      rec.start();
    } catch {
      setIsRecordingSpeech(false);
      toast.error(isArabic ? 'تعذر بدء تسجيل الصوت' : 'Could not start recording');
    }
  };

  const activeKeyboardRows = kbLang === 'ar' ? AR_KEYBOARD_ROWS : EN_KEYBOARD_ROWS;

  // 9 Calibration Point Coordinates
  const CALIBRATION_POINTS = [
    { x: '10%', y: '12%' },
    { x: '50%', y: '12%' },
    { x: '90%', y: '12%' },
    { x: '10%', y: '50%' },
    { x: '50%', y: '50%' },
    { x: '90%', y: '50%' },
    { x: '10%', y: '88%' },
    { x: '50%', y: '88%' },
    { x: '90%', y: '88%' },
  ];

  // Theme styling definitions
  const themeClasses = {
    amber: {
      accentText: 'text-amber-400',
      accentBg: 'bg-amber-400 text-slate-950',
      activeTab: 'bg-amber-400 text-slate-950 border-amber-300',
      keyHover: 'border-amber-400 bg-amber-400 text-slate-950 ring-4 ring-amber-400/40',
      cursorRing: 'text-amber-400',
      cursorDot: 'bg-amber-400',
    },
    cyan: {
      accentText: 'text-cyan-400',
      accentBg: 'bg-cyan-400 text-slate-950',
      activeTab: 'bg-cyan-400 text-slate-950 border-cyan-300',
      keyHover: 'border-cyan-400 bg-cyan-400 text-slate-950 ring-4 ring-cyan-400/40',
      cursorRing: 'text-cyan-400',
      cursorDot: 'bg-cyan-400',
    },
    emerald: {
      accentText: 'text-emerald-400',
      accentBg: 'bg-emerald-400 text-slate-950',
      activeTab: 'bg-emerald-400 text-slate-950 border-emerald-300',
      keyHover: 'border-emerald-400 bg-emerald-400 text-slate-950 ring-4 ring-emerald-400/40',
      cursorRing: 'text-emerald-400',
      cursorDot: 'bg-emerald-400',
    },
    monochrome: {
      accentText: 'text-white',
      accentBg: 'bg-white text-slate-950',
      activeTab: 'bg-white text-slate-950 border-white',
      keyHover: 'border-white bg-white text-slate-950 ring-4 ring-white/50',
      cursorRing: 'text-white',
      cursorDot: 'bg-white',
    },
  }[theme];

  return (
    <div className={`flex-1 flex flex-col h-full bg-slate-950 text-white overflow-hidden relative p-1.5 sm:p-2.5 lg:p-3 select-none font-sans ${isFullscreen ? 'fixed inset-0 z-[99998] p-3' : ''}`}>
      {/* Head Pointer / Eye-Gaze MediaPipe Visual Interactive Cursor.
          Previously this rendered unconditionally — even with tracking OFF
          ("Start Eye Tracker" not yet pressed), a ring+dot reticle sat at
          screen-center (fixed, z-[99999], above literally everything
          including the nav tabs) for no reason: nothing is being tracked,
          so there's nothing for it to represent. Now only shown once eye
          tracking is actually running. */}
      {isCameraActive && (
        <div
          className="fixed pointer-events-none z-[99999] will-change-transform top-0 left-0"
          style={{
            transform: `translate3d(${cursorPos.x}px, ${cursorPos.y}px, 0) translate(-50%, -50%)`,
          }}
        >
          <div className="relative flex items-center justify-center">
            {/* Subtle OS-Style Precision Reticle */}
            <div className="absolute w-5 h-[1.5px] bg-slate-400/50 pointer-events-none" />
            <div className="absolute h-5 w-[1.5px] bg-slate-400/50 pointer-events-none" />

            {/* Radial Dwell Countdown Ring */}
            <svg className={`w-16 h-16 -rotate-90 transition-all duration-150 ${cursorPos.isSnapped ? 'scale-110 drop-shadow-[0_2px_8px_rgba(99,102,241,0.4)]' : 'drop-shadow-[0_2px_8px_rgba(16,185,129,0.3)]'}`}>
              <circle
                cx="32"
                cy="32"
                r="24"
                stroke="currentColor"
                strokeWidth="3.5"
                className={cursorPos.isSnapped ? 'text-indigo-500/25' : 'text-emerald-500/20'}
                fill="none"
              />
              <circle
                cx="32"
                cy="32"
                r="24"
                stroke="currentColor"
                strokeWidth="3.5"
                className={`${cursorPos.isSnapped ? 'text-indigo-400' : 'text-emerald-400'} transition-all duration-75`}
                fill="none"
                strokeDasharray="150"
                strokeDashoffset={150 - 150 * dwellProgress}
              />
            </svg>

            {/* Ergonomic OS-Style System Pointer Dot (Visually Static, Zero Glow/Pulse) */}
            <div className={`absolute w-4 h-4 rounded-full border-2 border-white flex items-center justify-center shadow-md transition-colors duration-150 ${
              cursorPos.isSnapped ? 'bg-indigo-600 ring-2 ring-indigo-300/60' : 'bg-slate-900'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full transition-colors duration-150 ${
                cursorPos.isSnapped ? 'bg-white' : 'bg-slate-200'
              }`} />
            </div>
          </div>
        </div>
      )}

            {/* Center-gaze recenter target — a dot at the true centre to look at. */}
      {showCenterDot && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm pointer-events-none">
          <p className="text-amber-300 font-black text-lg mb-6">
            {isArabic ? 'انظر إلى النقطة في المنتصف' : 'Look at the centre dot'}
          </p>
          <div className="relative">
            <div className="w-6 h-6 rounded-full bg-amber-400 animate-ping absolute inset-0" />
            <div className="w-6 h-6 rounded-full bg-amber-400 ring-4 ring-amber-400/30 relative" />
          </div>
        </div>
      )}

      {/* Consolidated High-Efficiency Top Command Bar (Single Ergonomic Row) */}
      <div className="shrink-0 mb-2 p-1.5 sm:p-2 rounded-2xl bg-slate-900/95 border border-slate-800 flex items-center justify-between gap-1.5 sm:gap-2 flex-wrap text-xs shadow-md">
        {/* 1. Mode Navigation Tabs (Eye-Gaze Accessible with Dwell Progress) */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {/* Tab: Eye Keyboard */}
          <button
            data-aac-id="tab-keyboard"
            onClick={() => setActiveTab('keyboard')}
            className={`relative px-2.5 sm:px-3 py-1.5 rounded-xl font-black text-xs flex items-center gap-1.5 transition-all ${
              activeTab === 'keyboard'
                ? themeClasses.activeTab + ' shadow-md'
                : 'bg-slate-950 border border-slate-800 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <KeyboardIcon className="w-3.5 h-3.5" />
            <span>{isArabic ? 'كيبورد العين' : 'Eye Keyboard'}</span>
            {hoveredCardId === 'tab-keyboard' && dwellProgress > 0 && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-950 rounded-b-xl overflow-hidden">
                <div className="h-full bg-amber-400 transition-all duration-75" style={{ width: `${dwellProgress * 100}%` }} />
              </div>
            )}
          </button>

          {/* Tab: Euphonia Voice Studio */}
          <button
            data-aac-id="tab-euphonia-studio"
            onClick={() => setActiveTab('euphonia-studio')}
            className={`relative px-2.5 sm:px-3 py-1.5 rounded-xl font-black text-xs flex items-center gap-1.5 transition-all ${
              activeTab === 'euphonia-studio'
                ? themeClasses.activeTab + ' shadow-md'
                : 'bg-slate-950 border border-slate-800 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>{isArabic ? 'استوديو إيفونيا' : 'Euphonia Studio'}</span>
            {hoveredCardId === 'tab-euphonia-studio' && dwellProgress > 0 && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-950 rounded-b-xl overflow-hidden">
                <div className="h-full bg-amber-400 transition-all duration-75" style={{ width: `${dwellProgress * 100}%` }} />
              </div>
            )}
          </button>
        </div>

        {/* 2. Quick Tracking Tuning & Recalibration */}
        <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
          {/* Tracking Mode Switcher */}
          <div className="flex items-center gap-0.5 bg-slate-950 p-0.5 rounded-xl border border-slate-800 text-[11px]">
            <button
              onClick={() => updateHeadConfig({ trackingMode: 'iris' })}
              className={`px-2 py-1 rounded-lg font-bold transition-all ${
                (headConfig.trackingMode || 'iris') === 'iris'
                  ? 'bg-amber-400 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
              title={isArabic ? 'بؤبؤ العين' : 'Eye Iris'}
            >
              👁️ <span className="hidden md:inline">{isArabic ? 'بؤبؤ' : 'Iris'}</span>
            </button>
            <button
              onClick={() => updateHeadConfig({ trackingMode: 'nose' })}
              className={`px-2 py-1 rounded-lg font-bold transition-all ${
                headConfig.trackingMode === 'nose'
                  ? 'bg-amber-400 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
              title={isArabic ? 'الأنف والرأس' : 'Nose Head'}
            >
              👤 <span className="hidden md:inline">{isArabic ? 'رأس' : 'Nose'}</span>
            </button>
            <button
              onClick={() => updateHeadConfig({ trackingMode: 'hybrid' })}
              className={`px-2 py-1 rounded-lg font-bold transition-all ${
                headConfig.trackingMode === 'hybrid'
                  ? 'bg-amber-400 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
              title={isArabic ? 'هجين' : 'Hybrid'}
            >
              ⚡ <span className="hidden md:inline">{isArabic ? 'هجين' : 'Hybrid'}</span>
            </button>
          </div>

          {/* Dwell Time Adjuster */}
          <div className="flex items-center gap-1 bg-slate-950 rounded-xl px-1.5 py-0.5 border border-slate-800 text-[11px]">
            <span className="text-slate-400 hidden sm:inline">{isArabic ? 'تثبيت:' : 'Dwell:'}</span>
            <button
              onClick={() => updateHeadConfig({ dwellTimeMs: Math.max(500, headConfig.dwellTimeMs - 100) })}
              className="px-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold"
            >
              -
            </button>
            <span className="font-mono font-bold text-emerald-300 px-0.5">{(headConfig.dwellTimeMs / 1000).toFixed(1)}s</span>
            <button
              onClick={() => updateHeadConfig({ dwellTimeMs: Math.min(2200, headConfig.dwellTimeMs + 100) })}
              className="px-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold"
            >
              +
            </button>
          </div>

          {/* Center Recalibrate Button */}
          <button
            onClick={() => {
              setShowCenterDot(true);
              trackerRef.current?.calibrateNeutral();
              trackedTimeout(() => {
                setShowCenterDot(false);
                toast.success(isArabic ? '🎯 تم ضبط مركز النظر' : 'Eye center set');
              }, 1400);
            }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs shadow-sm transition-all"
            title={isArabic ? 'ضبط نقطة المنتصف للنظر' : 'Recenter eye tracking'}
          >
            <Target className="w-3.5 h-3.5" />
            <span>{isArabic ? '🎯 ضبط المركز' : 'Center'}</span>
          </button>
        </div>

        {/* 3. Primary Session Controls & Utilities */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {/* Camera Head Pointer Toggle */}
          <button
            onClick={toggleCamera}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs transition-all shadow-sm ${
              isCameraActive
                ? 'bg-amber-500 text-slate-950 shadow-amber-500/20'
                : 'bg-slate-950 text-slate-300 hover:bg-slate-800 border border-slate-700'
            }`}
            title={isCameraActive ? (isArabic ? 'إيقاف الكاميرا' : 'Stop Camera') : (isArabic ? 'تشغيل الكاميرا' : 'Start Camera')}
          >
            {isCameraActive ? <Camera className="w-3.5 h-3.5" /> : <CameraOff className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isCameraActive ? (isArabic ? 'إيقاف الكاميرا' : 'Stop Camera') : (isArabic ? 'تشغيل الكاميرا' : 'Start Camera')}</span>
          </button>

          {/* Euphonia Vocal Sound Toggle */}
          <button
            onClick={toggleAudioEngine}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs transition-all shadow-sm ${
              isAudioEngineActive
                ? 'bg-emerald-500 text-slate-950 shadow-emerald-500/20'
                : 'bg-slate-950 text-slate-300 hover:bg-slate-800 border border-slate-700'
            }`}
            title={isAudioEngineActive ? (isArabic ? 'إيقاف إيفونيا' : 'Stop Euphonia') : (isArabic ? 'أصوات إيفونيا' : 'Vocal Sounds')}
          >
            {isAudioEngineActive ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isAudioEngineActive ? (isArabic ? 'إيقاف إيفونيا' : 'Stop Euphonia') : (isArabic ? 'أصوات إيفونيا' : 'Vocal Sounds')}</span>
          </button>

          {/* Layout Flexibility Switcher: Docked vs Floating */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-0.5">
            <button
              onClick={() => setSidebarMode(sidebarMode === 'docked' ? 'floating' : 'docked')}
              className="px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 text-slate-300 hover:text-white"
              title={sidebarMode === 'docked' ? (isArabic ? 'تحويل إلى كاميرا عائمة' : 'Switch to floating camera') : (isArabic ? 'تثبيت جانبي' : 'Switch to side-by-side')}
            >
              {sidebarMode === 'docked' ? <Columns2 className="w-3.5 h-3.5 text-amber-400" /> : <Maximize2 className="w-3.5 h-3.5 text-amber-400" />}
              <span className="hidden md:inline">{sidebarMode === 'docked' ? (isArabic ? 'جانبي' : 'Docked') : (isArabic ? 'عائم' : 'Floating')}</span>
            </button>
          </div>

          {/* Motor Language Switcher: Arabic <-> English <-> French */}
          <button
            data-aac-id="motor-lang-toggle"
            onClick={() => {
              const next: 'ar' | 'en' | 'fr' = motorLang === 'ar' ? 'en' : motorLang === 'en' ? 'fr' : 'ar';
              setMotorLang(next);
              setKbLang(next === 'ar' ? 'ar' : 'en');
              toast.info(
                next === 'fr'
                  ? '🇫🇷 Langue française activée'
                  : next === 'ar'
                  ? '🇪🇬 تم التحويل للغة العربية'
                  : '🇬🇧 Switched to English'
              );
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-200 hover:text-white font-bold text-xs transition-all shadow-sm"
            title={motorLang === 'ar' ? 'Switch to English' : motorLang === 'en' ? 'Passer au français' : 'التحويل للعربية'}
          >
            <Languages className="w-3.5 h-3.5 text-amber-400" />
            <span>{motorLang === 'ar' ? 'عربي 🇪🇬' : motorLang === 'fr' ? 'FR 🇫🇷' : 'EN 🇬🇧'}</span>
          </button>


        </div>
      </div>
{/* End of pinned chrome. Everything below (the actual keyboard / voice
          studio panels) gets the remaining viewport height and scrolls
          WITHIN itself if it doesn't fit — min-h-0 is required for a flex
          child to actually be allowed to shrink instead of forcing the page
          to grow past the viewport. This is what removes the page-level
          scroll a user previously had to do just to reach the keyboard
          below the toolbar. */}
      {/* overflow-hidden, not overflow-y-auto: explicitly required for this
          audience — a paralyzed/dwell-clicking user cannot scroll at all, so
          ANY scrollbar (even an internal one, even a rare edge case) is a
          real access failure, not a minor inconvenience. The tradeoff this
          creates: on a very short viewport, panels below now compress
          (min-h-0 on every row) instead of scrolling into view — nothing is
          literally deleted, but on a small enough screen some vertical
          spacing gets tight rather than being reachable via scroll. */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">

      {/* Main Communicator Grid: Left HUD / Floating PIP + Main Center Eye-Gaze Board */}
      <div className={`grid grid-cols-1 ${sidebarMode === 'docked' ? 'md:grid-cols-12' : 'grid-cols-1'} gap-2 sm:gap-3 flex-1 min-h-0 overflow-hidden`}>
        {/* Left Side: Live Webcam HUD + Vocal Visualizer + Dysarthria Decoder */}
        <div className={
          sidebarMode === 'docked'
            ? 'md:col-span-3 sm:col-span-4 flex flex-col gap-2 min-h-0 overflow-hidden'
            : sidebarMode === 'floating'
            ? `${
                cameraCorner === 'top-right'
                  ? 'fixed top-5 right-5'
                  : cameraCorner === 'top-left'
                  ? 'fixed top-5 left-5'
                  : cameraCorner === 'bottom-right'
                  ? 'fixed bottom-5 right-5'
                  : cameraCorner === 'bottom-left'
                  ? 'fixed bottom-5 left-5'
                  : 'fixed bottom-5 right-5'
              } z-[9990] ${cameraCorner === 'minimized' ? 'w-auto' : 'w-80 max-w-[92vw]'} flex flex-col gap-2 bg-slate-950/95 backdrop-blur-xl border-2 border-amber-400 p-3 rounded-3xl shadow-2xl transition-all max-h-[80vh] overflow-y-auto`
            : 'fixed -left-[9999px] w-0 h-0 overflow-hidden opacity-0 pointer-events-none'
        }>
          {sidebarMode === 'floating' && (
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800 gap-1 flex-wrap">
              <span className="text-[11px] font-black text-amber-400 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5" />
                {isArabic ? 'الكاميرا' : 'Camera'}
              </span>

              {/* Corner Placement Controls */}
              <div className="flex items-center gap-0.5 bg-slate-900 rounded-lg p-0.5 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setCameraCorner('top-left')}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${cameraCorner === 'top-left' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'}`}
                  title={isArabic ? 'أعلى اليسار' : 'Top Left'}
                >
                  ↖
                </button>
                <button
                  type="button"
                  onClick={() => setCameraCorner('top-right')}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${cameraCorner === 'top-right' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'}`}
                  title={isArabic ? 'أعلى اليمين' : 'Top Right'}
                >
                  ↗
                </button>
                <button
                  type="button"
                  onClick={() => setCameraCorner('bottom-left')}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${cameraCorner === 'bottom-left' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'}`}
                  title={isArabic ? 'أسفل اليسار' : 'Bottom Left'}
                >
                  ↙
                </button>
                <button
                  type="button"
                  onClick={() => setCameraCorner('bottom-right')}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${cameraCorner === 'bottom-right' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'}`}
                  title={isArabic ? 'أسفل اليمين' : 'Bottom Right'}
                >
                  ↘
                </button>
                <button
                  type="button"
                  onClick={() => setCameraCorner(cameraCorner === 'minimized' ? 'top-right' : 'minimized')}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${cameraCorner === 'minimized' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'}`}
                  title={isArabic ? 'تصغير' : 'Minimize'}
                >
                  {cameraCorner === 'minimized' ? '▣' : '—'}
                </button>
              </div>

              <button 
                onClick={() => setSidebarMode('docked')} 
                className="text-[10px] text-slate-300 hover:text-white px-2 py-0.5 rounded-lg bg-slate-800 font-bold border border-slate-700"
              >
                {isArabic ? 'ثبّت جانبًا ⇲' : 'Dock it ⇲'}
              </button>
            </div>
          )}

          {/* Live Webcam Box */}
          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-2 sm:p-2.5 shadow-xl relative overflow-hidden shrink-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-amber-400" />
                {isArabic ? 'مستشعر بؤبؤ العين' : 'Pupil Eye-Tracker'}
              </span>
              {isCameraActive && (
                <button
                  onClick={() => trackerRef.current?.calibrateNeutral()}
                  className="text-[10px] text-amber-400 hover:underline flex items-center gap-1 font-bold"
                >
                  <RefreshCw className="w-2.5 h-2.5" /> {isArabic ? 'إعادة الضبط' : 'Reset'}
                </button>
              )}
            </div>

            <div className="relative aspect-video max-h-32 sm:max-h-36 rounded-xl bg-black flex items-center justify-center overflow-hidden border border-slate-800">
              <video
                ref={videoRef}
                className="w-full h-full object-cover -scale-x-100"
                playsInline
                muted
              />
              {/* MediaPipe Deep Learning Face & Eye Mesh Canvas Overlay */}
              <canvas
                ref={overlayCanvasRef}
                width={320}
                height={240}
                className="absolute inset-0 w-full h-full pointer-events-none object-cover"
              />
              {!isCameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400 bg-slate-950/90 p-3 text-center">
                  <Eye className="w-8 h-8 text-amber-400 animate-pulse" />
                  <p className="text-xs font-bold text-white">
                    {isArabic ? 'تتبع حركة بؤبؤ العين (Eye Gaze)' : 'Eye-Gaze Pupil Tracking'}
                  </p>
                  <button
                    onClick={toggleCamera}
                    className="mt-1 px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs shadow-lg shadow-amber-400/20 flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{isArabic ? 'بدء التتبع بالعين الآن' : 'Start Eye Tracking'}</span>
                  </button>
                </div>
              )}

              {/* Eye-Gaze Status HUD */}
              {isCameraActive && (
                <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between text-[10px] bg-slate-950/85 backdrop-blur-md rounded-xl px-2.5 py-1 text-white border border-slate-800">
                  <span className="flex items-center gap-1 text-amber-400 font-black">
                    <Eye className="w-3.5 h-3.5" /> {isArabic ? 'بؤبؤ العين نشط' : 'Pupil Active'}
                  </span>
                  <span className="text-emerald-400 font-black flex items-center gap-1">
                    <Check className="w-3 h-3" /> {isArabic ? 'غمضة = كتابة' : 'Blink = Click'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Euphonia Audio Signal Analyzer Bar */}
          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-2 sm:p-2.5 shadow-xl shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Mic className="w-3.5 h-3.5 text-emerald-400" />
                {/* Renamed from "Euphonia Vocal Sounds" — that name duplicated the
                    "Vocal Sounds" toggle button in the toolbar above almost
                    word-for-word, making them look like two different features
                    when this is just a live level meter FOR that same toggle. */}
                {isArabic ? 'مستوى الميكروفون (حي)' : 'Live Mic Level'}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {audioMetrics.peakFrequency > 0 ? `${audioMetrics.peakFrequency} Hz` : '0 Hz'}
              </span>
            </div>

            {/* Live Volume Bar */}
            <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden relative mb-2">
              <div
                className={`h-full transition-all duration-75 rounded-full ${
                  audioMetrics.isTriggering ? 'bg-amber-400 shadow-[0_0_10px_#fbbf24]' : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(100, audioMetrics.volume * 250)}%` }}
              />
            </div>

            {/* Triggers */}
            <div className="grid grid-cols-3 gap-1.5 text-center">
              {triggers.map((t) => (
                <div
                  key={t.id}
                  className={`p-1.5 rounded-xl border text-[10px] transition-all ${
                    audioMetrics.activeTriggerName === t.name
                      ? 'bg-amber-400/20 border-amber-400 text-amber-300 font-black'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400'
                  }`}
                >
                  <p className="truncate font-bold">{isArabic ? t.nameAr : t.name}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Direct Dysarthric Speech AI Decoder */}
          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-2 sm:p-2.5 shadow-xl shrink-0">
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              {isArabic ? 'فك شفرة الكلام غير النمطي' : 'Dysarthria Decoder'}
            </h3>

            <button
              onClick={startAtypicalSpeechRecognition}
              disabled={isRecordingSpeech || isProcessingAi}
              className={`w-full py-2.5 px-3 rounded-2xl flex items-center justify-center gap-2 font-bold text-xs transition-all shadow-md ${
                isRecordingSpeech
                  ? 'bg-rose-500 text-white animate-pulse'
                  : isProcessingAi
                  ? 'bg-slate-800 text-slate-400 cursor-wait'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
            >
              {isRecordingSpeech ? (
                <>
                  <Mic className="w-3.5 h-3.5 animate-bounce" />
                  <span>{isArabic ? 'جاري الاستماع...' : 'Listening...'}</span>
                </>
              ) : isProcessingAi ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{isArabic ? 'جاري الفهم بالذكاء الاصطناعي...' : 'Decoding...'}</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5" />
                  <span>{isArabic ? 'تحدث بأسلوبك (Dysarthria)' : 'Record Speech'}</span>
                </>
              )}
            </button>

            {speechTranscript && (
              <div className="mt-2 p-2 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-300">
                "{speechTranscript}"
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Eye-Gaze Board Content (Expanded to 100% full width when floating) */}
        <div
          className={`${sidebarMode === 'docked' ? 'md:col-span-9 sm:col-span-8' : 'col-span-12 w-full'} flex flex-col gap-2 min-h-0 overflow-hidden h-full`}
          style={
            // The floating panel is `position: fixed` (it has to be, to float
            // over/around scrolling content) — fixed elements are removed from
            // normal document flow, so the grid has no idea it exists and
            // never reserved room for it. Padding the content by the panel's
            // own width+offset is what actually stops it covering buttons,
            // eye-gaze targets, and tab labels underneath. Skipped when the
            // panel is minimized (small pill, doesn't need a full lane) or
            // docked/hidden (no fixed panel at all in those modes).
            sidebarMode === 'floating' && cameraCorner !== 'minimized'
              ? {
                  paddingInlineStart: cameraCorner === 'top-left' || cameraCorner === 'bottom-left' ? '21rem' : undefined,
                  paddingInlineEnd: cameraCorner === 'top-right' || cameraCorner === 'bottom-right' ? '21rem' : undefined,
                }
              : undefined
          }
        >
          {/* TAB 1: Arabic Eye-Gaze Virtual Keyboard (PySource Split Blink Keyboard) */}
          {activeTab === 'keyboard' && (
            <GazeBlinkKeyboard
              isArabic={isArabic}
              dwellTimeMsOverride={headConfig.dwellTimeMs}
              suppressOwnSelection={scanActive}
              cursorPos={cursorPos}
              gestureState={gestureState}
              onSpeakText={(text) => speakSafe(text)}
              onSendToAI={async (text) => {
                if (!text.trim()) return;
                setIsProcessingAi(true);
                try {
                  const answer = await geminiService.askGeneralQuestion(text, motorLang === 'ar' ? (profile.language || 'Arabic') : 'English');
                  setAiResponseText(answer);
                  speakSafe(answer);
                  if (onSendMessage) onSendMessage(text);
                } catch (err) {
                  console.error(err);
                } finally {
                  setIsProcessingAi(false);
                }
              }}
              onSendToWhatsApp={(text) => {
                if (!text.trim()) return;
                setCustomWaMessage(text);
                setShowWhatsAppModal(true);
              }}
              onOpenCallPicker={() => setShowContactPickerModal(true)}
              themeAccent={theme === 'amber' ? 'amber' : theme === 'emerald' ? 'emerald' : 'cyan'}
            />
          )}

          {/* TAB 2: Google Project Euphonia Voice Training Studio & Custom ASR */}
          {activeTab === 'euphonia-studio' && (
            <div className="bg-slate-900 rounded-3xl border-2 border-slate-800 p-6 shadow-2xl flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row items-center justify-between pb-3 border-b border-slate-800 gap-3">
                <div>
                  <h3 className="text-xl font-black text-white flex items-center gap-2">
                    <Radio className="w-6 h-6 text-amber-400" />
                    {isArabic ? 'استوديو تدريب الصوت (Project Euphonia)' : 'Project Euphonia Voice Training'}
                  </h3>
                  <p className="text-xs text-slate-400 font-medium mt-1">
                    {isArabic
                      ? `${euphoniaPhraseBank.length} عبارة مصممة لتغطية أصوات اللغة — سجّل كل عبارة 3 مرات على الأقل`
                      : `${euphoniaPhraseBank.length} phonemically-balanced phrases — record each 3+ times`}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                <button
                  onClick={exportEuphoniaTrainingData}
                  disabled={isExportingSamples}
                  className="px-4 py-3 rounded-2xl font-black text-xs flex items-center gap-2 shadow-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/30 disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  <span>
                    {isExportingSamples
                      ? (isArabic ? 'جاري التصدير...' : 'Exporting...')
                      : (isArabic ? 'تصدير التسجيلات' : 'Export data')}
                  </span>
                </button>
                <button
                  onClick={toggleEuphoniaLiveListener}
                  className={`px-5 py-3 rounded-2xl font-black text-xs flex items-center gap-2 shadow-lg transition-all ${
                    isEuphoniaLiveListening ? 'bg-rose-500 text-white animate-pulse' : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                  }`}
                >
                  <Mic className="w-4 h-4" />
                  <span>{isEuphoniaLiveListening ? (isArabic ? 'جاري الاستماع...' : 'Listening...') : (isArabic ? '🎙️ تحدث الآن' : 'Speak Now')}</span>
                </button>
                </div>
              </div>

              {/* Mic level VU meter while recording or live-matching */}
              {(recordingPhraseId || isEuphoniaLiveListening) && (
                <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full bg-emerald-400 transition-all duration-75" style={{ width: `${micLevel * 100}%` }} />
                </div>
              )}

              {euphoniaMatchedPhrase && (
                <div className="p-3.5 rounded-2xl bg-emerald-950/50 border border-emerald-500/50 text-xs text-emerald-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-white font-black text-sm">"{euphoniaMatchedPhrase}"</span>
                  </div>
                  <span className="text-[10px] font-mono opacity-70">
                    {euphoniaMatchSource === 'custom-model' ? (isArabic ? 'نموذج مخصص' : 'custom model') : (isArabic ? 'متصفح' : 'browser')}
                  </span>
                </div>
              )}

              {/* Category filter chips */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {['all', ...Array.from(new Set(euphoniaPhraseBank.map((p) => p.category)))].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setEuphoniaCategoryFilter(cat)}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-black whitespace-nowrap transition-all ${
                      euphoniaCategoryFilter === cat ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {cat === 'all' ? (isArabic ? 'الكل' : 'All') : `${getCategoryIcon(cat)} ${cat}`}
                  </button>
                ))}
              </div>

              {/* Training cards grid — driven by the 100-phrase bank */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 max-h-[520px] overflow-y-auto pr-1">
                {euphoniaPhraseBank
                  .filter((p) => euphoniaCategoryFilter === 'all' || p.category === euphoniaCategoryFilter)
                  .map((phrase) => {
                    const cardKey = `eup-phrase-${phrase.id}`;
                    const samplesRecorded = euphoniaTrainingState[phrase.id] || 0;
                    const isRecordingThis = recordingPhraseId === phrase.id;
                    const isFullyTrained = samplesRecorded >= 3;
                    const isHovered = hoveredCardId === cardKey;

                    return (
                      <div
                        key={phrase.id}
                        data-aac-id={cardKey}
                        onClick={() => handleCardTrigger(cardKey)}
                        className={`relative p-4 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between min-h-[130px] ${
                          isHovered
                            ? 'border-amber-400 bg-amber-400 text-slate-950 shadow-2xl scale-[1.02]'
                            : 'border-slate-800 bg-slate-950 text-white hover:border-amber-400/40'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-2xl">{getCategoryIcon(phrase.category)}</span>
                            <span className={`text-[10px] font-black px-2 py-1 rounded-full border ${
                              isFullyTrained ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                            }`}>
                              {samplesRecorded} / 3
                            </span>
                          </div>
                          <h4 className="font-bold text-xs sm:text-sm leading-relaxed">"{phrase.text}"</h4>
                        </div>

                        <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-800/40">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              recordEuphoniaSample(phrase);
                            }}
                            disabled={isRecordingThis || euphoniaRecorder.isRecording()}
                            className={`px-3 py-1.5 rounded-xl font-black text-[11px] flex items-center justify-center gap-1.5 shadow-md ${
                              isRecordingThis ? 'bg-rose-500 text-white animate-pulse' : 'bg-slate-800 hover:bg-slate-700 text-amber-400'
                            }`}
                          >
                            <Mic className="w-3.5 h-3.5" />
                            <span>{isRecordingThis ? (isArabic ? 'تسجيل...' : 'Recording...') : (isArabic ? 'تسجيل عينة' : 'Record')}</span>
                          </button>

                          <span className="text-[10px] text-slate-400 font-mono">
                            {isFullyTrained ? '🏆 مكتمل' : '⏳ قيد التدريب'}
                          </span>
                        </div>

                        {isHovered && dwellProgress > 0 && (
                          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-slate-950/60 rounded-b-2xl overflow-hidden">
                            <div className="h-full bg-slate-950 transition-all duration-75" style={{ width: `${dwellProgress * 100}%` }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>

              {/* API URL settings — "set the URL of the Cloud Run instance" from repo README */}
              <div className="mt-2 p-4 rounded-2xl bg-slate-950 border border-slate-800">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2">
                  {isArabic ? 'رابط خادم النموذج المخصص (اختياري - Google Cloud Run)' : 'Custom Model API URL (optional - Google Cloud Run)'}
                </h4>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={euphoniaApiUrlInput}
                    onChange={(e) => setEuphoniaApiUrlInput(e.target.value)}
                    placeholder="https://your-cloud-run-service.a.run.app"
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400"
                    dir="ltr"
                  />
                  <button
                    onClick={handleSaveEuphoniaApiUrl}
                    className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 font-black text-slate-950 text-xs"
                  >
                    {isArabic ? 'حفظ واختبار' : 'Save & Test'}
                  </button>
                </div>
                {euphoniaApiHealthy !== null && (
                  <p className={`text-[11px] mt-2 font-bold ${euphoniaApiHealthy ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {euphoniaApiHealthy
                      ? (isArabic ? '✅ متصل — سيُستخدم نموذجك المدرّب في المطابقة الحية' : '✅ Connected — your trained model will be used for live matching')
                      : (isArabic ? '⚠️ غير متصل — سيُستخدم المتصفح كحل احتياطي' : '⚠️ Unreachable — browser ASR will be used as fallback')}
                  </p>
                )}
                <p className="text-[10px] text-slate-500 mt-2">
                  {isArabic
                    ? 'درّب نموذجاً مخصصاً من صوتك عبر training_colabs في مستودع Project Euphonia، وانشره كخدمة، ثم ضع رابطها هنا.'
                    : 'Train a personalized model on your voice via the training_colabs notebooks in the Project Euphonia repo, deploy it as a service, and paste its URL here.'}
                </p>
              </div>
            </div>
          )}

          {/* TAB 3: Steve Saling Smart Room Automation Board */}
          {activeTab === 'smart-room' && (
            <div className="bg-slate-900 rounded-3xl border-2 border-slate-800 p-6 shadow-2xl flex flex-col gap-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div>
                  <h3 className="text-xl font-black text-white flex items-center gap-2">
                    <Zap className="w-6 h-6 text-amber-400" />
                    {isArabic ? 'التحكم في أجهزة الغرفة والسرير (Steve Saling Smart Room)' : 'Smart Room & Bed Automation'}
                  </h3>
                  <p className="text-xs text-slate-400 font-medium mt-1">
                    {isArabic ? 'انظر للزر وأغمض عينك لتشغيل الإضاءة، التكييف، التلفاز، أو استدعاء الممرض' : 'Look and blink to control lights, TV, bed, or nurse alarm'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {SMART_ROOM_ITEMS.map((item) => {
                  const isHovered = hoveredCardId === item.id;
                  const isItemActive =
                    (item.id === 'room-light' && roomLightOn) ||
                    (item.id === 'room-tv' && roomTvOn) ||
                    (item.id === 'room-ac' && roomAcOn);

                  return (
                    <button
                      key={item.id}
                      data-aac-id={item.id}
                      onClick={() => handleCardTrigger(item.id)}
                      className={`relative p-6 rounded-3xl border-2 font-black text-sm flex flex-col items-center justify-center gap-3 transition-all min-h-[140px] ${
                        item.isAlarm
                          ? isHovered
                            ? 'bg-rose-500 text-white border-rose-400 scale-105 shadow-2xl ring-4 ring-rose-500/50'
                            : 'bg-rose-950/40 border-rose-600/50 text-rose-300 hover:bg-rose-900/50'
                          : isItemActive
                          ? `${themeClasses.accentBg} shadow-xl`
                          : isHovered
                          ? `${themeClasses.accentBg} shadow-xl scale-105 ring-2 ring-amber-300`
                          : 'border-slate-800 bg-slate-950 text-white hover:border-slate-700'
                      }`}
                    >
                      <span className="text-4xl">{item.icon}</span>
                      <span className="text-base text-center">{isArabic ? item.labelAr : item.labelEn}</span>
                      {isItemActive && (
                        <span className="text-[11px] font-bold bg-slate-950 text-amber-400 px-3 py-0.5 rounded-full">
                          {isArabic ? 'مفعل الآن' : 'ACTIVE'}
                        </span>
                      )}

                      {isHovered && dwellProgress > 0 && (
                        <div className="absolute bottom-0 left-0 right-0 h-2 bg-slate-950/60 rounded-b-3xl overflow-hidden">
                          <div className="h-full bg-slate-950 transition-all duration-75" style={{ width: `${dwellProgress * 100}%` }} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: Pain & Sensory Health Needs Board */}
          {activeTab === 'pain-sensory' && (
            <div className="bg-slate-900 rounded-3xl border-2 border-slate-800 p-6 shadow-2xl flex flex-col gap-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div>
                  <h3 className="text-xl font-black text-white flex items-center gap-2">
                    <Heart className="w-6 h-6 text-rose-400" />
                    {isArabic ? 'تحديد الألم والاحتياجات الصحية السريعة' : 'Pain & Sensory Needs Assessment'}
                  </h3>
                  <p className="text-xs text-slate-400 font-medium mt-1">
                    {isArabic ? 'انظر للبطاقة وأغمض عينك لإبلاغ المرافق بمكان الألم وشعورك فوراً' : 'Look and blink to express pain and physical needs'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {SENSORY_PAIN_ITEMS.map((item) => {
                  const isHovered = hoveredCardId === item.id;

                  return (
                    <button
                      key={item.id}
                      data-aac-id={item.id}
                      onClick={() => handleCardTrigger(item.id)}
                      className={`relative p-6 rounded-3xl border-2 font-black text-sm flex flex-col items-center justify-center gap-3 transition-all min-h-[140px] ${
                        isHovered
                          ? 'border-rose-400 bg-rose-500 text-white shadow-2xl scale-105 ring-4 ring-rose-400/40'
                          : 'border-slate-800 bg-slate-950 text-white hover:border-rose-500/40'
                      }`}
                    >
                      <span className="text-4xl">{item.icon}</span>
                      <span className="text-base text-center">{item.labelAr}</span>

                      {isHovered && dwellProgress > 0 && (
                        <div className="absolute bottom-0 left-0 right-0 h-2 bg-slate-950/60 rounded-b-3xl overflow-hidden">
                          <div className="h-full bg-slate-950 transition-all duration-75" style={{ width: `${dwellProgress * 100}%` }} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 5: AI Classroom & Teacher Live Responses */}
          {activeTab === 'class-ai' && (
            <div className="bg-slate-900 rounded-3xl border-2 border-slate-800 p-6 shadow-2xl flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row items-center justify-between pb-3 border-b border-slate-800 gap-3">
                <div>
                  <h3 className="text-xl font-black text-white flex items-center gap-2">
                    <GraduationCap className="w-6 h-6 text-indigo-400" />
                    {isArabic ? 'المعلم الذكي والردود التفاعلية بالحصة (AI Classroom Autopilot)' : 'AI Classroom & Teacher Assistant'}
                  </h3>
                  <p className="text-xs text-slate-400 font-medium mt-1">
                    {isArabic ? 'استمع لسؤال المعلم في الفصل، وسيقوم الذكاء الاصطناعي بتوليد 4 ردود ذكية لاختيارها بالعين فوراً' : 'Listen to teacher in room, and AI generates 4 gaze-selectable answers'}
                  </p>
                </div>

                <button
                  onClick={startTeacherClassListener}
                  disabled={isListeningToTeacher}
                  className={`px-5 py-3 rounded-2xl font-black text-xs flex items-center gap-2 shadow-lg transition-all ${
                    isListeningToTeacher
                      ? 'bg-rose-500 text-white animate-pulse'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  }`}
                >
                  <Mic className="w-4 h-4" />
                  <span>{isListeningToTeacher ? (isArabic ? 'جاري الاستماع للمعلم...' : 'Listening...') : (isArabic ? '🎙️ استمع لسؤال المعلم' : 'Listen to Teacher')}</span>
                </button>
              </div>

              {teacherHeardSpeech && (
                <div className="p-3.5 rounded-2xl bg-indigo-950/40 border border-indigo-500/40 text-xs text-indigo-200">
                  <span className="font-bold">{isArabic ? 'ما قاله المعلم: ' : 'Teacher said: '}</span>
                  "{teacherHeardSpeech}"
                </div>
              )}

              <h4 className="font-black text-xs text-amber-400 uppercase tracking-wider">
                {isArabic ? 'اختر ردك بنظرة وغمضة عين:' : 'Select your answer with eye-gaze:'}
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {aiGeneratedClassOptions.map((optText, idx) => {
                  const cardKey = `class-option-${idx}`;
                  const isHovered = hoveredCardId === cardKey;

                  return (
                    <button
                      key={idx}
                      data-aac-id={cardKey}
                      onClick={() => handleCardTrigger(cardKey)}
                      className={`relative p-5 rounded-2xl border-2 font-black text-sm text-start flex items-center gap-3 transition-all min-h-[90px] ${
                        isHovered
                          ? 'border-indigo-400 bg-indigo-600 text-white shadow-2xl scale-105 ring-4 ring-indigo-400/40'
                          : 'border-slate-800 bg-slate-950 text-slate-200 hover:border-indigo-500/40'
                      }`}
                    >
                      <span className="p-2 rounded-xl bg-slate-900 border border-slate-700 text-indigo-400 text-base font-black shrink-0">
                        {idx + 1}
                      </span>
                      <p className="flex-1 text-xs sm:text-sm leading-relaxed">{optText}</p>
                      <Volume2 className="w-5 h-5 text-indigo-400 shrink-0" />

                      {isHovered && dwellProgress > 0 && (
                        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-slate-950/60 rounded-b-2xl overflow-hidden">
                          <div className="h-full bg-slate-950 transition-all duration-75" style={{ width: `${dwellProgress * 100}%` }} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 6: Personal Custom Phrase Bank */}
          {activeTab === 'custom-bank' && (
            <div className="bg-slate-900 rounded-3xl border-2 border-slate-800 p-6 shadow-2xl flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row items-center justify-between pb-3 border-b border-slate-800 gap-3">
                <div>
                  <h3 className="text-xl font-black text-white flex items-center gap-2">
                    <BookmarkPlus className="w-6 h-6 text-amber-400" />
                    {isArabic ? 'بنك العبارات والاحتياجات المخصصة' : 'My Personal Phrase Bank'}
                  </h3>
                  <p className="text-xs text-slate-400 font-medium mt-1">
                    {isArabic ? 'عباراتك الخاصة المخزنة للتحدث بنظرة وغمضة عين واحدة' : 'Your saved personalized phrases for instant eye-gaze speech'}
                  </p>
                </div>
              </div>

              {/* Add Phrase Input */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newPhraseInput}
                  onChange={(e) => setNewPhraseInput(e.target.value)}
                  placeholder={isArabic ? 'اكتب عبارة جديدة لإضافتها لبنكك الشخصي...' : 'Type a new phrase to save...'}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-400"
                />
                <button
                  onClick={handleAddCustomPhrase}
                  className="px-5 py-3 rounded-2xl bg-amber-400 hover:bg-amber-300 font-black text-slate-950 text-xs flex items-center gap-1.5 shadow-md"
                >
                  <Plus className="w-4 h-4" />
                  <span>{isArabic ? 'إضافة' : 'Add'}</span>
                </button>
              </div>

              {/* Phrases Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
                {customPhrases.map((phrase: any) => {
                  const cardKey = `custom-phrase-${phrase.id}`;
                  const isHovered = hoveredCardId === cardKey;

                  return (
                    <div
                      key={phrase.id}
                      data-aac-id={cardKey}
                      onClick={() => handleCardTrigger(cardKey)}
                      className={`relative p-5 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between min-h-[100px] ${
                        isHovered
                          ? 'border-amber-400 bg-amber-400 text-slate-950 shadow-2xl scale-105'
                          : 'border-slate-800 bg-slate-950 text-white hover:border-amber-400/40'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="text-2xl">{phrase.icon || '💬'}</span>
                        <p className="text-xs sm:text-sm font-black leading-relaxed flex-1">
                          "{phrase.textAr}"
                        </p>
                      </div>

                      <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-800/40 text-[10px]">
                        <span className="flex items-center gap-1 font-bold">
                          <Volume2 className="w-3.5 h-3.5" /> {isArabic ? 'نطق فوري' : 'Speak'}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCustomPhrase(phrase.id);
                          }}
                          className="text-rose-400 hover:text-rose-300 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {isHovered && dwellProgress > 0 && (
                        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-slate-950/60 rounded-b-2xl overflow-hidden">
                          <div className="h-full bg-slate-950 transition-all duration-75" style={{ width: `${dwellProgress * 100}%` }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 7: Eye Gaze Games & Accuracy Training */}
          {activeTab === 'eye-games' && (
            <div className="bg-slate-900 rounded-3xl border-2 border-slate-800 p-6 shadow-2xl flex flex-col gap-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div>
                  <h3 className="text-xl font-black text-white flex items-center gap-2">
                    <Gamepad2 className="w-6 h-6 text-amber-400" />
                    {isArabic ? 'تدريب حركة العين وألعاب الدقة والسرعة' : 'Eye-Gaze Accuracy & Speed Training'}
                  </h3>
                  <p className="text-xs text-slate-400 font-medium mt-1">
                    {isArabic ? 'انظر للبالون وأغمض عينك لتفريقعها وتسجيل النقاط وقياس سرعة استجابة العين' : 'Look at balloon and blink to pop, earn score, and measure reaction speed'}
                  </p>
                </div>

                {/* Score & Benchmark Display */}
                <div className="flex items-center gap-3">
                  <div className="px-4 py-2 rounded-2xl bg-amber-400/20 border border-amber-400/40 text-amber-300 text-xs font-black flex items-center gap-1.5">
                    <Trophy className="w-4 h-4 text-amber-400" />
                    <span>{isArabic ? 'النقاط:' : 'Score:'} {gameScore}</span>
                  </div>

                  {reactionBenchmarkMs && (
                    <div className="px-4 py-2 rounded-2xl bg-emerald-400/20 border border-emerald-400/40 text-emerald-300 text-xs font-black flex items-center gap-1.5">
                      <Gauge className="w-4 h-4 text-emerald-400" />
                      <span>{reactionBenchmarkMs}ms</span>
                    </div>
                  )}

                  <button
                    onClick={() => {
                      setGamePoppedIds([]);
                      reactionStartTimeRef.current = Date.now();
                      reactionSamplesRef.current = [];
                    }}
                    className="px-3 py-2 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Game Area */}
              <div className="relative aspect-video rounded-3xl bg-slate-950 border-2 border-slate-800 overflow-hidden p-6 flex items-center justify-center">
                {GAME_BUBBLES.map((bubble) => {
                  const cardKey = `game-bubble-${bubble.id}`;
                  const isPopped = gamePoppedIds.includes(bubble.id);
                  const isHovered = hoveredCardId === cardKey;

                  if (isPopped) return null;

                  return (
                    <button
                      key={bubble.id}
                      data-aac-id={cardKey}
                      onClick={() => handleCardTrigger(cardKey)}
                      className={`absolute w-20 h-20 rounded-full font-black text-2xl flex items-center justify-center shadow-2xl transition-all duration-200 cursor-pointer ${bubble.color} ${
                        isHovered ? 'scale-125 ring-4 ring-white animate-bounce' : 'animate-pulse'
                      }`}
                      style={{
                        left: `${bubble.x}%`,
                        top: `${bubble.y}%`,
                        transform: 'translate(-50%, -50%)',
                      }}
                    >
                      <span>{bubble.char}</span>
                      {isHovered && dwellProgress > 0 && (
                        <div className="absolute inset-0 rounded-full border-4 border-white animate-spin" />
                      )}
                    </button>
                  );
                })}

                {gamePoppedIds.length === GAME_BUBBLES.length && (
                  <div className="text-center animate-fade-in">
                    <Trophy className="w-16 h-16 text-amber-400 mx-auto mb-2 drop-shadow-[0_0_20px_#fbbf24]" />
                    <h3 className="text-2xl font-black text-white">
                      {isArabic ? 'أحسنت! فرقعت كل البالونات بنجاح!' : 'Level Complete!'}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      {isArabic
                        ? `معدل سرعة استجابة بؤبؤ العين: ${reactionBenchmarkMs ? reactionBenchmarkMs + 'ms' : '—'}`
                        : `Average eye reaction: ${reactionBenchmarkMs ? reactionBenchmarkMs + 'ms' : '—'}`}
                    </p>
                    <button
                      onClick={() => {
                        setGamePoppedIds([]);
                        reactionStartTimeRef.current = Date.now();
                      reactionSamplesRef.current = [];
                      }}
                      className="mt-4 px-6 py-3 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs shadow-lg"
                    >
                      {isArabic ? 'العب جولة جديدة' : 'Play Again'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quick Needs Row — hidden on the Eye Keyboard tab so it stops competing
              with the keyboard's own bottom row for vertical space. */}
          {activeTab !== 'keyboard' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
            {QUICK_NEEDS.map((need) => {
              const isHovered = hoveredCardId === need.id;

              return (
                <button
                  key={need.id}
                  data-aac-id={need.id}
                  onClick={() => handleCardTrigger(need.id)}
                  className={`relative p-3.5 rounded-2xl border-2 font-black text-xs flex flex-col items-center justify-center gap-1.5 transition-all min-h-[76px] ${
                    isHovered
                      ? 'border-amber-400 bg-amber-400 text-slate-950 shadow-xl scale-105 ring-2 ring-amber-300'
                      : 'border-slate-800 bg-slate-900 text-white hover:border-slate-700'
                  }`}
                >
                  <span className="text-2xl">{need.icon}</span>
                  <span className="truncate">{isArabic ? need.labelAr : need.labelEn}</span>

                  {isHovered && dwellProgress > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-950 rounded-b-2xl overflow-hidden">
                      <div className="h-full bg-slate-950 transition-all duration-75" style={{ width: `${dwellProgress * 100}%` }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          )}

          {/* AI Mentor Answer Display */}
          {aiResponseText && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-3xl bg-slate-900 border-2 border-indigo-500/40 shadow-xl"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-indigo-400 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4" />
                  {isArabic ? 'إجابة مرشدك الدراسي الذكي (Cognify AI)' : 'Cognify AI Mentor Answer'}
                </span>
                <button
                  onClick={() => speakSafe(aiResponseText)}
                  className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 text-xs font-bold flex items-center gap-1"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>{isArabic ? 'إعادة القراءة' : 'Read'}</span>
                </button>
              </div>
              <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                {aiResponseText}
              </p>
            </motion.div>
          )}
        </div>
      </div>
      </div>

      {/* 9-POINT MEDICAL EYE CALIBRATION MODAL */}
      <AnimatePresence>
        {showCalibrationModal && (
          <div className="fixed inset-0 z-[100000] bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center p-6">
            <div className="absolute top-8 text-center">
              <h2 className="text-2xl font-black text-amber-400 flex items-center justify-center gap-2">
                <Target className="w-7 h-7" />
                {isArabic ? 'معايرة النظر الطبية المتقدمة (9-Point Eye Calibration)' : '9-Point Eye Calibration'}
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {isArabic ? 'ثبّت رأسك وانظر بعينيك فقط إلى الدائرة الصفراء أينما ظهرت' : 'Keep head still, look only with your eyes at the glowing yellow circle'}
              </p>
              <p className="text-xs font-bold text-emerald-400 mt-2">
                {isCalibrating
                  ? `${isArabic ? 'نقطة المعايرة:' : 'Point:'} ${calibrationPointIndex + 1} / 9`
                  : calibAccuracy != null
                    ? `${isArabic ? 'دقة المعايرة:' : 'Calibration accuracy:'} ${Math.round(calibAccuracy * 100)}%`
                    : (isArabic ? 'لم تكتمل المعايرة — أعد المحاولة' : 'Calibration incomplete — please retry')}
              </p>
            </div>

            {/* Glowing Calibration Target Dot */}
            {isCalibrating && (
              <motion.div
                key={calibrationPointIndex}
                initial={{ scale: 0.2, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.2, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="absolute w-20 h-20 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none"
                style={{
                  left: CALIBRATION_POINTS[calibrationPointIndex].x,
                  top: CALIBRATION_POINTS[calibrationPointIndex].y,
                }}
              >
                <div className="w-16 h-16 rounded-full bg-amber-400/20 animate-ping absolute" />
                <div className="w-12 h-12 rounded-full border-4 border-amber-300 flex items-center justify-center bg-amber-400 shadow-[0_0_30px_#fbbf24]">
                  <div className="w-3 h-3 rounded-full bg-slate-950" />
                </div>
              </motion.div>
            )}

            {!isCalibrating && (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex flex-col items-center gap-3 text-center"
              >
                {calibSucceeded === false ? (
                  <>
                    <XCircle className="w-16 h-16 text-rose-400 drop-shadow-[0_0_20px_rgba(251,113,133,0.8)]" />
                    <h3 className="text-xl font-black text-white">
                      {isArabic ? 'تعذّرت المعايرة' : 'Calibration Failed'}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {isArabic
                        ? 'ثبّت رأسك أكثر وجرّب مرة أخرى — تم الاحتفاظ بالمعايرة السابقة'
                        : 'Keep your head steadier and try again — your previous calibration was kept'}
                    </p>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-16 h-16 text-emerald-400 drop-shadow-[0_0_20px_rgba(52,211,153,0.8)]" />
                    <h3 className="text-xl font-black text-white">
                      {isArabic ? 'تمت المعايرة بنجاح!' : 'Calibration Complete!'}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {isArabic
                        ? `دقة تقديرية ${Math.round((calibAccuracy ?? 0) * 100)}%`
                        : `Estimated accuracy ${Math.round((calibAccuracy ?? 0) * 100)}%`}
                    </p>
                  </>
                )}
              </motion.div>
            )}

            <button
              onClick={() => {
                // Abort the running chain, drop the half-collected samples, and
                // keep whatever mapping was in place before this attempt.
                calibAbortRef.current++;
                setIsCalibrating(false);
                try { trackerRef.current?.resetCalibration(); } catch { /* ignore */ }
                setShowCalibrationModal(false);
              }}
              className="absolute bottom-8 px-6 py-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold text-xs"
            >
              {isArabic ? 'إلغاء المعايرة' : 'Cancel'}
            </button>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 1: Hands-Free Phone Call Dialer */}
      <AnimatePresence>
        {/* The switch itself. Deliberately carries no data-aac-id: it must never
            become one of the targets the scan walks over. */}
        {headConfig.autoScanEnabled && (
          <div className="fixed inset-x-0 bottom-0 z-[60] p-3 flex justify-center pointer-events-none">
            <button
              onClick={() => scanSwitchRef.current()}
              aria-label={scanStatusLabel}
              className="pointer-events-auto w-full max-w-2xl py-5 rounded-3xl bg-amber-400 hover:bg-amber-300 active:bg-amber-500 text-slate-950 font-black text-xl border-4 border-amber-200 shadow-[0_-6px_44px_rgba(251,191,36,0.55)] flex items-center justify-center gap-3"
            >
              <ScanLine className="w-7 h-7" />
              <span>{scanStatusLabel}</span>
            </button>
          </div>
        )}

        {showContactPickerModal && (
          <div
            data-scan-root
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-6 max-w-2xl w-full shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
                <div className="flex items-center gap-3">
                  <span className="p-2.5 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    <PhoneCall className="w-6 h-6" />
                  </span>
                  <div>
                    <h3 className="font-black text-lg text-white">
                      {isArabic ? 'الاتصال الهاتفي بالعين والرأس' : 'Eye-Gaze Phone Dialer'}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {isArabic ? 'انظر لأي جهة اتصال وأغمض عينك للاتصال فوراً' : 'Look at contact and blink to call'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowManageContactsModal(true)}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1.5"
                  >
                    <Users className="w-4 h-4" />
                    {isArabic ? 'إدارة الأرقام' : 'Manage numbers'}
                  </button>
                  <button
                    onClick={() => setShowContactPickerModal(false)}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Voice Listener Bar */}
              <div className="mb-4 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-full ${isListeningForContactName ? 'bg-rose-500 text-white animate-pulse' : 'bg-emerald-500 text-slate-950'}`}>
                    <Mic className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-white">
                      {isListeningForContactName
                        ? (isArabic ? 'جاري الاستماع... انطق اسم الشخص' : 'Listening...')
                        : (isArabic ? 'يمكنك أيضاً نطق اسم الشخص للاتصال' : 'Voice dialing')}
                    </h4>
                  </div>
                </div>
                <button
                  onClick={startVoiceContactListener}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black transition-all shadow-md flex items-center gap-1.5"
                >
                  <Mic className="w-4 h-4" />
                  <span>{isListeningForContactName ? (isArabic ? 'استماع...' : 'Listening...') : (isArabic ? 'انطق الاسم' : 'Speak Name')}</span>
                </button>
              </div>

              {/* Contacts Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {contacts.map((c) => {
                  const cardKey = `call-contact-${c.id}`;
                  const isHovered = hoveredCardId === cardKey;
                  const hasNumber = isValidContactPhone(c.phone);

                  return (
                    <div
                      key={c.id}
                      data-aac-id={cardKey}
                      onClick={() => handleCardTrigger(cardKey)}
                      className={`relative p-5 rounded-2xl border-2 transition-all cursor-pointer flex items-center gap-4 ${
                        isHovered
                          ? 'border-amber-400 bg-amber-400 text-slate-950 shadow-2xl scale-105'
                          : 'border-slate-800 bg-slate-950 hover:border-amber-400/50'
                      }`}
                    >
                      <span className="text-4xl">{c.avatar}</span>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-black text-base truncate">
                          {isArabic ? c.nameAr : c.nameEn}
                        </h4>
                        {hasNumber ? (
                          <p className="text-xs opacity-75 font-mono mt-0.5">{c.phone}</p>
                        ) : (
                          <p className="text-xs mt-0.5 font-bold text-rose-400">
                            {isArabic ? '⚠ لا يوجد رقم محفوظ' : '⚠ No number saved'}
                          </p>
                        )}
                      </div>
                      <Phone className={`w-6 h-6 shrink-0 ${hasNumber ? 'text-emerald-400' : 'text-slate-600'}`} />

                      {isHovered && dwellProgress > 0 && (
                        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-slate-950/50 rounded-b-2xl overflow-hidden">
                          <div className="h-full bg-slate-950 transition-all duration-75" style={{ width: `${dwellProgress * 100}%` }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 2: Hands-Free WhatsApp Message Sender */}
      <AnimatePresence>
        {showWhatsAppModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-6 max-w-2xl w-full shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
                <div className="flex items-center gap-3">
                  <span className="p-2.5 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    <MessageCircle className="w-6 h-6" />
                  </span>
                  <div>
                    <h3 className="font-black text-lg text-white">
                      {isArabic ? 'إرسال رسالة واتساب بدون لمس' : 'Hands-Free WhatsApp Sender'}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {selectedContactForWa
                        ? (isArabic ? `اختر الرسالة لـ: ${selectedContactForWa.nameAr}` : `Select message for: ${selectedContactForWa.nameEn}`)
                        : (isArabic ? 'اختر جهة الاتصال بالعين' : 'Select recipient')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowWhatsAppModal(false)}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Step 1: Select Contact */}
              {!selectedContactForWa ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {contacts.map((c) => {
                    const cardKey = `wa-contact-${c.id}`;
                    const isHovered = hoveredCardId === cardKey;

                    return (
                      <div
                        key={c.id}
                        data-aac-id={cardKey}
                        onClick={() => handleCardTrigger(cardKey)}
                        className={`relative p-5 rounded-2xl border-2 transition-all cursor-pointer flex items-center gap-4 ${
                          isHovered
                            ? 'border-emerald-400 bg-emerald-400 text-slate-950 shadow-2xl scale-105'
                            : 'border-slate-800 bg-slate-950 hover:border-emerald-400/50'
                        }`}
                      >
                        <span className="text-4xl">{c.avatar}</span>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-black text-base truncate">
                            {isArabic ? c.nameAr : c.nameEn}
                          </h4>
                          <p className="text-xs opacity-75 font-mono">{c.phone}</p>
                        </div>
                        <MessageCircle className="w-6 h-6 text-emerald-400 shrink-0" />

                        {isHovered && dwellProgress > 0 && (
                          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-slate-950/50 rounded-b-2xl overflow-hidden">
                            <div className="h-full bg-slate-950 transition-all duration-75" style={{ width: `${dwellProgress * 100}%` }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Step 2: Select Quick Message Phrase or Send Custom Text */
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-950 border border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{selectedContactForWa.avatar}</span>
                      <span className="font-black text-sm text-white">
                        {isArabic ? selectedContactForWa.nameAr : selectedContactForWa.nameEn} ({selectedContactForWa.phone})
                      </span>
                    </div>
                    <button
                      onClick={() => setSelectedContactForWa(null)}
                      className="text-xs text-amber-400 hover:underline font-bold"
                    >
                      {isArabic ? 'تغيير المستلم' : 'Change'}
                    </button>
                  </div>

                  <h4 className="font-black text-xs text-slate-400 uppercase tracking-wider">
                    {isArabic ? 'اختر رسالة جاهزة أو أرسل ما كتبته في الكيبورد:' : 'Select message:'}
                  </h4>

                  {/* Send Typed Text Button if text exists */}
                  {typedText.trim() && (
                    <button
                      onClick={() => {
                        sendWhatsAppMessage(selectedContactForWa.phone, typedText);
                        setShowWhatsAppModal(false);
                        setSelectedContactForWa(null);
                      }}
                      className="w-full p-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 font-black text-slate-950 text-sm flex items-center justify-center gap-2 shadow-lg"
                    >
                      <Send className="w-4 h-4" />
                      <span>{isArabic ? `إرسال النص المكتوب: "${typedText}"` : `Send typed text`}</span>
                    </button>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {WHATSAPP_QUICK_MESSAGES.map((msg) => {
                      const cardKey = `wa-msg-${msg.id}`;
                      const isHovered = hoveredCardId === cardKey;

                      return (
                        <div
                          key={msg.id}
                          data-aac-id={cardKey}
                          onClick={() => handleCardTrigger(cardKey)}
                          className={`relative p-4 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between min-h-[90px] ${
                            isHovered
                              ? 'border-emerald-400 bg-emerald-400 text-slate-950 shadow-2xl scale-105'
                              : 'border-slate-800 bg-slate-950 hover:border-emerald-400/50'
                          }`}
                        >
                          <p className="text-xs font-black leading-relaxed">
                            "{isArabic ? msg.textAr : msg.textEn}"
                          </p>
                          <span className="text-[10px] font-bold flex items-center gap-1 mt-2 opacity-80">
                            <Send className="w-3 h-3" /> {isArabic ? 'إرسال' : 'Send'}
                          </span>

                          {isHovered && dwellProgress > 0 && (
                            <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-slate-950/50 rounded-b-2xl overflow-hidden">
                              <div className="h-full bg-slate-950 transition-all duration-75" style={{ width: `${dwellProgress * 100}%` }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 2.5: Manage emergency/WhatsApp contact numbers.
          A plain form — not gaze/blink-driven — because this is one-time
          setup a caregiver does with a keyboard, not something the student
          operates hands-free. Before this modal existed, there was no way
          in the whole app to set a real number: the shipped defaults were
          placeholder digits and nothing ever called saveContacts(). */}
      <AnimatePresence>
        {showManageContactsModal && (
          <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
                <div className="flex items-center gap-3">
                  <span className="p-2.5 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    <Users className="w-6 h-6" />
                  </span>
                  <div>
                    <h3 className="font-black text-lg text-white">
                      {isArabic ? 'إدارة أرقام الطوارئ' : 'Manage Emergency Numbers'}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {isArabic
                        ? 'الأرقام دي بتتحفظ على الجهاز ده بس. اطلب من المرافق أو ولي الأمر يملأها.'
                        : 'Saved on this device only. Ask a caregiver/parent to fill these in.'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowManageContactsModal(false)}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3">
                {contacts.map((c) => (
                  <div key={c.id} className="p-3 rounded-2xl bg-slate-950 border border-slate-800">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xl">{c.avatar}</span>
                      <span className="font-bold text-sm text-white">{isArabic ? c.nameAr : c.nameEn}</span>
                      {c.isPrimaryEmergency && (
                        <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">
                          {isArabic ? 'الطوارئ الأساسي' : 'Primary SOS'}
                        </span>
                      )}
                    </div>
                    <input
                      type="tel"
                      dir="ltr"
                      value={c.phone}
                      onChange={(e) => {
                        const phone = e.target.value;
                        setContacts((prev) => {
                          const updated = prev.map((x) => (x.id === c.id ? { ...x, phone } : x));
                          saveContacts(updated);
                          return updated;
                        });
                      }}
                      placeholder={isArabic ? 'مثال: 01012345678+' : 'e.g. +201012345678'}
                      className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono text-sm focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                ))}
              </div>

              <button
                onClick={() => {
                  setShowManageContactsModal(false);
                  toast.success(isArabic ? 'تم حفظ الأرقام' : 'Numbers saved');
                }}
                className="mt-4 w-full py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black flex items-center justify-center gap-2"
              >
                <Check className="w-5 h-5" />
                {isArabic ? 'تم' : 'Done'}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 3: Settings & Calibration */}
      <AnimatePresence>
        {showConfigModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
                <h3 className="font-black text-lg text-white flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-amber-400" />
                  {isArabic ? 'إعدادات ومعايرة تتبع حركة العين' : 'Eye-Gaze Calibration'}
                </h3>
                <button
                  onClick={() => setShowConfigModal(false)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-5 text-sm">
                {/* Dwell Time Slider */}
                <div>
                  <div className="flex justify-between font-bold text-white mb-1">
                    <span>{isArabic ? 'مدة الثبات بالعين (Dwell Time):' : 'Dwell Time:'}</span>
                    <span className="text-amber-400">{(headConfig.dwellTimeMs / 1000).toFixed(1)}s</span>
                  </div>
                  <input
                    type="range"
                    min="600"
                    max="2500"
                    step="100"
                    value={headConfig.dwellTimeMs}
                    onChange={(e) => updateHeadConfig({ dwellTimeMs: Number(e.target.value) })}
                    className="w-full accent-amber-400"
                  />
                </div>

                {/* Eye Sensitivity */}
                <div>
                  <div className="flex justify-between font-bold text-white mb-1">
                    <span>{isArabic ? 'حساسية حركة بؤبؤ العين:' : 'Eye Sensitivity:'}</span>
                    <span className="text-amber-400">{headConfig.sensitivity.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min="1.0"
                    max="4.5"
                    step="0.2"
                    value={headConfig.sensitivity}
                    onChange={(e) => updateHeadConfig({ sensitivity: Number(e.target.value) })}
                    className="w-full accent-amber-400"
                  />
                </div>

                {/* Pointer steadiness */}
                <div className="py-2 border-t border-slate-800">
                  <div className="flex items-center justify-between text-[12px] font-bold mb-1">
                    <span className="text-white">
                      {isArabic ? 'ثبات المؤشر' : 'Pointer steadiness'}
                    </span>
                    <span className="text-amber-400">
                      {Math.round((headConfig.smoothing ?? 0.55) * 100)}%
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mb-2">
                    {isArabic
                      ? 'لو المؤشر بيرجف وصعب يثبت على الحرف — زوّد الرقم ده. الحساسية بتتحكم في المدى، ودي بتتحكم في الهدوء.'
                      : 'If the pointer shakes and will not settle on a key, raise this. Sensitivity controls reach; this controls calm.'}
                  </p>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={headConfig.smoothing ?? 0.55}
                    onChange={(e) => updateHeadConfig({ smoothing: Number(e.target.value) })}
                    className="w-full accent-amber-400"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                    <span>{isArabic ? 'أسرع استجابة' : 'Fastest'}</span>
                    <span>{isArabic ? 'أثبت مؤشر' : 'Steadiest'}</span>
                  </div>
                </div>

                {/* Facial Expression Triggers Toggle */}
                <div className="flex items-center justify-between py-2 border-t border-slate-800">
                  <div>
                    <p className="font-bold text-white">
                      {isArabic ? 'النقر بغمضة العين والابتسامة' : 'Blink & Smile Clicks'}
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={headConfig.facialTriggersEnabled}
                    onChange={(e) => updateHeadConfig({ facialTriggersEnabled: e.target.checked })}
                    className="w-5 h-5 accent-amber-400 rounded"
                  />
                </div>

                {/* Single-switch auto scanning */}
                <div className="py-2 border-t border-slate-800">
                  <div className="flex items-center justify-between">
                    <div className="pe-3">
                      <p className="font-bold text-white flex items-center gap-1.5">
                        <ScanLine className="w-4 h-4 text-amber-400" />
                        {isArabic ? 'المسح التلقائي (مفتاح واحد)' : 'Auto-Scan (single switch)'}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {isArabic
                          ? 'البرنامج يتنقل بين الأزرار بنفسه، وأنت تختار بأي إشارة: غمضة، ابتسامة، صوت، مسطرة المسافة، أو الزر الكبير.'
                          : 'The app moves between buttons itself; choose with any signal — blink, smile, a sound, the Space key, or the big button.'}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={!!headConfig.autoScanEnabled}
                      onChange={(e) => updateHeadConfig({ autoScanEnabled: e.target.checked })}
                      className="w-5 h-5 accent-amber-400 rounded shrink-0"
                    />
                  </div>

                  {headConfig.autoScanEnabled && (
                    <div className="mt-3 space-y-3 ps-1">
                      <div className="flex gap-2">
                        {(['row-column', 'linear'] as const).map((m) => (
                          <button
                            key={m}
                            onClick={() => updateHeadConfig({ autoScanMode: m })}
                            className={`flex-1 py-2 rounded-xl text-[11px] font-bold border-2 transition ${
                              (headConfig.autoScanMode || 'row-column') === m
                                ? 'bg-amber-400 text-slate-950 border-amber-300'
                                : 'bg-slate-900 text-slate-300 border-slate-700'
                            }`}
                          >
                            {m === 'row-column'
                              ? (isArabic ? 'صف ثم زر (أسرع)' : 'Row then item (faster)')
                              : (isArabic ? 'زر بزر' : 'One by one')}
                          </button>
                        ))}
                      </div>
                      <div>
                        <div className="flex items-center justify-between text-[11px] font-bold text-slate-300 mb-1">
                          <span>{isArabic ? 'سرعة المسح' : 'Scan speed'}</span>
                          <span className="text-amber-400">
                            {((headConfig.autoScanIntervalMs || 1400) / 1000).toFixed(1)}
                            {isArabic ? ' ث' : 's'}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={600}
                          max={5000}
                          step={100}
                          value={headConfig.autoScanIntervalMs || 1400}
                          onChange={(e) => updateHeadConfig({ autoScanIntervalMs: Number(e.target.value) })}
                          className="w-full accent-amber-400"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Vocal sound triggers — tuned to this student's own voice */}
                <div className="py-2 border-t border-slate-800">
                  <p className="font-bold text-white flex items-center gap-1.5">
                    <Mic className="w-4 h-4 text-emerald-400" />
                    {isArabic ? 'الأصوات الصوتية' : 'Vocal Sounds'}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 mb-2">
                    {isArabic
                      ? 'اضغط «سجّل صوتي» واعمل الصوت — البرنامج هيضبط نفسه على طبقة صوتك بدل الأرقام الافتراضية.'
                      : "Press Record my sound and make it — the app tunes itself to the student's own pitch instead of the defaults."}
                  </p>

                  {!isAudioEngineActive && (
                    <p className="text-[11px] text-amber-400/90 mb-2">
                      {isArabic
                        ? '⚠️ شغّل «أصوات إيفونيا» الأول علشان الميكروفون يشتغل.'
                        : '⚠️ Turn on Vocal Sounds first so the microphone is live.'}
                    </p>
                  )}

                  <div className="space-y-2.5">
                    {triggers.map((t) => (
                      <div key={t.id} className="rounded-2xl bg-slate-950/60 border border-slate-800 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-white text-[12px] truncate">
                            {isArabic ? t.nameAr : t.name}
                          </span>
                          <input
                            type="checkbox"
                            checked={t.enabled}
                            onChange={(e) => updateTrigger(t.id, { enabled: e.target.checked })}
                            className="w-4 h-4 accent-emerald-400 rounded shrink-0"
                          />
                        </div>

                        <select
                          value={t.action}
                          onChange={(e) => updateTrigger(t.id, { action: e.target.value as VocalTriggerAction })}
                          className="mt-2 w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-1.5 text-[11px] text-slate-200"
                        >
                          {VOCAL_ACTION_LABELS.map((a) => (
                            <option key={a.value} value={a.value}>{isArabic ? a.ar : a.en}</option>
                          ))}
                        </select>

                        <div className="mt-2 flex items-center gap-2">
                          <button
                            onClick={() => captureVocalTrigger(t.id)}
                            disabled={!!capturingTriggerId}
                            className={`flex-1 py-1.5 rounded-xl text-[11px] font-bold border-2 transition ${
                              capturingTriggerId === t.id
                                ? 'bg-rose-500 text-white border-rose-400 animate-pulse'
                                : 'bg-emerald-500 text-slate-950 border-emerald-400 disabled:opacity-40'
                            }`}
                          >
                            {capturingTriggerId === t.id
                              ? (isArabic ? 'اعمل الصوت دلوقتي...' : 'Make your sound...')
                              : (isArabic ? '🎙️ سجّل صوتي' : '🎙️ Record my sound')}
                          </button>
                          <span className="text-[11px] font-mono text-emerald-400 w-16 text-center shrink-0">
                            {t.targetFrequencyHz} Hz
                          </span>
                        </div>

                        <div className="mt-2">
                          <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 mb-1">
                            <span>{isArabic ? 'الحساسية (أقل = أسهل)' : 'Sensitivity (lower = easier)'}</span>
                            <span className="text-emerald-400">{t.minEnergyThreshold.toFixed(3)}</span>
                          </div>
                          <input
                            type="range"
                            min={0.01}
                            max={0.2}
                            step={0.005}
                            value={t.minEnergyThreshold}
                            onChange={(e) => updateTrigger(t.id, { minEnergyThreshold: Number(e.target.value) })}
                            className="w-full accent-emerald-400"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Calibration Accuracy Indicator */}
                {calibAccuracy !== null && (
                  <div className="flex items-center justify-between py-2 border-t border-slate-800 text-xs">
                    <span className="font-bold text-slate-300">
                      {isArabic ? 'دقة آخر معايرة (9 نقاط):' : 'Last 9-Point Calibration:'}
                    </span>
                    <span className={`font-mono font-bold px-2 py-0.5 rounded-full ${
                      calibAccuracy > 0.7 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                    }`}>
                      {Math.round(calibAccuracy * 100)}%
                    </span>
                  </div>
                )}

                <div className="pt-4 border-t border-slate-800">
                  <button
                    onClick={() => setShowConfigModal(false)}
                    className="w-full py-3 rounded-2xl bg-amber-400 hover:bg-amber-300 font-black text-slate-950 transition-all shadow-lg"
                  >
                    {isArabic ? 'حفظ وإغلاق' : 'Save & Close'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 4: Scientific 5-Component Eye-Tracking Architecture Monitor */}
      <AnimatePresence>
        {showScientificArchitectureModal && (
          <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border-2 border-cyan-500/40 rounded-3xl p-6 max-w-4xl w-full shadow-2xl overflow-y-auto max-h-[92vh] text-white"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-5">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 shadow-lg">
                    <Activity className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-black text-lg text-white">
                      {isArabic ? '🔬 المخطط العلمي والفيزيائي لتتبع حركة العين (5 Components)' : 'Scientific 5-Component Eye-Tracking Architecture'}
                    </h3>
                    <p className="text-xs text-slate-400 font-medium">
                      {isArabic ? 'نمذجة تفصيلية حية لخطوات القياس والمعالجة ونطاق العمل والربط الرياضي مع الشاشة' : 'Real-time telemetry of camera, 3D headbox, iris measurements, blink detection, and screen mapping'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowScientificArchitectureModal(false)}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 5-Step Pipeline Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                {/* Step 1: Eye tracking camera */}
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 relative overflow-hidden flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-2">
                    <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 font-black text-xs flex items-center justify-center border border-cyan-500/40">
                      1
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">
                      {isCameraActive ? 'LIVE 60 FPS' : 'STANDBY'}
                    </span>
                  </div>
                  <h4 className="font-black text-sm text-cyan-300 mb-1">
                    {isArabic ? '1. كاميرا تتبع حركة العين' : '1. Eye Tracking Camera'}
                  </h4>
                  <p className="text-xs text-slate-400 mb-3">
                    {isArabic ? 'مستشعر الرؤية عالي الدقة المعالج لموجات الضوء والوجه.' : 'High-resolution optical feed capturing 478 3D facial landmarks.'}
                  </p>
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] font-mono space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Resolution:</span>
                      <span className="text-white">640 × 480 px</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Deep Learning:</span>
                      <span className="text-emerald-400">MediaPipe Mesh</span>
                    </div>
                  </div>
                </div>

                {/* Step 2: Working range of camera / Headbox */}
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 relative overflow-hidden flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-2">
                    <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 font-black text-xs flex items-center justify-center border border-cyan-500/40">
                      2
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                      eyeLiveMetrics?.isWithinWorkingRange
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    }`}>
                      {eyeLiveMetrics?.isWithinWorkingRange ? 'IN RANGE ✓' : 'OUT OF RANGE ⚠️'}
                    </span>
                  </div>
                  <h4 className="font-black text-sm text-cyan-300 mb-1">
                    {isArabic ? '2. نطاق عمل الكاميرا (3D Headbox)' : '2. Camera Working Range'}
                  </h4>
                  <p className="text-xs text-slate-400 mb-3">
                    {isArabic ? 'حجم المنشور الهرمي ثلاثي الأبعاد المسموح لحركة الرأس والعينين.' : '3D headbox volume for user positioning.'}
                  </p>
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] font-mono space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Distance:</span>
                      <span className="text-amber-400 font-bold">{eyeLiveMetrics?.distanceCm || 58} cm</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Optimal Range:</span>
                      <span className="text-slate-300">40 – 80 cm</span>
                    </div>
                  </div>
                </div>

                {/* Step 3: Pupil center measured by camera */}
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 relative overflow-hidden flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-2">
                    <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 font-black text-xs flex items-center justify-center border border-cyan-500/40">
                      3
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-pink-500/20 text-pink-400 border border-pink-500/30 font-bold">
                      SUB-PIXEL IRIS
                    </span>
                  </div>
                  <h4 className="font-black text-sm text-cyan-300 mb-1">
                    {isArabic ? '3. قياس مركز بؤبؤ العين' : '3. Pupil/Iris Center Measurement'}
                  </h4>
                  <p className="text-xs text-slate-400 mb-3">
                    {isArabic ? 'استخراج إحداثيات مركز القزحية بدقة أجزاء الملليمتر (468 & 473).' : '3D iris centroid extracted relative to eye corners.'}
                  </p>
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] font-mono space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Left Iris (468):</span>
                      <span className="text-pink-400">{(eyeLiveMetrics?.leftPupil?.x * 100 || 50).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Right Iris (473):</span>
                      <span className="text-pink-400">{(eyeLiveMetrics?.rightPupil?.x * 100 || 50).toFixed(1)}%</span>
                    </div>
                  </div>
                </div>

                {/* Step 4: Image processing algorithm & blink detection */}
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 relative overflow-hidden flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-2">
                    <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 font-black text-xs flex items-center justify-center border border-cyan-500/40">
                      4
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                      gestureState.isBlinking
                        ? 'bg-rose-500 text-white animate-pulse'
                        : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    }`}>
                      {gestureState.isBlinking ? 'BLINK DETECTED 👁️' : 'EYES OPEN'}
                    </span>
                  </div>
                  <h4 className="font-black text-sm text-cyan-300 mb-1">
                    {isArabic ? '4. خوارزمية معالجة الصورة واكتشاف الغمض' : '4. Blink & Gesture Algorithm'}
                  </h4>
                  <p className="text-xs text-slate-400 mb-3">
                    {isArabic ? 'حساب نسبة اتساع العين (EAR) للتمييز بين الرمش الطبيعي والغمض الإرادي للكتابة.' : 'Eye Aspect Ratio (EAR) filters involuntary vs deliberate blinks.'}
                  </p>
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] font-mono space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-400">EAR Metric:</span>
                      <span className="text-amber-300 font-bold">{eyeLiveMetrics?.avgEAR ? eyeLiveMetrics.avgEAR.toFixed(3) : '0.285'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Click Trigger:</span>
                      <span className="text-slate-300">EAR &lt; 0.190 for &gt;110ms</span>
                    </div>
                  </div>
                </div>

                {/* Step 5: Mathematical mapping models to screen coordinates */}
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 relative overflow-hidden flex flex-col justify-between md:col-span-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 font-black text-xs flex items-center justify-center border border-cyan-500/40">
                      5
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-purple-500/20 text-purple-400 border border-purple-500/30 font-bold">
                      POLYNOMIAL MAPPING MATRIX
                    </span>
                  </div>
                  <h4 className="font-black text-sm text-cyan-300 mb-1">
                    {isArabic ? '5. النموذج الرياضي للربط مع إحداثيات الشاشة' : '5. Mathematical Screen Mapping Model'}
                  </h4>
                  <p className="text-xs text-slate-400 mb-3">
                    {isArabic ? 'تحويل متجه النظر الزاوي (Gaze Angle Vector) إلى بكسلات الشاشة (Screen X, Y) باستخدام مصفوفة المعايرة والتسارع اللاخطي والتثبيت المغناطيسي.' : 'Translates raw gaze vector into accurate on-screen pixels with magnetic target locking.'}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] font-mono">
                    <div>
                      <span className="text-slate-400 block">Screen Target:</span>
                      <span className="text-white font-bold">({Math.round(cursorPos.x)}px, {Math.round(cursorPos.y)}px)</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Magnetic Snapping:</span>
                      <span className={cursorPos.isSnapped ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                        {cursorPos.isSnapped ? 'LOCKED ON KEY ✓' : 'FREE GAZE'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Mapping Equation:</span>
                      <span className="text-cyan-400 font-bold">S = W × (0.5 + a·ΔG^1.1)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Close Button */}
              <button
                onClick={() => setShowScientificArchitectureModal(false)}
                className="w-full py-3.5 rounded-2xl bg-cyan-400 hover:bg-cyan-300 font-black text-slate-950 transition-all shadow-lg text-sm flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                <span>{isArabic ? 'العودة لواجهة التحكم والكيبورد' : 'Return to Communicator'}</span>
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
