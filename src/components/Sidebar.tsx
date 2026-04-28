import { useState, useEffect } from "react";
import { UserProfile, CognitiveLevel, UserRole, Field, AccessibilityMode, ChatThread } from "../types";
import { User, Settings, Brain, Briefcase, GraduationCap, Accessibility, Layers, MessageSquare, BarChart3, AlertCircle, LogOut, Plus, ChevronRight, X, Moon, Sun, Video, Mic } from "lucide-react";
import { logout } from "../lib/firebase";
import { getTranslation } from "../lib/translations";

interface SidebarProps {
  profile: UserProfile;
  setProfile: (profile: UserProfile) => void;
  currentView: 'chat' | 'hub' | 'profile' | 'settings' | 'logic' | 'video' | 'disability';
  setCurrentView: (view: 'chat' | 'hub' | 'profile' | 'settings' | 'logic' | 'video' | 'disability') => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  openLiveCaptions: () => void;
}

export default function Sidebar({ profile, setProfile, currentView, setCurrentView, isDarkMode, toggleTheme, openLiveCaptions }: SidebarProps) {
  const handleChange = (key: keyof UserProfile, value: string) => {
    setProfile({ ...profile, [key]: value });
  };

  const startNewChat = () => {
    // Check if there's already a thread named New Chat (we can't check messages.length easily now)
    const existingNewChat = profile.chatThreads?.find(t => t.title === 'New Chat');
    if (existingNewChat) {
      setProfile({ ...profile, activeThreadId: existingNewChat.id });
      setCurrentView('chat');
      return;
    }

    const newThread: ChatThread = {
      id: Date.now().toString(),
      title: 'New Chat',
      updatedAt: new Date().toISOString()
    };
    
    const updatedThreads = [...(profile.chatThreads || []), newThread];
    setProfile({
      ...profile,
      chatThreads: updatedThreads,
      activeThreadId: newThread.id
    });
    setCurrentView('chat');
  };

  const switchThread = (threadId: string) => {
    setProfile({ ...profile, activeThreadId: threadId });
    setCurrentView('chat');
  };

    const navItems = [
    { id: 'chat', label: getTranslation(profile.language, 'chatSession'), icon: MessageSquare },
    { id: 'hub', label: getTranslation(profile.language, 'dashboard'), icon: BarChart3 },
    { id: 'logic', label: getTranslation(profile.language, 'logicTraining'), icon: Brain },
    { id: 'profile', label: getTranslation(profile.language, 'myProfile'), icon: User },
    { id: 'settings', label: getTranslation(profile.language, 'settings'), icon: Settings },
  ] as const;

  const isAdmin = ['pro.mahmoud.h@gmail.com', 'modyhashim2006@gmail.com'].includes(profile.email?.toLowerCase() || '');

  return (
    <div className="w-[300px] h-full bg-white text-text-main border-e border-slate-100 p-8 flex flex-col gap-6 overflow-y-auto custom-scrollbar shadow-sm z-20">
      <div className="flex items-center gap-4 mb-2">
        <div className="p-3 bg-slate-900 rounded-2xl shadow-xl shadow-slate-200">
          <Layers className="w-6 h-6 text-white" />
        </div>
        <h1 className="text-2xl font-black tracking-tighter text-slate-900 uppercase leading-none">Cognify<br/><span className="text-[10px] text-primary tracking-widest italic">C.O.G.N.I.F.Y</span></h1>
      </div>

      <button 
        onClick={startNewChat}
        className="w-full flex items-center justify-center gap-2 py-4 bg-primary text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-lg shadow-primary/20 hover:shadow-none active:scale-95"
      >
        <Plus className="w-4 h-4" /> {getTranslation(profile.language, 'newThread')}
      </button>

      <div className="flex flex-col gap-6">
        <nav className="flex flex-col gap-1.5">
          <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1 ms-2">{getTranslation(profile.language, 'mainNavigation')}</div>
          {navItems.map((item) => (
            <button 
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              className={`flex items-center gap-3 px-5 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all ${currentView === item.id ? 'bg-slate-900 text-white shadow-xl shadow-slate-200' : 'text-slate-400 hover:text-slate-900 hover:bg-slate-50'}`}
            >
              <item.icon className={`w-3.5 h-3.5 ${currentView === item.id ? 'text-primary' : ''}`} /> {item.label}
            </button>
          ))}
        </nav>

        {(profile.chatThreads?.length || 0) > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between mb-1 ms-2 me-2">
              <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{getTranslation(profile.language, 'chatHistory')}</div>
              <button 
                onClick={() => setProfile({ ...profile, chatThreads: [], activeThreadId: undefined })}
                className="text-[9px] font-bold text-rose-400 hover:text-rose-600 transition-colors uppercase tracking-widest"
                title="Clear all chats"
              >
                {getTranslation(profile.language, 'clearAll')}
              </button>
            </div>
            <div className="flex flex-col gap-1 max-h-[160px] overflow-y-auto custom-scrollbar pr-2">
              {profile.chatThreads?.slice().reverse().map((t) => {
                const snippet = t.lastMessageSnippet || 'No messages yet';
                
                return (
                  <div key={t.id} className={`flex items-center justify-between gap-1 px-4 py-2 rounded-xl text-[10px] font-bold text-left transition-all group ${profile.activeThreadId === t.id ? 'bg-primary/5 border border-primary text-primary' : 'text-slate-500 hover:bg-slate-50 border border-transparent'}`}>
                    <button
                      onClick={() => switchThread(t.id)}
                      className="flex flex-col flex-1 py-1 text-left overflow-hidden min-w-0"
                    >
                      <span className="truncate w-full font-bold">{t.title}</span>
                      <span className="truncate w-full text-[9px] opacity-70 mt-0.5 font-normal">
                        {snippet}
                      </span>
                    </button>
                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          const updatedThreads = profile.chatThreads?.filter(thread => thread.id !== t.id) || [];
                          setProfile({ ...profile, chatThreads: updatedThreads, activeThreadId: updatedThreads.length > 0 ? updatedThreads[updatedThreads.length - 1].id : undefined });
                        }}
                        className="p-1.5 hover:bg-rose-100 hover:text-rose-600 rounded-md transition-colors"
                        title="Delete Chat"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    {profile.activeThreadId === t.id && <ChevronRight className={`w-3 h-3 flex-shrink-0 ms-1 ${profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya' ? 'rotate-180' : ''}`} />}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
         <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1 ms-2">{getTranslation(profile.language, 'features')}</div>
         <div className="px-5 py-4 rounded-2xl bg-slate-50 border border-slate-100 relative group overflow-hidden">
           <div className="relative z-10">
             <p className="text-[10px] font-black text-slate-900 uppercase tracking-widest mb-1 group-hover:text-primary transition-colors">Graduation Project</p>
             <p className="text-[9px] text-slate-400 font-bold italic">Coming Soon</p>
           </div>
           <div className="absolute right-[-10px] bottom-[-10px] opacity-5">
             <GraduationCap className="w-16 h-16 text-slate-900" />
           </div>
         </div>
         
         <button 
           onClick={() => setCurrentView('disability')}
           className={`px-5 py-4 rounded-2xl bg-slate-50 border transition-all relative group overflow-hidden ${currentView === 'disability' ? 'border-primary ring-1 ring-primary/20 shadow-md shadow-primary/10' : 'border-slate-100 hover:border-primary/30 active:scale-[0.98]'}`}
         >
           <div className="relative z-10 text-left">
             <p className={`text-[10px] font-black uppercase tracking-widest mb-1 transition-colors ${currentView === 'disability' ? 'text-primary' : 'text-slate-900 group-hover:text-amber-600'}`}>Disability Mode</p>
             <p className={`text-[9px] font-bold ${currentView === 'disability' ? 'text-primary' : 'text-slate-500'}`}>Full Accessibility Suite</p>
           </div>
           <div className={`absolute right-[-10px] bottom-[-10px] opacity-5 transition-transform group-hover:scale-110 ${currentView === 'disability' ? 'opacity-10 text-primary' : 'text-slate-900'}`}>
             <Accessibility className="w-16 h-16" />
           </div>
         </button>
      </div>

      <div className="bg-white border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200">
            {profile.photoURL ? (
              <img src={profile.photoURL} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <User className="w-4 h-4 text-slate-400" />
            )}
          </div>
          <div className="truncate">
            <p className="text-[10px] uppercase font-bold text-slate-400">User Account</p>
            <p className="text-xs font-bold text-text-main truncate">{profile.email || 'Initializing...'}</p>
          </div>
        </div>
        <div className="pt-2 border-t border-slate-50">
          <p className="text-[10px] uppercase font-bold text-slate-400">Institution</p>
          <div className="space-y-0.5">
            <p className="text-xs font-bold text-text-main">{profile.role === 'Student' ? profile.university : profile.work || 'Main Account'}</p>
            <p className="text-[10px] text-text-muted">{profile.role === 'Student' ? profile.faculty : profile.jobTitle}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">{getTranslation(profile.language, 'academicProfile')}</span>
          <div className={`flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border ${isAdmin ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-amber-600 bg-amber-50 border-amber-100'}`}>
            <AlertCircle className="w-3 h-3" /> {isAdmin ? 'ADMIN' : 'LOCKED'}
          </div>
        </div>
        
        <div className="flex flex-col gap-3">
          <label className="text-[11px] font-bold text-text-muted uppercase">{getTranslation(profile.language, 'difficultyLevel')}</label>
          <div className="grid grid-cols-1 gap-1.5 opacity-80">
            {(['Basic', 'Intermediate', 'Advanced'] as CognitiveLevel[]).map((l) => (
              <button
                key={l}
                disabled={!isAdmin}
                onClick={() => isAdmin && handleChange('level', l)}
                className={`text-left px-4 py-2 rounded-lg text-sm border transition-all ${isAdmin ? 'cursor-pointer hover:border-primary/30' : 'cursor-not-allowed'} ${
                  profile.level === l 
                    ? 'bg-primary/5 border-primary text-primary font-bold' 
                    : 'bg-white border-border text-text-muted'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <p className="text-[9px] text-slate-400 italic font-medium -mt-1 px-1">
            {isAdmin ? 'Admin override active.' : 'Recalibration available every 30 terrestrial days.'}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">{getTranslation(profile.language, 'accountDetails')}</span>
          <div className={`flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border ${isAdmin ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-amber-600 bg-amber-50 border-amber-100'}`}>
            <AlertCircle className="w-3 h-3" /> {isAdmin ? "ADMIN CONTROL" : "VERIFIED"}
          </div>
        </div>
        
        <div className="flex flex-col gap-2">
          <label className="text-[11px] font-bold text-text-muted uppercase">{getTranslation(profile.language, 'userRole')}</label>
          <div className="flex gap-2 opacity-80">
            {(['Student', 'Professional'] as UserRole[]).map((r) => (
              <button
                key={r}
                disabled={!isAdmin}
                onClick={() => isAdmin && handleChange('role', r)}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all ${isAdmin ? 'cursor-pointer hover:border-primary/30' : 'cursor-not-allowed'} ${
                  profile.role === r 
                    ? 'bg-primary/5 border-primary text-primary font-bold' 
                    : 'bg-white border-border text-text-muted'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <p className="text-[9px] text-slate-400 italic font-medium -mt-1 px-1">
            {isAdmin ? 'Admin role override active.' : 'Identity validation required for role modification.'}
          </p>
        </div>

        <div className="flex flex-col gap-3 mt-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{getTranslation(profile.language, 'language')}</label>
          <select
            value={profile.language || 'English'}
            onChange={(e) => handleChange('language', e.target.value)}
            className="bg-slate-50 border border-slate-100 text-slate-900 rounded-xl px-4 py-3 text-xs font-bold focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none appearance-none cursor-pointer"
          >
            {['English', 'Arabic', 'Egyptian Ammiya', 'French', 'Spanish', 'German', 'Italian', 'Portuguese', 'Russian', 'Chinese', 'Japanese'].map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
      </div>



      <div className="mt-auto pt-6 flex flex-col gap-3">
        <button
          onClick={toggleTheme}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-black text-slate-700 bg-slate-50 border border-slate-100 hover:bg-slate-100 transition-all uppercase tracking-widest dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800 dark:hover:bg-slate-800"
        >
          <span className="flex items-center gap-2">
            {isDarkMode ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-slate-500" />} 
            Theme
          </span>
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            {isDarkMode ? 'DARK' : 'LIGHT'}
          </span>
        </button>

        <button
          onClick={openLiveCaptions}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-[17px] border border-[#443158] text-xs font-black text-primary bg-slate-900 transition-all active:scale-95 uppercase tracking-widest shadow-xl"
        >
          <Mic className="w-4 h-4" /> Live Captions
        </button>

        <button
          onClick={() => logout()}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-black text-rose-600 bg-rose-50 border border-rose-100 hover:bg-rose-100 transition-all active:scale-95 uppercase tracking-widest"
        >
          <LogOut className="w-4 h-4" /> {getTranslation(profile.language, 'logout')}
        </button>

        <div className="text-slate-500 text-[10px] uppercase tracking-[0.2em] font-bold">
          Cognify Engine v2.0
        </div>
      </div>
    </div>
  );
}
