import React, { useState, useRef, useEffect } from 'react';
import { toast } from './Toast';
import { UserProfile } from '../types';
import { localize } from '../lib/translations';
import { speak, cancelSpeech } from '../lib/tts';
import { Volume2, Mic, Square, Play, MessageSquare, UserCheck } from 'lucide-react';
import SignAvatar3D from './SignAvatar3D';

interface HumanCommunicationBridgeProps {
  profile: UserProfile;
}

export default function HumanCommunicationBridge({ profile }: HumanCommunicationBridgeProps) {
  const [voiceDialect, setVoiceDialect] = useState<string>(profile.language || 'Egyptian Ammiya');

  const isArabic = voiceDialect === 'Arabic' || voiceDialect === 'Egyptian Ammiya';
  const isEgyptian = voiceDialect === 'Egyptian Ammiya';
  const isFrench = voiceDialect === 'French';

  const AAC_PHRASES = isEgyptian ? [
    { text: "عندي سؤال يا باشا", icon: "🙋‍♂️" },
    { text: "ممكن تعيد الشرح تاني؟", icon: "🔄" },
    { text: "محتاج توضيح أبسط شوية", icon: "💡" },
    { text: "تمام جداً فهمت، تسلم!", icon: "✅" },
    { text: "لو سمحت اكتب لي على الشاشة", icon: "📝" },
    { text: "أنا بستخدم لغة الإشارة للتواصل", icon: "🤟" },
  ] : isArabic ? [
    { text: "عندي سؤال لو سمحت", icon: "🙋‍♂️" },
    { text: "ممكن إعادة الشرح من فضلك؟", icon: "🔄" },
    { text: "محتاج توضيح بطريقة أبسط", icon: "💡" },
    { text: "تمام جداً فهمت، شكراً!", icon: "✅" },
    { text: "لو سمحت اكتب لي على الشاشة", icon: "📝" },
    { text: "أنا أستخدم لغة الإشارة للتواصل", icon: "🤟" },
  ] : isFrench ? [
    { text: "Bonjour, s'il vous plaît !", icon: "👋" },
    { text: "Pouvez-vous m'aider s'il vous plaît ?", icon: "🤝" },
    { text: "Où se trouve la station de métro / gare ?", icon: "🚇" },
    { text: "Un café et un croissant s'il vous plaît", icon: "🥐" },
    { text: "L'addition, s'il vous plaît", icon: "🧾" },
    { text: "Combien ça coûte ?", icon: "💶" },
    { text: "Pouvez-vous parler plus lentement ?", icon: "🗣️" },
    { text: "Je ne parle pas très bien français", icon: "🇫🇷" },
    { text: "Où est la pharmacie la plus proche ?", icon: "💊" },
    { text: "Veuillez écrire sur l'écran s'il vous plaît", icon: "📝" },
    { text: "Merci beaucoup, bonne journée !", icon: "✨" },
    { text: "J'utilise la langue des signes", icon: "🤟" },
  ] : [
    { text: "I have a question please", icon: "🙋‍♂️" },
    { text: "Could you repeat that please?", icon: "🔄" },
    { text: "Can you explain simpler?", icon: "💡" },
    { text: "Understood clearly, thank you!", icon: "✅" },
  ];

  const [inputText, setInputText] = useState('');
  const [isSpeakingOut, setIsSpeakingOut] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [sequence, setSequence] = useState<string[]>([]);
  const [isListeningPartner, setIsListeningPartner] = useState(false);
  const [partnerTranscript, setPartnerTranscript] = useState('');
  const [partnerSignSequence, setPartnerSignSequence] = useState<string[]>([]);
  const [isPartnerSigning, setIsPartnerSigning] = useState(false);
  const recognitionRef = useRef<any>(null);

  // 1. Speak aloud the user's text to the hearing partner in the room
  const handleSpeakToRoom = (overrideText?: string) => {
    const textToSpeak = (overrideText || inputText).trim();
    if (!textToSpeak) return;
    setIsSpeakingOut(true);
    speak(textToSpeak, voiceDialect, {
      onStart: () => setIsSpeakingOut(true),
      onEnd: () => setIsSpeakingOut(false),
      // The button used to just flash and go silent on a device with no Arabic
      // voice installed, with no explanation — while the Motor view on the SAME
      // device correctly warned about it. Tell the user what went wrong.
      onError: (reason) => {
        setIsSpeakingOut(false);
        const isAr = voiceDialect === 'Arabic' || voiceDialect === 'Egyptian Ammiya';
        const msg =
          reason === 'unsupported'
            ? (isAr ? '⚠️ المتصفح لا يدعم النطق الصوتي' : '⚠️ This browser does not support speech output')
            : reason === 'silent-fail'
            ? (isAr
                ? '⚠️ تعذر نطق الجملة. تأكد من وجود صوت عربي مثبت على الجهاز وأن الصوت غير مكتوم'
                : '⚠️ Could not speak. Check that a matching voice is installed and the device is not muted')
            : (isAr ? '⚠️ حدث خطأ أثناء النطق الصوتي' : '⚠️ Speech output error');
        toast.error(msg);
      },
    });
  };

  // 2. Generate 3D Sign Language video for what the user wrote
  const handleSignMyMessage = (overrideText?: string) => {
    const text = (overrideText || inputText).trim();
    if (!text) return;
    const words = text.split(/\s+/).filter(Boolean);
    setSequence(words);
    setIsSigning(true);
  };

  // 3. Partner speaking into mic -> Live Speech to Sign translation
  const togglePartnerListening = () => {
    if (isListeningPartner) {
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      setIsListeningPartner(false);
      return;
    }

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      alert(isArabic ? "المتصفح لا يدعم ميزة تحويل الصوت إلى نص" : "Browser does not support Speech Recognition");
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = voiceDialect === 'Egyptian Ammiya' ? 'ar-EG' : voiceDialect === 'Arabic' ? 'ar-SA' : voiceDialect === 'French' ? 'fr-FR' : 'en-US';

      rec.onresult = (event: any) => {
        let transcript = '';
        let finalText = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const chunk = event.results[i][0].transcript;
          transcript += chunk;
          if (event.results[i].isFinal) finalText += chunk;
        }
        // Interim results update the CAPTION only. Feeding them to the avatar
        // restarted the signing animation from word one several times a second,
        // so the deaf student saw a stutter and never a complete sentence.
        setPartnerTranscript(transcript);
        const words = finalText.trim().split(/\s+/).filter(Boolean);
        if (words.length > 0) {
          setPartnerSignSequence(words);
          setIsPartnerSigning(true);
        }
      };

      rec.onerror = () => setIsListeningPartner(false);
      rec.onend = () => setIsListeningPartner(false);
      rec.start();
      recognitionRef.current = rec;
      setIsListeningPartner(true);
    } catch (e) {
      console.error("Partner speech recognition error", e);
      setIsListeningPartner(false);
    }
  };

  useEffect(() => {
    return () => {
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      cancelSpeech();
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col bg-surface-2 relative overflow-hidden h-full p-4 md:p-8">
      {/* Header Banner */}
      <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-border shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-text-main flex items-center gap-2.5">
            <MessageSquare className="w-6 h-6 text-primary" />
            {isArabic ? "جسر التواصل البشري المباشر (Two-Way Bridge)" : "Direct Human Communication Bridge"}
          </h2>
          <p className="text-xs sm:text-sm text-text-muted mt-1 font-medium">
            {isArabic 
              ? "مخصص لتسهيل المحادثة المباشرة بين الشخص ذي الإعاقة والطرف الآخر (معلم، طبيب، زميل)."
              : "Designed for seamless 2-way live conversation between differently-abled individuals and conversation partners."}
          </p>
        </div>

        {/* Dialect Switcher */}
        <div className="flex items-center gap-1.5 bg-surface-2 p-1.5 rounded-xl border border-border self-stretch sm:self-auto justify-center">
          <span className="text-[11px] font-bold text-text-muted px-2">🗣️ {isArabic ? "اللهجة:" : "Dialect:"}</span>
          {[
            { id: 'Egyptian Ammiya', label: '🇪🇬 مصري' },
            { id: 'Arabic', label: '🇸🇦 فصحى' },
            { id: 'English', label: '🇺🇸 English' },
            { id: 'French', label: '🇫🇷 Français' },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setVoiceDialect(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                voiceDialect === id ? 'bg-primary text-white shadow-sm' : 'text-text-muted hover:text-text-main'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid: Side A (I want to communicate) vs Side B (Partner speaking) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0 overflow-y-auto">
        
        {/* SIDE A: The Student / Individual communicating OUT */}
        <div className="bg-white rounded-2xl border border-border p-5 md:p-6 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-text-main uppercase tracking-wider flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-500" />
              {isArabic ? "أنا أتحدث (الطرف ذو الإعاقة)" : "My Voice (I am speaking)"}
            </h3>
            <span className="text-[10px] font-bold bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-md border border-emerald-200">
              Text & Signs ➔ Voice / 3D
            </span>
          </div>

          {/* Quick AAC Phrase Cards */}
          <div className="mb-4">
            <p className="text-[11px] font-bold text-text-muted mb-2">⚡ {isArabic ? "عبارات سريعة بنقرة واحدة:" : "Quick 1-Tap Phrases:"}</p>
            <div className="grid grid-cols-2 gap-2">
              {AAC_PHRASES.map((phrase, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setInputText(phrase.text);
                    handleSpeakToRoom(phrase.text);
                  }}
                  className="p-2.5 bg-surface-2 hover:bg-primary-soft hover:text-primary hover:border-primary/40 text-text-main text-xs font-medium rounded-xl border border-border transition-all active:scale-95 text-start flex items-center gap-2 shadow-sm"
                >
                  <span className="text-base">{phrase.icon}</span>
                  <span className="truncate">{phrase.text}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Custom Message Input */}
          <div className="flex-1 flex flex-col mb-4">
            <label htmlFor="human-bridge-textarea" className="text-[11px] font-bold text-text-muted mb-1.5">
              {isArabic ? "اكتب ما تريد قوله للطرف الآخر:" : "Type what you want to say:"}
            </label>
            <textarea
              id="human-bridge-textarea"
              name="human-bridge-message"
              aria-label={isArabic ? "نص الرسالة المنطوقة" : "Message to speak aloud"}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSpeakToRoom();
                }
              }}
              placeholder={isArabic ? "اكتب رسالتك هنا واضغط Enter للنطق بصوت عالي..." : "Type your message and press Enter to speak aloud..."}
              className="flex-1 min-h-[100px] p-3.5 bg-surface-2 border border-border rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 text-text-main font-medium text-sm"
            />
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleSpeakToRoom()}
              disabled={!inputText.trim()}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-md transition-all active:scale-95 text-xs sm:text-sm"
            >
              {isSpeakingOut ? <Square className="w-4 h-4 fill-current" /> : <Volume2 className="w-4 h-4" />}
              {isArabic ? "انطق للغرفة بصوت عالي (Enter)" : "Speak to Room (Enter)"}
            </button>

            <button
              onClick={() => handleSignMyMessage()}
              disabled={!inputText.trim()}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-primary hover:bg-primary-press disabled:opacity-50 text-white font-bold rounded-xl shadow-md transition-all active:scale-95 text-xs sm:text-sm"
            >
              <Play className="w-4 h-4 fill-current" />
              {isArabic ? "تحويل للغة الإشارة" : "Sign on 3D Avatar"}
            </button>
          </div>
        </div>

        {/* SIDE B: The Partner Speaking IN */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 md:p-6 shadow-xl flex flex-col text-white">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Mic className="w-4 h-4 text-rose-400" />
              {isArabic ? "الطرف الآخر يتحدث (استماع ومحاكاة إشارية)" : "Partner is Speaking (Speech-to-Sign)"}
            </h3>
            <span className="text-[10px] font-bold bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded-md border border-rose-500/40">
              Voice ➔ Live 3D Sign Video
            </span>
          </div>

          {/* 3D Sign Preview */}
          <div className="relative flex-1 min-h-[220px] bg-slate-950 rounded-xl overflow-hidden border border-white/10 mb-4 flex items-center justify-center">
            <SignAvatar3D
              words={partnerSignSequence.length > 0 ? partnerSignSequence : sequence}
              playing={isPartnerSigning || isSigning}
              onDone={() => {
                setIsPartnerSigning(false);
                setIsSigning(false);
              }}
            />
            {isListeningPartner && (
              <div className="absolute top-3 left-3 bg-rose-500/90 text-white text-[10px] font-black uppercase px-2.5 py-1 rounded-full flex items-center gap-1.5 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                {isArabic ? "المايكروفون يستمع للمتحدث..." : "Listening to Partner..."}
              </div>
            )}
          </div>

          {/* Live Partner Captions */}
          <div className="bg-white/5 border border-white/10 p-3.5 rounded-xl mb-4 min-h-[50px]">
            <p className="text-[11px] text-white/50 font-bold mb-1">{isArabic ? "الكلام المنطوق لحظياً:" : "Live Spoken Transcript:"}</p>
            <p className="text-sm font-semibold text-emerald-400">
              {partnerTranscript || (isListeningPartner ? (isArabic ? "تحدث الآن في المايكروفون..." : "Speak into the microphone now...") : (isArabic ? "اضغط على الزر أدناه لبدء الاستماع للطرف الآخر" : "Click below to listen to your conversation partner"))}
            </p>
          </div>

          {/* Partner Listen Button */}
          <button
            onClick={togglePartnerListening}
            className={`flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold transition-all shadow-lg text-sm active:scale-95 ${
              isListeningPartner
                ? 'bg-rose-500 hover:bg-rose-600 text-white animate-pulse'
                : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white'
            }`}
          >
            {isListeningPartner ? <Square className="w-5 h-5 fill-current" /> : <Mic className="w-5 h-5" />}
            {isListeningPartner ? (isArabic ? "إيقاف الاستماع" : "Stop Listening") : (isArabic ? "بدء الاستماع للمتحدث (تحويل لإشارة فورية)" : "Start Listening to Partner")}
          </button>
        </div>

      </div>
    </div>
  );
}
