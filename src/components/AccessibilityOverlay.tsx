import React, { useState, useEffect, useRef } from 'react';
import { AccessibilityMode, UserProfile } from '../types';
import { Mic, MicOff, Video, VideoOff, Brain, Sparkles, MessageSquare, Eye, Camera, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AccessibilityOverlayProps {
  mode: AccessibilityMode;
  profile: UserProfile;
  aiResponse?: string;
  onTranscription: (text: string) => void;
}

export default function AccessibilityOverlay({ mode, profile, aiResponse = "", onTranscription }: AccessibilityOverlayProps) {
  const [isListening, setIsListening] = useState(false);
  const [isVisionActive, setIsVisionActive] = useState(false);
  const [isVisionAnalyzing, setIsVisionAnalyzing] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [visionStatus, setVisionStatus] = useState("Idle");
  const [isAvatarSigning, setIsAvatarSigning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recognitionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [activeAIResponse, setActiveAIResponse] = useState("");
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [currentWord, setCurrentWord] = useState("");
  const signingAnimationRef = useRef<NodeJS.Timeout | null>(null);

  const [avatarImage, setAvatarImage] = useState("https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80&w=400&h=600");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [signHistory, setSignHistory] = useState<string[]>([]);

  // Update sign history when current word changes
  useEffect(() => {
    if (currentWord) {
      setSignHistory(prev => [currentWord, ...prev].slice(0, 5));
    }
  }, [currentWord]);

  // --- AI RESPONSE SIGNING EFFECT ---
  useEffect(() => {
    if (aiResponse && aiResponse.length > 1) {
      setIsAvatarSigning(true);
      setAvatarImage("https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&q=80&w=400&h=600"); // Speaking/Active expression
      // Clean and split words for sequence
      const words = aiResponse.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "").split(/\s+/);
      
      words.forEach((w, i) => {
        setTimeout(() => {
          if (w.length > 0) setCurrentWord(w.toLowerCase());
        }, i * 450);
      });

      const timer = setTimeout(() => {
        setIsAvatarSigning(false);
        setCurrentWord("");
        setAvatarImage("https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80&w=400&h=600"); // Back to neutral
      }, words.length * 450 + 500);
      return () => clearTimeout(timer);
    }
  }, [aiResponse]);

  // --- SPEECH RECOGNITION (STT) ---
  const transcriptionRef = useRef("");
  const isListeningRef = useRef(isListening);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    if ((mode === 'Vocal-Deaf' || mode === 'Speech') && 'webkitSpeechRecognition' in window) {
      if (!isListening) return; // Only initialize and start if we are listening
      
      const { webkitSpeechRecognition } = window as any;
      const recognition = new webkitSpeechRecognition();
      
      recognition.continuous = true;
      recognition.interimResults = true;
      
      const langMap: Record<string, string> = {
        'English': 'en-US',
        'Arabic': 'ar-SA',
        'French': 'fr-FR',
        'Spanish': 'es-ES',
        'German': 'de-DE',
        'Italian': 'it-IT',
        'Portuguese': 'pt-PT',
        'Russian': 'ru-RU',
        'Chinese': 'zh-CN',
        'Japanese': 'ja-JP'
      };
      
      recognition.lang = langMap[profile.language || 'English'] || 'en-US';

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalSegment = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalSegment += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        const activeText = finalSegment || interimTranscript;
        if (activeText) {
          setTranscription(activeText);
          transcriptionRef.current = activeText;
          
          // FOR VOCAL-DEAF: Directly update parent with recognized text in real-time
          if (mode === 'Vocal-Deaf') {
            onTranscription(activeText);
          }
          
          // Identify the last/current word for signing
          const words = activeText.trim().split(/\s+/);
          const lastWord = words[words.length - 1]?.toLowerCase();
          if (lastWord && lastWord !== currentWord) {
             setCurrentWord(lastWord);
          }
        }

        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        
        silenceTimerRef.current = setTimeout(() => {
          const textToSend = transcriptionRef.current;
          if (textToSend && textToSend.trim().length > 1) {
            onTranscription(textToSend.trim());
            setTranscription("");
            transcriptionRef.current = "";
            setCurrentWord("");
          }
        }, 2500);
      };

      recognition.onerror = (event: any) => {
        console.error("Speech Recognition Error:", event.error);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setErrorMsg("Microphone access blocked. Please check your browser permissions.");
          setIsListening(false);
          transcriptionRef.current = "Permission Error";
        } else if (event.error === 'network') {
          setErrorMsg("Speech recognition network error. Please check your connection.");
        } else {
          setErrorMsg(`Microphone error: ${event.error}`);
        }
      };

      recognition.onend = () => {
        // Continuous mode naturally stops after some silence. We must actively restart it if the user still wants to listen.
        if (isListeningRef.current && transcriptionRef.current !== "Permission Error") {
          setTimeout(() => {
            if (isListeningRef.current) {
              try {
                recognition.start();
              } catch(e) {
                console.warn("Retrying speech recognition...");
              }
            }
          }, 250); // fast restart
        }
      };

      recognitionRef.current = recognition;

      try {
        recognition.start();
      } catch(e) {
        console.error("Manual start failed", e);
      }

      return () => {
        // Cleanup on unmount or when stopping
        recognition.onend = null;
        recognition.onerror = null;
        recognition.onresult = null;
        try {
          recognition.stop();
        } catch(e) {}
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      };
    }
  }, [mode, profile.language, isListening]);

  const toggleListening = () => {
    setIsListening(prev => !prev);
  };

  // --- VISION SIGN RECOGNITION ---
  const startVision = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setIsVisionActive(true);
        setVisionStatus("Analyzing Signs...");
      }
    } catch (err) {
      console.error("Camera access failed", err);
      setVisionStatus("Camera Error");
    }
  };

  const stopVision = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    setIsVisionActive(false);
    setIsVisionAnalyzing(false);
    setVisionStatus("Idle");
  };

  // Improved Vision Loop using useEffect
  useEffect(() => {
    if (!isVisionActive) return;

    const captureAndAnalyze = async () => {
      if (!isVisionActive || !videoRef.current || !canvasRef.current) return;

      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const imageData = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
        
        setIsVisionAnalyzing(true);
        try {
          const response = await fetch("/api/sign-to-text", {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ 
               image: imageData,
               language: profile.language || "English",
               level: profile.level || "Basic"
             })
          });

          if (!response.ok) throw new Error("Vision Server Error");
          const data = await response.json();
          const text = data.text;

          if (text && !text.toUpperCase().includes("[NO_SIGN]")) {
            const cleanText = text.replace(/[\[\]]/g, '').trim();
            if (cleanText) {
              setTranscription((prev) => {
                // If it's a single letter (fingerspelling), append it to the current spelling buffer.
                // If the previous was also fingerspelling, concatenate. Otherwise, overwrite if it's a new word.
                const isSingleLetter = cleanText.length === 1 && /^[a-zA-Z]$/.test(cleanText);
                if (isSingleLetter) {
                   return prev + cleanText;
                }
                return cleanText;
              });
              
              // If it's a full word, send it automatically
              if (cleanText.length > 2) {
                onTranscription(cleanText);
                setTimeout(() => setTranscription(""), 3000);
              }
            }
          }
        } catch (e) {
          console.error("Vision AI error", e);
        } finally {
          setTimeout(() => setIsVisionAnalyzing(false), 800);
        }
      }
    };

    const interval = setInterval(captureAndAnalyze, 4000); // 4s interval to respect quotas better
    return () => clearInterval(interval);
  }, [isVisionActive, profile.language]);

  // --- SIGNING VARIANTS ---
  const getHandPose = (word: string, side: 'left' | 'right') => {
    const w = word.toLowerCase();
    
    // Explicit Letters (ASL / Kaggle MNIST simulation fingerspelling)
    // We adjust rotation, scale, and x/y marginally depending on the letter to simulate distinct shapes.
    if (w.length === 1 && /^[a-z]$/.test(w)) {
        const charCode = w.charCodeAt(0) - 97; // 0 for 'a', 25 for 'z'
        // Create deterministic but varied offsets based on letter
        const xOffset = (charCode % 5) * 5;
        const yOffset = (charCode % 3) * 10 - 15;
        const rotateOffset = (charCode % 7) * 10 - 30;
        
        return {
          x: side === 'left' ? xOffset : -xOffset,
          y: yOffset,
          rotate: side === 'left' ? rotateOffset : -rotateOffset,
          scale: 0.9,
          opacity: 0.9,
          transition: { type: "spring", stiffness: 150, damping: 15 }
        };
    }

    // Greeting: Hello, Hi, Marhaba
    if (['hello', 'hi', 'hey', 'مرحبا', 'اهلا', 'سلام'].some(g => w.includes(g))) {
        return side === 'left' 
          ? { x: 55, y: -70, rotate: 85, scale: 1.35, opacity: 1, transition: { type: "spring", stiffness: 120, damping: 10 } } 
          : { x: -10, y: 15, rotate: 5, scale: 0.9, opacity: 0.8 };
    }
    // Gratitude: Thanks, Shukran
    if (['thank', 'shukran', 'شكرا', 'تقدير', 'love'].some(g => w.includes(g))) {
        return { 
          y: [0, 50, 0], 
          x: side === 'left' ? 20 : -20, 
          scale: [1, 1.4, 1], 
          rotate: side === 'left' ? -45 : 45,
          transition: { duration: 0.8, ease: "circInOut" }
        };
    }
    // Deep Cognition: Think, Know, Mind, Cognify
    if (['think', 'know', 'brain', 'mind', 'cognify', 'عقل', 'فكر', 'اعرف', 'ذكاء', 'ai'].some(g => w.includes(g))) {
        return side === 'left' 
          ? { y: -90, x: 30, rotate: 115, scale: 1.15, opacity: 1, transition: { type: "spring", stiffness: 80, damping: 12 } } 
          : { y: -25, x: -15, rotate: -20, scale: 0.85, opacity: 0.65 };
    }
    // Help / Support
    if (['help', 'support', 'assist', 'مساعدة', 'عون', 'please'].some(g => w.includes(g))) {
        return { 
          y: [30, 50, 30], 
          x: side === 'left' ? 50 : -50, 
          rotate: side === 'left' ? 15 : -15, 
          scale: [1.3, 1.5, 1.3],
          opacity: 1,
          transition: { repeat: Infinity, duration: 1.5 }
        };
    }
    // Directions / Questions: What, Where...
    if (['what', 'where', 'how', 'why', 'who', 'ماذا', 'اين', 'كيف', 'لماذا', 'من', '؟'].some(q => w.includes(q))) {
        const shake = { rotate: side === 'left' ? [-50, -40, -50] : [50, 40, 50] };
        return { 
          x: side === 'left' ? -65 : 65, 
          y: -30, 
          scale: 1.35, 
          ...shake,
          transition: { repeat: Infinity, duration: 0.5, ease: "linear" } 
        };
    }
    // Agreement: Yes, OK, True
    if (['yes', 'ok', 'حق', 'نعم', 'حاضر', 'صحيح', 'تمام'].some(x => w.includes(x))) {
        return { 
          y: [0, 40, 0, 40, 0], 
          scale: 1.3, 
          rotate: side === 'left' ? -10 : 10,
          transition: { duration: 0.6 } 
        };
    }
    // Negation: No, Not, Never
    if (['no', 'not', 'لا', 'مرفوض', 'كلا', 'ابدا'].some(x => w.includes(x))) {
        return { 
          x: side === 'left' ? [-50, 0, -50] : [50, 0, 50], 
          rotate: side === 'left' ? -40 : 40, 
          scale: 0.8,
          transition: { duration: 0.4, repeat: 1 } 
        };
    }
    
    // Refined fluid default signing motion
    const baseL = { 
      x: [-20, 25, -5, 0], 
      y: [0, -40, 20, 0], 
      rotate: [-25, 45, -55, -25], 
      scale: [1, 1.25, 0.9, 1],
      transition: { duration: 0.7, ease: "easeInOut" }
    };
    const baseR = { 
      x: [20, -25, 5, 0], 
      y: [0, 40, -20, 0], 
      rotate: [25, -45, 55, 25], 
      scale: [1, 1.25, 0.9, 1],
      transition: { duration: 0.8, ease: "easeInOut" }
    };
    return side === 'left' ? baseL : baseR;
  };

  const signerVariants: any = {
    idle: {
      y: [0, -6, 0],
      scale: [1, 1.02, 1],
      rotate: [0, 0.5, -0.5, 0],
      transition: { repeat: Infinity, duration: 6, ease: "easeInOut" }
    },
    signing: {
      y: [0, -8, 8, 0],
      rotate: [-0.8, 0.8, -0.8],
      scale: [1, 1.03, 0.98, 1],
      transition: { repeat: Infinity, duration: 1.5, ease: "easeInOut" }
    }
  };

  return (
    <motion.div 
      drag
      dragConstraints={{ left: -100, right: 1000, top: -800, bottom: 100 }}
      dragElastic={0.2}
      dragMomentum={false}
      className="fixed bottom-24 left-8 z-50 flex flex-row items-end gap-6 pointer-events-none"
    >
      <AnimatePresence>
        {(mode === 'Vocal-Deaf' || mode === 'Sign-Only' || mode === 'Speech') && (
          <motion.div
            key="virtual-signer-container"
            initial={{ opacity: 0, x: -25, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -25, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 100, damping: 20 }}
            className="flex flex-col items-center gap-2 pointer-events-auto shrink-0 cursor-grab active:cursor-grabbing"
          >
             <div className="relative group pointer-events-auto">
                <div className="relative w-68 h-88 rounded-[40px] overflow-hidden flex flex-col items-center justify-end bg-transparent shadow-3xl transition-all duration-700 border border-white/10 backdrop-blur-[2px]">
                   <div className="absolute top-5 left-5 flex items-center gap-2.5 z-20">
                      <div className={`w-3 h-3 rounded-full ${isAvatarSigning ? 'bg-amber-400 animate-pulse' : (isListening ? 'bg-primary animate-ping' : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]')}`} />
                      <span className="text-[11px] font-black uppercase text-white tracking-[0.25em] drop-shadow-xl">
                         {isAvatarSigning ? 'Broadcasting' : (isListening ? 'Interpreting' : 'Standby')}
                      </span>
                   </div>

                   {/* Current Word Bubble Overlay */}
                    <AnimatePresence mode="wait">
                      {currentWord && (
                       <motion.div 
                         key={currentWord}
                         initial={{ opacity: 0, y: 15, scale: 0.8 }}
                         animate={{ opacity: 1, y: 0, scale: 1 }}
                         exit={{ opacity: 0, scale: 1.4, transition: { duration: 0.2 } }}
                         className="absolute top-14 left-1/2 -translate-x-1/2 z-30 px-4 py-1.5 bg-primary/25 backdrop-blur-2xl border border-primary/40 rounded-2xl shadow-[0_0_20px_rgba(59,130,246,0.3)]"
                       >
                         <span className="text-[11px] font-black text-white uppercase tracking-widest">{currentWord}</span>
                       </motion.div>
                      )}
                    </AnimatePresence>
                    
                    {/* Dynamic AI Hands - Hands-only Interpreter */}
                    <AnimatePresence mode="wait">
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ 
                          opacity: 1,
                          boxShadow: isAvatarSigning 
                            ? ["0 0 10px rgba(59, 130, 246, 0.1)", "0 0 20px rgba(59, 130, 246, 0.2)", "0 0 10px rgba(59, 130, 246, 0.1)"] 
                            : "0 0 0px rgba(59, 130, 246, 0)"
                        }}
                        transition={{ 
                          boxShadow: { repeat: Infinity, duration: 2 }
                        }}
                        className={`w-full h-full relative z-10 flex flex-col items-center justify-end overflow-hidden rounded-[40px] transition-all duration-1000 bg-slate-900/90 backdrop-blur-3xl border border-white/10`}
                      >
                         {/* Interactive Sign-Language Hands - high fidelity style */}
                         {(mode === 'Vocal-Deaf' || mode === 'Sign-Only' || mode === 'Speech') && (
                           <div className="absolute inset-0 z-20 pointer-events-none">
                             <motion.img 
                               drag
                               dragConstraints={{ left: -150, right: 150, top: -300, bottom: 100 }}
                               dragElastic={0.2}
                               src="https://img.icons8.com/fluency/144/hand.png"
                               animate={(isListening || isVisionActive || isAvatarSigning ? getHandPose(currentWord, 'left') : { x: 0, y: 40, rotate: -35, opacity: 0.4, scale: 0.6 }) as any}
                               className="absolute bottom-32 left-8 w-36 h-36 z-30 drop-shadow-[0_20px_20px_rgba(59,130,246,0.3)] pointer-events-auto cursor-grab active:cursor-grabbing"
                               style={{ transform: 'scaleX(-1)' }}
                               referrerPolicy="no-referrer"
                               transition={{ type: "spring", stiffness: 90, damping: 14 }}
                             />
                             <motion.img 
                               drag
                               dragConstraints={{ left: -150, right: 150, top: -300, bottom: 100 }}
                               dragElastic={0.2}
                               src="https://img.icons8.com/fluency/144/hand.png"
                               animate={(isListening || isVisionActive || isAvatarSigning ? getHandPose(currentWord, 'right') : { x: 0, y: 40, rotate: 35, opacity: 0.4, scale: 0.6 }) as any}
                               className="absolute bottom-32 right-8 w-36 h-36 z-30 drop-shadow-[0_20px_20px_rgba(59,130,246,0.3)] pointer-events-auto cursor-grab active:cursor-grabbing"
                               referrerPolicy="no-referrer"
                               transition={{ type: "spring", stiffness: 90, damping: 14 }}
                             />
                           </div>
                         )}
                      </motion.div>
                    </AnimatePresence>

                    <div className="w-full py-3 bg-white/5 backdrop-blur-2xl text-center z-20 border-t border-white/10">
                       <span className="text-[11px] text-white/80 font-black uppercase tracking-[0.2em] px-3">
                         {isAvatarSigning ? 'Neural Translator' : (mode === 'Speech' ? 'Voice Core' : 'Interpreter Active')}
                       </span>
                    </div>

                    {/* Sign History Trace */}
                    <div className="absolute top-[80px] right-4 z-40 flex flex-col gap-1.5 items-end">
                      <AnimatePresence>
                        {signHistory.slice(1, 5).map((word, idx) => (
                          <motion.div
                            key={`${word}-${idx}`}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 0.5 - (idx * 0.1), x: 0 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            className="bg-black/30 backdrop-blur-sm px-2 py-0.5 rounded-md border border-white/10"
                          >
                            <span className="text-[8px] text-white font-bold uppercase tracking-widest">{word}</span>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                </div>
             </div>
          </motion.div>
        )}

        {(mode === 'Vocal-Deaf' || mode === 'Speech') && (
          <motion.div
            key="vocal-deaf-controls"
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="flex flex-col items-start gap-3 pointer-events-auto cursor-grab active:cursor-grabbing"
          >
            {errorMsg && (
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-rose-500/90 backdrop-blur-md p-3 rounded-xl border border-rose-400 shadow-xl max-w-sm flex items-center gap-3"
              >
                <div className="bg-white/20 p-1.5 rounded-lg">
                  <MicOff className="w-4 h-4 text-white" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] font-black uppercase text-white/70 tracking-widest leading-none mb-1">Access Error</span>
                  <p className="text-xs font-bold text-white leading-tight">{errorMsg}</p>
                </div>
                <button 
                  onClick={() => setErrorMsg(null)}
                  className="ml-2 text-white/50 hover:text-white"
                >
                  <RefreshCw className="w-3 h-3" onClick={toggleListening} />
                </button>
              </motion.div>
            )}

            {transcription && (
              <div className="bg-white/95 backdrop-blur-md p-4 rounded-2xl border border-primary/30 shadow-2xl max-w-sm flex flex-col gap-3">
                 <div className="flex items-center justify-between gap-4">
                    <span className="text-[9px] font-black uppercase text-primary/60 tracking-widest">Live Transcription</span>
                    <button 
                      onClick={() => {
                        onTranscription(transcription);
                        setTranscription("");
                      }}
                      className="px-2 py-1 bg-primary text-white text-[9px] font-black uppercase rounded-lg hover:bg-primary/90"
                    >
                      Send Now
                    </button>
                 </div>
                 <p className="text-sm font-medium text-slate-700 leading-relaxed italic">
                   "{transcription}"
                 </p>
              </div>
            )}
            
            <button
              onClick={toggleListening}
              className={`p-5 rounded-3xl shadow-2xl transition-all active:scale-95 flex items-center gap-3 ${
                isListening ? 'bg-rose-500 scale-110' : 'bg-primary'
              }`}
            >
              {isListening ? (
                <>
                  <MicOff className="w-6 h-6 text-white" />
                  <span className="text-white text-xs font-black uppercase tracking-widest">Listening...</span>
                </>
              ) : (
                <>
                  <Mic className="w-6 h-6 text-white" />
                  <span className="text-white text-xs font-black uppercase tracking-widest">Speak to translate</span>
                </>
              )}
            </button>
          </motion.div>
        )}

        {mode === 'Sign-Only' && (
          <motion.div
            key="sign-only-controls"
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="flex flex-col items-start gap-3 pointer-events-auto cursor-grab active:cursor-grabbing"
          >
             {transcription && (
               <div className="bg-white/95 backdrop-blur-md p-4 rounded-2xl border border-emerald-200 shadow-2xl max-w-sm flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-4">
                     <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[9px] font-black uppercase text-emerald-600 tracking-widest">Sign Detected</span>
                     </div>
                     <button 
                        onClick={() => {
                          onTranscription(transcription);
                          setTranscription("");
                        }}
                        className="px-2 py-1 bg-emerald-500 text-white text-[9px] font-black uppercase rounded-lg hover:bg-emerald-600"
                      >
                        Confirm
                      </button>
                  </div>
                  <p className="text-sm font-bold text-slate-800 leading-relaxed italic capitalize">
                    "{transcription}"
                  </p>
               </div>
             )}

             <div className={`relative rounded-[32px] overflow-hidden shadow-2xl border-4 transition-all ${isVisionActive ? (isVisionAnalyzing ? 'border-amber-400 scale-[1.02]' : 'border-primary') : 'border-slate-200 opacity-50'}`}>
                {isVisionActive && (
                  <div className="absolute inset-0 z-10 pointer-events-none">
                     {/* Scanning Line Animation */}
                     <motion.div 
                        animate={{ top: ['0%', '100%', '0%'] }}
                        transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
                        className="absolute left-0 right-0 h-0.5 bg-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.8)] z-10"
                     />
                     {/* Corner Brackets */}
                     <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-emerald-400" />
                     <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-emerald-400" />
                     <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-emerald-400" />
                     <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-emerald-400" />
                  </div>
                )}
                
                {isVisionActive && (
                  <div className="absolute top-4 right-4 z-20 flex gap-2">
                    {isVisionAnalyzing && (
                      <div className="bg-amber-400 text-black text-[8px] font-black uppercase px-2 py-1 rounded-full animate-bounce">
                        Analyzing...
                      </div>
                    )}
                  </div>
                )}
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  className={`w-64 h-48 object-cover bg-slate-900 ${isVisionActive ? 'opacity-100' : 'opacity-20'}`}
                />
                <canvas ref={canvasRef} width="640" height="480" className="hidden" />
                
                {!isVisionActive && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Camera className="w-12 h-12 text-slate-400 opacity-50" />
                  </div>
                )}
                
                {isVisionActive && (
                  <div className="absolute top-4 left-4 right-4 flex justify-between items-center z-20">
                    <div className="px-3 py-1 bg-primary/90 text-white text-[9px] font-black uppercase tracking-widest rounded-full flex items-center gap-2">
                       <RefreshCw className="w-3 h-3 animate-spin" /> {visionStatus}
                    </div>
                  </div>
                )}
             </div>

             <div className="flex gap-3">
                {isVisionActive && (
                  <button
                    onClick={() => {
                        setIsVisionAnalyzing(true);
                        // We rely on the existing loop or can trigger one-off if needed
                        // But for simplicity, we just show feedback
                    }}
                    className="p-4 bg-white/10 hover:bg-white/20 text-white rounded-3xl backdrop-blur-md transition-all active:scale-95 border border-white/5"
                    title="Force Analysis"
                  >
                    <Brain className="w-5 h-5" />
                  </button>
                )}
                <button
                  onClick={isVisionActive ? stopVision : startVision}
                  className={`p-5 rounded-3xl shadow-2xl transition-all active:scale-95 flex items-center gap-3 ${
                    isVisionActive ? 'bg-emerald-500 scale-105' : 'bg-slate-900'
                  }`}
                >
                  {isVisionActive ? (
                    <>
                      <VideoOff className="w-6 h-6 text-white" />
                      <span className="text-white text-xs font-black uppercase tracking-widest">Stop Vision</span>
                    </>
                  ) : (
                    <>
                      <Video className="w-6 h-6 text-white" />
                      <span className="text-white text-xs font-black uppercase tracking-widest">Start Sign Translation</span>
                    </>
                  )}
                </button>
             </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
