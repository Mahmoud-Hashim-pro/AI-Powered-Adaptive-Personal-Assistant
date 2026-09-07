/**
 * Visual Companion (الرفيق البصري) — Life-assistant full-screen camera tool
 * for blind and visually impaired users.
 *
 * Capabilities:
 * 1. Full-screen camera viewport with floating ergonomic accessible HUD.
 * 2. Two distinct language choices: Arabic (عربي) and English.
 * 3. Automatic "Repeat Aloud" audio readout (TTS) immediately upon generation.
 * 4. "Remember this as..." feature for persistent object & face recognition.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Camera,
  Volume2,
  BookmarkPlus,
  Loader2,
  AlertTriangle,
  X,
  Trash2,
  Maximize2,
  Minimize2,
  Sparkles,
  Globe,
  MapPin,
  Search,
} from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db, cleanDataForFirestore } from '../lib/firebase';
import { UserProfile, VisionMemory, SpatialObjectRecord } from '../types';
import { localize } from '../lib/translations';
import { generateAdaptiveResponse } from '../services/gemini';
import { speak, cancelSpeech, unlockSpeechSynthesis } from '../lib/tts';
import { toast } from './Toast';
import {
  extractSpatialObjectsFromVision,
  recordObservedSpatialObjects,
  getSpatialObjects,
  querySpatialMemory,
} from '../lib/spatialMemoryEngine';

interface VisionCompanionViewProps {
  profile: UserProfile;
  setProfile?: (profile: UserProfile) => void;
}

type Status = 'idle' | 'starting-camera' | 'ready' | 'analyzing' | 'camera-denied' | 'unsupported';

const isArabicLang = (lang?: string) => lang === 'Arabic' || lang === 'Egyptian Ammiya';

/**
 * Sanitizes visual descriptions for both on-screen display and spoken output:
 * - Strips robotic labels like "**Hazards:** None", "**Visible Text:** None", "**Scene Description:**"
 * - Converts "Hazards: None" to "No hazards around you." / "مفيش أخطار حواليك."
 * - Strips all markdown formatting (asterisks, bullet dashes, backticks)
 * - Removes spoken symbol words (asterisk, star, استريك, نجمة)
 */
