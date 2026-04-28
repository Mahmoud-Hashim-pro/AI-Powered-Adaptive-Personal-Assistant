import React, { useState, useEffect, useRef } from 'react';
import { AccessibilityMode, UserProfile } from '../types';
import { geminiService } from '../services/geminiService';
import { Mic, MicOff, Video, VideoOff, Brain, Sparkles, MessageSquare, Eye, Camera, RefreshCw, Hand, Heart, HelpCircle, ThumbsUp, ThumbsDown, Smile, Frown, Clock, Ear, MessageCircle, Home, Briefcase, Octagon, User, Activity, VolumeX, Volume2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Hands, Results, HAND_CONNECTIONS } from '@mediapipe/hands';
import { Camera as MediaPipeCamera } from '@mediapipe/camera_utils';

interface AccessibilityOverlayProps {
  mode: AccessibilityMode;
  profile: UserProfile;
  aiResponse?: string;
  onTranscription: (text: string) => void;
  isListening?: boolean;
  onToggleListening?: () => void;
}

export default function AccessibilityOverlay({ mode, profile, aiResponse = "", onTranscription, isListening = false, onToggleListening }: AccessibilityOverlayProps) {
  const [isVisionActive, setIsVisionActive] = useState(false);
  const [isVisionAnalyzing, setIsVisionAnalyzing] = useState(false);
  const [isAvatarSigning, setIsAvatarSigning] = useState(false);
  const [detectionConfidence, setDetectionConfidence] = useState(0);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handsRef = useRef<Hands | null>(null);
  const cameraRef = useRef<MediaPipeCamera | null>(null);

  const [currentWord, setCurrentWord] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(mode !== 'None' && mode !== 'Sign-Only');
  const [avatarImage, setAvatarImage] = useState("https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80&w=400&h=600");
  const [signHistory, setSignHistory] = useState<string[]>([]);

  // Sliding window for decision confirmation
  const FRAME_BUFFER_SIZE = 15;
  const CONFIRMATION_THRESHOLD = 0.65; // 65% of frames must match
  const detectionBuffer = useRef<string[]>([]);
  const lastEmittedGesture = useRef<string>("");

  // Update sign history when current word changes
  useEffect(() => {
    if (currentWord) {
      setSignHistory(prev => [currentWord, ...prev].slice(0, 5));
    }
  }, [currentWord]);

  // Handle hand movement when user is speaking
  useEffect(() => {
    if (isListening) {
      setCurrentWord("listening");
    } else if (!isAvatarSigning) {
      setCurrentWord("");
    }
  }, [isListening, isAvatarSigning]);

  // --- TTS and AI RESPONSE SIGNING EFFECT ---
  useEffect(() => {
    if (aiResponse && aiResponse.length > 1) {
      setIsAvatarSigning(true);
      setAvatarImage("https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&q=80&w=400&h=600"); // Speaking/Active expression
      
      // text-to-speech for AI response
      if (autoSpeak && (mode === 'Speech' || mode === 'Vocal-Deaf' || mode === 'Visual' || mode === 'Sign-Only')) {
        if ('speechSynthesis' in window) {
          const cleanText = aiResponse.replace(/\[Signs:.*?\]/g, '').replace(/[*+#_`~\[\]()]/g, '');
          const utterance = new SpeechSynthesisUtterance(cleanText);
           const hasArabic = /[\u0600-\u06FF]/.test(cleanText);
           const langMap: Record<string, string> = {
            'English': 'en-US',
            'Arabic': 'ar-SA',
            'Egyptian Ammiya': 'ar-EG',
            'French': 'fr-FR',
            'Spanish': 'es-ES',
            'German': 'de-DE'
           };
           
           if (hasArabic) {
             // If profile language is Egyptian or content has Egyptian keywords, use ar-EG
             const isEgyptian = profile.language === 'Egyptian Ammiya' || 
                                cleanText.includes('يا باشا') || 
                                cleanText.includes('تمام') || 
                                cleanText.includes('ازيك');
             utterance.lang = isEgyptian ? 'ar-EG' : 'ar-SA';
           } else {
             utterance.lang = langMap[profile.language || 'English'] || 'en-US';
           }
           
           utterance.onstart = () => setIsSpeaking(true);
           utterance.onend = () => setIsSpeaking(false);
           utterance.onerror = () => setIsSpeaking(false);

           window.speechSynthesis.cancel(); // stop any ongoing synthesis
           window.speechSynthesis.speak(utterance);
        }
      }

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

  // --- SPEECH RECOGNITION (STT) VIA MEDIA RECORDER (Backend Gemini) ---
  const transcriptionRef = useRef("");
  // --- VISION SIGN RECOGNITION (MediaPipe + Confidence Thresholding) ---
  const [visionStatus, setVisionStatus] = useState("Idle");
  const [transcription, setTranscription] = useState("");

  const onResults = (results: Results) => {
    if (!canvasRef.current || !videoRef.current) return;
    
    // Confidence Filter: Only process if both hands (or one) have high landmark trust
    const hasHighConfidence = results.multiHandLandmarks.length > 0 && 
                             results.multiHandedness.some(h => h.score > 0.75);

    if (hasHighConfidence) {
      setDetectionConfidence(Math.max(...results.multiHandedness.map(h => h.score)));
      triggerAnalysis();
    } else {
      setDetectionConfidence(0);
      detectionBuffer.current = []; // Clear buffer if no reliable hands
    }
  };

  const triggerAnalysis = async () => {
    if (!isVisionActive || isVisionAnalyzing || !videoRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;
    
    context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const imageData = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
    
    setIsVisionAnalyzing(true);
    try {
      const text = await geminiService.translateSign(
        imageData,
        profile.language || "English",
        profile.level || "Basic"
      );

      if (text && !text.toUpperCase().includes("[NO_SIGN]")) {
        const cleanText = text.replace(/[\[\]]/g, '').trim().toLowerCase();
        
        // Frame Aggregation & Decision Confirmation
        detectionBuffer.current.push(cleanText);
        if (detectionBuffer.current.length > FRAME_BUFFER_SIZE) {
          detectionBuffer.current.shift();
        }

        // Count occurrences in window
        const counts = detectionBuffer.current.reduce((acc: any, val) => {
          acc[val] = (acc[val] || 0) + 1;
          return acc;
        }, {});

        const mostFrequent = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b, "");
        const confidence = counts[mostFrequent] / detectionBuffer.current.length;

        // Confirmation Threshold: If gesture is sustained over 65% of buffer
        if (confidence >= CONFIRMATION_THRESHOLD && mostFrequent !== lastEmittedGesture.current) {
          lastEmittedGesture.current = mostFrequent;
          setTranscription(mostFrequent);
          onTranscription(mostFrequent);
          
          // Audio feedback
          if ('speechSynthesis' in window && autoSpeak && (mode === 'Sign-Only' || mode === 'Vocal-Deaf')) {
             const utterance = new SpeechSynthesisUtterance(mostFrequent);
             const isEgyptian = profile.language === 'Egyptian Ammiya';
             const isArabic = profile.language === 'Arabic';
             utterance.lang = isEgyptian ? 'ar-EG' : (isArabic ? 'ar-SA' : 'en-US');
             window.speechSynthesis.speak(utterance);
          }
          
          // Reset buffer after strong confirmation to allow new words
          detectionBuffer.current = [];
        }
      }
    } catch (e) {
      console.error("Vision AI error", e);
    } finally {
      setIsVisionAnalyzing(false);
    }
  };

  const startVision = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 640, height: 480, facingMode: 'user' } 
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        
        // Initialize MediaPipe Hands
        const hands = new Hands({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.7,
          minTrackingConfidence: 0.6
        });

        hands.onResults(onResults);
        handsRef.current = hands;

        const camera = new MediaPipeCamera(videoRef.current, {
          onFrame: async () => {
            if (handsRef.current && videoRef.current) {
              await handsRef.current.send({ image: videoRef.current });
            }
          },
          width: 640,
          height: 480
        });

        camera.start();
        cameraRef.current = camera;
        setIsVisionActive(true);
        setVisionStatus("Live Tracking...");
      }
    } catch (err) {
      console.error("Camera access failed", err);
      setVisionStatus("Camera Error");
    }
  };

  const stopVision = () => {
    if (cameraRef.current) cameraRef.current.stop();
    if (handsRef.current) handsRef.current.close();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    setIsVisionActive(false);
    setIsVisionAnalyzing(false);
    setVisionStatus("Idle");
    setDetectionConfidence(0);
  };

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
      className="fixed bottom-32 left-4 md:left-8 z-50 flex flex-col gap-6 pointer-events-none"
    >
      <AnimatePresence>
        {(mode === 'Vocal-Deaf' || mode === 'Sign-Only' || mode === 'Speech' || mode === 'Visual') && (
          <motion.div
            key="virtual-signer-container"
            initial={{ opacity: 0, x: -25, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -25, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 100, damping: 20 }}
            className="flex flex-col items-center gap-2 pointer-events-auto shrink-0 cursor-grab active:cursor-grabbing"
          >
              <div className="flex flex-col items-center gap-4">
                 {(mode === 'Speech' || mode === 'Vocal-Deaf' || mode === 'Sign-Only' || mode === 'Visual') && (
                   <button
                    onClick={() => {
                      setAutoSpeak(!autoSpeak);
                      if (autoSpeak && 'speechSynthesis' in window) {
                        window.speechSynthesis.cancel();
                        setIsSpeaking(false);
                      }
                    }}
                    className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-xl transition-all active:scale-95 border-2 ${
                      autoSpeak
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-600'
                        : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600'
                    }`}
                    title={autoSpeak ? "Auto-Speak AI Response (ON)" : "Auto-Speak AI Response (OFF)"}
                  >
                    {autoSpeak ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
                  </button>
                )}
                {isSpeaking && (
                  <button
                    onClick={() => {
                      if ('speechSynthesis' in window) {
                        window.speechSynthesis.cancel();
                      }
                      setIsSpeaking(false);
                    }}
                    className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-xl transition-all active:scale-95 border-2 bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100"
                    title="Stop AI Voice"
                  >
                    <VolumeX className="w-6 h-6" />
                  </button>
                )}
                {onToggleListening && (
                  <button
                    onClick={onToggleListening}
                    className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-xl transition-all active:scale-95 border-2 ${
                      isListening 
                        ? 'bg-rose-500 border-rose-400 text-white animate-pulse' 
                        : 'bg-slate-900 border-slate-700 text-white hover:bg-slate-800'
                    }`}
                  >
                    {isListening ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                  </button>
                )}
             </div>
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
                <AnimatePresence>
                  {detectionConfidence > 0 && (
                    <motion.div 
                      key="confidence-bar"
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: `${detectionConfidence * 100}%` }}
                      exit={{ opacity: 0 }}
                      className="absolute bottom-0 left-0 h-1.5 bg-emerald-500 z-30"
                    />
                  )}
                </AnimatePresence>

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
