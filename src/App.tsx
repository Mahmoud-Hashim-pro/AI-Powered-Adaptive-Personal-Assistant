/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, lazy, Suspense } from "react";
import Sidebar from "./components/Sidebar";
import ChatInterface from "./components/ChatInterface";
import Onboarding from "./components/Onboarding";
import Login from "./components/Login";
import ErrorBoundary from "./components/ErrorBoundary";
import AccessibilityOverlay from "./components/AccessibilityOverlay";
import LiveCaptions from "./components/LiveCaptions";
import ReadAloudSelection from "./components/ReadAloudSelection";
import { motion, AnimatePresence } from "motion/react";
import { Message, UserProfile, AccessibilityMode, CognitiveLevel } from "./types";
import { auth, db, handleFirestoreError, OperationType, cleanDataForFirestore, clearPreLoginState, logout } from "./lib/firebase";
import { useAuthState } from "react-firebase-hooks/auth";
import { doc, setDoc, onSnapshot, getDocFromServer } from "firebase/firestore";
import { Loader2, Settings, Layers, Menu, Moon, Sun, AlertCircle, RefreshCw, Mail, ArrowLeft } from "lucide-react";
import { ToastContainer } from "./components/Toast";
import PwaInstallPrompt from "./components/PwaInstallPrompt";

import { isRTL, getTranslation, localize } from "./lib/translations";
import { canAccessSection } from "./lib/academics";
import { canAccessView, homeViewFor, isAccessibilityUser, AppView } from "./lib/access";
import { isAdminUser } from "./lib/roles";
import { subscribeToStudentMemory } from "./lib/memory";
import { StudentMemory } from "./types";

// Heavy, route-specific views are code-split so they don't bloat the initial
// bundle. They load on demand the first time a user opens that screen, which
// keeps the app fast to start (important on mobile / slow connections).
const ProfilePage = lazy(() => import("./components/ProfilePage"));
const SignVideoStudio = lazy(() => import("./components/SignVideoStudio"));
const AdminDashboard = lazy(() => import("./components/AdminDashboard"));
const SupportCenter = lazy(() => import("./components/SupportCenter"));
const DisabilityModeView = lazy(() => import("./components/DisabilityModeView"));
const GoalTracker = lazy(() => import("./components/Goaltracker"));
const GpaCalculator = lazy(() => import("./components/GpaCalculator"));
const StudentAnalytics = lazy(() => import("./components/StudentAnalytics"));
const AcademicPlanner = lazy(() => import("./components/AcademicPlanner"));
const LearningHub = lazy(() => import("./components/learning/LearningHub"));
const StudentMemoryPage = lazy(() => import("./components/StudentMemoryPage"));
const InstitutionCohortHub = lazy(() => import("./components/InstitutionCohortHub"));
const CognitiveGym = lazy(() => import("./components/CognitiveGym"));
const IqAssessmentModal = lazy(() => import("./components/IqAssessmentModal"));
const FrenchTravelVoiceAssistant = lazy(() => import("./components/FrenchTravelVoiceAssistant"));

/** Every hash route the app answers to — the single source of truth for both the
 *  initial read on mount and the popstate handler, so they can't drift apart. */
const VALID_VIEWS = [
  'chat', 'learning', 'profile', 'settings', 'video', 'disability',
  'admin', 'goals', 'gpa', 'analytics', 'planner', 'support', 'memory',
  'institution', 'gym', 'iq', 'france',
] as const;

