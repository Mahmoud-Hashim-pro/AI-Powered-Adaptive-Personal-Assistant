import { localize } from '../lib/translations';
import React from 'react';
import { UserProfile, AccessibilityMode, Message, LanguagePreference } from '../types';
import { Settings, Eye, Accessibility, Menu, Sparkles, User, Ear, Mic, Brain, ArrowLeft, MessageSquare, Activity, Globe, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { doc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, cleanDataForFirestore } from '../lib/firebase';
import { toast } from './Toast';
import SignVideoStudio from './SignVideoStudio';
import HumanCommunicationBridge from './HumanCommunicationBridge';
import MotorEuphoniaView from './MotorEuphoniaView';
import VisionCompanionView from './VisionCompanionView';
import ChatInterface, { ChatInterfaceRef } from './ChatInterface';
import OrgDashboard from './OrgDashboard';
import { isAccessibilityUser } from '../lib/access';
import { getTranslation } from '../lib/translations';

interface DisabilityModeViewProps {
  profile: UserProfile;
  onMenuClick: () => void;
  onNavigate?: (view: 'chat' | 'profile' | 'settings' | 'video' | 'disability') => void;
  onQuestionEvaluated?: (score: number, lastMessageSnippet?: string) => void;
  syncMessages?: (updatedHistory: Message[]) => void;
  externalMessage?: string;
  onStreamingUpdate?: (text: string) => void;
  onSTTStateChange?: (active: boolean) => void;
  onTabChange?: (tab: 'chat' | 'settings' | 'video' | 'bridge' | 'org' | 'motor' | 'vision') => void;
  setProfile?: (profile: UserProfile) => void;
}

const DisabilityModeView = React.forwardRef<ChatInterfaceRef, DisabilityModeViewProps>(function DisabilityModeView({
  profile,
  onMenuClick,
  onNavigate,
  onQuestionEvaluated,
  syncMessages,
  externalMessage,
  onStreamingUpdate,
  onSTTStateChange,
  onTabChange,
  setProfile
}, ref) {
  const [activeTab, setActiveTab] = React.useState<'chat' | 'settings' | 'video' | 'bridge' | 'org' | 'motor' | 'vision'>(() => {
    if (profile?.accessibilityMode === 'Motor-Euphonia') return 'motor';
    if (profile?.accessibilityMode === 'Visual') return 'vision';
    return 'video';
  });
  // Organization staff (e.g. Care Center / NGO) get an extra tab scoped to THEIR users.
  const isOrgStaff = !!profile?.isOrgManager && !!(profile?.organization || '').trim();

  // Tell the parent which tab is active so it can hide the floating overlay
  // (with its own camera) while the Sign Studio or Motor tab is using the camera —
  // otherwise two camera pipelines fight over the device.
  React.useEffect(() => { onTabChange?.(activeTab); }, [activeTab]);
  React.useEffect(() => () => { onTabChange?.('chat'); }, []);

  const SUPPORTED_LANGUAGES: { id: LanguagePreference; label: string; flag: string; nativeName: string }[] = [
    { id: 'French', label: 'French', flag: '🇫🇷', nativeName: 'Français' },
    { id: 'English', label: 'English', flag: '🇬🇧', nativeName: 'English' },
    { id: 'Arabic', label: 'Arabic', flag: '🇸🇦', nativeName: 'العربية' },
    { id: 'Egyptian Ammiya', label: 'Egyptian Ammiya', flag: '🇪🇬', nativeName: 'مصري' },
    { id: 'Spanish', label: 'Spanish', flag: '🇪🇸', nativeName: 'Español' },
    { id: 'German', label: 'German', flag: '🇩🇪', nativeName: 'Deutsch' },
    { id: 'Italian', label: 'Italian', flag: '🇮🇹', nativeName: 'Italiano' },
    { id: 'Portuguese', label: 'Portuguese', flag: '🇵🇹', nativeName: 'Português' },
    { id: 'Russian', label: 'Russian', flag: '🇷🇺', nativeName: 'Русский' },
    { id: 'Chinese', label: 'Chinese', flag: '🇨🇳', nativeName: '中文' },
    { id: 'Japanese', label: 'Japanese', flag: '🇯🇵', nativeName: '日本語' },
  ];

  const updateLanguage = async (newLang: LanguagePreference) => {
    if (!profile?.uid) return;
    const previousLang = profile.language;
    if (setProfile) setProfile({ ...profile, language: newLang });
    const path = `users/${profile.uid}`;
    try {
      await setDoc(doc(db, path), cleanDataForFirestore({ language: newLang }), { merge: true });
      toast.success(
        localize(newLang, 'Language updated successfully', 'تم تحديث اللغة بنجاح'),
        localize(newLang, 'Language', 'اللغة')
      );
    } catch (err) {
      console.error('Failed to update language:', err);
      if (setProfile) setProfile({ ...profile, language: previousLang });
      toast.error(
        localize(profile?.language, 'Failed to update language. Please check your connection.', 'فشل تحديث اللغة. تحقق من اتصالك.'),
        localize(profile?.language, 'Update Error', 'خطأ في التحديث')
      );
    }
  };

  const updateAccessibilityMode = async (mode: AccessibilityMode) => {
    if (!profile?.uid) return;
    const previousMode = profile.accessibilityMode;
    // Apply locally FIRST so the UI switches instantly — without this the change
    // only showed up after a Firestore round-trip (felt like it needed a refresh).
    if (setProfile) setProfile({ ...profile, accessibilityMode: mode });
    const path = `users/${profile.uid}`;
    try {
      await setDoc(doc(db, path), { accessibilityMode: mode }, { merge: true });
    } catch (err) {
      console.error('Failed to update accessibility mode:', err);
      if (setProfile) setProfile({ ...profile, accessibilityMode: previousMode });
      toast.error(
        localize(profile?.language, 'Failed to update accessibility mode. Please check your connection.', 'فشل تحديث وضع إمكانية الوصول. تحقق من اتصالك.'),
        localize(profile?.language, 'Update Error', 'خطأ في التحديث')
      );
    }
  };

  const getModeIcon = (mode: AccessibilityMode) => {
    switch (mode) {
      case 'None': return <User className="w-5 h-5" />;
      case 'Speech': return <Mic className="w-5 h-5" />;
      case 'Visual': return <Eye className="w-5 h-5" />;
      case 'Vocal-Deaf': return <Ear className="w-5 h-5" />;
      case 'Sign-Only': return <Accessibility className="w-5 h-5" />;
      case 'Motor-Euphonia': return <Activity className="w-5 h-5 text-amber-500" />;
      default: return <Settings className="w-5 h-5" />;
    }
  };

  const getModeDescription = (mode: AccessibilityMode) => {
    switch (mode) {
      case 'None': return localize(profile.language, 'Standard cognitive interface without accessibility overlays.', 'واجهة إدراكية قياسية بدون طبقات إمكانية وصول.');
      case 'Speech': return localize(profile.language, 'Activates voice transcription, synthetic speech synthesis, and text-to-speech feedback.', 'يفعل النسخ الصوتي، والتخليق الصوتي، وملاحظات تحويل النص إلى كلام.');
      case 'Visual': return localize(profile.language, 'Enables vision analysis, high contrast, text zooming, and spatial layout modifications.', 'يفعل تحليل الرؤية، والتباين العالي، وتكبير النص، وتعديلات التخطيط المكاني.');
      case 'Vocal-Deaf': return localize(profile.language, 'Enables sign language avatar alongside speech recognition for users who are deaf but can speak.', 'يفعل الصورة الرمزية للغة الإشارة جنباً إلى جنب مع التعرف على الكلام للمستخدمين الصم الذين يمكنهم التحدث.');
      case 'Sign-Only': return localize(profile.language, 'Full sign language interface powered by the avatar and vision-based gesture recognition.', 'واجهة كاملة للغة الإشارة مدعومة بالصورة الرمزية والتعرف على الإيماءات المعتمد على الرؤية.');
      case 'Motor-Euphonia': return localize(profile.language, 'Hands-free control for quadriplegia/motor disability using head pointer, facial expressions, and vocal sound triggers.', 'تحكم كامل بدون لمس لمصابي الشلل الرباعي والتصلب الجانبي عبر حركة الرأس، تعابير الوجه، وهمهمات إيفونيا الصوتية.');
      default: return '';
    }
  };

  // h-full (not h-screen): 100vh overflows the real mobile viewport (URL bar),
  // clipping the bottom controls — the parent App container already sizes us.
  return (
    <div className="flex-1 flex flex-col h-full bg-bg-main overflow-hidden relative">
      {/* Stacks on mobile: title row + full-width scrollable tabs. Single row again ≥md.
          relative + z-[9995]: MotorEuphoniaView's floating camera panel is
          `position: fixed` at z-[9990] and can be pinned to any corner,
          including one that overlapped this header — clipping tab labels and
          making them unclickable underneath it. This header now always wins
          the stacking order, regardless of which corner the panel sits in. */}
      <header className="relative z-[9995] px-4 py-2.5 sm:px-6 sm:py-3 shrink-0 flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-4 border-b border-border bg-bg-card shadow-sm">
        <div className="flex items-center gap-3">
          {/* Accessibility users are scoped OUT of 'chat' by canAccessView, so
              navigating there just bounces straight back here — which left blind
              users with NO way to reach their profile, settings or logout. For
              them this opens the sidebar (their real escape hatch) instead. */}
          <button
            onClick={() => {
              if (isAccessibilityUser(profile) || !onNavigate) onMenuClick();
              else onNavigate('chat');
            }}
            // The visible label is hidden on mobile, so without this the control
            // is announced as an unlabelled button to a screen reader.
            aria-label={isAccessibilityUser(profile)
              ? localize(profile.language, 'Open menu (account, settings, sign out)', 'افتح القائمة (الحساب، الإعدادات، تسجيل الخروج)')
              : getTranslation(profile.language, 'back')}
            // Visible at EVERY width — the sidebar is an off-canvas drawer now, so
            // this is the only way to reach account / settings / Sign Out.
            className="p-1.5 text-text-muted bg-bg-main border border-border hover:bg-surface-3 rounded-lg active:scale-95 transition-all flex items-center gap-2"
          >
            {isAccessibilityUser(profile)
              ? <Menu className="w-4 h-4" />
              : <ArrowLeft className={`w-4 h-4 ${localize(profile.language, '', 'rotate-180')}`} />}
            <span className="hidden sm:inline text-xs font-semibold uppercase tracking-widest text-text-muted">
              {isAccessibilityUser(profile)
                ? localize(profile.language, 'Menu', 'القائمة')
                : getTranslation(profile.language, 'back')}
            </span>
          </button>
          {/* Title + subtitle were a full decorative hero block (big heading,
              a full sentence of marketing copy) that ate roughly a third of
              the screen on shorter viewports — reasonable on a landing page,
              wasteful once someone is actively using a tool like the camera
              below. Subtitle dropped entirely here; title shrunk to a compact
              single line. The full hero still exists on first load/no tab
              selected via the tab content itself if needed. */}
          <h1 className="text-sm sm:text-base font-bold text-text-main tracking-tight flex items-center gap-2 shrink-0">
            <Accessibility className="w-4 h-4 sm:w-5 sm:h-5 text-primary shrink-0" />
            <span className="hidden sm:inline">{getTranslation(profile.language, 'disabilityModeTitle')}</span>
          </h1>
        </div>

        {/* Tabs: full-width equal columns on mobile (never wider than the screen,
            scrolls if a long label still overflows); compact pills again ≥md. */}
        {/* Tabs: full-width equal columns on mobile */}
        <div role="tablist" className="flex items-center bg-surface-3 p-1 rounded-xl w-full md:w-auto overflow-x-auto shrink-0">
          {([
            { id: 'motor' as const, label: localize(profile.language, '⚡ Motor & Euphonia', '⚡ تحكم حركي وإيفونيا') },
            { id: 'vision' as const, label: localize(profile.language, '👁️ Visual Companion', '👁️ الرفيق البصري') },
            { id: 'video' as const, label: localize(profile.language, '🤖 AI Sign Studio', '🤖 الذكاء الاصطناعي والإشارة') },
            { id: 'bridge' as const, label: localize(profile.language, '🤝 Two-Way Bridge', '🤝 تواصل بشري مباشر') },
            { id: 'chat' as const, label: localize(profile.language, '💬 Text Chat', '💬 محادثة نصية') },
            { id: 'settings' as const, label: getTranslation(profile.language, 'preferences') },
            ...(isOrgStaff ? [{ id: 'org' as const, label: localize(profile.language, 'My Organization', 'لوحة الجهة') }] : []),
          ]).map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 md:flex-none min-h-[44px] px-2.5 sm:px-4 md:px-6 py-2 md:py-2.5 rounded-lg text-xs sm:text-sm font-bold whitespace-nowrap transition-all ${
                activeTab === id ? 'bg-bg-card text-primary shadow-sm' : 'text-text-muted hover:text-text-main'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      
      {/* min-h-0 lets this flex child actually shrink so its children's
          overflow-y-auto engages instead of pushing the layout off-screen */}
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
        <AnimatePresence mode="wait">
          {activeTab === 'motor' ? (
            <motion.div
              key="motor"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="w-full h-full min-h-0"
            >
              <MotorEuphoniaView profile={profile} />
            </motion.div>
          ) : activeTab === 'vision' ? (
            <motion.div
              key="vision"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="w-full h-full min-h-0"
            >
              <VisionCompanionView profile={profile} setProfile={setProfile} />
            </motion.div>
          ) : activeTab === 'bridge' ? (
            <motion.div
              key="bridge"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="w-full h-full min-h-0"
            >
              <HumanCommunicationBridge profile={profile} />
            </motion.div>
          ) : activeTab === 'video' ? (
            <motion.div
              key="video"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="w-full h-full min-h-0"
            >
              <SignVideoStudio profile={profile} onMenuClick={onMenuClick} isEmbedded={true} />
            </motion.div>
          ) : activeTab === 'chat' ? (
            <motion.div
              key="chat"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="w-full h-full min-h-0 flex flex-col p-3 sm:p-4 md:p-6 lg:p-10 pb-0"
            >
              <div className="flex-1 min-h-0 bg-bg-card rounded-t-3xl shadow-sm border border-border overflow-hidden relative flex flex-col">
                <ChatInterface
                  ref={ref}
                  profile={profile}
                  onQuestionEvaluated={onQuestionEvaluated || (() => {})}
                  syncMessages={syncMessages || (() => {})}
                  onMenuClick={onMenuClick}
                  externalMessage={externalMessage}
                  onStreamingUpdate={onStreamingUpdate}
                  onSTTStateChange={onSTTStateChange}
                  isEmbedded={true}
                  setProfile={setProfile}
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
              <div className="max-w-4xl mx-auto space-y-8 pb-20">
                {/* Language Selection Card */}
                <div className="bg-bg-card p-6 sm:p-8 md:p-10 rounded-2xl shadow-sm border border-border">
                  <div className="mb-6">
                    <div className="flex items-center gap-2 text-primary mb-1">
                      <Globe className="w-5 h-5" />
                      <h2 className="text-xl font-semibold text-text-main tracking-tight">
                        {localize(profile.language, 'Language Selection', 'اختيار اللغة')}
                      </h2>
                    </div>
                    <p className="text-sm text-text-muted">
                      {localize(
                        profile.language,
                        'Choose your preferred system & AI communication language',
                        'اختر لغة النظام والتواصل مع المساعد الذكي'
                      )}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {SUPPORTED_LANGUAGES.map((lang) => {
                      const isSelected = profile.language === lang.id;
                      return (
                        <button
                          key={lang.id}
                          onClick={() => updateLanguage(lang.id)}
                          className={`p-3 sm:p-3.5 rounded-xl border flex items-center justify-between transition-all active:scale-95 ${
                            isSelected
                              ? 'border-primary bg-primary/10 shadow-sm text-primary font-bold'
                              : 'border-border bg-bg-main hover:border-primary/40 text-text-main'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-lg shrink-0">{lang.flag}</span>
                            <div className="text-start truncate">
                              <p className="text-xs font-bold leading-none">{lang.nativeName}</p>
                              <p className="text-[10px] text-text-muted mt-0.5 truncate">{lang.label}</p>
                            </div>
                          </div>
                          {isSelected && <Check className="w-4 h-4 text-primary shrink-0 ml-1" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Accessibility Profiles Card */}
                <div className="bg-bg-card p-6 sm:p-8 md:p-10 rounded-2xl shadow-sm border border-border">
                  <div className="mb-8">
                    <h2 className="text-xl font-semibold text-text-main tracking-tight mb-1">{getTranslation(profile.language, 'accessibilityProfiles')}</h2>
                    <p className="text-sm text-text-muted">{getTranslation(profile.language, 'accessibilityModeDescription')}</p>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(['None', 'Motor-Euphonia', 'Sign-Only', 'Speech', 'Visual', 'Vocal-Deaf'] as AccessibilityMode[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => updateAccessibilityMode(mode)}
                        className={`text-start p-5 rounded-xl border transition-all relative ${
                          profile.accessibilityMode === mode 
                            ? 'border-primary bg-primary/5 shadow-sm' 
                            : 'border-border bg-bg-card hover:border-border hover:bg-bg-main'
                        }`}
                      >
                        <div className="flex items-start gap-4 relative z-10">
                          <div className={`mt-0.5 p-2 rounded-lg ${
                            profile.accessibilityMode === mode 
                              ? 'bg-primary text-white' 
                              : 'bg-surface-3 text-text-muted'
                          }`}>
                            {getModeIcon(mode)}
                          </div>
                          <div>
                            <h3 className={`text-sm font-semibold mb-1 ${
                              profile.accessibilityMode === mode ? 'text-primary' : 'text-text-main'
                            }`}>
                              {mode === 'None' ? getTranslation(profile.language, 'standardProtocol')
                                : mode === 'Motor-Euphonia' ? localize(profile.language, 'Motor & Euphonia', 'تحكم حركي وإيفونيا')
                                : mode === 'Speech' ? localize(profile.language, 'Speech', 'النطق')
                                : mode === 'Visual' ? localize(profile.language, 'Visual', 'بصري')
                                : mode === 'Vocal-Deaf' ? localize(profile.language, 'Vocal-Deaf', 'أصمّ ناطق')
                                : mode === 'Sign-Only' ? localize(profile.language, 'Sign-Only', 'إشارة فقط')
                                : mode}
                            </h3>
                            <p className="text-xs text-text-muted leading-relaxed font-medium">
                              {getModeDescription(mode)}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-surface-3 p-8 rounded-2xl text-text-main shadow-md relative overflow-hidden flex flex-col md:flex-row items-center gap-6 border border-border">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 blur-3xl rounded-full pointer-events-none" />

                  <div className="p-4 bg-surface-2 rounded-2xl shrink-0">
                    <Brain className="w-8 h-8 text-primary" />
                  </div>

                  <div className="flex-1 relative z-10">
                    <h3 className="text-base font-semibold tracking-wide mb-1.5 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-accent" /> {localize(profile.language, 'Active Profile Context', 'سياق الملف النشط')}
                    </h3>
                    <p className="text-text-muted font-medium text-sm leading-relaxed max-w-2xl">
                      {localize(
                        profile.language,
                        'By enabling an accessibility profile, the engine modifies its context generation. Visual mode prioritizes layout structuring and large font metadata. Deaf modes enable real-time gesture interpolation via our virtual signing avatar. Speech mode invokes zero-latency TTS responses.',
                        'بتفعيل ملف إمكانية الوصول، يقوم المحرك بتعديل توليد السياق تلقائياً. الوضع البصري يعطي الأولوية لترتيب العناصر ومطابقة الشاشة للقارئ الصوتي. أوضاع الصم تفعّل استوديو لغة الإشارة عبر الصورة الرمزية ثلاثية الأبعاد. والوضع الصوتي يفعّل الاستجابات الصوتية الفورية بدون تأخير.'
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : activeTab === 'org' ? (
            <motion.div
              key="org"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="w-full h-full"
            >
              <OrgDashboard profile={profile} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>
    </div>
  );
});

export default DisabilityModeView;
