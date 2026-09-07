import { localize } from '../lib/translations';
import { useState } from "react";
import { UserProfile, CognitiveLevel, UserRole, ChatThread } from "../types";
import { User, Settings, GraduationCap, Accessibility, LifeBuoy, MessageSquare, BarChart3, AlertCircle, LogOut, Plus, ChevronRight, X, Moon, Sun, Mic, Target, Calculator, CalendarCheck, LayoutDashboard, CalendarDays, Sparkles, Brain, Building2, Flame } from "lucide-react";
import { logout, db } from "../lib/firebase";
import { deleteDoc, doc } from "firebase/firestore";
import { getTranslation } from "../lib/translations";
import { isAdminUser } from "../lib/roles";
import { visibleAcademicSections } from "../lib/academics";
import { isAccessibilityUser, AppView } from "../lib/access";

interface SidebarProps {
  profile: UserProfile;
  setProfile: (profile: UserProfile) => void;
  currentView: AppView;
  setCurrentView: (view: AppView) => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  openLiveCaptions: () => void;
}

// Cognify "constellation" logomark (from Cognify Redesign v2).
const Logo = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none">
    <circle cx="6.5" cy="7" r="2.1" fill="currentColor" />
    <circle cx="17" cy="6" r="2.1" fill="currentColor" opacity="0.85" />
    <circle cx="13" cy="17.5" r="2.1" fill="currentColor" opacity="0.7" />
    <path d="M8 8 12 16M8.4 6.7 15 6.1M15.4 7.6 13.4 15.6" stroke="currentColor" strokeWidth="1.25" opacity="0.5" />
  </svg>
);

