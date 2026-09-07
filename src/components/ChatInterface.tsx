import { localize } from '../lib/translations';
import React, { useState, useRef, useEffect } from "react";
import { Message, UserProfile, Task, PedagogyStyle } from "../types";
import { generateAdaptiveResponseStream, generateBenchmarkComparison, generateProactiveInsights, generateChatTitle } from "../services/gemini";
import { geminiService } from "../services/geminiService";
import { PEDAGOGY_STYLES } from "../lib/adaptiveLearning";
import { Send, Bot, User, Loader2, Sparkles, BrainCircuit, Paperclip, ImageIcon, FileText, X, Accessibility, Menu, Download, Mic, MicOff, RefreshCw, Volume2, ListTodo, Plus, Trash2, CheckCircle2, Circle, Scale, Lightbulb, ThumbsUp, ThumbsDown, Copy, Square } from "lucide-react";
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from "motion/react";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { ref as firebaseStorageRef, uploadString, getDownloadURL } from "firebase/storage";
import { db, storage, handleFirestoreError, OperationType, cleanDataForFirestore } from "../lib/firebase";
import { getTranslation } from "../lib/translations";
import { toast } from "./Toast";
import MarkdownMessage from "./MarkdownMessage";
import { speak as speakText, cancelSpeech } from "../lib/tts";
import { useStudentState } from "../lib/useStudentState";
import { detectConceptFromText } from "../lib/conceptGraph";
import { getSpatialObjects } from "../lib/spatialMemoryEngine";

// Three.js is heavy — only load the sign avatar when a deaf-mode user opens it.
const SignAvatar3D = React.lazy(() => import("./SignAvatar3D"));
const FrenchTravelVoiceAssistant = React.lazy(() => import("./FrenchTravelVoiceAssistant"));

// Strip markdown/sign markers and split into words for the sign avatar.
const wordsForSigning = (text: string): string[] =>
  text.replace(/\[Signs:.*?\]/g, "").replace(/[*+#_`~\[\]()>-]/g, " ").split(/\s+/).filter(Boolean).slice(0, 60);

const cleanMessagesForFirestore = (newHistory: Message[]) => {
  // Cap the persisted history so one thread doc can't exceed Firestore's 1 MiB
  // limit (which would fail EVERY future save for that thread). The live UI keeps
  // the full in-memory history for the session; only very old turns drop on reload.
  return newHistory.slice(-300).map(m => {
    const item: any = {
      id: m.id,
      role: m.role,
      content: m.content || "",
      timestamp: m.timestamp
    };
    if (m.reaction !== undefined && m.reaction !== null) {
      item.reaction = m.reaction;
    }
    if (m.attachments !== undefined && m.attachments !== null) {
      item.attachments = m.attachments.map((a: any) => {
        const att: any = { name: a.name || "", type: a.type || "" };
        if (a.url) att.url = a.url;
        // CRITICAL: never persist large base64 — Firestore caps a document at
        // 1 MiB, so a big inline attachment would fail the WHOLE thread save.
        // Large files live in Storage (url); only keep tiny inline data as a
        // fallback when there's no url yet.
        if (a.data && !a.url && a.data.length <= 400000) att.data = a.data;
        return att;
      });
    }
    if (m.comparisons !== undefined && m.comparisons !== null) {
      item.comparisons = m.comparisons.map((c: any) => ({
        modelName: c.modelName || "",
        content: c.content || ""
      }));
    }
    return item;
  });
};

// Best source for an attachment: the Storage URL (persists across reloads),
// falling back to inline base64 (fresh, pre-upload). Empty if neither.
const attSrc = (f: { type?: string; data?: string; url?: string }) =>
  f.url || (f.data ? `data:${f.type};base64,${f.data}` : '');

// Read a File as a base64 data URL.
const readAsDataURL = (file: File): Promise<string> =>
  new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => resolve('');
    r.readAsDataURL(file);
  });

// Downscale + JPEG-compress an image in the browser so it's small enough to
// store inline in Firestore (no Cloud Storage / Blaze plan needed) and cheap to
// send to the AI. Falls back to the original if anything fails.
async function compressImage(file: File, maxDim = 1280, quality = 0.72): Promise<{ data: string; type: string }> {
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
    URL.revokeObjectURL(url);
    let { width, height } = img;
    if (width > maxDim || height > maxDim) {
      const scale = maxDim / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas ctx');
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return { data: dataUrl.split(',')[1] || '', type: 'image/jpeg' };
  } catch {
    const dataUrl = await readAsDataURL(file);
    return { data: dataUrl.split(',')[1] || '', type: file.type };
  }
}

interface ChatInterfaceProps {
  profile: UserProfile;
  onQuestionEvaluated: (score: number, lastMessageSnippet: string) => void;
  onMenuClick?: () => void;
  syncMessages?: (messages: Message[]) => void;
  externalMessage?: string;
  onStreamingUpdate?: (text: string) => void;
  isEmbedded?: boolean;
  onSTTStateChange?: (active: boolean) => void;
  setProfile?: (profile: UserProfile) => void;
}

export interface ChatInterfaceRef {
  toggleSTT: () => void;
}