export default function App() {
  const [user, loading, authError] = useAuthState(auth);
  const chatRef = useRef<any>(null);
  
  // Seed from the URL hash so deep links and F5 land on the right screen.
  const [currentView, setCurrentView] = useState<AppView>(() => {
    const h = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
    return (VALID_VIEWS as readonly string[]).includes(h) ? (h as any) : 'chat';
  });
  
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  // True once a profile snapshot has actually been applied for the current user.
  // Guards the "ignore our own pending writes" rule so it can only skip AFTER we
  // have real data — otherwise the very first snapshot can be skipped and the
  // loading gate never releases ("SYNCING PROFILE…" forever).
  const profileAppliedRef = useRef(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  // True when the profile sync failed or timed out (as opposed to "this user
  // genuinely has no profile yet"). Without this the app can't tell the two
  // apart and falls through to Onboarding — which auto-submits for Special
  // Needs and would overwrite a real profile. See the render guard below.
  const [profileSyncFailed, setProfileSyncFailed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [externalMessage, setExternalMessage] = useState("");
  const [currentAIResponse, setCurrentAIResponse] = useState("");
  const [isSTTActive, setIsSTTActive] = useState(false);
  const [disabilityTab, setDisabilityTab] = useState<'chat' | 'settings' | 'video' | 'bridge' | 'org' | 'motor' | 'vision'>('video');
  const [isLiveCaptionsOpen, setIsLiveCaptionsOpen] = useState(false);
  const [isIqModalOpen, setIsIqModalOpen] = useState(false);

  // Cognify Memory (Phase 2) state
  const [memoryState, setMemoryState] = useState<StudentMemory | null>(null);
  const [memoryLoading, setMemoryLoading] = useState<boolean>(true);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryRetryCount, setMemoryRetryCount] = useState<number>(0);

  // Subscribe to Cognify Memory snapshot from Firestore (Single Source of Truth)
  useEffect(() => {
    if (!user?.uid) {
      setMemoryState(null);
      setMemoryLoading(false);
      setMemoryError(null);
      return;
    }

    setMemoryLoading(true);
    setMemoryError(null);

    const unsubscribe = subscribeToStudentMemory(
      user.uid,
      (mem) => {
        setMemoryState(mem);
        setMemoryLoading(false);
        setMemoryError(null);
      },
      (err) => {
        console.error('Firestore memory subscription error:', err);
        setMemoryError('Failed to load Cognify Memory from Firestore.');
        setMemoryLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid, memoryRetryCount]);

  // Merge memory snapshot with user profile
  const fullProfile: UserProfile | null = profile
    ? { ...profile, memory: memoryState || undefined }
    : null;

  const direction = isRTL(profile?.language) ? 'rtl' : 'ltr';

  // Keep the document root's dir/lang in sync so screen readers pronounce Arabic
  // with the right rules and portalled/native UI (dialogs, popovers) inherits RTL.
  useEffect(() => {
    document.documentElement.dir = direction;
    document.documentElement.lang = direction === 'rtl' ? 'ar' : 'en';
  }, [direction]);

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
      if ((VALID_VIEWS as readonly string[]).includes(hash)) {
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
 const navigateTo = (
  view: AppView
) => {
  window.history.pushState(null, '', `#${view}`);
  setCurrentView(view);
  setIsMobileMenuOpen(false);
};

  // Section access guard: nobody can open a section outside their enrolled path
  // (e.g. a Normal user opening #disability, or a Special-Needs user wandering
  // into the full academic experience). Admins bypass. Redirect + notify.
  useEffect(() => {
    if (!profile) return;
    if (!canAccessView(profile, currentView as any, isAdminUser(profile))) {
      // Redirect SILENTLY to the user's home section. No scary red toast — this
      // also fires on deep-links and on the user's own mode change, where an
      // error would be alarming and confusing. The redirect itself is feedback.
      const home = homeViewFor(profile);
      window.history.replaceState(null, '', `#${home}`);
      setCurrentView(home);
    }
  }, [profile, currentView]);

  // When the off-canvas menu opens, move focus into it and allow Escape to close.
  // Without this a keyboard/screen-reader user gets no signal that it opened and
  // has no way to dismiss it (the backdrop is a non-focusable div).
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    sidebarRef.current?.querySelector<HTMLElement>('button, a, [tabindex]:not([tabindex="-1"])')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsMobileMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobileMenuOpen]);

  // Sync profile from Firestore
  useEffect(() => {
    if (!user) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    // Re-show the loading gate on every logged-out -> authenticated transition.
    // Without this, a returning user briefly renders with profile=null and
    // profileLoading=false, flashing <Onboarding/> — which for a Special-Needs
    // account fires its onComplete and overwrites the existing profile (points/level).
    setProfileLoading(true);
    profileAppliedRef.current = false;
    setProfileSyncFailed(false);
    let cancelled = false; // set on cleanup; guards the async auto-create continuation

    // Watchdog: never let the app hang on "SYNCING PROFILE…". If Firestore is
    // unreachable (captive-portal / conference Wi-Fi / offline) onSnapshot can
    // fire NEITHER the success nor the error callback, leaving the gate stuck
    // forever. Release it after 10s so the user reaches a usable screen.
    const watchdog = setTimeout(() => {
      console.warn('[Cognify] Profile sync timed out — releasing the loading gate.');
      // Mark it as a FAILURE, not "no profile". Releasing the gate with
      // profile===null would otherwise render Onboarding, whose Special-Needs
      // branch auto-submits and would overwrite the real profile (points/level/
      // history) — the exact hazard on the flaky networks this watchdog exists for.
      setProfileSyncFailed(true);
      setProfileLoading(false);
    }, 10000);

    const path = `users/${user.uid}`;
    const unsubscribe = onSnapshot(doc(db, path), async (snapshot) => {
      // Ignore our own un-acknowledged local writes — applying them would replace
      // the whole profile mid-action and reset activeThreadId (the "new chat
      // refreshes / doesn't save" bug). The server-confirmed snapshot still applies.
      // BUT only skip once we already hold real data: skipping the FIRST snapshot
      // would return before setProfileLoading(false) below and hang the app on
      // "SYNCING PROFILE…" (reported in the field, "fixed" by localStorage.clear()
      // only because that wipes the auth session and forces a fresh login).
      if (snapshot.metadata.hasPendingWrites && profileAppliedRef.current) return;
      if (snapshot.exists()) {
        const data = snapshot.data() as UserProfile;
        setProfile(data);
        // The profile is established, so the login-screen hints have served their
        // purpose. Drop them now so they can never be re-applied to a different
        // account later on this device. (Not cleared in the no-profile branch
        // below — Onboarding still reads them to pre-fill the user's choices.)
        clearPreLoginState();

        // Redirect special needs users to the disability view by default
        const hash = window.location.hash.replace('#', '');
        if (data.accountPath === 'Special Needs' && (!hash || hash === 'chat' || hash === '')) {
          setCurrentView('disability');
          window.history.replaceState(null, '', '#disability');
        }
        
        // Update lastActiveDate if it's more than an hour old or missing
        const now = new Date().toISOString();
        if (!data.lastActiveDate || (new Date(now).getTime() - new Date(data.lastActiveDate).getTime() > 3600000)) {
           // We are doing a setDoc merge so we don't trigger an infinite loop locally.
           // However, since we update the doc, onSnapshot will fire again.
           // Setting the condition (e.g. 1 hr) prevents infinite loop.
           setDoc(doc(db, path), { lastActiveDate: now }, { merge: true }).catch(err => {
             console.error("Failed to update last active date:", err);
           });
        }
      } else {
        // If the user selected 'Special Needs' at login but has no profile, auto-create it immediately to bypass onboarding!
        const preLoginPath = localStorage.getItem('preLoginAccountPath');
        if (preLoginPath === 'Special Needs') {
          const disabilityType = localStorage.getItem('preLoginDisability') || 'Other';
          
          let accessibilityMode: AccessibilityMode = 'None';
          if (disabilityType === 'Visual Impairment') {
            accessibilityMode = 'Visual';
          } else if (disabilityType === 'Hearing Impairment') {
            accessibilityMode = 'Vocal-Deaf';
          } else if (disabilityType === 'Speech Impairment') {
            accessibilityMode = 'Speech';
          } else if (disabilityType === 'Motor Impairment') {
            accessibilityMode = 'Motor-Euphonia';
          }

          const defaultProfile: UserProfile = {
            uid: user.uid,
            email: user.email || "",
            name: user.displayName || user.email?.split('@')[0] || "User",
            points: 100,
            questionHistory: [],
            chatHistory: [],
            level: 'Basic',
            role: 'Student',
            educationLevel: 'University',
            field: 'General',
            accountPath: 'Special Needs',
            disabilityType: disabilityType,
            accessibilityMode: accessibilityMode,
            // Organization is no longer collected at sign-up (nobody should be
            // able to self-claim a charity's roster), so this resolves to '' —
            // an admin assigns it instead. The read is kept so re-introducing a
            // sign-up field would work without touching this again.
            organization: localStorage.getItem('preLoginOrgCode') || '',
            questionScore: 0,
            onboardingComplete: true,
          };

          try {
            await setDoc(doc(db, path), defaultProfile);
            // The awaited write can settle long after this subscription was torn
            // down (it never resolves while offline). Without this guard the
            // continuation would apply THIS user's profile into whatever session
            // is current now — e.g. after a sign-out and sign-in as someone else.
            if (cancelled) return;
            setProfile(defaultProfile);
            clearPreLoginState(); // consumed — must not apply to a future account
            setCurrentView('disability');
            window.history.replaceState(null, '', '#disability');
          } catch (err) {
            console.error("Failed to auto-create special needs profile:", err);
            setProfile(null);
          }
        } else {
          setProfile(null);
        }
      }
      // Reached on EVERY delivered snapshot (existing profile, auto-created
      // Special-Needs profile, or no-profile-yet) — so the gate always releases.
      if (cancelled) return;
      profileAppliedRef.current = true;
      clearTimeout(watchdog);
      setProfileLoading(false);
    }, (err) => {
      // Release the gate FIRST: handleFirestoreError throws by design, which
      // would otherwise skip these lines and strand the user on the spinner
      // (e.g. a permission-denied on a stale/mismatched session).
      clearTimeout(watchdog);
      setProfileSyncFailed(true); // sync FAILED — don't fall through to Onboarding
      setProfileLoading(false);
      handleFirestoreError(err, OperationType.LIST, path);
    });

    return () => {
      cancelled = true;
      clearTimeout(watchdog);
      unsubscribe();
    };
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
      educationLevel: 'University',
      field: 'General',
      accessibilityMode: 'None',
      questionScore: 0,
      onboardingComplete: true,
      ...data,
    };

    try {
      const cleanedProfile = cleanDataForFirestore(newProfile);
      await setDoc(doc(db, path), cleanedProfile, { merge: true });
      // Cleanly and immediately update local state to navigate the user away from Onboarding to the dashboard.
      setProfile(cleanedProfile);
      if (cleanedProfile.accountPath === 'Special Needs') {
        setCurrentView('disability');
        window.history.replaceState(null, '', '#disability');
      }
    } catch (err) {
      console.error("Failed to save onboarding profile:", err);
      // Fallback: update local profile so user is not stuck on onboarding screen
      setProfile(newProfile);
      if (newProfile.accountPath === 'Special Needs') {
        setCurrentView('disability');
        window.history.replaceState(null, '', '#disability');
      }
    }
  };

  const updateQuestionHistory = async (score: number, lastMessageSnippet?: string) => {
    if (!user || !profile) return;
    const path = `users/${user.uid}`;

    // Build from the LATEST profile state (functional update). Writing back the
    // whole (possibly stale) profile used to clobber `tasks` and thread titles
    // that other paths had just saved. We now persist ONLY the fields we change.
    setProfile((prev) => {
      if (!prev) return prev;
      let updatedThreads = prev.chatThreads || [];
      if (prev.activeThreadId && lastMessageSnippet) {
        updatedThreads = updatedThreads.map((t) =>
          t.id === prev.activeThreadId
            ? { ...t, lastMessageSnippet, updatedAt: new Date().toISOString() }
            : t,
        );
      }
      const nextPoints = prev.points + score * 5;
      // Cap history at 200 so the profile doc never grows unbounded (1 MiB cap).
      const nextHistory = [...(prev.questionHistory || []), { score, date: new Date().toISOString() }].slice(-200);
      const threadMeta = updatedThreads.map((t) => ({
        id: t.id, title: t.title, updatedAt: t.updatedAt, lastMessageSnippet: t.lastMessageSnippet,
      }));
      setDoc(
        doc(db, path),
        cleanDataForFirestore({ points: nextPoints, questionHistory: nextHistory, chatThreads: threadMeta }),
        { merge: true },
      ).catch((err) => handleFirestoreError(err, OperationType.UPDATE, path));
      return { ...prev, points: nextPoints, questionHistory: nextHistory, chatThreads: updatedThreads };
    });
  };

  const syncActiveThread = async (updatedHistory: Message[]) => {
    // This is now handled internally by ChatInterface for efficiency
    // But we keep the function signature for compatibility if needed elsewhere
    if (!user || !profile || !profile.activeThreadId) return;
    
    const threadPath = `users/${user.uid}/threads/${profile.activeThreadId}`;
    try {
      const cleanHistory = updatedHistory.map(m => {
        const item: any = {
          id: m.id,
          role: m.role,
          content: m.content || "",
          timestamp: m.timestamp
        };
        if (m.attachments !== undefined && m.attachments !== null) {
          item.attachments = m.attachments.map((a: any) => {
            const att: any = { name: a.name || "", type: a.type || "" };
            if (a.url) att.url = a.url;
            // Never persist large base64 — Firestore caps a doc at 1 MiB.
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
      await setDoc(doc(db, threadPath), { messages: cleanHistory }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, threadPath);
    }
  };

  const updateLanguage = async (language: UserProfile['language']) => {
    if (!user || !profile) return;
    const path = `users/${user.uid}`;
    try {
      await setDoc(doc(db, path), cleanDataForFirestore({ language }), { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <p className="text-slate-400 font-mono text-xs uppercase tracking-[0.3em] animate-pulse">
              {loading ? "Authenticating..." : "Syncing Profile..."}
            </p>
          </div>
        </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  // Sync failed/timed out (not "no profile yet"). NEVER fall through to
  // Onboarding here: its Special-Needs branch auto-submits on mount and would
  // overwrite a real profile's points/level/history with defaults. Offer a
  // retry (and a way out) instead — the data is safe on the server.
  if (profileSyncFailed && !profile) {
    // The profile never loaded, so we don't know the user's language — show both.
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <AlertCircle className="w-10 h-10 text-amber-400" />
          <p className="text-slate-300 text-sm leading-relaxed">
            Couldn't reach your profile. Check your connection and try again — your data is safe.
            <span className="block mt-2 text-slate-500" dir="rtl">تعذّر الوصول لملفك. راجع الاتصال وحاول تاني — بياناتك في أمان.</span>
          </p>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 px-5 py-3 bg-white text-slate-900 rounded-2xl text-xs font-black uppercase tracking-widest active:scale-95"
          >
            <RefreshCw className="w-4 h-4" /> Retry · إعادة المحاولة
          </button>
          <button onClick={() => logout()} className="text-[11px] text-slate-500 underline">
            Sign out · تسجيل الخروج
          </button>
        </div>
      </div>
    );
  }

  // If user exists but no profile, show Onboarding
  if (!profile || !profile.onboardingComplete) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  const renderView = () => {
    const activeProfile = fullProfile || profile;
    if (!activeProfile) return null;
    // Guard academic sections that aren't available for this education level
    if (
      (['gpa', 'analytics', 'goals', 'planner'] as const).includes(currentView as any) &&
      !canAccessSection(activeProfile.educationLevel, currentView as any)
    ) {
      return (
        <ChatInterface
          ref={chatRef}
          profile={activeProfile}
          onQuestionEvaluated={updateQuestionHistory}
          syncMessages={syncActiveThread}
          onMenuClick={() => setIsMobileMenuOpen(true)}
          externalMessage={externalMessage}
          onStreamingUpdate={(text) => setCurrentAIResponse(text)}
          onSTTStateChange={setIsSTTActive}
          setProfile={setProfile}
        />
      );
    }
    switch (currentView) {
      case 'chat':
        return (
          <>
            <ChatInterface 
              ref={chatRef}
              profile={activeProfile}
              onQuestionEvaluated={updateQuestionHistory} 
              syncMessages={syncActiveThread} 
              onMenuClick={() => setIsMobileMenuOpen(true)} 
              externalMessage={externalMessage}
              onStreamingUpdate={(text) => setCurrentAIResponse(text)}
              onSTTStateChange={setIsSTTActive}
              setProfile={setProfile}
            />
          </>
        );
      case 'learning':
        return <LearningHub profile={activeProfile} onMenuClick={() => setIsMobileMenuOpen(true)} onNavigateBack={() => navigateTo(homeViewFor(profile))} />;
      case 'video':
        return <SignVideoStudio profile={activeProfile} onMenuClick={() => setIsMobileMenuOpen(true)} onNavigateBack={() => navigateTo(homeViewFor(profile))} />;
      case 'disability':
        return <DisabilityModeView
          ref={chatRef}
          profile={activeProfile}
          onMenuClick={() => setIsMobileMenuOpen(true)}
          onNavigate={navigateTo}
          onQuestionEvaluated={updateQuestionHistory}
          syncMessages={syncActiveThread}
          externalMessage={externalMessage}
          onStreamingUpdate={(text) => setCurrentAIResponse(text)}
          onSTTStateChange={setIsSTTActive}
          onTabChange={setDisabilityTab}
          setProfile={setProfile}
        />;
      case 'memory':
        return (
          <StudentMemoryPage
            profile={activeProfile}
            memory={memoryState}
            loading={memoryLoading}
            error={memoryError}
            onMenuClick={() => setIsMobileMenuOpen(true)}
            onNavigateBack={() => navigateTo(homeViewFor(profile))}
            onRetry={() => {
              if (user?.uid) {
                setMemoryLoading(true);
                setMemoryError(null);
                setMemoryRetryCount((c) => c + 1);
              }
            }}
          />
        );
      case 'profile':
        return <ProfilePage profile={activeProfile} onMenuClick={() => setIsMobileMenuOpen(true)} onNavigateBack={() => navigateTo(homeViewFor(profile))} />;
      case 'admin':
        return <AdminDashboard profile={activeProfile} onMenuClick={() => setIsMobileMenuOpen(true)} onNavigateBack={() => navigateTo(homeViewFor(profile))} />;
      case 'support':
        return <SupportCenter profile={activeProfile} onMenuClick={() => setIsMobileMenuOpen(true)} onNavigateBack={() => navigateTo(homeViewFor(profile))} />;

      case 'goals':
        return (
          <GoalTracker
            profile={activeProfile}
            onMenuClick={() => setIsMobileMenuOpen(true)}
            onNavigateBack={() => navigateTo(homeViewFor(profile))}
          />
        );
      case 'gpa':
        return <GpaCalculator profile={activeProfile} onMenuClick={() => setIsMobileMenuOpen(true)} onNavigateBack={() => navigateTo(homeViewFor(profile))} />;
      case 'analytics':
        return <StudentAnalytics profile={activeProfile} onMenuClick={() => setIsMobileMenuOpen(true)} onNavigateBack={() => navigateTo(homeViewFor(profile))} />;
      case 'planner':
        return <AcademicPlanner profile={activeProfile} onMenuClick={() => setIsMobileMenuOpen(true)} onNavigateBack={() => navigateTo(homeViewFor(profile))} />;
      case 'institution':
        return <InstitutionCohortHub profile={activeProfile} onMenuClick={() => setIsMobileMenuOpen(true)} onNavigateBack={() => navigateTo(homeViewFor(profile))} />;

      case 'gym':
      case 'iq':
        return (
          <CognitiveGym
            profile={activeProfile}
            onMenuClick={() => setIsMobileMenuOpen(true)}
            onOpenIqModal={() => setIsIqModalOpen(true)}
            onNavigateBack={() => navigateTo(homeViewFor(profile))}
          />
        );

      case 'france':
        return (
          <FrenchTravelVoiceAssistant
            profile={activeProfile}
            onMenuClick={() => setIsMobileMenuOpen(true)}
            onNavigateBack={() => navigateTo(homeViewFor(profile))}
          />
        );

      case 'settings':
        return (
          <div className="flex-1 flex flex-col bg-slate-50 relative overflow-hidden">
            <header className="p-6 md:p-10 shrink-0 flex items-center gap-3">
              <button
                onClick={() => navigateTo(homeViewFor(profile))}
                className="p-2.5 text-slate-500 hover:text-slate-900 bg-white shadow-sm border border-slate-200 hover:bg-slate-50 rounded-xl active:scale-95 transition-all flex items-center gap-1.5 shrink-0"
                title={localize(profile.language, 'Back to Assistant', 'العودة للمساعد')}
              >
                <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
                <span className="text-xs font-bold hidden sm:inline">{localize(profile.language, 'Back', 'رجوع')}</span>
              </button>
              <button 
                onClick={() => setIsMobileMenuOpen(true)}
                className="p-2.5 text-slate-500 bg-white shadow-sm border border-slate-200 hover:bg-slate-50 rounded-xl active:scale-95 shrink-0"
                aria-label="Toggle menu"
                title="Open Menu"
              >
                <Menu className="w-6 h-6" />
              </button>
            </header>
            <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
              <div className="bg-white rounded-[40px] border border-slate-100 shadow-2xl max-w-2xl w-full p-8 md:p-12 space-y-10">
                <div className="text-center space-y-2">
                  <h2 className="text-2xl md:text-3xl font-black text-slate-900 uppercase tracking-tighter">{getTranslation(profile.language, 'settings')}</h2>
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
                  onClick={() => navigateTo(homeViewFor(profile))}
                  className="w-full py-5 bg-slate-100 text-slate-900 rounded-3xl text-xs font-black uppercase tracking-widest hover:bg-slate-200 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  {isAccessibilityUser(profile)
                    ? (isRTL(profile.language) ? 'العودة لمركز إمكانية الوصول' : 'Return to Accessibility Hub')
                    : getTranslation(profile.language, 'returnToChat')}
                </button>
              </div>
            </div>
          </div>
        );
      default:
        return (
          <>
            <ChatInterface 
              ref={chatRef}
              profile={profile} 
              onQuestionEvaluated={updateQuestionHistory} 
              syncMessages={syncActiveThread} 
              onMenuClick={() => setIsMobileMenuOpen(true)}
              onStreamingUpdate={setCurrentAIResponse}
              externalMessage={externalMessage}
              onSTTStateChange={setIsSTTActive}
              setProfile={setProfile}
            />
          </>
        );
    }
  };

  return (
    <ErrorBoundary>

      <div
        className={`flex w-full h-[100dvh] bg-bg-main font-sans overflow-hidden selection:bg-primary/30 transition-all duration-500 ${
          profile?.accessibilityMode === 'Visual' ? 'text-lg contrast-125' : ''
        }`}
        dir={direction}
      >
        <ToastContainer rtl={direction === 'rtl'} />
        <PwaInstallPrompt language={profile?.language} />
        <ReadAloudSelection language={profile?.language} />

        {/* Mobile menu backdrop */}
        {isMobileMenuOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar — an off-canvas drawer at EVERY width, opened by the hamburger.
            It is mounted on every view (including 'disability'): it is the only
            <Sidebar> in the app and the only route to account/settings/Sign Out,
            and the access guard bounces accessibility users back from every other
            view, so skipping it here would trap them.
            `invisible` while closed removes it from the tab order and the
            accessibility tree — a pure transform leaves it focusable, so
            keyboard/screen-reader users would hit a phantom menu (and could
            trigger Sign Out blind) before reaching the visible page. */}
        <div
            ref={sidebarRef}
            role="dialog"
            aria-modal="true"
            aria-label={localize(profile?.language, 'Main menu', 'القائمة الرئيسية')}
            className={`fixed inset-y-0 start-0 z-50 transform ${isMobileMenuOpen ? 'translate-x-0' : (direction === 'rtl' ? 'translate-x-full invisible' : '-translate-x-full invisible')} transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] shadow-2xl`}>
            <Sidebar 
              profile={fullProfile || profile}
              setProfile={async (p) => {
                // Update local state instantly so UI is highly reactive
                setProfile(p);
                
                if (!user) return;
                const path = `users/${user.uid}`;
                try {
                  const cleanProfile = JSON.parse(JSON.stringify(p));
                  
                  // Ensure activeThreadId is explicitly preserved as null if not present/undefined, so Firestore overwrites it and doesn't get merged out
                  cleanProfile.activeThreadId = p.activeThreadId !== undefined ? p.activeThreadId : null;
                  
                  // Prune large arrays to stay under 1MB
                  if (cleanProfile.chatThreads) {
                    cleanProfile.chatThreads = cleanProfile.chatThreads.map((t: any) => ({
                      id: t.id || "",
                      title: t.title || "New Chat",
                      updatedAt: t.updatedAt || new Date().toISOString(),
                      lastMessageSnippet: t.lastMessageSnippet || ""
                    }));
                  }
                  cleanProfile.chatHistory = [];

                  const finalProfileToSave = cleanDataForFirestore(cleanProfile);
                  await setDoc(doc(db, path), finalProfileToSave, { merge: true });
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


        <main className="flex-1 relative overflow-hidden flex flex-col md:flex-row">
          <Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-slate-950">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
            }
          >
            {renderView()}
          </Suspense>
        </main>

        {/* The floating accessibility overlay (sign avatar / mic / vision) is ONLY for
            users who actually need it — a real accessibility mode or the Special Needs
            path. Sighted staff who can also open the disability hub (admins, org/charity
            managers viewing their OrgDashboard) must NOT get a camera/mic overlay, so we
            gate on isAccessibilityUser rather than on the current view. */}
        {profile && isAccessibilityUser(profile)
          // Hide while the Sign Studio, Motor & Euphonia, or Visual Companion tab
          // is open — all three run their own camera pipeline (Sign Studio's
          // gesture vision, the Motor tab's eye-gaze FacialHeadTracker, and the
          // Companion's scene camera), and two camera pipelines on one device
          // conflict (camera-in-use / light stuck on / silent failure).
          && !(currentView === 'video' || (currentView === 'disability' && (disabilityTab === 'video' || disabilityTab === 'motor' || disabilityTab === 'vision'))) && (
          <AccessibilityOverlay
            mode={!profile.accessibilityMode || profile.accessibilityMode === 'None' ? 'Vocal-Deaf' : profile.accessibilityMode}
            profile={profile}
            aiResponse={currentAIResponse}
            isListening={isSTTActive}
            onTranscription={(text) => {
              setExternalMessage(text);
              // Reset so it doesn't keep triggering if ChatInterface clears it
              setTimeout(() => setExternalMessage(""), 500);
            }} 
            onToggleListening={() => {
              if (chatRef.current) {
                chatRef.current.toggleSTT();
              }
            }}
          />
        )}

        <AnimatePresence>
          {isLiveCaptionsOpen && (
            <LiveCaptions
              language={(profile?.language === 'Arabic' || profile?.language === 'Egyptian Ammiya') ? 'ar-EG' : 'en-US'}
              onClose={() => setIsLiveCaptionsOpen(false)} 
            />
          )}
        </AnimatePresence>

        <Suspense fallback={null}>
          {isIqModalOpen && (fullProfile || profile) && (
            <IqAssessmentModal
              isOpen={isIqModalOpen}
              onClose={() => setIsIqModalOpen(false)}
              profile={fullProfile || profile}
              onIqUpdated={(newScore, domainScores, newLevel) => {
                const computedLevel: CognitiveLevel =
                  newLevel || (newScore < 90 ? 'Basic' : newScore >= 115 ? 'Advanced' : 'Intermediate');
                if (profile) {
                  setProfile({
                    ...profile,
                    iqScore: newScore,
                    cognitiveDomains: domainScores,
                    lastIqTestDate: new Date().toISOString(),
                    level: computedLevel,
                    cognitiveLevel: computedLevel,
                  });
                }
              }}
            />
          )}
        </Suspense>
      </div>
    </ErrorBoundary>
  );
}