export function cleanVisionDescription(raw: string, lang: 'ar' | 'en' | 'fr' = 'en'): string {
  if (!raw) return '';
  return raw
    .replace(/\[Signs:.*?\]/g, '')
    // English robotic boilerplate
    .replace(/\*\*Hazards:\*\*\s*(None detected[^\n.]*|None[^\n.]*)[.]?/gi, 'No hazards around you.')
    .replace(/Hazards:\s*(None detected[^\n.]*|None[^\n.]*)[.]?/gi, 'No hazards around you.')
    .replace(/\*\*Visible Text:\*\*\s*(None[^\n.]*|N\/A[^\n.]*)[.]?/gi, '')
    .replace(/Visible Text:\s*(None[^\n.]*|N\/A[^\n.]*)[.]?/gi, '')
    .replace(/\*\*(Scene Description|Description):\*\*/gi, '')
    .replace(/(Scene Description|Description):/gi, '')
    // Arabic robotic boilerplate
    .replace(/\*\*المخاطر:\*\*\s*(لا توجد[^\n.]*|لا يوجد[^\n.]*)[.]?/gi, 'مفيش أخطار حواليك.')
    .replace(/المخاطر:\s*(لا توجد[^\n.]*|لا يوجد[^\n.]*)[.]?/gi, 'مفيش أخطار حواليك.')
    .replace(/\*\*النصوص( المكتوبة)?:\*\*\s*(لا توجد[^\n.]*|لا يوجد[^\n.]*)[.]?/gi, '')
    .replace(/النصوص( المكتوبة)?:\s*(لا توجد[^\n.]*|لا يوجد[^\n.]*)[.]?/gi, '')
    .replace(/\*\*(وصف المشهد|الوصف):\*\*/gi, '')
    .replace(/(وصف المشهد|الوصف):/gi, '')
    // French robotic boilerplate
    .replace(/\*\*Dangers?:\*\*\s*(Aucun[^\n.]*)[.]?/gi, 'Aucun danger autour de vous.')
    .replace(/Dangers?:\s*(Aucun[^\n.]*)[.]?/gi, 'Aucun danger autour de vous.')
    .replace(/\*\*Textes?( visibles?)?:\*\*\s*(Aucun[^\n.]*)[.]?/gi, '')
    .replace(/Textes?( visibles?)?:\s*(Aucun[^\n.]*)[.]?/gi, '')
    .replace(/\*\*(Description de la scène|Description):\*\*/gi, '')
    .replace(/(Description de la scène|Description):/gi, '')
    // Spoken symbol artifacts
    .replace(/(?:^|\s+)(asterisk|استريك|نجمة|بوليت)(?=\s+|$)/giu, ' ')
    // Markdown formatting (*, #, _, `, ~, [], (), <>)
    .replace(/[*+#_`~\[\]()<>]/g, '')
    // Bullet dashes
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+-\s+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export default function VisionCompanionView({ profile, setProfile }: VisionCompanionViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const [status, setStatus] = useState<Status>('starting-camera');
  const [lastDescription, setLastDescription] = useState<string>('');
  const [lastSnapshot, setLastSnapshot] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [labelInput, setLabelInput] = useState('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Supported languages: Arabic, English, French
  const [companionLang, setCompanionLang] = useState<'ar' | 'en' | 'fr'>(() => {
    if (isArabicLang(profile?.language)) return 'ar';
    if (profile?.language === 'French' || (profile?.language as unknown as string) === 'fr') return 'fr';
    return 'en';
  });

  // Spatial memory drawer state
  const [showSpatialMemory, setShowSpatialMemory] = useState(false);
  const [spatialRecords, setSpatialRecords] = useState<SpatialObjectRecord[]>(() =>
    profile?.uid ? getSpatialObjects(profile.uid) : []
  );
  const [spatialQueryInput, setSpatialQueryInput] = useState('');
  const [spatialQueryResult, setSpatialQueryResult] = useState<string | null>(null);

  const memories = profile?.visionMemories || [];

  const t = useCallback(
    (en: string, ar: string, fr?: string) => {
      if (companionLang === 'ar') return ar;
      if (companionLang === 'fr') return fr || en;
      return en;
    },
    [companionLang]
  );

  const startCamera = useCallback(
    async (mode: 'environment' | 'user' = facingMode) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('unsupported');
        return;
      }
      setStatus('starting-camera');
      try {
        streamRef.current?.getTracks().forEach((tr) => tr.stop());
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: mode,
              width: { min: 960, ideal: 1920, max: 1920 },
              height: { min: 540, ideal: 1080, max: 1080 },
            },
            audio: false,
          });
        } catch {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
              audio: false,
            });
          } catch {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          }
        }

        if (!isMountedRef.current) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus('ready');
        setAnnounce(
          companionLang === 'ar'
            ? 'الكاميرا جاهزة بملء الشاشة. اضغط الزرار لسماع وصف ما أمامك.'
            : 'Full-screen camera ready. Tap either button to describe what is in front of you.'
        );
      } catch {
        if (isMountedRef.current) setStatus('camera-denied');
      }
    },
    [facingMode, companionLang]
  );

  useEffect(() => {
    isMountedRef.current = true;
    unlockSpeechSynthesis();
    startCamera();
    return () => {
      isMountedRef.current = false;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      cancelSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard Escape listener for the save modal
  useEffect(() => {
    if (!showSaveDialog) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSaveDialog(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSaveDialog]);

  // isFullscreen used to be set synchronously and optimistically right when
  // the button was pressed — before requestFullscreen()'s promise even
  // resolved. If the browser denied the request, or the user exited via the
  // OS/Escape key (not our own button), that left the state permanently
  // wrong: stuck showing "exit fullscreen" while the app wasn't actually
  // fullscreen (or vice versa), with a mismatched layout class applied.
  // Tracking the real browser event is the only way this can't drift.
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      // Optimistic UI update; if the real Fullscreen API is unavailable or
      // denied, this doubles as the CSS-simulated fullscreen fallback. If it
      // succeeds, the fullscreenchange listener above just confirms the same
      // value again — if it's denied, we stay on the CSS fallback rather
      // than silently doing nothing.
      setIsFullscreen(true);
      containerRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const flipCamera = () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    startCamera(next);
  };

  const captureFrame = (): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;

    const maxDim = 1280;
    let w = video.videoWidth;
    let h = video.videoHeight;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.85);
  };

  const describeScene = async (choiceLang?: 'ar' | 'en' | 'fr') => {
    const targetLang = choiceLang || companionLang;
    setCompanionLang(targetLang);

    // 1. PRIME SPEECH SYNTHESIS IMMEDIATELY ON REAL USER CLICK
    unlockSpeechSynthesis();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.resume();
        const primeUtterance = new SpeechSynthesisUtterance('');
        primeUtterance.volume = 0;
        window.speechSynthesis.speak(primeUtterance);
      } catch {
        /* ignore */
      }
    }

    if (status !== 'ready' && status !== 'analyzing') {
      const errNoCam =
        targetLang === 'ar'
          ? 'الكاميرا غير متاحة حالياً، يرجى السماح بالوصول للكاميرا.'
          : targetLang === 'fr'
          ? "La caméra n'est pas disponible. Veuillez autoriser l'accès à la caméra."
          : 'Camera is not available. Please allow camera access.';
      speak(errNoCam, targetLang === 'ar' ? 'Arabic' : targetLang === 'fr' ? 'French' : 'English');
      return;
    }

    const frame = captureFrame();
    if (!frame) {
      const errNoFrame =
        targetLang === 'ar'
          ? 'تعذر التقاط صورة الكاميرا، يرجى المحاولة ثانية.'
          : targetLang === 'fr'
          ? "Impossible de capturer l'image de la caméra, veuillez réessayer."
          : 'Could not capture the camera frame, please try again.';
      speak(errNoFrame, targetLang === 'ar' ? 'Arabic' : targetLang === 'fr' ? 'French' : 'English');
      return;
    }

    setLastSnapshot(frame);
    setStatus('analyzing');
    const waitingMsg =
      targetLang === 'ar'
        ? 'بحلل اللي قدامك في الكاميرا...'
        : targetLang === 'fr'
        ? "J'analyse ce qui se trouve devant vous..."
        : "Analyzing what's in front of you...";
    setAnnounce(waitingMsg);

    const knownContext = memories.length
      ? `\n\nContext — objects/people previously saved by the user (mention only if photo matches):\n${memories
          .slice(-15)
          .map((m) => `- "${m.label}": ${m.description}`)
          .join('\n')}`
      : '';

    let prompt = '';
    if (targetLang === 'ar') {
      prompt = `أنت رفيق بشري يتحدث بصوته لشخص كفيف عبر الكاميرا. تحدث فوراً بلغة عربية عامية سهلة ومباشرة كأنك صديق يقف بجانبه وينظر أمامه: ادخل في الموضوع فوراً بدون أي مقدمات أو عناوين أو ماركداون. ابدأ مباشرة بجملة تطمينية سلسة إذا لم تكن هناك مخاطر، مثلاً: "مفيش أخطار حواليك، قدامك..." ثم صف الأشخاص والأشياء والأسطح والنصوص المكتوبة بشكل طبيعي وتلقائي جداً. لا تذكر كلمات مثل "المخاطر" أو "النصوص المكتوبة" أو "وصف المشهد" كعناوين، ولا تستخدم نجوم الماركداون أو الشرطات نهائياً.${knownContext}`;
    } else if (targetLang === 'fr') {
      prompt = `Vous êtes un compagnon humain chaleureux qui parle directement à voix haute à une personne aveugle à travers sa caméra. Parlez immédiatement dans un langage oral fluide, naturel et bienveillant, comme un ami à ses côtés : allez droit au but sans titres de section ni balises markdown. S'il n'y a aucun danger, commencez directement par rassurer la personne (ex. "Aucun danger autour de vous, devant vous se trouve..."). Décrivez les personnes, objets, surfaces et textes visibles de façon fluide et naturelle. N'utilisez AUCUN astérisque (**), tiret ou en-tête robotique.${knownContext}`;
    } else {
      prompt = `You are a warm, helpful human companion speaking directly aloud to a blind person through their camera. Speak immediately in fluent, natural conversational prose as if you are a friend standing right beside them: Go straight to the point without any section titles, headings, or robotic boilerplate. If there are no hazards, start directly with reassuring words (e.g. "No hazards around you. Directly in front of you is..."). Describe people, objects, surfaces, and any visible text smoothly and naturally. Do NOT use markdown asterisks (**), bullet dashes, or labels like "Hazards:", "Visible Text:", or "Scene Description:".${knownContext}`;
    }

    try {
      const cleanData = frame.replace(/^data:[^;]+;base64,/, '');
      const result = await generateAdaptiveResponse(
        prompt,
        {
          ...profile,
          language: targetLang === 'ar' ? 'Egyptian Ammiya' : targetLang === 'fr' ? 'French' : 'English',
        },
        [],
        [{ name: 'scene.jpg', type: 'image/jpeg', data: cleanData }]
      );

      if (!isMountedRef.current) return;
      const cleaned = cleanVisionDescription(result, targetLang);
      setLastDescription(cleaned);
      setStatus('ready');
      setAnnounce(cleaned);

      // Automatically extract and record spatial physical objects for this user
      if (profile?.uid) {
        const extracted = extractSpatialObjectsFromVision(cleaned, profile.uid, targetLang);
        if (extracted.length > 0) {
          recordObservedSpatialObjects(profile.uid, extracted).then(() => {
            if (isMountedRef.current && profile.uid) {
              setSpatialRecords(getSpatialObjects(profile.uid));
            }
          });
        }
      }

      // AUTOMATICALLY REPEAT ALOUD FROM THE VERY FIRST TIME WITHOUT USER HAVING TO ASK!
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
      }

      const voiceLang = targetLang === 'ar' ? 'Arabic' : targetLang === 'fr' ? 'French' : 'English';
      setTimeout(() => {
        speak(cleaned, voiceLang, {
          onError: () => {
            // Chrome speech resume recovery
            if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
              window.speechSynthesis.resume();
              setTimeout(() => speak(cleaned, voiceLang), 120);
            }
          },
        });
      }, 60);
    } catch {
      if (!isMountedRef.current) return;
      setStatus('ready');
      const err =
        targetLang === 'ar'
          ? 'حصلت مشكلة في تحليل الصورة، من فضلك جرب تاني.'
          : targetLang === 'fr'
          ? "Un problème est survenu lors de l'analyse de l'image. Veuillez réessayer."
          : 'Something went wrong analyzing the image. Please try again.';
      setLastDescription(err);
      speak(err, targetLang === 'ar' ? 'Arabic' : targetLang === 'fr' ? 'French' : 'English');
    }
  };

  const handleSearchSpatial = () => {
    if (!profile?.uid || !spatialQueryInput.trim()) return;
    const res = querySpatialMemory(profile.uid, spatialQueryInput, companionLang);
    setSpatialQueryResult(res.message);
    speak(res.message, companionLang === 'ar' ? 'Arabic' : companionLang === 'fr' ? 'French' : 'English');
  };

  const openSaveDialog = () => {
    if (!lastDescription) return;
    cancelSpeech();
    setLabelInput('');
    setShowSaveDialog(true);
  };

  const saveMemory = async () => {
    if (!labelInput.trim()) { setShowSaveDialog(false); return; }
    if (!profile?.uid) {
      // Previously this just closed the dialog with zero feedback — the
      // person types a label, hits Save, and it silently vanishes with no
      // indication it was never actually saved (not logged in). For someone
      // relying entirely on the spoken announcement, that's indistinguishable
      // from a successful save until they ask for it again and it's gone.
      setShowSaveDialog(false);
      const msg = companionLang === 'ar'
        ? 'مينفعش نحفظ من غير تسجيل دخول.'
        : "Can't save without being signed in.";
      setAnnounce(msg);
      speak(msg, companionLang === 'ar' ? 'Arabic' : 'English');
      return;
    }
    const memory: VisionMemory = {
      id: `vm_${Date.now()}`,
      label: labelInput.trim(),
      description: lastDescription,
      createdAt: new Date().toISOString(),
    };
    const prevMemories = memories;
    const updated = [...memories, memory];
    if (setProfile) setProfile({ ...profile, visionMemories: updated });
    setShowSaveDialog(false);
    const msg = companionLang === 'ar' ? `تم الحفظ باسم "${memory.label}".` : `Saved as "${memory.label}".`;
    setAnnounce(msg);
    speak(msg, companionLang === 'ar' ? 'Arabic' : 'English');
    try {
      await setDoc(
        doc(db, `users/${profile.uid}`),
        { visionMemories: cleanDataForFirestore(updated) },
        { merge: true }
      );
    } catch (err) {
      console.warn('Failed to sync vision memory:', err);
      if (!isMountedRef.current) return;
      if (setProfile) setProfile({ ...profile, visionMemories: prevMemories });
      const errMsg =
        companionLang === 'ar'
          ? 'فشل الحفظ في السحابة. تحقق من اتصالك.'
          : 'Failed to save to cloud. Check your connection.';
      setAnnounce(errMsg);
      speak(errMsg, companionLang === 'ar' ? 'Arabic' : 'English');
    }
  };

  const deleteMemory = async (id: string) => {
    if (!profile?.uid) return;
    const prevMemories = memories;
    const updated = memories.filter((m) => m.id !== id);
    if (setProfile) setProfile({ ...profile, visionMemories: updated });
    try {
      await setDoc(
        doc(db, `users/${profile.uid}`),
        { visionMemories: cleanDataForFirestore(updated) },
        { merge: true }
      );
    } catch (err) {
      console.warn('Failed to delete vision memory:', err);
      if (isMountedRef.current && setProfile) setProfile({ ...profile, visionMemories: prevMemories });
    }
  };

  const replaySpeech = () => {
    if (!lastDescription) return;
    cancelSpeech();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
    }
    const voiceLang = companionLang === 'ar' ? 'Arabic' : companionLang === 'fr' ? 'French' : 'English';
    const cleaned = cleanVisionDescription(lastDescription, companionLang);
    setTimeout(() => {
      speak(cleaned, voiceLang);
    }, 60);
  };

  return (
    <div
      ref={containerRef}
      className={`flex-1 flex flex-col h-full min-h-0 bg-black overflow-hidden relative select-none ${
        isFullscreen ? 'fixed inset-0 z-[99999]' : ''
      }`}
      dir={companionLang === 'ar' ? 'rtl' : 'ltr'}
    >
      {/* Screen-reader live region */}
      <div className="sr-only" role="status" aria-live="assertive" aria-atomic="true">
        {announce}
      </div>

      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

      {/* ── 1. FULL-SCREEN LIVE CAMERA VIEWPORT ── */}
      <div className="absolute inset-0 w-full h-full bg-black overflow-hidden flex items-center justify-center">
        {status === 'camera-denied' ? (
          <div className="text-center p-8 max-w-sm z-20">
            <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-3" />
            <p className="text-white font-bold mb-2 text-sm sm:text-base">
              {t('Camera access is needed for the Visual Companion to work.', 'محتاجين إذن الكاميرا عشان الرفيق البصري يشتغل.')}
            </p>
            <button
              onClick={() => startCamera()}
              className="mt-3 px-6 py-3 rounded-2xl bg-primary text-white font-bold text-sm shadow-xl"
            >
              {t('Try again', 'حاول تاني')}
            </button>
          </div>
        ) : status === 'unsupported' ? (
          <div className="text-center p-8 max-w-sm text-white z-20">
            <p className="text-sm font-semibold">
              {t('This device/browser does not support camera access.', 'الجهاز أو المتصفح ده مش بيدعم الوصول للكاميرا.')}
            </p>
          </div>
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        )}

        {status === 'starting-camera' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-20">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
          </div>
        )}
      </div>

      {/* ── 2. ACCESSIBLE FLOATING HUD OVERLAY ── */}
      <div className="relative z-20 flex flex-col justify-between h-full p-3 sm:p-5 md:p-6 pointer-events-none">
        {/* Floating Top Command Bar */}
        <div className="pointer-events-auto flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
          {/* Three Language Choices: Arabic, English, French */}
          <div className="flex items-center bg-black/75 backdrop-blur-xl border border-white/20 p-1 rounded-2xl shadow-2xl">
            <button
              onClick={() => {
                setCompanionLang('ar');
                toast.success('تم اختيار اللغة العربية 🇪🇬');
              }}
              className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs sm:text-sm font-black flex items-center gap-1 transition-all ${
                companionLang === 'ar'
                  ? 'bg-emerald-600 text-white shadow-lg'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <span>🇪🇬</span>
              <span>عربي</span>
            </button>
            <button
              onClick={() => {
                setCompanionLang('en');
                toast.success('English language selected 🇬🇧');
              }}
              className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs sm:text-sm font-black flex items-center gap-1 transition-all ${
                companionLang === 'en'
                  ? 'bg-primary text-white shadow-lg'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <span>🇬🇧</span>
              <span>English</span>
            </button>
            <button
              onClick={() => {
                setCompanionLang('fr');
                toast.success('Langue française sélectionnée 🇫🇷');
              }}
              className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs sm:text-sm font-black flex items-center gap-1 transition-all ${
                companionLang === 'fr'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <span>🇫🇷</span>
              <span>Français</span>
            </button>
          </div>

          {/* Right Utilities: Spatial Memory + Flip Camera + Fullscreen */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => {
                setShowSpatialMemory(true);
                if (profile?.uid) setSpatialRecords(getSpatialObjects(profile.uid));
              }}
              aria-label={t('Spatial Memory', 'الذاكرة المكانية', 'Mémoire spatiale')}
              className="px-3 py-2 rounded-2xl bg-black/75 text-white backdrop-blur-xl border border-emerald-500/40 hover:bg-black/90 shadow-lg active:scale-95 transition-all flex items-center gap-1.5 text-xs font-bold"
              title={t('Spatial Memory: Where are my things?', 'الذاكرة المكانية: حاجتي فين؟', 'Mémoire spatiale : Où sont mes affaires ?')}
            >
              <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="hidden md:inline">{t('Where is my stuff?', 'حاجتي فين؟', 'Où est mon objet ?')}</span>
              {spatialRecords.length > 0 && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>

            {(status === 'ready' || status === 'analyzing') && (
              <button
                onClick={flipCamera}
                aria-label={t('Switch camera', 'بدّل الكاميرا', 'Changer de caméra')}
                className="p-2.5 rounded-2xl bg-black/65 text-white backdrop-blur-xl border border-white/20 hover:bg-black/85 shadow-lg active:scale-95 transition-all"
                title={t('Switch Camera', 'تبديل الكاميرا أمامي/خلفي', 'Changer de caméra')}
              >
                <Camera className="w-5 h-5" />
              </button>
            )}

            <button
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              className="p-2.5 rounded-2xl bg-black/65 text-white backdrop-blur-xl border border-white/20 hover:bg-black/85 shadow-lg active:scale-95 transition-all"
              title={isFullscreen ? 'خروج من ملء الشاشة' : 'تكبير ملء الشاشة'}
            >
              {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Center Region: Analysis Indicator or Live Description Card */}
        <div className="my-auto flex flex-col items-center justify-center px-2 py-3 w-full">
          {status === 'analyzing' && (
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-black/85 backdrop-blur-2xl border border-primary/50 text-white px-6 py-4 rounded-3xl flex items-center gap-3.5 shadow-2xl pointer-events-auto"
            >
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <span className="text-sm sm:text-base font-bold">
                {companionLang === 'ar' ? 'بحلل اللي قدامك في الكاميرا...' : "Analyzing what's in front of you..."}
              </span>
            </motion.div>
          )}

          {lastDescription && status !== 'analyzing' && (
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="w-full max-w-2xl bg-black/80 backdrop-blur-2xl border border-white/20 text-white rounded-3xl p-4 sm:p-5 shadow-2xl pointer-events-auto space-y-2.5 max-h-56 overflow-y-auto custom-scrollbar"
            >
              <div className="flex items-center justify-between text-xs text-slate-300 border-b border-white/10 pb-2">
                <span className="font-bold flex items-center gap-1.5 text-primary">
                  <Sparkles className="w-4 h-4" />
                  {companionLang === 'ar' ? 'الوصف الصوتي التلقائي' : 'Spoken Audio Description'}
                </span>
                <button
                  onClick={replaySpeech}
                  className="flex items-center gap-1.5 text-white hover:text-emerald-400 font-bold text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-xl transition-colors"
                >
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                  {companionLang === 'ar' ? 'إعادة النطق الصوتي' : 'Repeat Aloud'}
                </button>
              </div>
              <p className="text-sm sm:text-base text-slate-100 leading-relaxed font-medium">
                {lastDescription}
              </p>
            </motion.div>
          )}
        </div>

        {/* Floating Bottom Action Dock */}
        <div className="pointer-events-auto space-y-2.5 max-w-2xl mx-auto w-full">
          {/* Three Primary Action Choices: Arabic, English, French */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-2.5">
            <button
              onClick={() => describeScene('ar')}
              disabled={status === 'analyzing' || status === 'starting-camera'}
              className="w-full min-h-[58px] sm:min-h-[66px] rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white font-black text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-2xl shadow-emerald-950/60 border border-emerald-400/40 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <Camera className="w-5 h-5 shrink-0" />
              <div className="flex flex-col items-start sm:items-center text-start sm:text-center leading-tight">
                <span>🇪🇬 ماذا أمامي؟</span>
                <span className="text-[10px] font-normal opacity-90">وصف فوري بالصوت</span>
              </div>
            </button>

            <button
              onClick={() => describeScene('en')}
              disabled={status === 'analyzing' || status === 'starting-camera'}
              className="w-full min-h-[58px] sm:min-h-[66px] rounded-2xl bg-gradient-to-r from-primary to-indigo-600 hover:from-primary/90 hover:to-indigo-500 text-white font-black text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-2xl shadow-indigo-950/60 border border-primary/40 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <Camera className="w-5 h-5 shrink-0" />
              <div className="flex flex-col items-start sm:items-center text-start sm:text-center leading-tight">
                <span>🇬🇧 What is here?</span>
                <span className="text-[10px] font-normal opacity-90">Spoken English</span>
              </div>
            </button>

            <button
              onClick={() => describeScene('fr')}
              disabled={status === 'analyzing' || status === 'starting-camera'}
              className="w-full min-h-[58px] sm:min-h-[66px] rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-700 hover:from-blue-500 hover:to-cyan-600 text-white font-black text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-2xl shadow-blue-950/60 border border-blue-400/40 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <Camera className="w-5 h-5 shrink-0" />
              <div className="flex flex-col items-start sm:items-center text-start sm:text-center leading-tight">
                <span>🇫🇷 Que vois-je ?</span>
                <span className="text-[10px] font-normal opacity-90">Vocal en français</span>
              </div>
            </button>
          </div>

          {/* Secondary Controls Bar */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={replaySpeech}
              disabled={!lastDescription}
              className="flex-1 min-h-[46px] rounded-xl bg-black/70 hover:bg-black/90 backdrop-blur-xl border border-white/20 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-40 shadow-lg active:scale-95"
            >
              <Volume2 className="w-4 h-4 text-emerald-400" />
              <span>{companionLang === 'ar' ? 'كرر بالصوت' : companionLang === 'fr' ? 'Répéter' : 'Repeat aloud'}</span>
            </button>

            <button
              onClick={openSaveDialog}
              disabled={!lastDescription}
              className="flex-1 min-h-[46px] rounded-xl bg-black/70 hover:bg-black/90 backdrop-blur-xl border border-white/20 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-40 shadow-lg active:scale-95"
            >
              <BookmarkPlus className="w-4 h-4 text-amber-400" />
              <span>{companionLang === 'ar' ? 'احفظ ده' : companionLang === 'fr' ? 'Mémoriser' : 'Remember this'}</span>
            </button>

            <button
              onClick={() => {
                setShowSpatialMemory(true);
                if (profile?.uid) setSpatialRecords(getSpatialObjects(profile.uid));
              }}
              className="px-3 min-h-[46px] rounded-xl bg-black/70 hover:bg-black/90 backdrop-blur-xl border border-emerald-500/40 text-emerald-400 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all shadow-lg active:scale-95"
              title={companionLang === 'ar' ? 'الذاكرة المكانية' : companionLang === 'fr' ? 'Mémoire spatiale' : 'Spatial Memory'}
            >
              <MapPin className="w-4 h-4" />
              <span>📍 {spatialRecords.length}</span>
            </button>
          </div>
        </div>
      </div>

      {/* "Remember this as..." Dialog Modal */}
      <AnimatePresence>
        {showSaveDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-4"
            onClick={() => setShowSaveDialog(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="save-dialog-title"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-md bg-slate-900 rounded-3xl p-5 sm:p-6 space-y-4 border border-slate-800 shadow-2xl text-white"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 id="save-dialog-title" className="font-bold text-base text-white flex items-center gap-2">
                  <BookmarkPlus className="w-5 h-5 text-amber-400" />
                  {companionLang === 'ar' ? 'احفظ العنصر أو الشخص باسم...' : companionLang === 'fr' ? 'Enregistrer cet élément comme...' : 'Remember this as...'}
                </h3>
                <button
                  onClick={() => setShowSaveDialog(false)}
                  aria-label={t('Close', 'إغلاق', 'Fermer')}
                  className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <input
                autoFocus
                type="text"
                aria-label={t('Memory label', 'اسم العنصر', "Nom de l'élément")}
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveMemory();
                }}
                placeholder={companionLang === 'ar' ? 'مثلاً: "دوا الضغط" أو "مفاتيحي" أو "أحمد"' : companionLang === 'fr' ? 'ex. "Mes clés", "Télécommande", "Médicament"' : 'e.g. "My Keys", "Coffee Mug", "Ahmed"'}
                className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 focus:ring-2 focus:ring-primary outline-none text-sm"
              />

              <div className="flex gap-2.5">
                <button
                  onClick={() => setShowSaveDialog(false)}
                  className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
                >
                  {companionLang === 'ar' ? 'إلغاء' : companionLang === 'fr' ? 'Annuler' : 'Cancel'}
                </button>
                <button
                  onClick={saveMemory}
                  disabled={!labelInput.trim()}
                  className="flex-1 py-3 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold text-xs disabled:opacity-50"
                >
                  {companionLang === 'ar' ? 'حفظ وتثبيت' : companionLang === 'fr' ? 'Enregistrer' : 'Save Memory'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Spatial Memory Query & List Modal */}
      <AnimatePresence>
        {showSpatialMemory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-3 sm:p-4"
            onClick={() => setShowSpatialMemory(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="spatial-dialog-title"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-lg bg-slate-900 rounded-3xl p-5 sm:p-6 space-y-4 border border-slate-800 shadow-2xl text-white max-h-[85vh] flex flex-col"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-emerald-400" />
                  <h3 id="spatial-dialog-title" className="font-bold text-base text-white">
                    {companionLang === 'ar' ? 'الذاكرة المكانية للأشياء' : companionLang === 'fr' ? 'Mémoire Spatiale des Objets' : 'Spatial Memory of Objects'}
                  </h3>
                </div>
                <button
                  onClick={() => setShowSpatialMemory(false)}
                  aria-label={t('Close', 'إغلاق', 'Fermer')}
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Query Input */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-semibold">
                  {companionLang === 'ar'
                    ? 'اسأل عن مكان أي شيء (مثلاً: "فين الريموت؟" أو "فين المفاتيح؟"):'
                    : companionLang === 'fr'
                    ? "Demandez où se trouve un objet (ex. 'Où est la télécommande ?') :"
                    : "Ask where an item is located (e.g. 'Where is the remote?'):"}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={spatialQueryInput}
                    onChange={(e) => setSpatialQueryInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSearchSpatial();
                    }}
                    placeholder={
                      companionLang === 'ar'
                        ? 'فين ريموت التلفزيون؟'
                        : companionLang === 'fr'
                        ? 'Où est la télécommande ?'
                        : 'Where is the TV remote?'
                    }
                    className="flex-1 px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    onClick={handleSearchSpatial}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm flex items-center gap-1.5 shadow-lg active:scale-95 transition-all"
                  >
                    <Search className="w-4 h-4" />
                    <span>{companionLang === 'ar' ? 'بحث' : companionLang === 'fr' ? 'Chercher' : 'Search'}</span>
                  </button>
                </div>
              </div>

              {spatialQueryResult && (
                <div className="p-3.5 rounded-2xl bg-emerald-950/50 border border-emerald-500/40 text-emerald-200 text-sm leading-relaxed flex items-start gap-2.5">
                  <Volume2 className="w-5 h-5 shrink-0 text-emerald-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold">{spatialQueryResult}</p>
                    <button
                      onClick={() => speak(spatialQueryResult, companionLang === 'ar' ? 'Arabic' : companionLang === 'fr' ? 'French' : 'English')}
                      className="mt-2 text-xs font-bold text-emerald-300 hover:text-emerald-100 underline flex items-center gap-1"
                    >
                      <span>{companionLang === 'ar' ? 'استمع مرة أخرى' : companionLang === 'fr' ? 'Réécouter' : 'Listen again'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* List of remembered items */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[140px]">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                  <span>{companionLang === 'ar' ? 'الأشياء المرصودة مؤخراً' : companionLang === 'fr' ? 'Objets récemment observés' : 'Recently Observed Items'}</span>
                  <span className="text-[11px] font-mono text-emerald-400">{spatialRecords.length} items</span>
                </div>

                {spatialRecords.length === 0 ? (
                  <div className="text-center py-6 text-slate-500 text-xs">
                    {companionLang === 'ar'
                      ? 'لم يتم رصد أي أشياء بعد. وجّه الكاميرا إلى الغرفة واضغط على زر الفحص لتسجيل الأماكن تلقائياً.'
                      : companionLang === 'fr'
                      ? 'Aucun objet observé pour le moment. Pointez la caméra et appuyez sur "Que vois-je ?" pour mémoriser les emplacements.'
                      : 'No objects observed yet. Point the camera and tap any scan button to record locations automatically.'}
                  </div>
                ) : (
                  spatialRecords.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        const query = querySpatialMemory(profile?.uid || '', item.objectName, companionLang);
                        setSpatialQueryResult(query.message);
                        speak(query.message, companionLang === 'ar' ? 'Arabic' : companionLang === 'fr' ? 'French' : 'English');
                      }}
                      className="w-full text-start p-3 rounded-2xl bg-slate-800/70 hover:bg-slate-800 border border-slate-700/60 flex items-center justify-between gap-3 group transition-all"
                    >
                      <div className="space-y-0.5">
                        <div className="font-bold text-sm text-white group-hover:text-emerald-400 flex items-center gap-2">
                          <span>{item.objectName}</span>
                          {item.relativePosition?.direction && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 font-normal">
                              {item.relativePosition.direction}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400">
                          <span>{item.surface || 'Table'}</span>
                          {item.room && <span> • {item.room}</span>}
                        </div>
                      </div>
                      <div className="text-end shrink-0">
                        <span className="text-[10px] text-slate-500 block">
                          {new Date(item.lastSeenTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-xs text-emerald-400 font-semibold group-hover:underline flex items-center justify-end gap-1">
                          <Volume2 className="w-3.5 h-3.5" />
                          {companionLang === 'ar' ? 'اسمع المكان' : companionLang === 'fr' ? 'Écouter' : 'Hear'}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