const ChatInterface = React.forwardRef<ChatInterfaceRef, ChatInterfaceProps>(({ profile, onQuestionEvaluated, onMenuClick, syncMessages, externalMessage, onStreamingUpdate, isEmbedded, onSTTStateChange, setProfile }, ref) => {
  const activeThread = profile.chatThreads?.find(t => t.id === profile.activeThreadId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [showTasks, setShowTasks] = useState(false);
  const [newTaskInput, setNewTaskInput] = useState("");
  const [showInsights, setShowInsights] = useState(false);
  const [insights, setInsights] = useState<string | null>(null);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);

  // Dictation Language for STT: One-click toggle between French (France), English (US), and Arabic (Egypt)
  const [dictationLang, setDictationLang] = useState<'fr-FR' | 'en-US' | 'ar-EG'>(() => {
    if (profile.language === 'French') return 'fr-FR';
    if (profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya') return 'ar-EG';
    return 'en-US';
  });
  const [showFrenchTravelAssistant, setShowFrenchTravelAssistant] = useState(false);

  const { studentState, recordAnswer } = useStudentState(profile?.uid, profile?.level);
  const [activePedagogyStyle, setActivePedagogyStyle] = useState<PedagogyStyle>(
    (studentState?.activePedagogy as any) || profile?.preferredPedagogyStyle || 'analogies'
  );

  // Keep active pedagogy synchronized with real-time student state engine
  useEffect(() => {
    if (studentState?.activePedagogy) {
      setActivePedagogyStyle(studentState.activePedagogy as any);
    }
  }, [studentState?.activePedagogy]);

  const handleSelectPedagogy = (style: PedagogyStyle) => {
    setActivePedagogyStyle(style);
    if (setProfile) {
      setProfile({ ...profile, preferredPedagogyStyle: style });
    }
    if (profile?.uid) {
      setDoc(doc(db, `users/${profile.uid}`), cleanDataForFirestore({
        preferredPedagogyStyle: style
      }), { merge: true }).catch(() => {});
    }
  };

  const currentThreadId = profile.activeThreadId || Date.now().toString();

  const ensureThreadExists = () => {
    if (!profile.activeThreadId) {
      const newThread = {
        id: currentThreadId,
        title: "New Chat",
        updatedAt: new Date().toISOString()
      };
      const updatedThreads = [...(profile.chatThreads || []), newThread];
      if (setProfile) {
        setProfile({
            ...profile,
            chatThreads: updatedThreads,
            activeThreadId: currentThreadId
        });
      } else {
        profile.chatThreads = updatedThreads;
        profile.activeThreadId = currentThreadId;
      }
      if (profile.uid) {
         setDoc(doc(db, `users/${profile.uid}`), cleanDataForFirestore({ 
           chatThreads: updatedThreads, 
           activeThreadId: currentThreadId 
         }), { merge: true });
      }
    }
  };

  const isMountedRef = useRef(true);

  const handleGenerateInsights = async () => {
    if (!profile.uid) return;
    ensureThreadExists();
    setIsGeneratingInsights(true);
    try {
      const result = await generateProactiveInsights(profile, messages);
      if (isMountedRef.current) {
        setInsights(result);
      }
    } finally {
      if (isMountedRef.current) {
        setIsGeneratingInsights(false);
      }
    }
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile.uid || !newTaskInput.trim()) return;
    ensureThreadExists();

    const newTask: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      threadId: currentThreadId,
      content: newTaskInput.trim(),
      completed: false,
      createdAt: new Date().toISOString()
    };

    const updatedTasks = [...(profile.tasks || []), newTask];
    
    setDoc(doc(db, `users/${profile.uid}`), { tasks: updatedTasks }, { merge: true }).catch(err => {
      console.error("Error adding task", err);
    });
    
    setNewTaskInput("");
  };

  const handleToggleTask = (taskId: string) => {
    if (!profile.uid) return;
    const updatedTasks = (profile.tasks || []).map(t => 
      t.id === taskId ? { ...t, completed: !t.completed } : t
    );
    setDoc(doc(db, `users/${profile.uid}`), { tasks: updatedTasks }, { merge: true }).catch(err => {
      console.error("Error toggling task", err);
    });
  };

  const handleDeleteTask = (taskId: string) => {
    if (!profile.uid) return;
    const updatedTasks = (profile.tasks || []).filter(t => t.id !== taskId);
    setDoc(doc(db, `users/${profile.uid}`), { tasks: updatedTasks }, { merge: true }).catch(err => {
      console.error("Error deleting task", err);
    });
  };

  const currentThreadTasks = (profile.tasks || []).filter(t => t.threadId === currentThreadId);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Handle external message injection (e.g. from sign/voice transcription).
  // Deduped so the same injection can't double-send; the ref resets when the
  // parent clears externalMessage, so a repeated phrase still sends next time.
  const lastExternalRef = useRef("");
  useEffect(() => {
    if (!externalMessage) { lastExternalRef.current = ""; return; }
    // If a turn is still streaming, don't drop the message — bail WITHOUT
    // marking it handled. `isLoading` is a dep, so this effect re-runs the
    // moment streaming ends and the queued sentence is sent then.
    if (isLoading) return;
    if (externalMessage === lastExternalRef.current) return;
    lastExternalRef.current = externalMessage;
    if (profile?.accessibilityMode === 'Vocal-Deaf' || profile?.accessibilityMode === 'Sign-Only') {
      handleSubmit(undefined, externalMessage);
    } else {
      setInput(externalMessage);
    }
  }, [externalMessage, isLoading, profile?.accessibilityMode]);

  // Warm up Speech Synthesis voices list on mount
  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      const handleVoices = () => {
        window.speechSynthesis.getVoices();
      };
      window.speechSynthesis.addEventListener('voiceschanged', handleVoices);
      return () => window.speechSynthesis.removeEventListener('voiceschanged', handleVoices);
    }
  }, []);

  const stopRef = useRef(false);
  // Aborts the in-flight AI request so pressing Stop actually cancels generation
  // (and stops burning quota) instead of only hiding the stream locally.
  const abortRef = useRef<AbortController | null>(null);
  // Guards against the live Firestore listener clobbering local state mid-turn:
  // while we're sending (and briefly after), a lagging server snapshot of an
  // EARLIER save could otherwise overwrite the freshly completed reply.
  const isSendingRef = useRef(false);
  const lastLocalWriteRef = useRef(0);
  // Tracks the committed message count of the active thread. A remote snapshot
  // that has FEWER messages than this is stale (within the same thread, history
  // only grows) — applying it would erase newer messages, so we skip it.
  const messagesLenRef = useRef(0);

  // iOS soft-keyboard fix: bind the chat shell height to the visual viewport so
  // the composer stays above the keyboard instead of being hidden behind it.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => document.documentElement.style.setProperty('--app-h', `${vv.height}px`);
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      document.documentElement.style.removeProperty('--app-h');
    };
  }, []);
  const [streamingText, setStreamingText] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<{ name: string, type: string, data: string, url?: string, localId?: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewFile, setPreviewFile] = useState<{ name: string, type: string, data?: string, url?: string } | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  // Which assistant message is currently being shown on the sign-language avatar
  // (only one at a time to avoid many WebGL contexts).
  const [signingId, setSigningId] = useState<string | null>(null);
  const [isReadingDocument, setIsReadingDocument] = useState(false);

  // Turn OFF the active accessibility mode from the header badge. Modes are
  // sticky (saved to the profile), so a user who tried one while exploring —
  // even on a Normal account — would otherwise stay stuck with the avatar/mic
  // overlay and no obvious way out. Persists so it survives a reload.
  const handleDisableAccessibility = () => {
    if (!window.confirm(localize(profile.language,
      'Turn off accessibility mode? You can switch it back on any time from Accessibility settings.',
      'تقفل وضع الإتاحة؟ تقدر ترجّعه في أي وقت من إعدادات الإتاحة.'))) return;
    window.speechSynthesis?.cancel();
    if (setProfile) setProfile({ ...profile, accessibilityMode: 'None' });
    if (profile.uid) {
      setDoc(doc(db, `users/${profile.uid}`), { accessibilityMode: 'None' }, { merge: true })
        .catch(err => handleFirestoreError(err, OperationType.UPDATE, `users/${profile.uid}`));
    }
  };

  const handleSpeak = (m: Message) => {
    if (speakingMessageId === m.id) {
      cancelSpeech();
      setSpeakingMessageId(null);
      return;
    }

    setSpeakingMessageId(m.id);
    const messageId = m.id;
    const isAr = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';

    // Previously this reimplemented voice selection inline and had no
    // silent-fail handling — a blind/Visual-mode user who can't see the reply
    // got NO feedback at all when the browser silently dropped speak() (most
    // commonly the very first call outside a real user gesture, or no voice
    // installed for their language). Now routed through the shared helper
    // (lib/tts.ts), which detects that case, and we surface it as a toast +
    // clear the "speaking" indicator instead of leaving it stuck.
    speakText(m.content, profile.language, {
      onEnd: () => setSpeakingMessageId((prev) => (prev === messageId ? null : prev)),
      onError: (err) => {
        setSpeakingMessageId((prev) => (prev === messageId ? null : prev));
        if (err === 'silent-fail' || err === 'synth-error' || err === 'unsupported') {
          toast.warning(
            isAr
              ? 'معرفتش أشغّل الصوت. جرّب تاكد إن صوت اللغة دي متثبت على جهازك، أو استخدم قارئ الشاشة.'
              : "Couldn't play audio for this reply. Check that a voice for this language is installed, or use a screen reader.",
            isAr ? 'تعذّر النطق' : 'Speech unavailable',
          );
        }
      },
    });
  };

  const readDocument = async (file: {name: string, type: string, data?: string, url?: string}) => {
    if (isLoading || isReadingDocument) return;
    if (!file.data) return; // the AI needs the inline bytes; a URL-only file can't be re-read
    setIsReadingDocument(true);
    
    try {
      const prompt = `You are an accessibility auditor for the blind. 
      Task: Read and extract all important text and meaningful information from this document: "${file.name}".
      Style: Narrate it slowly and clearly as if reading it to a blind person. 
      Mirror the user's dialect (Standard Arabic, Egyptian Ammiya, or English).
      If it's an image, describe it in high detail. 
      If it's a PDF/Text, read the key chapters and paragraphs.
      Return the full narrated text.`;
      
      // Await the full turn so the "reading…" spinner stays up for the whole
      // narration instead of flashing off the instant the request is fired.
      await handleSubmit(undefined, prompt, [{ name: file.name, type: file.type, data: file.data }]);
    } catch (error) {
      console.error(error);
    } finally {
      setIsReadingDocument(false);
      setPreviewFile(null);
    }
  };

  // STT Logic
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const recognitionRef = useRef<any>(null);
  // Text typed before dictation started — we rebuild input = base + transcript,
  // which is idempotent and prevents the mobile "repeated words" duplication.
  const baseInputRef = useRef("");
  // Live mirror of `input` — onend/onresult are captured once inside the STT
  // effect and close over a stale `input`, so we read the current value here.
  const inputRef = useRef("");
  // True while the user wants to keep listening — lets us auto-restart if the
  // engine ends early (fixes desktop "mic closes immediately").
  const shouldListenRef = useRef(false);

  useEffect(() => {
    onSTTStateChange?.(isListening);
  }, [isListening, onSTTStateChange]);

  useEffect(() => { inputRef.current = input; }, [input]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      const langMap: Record<string, string> = {
        'Arabic': 'ar-SA',
        'Egyptian Ammiya': 'ar-EG',
        'English': 'en-US',
        'French': 'fr-FR',
        'Spanish': 'es-ES',
        'German': 'de-DE'
      };
      recognition.lang = dictationLang || langMap[profile.language || 'English'] || 'en-US';

      const isAr = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';

      recognition.onstart = () => setIsListening(true);

      recognition.onend = () => {
        // The engine often stops on its own (silence/timeout). If the user still
        // wants to listen, restart it so dictation feels continuous. Restart on a
        // short delay rather than synchronously: calling start() inside onend can
        // throw InvalidState on some engines and, on repeated no-speech, spins a
        // tight restart loop that pins the CPU. The delay yields the main thread
        // and rechecks the intent flag in case the user toggled off meanwhile.
        if (shouldListenRef.current) {
          // Fold everything finalized so far into the base BEFORE restarting.
          // The next session's results index from 0, and onresult rebuilds
          // input = base + newFinals; without advancing base here, the restart
          // would erase all previously dictated text.
          baseInputRef.current = inputRef.current;
          setTimeout(() => {
            if (!shouldListenRef.current) return;
            try { recognition.start(); } catch { setIsListening(false); }
          }, 300);
          return;
        }
        setIsListening(false);
      };

      recognition.onerror = (event: any) => {
        const err = event?.error;
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          shouldListenRef.current = false;
          setIsListening(false);
          toast.error(
            isAr ? 'مفيش إذن للمايك. اسمح للموقع باستخدام الميكروفون من إعدادات المتصفح.'
                 : 'Microphone permission is blocked. Allow mic access in your browser settings.',
            isAr ? 'الميكروفون مقفول' : 'Mic blocked',
          );
        } else if (err !== 'no-speech' && err !== 'aborted') {
          // no-speech/aborted are normal; onend will auto-restart if needed.
          console.warn('Speech recognition error:', err);
        }
      };

      recognition.onresult = (event: any) => {
        // Rebuild the full transcript from ALL results every time (not append),
        // so engines that re-deliver finals can't duplicate words.
        let finalStr = '';
        let interimStr = '';
        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          const text = res[0].transcript;
          if (res.isFinal) finalStr += text + ' ';
          else interimStr += text;
        }
        const base = baseInputRef.current.trim();
        setInput(((base ? base + ' ' : '') + finalStr).trim());
        setInterimTranscript(interimStr.trim());
      };

      recognitionRef.current = recognition;
    }
    return () => {
      shouldListenRef.current = false;
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    };
  }, [profile.language, dictationLang]);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      const isAr = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';
      toast.warning(
        isAr ? 'الإدخال الصوتي مش مدعوم في المتصفح ده. جرّب Chrome.' : 'Voice input isn’t supported in this browser. Try Chrome.',
        isAr ? 'غير مدعوم' : 'Unsupported',
      );
      return;
    }
    if (isListening) {
      shouldListenRef.current = false; // user-initiated stop — don't auto-restart
      const finalFullText = (input + (input && interimTranscript ? " " : "") + interimTranscript).trim();
      setInput(finalFullText);
      setInterimTranscript("");
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      if (finalFullText && profile.accessibilityMode === 'Visual') {
        const isArabic = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';
        const confirmMsg = isArabic ? "تم الإرسال: " + finalFullText : "Sent: " + finalFullText;
        speakText(confirmMsg, profile.language);
      }
      if (finalFullText) {
        handleSubmit(undefined, finalFullText);
      }
    } else {
      // Remember what was already typed so dictation appends, not overwrites.
      baseInputRef.current = input;
      setInterimTranscript("");
      shouldListenRef.current = true;
      try {
        recognitionRef.current.start();
      } catch {
        // start() throws if it's already running — restart cleanly.
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
        setTimeout(() => { try { recognitionRef.current?.start(); } catch { /* ignore */ } }, 150);
      }
    }
  };

  React.useImperativeHandle(ref, () => ({
    toggleSTT: toggleListening
  }));

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopRef.current = true;
      abortRef.current?.abort();
      recognitionRef.current?.stop();
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Sync with active thread by fetching from subcollection
  useEffect(() => {
    if (!profile.uid || !profile.activeThreadId) {
      const isArabic = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';
      const welcomeMsg = isArabic 
        ? `كوجنيفي جاهز. كيف يمكنني مساعدتك في دراساتك في مجال ${profile.field} اليوم؟`
        : `Cognify Ready. How can I assist your ${profile.field} studies today?`;
        
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          content: welcomeMsg,
          timestamp: new Date().toISOString()
        }
      ]);
      return;
    }

    setMessagesLoading(true);
    setMessages([]); // clear the previous thread so it doesn't render under the new thread's title while the snapshot loads
    const path = `users/${profile.uid}/threads/${profile.activeThreadId}`;
    messagesLenRef.current = 0; // new thread — allow its first load through the length guard

    const unsubscribe = onSnapshot(doc(db, path), (snapshot) => {
      // Ignore our own un-acknowledged local writes (echoes) and any snapshot
      // that lands while we're sending or just sent — local state is the source
      // of truth during a turn, so a lagging server copy can't erase the reply.
      if (snapshot.metadata.hasPendingWrites) return;
      if (isSendingRef.current || Date.now() - lastLocalWriteRef.current < 2500) return;
      // Backstop: a snapshot with fewer messages than we already have is treated
      // as a stale echo — but ONLY within a few seconds of our own last write.
      // Beyond that window a genuinely shorter remote state (another device
      // deleting/regenerating) is allowed through, so cross-device edits sync.
      const incomingLen = snapshot.exists() ? (snapshot.data().messages?.length || 0) : 0;
      if (incomingLen < messagesLenRef.current && Date.now() - lastLocalWriteRef.current < 8000) return;

      if (snapshot.exists() && snapshot.data().messages?.length > 0) {
        const data = snapshot.data();
        const incomingMessages = data.messages as Message[] || [];
        setMessages(incomingMessages);
      } else {
        // If thread exists in metadata but no document, or no messages
        const isArabic = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';
        const welcomeMsg = isArabic 
          ? `كوجنيفي جاهز. كيف يمكنني مساعدتك في دراساتك في مجال ${profile.field} اليوم؟`
          : `Cognify Ready. How can I assist your ${profile.field} studies today?`;
        setMessages([
          {
            id: 'welcome',
            role: 'assistant',
            content: welcomeMsg,
            timestamp: new Date().toISOString()
          }
        ]);
      }
      setMessagesLoading(false);
    }, (err) => {
      console.error("Error fetching messages:", err);
      setMessagesLoading(false);
    });

    return () => unsubscribe();
  }, [profile.uid, profile.activeThreadId]);

  // Keep the length backstop in sync with whatever is currently rendered.
  useEffect(() => {
    messagesLenRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, streamingText, selectedFiles]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    if (!profile.uid) {
         alert("Please login first");
         return;
    }

    const isAr = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';
    const newFiles: { name: string, type: string, data: string, url?: string, localId?: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Unique id so the async Storage-URL update targets THIS exact attachment,
      // even when the user adds two identical images (same bytes).
      const localId = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;

      // Word docs aren't readable by the AI — guide the user to PDF instead of
      // silently attaching a file the model will ignore.
      const isWord = /\.docx?$/i.test(file.name) ||
        file.type === 'application/msword' ||
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      if (isWord) {
        toast.warning(
          isAr
            ? `ملفات Word (.doc/.docx) مش مقروءة للذكاء الاصطناعي. من فضلك حوّل "${file.name}" لـ PDF وارفعه تاني.`
            : `Word files (.doc/.docx) can't be read by the AI. Please convert "${file.name}" to PDF and upload it again.`,
          isAr ? 'حوّله لـ PDF' : 'Convert to PDF',
        );
        continue;
      }

      // Limit file size to 5MB to prevent memory crashes (System Sync Errors)
      if (file.size > 5 * 1024 * 1024) {
        toast.warning(
          isAr ? `الملف "${file.name}" كبير جداً، الحد الأقصى 5 ميجا.` : `"${file.name}" is too large — the max is 5 MB.`,
          isAr ? 'ملف كبير' : 'File too large',
        );
        continue;
      }

      // Images: compress so they persist inline in Firestore (no Storage needed).
      if (file.type.startsWith('image/')) {
        const { data, type } = await compressImage(file);
        if (!data) {
          toast.warning(isAr ? `تعذّر قراءة "${file.name}".` : `Couldn't read "${file.name}".`, isAr ? 'خطأ' : 'Error');
          continue;
        }
        newFiles.push({ name: file.name, type, data, url: '', localId });
        continue;
      }

      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve("");
        reader.readAsDataURL(file);
      });
      const dataStr = base64.split(',')[1];
      if (!dataStr) {
        alert(`تعذّر قراءة الملف "${file.name}".`);
        continue;
      }

      newFiles.push({ name: file.name, type: file.type, data: dataStr, url: "", localId });
    }

    // Show the files and make them available to the AI IMMEDIATELY — the base64
    // `data` is all Gemini needs. Cloud Storage must never block this.
    setSelectedFiles(prev => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = ''; // Reset input to allow re-adding the same file

    // Best-effort: upload to Firebase Storage in the background for cross-device
    // persistence. If Storage is misconfigured/blocked, the attachment still works.
    newFiles.forEach(async (att) => {
      try {
        const storageRef = firebaseStorageRef(storage, `users/${profile.uid}/attachments/${Date.now()}_${att.name}`);
        await uploadString(storageRef, att.data, 'base64', { contentType: att.type });
        const url = await getDownloadURL(storageRef);
        if (isMountedRef.current) {
          setSelectedFiles(prev => prev.map(f => (f.localId === att.localId && !f.url ? { ...f, url } : f)));
        }
      } catch (err) {
        console.error("Storage upload error (non-blocking):", err);
      }
    });
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const evaluateQuestionQuality = (text?: string): number => {
    const safeText = text || '';
    const length = safeText.length;
    let score = 3; 

    // Logic for Arabic and English complexity
    const isArabic = /[\u0600-\u06FF]/.test(safeText);
    const wordCount = safeText.split(/\s+/).length;

    if (length > 30) score += 1;
    if (length > 60) score += 2;
    if (wordCount > 5) score += 1;
    if (wordCount > 15) score += 2;

    const analyticalTerms = ['how', 'why', 'analyze', 'compare', 'evaluate', 'كيف', 'لماذا', 'حلل', 'قارن', 'قيم'];
    if (analyticalTerms.some(term => safeText.toLowerCase().includes(term))) {
      score += 3;
    }
    
    return Math.min(10, score);
  };

  const handleSubmit = async (e?: React.FormEvent, directInput?: string, overrideAttachments?: { name: string, type: string, data: string }[]) => {
    if (e) e.preventDefault();
    const finalInput = directInput || input;
    const finalAttachments = overrideAttachments || selectedFiles;
    if ((!finalInput.trim() && finalAttachments.length === 0) || isLoading) return;

    const qualityScore = evaluateQuestionQuality(finalInput);
    
    let currentThreadId = profile.activeThreadId;
    let isCreatingNewThread = false;
    // When true, we'll upgrade the thread title to an AI-generated, content-based
    // name once the first reply is in (the slice below is just an instant placeholder).
    let shouldAutoTitle = false;

    // Auto-create thread if it doesn't exist
    if (!currentThreadId) {
      currentThreadId = Date.now().toString();
      isCreatingNewThread = true;
      shouldAutoTitle = true;
      const suggestedTitle = finalInput.slice(0, 30) + (finalInput.length > 30 ? '...' : '');
      const newThread = {
        id: currentThreadId,
        title: suggestedTitle,
        updatedAt: new Date().toISOString()
      };
      
      const updatedThreads = [...(profile.chatThreads || []), newThread];
      if (setProfile) {
        setProfile({
            ...profile,
            chatThreads: updatedThreads,
            activeThreadId: currentThreadId
        });
      } else {
        profile.chatThreads = updatedThreads;
        profile.activeThreadId = currentThreadId;
      }
      
      // Persist the new thread creation immediately to the user document
      if (profile.uid) {
         setDoc(doc(db, `users/${profile.uid}`), cleanDataForFirestore({ 
           chatThreads: updatedThreads, 
           activeThreadId: currentThreadId 
         }), { merge: true });
      }
    } else if (
      activeThread &&
      finalInput.trim() &&
      activeThread.title === 'New Chat' &&
      messages.filter(m => m.id !== 'welcome' && m.role === 'user').length === 0
    ) {
      shouldAutoTitle = true;
      const suggestedTitle = finalInput.slice(0, 30) + (finalInput.length > 30 ? '...' : '');
      const updatedThreads = (profile.chatThreads || []).map(t => 
        t.id === activeThread.id ? { ...t, title: suggestedTitle } : t
      );
      
      if (setProfile) {
        setProfile({ ...profile, chatThreads: updatedThreads });
      } else {
        profile.chatThreads = updatedThreads; // Immediate local update
      }
      
      if (profile.uid) {
         setDoc(doc(db, `users/${profile.uid}`), cleanDataForFirestore({ chatThreads: updatedThreads }), { merge: true });
      }
    }

    const userMessage: Message = {
      id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: finalInput || "Analyzed attached media.",
      timestamp: new Date().toISOString(),
      attachments: finalAttachments
    };

    const newHistory = [...messages, userMessage];
    setMessages(newHistory);
    
    // Save locally to appropriate Firestore document
    if (profile.uid && currentThreadId) {
      const threadPath = `users/${profile.uid}/threads/${currentThreadId}`;
      const historyToSave = cleanMessagesForFirestore(newHistory);
      setDoc(doc(db, threadPath), { messages: historyToSave }, { merge: true }).catch(err => {
         handleFirestoreError(err, OperationType.UPDATE, threadPath);
      });
    }
    
    // If the user only attached files with no text, give the model a clear instruction.
    const submittedMessage = finalInput.trim()
      || (finalAttachments.length
        ? "Please analyze the attached file(s) and describe or extract their key content."
        : finalInput);
    setInput("");
    setIsLoading(true);
    stopRef.current = false;
    abortRef.current = new AbortController();
    isSendingRef.current = true;
    lastLocalWriteRef.current = Date.now();
    setStreamingText("");
    const attachmentsToSubmit = [...finalAttachments];
    if (!overrideAttachments) setSelectedFiles([]);

    // Hoisted so the catch block can still recover whatever streamed before an
    // error — never discard text the user already saw being written.
    let lastText = "";
    let streamedAttachments: any[] = [];
    let usedFallback = false;
    try {
      const localSpatial = profile.uid ? getSpatialObjects(profile.uid) : [];
      const calibratedProfile: UserProfile = {
        ...profile,
        preferredPedagogyStyle: activePedagogyStyle,
        spatialMemories: profile.spatialMemories?.length ? profile.spatialMemories : localSpatial,
      };
      const stream = generateAdaptiveResponseStream(
        submittedMessage,
        calibratedProfile,
        newHistory,
        attachmentsToSubmit,
        abortRef.current?.signal,
        studentState
      );

      for await (const chunk of stream) {
        if (!isMountedRef.current || stopRef.current) break; // user pressed Stop or left
        if ((chunk as any).usedFallback) usedFallback = true;
        if (chunk.text) {
          lastText = chunk.text;
          if (isMountedRef.current) setStreamingText(lastText);
        }
        if (chunk.attachments) {
          streamedAttachments = chunk.attachments;
        }
      }

      const isAr = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';

      // If files were sent but the answer came from the text-only fallback
      // provider, it couldn't actually see them — say so plainly.
      if (usedFallback && attachmentsToSubmit.length > 0) {
        toast.warning(
          isAr
            ? 'الرد جه من مزوّد احتياطي نصّي مش بيشوف الصور/الملفات، فالمرفقات اتجاهلت. جرّب تاني بعد شوية عشان يتقري المرفق.'
            : "The answer came from a text-only fallback that can't see images/files, so your attachment was ignored. Try again shortly to have it read.",
          isAr ? 'المرفق اتجاهل' : 'Attachment skipped',
        );
      }
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'assistant',
        // If the stream produced nothing (e.g. all providers overloaded), show a
        // friendly note instead of a blank bubble — never wipe the conversation.
        content: lastText || (isAr
          ? '⚠️ الذكاء الاصطناعي مشغول دلوقتي. جرّب تاني بعد لحظات 🙏'
          : '⚠️ The AI is busy right now. Please try again in a moment 🙏'),
        timestamp: new Date().toISOString(),
        attachments: streamedAttachments
      };

      const updatedHistory = [...newHistory, assistantMessage];
      if (isMountedRef.current) {
        setMessages(updatedHistory);
        setStreamingText("");
      }

      // A blind / low-vision student can't see the reply arrive, so read it to
      // them automatically. (The overlay handles this when it's mounted — skip
      // then, or the answer would be spoken twice over itself.)
      if (profile.accessibilityMode === 'Visual' && lastText && !onStreamingUpdate) {
        handleSpeak(assistantMessage);
      }

      if (onStreamingUpdate) {
        // Trigger TTS directly with the finalized AI text
        onStreamingUpdate(""); // force reset
        setTimeout(() => onStreamingUpdate(lastText), 50);
      }

      // Final persistence
      if (profile.uid && currentThreadId) {
        const threadPath = `users/${profile.uid}/threads/${currentThreadId}`;
        const historyToSave = cleanMessagesForFirestore(updatedHistory);
        setDoc(doc(db, threadPath), { messages: historyToSave }, { merge: true }).catch(err => {
           handleFirestoreError(err, OperationType.UPDATE, threadPath);
        });
      }

      onQuestionEvaluated(qualityScore, lastText.slice(0, 100));

      // Auto-name the chat from its content (ChatGPT-style) after the first
      // reply. Runs in the background; failures are silent (placeholder stays).
      if (shouldAutoTitle && lastText && profile.uid) {
        const threadId = currentThreadId;
        generateChatTitle(submittedMessage, lastText, profile.language)
          .then((title) => {
            if (!title) return;
            // Build from the LATEST threads (not the stale submit-time closure) so
            // this title write can't revert a lastMessageSnippet/updatedAt that
            // onQuestionEvaluated just saved for the same thread.
            const persist = (latest: typeof profile) => {
              const merged = (latest.chatThreads || []).map(t =>
                t.id === threadId ? { ...t, title } : t
              );
              setDoc(doc(db, `users/${latest.uid}`), cleanDataForFirestore({ chatThreads: merged }), { merge: true })
                .catch(() => { /* title is non-critical */ });
              return merged;
            };
            if (setProfile) {
              // App's setProfile is a React state setter — it accepts the
              // functional form at runtime (prop type is narrowed, so cast).
              (setProfile as (u: any) => void)((prev: any) => ({ ...prev, chatThreads: persist(prev) }));
            } else {
              profile.chatThreads = persist(profile);
            }
          })
          .catch(() => { /* keep placeholder title */ });
      }
    } catch (error: any) {
      // User pressed Stop (aborted the fetch) — not a real error. Keep whatever
      // streamed so far and finalize quietly, no error toast.
      if (error?.name === 'AbortError' || stopRef.current) {
        if (lastText) {
          const stopped: Message = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: lastText,
            timestamp: new Date().toISOString(),
            attachments: streamedAttachments,
          };
          const kept = [...newHistory, stopped];
          setMessages(kept);
          if (syncMessages) syncMessages(kept);
        }
        return; // finally still runs (clears isLoading/streamingText)
      }
      console.error(error);
      const isArabic = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';
      // Preserve the user's message. If the model already streamed some text,
      // KEEP it (just flag that it was cut off) instead of throwing it away.
      const errMsg: Message = {
        id: `assistant-err-${Date.now()}`,
        role: 'assistant',
        content: lastText
          ? lastText + (isArabic ? '\n\n⚠️ (الرد اتقطع قبل ما يكمل)' : '\n\n⚠️ (response was cut off)')
          : (isArabic
            ? '⚠️ حصلت مشكلة في الاتصال بالذكاء الاصطناعي. جرّب تاني 🙏'
            : '⚠️ Something went wrong connecting to the AI. Please try again 🙏'),
        timestamp: new Date().toISOString(),
        attachments: streamedAttachments,
      };
      const recovered = [...newHistory, errMsg];
      setMessages(recovered);
      if (syncMessages) syncMessages(recovered);

      toast.error(
        isArabic
          ? `عذراً، حدث خطأ أثناء الاتصال بالخادم: ${error.message || 'يرجى مراجعة حالة الاتصال وإعادة المحاولة'}`
          : `Sorry, an error occurred communicating with the server: ${error.message || 'Please verify connection and retry'}`,
        localize(profile.language, "AI Core Disconnection", "فشل الاتصال بالذكاء الاصطناعي"),
        8000,
        {
          label: localize(profile.language, "Retry Now", "إعادة المحاولة"),
          onClick: () => {
            handleSubmit(undefined, submittedMessage, attachmentsToSubmit);
          }
        }
      );
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
        setStreamingText("");
      }
      // Mark the end of the turn and start the post-write cooldown so a lagging
      // server snapshot can't overwrite the just-saved reply.
      lastLocalWriteRef.current = Date.now();
      isSendingRef.current = false;
    }
  };

  const [comparingId, setComparingId] = useState<string | null>(null);

  const handleCompareAI = async (message: Message) => {
    if (!profile.uid || !profile.activeThreadId) return;
    setComparingId(message.id);

    // Find the previous user message
    const messageIndex = messages.findIndex(m => m.id === message.id);
    let userPrompt = "Provide an optimal response.";
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userPrompt = messages[i].content;
        break;
      }
    }

    const comparisonText = await generateBenchmarkComparison(message.content, userPrompt, profile);
    
    const updatedMessages = messages.map(m => {
      if (m.id === message.id) {
        const existing = m.comparisons || [];
        return {
          ...m,
          // Label this truthfully. No OpenAI model is contacted anywhere in the
          // app — this review comes from the SAME provider chain that wrote the
          // answer (Gemini → Groq → xAI), so calling it a "ChatGPT Assessment"
          // attributed our own output to a competitor's product.
          comparisons: [...existing, { modelName: localize(profile.language, "Second Opinion", "رأي تانٍ"), content: comparisonText }]
        };
      }
      return m;
    });

    setMessages(updatedMessages);
    setComparingId(null);

    const threadPath = `users/${profile.uid}/threads/${profile.activeThreadId}`;
    const historyToSave = cleanMessagesForFirestore(updatedMessages);
    lastLocalWriteRef.current = Date.now();
    setDoc(doc(db, threadPath), { messages: historyToSave }, { merge: true }).catch(err => {
        handleFirestoreError(err, OperationType.UPDATE, threadPath);
    });
  };

  const handleReactToMessage = async (messageId: string, reactionType: 'up' | 'down') => {
    if (!profile.uid || !profile.activeThreadId) return;

    const updatedMessages = messages.map(m => {
      if (m.id === messageId) {
        const newReaction = m.reaction === reactionType ? undefined : reactionType;
        return { ...m, reaction: newReaction };
      }
      return m;
    });

    setMessages(updatedMessages);

    const threadPath = `users/${profile.uid}/threads/${profile.activeThreadId}`;
    const historyToSave = cleanMessagesForFirestore(updatedMessages);
    lastLocalWriteRef.current = Date.now();
    setDoc(doc(db, threadPath), { messages: historyToSave }, { merge: true }).catch(err => {
        handleFirestoreError(err, OperationType.UPDATE, threadPath);
    });
  };

  const handleDownload = (file: {name: string, type: string, data?: string, url?: string}) => {
    const href = attSrc(file);
    if (!href) return;
    const link = document.createElement("a");
    link.href = href;
    if (file.url && !file.data) link.target = '_blank'; // remote file → open/download via URL
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className={`flex-1 flex flex-col bg-bg-card overflow-hidden relative ${isEmbedded ? 'h-full' : 'h-[var(--app-h,100dvh)]'}`}>
      {/* File Preview Modal */}
      <AnimatePresence>
        {previewFile && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-10"
            onClick={(e) => {
              if (e.target === e.currentTarget) setPreviewFile(null);
            }}
          >
            <div className="absolute top-10 right-10 flex gap-4">
              {previewFile.data && (
                <>
                  <button 
                    title="Narrate Document (Blind Accessibility)" 
                    onClick={() => readDocument(previewFile)} 
                    className="text-white hover:text-emerald-400 transition-colors bg-bg-card/10 hover:bg-bg-card/20 p-2 rounded-full backdrop-blur border border-white/20 flex items-center gap-2 px-4"
                  >
                    <Volume2 className="w-6 h-6" />
                    <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Hear Content</span>
                  </button>
                  <button title="Download" onClick={() => handleDownload(previewFile)} className="text-white hover:text-primary transition-colors bg-bg-card/10 hover:bg-bg-card/20 p-2 rounded-full backdrop-blur">
                    <Download className="w-8 h-8" />
                  </button>
                </>
              )}
              <button title="Close" onClick={() => setPreviewFile(null)} className="text-white hover:text-primary transition-colors bg-bg-card/10 hover:bg-bg-card/20 p-2 rounded-full backdrop-blur">
                <X className="w-8 h-8" />
              </button>
            </div>
            {previewFile.type.startsWith('image/') ? (
              <img
                src={attSrc(previewFile)}
                alt={previewFile.name}
                className="max-w-full max-h-full object-contain shadow-2xl rounded-lg"
              />
            ) : previewFile.type.startsWith('video/') ? (
              <video
                src={attSrc(previewFile)}
                controls
                autoPlay
                className="max-w-full max-h-full shadow-2xl rounded-lg"
              />
            ) : (
              <div className="bg-bg-card p-12 rounded-[40px] max-w-2xl w-full text-center space-y-6">
                <div className="relative inline-block">
                  <FileText className="w-20 h-20 text-primary mx-auto" />
                  <motion.div 
                    animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="absolute inset-0 bg-primary/20 blur-xl rounded-full"
                  />
                </div>
                <h3 className="text-2xl font-black text-text-main">{previewFile.name}</h3>
                <p className="text-text-muted font-medium italic">Full AI analysis of document content is active. For blind users, tap "Hear Content" to have the AI narrate this document.</p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                   <button 
                    onClick={() => readDocument(previewFile)} 
                    disabled={isReadingDocument}
                    className="px-8 py-4 bg-emerald-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-95 transition-all"
                   >
                     {isReadingDocument ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                     Narrate Document
                   </button>
                   <button onClick={() => setPreviewFile(null)} className="px-8 py-4 bg-surface-3 text-text-muted rounded-2xl font-black text-xs uppercase tracking-widest">Close Preview</button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header Info */}
      {!isEmbedded && (
        <div className="bg-bg-card border-b border-border h-[60px] px-4 md:px-8 flex justify-between items-center z-10 shrink-0">
          <div className="flex items-center gap-3 md:gap-4">
            <button 
              onClick={onMenuClick}
              className="p-2 -ms-2 text-text-muted hover:bg-surface-3 rounded-lg active:scale-95"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <span className="font-display text-base font-semibold text-text-main tracking-tight">Cognify</span>
              <span className="text-sm md:text-base font-normal text-text-muted truncate max-w-[120px] md:max-w-xs">· {activeThread?.title || 'AI Session'}</span>
            </div>
            {profile.accessibilityMode !== 'None' && (
              <button
                onClick={handleDisableAccessibility}
                title={localize(profile.language, 'Accessibility mode is on — click to turn it off', 'وضع الإتاحة شغّال — اضغط لإيقافه')}
                aria-label={localize(profile.language, 'Turn off accessibility mode', 'إيقاف وضع الإتاحة')}
                className="hidden sm:flex items-center gap-1.5 ps-3 pe-2 py-1 bg-primary-soft text-primary border border-primary/10 hover:bg-primary/15 rounded-full text-[10px] font-black uppercase tracking-wider transition-colors group"
              >
                 <Accessibility className="w-3 h-3" /> {profile.accessibilityMode} {localize(profile.language, 'Mode', 'وضع')}
                 <X className="w-3 h-3 opacity-50 group-hover:opacity-100" />
              </button>
            )}
            {(profile.accessibilityMode === 'Vocal-Deaf' || profile.accessibilityMode === 'Sign-Only') && (
              <div className="flex items-center gap-2 px-3 py-1 bg-primary-soft text-primary border border-border rounded-xl text-[10px] font-black uppercase tracking-wider animate-pulse">
                 <Sparkles className="w-3 h-3" /> Sign Interpretation Active
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <button 
              onClick={() => {
                setShowInsights(!showInsights);
                if (!insights && !showInsights) handleGenerateInsights();
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-bold uppercase transition-colors ${
                showInsights ? 'bg-accent text-white shadow-md shadow-amber-500/20' : 'bg-surface-3 text-accent hover:bg-accent-soft'
              }`}
            >
              <Lightbulb className={`w-4 h-4 ${showInsights ? 'text-white' : 'text-accent'}`} />
              <span className="hidden sm:inline">{getTranslation(profile.language, 'insights')}</span>
            </button>
            
            <button 
              onClick={() => setShowTasks(!showTasks)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-bold uppercase transition-colors ${
                showTasks ? 'bg-primary text-white' : 'bg-surface-3 text-text-muted hover:bg-surface-3'
              }`}
            >
              <ListTodo className="w-4 h-4" />
              <span className="hidden sm:inline">{getTranslation(profile.language, 'tasks')}</span>
              {currentThreadTasks.length > 0 && (
                <span className="bg-bg-card/20 px-1.5 rounded-md">{currentThreadTasks.length}</span>
              )}
            </button>
            <span className="hidden sm:flex text-[11px] font-bold uppercase py-1 px-3 bg-primary-soft text-primary rounded-full border border-border items-center gap-2">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              AI Assistant v1.5
            </span>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Screen-reader announcer for blind users: speaks the "thinking" status
            and the FINAL AI reply (not every streamed token, to avoid spam). */}
        <div className="sr-only" role="status" aria-live="assertive" aria-atomic="true">
          {isLoading
            ? getTranslation(profile.language, 'analyzing')
            : ([...messages].reverse().find((m) => m.role !== 'user' && m.id !== 'welcome')?.content || '')}
        </div>
        <div ref={scrollRef} role="region" aria-label={getTranslation(profile.language, 'aiAssistant')} className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-12 flex flex-col items-center custom-scrollbar">
        {messagesLoading && messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
             <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          <div className="w-full max-w-3xl space-y-10">
          <AnimatePresence mode="popLayout">
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className={`flex flex-col w-full group ${
                  profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya'
                    ? (m.role === 'user' ? 'items-start text-start' : 'items-end text-end')
                    : (m.role === 'user' ? 'items-end text-end' : 'items-start text-start')
                }`}
              >
                {m.role === 'user' ? (
                  <div className="space-y-4 max-w-[90%] md:max-w-[80%]">
                    <div className="bg-primary-soft border border-border text-text-main px-4 py-3 rounded-[16px] rounded-ee-[4px] not-italic flex flex-col gap-2 text-[15px] leading-relaxed">
                       {/* Legacy '[Signs: emoji]' lines (from old stored AI replies that
                           may have been quoted back in) are just dropped, not rendered as
                           a fake sign-translation panel — see MarkdownMessage.tsx. */}
                       {(m.content || '').split('\n').filter((line) => !/^\[Signs:\s*.*\]$/i.test(line.trim())).map((line, i) => (
                         <span key={i}>{line}</span>
                       ))}
                    </div>
                    {m.attachments?.length ? m.attachments.map((file, idx) => (
                      <div key={`${m.id}-att-${idx}`} className="relative group max-w-sm">
                        <button 
                          onClick={() => file.data && setPreviewFile(file)}
                          className={`w-full flex items-center gap-3 p-3 bg-bg-card border border-border rounded-xl transition-all ${file.data ? 'hover:border-primary hover:shadow-md cursor-pointer' : 'opacity-80 cursor-default'}`}
                        >
                           {!file.data ? (
                             <div className="w-10 h-10 shrink-0 rounded-lg bg-orange-50 flex items-center justify-center border border-orange-100">
                               <FileText className="w-4 h-4 text-orange-400" />
                             </div>
                           ) : file.type.startsWith('image/') ? (
                             <div className="w-10 h-10 shrink-0 rounded-lg overflow-hidden bg-surface-3 border border-border">
                               <img src={`data:${file.type};base64,${file.data}`} className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                             </div>
                           ) : file.type.startsWith('video/') ? (
                             <div className="w-10 h-10 shrink-0 rounded-lg bg-slate-800 flex items-center justify-center border border-border overflow-hidden relative">
                               <video src={`data:${file.type};base64,${file.data}`} className="w-full h-full object-cover opacity-50" />
                               <div className="absolute inset-0 flex items-center justify-center">
                                 <div className="w-0 h-0 border-t-[4px] border-t-transparent border-l-[6px] border-l-white border-b-[4px] border-b-transparent ml-0.5"></div>
                               </div>
                             </div>
                           ) : (
                             <div className="w-10 h-10 shrink-0 rounded-lg bg-surface-3 flex items-center justify-center">
                               <FileText className="w-5 h-5 text-primary" />
                             </div>
                           )}
                           <div className="text-left flex-1 min-w-0">
                             <p className="text-xs font-bold text-text-main truncate w-full">{file.name}</p>
                             <p className={`text-[10px] font-bold uppercase tracking-widest ${file.data ? 'text-faint' : 'text-orange-400'}`}>
                               {file.data ? 'Click to View' : 'Media Expired'}
                             </p>
                           </div>
                        </button>
                        {file.data && (
                          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                readDocument(file);
                              }}
                              className="bg-primary-soft text-primary hover:bg-emerald-500 hover:text-white p-2 rounded-full transition-all"
                              title={getTranslation(profile.language, 'hearContent')}
                            >
                              <Volume2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownload(file);
                              }}
                              className="bg-surface-3 hover:bg-primary hover:text-white p-2 rounded-full text-text-muted transition-all"
                              title="Download"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    )) : null}
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border shadow-sm ${
                        evaluateQuestionQuality(m.content) >= 8 ? 'bg-primary-soft text-primary border-border' :
                        evaluateQuestionQuality(m.content) >= 5 ? 'bg-accent-soft text-accent border-accent/20' :
                        'bg-surface-2 text-text-muted border-border'
                      }`}>
                        {evaluateQuestionQuality(m.content) >= 8 ? getTranslation(profile.language, 'excellentQuestion') :
                         evaluateQuestionQuality(m.content) >= 5 ? getTranslation(profile.language, 'goodQuestion') : getTranslation(profile.language, 'basicQuestion')}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 max-w-[90%] md:max-w-[85%]">
                    <div className="flex items-center gap-3">
                      <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded ${
                        profile.level === 'Advanced' ? 'bg-purple-100 text-purple-800' :
                        profile.level === 'Intermediate' ? 'bg-surface-3 text-primary' :
                        'bg-orange-100 text-orange-800'
                      }`}>
                        {getTranslation(profile.language, 'difficultyLevel')}: {profile.level} ({profile.role})
                      </span>
                      {('speechSynthesis' in window) && (
                        <button 
                          onClick={() => handleSpeak(m)}
                          className={`text-[10px] font-bold uppercase transition-colors px-2 py-0.5 rounded border flex items-center gap-1.5 ${speakingMessageId === m.id ? 'bg-danger-soft text-danger border-danger/20 hover:bg-danger-soft' : 'bg-primary-soft text-primary border-border hover:bg-surface-3'}`}
                        >
                          {speakingMessageId === m.id ? (
                            <>
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
                              {localize(profile.language, 'Stop', 'إيقاف')}
                            </>
                          ) : (
                            <>
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
                              {localize(profile.language, 'Speak', 'استماع')}
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    <div className="relative p-6 rounded-2xl bg-bg-card border border-border text-text-main leading-relaxed adaptive-response text-base space-y-4 shadow-sm w-full group/bubble">
                      {('speechSynthesis' in window) && (
                        <div className="flex justify-between items-center pb-2 mb-2 border-b border-border">
                          <div className="flex items-center gap-1.5 opacity-60">
                            <Bot className="w-4 h-4 text-primary" />
                            <span className="text-[10px] font-black uppercase text-faint tracking-wider">
                              {localize(profile.language, 'Cognify Guidance', 'إجابة كوجنيفي الذكية')}
                            </span>
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSpeak(m);
                            }}
                            className={`px-2.5 py-1 rounded-lg border text-[10px] font-black transition-all flex items-center gap-1.5 ${
                              speakingMessageId === m.id
                                ? 'bg-rose-500 text-white border-rose-500 shadow-sm animate-pulse'
                                : 'bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text-main border-border dark:text-faint'
                            }`}
                            aria-label={speakingMessageId === m.id ? "Stop Reading" : "Read Aloud"}
                          >
                            <Volume2 className="w-3.5 h-3.5 animate-bounce" />
                            <span>{speakingMessageId === m.id ? (localize(profile.language, 'Stop', 'إيقاف')) : (localize(profile.language, 'Read Aloud', 'استماع بصوت عالٍ'))}</span>
                          </button>
                        </div>
                      )}
                      {(profile.accessibilityMode === 'Vocal-Deaf' || profile.accessibilityMode === 'Sign-Only') && m.id !== 'welcome' && m.content?.trim() && (
                        <div className="mb-4">
                          <button
                            onClick={() => setSigningId(signingId === m.id ? null : m.id)}
                            aria-label={localize(profile.language, 'Show this reply in sign language', 'اعرض الرد بلغة الإشارة')}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-primary-soft text-primary text-xs font-bold hover:bg-primary/20 transition-colors"
                          >
                            <Accessibility className="w-4 h-4" />
                            {signingId === m.id
                              ? localize(profile.language, 'Hide sign avatar', 'إخفاء الأفاتار')
                              : localize(profile.language, 'Show in sign language', 'اعرض بلغة الإشارة')}
                          </button>
                          {signingId === m.id && (
                            <div className="mt-3 h-64 sm:h-72 rounded-2xl overflow-hidden bg-slate-950 border border-border relative">
                              <React.Suspense fallback={<div className="absolute inset-0 flex items-center justify-center text-text-muted text-xs font-bold uppercase tracking-widest">Loading avatar…</div>}>
                                <SignAvatar3D words={wordsForSigning(m.content)} playing={true} onDone={() => { /* stays on last pose */ }} />
                              </React.Suspense>
                            </div>
                          )}
                        </div>
                      )}
                      <MarkdownMessage content={m.content} />
                    </div>
                    
                    {/* Assistant Attachments (Generated Images/Videos) */}
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-4 mt-6">
                        {m.attachments.map((file, idx) => (
                          <div key={`${m.id}-gen-att-${idx}`} className="relative group">
                            <button
                              onClick={() => attSrc(file) && setPreviewFile(file)}
                              className={`flex flex-col items-center gap-2 p-2 bg-bg-card border border-border rounded-xl transition-all overflow-hidden ${attSrc(file) ? 'hover:border-primary hover:shadow-md cursor-pointer' : 'opacity-80 cursor-default'}`}                             >
                               {!attSrc(file) ? (
                                 <div className="w-48 h-48 rounded-lg bg-orange-50 flex items-center justify-center border border-orange-100 flex-col gap-2">
                                   <FileText className="w-10 h-10 text-orange-400" />
                                   <span className="text-[10px] font-bold text-orange-500 uppercase">Media Expired</span>
                                 </div>
                               ) : file.type.startsWith('image/') ? (
                                 <div className="w-48 h-48 rounded-lg overflow-hidden bg-surface-3 border border-border">
                                   <img src={attSrc(file)} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                 </div>
                               ) : file.type.startsWith('video/') ? (
                                 <div className="w-48 h-48 rounded-lg bg-slate-800 flex items-center justify-center border border-border overflow-hidden relative">
                                   <video src={attSrc(file)} className="w-full h-full object-cover opacity-70" />
                                   <div className="absolute inset-0 flex items-center justify-center group-hover:scale-110 transition-transform">
                                     <div className="w-0 h-0 border-t-[10px] border-t-transparent border-l-[15px] border-l-white border-b-[10px] border-b-transparent ml-1 drop-shadow-lg"></div>
                                   </div>
                                 </div>
                               ) : null}
                               <div className="text-center w-full px-2">
                                 <p className="text-[10px] font-bold text-text-main truncate w-full">{file.name}</p>
                                 <p className={`text-[9px] font-bold uppercase tracking-widest mt-1 ${file.data ? 'text-faint' : 'text-orange-400'}`}>
                                   {file.data ? 'Click to Enlarge' : 'Media Removed (Size Limit)'}
                                 </p>
                               </div>
                            </button>
                            {file.data && (
                              <div className="absolute top-4 right-4 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    readDocument(file);
                                  }}
                                  className="bg-emerald-500/80 hover:bg-emerald-600 text-white p-2 rounded-full backdrop-blur-sm transition-all"
                                  title="Hear Content"
                                >
                                  <Volume2 className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDownload(file);
                                  }}
                                  className="bg-black/60 hover:bg-black p-2 rounded-full text-white backdrop-blur-sm transition-all"
                                  title="Download"
                                >
                                  <Download className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* Benchmark comparisons */}
                    {m.comparisons && m.comparisons.map((comp, idx) => (
                      <div key={idx} className="mt-6 p-6 bg-slate-900 text-slate-200 rounded-2xl border border-slate-700 shadow-xl">
                        <div className="flex items-center gap-3 mb-4 border-b border-slate-700 pb-4">
                          <Scale className="w-5 h-5 text-primary" />
                          <h4 className="font-bold text-white tracking-widest uppercase text-xs">{comp.modelName}</h4>
                        </div>
                        <div className="space-y-3 text-sm opacity-90 font-mono leading-relaxed">
                          {(comp.content || '').split('\n').map((line, lidx) => (
                            <p key={lidx}>{line}</p>
                          ))}
                        </div>
                      </div>
                    ))}

                    <div className={`mt-4 flex gap-3 items-center justify-end transition-opacity ${m.reaction ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                      <div className="flex items-center gap-1.5 mr-auto">
                        <button
                          onClick={() => handleReactToMessage(m.id, 'up')}
                          className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 ${
                            m.reaction === 'up'
                              ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm'
                              : 'text-text-muted bg-bg-card border-border hover:text-primary hover:bg-primary-soft hover:border-border'
                          }`}
                          title="Thumbs Up / Helpful"
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                          <span>{localize(profile.language, 'Helpful', 'مفيد')}</span>
                        </button>
                        <button
                          onClick={() => handleReactToMessage(m.id, 'down')}
                          className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 ${
                            m.reaction === 'down'
                              ? 'bg-rose-500 text-white border-rose-500 shadow-sm'
                              : 'text-text-muted bg-bg-card border-border hover:text-danger hover:bg-danger-soft hover:border-danger/20'
                          }`}
                          title="Thumbs Down / Unhelpful"
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                          <span>{localize(profile.language, 'Unhelpful', 'غير مفيد')}</span>
                        </button>
                        <button
                          onClick={() => {
                            navigator.clipboard?.writeText(m.content).then(
                              () => toast.success(
                                localize(profile.language, 'Copied', 'تم النسخ'),
                              ),
                              () => {},
                            );
                          }}
                          className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 text-text-muted bg-bg-card border-border hover:text-primary hover:bg-primary-soft hover:border-primary/20"
                          title={localize(profile.language, "Copy answer", "نسخ الإجابة")}
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>{localize(profile.language, 'Copy', 'نسخ')}</span>
                        </button>
                      </div>

                      <button 
                        onClick={() => handleCompareAI(m)}
                        disabled={comparingId === m.id}
                        className="text-[10px] font-bold uppercase tracking-widest text-text-muted hover:text-primary hover:bg-primary-soft px-3 py-1.5 rounded-lg border border-transparent hover:border-border transition-all flex items-center gap-2 disabled:opacity-50"
                      >
                        {comparingId === m.id ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {localize(profile.language, 'Reviewing…', 'جاري المراجعة…')}</>
                        ) : (
                          /* Truthful label: this is a self-review by our own model
                             chain, not a comparison against OpenAI's ChatGPT. */
                          <><Scale className="w-3.5 h-3.5" /> {localize(profile.language, 'Second opinion', 'رأي تانٍ')}</>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Starter prompts — shown on a fresh chat to beat the blank-page problem. */}
          {!isLoading && messages.filter((m) => m.role === 'user').length === 0 && (() => {
            const ar = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';
            const f = profile.field || (ar ? 'مجالك' : 'your field');
            const chips = ar
              ? [`اشرح لي مفهوم مهم في ${f} ببساطة`, `اعمللي خطة مذاكرة لأسبوع`, `لخّص لي المقال أو ملف PDF`, `اسألني أسئلة عشان أراجع`]
              : [`Explain a key ${f} concept simply`, `Make me a 1-week study plan`, `Summarize an article or PDF`, `Quiz me to review`];
            return (
              <div className="flex flex-wrap gap-2 pt-2">
                {chips.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handleSubmit(undefined, p)}
                    className="text-start text-sm px-4 py-2.5 rounded-xl border border-border bg-bg-card hover:border-primary hover:bg-primary-soft text-text-muted hover:text-primary transition-all shadow-sm active:scale-[0.98]"
                  >
                    {p}
                  </button>
                ))}
              </div>
            );
          })()}

          {isLoading && (
            <motion.div
              key="streaming-block"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4"
            >
              <div className="flex items-center gap-3">
                <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded ${
                  profile.level === 'Advanced' ? 'bg-purple-100 text-purple-800' :
                  profile.level === 'Intermediate' ? 'bg-surface-3 text-primary' :
                  'bg-orange-100 text-orange-800'
                }`}>
                  Level: {profile.level} ({profile.role})
                </span>
              </div>
              
              {streamingText ? (
                <div className="text-text-main leading-relaxed adaptive-response text-base space-y-4">
                  <MarkdownMessage content={streamingText} />
                </div>
              ) : (
                <div className="flex items-center gap-3 p-6 bg-bg-main rounded-xl border border-border italic text-text-muted">
                  <span className="flex items-center gap-1.5" aria-label="Assistant is typing">
                    <span className="w-2 h-2 rounded-full bg-primary/70 animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-2 h-2 rounded-full bg-primary/70 animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-2 h-2 rounded-full bg-primary/70 animate-bounce" />
                  </span>
                  <span>{getTranslation(profile.language, 'analyzing')}</span>
                </div>
              )}
            </motion.div>
          )}
          </div>
        )}
        </div>

        {/* Task Panel */}
        <AnimatePresence>
          {showTasks && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: isEmbedded ? '100%' : (window.innerWidth < 768 ? '100%' : 320), opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              style={{ right: 0, top: 0, bottom: 0, zIndex: 40 }}
              className={`bg-surface-2 border-s border-border overflow-y-auto flex flex-col shadow-xl shrink-0 ${isEmbedded ? 'absolute' : 'absolute md:relative'}`}
            >
              <div className="p-4 border-b border-border bg-bg-card flex justify-between items-center shrink-0">
                <h3 className="font-extrabold text-text-main flex items-center gap-2">
                  <ListTodo className="w-5 h-5 text-primary" /> Thread Tasks
                </h3>
                <button onClick={() => setShowTasks(false)} className="p-1 hover:bg-surface-3 rounded-lg text-text-muted">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 flex-1 flex flex-col gap-4 overflow-y-auto custom-scrollbar">
                <form onSubmit={handleAddTask} className="flex gap-2">
                  <input
                    type="text"
                    id="new-task"
                    name="new-task"
                    aria-label="New task"
                    value={newTaskInput}
                    onChange={(e) => setNewTaskInput(e.target.value)}
                    placeholder="New task..."
                    className="flex-1 bg-bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary shadow-sm"
                  />
                  <button type="submit" disabled={!newTaskInput.trim()} className="bg-primary hover:bg-primary-press text-white p-2 rounded-lg disabled:opacity-50 transition-colors shadow-sm">
                    <Plus className="w-4 h-4" />
                  </button>
                </form>
                <div className="space-y-2">
                  {currentThreadTasks.length === 0 ? (
                     <div className="text-center p-6 text-faint italic text-sm border-2 border-dashed border-border rounded-xl">
                       No tasks for this thread yet.
                     </div>
                  ) : (
                    currentThreadTasks.map(task => (
                      <div key={task.id} className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${task.completed ? 'bg-surface-3 border-transparent opacity-60' : 'bg-bg-card border-border shadow-sm'}`}>
                        <button onClick={() => handleToggleTask(task.id)} className={`mt-0.5 shrink-0 transition-colors ${task.completed ? 'text-emerald-500' : 'text-faint hover:text-primary'}`}>
                          {task.completed ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                        </button>
                        <p className={`flex-1 text-sm ${task.completed ? 'line-through text-text-muted' : 'text-text-main font-medium'}`}>
                          {task.content}
                        </p>
                        <button onClick={() => handleDeleteTask(task.id)} className="text-faint hover:text-rose-500 hover:bg-danger-soft p-1.5 rounded-lg transition-colors shrink-0">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Insights Panel */}
        <AnimatePresence>
          {showInsights && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: isEmbedded ? '100%' : (window.innerWidth < 768 ? '100%' : 340), opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              style={{ right: 0, top: 0, bottom: 0, zIndex: 40 }}
              className={`bg-accent-soft border-s border-accent/20 overflow-y-auto flex flex-col shadow-xl shrink-0 ${isEmbedded ? 'absolute' : 'absolute md:relative'}`}
            >
              <div className="p-4 border-b border-accent/20 bg-accent-soft/50 flex justify-between items-center shrink-0">
                <h3 className="font-extrabold text-accent flex items-center gap-2">
                  <Lightbulb className="w-5 h-5 text-accent" /> {getTranslation(profile.language, 'proactiveInsights')}
                </h3>
                <button onClick={() => setShowInsights(false)} className="p-1 hover:bg-accent/50 rounded-lg text-accent">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 flex-1 flex flex-col gap-4 overflow-y-auto custom-scrollbar text-accent">
                {isGeneratingInsights ? (
                  <div className="flex flex-col items-center justify-center p-8 text-accent gap-3">
                    <Loader2 className="w-8 h-8 animate-spin" />
                    <span className="text-sm font-medium text-accent">Analyzing thread & profile...</span>
                  </div>
                ) : (
                  <>
                    <div className="prose prose-base prose-slate max-w-none leading-relaxed p-6 rounded-2xl shadow-xl text-text-main border-2 border-accent/20 bg-bg-card" style={{ boxShadow: '0 10px 25px -5px rgba(251, 191, 36, 0.2)' }}>
                      {insights ? (
                        <div className="markdown-body font-medium">
                          <Markdown>{insights}</Markdown>
                        </div>
                      ) : (
                        <span className="text-text-main font-bold tracking-tight">Click refresh to generate new insights.</span>
                      )}
                    </div>
                    
                    <button 
                      onClick={handleGenerateInsights}
                      className="mt-4 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-accent hover:bg-accent text-white font-bold text-sm transition-colors shadow-md shadow-amber-500/20"
                    >
                      <RefreshCw className="w-4 h-4" /> {getTranslation(profile.language, 'regenerateInsights')}
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Input Area — shrink-0 so the composer is never squeezed and always pinned. */}
      <div className="shrink-0 p-3 sm:p-4 md:p-8 border-t border-border bg-bg-main relative shadow-[0_-10px_20px_-15px_rgba(0,0,0,0.05)]">
        <div className="max-w-3xl mx-auto space-y-4">
          <AnimatePresence>
            {selectedFiles.length > 0 && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex flex-wrap gap-2 mb-2"
              >
                {selectedFiles.map((file, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-surface-3 rounded-lg border border-border group">
                    <span className="text-[10px] font-bold text-text-main truncate max-w-[100px]">{file.name}</span>
                    <button onClick={() => removeFile(i)} className="text-faint hover:text-rose-500 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          
          {/* Top Bar: Adaptive Pedagogy Style Bar + France Travel Voice & Mic Language */}
          <div className="flex items-center justify-between gap-2 mb-2 overflow-x-auto custom-scrollbar py-0.5 px-1">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] text-text-muted font-bold uppercase shrink-0">
                {localize(profile.language, 'Pedagogy:', 'أسلوب الشرح:')}
              </span>
              {PEDAGOGY_STYLES.map((st) => {
                const isSelected = activePedagogyStyle === st.id;
                return (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => handleSelectPedagogy(st.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all shrink-0 flex items-center gap-1 border ${
                      isSelected
                        ? 'bg-primary/15 text-primary border-primary/30 shadow-xs ring-1 ring-primary/20'
                        : 'bg-surface-2 text-text-muted border-border/60 hover:bg-surface-3 hover:text-text-main'
                    }`}
                    title={localize(profile.language, st.descriptionEn, st.descriptionAr)}
                  >
                    <span>{localize(profile.language, st.labelEn, st.labelAr)}</span>
                  </button>
                );
              })}
            </div>

            {/* France Travel Assistant & Mic Language Switcher */}
            <div className="flex items-center gap-2 shrink-0 ms-auto">
              <button
                type="button"
                onClick={() => setShowFrenchTravelAssistant(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 active:scale-95 transition-all shrink-0"
                title={localize(profile.language, 'Open France Travel & Voice Assistant', 'فتح دليل ومترجم فرنسا الصوتي')}
              >
                <span>🇫🇷</span>
                <span className="hidden sm:inline">{localize(profile.language, 'France Guide', 'دليل فرنسا')}</span>
              </button>

              <div className="flex items-center bg-surface-2 border border-border rounded-lg p-0.5" title="Speech Recognition Language">
                {[
                  { code: 'fr-FR' as const, label: '🇫🇷 FR' },
                  { code: 'en-US' as const, label: '🇬🇧 EN' },
                  { code: 'ar-EG' as const, label: '🇪🇬 AR' },
                ].map(({ code, label }) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => {
                      setDictationLang(code);
                      if (isListening && recognitionRef.current) {
                        try { recognitionRef.current.lang = code; } catch {}
                      }
                    }}
                    className={`text-[10px] font-black px-2 py-0.5 rounded-md transition-all ${
                      dictationLang === code
                        ? 'bg-primary text-white shadow-xs'
                        : 'text-text-muted hover:text-text-main'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="relative group">
            <input
              type="file"
              id="chat-file-upload"
              name="chat-file-upload"
              aria-label="Attach files"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              multiple
              accept="image/*,video/mp4,video/webm,video/quicktime,application/pdf,.txt"
            />
            
            <div className="relative w-full">
              <div className="absolute start-4 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10">
                 <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach a file"
                  title="Attach a file"
                  className="p-2 text-faint hover:text-primary transition-colors rounded-lg hover:bg-surface-2"
                 >
                   <Paperclip className="w-5 h-5" />
                 </button>
                 
                 <button
                   type="button"
                   onClick={toggleListening}
                   aria-label={isListening ? localize(profile.language, "Stop voice input", "إيقاف الإدخال الصوتي") : localize(profile.language, "Start voice input", "بدء الإدخال الصوتي")}
                   className={`p-2 transition-colors rounded-lg ${
                     isListening ? 'text-rose-500 bg-danger-soft hover:bg-danger-soft animate-pulse' : 'text-faint hover:text-primary hover:bg-surface-2'
                   }`}
                   title={isListening ? "Listening... (Tap to stop and send)" : "Tap to Speak (Real-time Live Caption)"}
                 >
                   {isListening ? (
                     <MicOff className="w-5 h-5" />
                   ) : (
                     <Mic className="w-5 h-5" />
                   )}
                 </button>
              </div>

              <textarea
                id="chat-composer"
                name="chat-composer"
                aria-label={getTranslation(profile.language, 'typeMessage')}
                rows={1}
                value={input + (interimTranscript ? (input ? " " : "") + interimTranscript : "")}
                onChange={(e) => setInput(e.target.value)}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
                }}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter inserts a newline (ChatGPT/Claude behavior).
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!isLoading && (input.trim() || selectedFiles.length > 0)) handleSubmit();
                  }
                }}
                disabled={isLoading}
                placeholder={isListening ? (localize(profile.language, "Listening...", 'جاري الاستماع...')) : getTranslation(profile.language, 'typeMessage')}
                className={`w-full bg-bg-card border border-border-2 rounded-[20px] ps-24 py-4 pe-14 shadow focus:border-primary outline-none transition-all placeholder:text-text-muted/50 disabled:opacity-50 relative z-0 resize-none max-h-40 leading-relaxed custom-scrollbar ${isListening ? 'border-primary ring-4 ring-primary/10' : ''}`}
              />
              {interimTranscript && (
                <div className="absolute end-14 top-1/2 -translate-y-1/2 pointer-events-none z-10">
                  <span className="flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                  </span>
                </div>
              )}
              {isLoading ? (
                <button
                  type="button"
                  onClick={() => { stopRef.current = true; abortRef.current?.abort(); }}
                  title={localize(profile.language, "Stop generating", "إيقاف التوليد")}
                  aria-label={localize(profile.language, "Stop generating", "إيقاف التوليد")}
                  className="absolute end-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-slate-900 text-white rounded-lg flex items-center justify-center hover:bg-black transition-all shadow-md active:scale-95 z-10"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() && selectedFiles.length === 0}
                  aria-label={localize(profile.language, "Send message", "إرسال")}
                  className="absolute end-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-primary text-white rounded-lg flex items-center justify-center hover:bg-primary-press disabled:bg-surface-3 disabled:text-faint transition-all shadow-md active:scale-95 z-10"
                >
                  <Send className="w-5 h-5" />
                </button>
              )}
            </div>
          </form>
          <p className="text-center text-[11px] text-text-muted/70 mt-2 px-2">
            {localize(profile.language, 'Cognify can make mistakes. Check important information.', 'كوجنيفاي ممكن يخطئ. راجِع المعلومات المهمة.')}
          </p>
        </div>
      </div>

      {/* French Travel & Voice Assistant Modal */}
      {showFrenchTravelAssistant && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 md:p-6 animate-fadeIn">
          <div className="bg-bg-card rounded-3xl border border-border shadow-2xl w-full max-w-5xl h-[92vh] flex flex-col overflow-hidden relative">
            <React.Suspense fallback={<div className="p-8 text-center text-text-muted">Chargement...</div>}>
              <FrenchTravelVoiceAssistant
                profile={profile}
                onNavigateBack={() => setShowFrenchTravelAssistant(false)}
              />
            </React.Suspense>
          </div>
        </div>
      )}
    </div>
  );
});

export default ChatInterface;
