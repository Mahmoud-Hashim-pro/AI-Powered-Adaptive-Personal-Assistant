import { useState, useEffect, useRef } from "react";
import { UserProfile } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { Mic, Square, Play, RefreshCw, Menu, Download, FileText, Settings, Video } from "lucide-react";

interface SignVideoStudioProps {
  profile: UserProfile;
  onMenuClick: () => void;
  isEmbedded?: boolean;
}

export default function SignVideoStudio({ profile, onMenuClick, isEmbedded }: SignVideoStudioProps) {
  const [inputText, setInputText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [currentSignWord, setCurrentSignWord] = useState<string | null>(null);
  const [sequence, setSequence] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  
  const recognitionRef = useRef<any>(null);

  // Setup exact same getHandPose as overlay, or just basic mapping
  const getHandPose = (word: string, side: 'left' | 'right') => {
    const w = word.toLowerCase();
    
    // Exact ASL Letters
    if (w.length === 1 && /^[a-z]$/.test(w)) {
        const charCode = w.charCodeAt(0) - 97;
        const xOffset = (charCode % 5) * 5;
        const yOffset = (charCode % 3) * 10 - 15;
        const rotateOffset = (charCode % 7) * 10 - 30;
        
        return {
          x: side === 'left' ? xOffset : -xOffset,
          y: yOffset + 20, /* Shifted up slightly for studio */
          rotate: side === 'left' ? rotateOffset : -rotateOffset,
          scale: 0.9,
          opacity: 0.9,
          transition: { type: "spring", stiffness: 150, damping: 15 }
        };
    }

    // Logic for other words (copied from overlay for consistency)
    if (['hello', 'hi', 'hey', 'مرحبا', 'اهلا', 'سلام'].some(g => w.includes(g))) {
        return side === 'left' 
          ? { x: 55, y: -70, rotate: 85, scale: 1.35, opacity: 1, transition: { type: "spring", stiffness: 120, damping: 10 } } 
          : { x: -10, y: 15, rotate: 5, scale: 0.9, opacity: 0.8 };
    }
    if (['thank', 'shukran', 'شكرا', 'تقدير', 'love'].some(g => w.includes(g))) {
        return { y: [0, 50, 0], x: side === 'left' ? 20 : -20, scale: [1, 1.4, 1], rotate: side === 'left' ? -45 : 45, transition: { duration: 0.8 } };
    }
    if (['think', 'know', 'brain', 'mind', 'cognify', 'عقل', 'فكر', 'اعرف', 'ذكاء', 'ai'].some(g => w.includes(g))) {
        return side === 'left' 
          ? { y: -90, x: 30, rotate: 115, scale: 1.15, opacity: 1, transition: { type: "spring", stiffness: 80, damping: 12 } } 
          : { y: -25, x: -15, rotate: -20, scale: 0.85, opacity: 0.65 };
    }
    if (['help', 'support', 'assist', 'مساعدة', 'عون', 'please'].some(g => w.includes(g))) {
        return { y: [30, 50, 30], x: side === 'left' ? 50 : -50, rotate: side === 'left' ? 15 : -15, scale: [1.3, 1.5, 1.3], opacity: 1, transition: { repeat: Infinity, duration: 1.5 } };
    }
    if (['what', 'where', 'how', 'why', 'who', 'ماذا', 'اين', 'كيف', 'لماذا', 'من', '؟'].some(q => w.includes(q))) {
        return { x: side === 'left' ? -65 : 65, y: -30, scale: 1.35, rotate: side === 'left' ? [-50, -40, -50] : [50, 40, 50], transition: { repeat: Infinity, duration: 0.5 } };
    }
    if (['yes', 'ok', 'حق', 'نعم', 'حاضر', 'صحيح', 'تمام'].some(x => w.includes(x))) {
        return { y: [0, 40, 0, 40, 0], scale: 1.3, rotate: side === 'left' ? -10 : 10, transition: { duration: 0.6 } };
    }
    if (['no', 'not', 'never', 'don', 'لا', 'كلا', 'ليس'].some(x => w.includes(x))) {
        return { x: side === 'left' ? [-50, 0, -50] : [50, 0, 50], rotate: side === 'left' ? -40 : 40, scale: 0.8, transition: { duration: 0.4, repeat: 1 } };
    }
    // Default talking/spelling animation
    return side === 'left' 
      ? { x: [-20, 25, -5, 0], y: [0, -40, 20, 0], rotate: [-25, 45, -55, -25], scale: [1, 1.25, 0.9, 1], transition: { duration: 0.7 } } 
      : { x: [20, -25, 5, 0], y: [0, 40, -20, 0], rotate: [25, -45, 55, 25], scale: [1, 1.25, 0.9, 1], transition: { duration: 0.8 } };
  };

  const startRecording = () => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = profile.language === 'Arabic' ? 'ar-SA' : 'en-US';

      recognition.onresult = (event: any) => {
        let text = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
             text += event.results[i][0].transcript;
        }
        setInputText(text);
      };

      recognition.onerror = () => { setIsRecording(false); };
      recognition.onend = () => { setIsRecording(false); };
      
      recognitionRef.current = recognition;
      recognition.start();
      setIsRecording(true);
    } else {
      alert("Speech recognition is not supported in this browser.");
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsRecording(false);
  };

  const generateVideo = () => {
    if (!inputText.trim()) return;
    setIsGenerating(true);
    // Simulate generation delay
    setTimeout(() => {
      // Split into words, filter out empty
      const words = inputText.trim().split(/\s+/).filter(Boolean);
      setSequence(words);
      setIsGenerating(false);
      setPlaybackProgress(0);
      setIsPlaying(true);
    }, 1500);
  };

  useEffect(() => {
    let playInterval: any;
    if (isPlaying && sequence.length > 0) {
      playInterval = setInterval(() => {
        setPlaybackProgress((prev) => {
          if (prev >= sequence.length - 1) {
            clearInterval(playInterval);
            setIsPlaying(false);
            return sequence.length;
          }
          return prev + 1;
        });
      }, 1000); // 1 second per word
    }
    
    return () => {
        if (playInterval) clearInterval(playInterval);
    };
  }, [isPlaying, sequence]);

  const activeWord = playbackProgress < sequence.length ? sequence[playbackProgress] : '';

  return (
    <div className="flex-1 flex flex-col bg-slate-50 relative overflow-hidden h-full">
      {!isEmbedded && (
        <header className="p-6 md:p-10 shrink-0 flex items-center justify-between z-10 relative bg-white border-b border-slate-200">
           <div className="flex items-center gap-4">
             <button 
              onClick={onMenuClick}
              className="lg:hidden p-2 text-slate-500 bg-white shadow-sm border border-slate-200 hover:bg-slate-50 rounded-lg active:scale-95"
            >
              <Menu className="w-6 h-6" />
            </button>
             <div>
               <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
                 Sign Video Studio 
                 <div className="px-2 py-1 bg-primary/10 text-primary rounded-md text-xs font-bold uppercase tracking-widest border border-primary/20">Beta</div>
               </h1>
               <p className="text-sm text-slate-500 font-medium mt-1">Generate AI Sign Language videos from speech or text input.</p>
             </div>
           </div>
        </header>
      )}
      
      <div className="flex-1 overflow-y-auto p-6 md:p-10 z-10 relative flex flex-col items-center">
         <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
            
            {/* Input Section */}
            <div className="flex flex-col gap-6 w-full h-full">
               <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex-1 flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                     <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                       <FileText className="w-5 h-5 text-primary" />
                       Script Input
                     </h2>
                  </div>
                  
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Type or dictate the script you want to convert to sign language video..."
                    className="flex-1 w-full p-4 bg-slate-50 border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 text-slate-700"
                  />
                  
                  <div className="mt-4 flex flex-col sm:flex-row gap-3">
                     {isRecording ? (
                        <button 
                          onClick={stopRecording}
                          className="flex items-center justify-center gap-2 px-6 py-3 bg-red-500 hover:bg-red-600 active:scale-95 transform transition-all text-white font-medium rounded-xl shadow-lg shadow-red-500/20"
                        >
                           <Square className="w-5 h-5 fill-current" />
                           Stop Recording
                        </button>
                     ) : (
                        <button 
                          onClick={startRecording}
                          className="flex items-center justify-center gap-2 px-6 py-3 bg-white border border-slate-200 hover:bg-slate-50 active:scale-95 transform transition-all text-slate-700 font-medium rounded-xl shadow-sm"
                        >
                           <Mic className="w-5 h-5 text-red-500" />
                           Record Speech
                        </button>
                     )}
                     
                     <button 
                       onClick={generateVideo}
                       disabled={!inputText.trim() || isGenerating}
                       className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-primary hover:bg-blue-700 disabled:opacity-50 disabled:active:scale-100 active:scale-95 transform transition-all text-white font-bold rounded-xl shadow-lg shadow-primary/20"
                     >
                        {isGenerating ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Video className="w-5 h-5" />}
                        {isGenerating ? 'Rendering Video...' : 'Generate Video'}
                     </button>
                  </div>
               </div>
            </div>
            
            {/* Output Section */}
            <div className="bg-slate-900 rounded-3xl shadow-2xl border border-slate-800 p-2 flex flex-col relative overflow-hidden h-[500px] lg:h-full min-h-[500px]">
               {/* Player Header */}
               <div className="absolute top-4 left-6 right-6 z-30 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                     <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                     <span className="text-xs font-black uppercase tracking-widest text-white/80 drop-shadow-md">LIVE PREVIEW</span>
                  </div>
                  <button className="text-white/50 hover:text-white transition-colors bg-black/40 p-2 rounded-lg backdrop-blur-md">
                    <Download className="w-5 h-5" />
                  </button>
               </div>
               
               {/* Video Area */}
               <div className="flex-1 relative flex items-center justify-center rounded-2xl overflow-hidden bg-slate-950">
                  {sequence.length === 0 ? (
                     <div className="text-center p-8 z-10 flex flex-col items-center">
                        <Video className="w-16 h-16 text-slate-700 mb-4" />
                        <p className="text-slate-400 font-medium max-w-[250px]">Enter your script and generate to see the AI sign language video.</p>
                     </div>
                  ) : (
                     <>
                        <motion.div 
                          className="w-full h-full relative z-10 flex flex-col items-center justify-end overflow-hidden"
                          animate={{ 
                             filter: isPlaying ? "contrast(1.05) saturate(1.15)" : "contrast(1) saturate(1)"
                          }}
                        >
                           <img 
                             src="https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80&w=600&h=800" 
                             alt="AI Avatar"
                             className="absolute inset-0 w-full h-full object-cover object-top opacity-30 brightness-50 mix-blend-luminosity"
                           />
                           
                           <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                             <motion.img 
                               drag
                               dragConstraints={{ left: -150, right: 150, top: -300, bottom: 100 }}
                               dragElastic={0.2}
                               src="https://img.icons8.com/fluency/144/hand.png"
                               animate={(isPlaying ? getHandPose(activeWord || '', 'left') : { x: 0, y: 100, rotate: -20, opacity: 0.3, scale: 0.8 }) as any}
                               className="absolute bottom-1/4 left-[15%] w-48 h-48 drop-shadow-[0_20px_20px_rgba(59,130,246,0.5)] pointer-events-auto cursor-grab active:cursor-grabbing"
                               style={{ transform: 'scaleX(-1)' }}
                             />
                             <motion.img 
                               drag
                               dragConstraints={{ left: -150, right: 150, top: -300, bottom: 100 }}
                               dragElastic={0.2}
                               src="https://img.icons8.com/fluency/144/hand.png"
                               animate={(isPlaying ? getHandPose(activeWord || '', 'right') : { x: 0, y: 100, rotate: 20, opacity: 0.3, scale: 0.8 }) as any}
                               className="absolute bottom-1/4 right-[15%] w-48 h-48 drop-shadow-[0_20px_20px_rgba(59,130,246,0.5)] pointer-events-auto cursor-grab active:cursor-grabbing"
                             />
                           </div>
                        </motion.div>
                        
                        {/* Subtitles Overlay */}
                        <div className="absolute bottom-20 left-0 right-0 text-center z-30 px-8">
                           <span className="inline-block px-4 py-2 bg-black/60 backdrop-blur-md rounded-xl text-2xl font-black text-white uppercase tracking-widest border border-white/10 shadow-xl">
                              {activeWord || "—"}
                           </span>
                        </div>
                     </>
                  )}
               </div>
               
               {/* Player Controls Timeline */}
               <div className="mt-2 p-4 bg-slate-900/50 rounded-xl relative z-30">
                  <div className="flex items-center gap-4">
                     <button 
                       onClick={() => {
                         if (sequence.length > 0) {
                            if (isPlaying) {
                              setIsPlaying(false);
                            } else {
                              if (playbackProgress >= sequence.length) setPlaybackProgress(0);
                              setIsPlaying(true);
                            }
                         }
                       }}
                       disabled={sequence.length === 0}
                       className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white hover:bg-blue-600 disabled:opacity-50 disabled:scale-100 active:scale-95 transition-all shadow-lg"
                     >
                        {isPlaying ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-5 h-5 ml-1 fill-current" />}
                     </button>
                     
                     <div className="flex-1 h-3 bg-slate-800 rounded-full overflow-hidden relative border border-slate-700/50 cursor-pointer">
                        <motion.div 
                          className="absolute top-0 bottom-0 left-0 bg-primary"
                          initial={{ width: 0 }}
                          animate={{ width: sequence.length > 0 ? `${(playbackProgress / Math.max(1, sequence.length)) * 100}%` : '0%' }}
                          transition={{ duration: 0.2 }}
                        />
                     </div>
                     <div className="text-xs font-mono text-slate-400 font-medium w-12 text-right">
                       00:{(playbackProgress < 10 ? '0' : '') + playbackProgress}
                     </div>
                  </div>
               </div>
            </div>
            
         </div>
      </div>
    </div>
  );
}