export default function Sidebar({ profile, setProfile, currentView, setCurrentView, isDarkMode, toggleTheme, openLiveCaptions }: SidebarProps) {
  const handleChange = (key: keyof UserProfile, value: string) => setProfile({ ...profile, [key]: value });
  const isAr = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';

  const startNewChat = () => {
    const existingNewChat = profile.chatThreads?.find((t) => t.title === 'New Chat' && !t.lastMessageSnippet);
    if (existingNewChat) {
      setProfile({ ...profile, activeThreadId: existingNewChat.id });
      setCurrentView('chat');
      return;
    }
    const newThread: ChatThread = { id: Date.now().toString(), title: 'New Chat', updatedAt: new Date().toISOString() };
    setProfile({ ...profile, chatThreads: [...(profile.chatThreads || []), newThread], activeThreadId: newThread.id });
    setCurrentView('chat');
  };

  const switchThread = (threadId: string) => {
    setProfile({ ...profile, activeThreadId: threadId });
    setCurrentView('chat');
  };

  const primaryItems = [
    { id: 'chat', label: getTranslation(profile.language, 'chatSession'), icon: MessageSquare },
    { id: 'learning', label: localize(profile.language, 'Learning Hub', 'مركز التعلّم الذكي'), icon: Sparkles },
  ] as const;

  // Academic sections shown depend on the user's education level (University
  // gets the full set; school & professional get a lighter, relevant set).
  const allAcademicItems = [
    { id: 'goals', label: localize(profile.language, 'Goals', 'الأهداف'), icon: Target },
    { id: 'gpa', label: localize(profile.language, 'GPA', 'حاسبة GPA'), icon: Calculator },
    { id: 'analytics', label: localize(profile.language, 'Analytics', 'تحليلاتي'), icon: LayoutDashboard },
    { id: 'planner', label: localize(profile.language, 'Planner', 'المخطّط'), icon: CalendarDays },
  ] as const;
  const visibleSections = visibleAcademicSections(profile.educationLevel);
  const academicItems = allAcademicItems.filter((i) => visibleSections.includes(i.id as any));

  // Admins (incl. runtime-promoted) and super admins see the dashboard link;
  // normal users never do.
  const isAdmin = isAdminUser(profile);

  // Accessibility (Special Needs) users live in their own isolated world: they
  // must not even SEE the normal experience's navigation (chat, dashboard,
  // academics, new-chat). Admins bypass so they can inspect everything.
  const a11yOnly = isAccessibilityUser(profile) && !isAdmin;

  const academicIds = academicItems.map((i) => i.id) as readonly string[];
  const [academicsOpen, setAcademicsOpen] = useState(academicIds.includes(currentView));

  // navbtn (v2): muted by default; active = violet-soft pill with violet text/icon.
  const navBtn = (active: boolean) =>
    `flex items-center gap-3 w-full px-3 h-[38px] rounded-[10px] text-[13.5px] font-medium text-start transition-colors ${
      active ? 'bg-primary-soft text-primary' : 'text-text-muted hover:bg-surface-3 hover:text-text-main'
    }`;
  const navIcon = (_active: boolean) => `w-[18px] h-[18px] shrink-0`;

  const userInitial = (profile.name || profile.email || 'U').trim().charAt(0).toUpperCase();

  return (
    <div className="w-[284px] h-full shrink-0 bg-bg-card text-text-main border-e border-border flex flex-col px-[18px] py-[22px]">
      {/* Brand */}
      <div className="flex items-center gap-3 px-1.5 pb-1">
        <div className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center text-white shrink-0" style={{ background: 'linear-gradient(140deg,#8b6dff,#5b3df5)', boxShadow: '0 4px 12px -4px rgba(91,61,245,0.6)' }}>
          <Logo className="w-[19px] h-[19px]" />
        </div>
        <div className="leading-none">
          <div className="font-serif text-[23px] font-normal text-text-main">Cognify</div>
          <div className="text-[11px] text-faint font-medium mt-0.5">{localize(profile.language, 'AI study mentor', 'مدرّسك الذكي')}</div>
        </div>
      </div>

      {/* New chat — hidden for accessibility-only users (their chat lives inside the Accessibility Center) */}
      {!a11yOnly && (
        <button
          onClick={startNewChat}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-[14px] bg-primary text-white font-semibold text-sm shadow-sm hover:bg-primary-press transition-colors active:scale-[0.98]"
        >
          <Plus className="w-[17px] h-[17px]" /> {getTranslation(profile.language, 'newThread')}
        </button>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto custom-scrollbar -mx-1 my-[18px] px-1 flex flex-col gap-[3px]">
        <div className="text-[11px] font-bold text-faint tracking-wide px-3 pt-1.5 pb-1 uppercase">{getTranslation(profile.language, 'mainNavigation')}</div>

        {/* Normal-experience navigation — completely hidden from accessibility-only
            users so their world is ONLY the Accessibility Center + account pages. */}
        {!a11yOnly && primaryItems.map((item) => {
          const active = currentView === item.id;
          return (
            <button key={item.id} onClick={() => setCurrentView(item.id as any)} className={navBtn(active)}>
              <item.icon className={navIcon(active)} /> {item.label}
            </button>
          );
        })}

        {/* Academics group */}
        {!a11yOnly && (
          <>
            <button
              onClick={() => setAcademicsOpen((v) => !v)}
              className={navBtn(academicIds.includes(currentView) && !academicsOpen) + ' justify-between'}
            >
              <span className="flex items-center gap-3"><GraduationCap className={navIcon(false)} /> {localize(profile.language, 'Academics', 'الأكاديميات')}</span>
              <ChevronRight className={`w-4 h-4 transition-transform ${academicsOpen ? 'rotate-90' : (localize(profile.language, '', 'rotate-180'))}`} />
            </button>
            {academicsOpen && (
              <div className="flex flex-col gap-[3px] ms-3 ps-2 border-s border-border">
                {academicItems.map((item) => {
                  const active = currentView === item.id;
                  return (
                    <button key={item.id} onClick={() => setCurrentView(item.id as any)} className={navBtn(active)}>
                      <item.icon className={navIcon(active)} /> {item.label}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Cognify Memory */}
        <button onClick={() => setCurrentView('memory')} className={navBtn(currentView === 'memory')}>
          <Brain className={navIcon(currentView === 'memory')} />
          {localize(profile.language, 'Cognify Memory', 'ذاكرة كوجنيفي')}
        </button>

        {/* Phase 4: Cognitive Gym */}
        <button onClick={() => setCurrentView('gym')} className={navBtn(currentView === 'gym')}>
          <Flame className={navIcon(currentView === 'gym')} />
          {localize(profile.language, 'Cognitive Gym', 'الجيم المعرفي')}
        </button>

        {/* France Travel & Voice Assistant */}
        <button onClick={() => setCurrentView('france')} className={navBtn(currentView === 'france') + ' relative'}>
          <span className="w-[18px] h-[18px] shrink-0 flex items-center justify-center text-sm leading-none">🇫🇷</span>
          {localize(profile.language, 'France Travel Voice', 'مساعد السفر لفرنسا')}
          <span className="ms-auto text-[10px] font-bold text-amber-500 bg-amber-500/10 px-[7px] py-[3px] rounded-full">FR</span>
        </button>

        {/* Phase 7: Institution Cohorts Hub */}
        {(isAdmin || profile.isOrgManager === true) && (
          <button onClick={() => setCurrentView('institution')} className={navBtn(currentView === 'institution')}>
            <Building2 className={navIcon(currentView === 'institution')} />
            {localize(profile.language, 'Institution Cohorts', 'شؤون المؤسسة')}
          </button>
        )}

        {/* Accessibility — for accessibility users (Special Needs path or a real
            mode), admins (inspect everything), and org managers (their org
            dashboard lives inside the hub). */}
        {(isAccessibilityUser(profile) || isAdmin || profile.isOrgManager === true) && (
          <button onClick={() => setCurrentView('disability')} className={navBtn(currentView === 'disability') + ' relative'}>
            <Accessibility className={navIcon(currentView === 'disability')} />
            {localize(profile.language, 'Accessibility', 'الإتاحة')}
            <span className="ms-auto text-[10px] font-bold text-primary bg-primary-soft px-[7px] py-[3px] rounded-full">{localize(profile.language, 'Live', 'مباشر')}</span>
          </button>
        )}

        {/* Support */}
        <button onClick={() => setCurrentView('support')} className={navBtn(currentView === 'support')}>
          <LifeBuoy className={navIcon(currentView === 'support')} />
          {localize(profile.language, 'Support', 'الدعم')}
        </button>

        {/* Admin */}
        {isAdmin && (
          <button onClick={() => setCurrentView('admin')} className={navBtn(currentView === 'admin') + ' relative'}>
            <AlertCircle className={navIcon(currentView === 'admin')} />
            {localize(profile.language, 'Admin', 'الأدمن')}
            <span className="ms-auto text-[10px] font-bold text-text-muted bg-surface-3 px-[7px] py-[3px] rounded-full">{localize(profile.language, 'Staff', 'مقيّد')}</span>
          </button>
        )}


        {/* Recent threads — hidden for accessibility users: switchThread() ends in
            setCurrentView('chat'), which they can't access, so the access guard
            bounces them straight back to #disability. That made every row a dead
            control, and "Clear all" worse than dead (it really does delete the
            threads powering the chat they're using). */}
        {!a11yOnly && (profile.chatThreads?.length || 0) > 0 && (
          <>
            <div className="flex items-center justify-between px-3 pt-4 pb-1">
              <span className="text-[11px] font-bold text-faint tracking-wide uppercase">{getTranslation(profile.language, 'chatHistory')}</span>
              <button
                onClick={() => {
                  const threadsToDelete = profile.chatThreads || [];
                  setProfile({ ...profile, chatThreads: [], activeThreadId: undefined });
                  if (profile.uid) threadsToDelete.forEach((thread) => deleteDoc(doc(db, `users/${profile.uid}/threads/${thread.id}`)).catch((e) => console.error(e)));
                }}
                className="text-[10px] font-bold text-danger/70 hover:text-danger transition-colors"
                title="Clear all chats"
              >
                {getTranslation(profile.language, 'clearAll')}
              </button>
            </div>
            {profile.chatThreads?.slice().reverse().map((t) => {
              const active = profile.activeThreadId === t.id;
              return (
                <div key={t.id} className={`group flex items-center gap-1 rounded-[11px] transition-colors ${active ? 'bg-surface-3' : 'hover:bg-surface-3'}`}>
                  <button onClick={() => switchThread(t.id)} className="flex flex-col flex-1 items-start gap-0.5 px-3 py-[9px] text-start overflow-hidden min-w-0">
                    <span className="text-[13.5px] font-semibold text-text-main truncate w-full max-w-[200px]">{t.title}</span>
                    <span className="text-[11.5px] text-faint truncate w-full max-w-[200px]">{t.lastMessageSnippet || (localize(profile.language, 'No messages yet', 'لا رسائل بعد'))}</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const updated = profile.chatThreads?.filter((th) => th.id !== t.id) || [];
                      // Only move the active thread if THIS (the deleted) one was active;
                      // deleting a different thread must not yank the user out of the
                      // conversation they're currently reading.
                      const nextActive = t.id === profile.activeThreadId
                        ? (updated.length ? updated[updated.length - 1].id : undefined)
                        : profile.activeThreadId;
                      setProfile({ ...profile, chatThreads: updated, activeThreadId: nextActive });
                      if (profile.uid) deleteDoc(doc(db, `users/${profile.uid}/threads/${t.id}`)).catch((er) => console.error(er));
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 me-1 text-faint hover:text-danger rounded-md transition-all"
                    title={localize(profile.language, 'Delete chat', 'حذف المحادثة')}
                    aria-label={localize(profile.language, 'Delete chat', 'حذف المحادثة')}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </>
        )}
      </nav>

      {/* Admin-only level/role override (kept for the 7 staff accounts) */}
      {isAdmin && (
        <div className="flex flex-col gap-2 pb-3 border-t border-border pt-3">
          <div className="flex gap-1.5">
            {(['Basic', 'Intermediate', 'Advanced'] as CognitiveLevel[]).map((l) => (
              <button key={l} onClick={() => handleChange('level', l)} className={`flex-1 px-2 py-1.5 rounded-[9px] text-[11px] font-semibold border transition-colors ${profile.level === l ? 'bg-primary-soft border-primary text-primary' : 'bg-surface-2 border-border text-text-muted hover:border-border-2'}`}>{l[0]}</button>
            ))}
            {(['Student', 'Professional'] as UserRole[]).map((r) => (
              <button key={r} onClick={() => handleChange('role', r)} className={`flex-1 px-2 py-1.5 rounded-[9px] text-[11px] font-semibold border transition-colors ${profile.role === r ? 'bg-primary-soft border-primary text-primary' : 'bg-surface-2 border-border text-text-muted hover:border-border-2'}`}>{r[0]}</button>
            ))}
          </div>
        </div>
      )}

      {/* Footer: theme + language, profile chip, captions + logout */}
      <div className="border-t border-border pt-3 flex flex-col gap-2">
        <div className="flex gap-[7px]">
          <button onClick={toggleTheme} className="flex-1 flex items-center justify-center gap-[7px] py-[9px] rounded-[11px] border border-border bg-surface-2 text-text-main text-[12.5px] font-semibold hover:bg-surface-3 transition-colors">
            {isDarkMode ? <Sun className="w-[15px] h-[15px] text-accent" /> : <Moon className="w-[15px] h-[15px]" />}
            {isDarkMode ? (localize(profile.language, 'Light', 'فاتح')) : (localize(profile.language, 'Dark', 'داكن'))}
          </button>
          <div className="flex-1 relative">
            <select
              value={profile.language || 'English'}
              onChange={(e) => handleChange('language', e.target.value)}
              className="w-full h-full appearance-none cursor-pointer text-center py-[9px] rounded-[11px] border border-border bg-surface-2 text-text-main text-[12.5px] font-semibold hover:bg-surface-3 transition-colors outline-none focus:border-primary"
            >
              {['English', 'Arabic', 'Egyptian Ammiya', 'French', 'Spanish'].map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
        </div>

        <button onClick={() => setCurrentView('profile')} className={`flex items-center gap-[10px] w-full px-[10px] py-2 rounded-[13px] border bg-surface-2 text-start transition-colors hover:bg-surface-3 ${currentView === 'profile' ? 'border-primary' : 'border-border'}`}>
          <div className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center text-white font-bold text-sm font-display shrink-0 overflow-hidden" style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))' }}>
            {profile.photoURL ? <img src={profile.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : userInitial}
          </div>
          <div className="leading-tight overflow-hidden flex-1">
            <div className="text-[13.5px] font-bold text-text-main truncate">{profile.name || profile.email?.split('@')[0] || 'User'}</div>
            <div className="text-[11.5px] text-text-muted truncate">{profile.role === 'Student' ? (profile.university || 'Student') : (profile.work || 'Professional')}</div>
          </div>
          <Settings className="w-4 h-4 text-faint shrink-0" />
        </button>

        <div className="flex gap-[7px]">
          <button onClick={openLiveCaptions} className="flex-1 flex items-center justify-center gap-2 py-[9px] rounded-[11px] border border-border bg-surface-2 text-text-main text-[12.5px] font-semibold hover:bg-surface-3 transition-colors">
            <Mic className="w-[15px] h-[15px] text-primary" /> {localize(profile.language, 'Captions', 'الكابشن')}
          </button>
          <button onClick={() => logout()} className="flex items-center justify-center gap-2 px-3 py-[9px] rounded-[11px] border border-border bg-surface-2 text-danger text-[12.5px] font-semibold hover:bg-danger-soft transition-colors" title={getTranslation(profile.language, 'logout')} aria-label={getTranslation(profile.language, 'logout')}>
            <LogOut className="w-[15px] h-[15px]" />
          </button>
        </div>
      </div>
    </div>
  );
}
