import { localize } from '../lib/translations';
import React, { useState } from 'react';
import { UserProfile, EducationLevel } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { User, Mail, Shield, Award, Languages, Globe, BookOpen, GraduationCap, Briefcase, MapPin, Calendar, Clock, MessageSquare, Edit3, Save, X, Camera, Eye, Brain as BrainIcon, Menu, Sprout, Heart, ThumbsUp, ThumbsDown, Loader2, ArrowLeft } from 'lucide-react';
import { formatDate } from '../lib/utils';
import { doc, setDoc, collection, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, cleanDataForFirestore } from '../lib/firebase';
import { getTranslation } from '../lib/translations';

interface ProfilePageProps {
  profile: UserProfile;
  onMenuClick?: () => void;
  setProfile?: (profile: UserProfile) => void;
  onNavigateBack?: () => void;
}

const SUSTAINABILITY_GOALS = [
  { id: 'climate', label: 'Climate Action', icon: Globe },
  { id: 'health', label: 'Good Health & Well-being', icon: Heart },
  { id: 'quality-edu', label: 'Quality Education', icon: GraduationCap },
  { id: 'zero-hunger', label: 'Zero Hunger / Sustainable Food', icon: Sprout }
];

export default function ProfilePage({ profile, onMenuClick, setProfile, onNavigateBack }: ProfilePageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedProfile, setEditedProfile] = useState<UserProfile>(profile);
  const [saving, setSaving] = useState(false);

  const [feedbackStats, setFeedbackStats] = useState<{
    upvotes: number;
    downvotes: number;
    helpfulSnippets: string[];
    improvementSnippets: string[];
    loading: boolean;
  }>({
    upvotes: 0,
    downvotes: 0,
    helpfulSnippets: [],
    improvementSnippets: [],
    loading: true
  });

  React.useEffect(() => {
    if (!profile.uid) return;
    let isActive = true;

    const fetchFeedback = async () => {
      try {
        let up = 0;
        let down = 0;
        const helpful: string[] = [];
        const improvement: string[] = [];

        // 1. Fetch from Chat Threads
        const threadsRef = collection(db, `users/${profile.uid}/threads`);
        const threadsSnap = await getDocs(threadsRef);
        threadsSnap.forEach(docSnap => {
          const messagesData = docSnap.data().messages || [];
          messagesData.forEach((m: any) => {
            if (m.role === 'assistant') {
              if (m.reaction === 'up') {
                up++;
                if (helpful.length < 5 && m.content) {
                  helpful.push(m.content);
                }
              } else if (m.reaction === 'down') {
                down++;
                if (improvement.length < 5 && m.content) {
                  improvement.push(m.content);
                }
              }
            }
          });
        });

        // 2. Fetch from Sandbox Modules
        const sandboxRef = collection(db, `users/${profile.uid}/sandbox`);
        const sandboxSnap = await getDocs(sandboxRef);
        sandboxSnap.forEach(docSnap => {
          const messagesData = docSnap.data().messages || [];
          messagesData.forEach((m: any) => {
            if (m.role === 'assistant') {
              if (m.reaction === 'up') {
                up++;
                if (helpful.length < 5 && m.content) {
                  helpful.push(m.content);
                }
              } else if (m.reaction === 'down') {
                down++;
                if (improvement.length < 5 && m.content) {
                  improvement.push(m.content);
                }
              }
            }
          });
        });

        if (isActive) {
          setFeedbackStats({
            upvotes: up,
            downvotes: down,
            helpfulSnippets: helpful,
            improvementSnippets: improvement,
            loading: false
          });
        }
      } catch (err) {
        console.error("Error fetching feedback on profile: ", err);
        if (isActive) {
          setFeedbackStats(prev => ({ ...prev, loading: false }));
        }
      }
    };

    fetchFeedback();

    return () => {
      isActive = false;
    };
  }, [profile.uid]);

  const stats = [
    { label: 'Cognitive Level', value: profile.level, icon: BrainIcon },
    { label: 'Uplink Integrity', value: `${profile.iqScore || 0}%`, icon: Award },
    { label: 'Merit Index', value: profile.points, icon: Shield },
    { label: 'Sessions', value: profile.chatThreads?.length || 0, icon: Clock },
  ];

  const handleSave = async () => {
    setSaving(true);
    const path = `users/${profile.uid}`;
    try {
      const cleaned = cleanDataForFirestore(editedProfile);
      if (setProfile) setProfile(cleaned);
      await setDoc(doc(db, path), cleaned, { merge: true });
      setIsEditing(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key: keyof UserProfile, value: any) => {
    setEditedProfile(prev => ({ ...prev, [key]: value }));
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Resize image to prevent Firestore 1MB limit errors
    const resizeImage = (file: File): Promise<string> => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
          const img = new Image();
          img.src = event.target?.result as string;
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 256;
            const MAX_HEIGHT = 256;
            let width = img.width;
            let height = img.height;

            if (width > height) {
              if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
              }
            } else {
              if (height > MAX_HEIGHT) {
                width *= MAX_HEIGHT / height;
                height = MAX_HEIGHT;
              }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.8));
          };
        };
      });
    };

    const base64 = await resizeImage(file);
    setEditedProfile(prev => ({ ...prev, photoURL: base64 }));
  };

  const currentGoal = SUSTAINABILITY_GOALS.find(g => g.id === (isEditing ? editedProfile.sustainabilityGoal : profile.sustainabilityGoal)) || SUSTAINABILITY_GOALS[1];

  return (
    <div className="flex-1 h-screen overflow-y-auto bg-bg-main p-6 md:p-10 flex flex-col gap-6 md:gap-10 custom-scrollbar relative">
      <header className="flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div className="flex items-start gap-4 space-y-2">
          {onNavigateBack && (
            <button
              onClick={onNavigateBack}
              className="p-2 mt-1 text-text-muted hover:text-text-main bg-bg-card shadow-sm border border-border hover:bg-surface-2 rounded-xl active:scale-95 transition-all flex items-center gap-1.5 shrink-0"
              title={localize(profile.language, 'Back to Assistant', 'العودة للمساعد')}
            >
              <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
              <span className="text-xs font-bold hidden sm:inline">{localize(profile.language, 'Back', 'رجوع')}</span>
            </button>
          )}
          {onMenuClick && (
            <button 
              onClick={onMenuClick}
              className="p-2 mt-1 text-text-muted bg-bg-card shadow-sm border border-border hover:bg-bg-main rounded-lg active:scale-95 shrink-0"
              aria-label={localize(profile.language, 'Toggle menu', 'القائمة')}
              title={localize(profile.language, 'Open Menu', 'فتح القائمة')}
            >
              <Menu className="w-6 h-6" />
            </button>
          )}
          <div>
            <h1 className="text-2xl md:text-4xl font-black text-text-main tracking-tighter uppercase">{getTranslation(profile.language, 'myProfile')}</h1>
            <p className="text-xs md:text-sm text-text-muted font-medium mt-1">Manage your academic and account details.</p>
          </div>
        </div>
        {!isEditing ? (
          <button 
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-2 px-6 py-3 bg-bg-card border border-border rounded-2xl text-text-main font-black text-xs uppercase tracking-widest hover:border-primary hover:text-primary transition-all shadow-sm"
          >
            <Edit3 className="w-4 h-4" /> {getTranslation(profile.language, 'edit')}
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button 
              onClick={() => { setIsEditing(false); setEditedProfile(profile); }}
              className="flex items-center gap-2 px-6 py-3 bg-bg-card border border-border rounded-2xl text-faint font-black text-xs uppercase tracking-widest hover:text-text-muted transition-all"
            >
              <X className="w-4 h-4" /> {getTranslation(profile.language, 'back')}
            </button>
            <button 
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-xl shadow-slate-200 disabled:opacity-50"
            >
              <Save className="w-4 h-4" /> {saving ? (localize(profile.language, 'Saving...', 'جاري الحفظ...')) : getTranslation(profile.language, 'saveChanges')}
            </button>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 pb-20">
        {/* Left Side: Avatar & Basic Info */}
        <div className="xl:col-span-1 space-y-8">
          <div className="bg-bg-card p-8 rounded-[40px] border border-border shadow-sm flex flex-col items-center text-center">
            <div className="w-32 h-32 rounded-[48px] bg-slate-900 flex items-center justify-center mb-6 shadow-xl shadow-slate-200 relative group overflow-hidden border-4 border-white">
              {editedProfile.photoURL || profile.photoURL ? (
                <img 
                  src={isEditing ? editedProfile.photoURL : profile.photoURL} 
                  alt="Avatar" 
                  className="w-full h-full object-cover" 
                  referrerPolicy="no-referrer"
                />
              ) : (
                <User className="w-12 h-12 text-white" />
              )}
              
              {isEditing && (
                <label className="absolute inset-0 bg-black/40 flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera className="w-8 h-8 text-white" />
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                </label>
              )}

              {!isEditing && (
                <div className="absolute -bottom-2 -end-2 bg-primary text-white p-2 rounded-2xl shadow-lg border-2 border-white z-10">
                  <Shield className="w-4 h-4" />
                </div>
              )}
            </div>

            {isEditing ? (
              <div className="w-full space-y-4 mb-6">
                <input 
                  className="w-full bg-bg-main border border-border rounded-xl px-4 py-2 text-center text-xl font-black outline-none focus:border-primary"
                  value={editedProfile.name || ''}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="Full Name"
                />
                <select 
                   className="w-full bg-bg-main border border-border rounded-xl px-4 py-2 text-center text-xs font-bold text-text-muted outline-none focus:border-primary uppercase tracking-widest appearance-none cursor-pointer"
                   value={editedProfile.educationLevel || 'University'}
                   onChange={(e) => handleChange('educationLevel', e.target.value)}
                >
                  <option value="Primary">Primary Education</option>
                  <option value="Professional">Professional Workspace</option>
                  <option value="Secondary">Secondary Education</option>
                  <option value="University">University Level</option>
                </select>
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-black text-text-main mb-1">{profile.name}</h2>
                <p className="text-text-muted text-sm font-black mb-1 uppercase tracking-widest">{profile.educationLevel || profile.role}</p>
                <p className="text-[10px] text-primary font-black mb-6 uppercase tracking-[0.2em]">{profile.religion || "Unspecified Path"}</p>
              </>
            )}
            
            <div className="w-full space-y-3 pt-6 border-t border-border">
              <div className="flex items-center gap-3 text-text-muted text-sm font-medium">
                <Mail className="w-4 h-4 text-faint" />
                <span className="truncate">{profile.email}</span>
              </div>
              <DataField 
                label={getTranslation(profile.language, 'language')} 
                value={profile.language} 
                icon={Languages} 
                isEditing={isEditing} 
                onChange={(v) => handleChange('language', v)} 
                type="select"
                options={['English', 'Arabic', 'Egyptian Ammiya', 'French', 'Spanish', 'German', 'Italian', 'Portuguese', 'Russian', 'Chinese', 'Japanese']}
              />
              <DataField 
                label={getTranslation(profile.language, 'accessibilityMode')} 
                value={profile.accessibilityMode} 
                icon={Eye} 
                isEditing={isEditing} 
                onChange={(v) => handleChange('accessibilityMode', v)} 
                type="select"
                options={['None', 'Motor-Euphonia', 'Sign-Only', 'Speech', 'Visual', 'Vocal-Deaf']}
              />
            </div>
          </div>

          <div className="bg-bg-card p-8 rounded-[40px] border border-border shadow-sm">
             <h3 className="text-sm font-black uppercase tracking-[0.2em] text-text-main mb-4 flex items-center gap-2">
                <currentGoal.icon className="w-4 h-4 text-primary" /> Sustainability Goal
             </h3>
             {isEditing ? (
                <div className="space-y-3">
                  {SUSTAINABILITY_GOALS.map(goal => (
                    <button
                      key={goal.id}
                      onClick={() => handleChange('sustainabilityGoal', goal.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-xs font-bold ${
                        editedProfile.sustainabilityGoal === goal.id ? 'bg-primary-soft border-border text-primary' : 'bg-bg-card border-border text-faint'
                      }`}
                    >
                      <goal.icon className="w-4 h-4" /> {goal.label}
                    </button>
                  ))}
                </div>
             ) : (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-text-main">{currentGoal.label}</span>
                  <p className="text-[10px] text-faint leading-relaxed font-medium">
                    Committed to fostering positive change through educational excellence and sustainable practices.
                  </p>
                </div>
             )}
          </div>
        </div>

        {/* Right Side: Detailed Institutional Data */}
        <div className="xl:col-span-2 space-y-8">
          <div className="bg-bg-card p-10 rounded-[40px] border border-border shadow-sm">
            <h3 className="text-lg font-black text-text-main mb-8 flex items-center gap-3">
              <GraduationCap className="w-5 h-5 text-primary" /> Institution Details
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
              <DataField 
                label={profile.educationLevel === 'Professional' ? "Company Name" : (profile.educationLevel === 'University' ? "University Name" : "School Name")} 
                value={isEditing ? (editedProfile.role === 'Student' ? editedProfile.university : editedProfile.work) : (profile.role === 'Student' ? profile.university : profile.work)} 
                icon={Briefcase} 
                isEditing={isEditing}
                onChange={(v) => handleChange(profile.role === 'Student' ? 'university' : 'work', v)}
              />
              <DataField 
                label={profile.role === 'Student' ? (profile.educationLevel === 'University' ? "Academic Faculty" : "Current Grade") : "Operational Role"} 
                value={isEditing ? (editedProfile.role === 'Student' ? editedProfile.faculty : editedProfile.jobTitle) : (profile.role === 'Student' ? profile.faculty : profile.jobTitle)} 
                icon={BookOpen} 
                isEditing={isEditing}
                onChange={(v) => handleChange(profile.role === 'Student' ? 'faculty' : 'jobTitle', v)}
              />
              <DataField label="Location" value="Cairo_Hub" icon={MapPin} />
              <DataField label="Member Since" value={formatDate(profile.lastQuizDate || new Date())} icon={Calendar} />
              <DataField label="Points" value={`${profile.points ?? 0}`} icon={Award} />
            </div>
          </div>

          <div className="bg-bg-card p-10 rounded-[40px] border border-border shadow-sm flex-1">
            <h3 className="text-lg font-black text-text-main mb-6 flex items-center gap-3">
              <MessageSquare className="w-5 h-5 text-primary" /> Recent Chat History
            </h3>
            <div className="space-y-4">
              {!profile.chatThreads || profile.chatThreads.length === 0 ? (
                <div className="text-center py-10 text-faint font-medium italic border-2 border-dashed border-border rounded-3xl">
                  No previous chat history recorded.
                </div>
              ) : (
                profile.chatThreads.slice(-4).reverse().map((t, i) => (
                  <div key={t.id || i} className="flex items-start gap-4 p-4 rounded-3xl hover:bg-bg-main transition-colors border border-transparent hover:border-border">
                    <div className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center bg-primary-soft text-primary">
                      <MessageSquare className="w-4 h-4" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-text-main flex items-center gap-2">
                        {t.title}
                        {t.updatedAt && (
                          <span className="text-[10px] font-normal text-faint uppercase tracking-tighter">• {formatDate(t.updatedAt)}</span>
                        )}
                      </p>
                      <p className="text-sm text-text-muted line-clamp-1 leading-relaxed">{t.lastMessageSnippet || 'No messages yet'}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* AI Guidance Feedback Hub */}
          <div className="bg-bg-card p-10 rounded-[40px] border border-border shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
              <div>
                <h3 className="text-lg font-black text-text-main flex items-center gap-3">
                  <BrainIcon className="w-5 h-5 text-primary" />
                  {localize(profile.language, 'AI Guidance Feedback Hub', 'مؤشر تقييم الذكاء الاصطناعي')}
                </h3>
                <p className="text-xs text-text-muted font-medium italic mt-1">
                  {localize(profile.language, 'Analysis of helpful and flagged responses across your intellectual sessions.', 'تحليل الملاحظات والتقييمات التي قدمتها لإجابات المساعد الذكي.')}
                </p>
              </div>
              
              {!feedbackStats.loading && (feedbackStats.upvotes > 0 || feedbackStats.downvotes > 0) && (
                <div className="flex items-center gap-2 bg-primary-soft text-success px-4 py-2 rounded-2xl border border-border">
                  <span className="text-lg font-black">
                    {Math.round((feedbackStats.upvotes / (feedbackStats.upvotes + feedbackStats.downvotes)) * 100)}%
                  </span>
                  <span className="text-[10px] uppercase font-black tracking-wider">
                    {localize(profile.language, 'Positive Rating', 'تقييم إيجابي')}
                  </span>
                </div>
              )}
            </div>

            {feedbackStats.loading ? (
              <div className="flex items-center justify-center py-10 gap-3 text-faint font-bold text-xs uppercase tracking-widest">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span>{localize(profile.language, 'Compiling intelligence feedback...', 'جاري تحميل التقييمات...')}</span>
              </div>
            ) : (
              <div className="space-y-8">
                {/* Metrics row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-6 bg-gradient-to-br from-emerald-50/50 to-emerald-50/10 border border-border rounded-3xl flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase text-primary tracking-wider">
                        {localize(profile.language, 'Helpful Responses', 'الإجابات المفيدة')}
                      </p>
                      <h4 className="text-3xl font-black text-text-main mt-1">{feedbackStats.upvotes}</h4>
                    </div>
                    <div className="p-3 bg-surface-3 rounded-2xl text-emerald-500">
                      <ThumbsUp className="w-6 h-6" />
                    </div>
                  </div>

                  <div className="p-6 bg-gradient-to-br from-rose-50/50 to-rose-50/10 border border-danger/20 rounded-3xl flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase text-danger tracking-wider">
                        {localize(profile.language, 'Needs Improvement', 'تحتاج إلى تحسين')}
                      </p>
                      <h4 className="text-3xl font-black text-text-main mt-1">{feedbackStats.downvotes}</h4>
                    </div>
                    <div className="p-3 bg-danger-soft rounded-2xl text-rose-500">
                      <ThumbsDown className="w-6 h-6" />
                    </div>
                  </div>
                </div>

                {/* Helpful list */}
                {feedbackStats.helpfulSnippets.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-[11px] font-black tracking-wider uppercase text-faint flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      {localize(profile.language, 'Sample Commended Guidance', 'نماذج الإجابات المفيدة والمدعومة')}
                    </h4>
                    <div className="space-y-3">
                      {feedbackStats.helpfulSnippets.map((snippet, idx) => (
                        <div key={idx} className="p-4 bg-bg-main border border-border rounded-2xl text-xs font-medium text-text-main leading-relaxed italic line-clamp-2 hover:line-clamp-none transition-all cursor-pointer">
                          "{snippet}"
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Improvements list */}
                {feedbackStats.improvementSnippets.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-[11px] font-black tracking-wider uppercase text-faint flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                      {localize(profile.language, 'Identified Alignment Gaps', 'نقاط للتطوير والتحسين')}
                    </h4>
                    <div className="space-y-3">
                      {feedbackStats.improvementSnippets.map((snippet, idx) => (
                        <div key={idx} className="p-4 bg-bg-main border border-border rounded-2xl text-xs font-medium text-text-muted leading-relaxed italic line-clamp-2 hover:line-clamp-none transition-all cursor-pointer border-s-4 border-s-rose-400">
                          "{snippet}"
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {feedbackStats.upvotes === 0 && feedbackStats.downvotes === 0 && (
                  <div className="text-center py-10 text-faint font-medium italic border-2 border-dashed border-border rounded-3xl">
                    {localize(profile.language, 'No message ratings submitted yet. Commend or flag responses in the chat view to populate this analytics terminal.', 'لا توجد تقييمات لإجابات الذكاء الاصطناعي حتى الآن. يمكنك تقييم الإجابات داخل المحادثة بوضع علامة مفيد أو غير مفيد.')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DataField({ 
  label, 
  value, 
  icon: Icon, 
  isEditing, 
  onChange, 
  type = 'text', 
  options 
}: { 
  label: string, 
  value: string | undefined, 
  icon: any, 
  isEditing?: boolean, 
  onChange?: (v: string) => void,
  type?: 'text' | 'select',
  options?: string[]
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase text-faint tracking-widest">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      {isEditing && onChange ? (
        type === 'select' ? (
          <select
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-bg-main border border-border rounded-xl px-4 py-2 text-sm font-bold text-text-main outline-none focus:border-primary appearance-none cursor-pointer"
          >
            {options?.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : (
          <input 
            className="w-full bg-bg-main border border-border rounded-xl px-4 py-2 text-sm font-bold text-text-main outline-none focus:border-primary"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      ) : (
        <div className="text-lg font-black text-text-main border-b-2 border-border pb-1">{value || 'N/A'}</div>
      )}
    </div>
  );
}

function BrainIconWrapper(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .52 8.105 4 4 0 0 0 5.327 2.72 2.5 2.5 0 0 0 4.676 0 4 4 0 0 0 5.327-2.72 4 4 0 0 0 .52-8.105 4 4 0 0 0-2.526-5.77A3 3 0 1 0 12 5z" />
      <path d="M9 13a4.5 4.5 0 0 0 3-4" />
      <path d="M12 13a4.5 4.5 0 0 1 3-4" />
      <path d="M12 13v4" />
      <path d="M12 13a4.5 4.5 0 0 1-3 4" />
      <path d="M12 13a4.5 4.5 0 0 0 3 4" />
    </svg>
  );
}
