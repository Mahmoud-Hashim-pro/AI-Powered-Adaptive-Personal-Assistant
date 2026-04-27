import React from 'react';
import { UserProfile, AccessibilityMode, Message } from '../types';
import { Settings, Eye, Accessibility, Menu, Sparkles, User, Ear, Mic, Brain, ArrowLeft, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import SignVideoStudio from './SignVideoStudio';
import ChatInterface from './ChatInterface';

interface DisabilityModeViewProps {
  profile: UserProfile;
  onMenuClick: () => void;
  onNavigate?: (view: 'chat' | 'hub' | 'logic' | 'profile' | 'settings' | 'video' | 'disability') => void;
  onQuestionEvaluated?: (score: number, lastMessageSnippet?: string) => void;
  syncMessages?: (updatedHistory: Message[]) => void;
  externalMessage?: string;
  onStreamingUpdate?: (text: string) => void;
}

export default function DisabilityModeView({ 
  profile, 
  onMenuClick, 
  onNavigate,
  onQuestionEvaluated,
  syncMessages,
  externalMessage,
  onStreamingUpdate 
}: DisabilityModeViewProps) {
  const [activeTab, setActiveTab] = React.useState<'chat' | 'settings' | 'video'>('chat');

  const updateAccessibilityMode = async (mode: AccessibilityMode) => {
    if (!profile.uid) return;
    const path = `users/${profile.uid}`;
    try {
      await setDoc(doc(db, path), { accessibilityMode: mode }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const getModeIcon = (mode: AccessibilityMode) => {
    switch (mode) {
      case 'None': return <User className="w-5 h-5" />;
      case 'Speech': return <Mic className="w-5 h-5" />;
      case 'Visual': return <Eye className="w-5 h-5" />;
      case 'Vocal-Deaf': return <Ear className="w-5 h-5" />;
      case 'Sign-Only': return <Accessibility className="w-5 h-5" />;
      default: return <Settings className="w-5 h-5" />;
    }
  };

  const getModeDescription = (mode: AccessibilityMode) => {
    switch (mode) {
      case 'None': return 'Standard cognitive interface without accessibility overlays.';
      case 'Speech': return 'Activates voice transcription, synthetic speech synthesis, and text-to-speech feedback.';
      case 'Visual': return 'Enables vision analysis, high contrast, text zooming, and spatial layout modifications.';
      case 'Vocal-Deaf': return 'Enables sign language avatar alongside speech recognition for users who are deaf but can speak.';
      case 'Sign-Only': return 'Full sign language interface powered by the avatar and vision-based gesture recognition.';
      default: return '';
    }
  };

  return (
    <div className="flex-1 flex flex-col h-screen bg-slate-50 overflow-hidden relative">
      <header className="p-6 md:px-10 md:py-8 shrink-0 flex items-center justify-between border-b border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => onNavigate ? onNavigate('chat') : onMenuClick()}
            className="p-2 text-slate-500 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg active:scale-95 transition-all flex items-center gap-2"
          >
            <ArrowLeft className="w-5 h-5" /> 
            <span className="hidden sm:inline text-xs font-semibold uppercase tracking-widest text-slate-600">Return</span>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
              <Accessibility className="w-6 h-6 text-primary" /> Disability Mode
            </h1>
            <p className="text-sm text-slate-500 mt-1">Empowering all neuro-diverse and differently-abled individuals.</p>
          </div>
        </div>

        <div className="flex items-center bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('chat')}
            className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'chat' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            AI Assistant
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'settings' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Preferences
          </button>
          <button
            onClick={() => setActiveTab('video')}
            className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'video' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Sign Studio
          </button>
        </div>
      </header>
      
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <AnimatePresence mode="wait">
          {activeTab === 'chat' ? (
            <motion.div
              key="chat"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="w-full h-full flex flex-col p-4 md:p-6 lg:p-10 pb-0"
            >
              <div className="flex-1 bg-white rounded-t-3xl shadow-sm border border-slate-200 overflow-hidden relative flex flex-col">
                <ChatInterface 
                  profile={profile} 
                  onQuestionEvaluated={onQuestionEvaluated || (() => {})} 
                  syncMessages={syncMessages || (() => {})} 
                  onMenuClick={onMenuClick} 
                  externalMessage={externalMessage}
                  onStreamingUpdate={onStreamingUpdate}
                  isEmbedded={true}
                />
              </div>
            </motion.div>
          ) : activeTab === 'settings' ? (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="w-full h-full overflow-y-auto custom-scrollbar p-6 md:p-10"
            >
              <div className="max-w-4xl mx-auto space-y-10 pb-20">
              <div className="bg-white p-8 md:p-10 rounded-2xl shadow-sm border border-slate-200">
                <div className="mb-8">
                  <h2 className="text-xl font-semibold text-slate-900 tracking-tight mb-1">Accessibility Profiles</h2>
                  <p className="text-sm text-slate-500">Select an interaction mode. The interface will adapt dynamically to empower your workflow.</p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(['None', 'Speech', 'Visual', 'Vocal-Deaf', 'Sign-Only'] as AccessibilityMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => updateAccessibilityMode(mode)}
                      className={`text-left p-5 rounded-xl border transition-all relative ${
                        profile.accessibilityMode === mode 
                          ? 'border-primary bg-primary/5 shadow-sm' 
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start gap-4 relative z-10">
                        <div className={`mt-0.5 p-2 rounded-lg ${
                          profile.accessibilityMode === mode 
                            ? 'bg-primary text-white' 
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                          {getModeIcon(mode)}
                        </div>
                        <div>
                          <h3 className={`text-sm font-semibold mb-1 ${
                            profile.accessibilityMode === mode ? 'text-primary' : 'text-slate-900'
                          }`}>
                            {mode === 'None' ? 'Standard Protocol' : mode}
                          </h3>
                          <p className="text-xs text-slate-500 leading-relaxed font-medium">
                            {getModeDescription(mode)}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900 p-8 rounded-2xl text-white shadow-md relative overflow-hidden flex flex-col md:flex-row items-center gap-6 border border-slate-800">
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 blur-3xl rounded-full pointer-events-none" />
                
                <div className="p-4 bg-white/5 rounded-2xl backdrop-blur-sm shrink-0">
                  <Brain className="w-8 h-8 text-primary" />
                </div>
                
                <div className="flex-1 relative z-10">
                  <h3 className="text-base font-semibold tracking-wide mb-1.5 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400" /> Active Profile Context
                  </h3>
                  <p className="text-slate-400 font-medium text-sm leading-relaxed max-w-2xl">
                    By enabling an accessibility profile, the engine modifies its context generation. 
                    Visual mode prioritizes layout structuring and large font metadata. Deaf modes enable real-time 
                    gesture interpolation via our virtual signing avatar. Speech mode invokes zero-latency TTS responses.
                  </p>
                </div>
              </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="video"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="w-full h-full pb-32 md:pb-0"
            >
              <SignVideoStudio profile={profile} onMenuClick={onMenuClick} isEmbedded={true} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
