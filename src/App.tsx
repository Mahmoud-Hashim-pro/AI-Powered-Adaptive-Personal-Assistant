/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import ChatInterface from "./components/ChatInterface";
import RightPanel from "./components/RightPanel";
import Onboarding from "./components/Onboarding";
import IntelligenceHub from "./components/IntelligenceHub";
import ProfilePage from "./components/ProfilePage";
import LogicSandbox from "./components/LogicSandbox";
import SignVideoStudio from "./components/SignVideoStudio";
import Login from "./components/Login";
import AccessibilityOverlay from "./components/AccessibilityOverlay";
import LiveCaptions from "./components/LiveCaptions";
import DisabilityModeView from "./components/DisabilityModeView";
import ErrorBoundary from "./components/ErrorBoundary";
import { motion, AnimatePresence } from "motion/react";
import { Message, UserProfile } from "./types";
import { auth, db, handleFirestoreError, OperationType } from "./lib/firebase";
import { useAuthState } from "react-firebase-hooks/auth";
import { doc, setDoc, onSnapshot, getDocFromServer } from "firebase/firestore";
import { Loader2, Settings, Layers, Menu, Moon, Sun } from "lucide-react";

export default function App() {
  const [user, loading, authError] = useAuthState(auth);
  
  const [currentView, setCurrentView] = useState<'chat' | 'hub' | 'profile' | 'settings' | 'logic' | 'video' | 'disability'>(() => {
    const hash = window.location.hash.replace('#', '');
    return ['chat', 'hub', 'logic', 'profile', 'settings', 'video', 'disability'].includes(hash) ? hash as any : 'chat';
  });
  
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [externalMessage, setExternalMessage] = useState("");
  const [currentAIResponse, setCurrentAIResponse] = useState("");
  const [isSTTActive, setIsSTTActive] = useState(false);
  const [isLiveCaptionsOpen, setIsLiveCaptionsOpen] = useState(false);

  // Theme management: Default to system, but respect manual override if present
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Sync theme with machine/system changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    // Function to apply theme based on system or manual selection
    const applyTheme = (e?: MediaQueryListEvent | MediaQueryList) => {
      const saved = localStorage.getItem('theme');
      // If user has a manual preference, prioritize it
      if (saved) {
        const shouldBeDark = saved === 'dark';
        setIsDarkMode(shouldBeDark);
        if (shouldBeDark) document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');
        return;
      }

      // Otherwise follow the system
      const systemIsDark = e ? (e as MediaQueryList).matches : mediaQuery.matches;
      setIsDarkMode(systemIsDark);
      if (systemIsDark) document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
    };

    // Initial check
    applyTheme(mediaQuery);

    // Listen for system preference changes
    const handler = (e: MediaQueryListEvent) => applyTheme(e);
    mediaQuery.addEventListener('change', handler);

    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Sync manual state change (when user clicks toggle)
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Handle manual theme toggle
  const toggleTheme = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    localStorage.setItem('theme', newMode ? 'dark' : 'light');
  };

  // Sync navigation with browser history
  useEffect(() => {
    // If there's no hash on load, set it to the default #chat explicitly without a reload
    if (!window.location.hash) {
      window.history.replaceState(null, '', '#chat');
    }

    const handlePopState = () => {
      const hash = window.location.hash.replace('#', '');
      if (['chat', 'hub', 'logic', 'profile', 'settings', 'video', 'disability'].includes(hash)) {
        setCurrentView(hash as any);
      } else {
        setCurrentView('chat');
        window.history.replaceState(null, '', '#chat');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Custom navigation function that updates URL and state
  const navigateTo = (view: 'chat' | 'hub' | 'logic' | 'profile' | 'settings' | 'video' | 'disability') => {
    if (view !== currentView) {
      window.history.pushState(null, '', `#${view}`);
      setCurrentView(view);
    }
    setIsMobileMenuOpen(false);
  };

  // Firestore Connection Test with Retries
  useEffect(() => {
    let retries = 0;
    const maxRetries = 3;

    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'system', 'connection_test'));
        setConnectionError(false);
      } catch (error) {
        if (retries < maxRetries) {
          retries++;
          console.warn(`Connection attempt ${retries} failed. Retrying...`);
          setTimeout(testConnection, 2000);
        } else {
          console.error("Firebase connection is offline or misconfigured after retries.");
          setConnectionError(true);
        }
      }
    }
    testConnection();
  }, []);

  // Sync profile from Firestore
  useEffect(() => {
    if (!user) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    const path = `users/${user.uid}`;
    const unsubscribe = onSnapshot(doc(db, path), (snapshot) => {
      if (snapshot.exists()) {
        setProfile(snapshot.data() as UserProfile);
      } else {
        setProfile(null);
      }
      setProfileLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
      setProfileLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const handleOnboardingComplete = async (data: Partial<UserProfile>) => {
    if (!user) return;
    const path = `users/${user.uid}`;
    
    const newProfile: UserProfile = {
      uid: user.uid,
      email: user.email || "",
      name: user.displayName || user.email?.split('@')[0] || "User",
      points: 100,
      questionHistory: [],
      chatHistory: [],
      level: 'Intermediate',
      role: 'Student',
      field: 'General',
      accessibilityMode: 'None',
      questionScore: 0,
      onboardingComplete: true,
      ...data,
    };

    try {
      await setDoc(doc(db, path), newProfile, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  };

  const updateQuestionHistory = async (score: number, updatedHistory?: Message[]) => {
    if (!user || !profile) return;
    const path = `users/${user.uid}`;
    
    // If we have an active thread, update it specifically
    let updatedThreads = profile.chatThreads || [];
    if (profile.activeThreadId && updatedHistory) {
      updatedThreads = updatedThreads.map(t => 
        t.id === profile.activeThreadId 
          ? { ...t, messages: updatedHistory, updatedAt: new Date().toISOString() } 
          : t
      );
    }

    const updatedProfile: UserProfile = {
      ...profile,
      points: profile.points + (score * 5),
      questionHistory: [...(profile.questionHistory || []), { score, date: new Date().toISOString() }],
      chatHistory: updatedHistory || profile.chatHistory || [], // Support legacy global sync
      chatThreads: updatedThreads
    };

    try {
      const cleanProfile = JSON.parse(JSON.stringify(updatedProfile));
      await setDoc(doc(db, path), cleanProfile);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const syncActiveThread = async (updatedHistory: Message[]) => {
    if (!user || !profile) return;
    const path = `users/${user.uid}`;
    
    // Strip large attachments from history before saving to DB
    const historyForDb = updatedHistory.map(m => ({
      ...m,
      attachments: m.attachments?.map(a => ({
        ...a,
        // If data is very large (e.g. video or huge image), omit it so Firestore doesn't crash
        data: a.data && a.data.length > 50000 ? "" : a.data 
      }))
    }));

    let updatedThreads = profile.chatThreads || [];
    // Only update if the thread still exists in the local state (hasn't been cleared)
    if (profile.activeThreadId && updatedThreads.some(t => t.id === profile.activeThreadId)) {
      updatedThreads = updatedThreads.map(t => 
        t.id === profile.activeThreadId 
          ? { ...t, messages: historyForDb, updatedAt: new Date().toISOString() } 
          : t
      );
    }

    const updatedProfile: UserProfile = {
      ...profile,
      chatHistory: historyForDb || profile.chatHistory || [],
      chatThreads: updatedThreads
    };

    try {
      const cleanProfile = JSON.parse(JSON.stringify(updatedProfile));
      await setDoc(doc(db, path), cleanProfile);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const updateLanguage = async (language: UserProfile['language']) => {
    if (!user || !profile) return;
    const path = `users/${user.uid}`;
    try {
      await setDoc(doc(db, path), { language }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
          <p className="text-slate-400 font-mono text-xs uppercase tracking-[0.3em] animate-pulse">Syncing Profile...</p>
        </div>
      </div>
    );
  }

  if (connectionError || authError) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 bg-technical">
        <div className="max-w-md text-center space-y-6 bg-slate-900 p-10 rounded-[2rem] border border-red-500/20 shadow-2xl">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Loader2 className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Connection Failed</h2>
          <p className="text-slate-400 text-sm leading-relaxed">Could not reach server. Authentication or database sync failed.</p>
          <button 
            onClick={() => window.location.reload()} 
            className="w-full py-4 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold transition-all"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  // If user exists but no profile, show Onboarding
  if (!profile || !profile.onboardingComplete) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  const renderView = () => {
    if (!profile) return null;
    switch (currentView) {
      case 'chat':
        return (
          <>
            <ChatInterface 
              profile={profile} 
              onQuestionEvaluated={updateQuestionHistory} 
              syncMessages={syncActiveThread} 
              onMenuClick={() => setIsMobileMenuOpen(true)} 
              externalMessage={externalMessage}
              onStreamingUpdate={(text) => setCurrentAIResponse(text)}
              onSTTStateChange={setIsSTTActive}
            />
            <div className="hidden xl:block">
              <RightPanel profile={profile} />
            </div>
          </>
        );
      case 'hub':
        return <IntelligenceHub profile={profile} onMenuClick={() => setIsMobileMenuOpen(true)} />;
      case 'video':
        return <SignVideoStudio profile={profile} onMenuClick={() => setIsMobileMenuOpen(true)} />;
      case 'disability':
        return <DisabilityModeView 
          profile={profile} 
          onMenuClick={() => setIsMobileMenuOpen(true)} 
          onNavigate={navigateTo} 
          onQuestionEvaluated={updateQuestionHistory} 
          syncMessages={syncActiveThread}
          externalMessage={externalMessage}
          onStreamingUpdate={(text) => setCurrentAIResponse(text)}
        />;
      case 'profile':
        return <ProfilePage profile={profile} onMenuClick={() => setIsMobileMenuOpen(true)} />;
      case 'logic':
        return <LogicSandbox profile={profile} onMenuClick={() => setIsMobileMenuOpen(true)} />;
      case 'settings':
        return (
          <div className="flex-1 flex flex-col bg-slate-50 relative overflow-hidden">
            <header className="p-6 md:p-10 shrink-0">
               <button 
                onClick={() => setIsMobileMenuOpen(true)}
                className="lg:hidden p-2 text-slate-500 bg-white shadow-sm border border-slate-200 hover:bg-slate-50 rounded-lg active:scale-95"
              >
                <Menu className="w-6 h-6" />
              </button>
            </header>
            <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
              <div className="bg-white rounded-[40px] border border-slate-100 shadow-2xl max-w-2xl w-full p-8 md:p-12 space-y-10">
                <div className="text-center space-y-2">
                  <h2 className="text-2xl md:text-3xl font-black text-slate-900 uppercase tracking-tighter">System Settings</h2>
                  <div className="h-1.5 w-20 bg-primary mx-auto rounded-full" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                   <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 space-y-3">
                     <div className="flex items-center gap-2 text-primary">
                       <Settings className="w-5 h-5" />
                       <h3 className="text-sm font-black uppercase tracking-widest">Core Parameters</h3>
                     </div>
                     <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                       Fundamental configuration (IQ, Level, Role). These are recalibrated automatically based on your performance and institutional metadata.
                     </p>
                   </div>

                   <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 space-y-4">
                     <div className="flex items-center gap-2 text-indigo-600">
                       {isDarkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                       <h3 className="text-sm font-black uppercase tracking-widest">Interface Theme</h3>
                     </div>
                     <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                       Switch between light and dark visual themes to reduce eye strain in low-light environments.
                     </p>
                     <button
                       onClick={toggleTheme}
                       className={`w-full py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
                         isDarkMode 
                           ? 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30' 
                           : 'bg-slate-900 text-white hover:bg-slate-800'
                       }`}
                     >
                       {isDarkMode ? 'Enable Light Mode' : 'Enable Dark Mode'}
                     </button>
                   </div>
                </div>

                 <div className="p-8 bg-slate-900 rounded-[32px] text-white shadow-2xl space-y-4">
                   <div className="flex items-center gap-3">
                     <div className="p-2 bg-white/10 rounded-xl">
                       <Loader2 className="w-4 h-4 animate-spin text-primary" />
                     </div>
                     <h3 className="text-xs font-black uppercase tracking-[0.2em]">Maintenance Active</h3>
                   </div>
                   <p className="text-xs text-slate-400 font-medium leading-relaxed">
                     Live adjustment of settings is locked during the initial phase. Full manual bypass controls will be available in the next version.
                   </p>
                </div>

                <button 
                  onClick={() => navigateTo('chat')}
                  className="w-full py-5 bg-slate-100 text-slate-900 rounded-3xl text-xs font-black uppercase tracking-widest hover:bg-slate-200 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  Return to Chat
                </button>
              </div>
            </div>
          </div>
        );
      default:
        return (
          <>
            <ChatInterface profile={profile} onQuestionEvaluated={updateQuestionHistory} syncMessages={syncActiveThread} onMenuClick={() => setIsMobileMenuOpen(true)} />
            <div className="hidden xl:block">
              <RightPanel profile={profile} />
            </div>
          </>
        );
    }
  };

  return (
    <ErrorBoundary>
      <div className="flex w-full h-[100dvh] bg-slate-950 font-sans overflow-hidden selection:bg-blue-500/30">
        
        {/* Mobile menu backdrop */}
        {isMobileMenuOpen && (
          <div 
            className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar Wrapper */}
        {currentView !== 'disability' && (
          <div className={`fixed inset-y-0 left-0 z-50 transform ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:translate-x-0 transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] shadow-2xl lg:shadow-none`}>
            <Sidebar 
              profile={profile} 
              setProfile={async (p) => {
                if (!user) return;
                const path = `users/${user.uid}`;
                try {
                  const cleanProfile = JSON.parse(JSON.stringify(p));
                  await setDoc(doc(db, path), cleanProfile);
                } catch (err) {
                  handleFirestoreError(err, OperationType.UPDATE, path);
                }
              }} 
              currentView={currentView}
              setCurrentView={navigateTo}
              isDarkMode={isDarkMode}
              toggleTheme={toggleTheme}
              openLiveCaptions={() => setIsLiveCaptionsOpen(true)}
            />
          </div>
        )}

        <main className="flex-1 relative overflow-hidden flex flex-col md:flex-row">
          {renderView()}
        </main>

        {profile && (
          <AccessibilityOverlay 
            mode={profile.accessibilityMode === 'None' ? 'Vocal-Deaf' : profile.accessibilityMode} 
            profile={profile}
            aiResponse={currentAIResponse}
            isListening={isSTTActive}
            onTranscription={(text) => {
              setExternalMessage(text);
              // Reset so it doesn't keep triggering if ChatInterface clears it
              setTimeout(() => setExternalMessage(""), 500);
            }} 
            onToggleListening={() => {
              // We need a way to trigger ChatInterface's toggle
              // I'll add a global event or common state
              const btn = document.querySelector('button[title*="Speak"]') as HTMLButtonElement;
              if (btn) btn.click();
            }}
          />
        )}

        <AnimatePresence>
          {isLiveCaptionsOpen && (
            <LiveCaptions 
              language={profile?.language === 'Arabic' ? 'ar-SA' : 'en-US'}
              onClose={() => setIsLiveCaptionsOpen(false)} 
            />
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}
