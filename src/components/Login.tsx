import React, { useState, useEffect, useRef } from 'react';
import { signInWithGoogle, signInWithGoogleRedirect, loginWithEmail, registerWithEmail, auth, clearPreLoginState } from '../lib/firebase';
import { sendPasswordResetEmail, getRedirectResult } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Chrome, Mail, Lock, AlertCircle, Loader2, Eye, EyeOff, 
  ArrowLeft, ArrowRight, 
  Sparkles, Tag, ChevronDown, LockKeyhole, Globe
} from 'lucide-react';

type AccountPath = 'Normal' | 'Graduation Project' | 'Special Needs';
type DisabilityOption = 'Visual' | 'Hearing' | 'Motor' | 'Speech' | 'Cognitive';

export default function Login() {
  const [lang, setLang] = useState<'en' | 'ar'>(() => {
    if (typeof navigator !== 'undefined' && /^ar/i.test(navigator.language || '')) {
      return 'ar';
    }
    return 'en';
  });

  const [mode, setMode] = useState<'path-selection' | 'email-login' | 'email-register' | 'reset-password'>('path-selection');
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [showRedirectOption, setShowRedirectOption] = useState(false);

  const [accountPath, setAccountPath] = useState<AccountPath>('Normal');
  const [universityEmail, setUniversityEmail] = useState("");
  const [faculty, setFaculty] = useState("");
  const [department, setDepartment] = useState("");
  const [selectedDisability, setSelectedDisability] = useState<DisabilityOption>('Visual');

  const [showHelp, setShowHelp] = useState(false);
  const [isInIframe] = useState(() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  });

  const isRtl = lang === 'ar';
  const t = (en: string, ar: string) => (lang === 'ar' ? ar : en);

  const isMountedRef = useRef(true);
  const authTimeoutRef = useRef<any>(null);

  useEffect(() => {
    isMountedRef.current = true;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as any });

    // Catch any redirect result or domain error when returning from signInWithRedirect
    getRedirectResult(auth).catch((err: any) => {
      console.warn("Google Redirect Result:", err);
      if (isMountedRef.current && err) {
        if (err.code === 'auth/unauthorized-domain') {
          setError(t("Google Login requires an authorized domain. Please use Email & Password below.", "تسجيل جوجل يتطلب نطاقاً مصرحاً. يرجى استخدام الإيميل وكلمة المرور بالأسفل."));
        } else if (err.code !== 'auth/credential-already-in-use') {
          setError(err?.message?.replace("Firebase: ", "") || t("Google Sign-In failed. Please try again or use Email.", "تعذر تسجيل الدخول عبر جوجل. يرجى المحاولة مرة أخرى أو استخدام البريد."));
        }
      }
    });

    return () => {
      isMountedRef.current = false;
      if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
    };
  }, []);

  const handleContinuePath = () => {
    clearPreLoginState();
    try {
      localStorage.setItem('preLoginAccountPath', accountPath);
      if (accountPath === 'Graduation Project') {
        localStorage.setItem('preLoginUniEmail', universityEmail);
        localStorage.setItem('preLoginFaculty', faculty);
        localStorage.setItem('preLoginDepartment', department || 'General');
      }
      if (accountPath === 'Special Needs') {
        const fullMap: Record<DisabilityOption, string> = {
          'Visual': 'Visual Impairment',
          'Hearing': 'Hearing Impairment',
          'Motor': 'Motor Impairment',
          'Speech': 'Speech Impairment',
          'Cognitive': 'Cognitive/Learning Disability',
        };
        localStorage.setItem('preLoginDisability', fullMap[selectedDisability] || 'Visual Impairment');
      }
    } catch (err) {
      console.warn("LocalStorage unavailable in current context:", err);
    }
    setMode('email-login');
  };

  const validateUniversityEmail = (e: string) => {
    return !!e && /^[^\s@]+@[^\s@]+\.edu(\.[^\s@]+)?$/i.test(e.trim());
  };

  const handleGoogleRedirectAuth = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    setShowHelp(false);
    try {
      await signInWithGoogleRedirect();
    } catch (err: any) {
      if (!isMountedRef.current) return;
      if (err.code === 'auth/unauthorized-domain') {
        setError(t("Google Login requires an authorized domain. Please use Email & Password below.", "تسجيل جوجل يتطلب نطاقاً مصرحاً. يرجى استخدام الإيميل وكلمة المرور بالأسفل."));
      } else {
        setError(err?.message?.replace("Firebase: ", "") || t("Google Sign-In failed. Please use Email & Password.", "تعذر تسجيل الدخول عبر جوجل. يرجى استخدام البريد وكلمة المرور."));
      }
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    setShowHelp(false);

    // Strict 10s watchdog so Google popup never hangs the UI if blocked by browser or network
    if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
    authTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setLoading(false);
        setShowRedirectOption(true);
        setError(t("Google Sign-In timed out or was blocked by browser. Click Direct Google Sign-In below or use Email.", "استغرق تسجيل جوجل وقتاً طويلاً أو تم حظره بواسطة المتصفح. اضغط على تسجيل جوجل المباشر بالأسفل أو استخدم البريد."));
      }
    }, 10000);

    try {
      await signInWithGoogle();
      if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
    } catch (err: any) {
      if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
      if (!isMountedRef.current) return;
      if (err.code === 'auth/cancelled-popup-request') {
        /* another popup open */
      } else if (err.code === 'auth/popup-closed-by-user') {
        setShowRedirectOption(true);
        setError(t(
          "Authorization window was closed or blocked by browser policy (COOP). Click Direct Google Sign-In below without popups.",
          "تم إغلاق نافذة المصادقة أو حظرها بواسطة سياسة المتصفح (COOP). يمكنك الضغط على تسجيل جوجل المباشر بالأسفل بدون نوافذ منبثقة."
        ));
      } else if (err.code === 'auth/popup-blocked') {
        // Popups are blocked by the browser. Seamlessly fallback to redirect flow!
        try {
          await signInWithGoogleRedirect();
          return;
        } catch (redirErr: any) {
          setShowRedirectOption(true);
          setError(
            t(
              "Pop-up was blocked by your browser. Please click Direct Google Sign-In below or use Email & Password.",
              "قام المتصفح بحظر النافذة المنبثقة (Pop-up Blocked). يرجى الضغط على تسجيل جوجل المباشر بالأسفل أو استخدام البريد وكلمة المرور."
            )
          );
        }
      } else if (err.code === 'auth/unauthorized-domain') {
        setError(t("Google Login requires an authorized domain. Please use Email & Password below.", "تسجيل جوجل يتطلب نطاقاً مصرحاً. يرجى استخدام الإيميل وكلمة المرور بالأسفل."));
      } else {
        setShowRedirectOption(true);
        setError(err?.message?.replace("Firebase: ", "") || t("Google Sign-In failed. Please use Direct Google Sign-In or Email below.", "تعذر تسجيل الدخول عبر جوجل. يرجى استخدام تسجيل جوجل المباشر أو البريد أدناه."));
      }
    } finally {
      if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const handleManualAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'email-login') {
        await loginWithEmail(email, password);
      } else {
        if (password.length < 8) {
          if (isMountedRef.current) {
            setError(t("Password must be at least 8 characters.", "كلمة المرور يجب أن تكون 8 أحرف على الأقل."));
            setLoading(false);
          }
          return;
        }
        if (password !== confirmPassword) {
          if (isMountedRef.current) {
            setError(t("Passwords don't match. Please re-enter them.", "كلمتا المرور غير متطابقتين."));
            setLoading(false);
          }
          return;
        }
        await registerWithEmail(email, password);
      }
    } catch (err: any) {
      if (!isMountedRef.current) return;
      const code = err?.code || '';
      const msg = code === 'auth/network-request-failed'
        ? t("Network error — check your connection and try again.", "خطأ في الشبكة — تحقق من الاتصال وحاول مجدداً.")
        : code === 'auth/email-already-in-use'
          ? t("This email is already registered. Try signing in instead.", "هذا البريد مسجل بالفعل. حاول تسجيل الدخول بدلاً من ذلك.")
          : code === 'auth/weak-password'
            ? t("Password is too weak — use at least 8 characters.", "كلمة المرور ضعيفة — استخدم 8 خانات على الأقل.")
            : (err.message || '').replace("Firebase: ", "");
      setError(msg);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError(t("Please enter your email address.", "يرجى كتابة البريد الإلكتروني."));
      return;
    }
    setError(null);
    setLoading(true);
    setResetSuccess(false);

    try {
      await sendPasswordResetEmail(auth, email);
      if (isMountedRef.current) setResetSuccess(true);
    } catch (err: any) {
      if (isMountedRef.current) {
        setError((err?.message || String(err) || '').replace("Firebase: ", ""));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0C14] text-slate-100 flex flex-col items-center justify-start p-4 sm:p-6 lg:p-8 font-sans relative overflow-x-hidden selection:bg-rose-500/30 selection:text-white" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Background ambient lighting */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-rose-500/10 rounded-full blur-[140px]" />
        <div className="absolute top-1/2 -right-40 w-[600px] h-[600px] bg-teal-500/10 rounded-full blur-[140px]" />
        <div className="absolute -bottom-40 left-1/3 w-[600px] h-[600px] bg-amber-500/10 rounded-full blur-[140px]" />
      </div>

      {/* Top Navbar */}
      <header className="max-w-5xl mx-auto w-full flex items-center justify-between z-10 py-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-rose-500 via-pink-500 to-amber-400 p-0.5 shadow-lg shadow-rose-500/20 flex items-center justify-center">
            <div className="w-full h-full bg-[#0E111D] rounded-[14px] flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-rose-400" />
            </div>
          </div>
          <span className="text-xl font-black text-white tracking-tight">Cognify</span>
        </div>

        {/* Language Switcher */}
        <div className="flex items-center gap-1 p-1 bg-slate-900/90 border border-slate-800 rounded-full shadow-inner">
          <button
            onClick={() => setLang('en')}
            className={`px-3 py-1 rounded-full text-xs font-black transition-all ${lang === 'en' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
          >
            EN
          </button>
          <button
            onClick={() => setLang('ar')}
            className={`px-3 py-1 rounded-full text-xs font-black transition-all ${lang === 'ar' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
          >
            AR
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-5xl mx-auto w-full z-10 space-y-6">
        <AnimatePresence mode="wait">
          {mode === 'path-selection' ? (
            <motion.div
              key="path-selection"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="space-y-6"
            >
              {/* Hero Title Header */}
              <div className="space-y-2.5 max-w-2xl">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 border border-amber-500/30 text-amber-300 shadow-sm">
                  <Tag className="w-3.5 h-3.5 text-amber-400" />
                  <span>{t("Same mentor, different calibration", "نفس المساعد، بمعايرة مخصصة لك")}</span>
                </div>

                <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight leading-[1.15]">
                  {isRtl ? (
                    <>سؤال واحد. <span className="text-amber-400">ثلاثة</span> <span className="text-rose-400">طر</span><span className="text-teal-400">ق</span> لسماع الإجابة.</>
                  ) : (
                    <>One question. <span className="text-amber-400">Three</span> <span className="text-rose-400">wa</span><span className="text-teal-400">ys</span> to hear the answer.</>
                  )}
                </h1>

                <p className="text-xs sm:text-sm text-slate-400 font-medium leading-relaxed">
                  {t(
                    "Cognify doesn't just change its tone — it changes what it says. Pick a path below to get started.",
                    "كوجنيفاي لا يغير نبرته فقط — بل يغير محتوى ما يقوله تماماً. اختر مساراً بالأسفل للبدء."
                  )}
                </p>
              </div>

              {/* Main Path Selection Card */}
              <div className="bg-[#121524]/95 border border-slate-800/80 rounded-[28px] overflow-hidden shadow-2xl backdrop-blur-2xl">
                {/* Top Tri-Color Strip */}
                <div className="grid grid-cols-3 h-1 w-full">
                  <div className="bg-amber-400" />
                  <div className="bg-teal-400" />
                  <div className="bg-rose-500" />
                </div>

                <div className="max-w-xl mx-auto space-y-5 p-5 sm:p-7 md:p-8">
                  {/* CHOOSE YOUR PATH */}
                  <div className="space-y-3.5">
                    <div>
                      <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
                        {t("Choose your path", "اختر مسارك")}
                      </h2>
                      <p className="text-[11px] text-slate-400 font-medium mt-0.5">
                        {t("You can change this later in settings.", "يمكنك تغيير هذا المسار لاحقاً من الإعدادات.")}
                      </p>
                    </div>

                    {/* Vertical Path Selector Timeline */}
                    <div className="space-y-3 relative">
                      {/* Connecting Line */}
                      <div className={`absolute top-4 bottom-4 ${isRtl ? 'right-[11px]' : 'left-[11px]'} w-0.5 bg-slate-800 z-0`} />

                      {/* 1. Normal */}
                      <div
                        onClick={() => setAccountPath('Normal')}
                        className={`relative z-10 flex items-start gap-3.5 p-3.5 rounded-2xl cursor-pointer border transition-all ${
                          accountPath === 'Normal'
                            ? 'bg-amber-500/10 border-amber-500/40 shadow-md shadow-amber-500/5'
                            : 'bg-transparent border-transparent hover:bg-slate-800/40'
                        }`}
                      >
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                          accountPath === 'Normal'
                            ? 'bg-amber-400 text-slate-950 ring-4 ring-amber-400/20'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}>
                          <div className={`w-2 h-2 rounded-full ${accountPath === 'Normal' ? 'bg-slate-950' : 'bg-slate-600'}`} />
                        </div>
                        <div>
                          <div className={`text-sm font-black transition-colors ${accountPath === 'Normal' ? 'text-amber-300' : 'text-slate-200'}`}>
                            {t("Normal", "عادي")}
                          </div>
                          <div className="text-xs text-slate-400 font-medium mt-0.5">
                            {t("Standard cognitive evaluation path.", "المسار القياسي للتقييم المعرفي العام.")}
                          </div>
                        </div>
                      </div>

                      {/* 2. Graduation Project */}
                      <div
                        onClick={() => setAccountPath('Graduation Project')}
                        className={`relative z-10 flex flex-col gap-3 p-3.5 rounded-2xl cursor-pointer border transition-all ${
                          accountPath === 'Graduation Project'
                            ? 'bg-teal-500/10 border-teal-500/40 shadow-md shadow-teal-500/5'
                            : 'bg-transparent border-transparent hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="flex items-start gap-3.5">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                            accountPath === 'Graduation Project'
                              ? 'bg-teal-400 text-slate-950 ring-4 ring-teal-400/20'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}>
                            <div className={`w-2 h-2 rounded-full ${accountPath === 'Graduation Project' ? 'bg-slate-950' : 'bg-slate-600'}`} />
                          </div>
                          <div>
                            <div className={`text-sm font-black transition-colors ${accountPath === 'Graduation Project' ? 'text-teal-300' : 'text-slate-200'}`}>
                              {t("Graduation Project", "مشروع تخرج")}
                            </div>
                            <div className="text-xs text-slate-400 font-medium mt-0.5">
                              {t("Anchored to your faculty & department.", "مرتبط بكليتك وتخصصك ومقرراتك الأكاديمية.")}
                            </div>
                          </div>
                        </div>

                        {/* Graduation Inputs */}
                        {accountPath === 'Graduation Project' && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="space-y-3 pt-2 ps-9"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="space-y-1">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                {t("Faculty / College", "الكلية / الجامعة")}
                              </label>
                              <div className="relative">
                                <select
                                  value={faculty}
                                  onChange={(e) => setFaculty(e.target.value)}
                                  className="w-full bg-[#181C2E] border border-slate-700 text-slate-200 text-xs font-semibold rounded-xl px-3.5 py-2.5 outline-none appearance-none cursor-pointer focus:border-teal-400"
                                >
                                  <option value="" disabled>{t("Select your faculty", "اختر كليتك")}</option>
                                  <option value="Computers and Artificial Intelligence">Computers and Artificial Intelligence</option>
                                  <option value="Engineering">Engineering</option>
                                  <option value="Medicine">Medicine</option>
                                  <option value="Pharmacy">Pharmacy</option>
                                  <option value="Science">Science</option>
                                  <option value="Commerce">Commerce</option>
                                  <option value="Arts">Arts</option>
                                  <option value="Law">Law</option>
                                  <option value="Other">Other</option>
                                </select>
                                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 pointer-events-none ${isRtl ? 'left-3' : 'right-3'}`} />
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                {t("University email", "البريد الجامعي")}
                              </label>
                              <input
                                type="email"
                                placeholder="id@university.edu.eg"
                                value={universityEmail}
                                onChange={(e) => setUniversityEmail(e.target.value)}
                                className="w-full bg-[#181C2E] border border-slate-700 text-slate-200 placeholder-slate-500 text-xs font-semibold rounded-xl px-3.5 py-2.5 outline-none focus:border-teal-400"
                              />
                              {universityEmail.length > 0 && !validateUniversityEmail(universityEmail) && (
                                <p className="text-[10px] text-rose-400 font-medium">
                                  {t("Enter a valid university email (.edu)", "اكتب بريداً جامعياً ينتهي بـ .edu")}
                                </p>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </div>

                      {/* 3. Special Needs */}
                      <div
                        onClick={() => setAccountPath('Special Needs')}
                        className={`relative z-10 flex flex-col gap-3 p-3.5 rounded-2xl cursor-pointer border transition-all ${
                          accountPath === 'Special Needs'
                            ? 'bg-rose-500/10 border-rose-500/40 shadow-md shadow-rose-500/5'
                            : 'bg-transparent border-transparent hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="flex items-start gap-3.5">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                            accountPath === 'Special Needs'
                              ? 'bg-rose-500 text-white ring-4 ring-rose-500/20'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}>
                            <div className={`w-2 h-2 rounded-full ${accountPath === 'Special Needs' ? 'bg-white' : 'bg-slate-600'}`} />
                          </div>
                          <div>
                            <div className={`text-sm font-black transition-colors ${accountPath === 'Special Needs' ? 'text-rose-300' : 'text-slate-200'}`}>
                              {t("Special Needs", "احتياجات خاصة (ذوي الهمم)")}
                            </div>
                            <div className="text-xs text-slate-400 font-medium mt-0.5">
                              {t("Customized accessible experience.", "تجربة مخصصة سهلة الوصول مع دعم لغة الإشارة والتتبع.")}
                            </div>
                          </div>
                        </div>

                        {/* Focus Chips */}
                        {accountPath === 'Special Needs' && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="space-y-2 pt-2 ps-9"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                              {t("Accessibility focus", "نوع الإتاحة المطلوب")}
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                              {(['Visual', 'Hearing', 'Motor', 'Speech', 'Cognitive'] as DisabilityOption[]).map((dis) => (
                                <button
                                  key={dis}
                                  type="button"
                                  onClick={() => setSelectedDisability(dis)}
                                  className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                                    selectedDisability === dis
                                      ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20'
                                      : 'bg-slate-800/80 border border-slate-700/80 text-slate-300 hover:border-slate-500'
                                  }`}
                                >
                                  {dis === 'Visual' && t('Visual', 'بصري')}
                                  {dis === 'Hearing' && t('Hearing', 'سمعي')}
                                  {dis === 'Motor' && t('Motor', 'حركي')}
                                  {dis === 'Speech' && t('Speech', 'نطق')}
                                  {dis === 'Cognitive' && t('Cognitive', 'إدراكي')}
                                </button>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Continue Button */}
                  <button
                    onClick={handleContinuePath}
                    disabled={
                      accountPath === 'Graduation Project' && (!faculty || !validateUniversityEmail(universityEmail))
                    }
                    className={`w-full py-4 px-6 rounded-2xl font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-xl transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ${
                      accountPath === 'Normal'
                        ? 'bg-gradient-to-r from-amber-400 via-amber-500 to-rose-400 text-slate-950 hover:opacity-95 shadow-amber-500/20'
                        : accountPath === 'Graduation Project'
                        ? 'bg-gradient-to-r from-teal-400 to-emerald-400 text-slate-950 hover:opacity-95 shadow-teal-500/20'
                        : 'bg-gradient-to-r from-rose-500 via-pink-500 to-rose-600 text-white hover:opacity-95 shadow-rose-500/25'
                    }`}
                  >
                    <span>{t("Continue", "المتابعة")}</span>
                    <ArrowRight className={`w-4 h-4 ${isRtl ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              </div>
            </motion.div>
          ) : (
            /* Unified Direct Auth Screen */
            <motion.div
              key="auth-flow"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="max-w-md mx-auto w-full bg-[#121524]/95 border border-slate-800 rounded-[28px] p-6 sm:p-8 shadow-2xl backdrop-blur-xl space-y-5"
            >
              {/* Header with Selected Path & Back Button */}
              <div className="flex items-center justify-between pb-1">
                <button
                  onClick={() => { setMode('path-selection'); setError(null); }}
                  className="inline-flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-white transition-colors"
                >
                  <ArrowLeft className={`w-3.5 h-3.5 ${isRtl ? 'rotate-180' : ''}`} />
                  <span>{t("Back", "رجوع")}</span>
                </button>

                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-slate-800/80 border border-slate-700 text-slate-300">
                  <span>{t("Path:", "المسار:")}</span>
                  <strong className={
                    accountPath === 'Normal' ? 'text-amber-400' : accountPath === 'Graduation Project' ? 'text-teal-400' : 'text-rose-400'
                  }>
                    {accountPath === 'Normal' && t('Normal', 'عادي')}
                    {accountPath === 'Graduation Project' && t('Graduation Project', 'مشروع تخرج')}
                    {accountPath === 'Special Needs' && `${t('Special Needs', 'احتياجات خاصة')} (${selectedDisability})`}
                  </strong>
                </div>
              </div>

              {mode === 'reset-password' ? (
                /* Reset Password View */
                <div className="space-y-4 text-start">
                  <div className="space-y-1">
                    <h2 className="text-xl font-black text-white tracking-tight">{t("Reset Password", "إعادة تعيين كلمة المرور")}</h2>
                    <p className="text-xs text-slate-400">{t("Enter your email to receive recovery instructions.", "أدخل بريدك الإلكتروني لإرسال رابط الاستعادة.")}</p>
                  </div>

                  {resetSuccess ? (
                    <div className="p-4 bg-teal-500/10 border border-teal-500/30 rounded-2xl text-teal-300 text-xs font-bold space-y-2">
                      <p>{t("Reset link sent! Please check your inbox.", "تم إرسال رابط إعادة التعيين! يرجى التحقق من بريدك.")}</p>
                      <button
                        onClick={() => { setMode('email-login'); setResetSuccess(false); setError(null); }}
                        className="block text-teal-400 hover:underline pt-2 font-black"
                      >
                        {t("Return to Sign In", "العودة لتسجيل الدخول")}
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleResetPassword} className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">{t("Email Address", "البريد الإلكتروني")}</label>
                        <input
                          type="email"
                          required
                          placeholder="name@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full bg-[#181C2E] border border-slate-700 text-white placeholder-slate-500 text-xs rounded-xl py-3 px-4 outline-none focus:border-rose-400"
                        />
                      </div>

                      {error && (
                        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-400 text-xs font-bold flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span>{error}</span>
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3.5 bg-gradient-to-r from-rose-500 to-pink-500 text-white font-black text-xs uppercase tracking-wider rounded-xl hover:opacity-95 transition-all shadow-lg shadow-rose-500/20 disabled:opacity-50"
                      >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t("Send Reset Link", "إرسال رابط الاستعادة")}
                      </button>
                    </form>
                  )}
                </div>
              ) : (
                /* Unified Tabs (Sign In / Create Account) */
                <div className="space-y-4 text-start">
                  <div className="space-y-1 text-center">
                    <h2 className="text-xl font-black text-white tracking-tight">
                      {mode === 'email-login' ? t("Welcome Back", "أهلاً بك مجدداً") : t("Create Your Profile", "إنشاء حسابك الجديد")}
                    </h2>
                    <p className="text-xs text-slate-400">
                      {mode === 'email-login'
                        ? t("Sign in to access your personalized mentor.", "سجّل دخولك للوصول إلى مساعدك الدراسي المخصص.")
                        : t("Get started with your tailored learning calibration.", "ابدأ رحلتك التعليمية المخصصة لمعايرتك.")}
                    </p>
                  </div>

                  {/* Tab Selector */}
                  <div className="grid grid-cols-2 gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl">
                    <button
                      type="button"
                      onClick={() => { setMode('email-login'); setError(null); }}
                      className={`py-2 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${
                        mode === 'email-login'
                          ? 'bg-slate-800 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {t("Sign In", "تسجيل الدخول")}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMode('email-register'); setError(null); }}
                      className={`py-2 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${
                        mode === 'email-register'
                          ? 'bg-slate-800 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {t("Create Account", "إنشاء حساب")}
                    </button>
                  </div>

                  {/* Form */}
                  <form onSubmit={handleManualAuth} className="space-y-3.5">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">{t("Email Address", "البريد الإلكتروني")}</label>
                      <div className="relative">
                        <Mail className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 ${isRtl ? 'right-3' : 'left-3'}`} />
                        <input
                          type="email"
                          required
                          placeholder="name@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className={`w-full bg-[#181C2E] border border-slate-700 text-white placeholder-slate-500 text-xs rounded-xl py-2.5 outline-none focus:border-rose-400 ${isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'}`}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">{t("Password", "كلمة المرور")}</label>
                      <div className="relative">
                        <Lock className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 ${isRtl ? 'right-3' : 'left-3'}`} />
                        <input
                          type={showPassword ? "text" : "password"}
                          required
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className={`w-full bg-[#181C2E] border border-slate-700 text-white placeholder-slate-500 text-xs rounded-xl py-2.5 outline-none focus:border-rose-400 ${isRtl ? 'pr-9 pl-9' : 'pl-9 pr-9'}`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className={`absolute top-1/2 -translate-y-1/2 text-slate-400 hover:text-white ${isRtl ? 'left-3' : 'right-3'}`}
                        >
                          {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {mode === 'email-register' && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="space-y-1"
                      >
                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">{t("Confirm Password", "تأكيد كلمة المرور")}</label>
                        <div className="relative">
                          <Lock className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 ${isRtl ? 'right-3' : 'left-3'}`} />
                          <input
                            type="password"
                            required
                            placeholder="••••••••"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className={`w-full bg-[#181C2E] border border-slate-700 text-white placeholder-slate-500 text-xs rounded-xl py-2.5 outline-none focus:border-rose-400 ${isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'}`}
                          />
                        </div>
                      </motion.div>
                    )}

                    {mode === 'email-login' && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => { setMode('reset-password'); setError(null); }}
                          className="text-[11px] font-bold text-rose-400 hover:underline"
                        >
                          {t("Forgot Password?", "نسيت كلمة المرور؟")}
                        </button>
                      </div>
                    )}

                    {error && (
                      <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs font-bold space-y-2">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span>{error}</span>
                        </div>
                        {showRedirectOption && (
                          <button
                            type="button"
                            onClick={handleGoogleRedirectAuth}
                            disabled={loading}
                            className="w-full py-2 px-3 bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.98]"
                          >
                            <Globe className="w-3.5 h-3.5" />
                            <span>{t("Click Here for Direct Google Sign-In", "اضغط هنا لتسجيل الدخول المباشر")}</span>
                          </button>
                        )}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-3.5 bg-gradient-to-r from-rose-500 via-pink-500 to-amber-500 text-white font-black text-xs uppercase tracking-wider rounded-xl hover:opacity-95 transition-all shadow-lg shadow-rose-500/20 disabled:opacity-50"
                    >
                      {loading ? (
                        <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                      ) : mode === 'email-login' ? (
                        t("Sign In", "تسجيل الدخول")
                      ) : (
                        t("Create Profile", "إنشاء الحساب")
                      )}
                    </button>
                  </form>

                  {/* Or Continue With Google */}
                  <div className="flex items-center gap-3 pt-1">
                    <div className="h-px bg-slate-800 flex-1" />
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("Or", "أو")}</span>
                    <div className="h-px bg-slate-800 flex-1" />
                  </div>

                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={handleGoogleAuth}
                      disabled={loading}
                      className="w-full h-11 flex items-center justify-center gap-2 bg-white text-slate-950 rounded-xl hover:bg-slate-100 transition-all font-black uppercase tracking-wider text-xs shadow-md disabled:opacity-50 active:scale-[0.98]"
                    >
                      {loading ? (
                        <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                      ) : (
                        <Chrome className="w-4 h-4 text-slate-950" />
                      )}
                      <span>{t("Continue with Google", "المتابعة عبر جوجل")}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleGoogleRedirectAuth}
                      disabled={loading}
                      className={`w-full py-2.5 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                        showRedirectOption
                          ? 'bg-rose-500/15 border-rose-500/40 text-rose-300 hover:bg-rose-500/25 shadow-sm'
                          : 'bg-slate-800/50 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      <Globe className="w-3.5 h-3.5 shrink-0" />
                      <span>{t("Direct Google Sign-In (No Popups)", "تسجيل جوجل المباشر (بدون نوافذ منبثقة)")}</span>
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto w-full text-center py-4 z-10">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
          <LockKeyhole className="w-3.5 h-3.5 text-slate-600" />
          <span>{t("Secure access · Firebase Auth", "تسجيل دخول آمن ومشفّر · Firebase Auth")}</span>
        </div>
      </footer>
    </div>
  );
}
