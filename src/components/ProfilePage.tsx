import React, { useState } from 'react';
import { UserProfile } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { User, Mail, Shield, Award, Languages, Globe, BookOpen, GraduationCap, Briefcase, MapPin, Calendar, Clock, MessageSquare, Edit3, Save, X, Camera, Eye, Brain as BrainIcon, Menu } from 'lucide-react';
import { formatDate } from '../lib/utils';
import { doc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { getTranslation } from '../lib/translations';

interface ProfilePageProps {
  profile: UserProfile;
  onMenuClick?: () => void;
}

export default function ProfilePage({ profile, onMenuClick }: ProfilePageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedProfile, setEditedProfile] = useState<UserProfile>(profile);
  const [saving, setSaving] = useState(false);

  const stats = [
    { label: 'Cognitive Level', value: profile.level, icon: BrainIcon },
    { label: 'Uplink Integrity', value: `${profile.iqScore || 0}%`, icon: Award },
    { label: 'Merit Index', value: profile.points, icon: Shield },
    { label: 'Sessions', value: profile.chatHistory?.length || 0, icon: Clock },
  ];

  const handleSave = async () => {
    setSaving(true);
    const path = `users/${profile.uid}`;
    try {
      await setDoc(doc(db, path), editedProfile);
      setIsEditing(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key: keyof UserProfile, value: string) => {
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

  return (
    <div className="flex-1 h-screen overflow-y-auto bg-slate-50 p-6 md:p-10 flex flex-col gap-6 md:gap-10 custom-scrollbar relative">
      <header className="flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div className="flex items-start gap-4 space-y-2">
          <button 
            onClick={onMenuClick}
            className="lg:hidden p-2 mt-1 text-slate-500 bg-white shadow-sm border border-slate-200 hover:bg-slate-50 rounded-lg active:scale-95"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-2xl md:text-4xl font-black text-slate-900 tracking-tighter uppercase">{getTranslation(profile.language, 'myProfile')}</h1>
            <p className="text-xs md:text-sm text-slate-500 font-medium mt-1">Manage your academic and account details.</p>
          </div>
        </div>
        {!isEditing ? (
          <button 
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 rounded-2xl text-slate-700 font-black text-xs uppercase tracking-widest hover:border-primary hover:text-primary transition-all shadow-sm"
          >
            <Edit3 className="w-4 h-4" /> {getTranslation(profile.language, 'edit')}
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button 
              onClick={() => { setIsEditing(false); setEditedProfile(profile); }}
              className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 rounded-2xl text-slate-400 font-black text-xs uppercase tracking-widest hover:text-slate-600 transition-all"
            >
              <X className="w-4 h-4" /> {getTranslation(profile.language, 'back')}
            </button>
            <button 
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-xl shadow-slate-200 disabled:opacity-50"
            >
              <Save className="w-4 h-4" /> {saving ? (profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya' ? 'جاري الحفظ...' : 'Saving...') : getTranslation(profile.language, 'saveChanges')}
            </button>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 pb-20">
        {/* Left Side: Avatar & Basic Info */}
        <div className="xl:col-span-1 space-y-8">
          <div className="bg-white p-8 rounded-[40px] border border-slate-200 shadow-sm flex flex-col items-center text-center">
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
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-center text-xl font-black outline-none focus:border-primary"
                  value={editedProfile.name || ''}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="Full Name"
                />
                <input 
                   className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-center text-xs font-bold text-slate-500 outline-none focus:border-primary uppercase tracking-widest"
                   value={editedProfile.religion || ''}
                   onChange={(e) => handleChange('religion', e.target.value)}
                   placeholder="Belief System / Religion"
                />
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-black text-slate-900 mb-1">{profile.name}</h2>
                <p className="text-slate-500 text-sm font-black mb-1 uppercase tracking-widest">{profile.role}</p>
                {profile.religion && (
                   <p className="text-[10px] text-primary font-black mb-6 uppercase tracking-[0.2em]">{profile.religion}</p>
                )}
              </>
            )}
            
            <div className="w-full space-y-3 pt-6 border-t border-slate-50">
              <div className="flex items-center gap-3 text-slate-600 text-sm font-medium">
                <Mail className="w-4 h-4 text-slate-400" />
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
                options={['None', 'Speech', 'Visual', 'Vocal-Deaf', 'Sign-Only']}
              />
            </div>
          </div>

          <div className="bg-white p-8 rounded-[40px] border border-slate-200 shadow-sm">
             <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 mb-4">Biography</h3>
             {isEditing ? (
               <textarea 
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-sm text-slate-600 focus:border-primary outline-none min-h-[120px] resize-none"
                  value={editedProfile.bio || ''}
                  onChange={(e) => handleChange('bio', e.target.value)}
                  placeholder="Tell us about yourself..."
               />
             ) : (
               <p className="text-sm text-slate-500 leading-relaxed italic">
                 {profile.bio || "No biography provided yet."}
               </p>
             )}
          </div>
        </div>

        {/* Right Side: Detailed Institutional Data */}
        <div className="xl:col-span-2 space-y-8">
          <div className="bg-white p-10 rounded-[40px] border border-slate-200 shadow-sm">
            <h3 className="text-lg font-black text-slate-900 mb-8 flex items-center gap-3">
              <GraduationCap className="w-5 h-5 text-primary" /> Institution Details
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
              <DataField 
                label="Institution Name" 
                value={isEditing ? (editedProfile.role === 'Student' ? editedProfile.university : editedProfile.work) : (profile.role === 'Student' ? profile.university : profile.work)} 
                icon={Briefcase} 
                isEditing={isEditing}
                onChange={(v) => handleChange(profile.role === 'Student' ? 'university' : 'work', v)}
              />
              <DataField 
                label="Faculty / Department" 
                value={isEditing ? (editedProfile.role === 'Student' ? editedProfile.faculty : editedProfile.jobTitle) : (profile.role === 'Student' ? profile.faculty : profile.jobTitle)} 
                icon={BookOpen} 
                isEditing={isEditing}
                onChange={(v) => handleChange(profile.role === 'Student' ? 'faculty' : 'jobTitle', v)}
              />
              <DataField label="Location" value="Cairo_Hub" icon={MapPin} />
              <DataField label="Last Test Date" value={formatDate(profile.lastQuizDate || new Date())} icon={Calendar} />
              <DataField label="Average Score" value={`${(profile.points / 10).toFixed(1)}%`} icon={Award} />
            </div>
          </div>

          <div className="bg-white p-10 rounded-[40px] border border-slate-200 shadow-sm flex-1">
            <h3 className="text-lg font-black text-slate-900 mb-6 flex items-center gap-3">
              <MessageSquare className="w-5 h-5 text-primary" /> Recent Chat History
            </h3>
            <div className="space-y-4">
              {profile.chatHistory?.length === 0 ? (
                <div className="text-center py-10 text-slate-400 font-medium italic border-2 border-dashed border-slate-50 rounded-3xl">
                  No previous chat history recorded.
                </div>
              ) : (
                profile.chatHistory?.slice(-4).reverse().map((m, i) => (
                  <div key={i} className="flex items-start gap-4 p-4 rounded-3xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                    <div className={`w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center ${m.role === 'user' ? 'bg-blue-50 text-blue-600' : 'bg-primary/5 text-primary'}`}>
                      {m.role === 'user' ? <User className="w-4 h-4" /> : <BrainIcon className="w-4 h-4" />}
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-slate-900 flex items-center gap-2">
                        {m.role === 'user' ? 'User Question' : 'Assistant Response'}
                        <span className="text-[10px] font-normal text-slate-400 uppercase tracking-tighter">• {formatDate(m.timestamp)}</span>
                      </p>
                      <p className="text-sm text-slate-500 line-clamp-1 leading-relaxed">{m.content}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
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
      <div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400 tracking-widest">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      {isEditing && onChange ? (
        type === 'select' ? (
          <select
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-sm font-bold text-slate-900 outline-none focus:border-primary appearance-none cursor-pointer"
          >
            {options?.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : (
          <input 
            className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-sm font-bold text-slate-900 outline-none focus:border-primary"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      ) : (
        <div className="text-lg font-black text-slate-900 border-b-2 border-slate-50 pb-1">{value || 'N/A'}</div>
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
