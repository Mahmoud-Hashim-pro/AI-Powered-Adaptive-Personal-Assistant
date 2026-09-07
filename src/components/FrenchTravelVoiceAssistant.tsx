import React, { useState, useEffect, useRef } from 'react';
import {
  Volume2,
  Mic,
  MicOff,
  Languages,
  Copy,
  Check,
  Phone,
  Maximize2,
  Minimize2,
  Sparkles,
  ArrowRightLeft,
  Coffee,
  Train,
  Hotel,
  HeartPulse,
  ShoppingBag,
  Smile,
  AlertOctagon,
  ArrowLeft,
  Menu,
  RotateCcw,
  ExternalLink,
  Info
} from 'lucide-react';
import { speak as speakText, cancelSpeech, hasFrenchVoice } from '../lib/tts';
import { localize } from '../lib/translations';
import { UserProfile } from '../types';
import { geminiService } from '../services/geminiService';

export interface FrenchTravelVoiceAssistantProps {
  profile: UserProfile;
  onNavigateBack?: () => void;
  onMenuClick?: () => void;
  isEmbedded?: boolean;
}

interface TravelPhrase {
  id: string;
  category: 'polite' | 'cafe' | 'metro' | 'hotel' | 'health' | 'shopping';
  fr: string;
  arPhonetic: string;
  enPhonetic: string;
  ar: string;
  en: string;
  notes?: string;
}

const TRAVEL_PHRASES: TravelPhrase[] = [
  // 1. Politesse & French Golden Etiquette
  {
    id: 'p1',
    category: 'polite',
    fr: "Bonjour Madame / Bonjour Monsieur",
    arPhonetic: "بونجور مادام / بونجور مسيو",
    enPhonetic: "bohn-zhoor mah-dahm / bohn-zhoor muh-syur",
    ar: "صباح الخير سيدتي / صباح الخير سيدي (القاعدة الذهبية في فرنسا: ابدأ بها دائمًا قبل أي سؤال!)",
    en: "Good morning / Hello Ma'am / Sir (Crucial: always say this before asking any question in France)",
    notes: "Golden Rule: Never ask a question in France without saying Bonjour first."
  },
  {
    id: 'p2',
    category: 'polite',
    fr: "S'il vous plaît",
    arPhonetic: "سيل فو بليه",
    enPhonetic: "seel voo pleh",
    ar: "من فضلك / لو سمحت",
    en: "Please",
  },
  {
    id: 'p3',
    category: 'polite',
    fr: "Merci beaucoup, bonne journée !",
    arPhonetic: "ميرسي بوكو، بون جورنيه",
    enPhonetic: "mehr-see boh-koo, buhn zhoor-nay",
    ar: "شكرًا جزيلاً، أتمنى لك يومًا سعيدًا!",
    en: "Thank you very much, have a nice day!",
  },
  {
    id: 'p4',
    category: 'polite',
    fr: "Excusez-moi, je ne parle pas très bien français.",
    arPhonetic: "إكسكوزيه موا، جو نو بارل با تريه بيان فرانسيه",
    enPhonetic: "ex-kew-zay mwah, zhuh nuh parl pah tray byan fran-say",
    ar: "عذرًا، لا أتحدث الفرنسية جيدًا.",
    en: "Excuse me, I don't speak French very well.",
  },
  {
    id: 'p5',
    category: 'polite',
    fr: "Pouvez-vous parler un peu plus lentement s'il vous plaît ?",
    arPhonetic: "بوفيه فو بارليه آن بو بلو لونتومان سيل فو بليه؟",
    enPhonetic: "poo-vay voo par-lay uhn puh ploo lahnt-mahn seel voo pleh",
    ar: "هل يمكنك التحدث ببطء أكثر من فضلك؟",
    en: "Could you speak a little slower please?",
  },
  {
    id: 'p6',
    category: 'polite',
    fr: "Pouvez-vous écrire cela sur mon téléphone s'il vous plaît ?",
    arPhonetic: "بوفيه فو إيكرير سولا سور مون تيليفون سيل فو بليه؟",
    enPhonetic: "poo-vay voo ay-kreer suh-lah soor mohn tay-lay-fon seel voo pleh",
    ar: "هل يمكنك كتابة ذلك على هاتفي لو سمحت؟",
    en: "Could you please write that on my phone?",
  },

  // 2. Café, Boulangerie & Restaurants
  {
    id: 'c1',
    category: 'cafe',
    fr: "Bonjour ! Un café et un croissant s'il vous plaît.",
    arPhonetic: "بونجور! آن كافيه إيه آن كرواسون سيل فو بليه",
    enPhonetic: "bohn-zhoor! uhn kah-fay ay uhn krwah-sahn seel voo pleh",
    ar: "صباح الخير! قهوة وكرواسون من فضلك.",
    en: "Hello! A coffee and a croissant please.",
  },
  {
    id: 'c2',
    category: 'cafe',
    fr: "L'addition, s'il vous plaît.",
    arPhonetic: "لاديسيون، سيل فو بليه",
    enPhonetic: "lah-dee-syohn, seel voo pleh",
    ar: "الحساب (الفاتورة) من فضلك.",
    en: "The bill, please.",
  },
  {
    id: 'c3',
    category: 'cafe',
    fr: "Une carafe d'eau s'il vous plaît.",
    arPhonetic: "أون كاراف دو سيل فو بليه",
    enPhonetic: "ewn kah-rahf doh seel voo pleh",
    ar: "إبريق ماء صنبور من فضلك (مجاني بقوة القانون في فرنسا).",
    en: "A jug of tap water please (Free of charge by law in France).",
    notes: "In France, 'une carafe d'eau' is free fresh drinking water, unlike bottled water."
  },
  {
    id: 'c4',
    category: 'cafe',
    fr: "Est-ce qu'il y a du porc ou de l'alcool dans ce plat ?",
    arPhonetic: "إيسك إيليا دي بورك أو دو لالقول دون سو بلا؟",
    enPhonetic: "ess-keel-ee-ah dew pohr oo duh lal-kohl dahn suh plah",
    ar: "هل يحتوي هذا الطبق على لحم خنزير أو كحول؟",
    en: "Does this dish contain pork or alcohol?",
  },
  {
    id: 'c5',
    category: 'cafe',
    fr: "Acceptez-vous la carte bancaire / sans contact ?",
    arPhonetic: "أكسبتيه فو لا كارت بونكير / سون كونتاكت؟",
    enPhonetic: "ak-sep-tay voo lah kart bahn-kair / sahn kohn-takt",
    ar: "هل تقبلون الدفع بالبطاقة البنكية / التلامسي؟",
    en: "Do you accept bank cards / contactless payment?",
  },
  {
    id: 'c6',
    category: 'cafe',
    fr: "Où sont les toilettes, s'il vous plaît ?",
    arPhonetic: "أو سون ليه تواليت، سيل فو بليه؟",
    enPhonetic: "oo sohn lay twah-let, seel voo pleh",
    ar: "أين دورة المياه من فضلك؟",
    en: "Where is the restroom, please?",
  },

  // 3. Métro, Gare SNCF & Transports
  {
    id: 'm1',
    category: 'metro',
    fr: "Où se trouve la station de métro la plus proche ?",
    arPhonetic: "أو سو تروف لا ستاسيون دو ميترو لا بلو بروش؟",
    enPhonetic: "oo suh troov lah stah-syohn duh may-troh lah ploo prohsh",
    ar: "أين تقع أقرب محطة مترو؟",
    en: "Where is the nearest metro station?",
  },
  {
    id: 'm2',
    category: 'metro',
    fr: "Je voudrais un ticket de métro, s'il vous plaît.",
    arPhonetic: "جو فودريه آن تيكيه دو ميترو، سيل فو بليه",
    enPhonetic: "zhuh voo-dray uhn tee-kay duh may-troh, seel voo pleh",
    ar: "أريد تذكرة مترو، من فضلك.",
    en: "I would like a metro ticket, please.",
  },
  {
    id: 'm3',
    category: 'metro',
    fr: "Quel quai pour le train vers l'aéroport Charles de Gaulle ?",
    arPhonetic: "كيل كيه بور لو تران فير لايروبور شارل ديجول؟",
    enPhonetic: "kel kay poor luh tran vair lair-oh-por sharl duh gohl",
    ar: "أي رصيف للقطار المتجه إلى مطار شارل ديجول؟",
    en: "Which platform for the train to Charles de Gaulle Airport?",
  },
  {
    id: 'm4',
    category: 'metro',
    fr: "Est-ce que ce bus va vers la Tour Eiffel / le Musée du Louvre ?",
    arPhonetic: "إيسك سو بيس فا فير لا تور إيفيل / لو موزيه دو لوفر؟",
    enPhonetic: "ess-kuh suh boos vah vair lah toor eye-fell / luh mew-zay dew loovr",
    ar: "هل هذا الأتوبيس يتجه إلى برج إيفل / متحف اللوفر؟",
    en: "Does this bus go towards the Eiffel Tower / Louvre Museum?",
  },
  {
    id: 'm5',
    category: 'metro',
    fr: "Je suis perdu, pouvez-vous me montrer le chemin sur mon téléphone ?",
    arPhonetic: "جو سوي بيردو، بوفيه فو مو مونتريه لو شومان سور مون تيليفون؟",
    enPhonetic: "zhuh swee pair-dew, poo-vay voo muh mohn-tray luh shuh-man soor mohn tay-lay-fon",
    ar: "أنا تائه، هل يمكنك إرشادي إلى الطريق على هاتفي؟",
    en: "I am lost, could you show me the way on my phone?",
  },

  // 4. Hôtel & Hébergement
  {
    id: 'h1',
    category: 'hotel',
    fr: "Bonjour, j'ai une réservation au nom de...",
    arPhonetic: "بونجور، جيه أون ريزيرفاسيون أو نوم دو...",
    enPhonetic: "bohn-zhoor, zhay ewn ray-zair-vah-syohn oh nohm duh",
    ar: "مرحبًا، لدي حجز باسم...",
    en: "Hello, I have a reservation under the name of...",
  },
  {
    id: 'h2',
    category: 'hotel',
    fr: "Quel est le code du Wi-Fi s'il vous plaît ?",
    arPhonetic: "كيل إيه لو كود دو واي فاي سيل فو بليه؟",
    enPhonetic: "kel ay luh kohd dew wee-fee seel voo pleh",
    ar: "ما هي كلمة سر الواي فاي من فضلك؟ (في فرنسا ينطق: وي-في)",
    en: "What is the Wi-Fi password please?",
  },
  {
    id: 'h3',
    category: 'hotel',
    fr: "Pouvez-vous garder nos bagages jusqu'à cet après-midi ?",
    arPhonetic: "بوفيه فو غارديه نو باجاج جوسكا سيت أبريه ميدي؟",
    enPhonetic: "poo-vay voo gar-day noh bah-gahzh zhoos-kah set ah-preh mee-dee",
    ar: "هل يمكنكم الاحتفاظ بحقائبنا حتى بعد ظهر اليوم؟",
    en: "Could you store our luggage until this afternoon?",
  },
  {
    id: 'h4',
    category: 'hotel',
    fr: "La clé de ma chambre ne fonctionne pas.",
    arPhonetic: "لا كليه دو ما شومبر نو فونكسيون با",
    enPhonetic: "lah klay duh mah shahm-bruh nuh fohnk-syohn pah",
    ar: "مفتاح غرفتي لا يعمل.",
    en: "My room key does not work.",
  },

  // 5. Pharmacie, Santé & Urgence
  {
    id: 'u1',
    category: 'health',
    fr: "Où est la pharmacie la plus proche ?",
    arPhonetic: "أو إيه لا فارماسي لا بلو بروش؟",
    enPhonetic: "oo ay lah far-mah-see lah ploo prohsh",
    ar: "أين أقرب صيدلية؟ (ابحث عن علامة الصليب الأخضر المضيء)",
    en: "Where is the nearest pharmacy? (Look for the green cross sign)",
  },
  {
    id: 'u2',
    category: 'health',
    fr: "Avez-vous du paracétamol s'il vous plaît ?",
    arPhonetic: "أفيه فو دو باراسيتامول سيل فو بليه؟",
    enPhonetic: "ah-vay voo dew pah-rah-say-tah-mohl seel voo pleh",
    ar: "هل لديك باراسيتامول لو سمحت؟ (مسكن للصداع والألم)",
    en: "Do you have paracetamol please?",
  },
  {
    id: 'u3',
    category: 'health',
    fr: "J'ai mal au ventre / à la tête / à la gorge.",
    arPhonetic: "جيه مال أو فونتر / آ لا تيت / آ لا غورج",
    enPhonetic: "zhay mahl oh vahntr / ah lah tet / ah lah gorzh",
    ar: "عندي ألم في المعدة / الرأس / الحلق.",
    en: "I have stomach / head / throat pain.",
  },
  {
    id: 'u4',
    category: 'health',
    fr: "C'est une urgence médicale, appelez le 15 s'il vous plaît !",
    arPhonetic: "سيت أون أورجونس ميديكال، آبليه لو كنز سيل فو بليه!",
    enPhonetic: "set ewn oor-zhahns may-dee-kahl, ah-play luh kanz seel voo pleh",
    ar: "هذه حالة طوارئ طبية، اتصل بالإسعاف (15) لو سمحت!",
    en: "This is a medical emergency, please call 15 (SAMU)!",
  },

  // 6. Shopping & Boutiques
  {
    id: 's1',
    category: 'shopping',
    fr: "Combien ça coûte, s'il vous plaît ?",
    arPhonetic: "كومبيان سا كوت، سيل فو بليه؟",
    enPhonetic: "kohm-byan sah koot, seel voo pleh",
    ar: "كم سعر هذا من فضلك؟",
    en: "How much does this cost, please?",
  },
  {
    id: 's2',
    category: 'shopping',
    fr: "Puis-je essayer ceci ?",
    arPhonetic: "بوي-جو إسيه-ييه سوسي؟",
    enPhonetic: "pwee-zhuh ess-ay-yay suh-see",
    ar: "هل يمكنني تجربة (قياس) هذا؟",
    en: "May I try this on?",
  },
  {
    id: 's3',
    category: 'shopping',
    fr: "Avez-vous une taille plus grande / plus petite ?",
    arPhonetic: "أفيه فو أون تاي بلو غراند / بلو بوتيت؟",
    enPhonetic: "ah-vay voo ewn tye ploo grahnd / ploo puh-teet",
    ar: "هل لديكم مقاس أكبر / أصغر؟",
    en: "Do you have a larger / smaller size?",
  },
  {
    id: 's4',
    category: 'shopping',
    fr: "Je regarde seulement, merci beaucoup !",
    arPhonetic: "جو روغارد سولمان، ميرسي بوكو!",
    enPhonetic: "zhuh ruh-gard suhl-mahn, mehr-see boh-koo",
    ar: "أنا فقط أتفرج، شكرًا جزيلاً! (مهمة جدًا لقولها عند دخول المحلات الفرنسية)",
    en: "I'm just browsing, thank you! (Polite response to French shopkeepers)",
  }
];

const EMERGENCY_SERVICES = [
  {
    number: '15',
    name: 'SAMU (Urgences Médicales)',
    descAr: 'الإسعاف الطبي الطارئ (أطباء وإسعاف متنقل)',
    descEn: 'Medical emergency ambulance & doctors',
    color: 'border-rose-500/30 bg-rose-500/10 text-rose-500'
  },
  {
    number: '17',
    name: 'Police Secours',
    descAr: 'شرطة النجدة والطوارئ الجنائية',
    descEn: 'Police emergency assistance',
    color: 'border-blue-500/30 bg-blue-500/10 text-blue-500'
  },
  {
    number: '18',
    name: 'Sapeurs-Pompiers',
    descAr: 'المطافئ والإنقاذ والحوادث في الشارع',
    descEn: 'Fire & Rescue (Respond to road & street accidents)',
    color: 'border-amber-500/30 bg-amber-500/10 text-amber-500'
  },
  {
    number: '112',
    name: 'Urgences Europe',
    descAr: 'رقم الطوارئ الأوروبي الموحد (يتحدثون الإنجليزية)',
    descEn: 'European emergency line (English speaking operators)',
    color: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
  },
  {
    number: '114',
    name: 'SMS Urgence (Sourds / Malentendants)',
    descAr: 'رسائل طوارئ نصية للصم وضعاف السمع',
    descEn: 'Emergency SMS for deaf/hard-of-hearing or silent emergencies',
    color: 'border-purple-500/30 bg-purple-500/10 text-purple-500'
  }
];

export default function FrenchTravelVoiceAssistant({
  profile,
  onNavigateBack,
  onMenuClick,
  isEmbedded = false
}: FrenchTravelVoiceAssistantProps) {
  const isAr = profile.language === 'Arabic' || profile.language === 'Egyptian Ammiya';

  // Tabs: 'interpreter' | 'phrasebook' | 'emergency'
  const [activeTab, setActiveTab] = useState<'interpreter' | 'phrasebook' | 'emergency'>('interpreter');

  // Filter category in phrasebook
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Search query in phrasebook
  const [searchQuery, setSearchQuery] = useState('');

  // Currently playing phrase ID
  const [speakingPhraseId, setSpeakingPhraseId] = useState<string | null>(null);

  // Fullscreen flashcard modal state
  const [fullscreenCard, setFullscreenCard] = useState<{ fr: string; ar: string; en: string; arPhonetic?: string } | null>(null);

  // Copied indicator
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // -------------------------------------------------------------
  // TWO-WAY LIVE VOICE INTERPRETER STATE
  // -------------------------------------------------------------
  // Mode: 'traveler-speaks' (Traveler -> French) or 'local-speaks' (Local French -> Traveler)
  const [interpreterMode, setInterpreterMode] = useState<'traveler-speaks' | 'local-speaks'>('traveler-speaks');
  const [isListening, setIsListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [translatedResult, setTranslatedResult] = useState<{ frText: string; arText: string; enText: string; phonetic?: string } | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Initialize Speech Recognition
  const startListening = (targetLang: 'fr-FR' | 'ar-EG' | 'en-US') => {
    cancelSpeech();
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      alert(localize(profile.language, 'Speech recognition is not supported in this browser.', 'التعرف على الصوت غير مدعوم في هذا المتصفح.'));
      return;
    }

    try {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }

      const rec = new SpeechRec();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = targetLang;

      rec.onstart = () => {
        setIsListening(true);
        setLiveTranscript('');
      };

      rec.onresult = (event: any) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        setLiveTranscript(transcript);
      };

      rec.onerror = (event: any) => {
        console.warn('[French Assistant] Speech recognition error:', event.error);
        setIsListening(false);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = rec;
      rec.start();
    } catch (err) {
      console.error('[French Assistant] Speech start failed:', err);
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
  };

  // Perform AI translation with instant fallback
  const handleTranslateAndSpeak = async (textToTranslate?: string) => {
    const text = (textToTranslate || liveTranscript).trim();
    if (!text) return;

    setIsTranslating(true);
    try {
      if (interpreterMode === 'traveler-speaks') {
        // Traveler speaks Arabic or English -> Translate to French
        const prompt = `You are an expert French travel interpreter for a tourist visiting France.
Translate this traveler statement into natural, polite spoken French used by French locals in Paris:
"${text}"

Return STRICT JSON in this format:
{
  "frText": "Natural polite French translation with Bonjour/S'il vous plaît if appropriate",
  "arText": "Arabic translation",
  "enText": "English translation",
  "phonetic": "How to pronounce the French text written in Arabic letters (نطق صوتي بالحروف العربية)"
}`;

        const raw = await geminiService.generateRawText(prompt);
        let parsed: any = null;
        try {
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        } catch {}

        const result = {
          frText: parsed?.frText || text,
          arText: parsed?.arText || text,
          enText: parsed?.enText || text,
          phonetic: parsed?.phonetic || ''
        };

        setTranslatedResult(result);
        speakText(result.frText, 'French');
      } else {
        // French local speaks French -> Translate to Arabic & English for the tourist
        const prompt = `You are an expert travel interpreter assisting a tourist in France.
A French local person just said this in French:
"${text}"

Translate it clearly and concisely into Arabic and English for the tourist.
Return STRICT JSON:
{
  "frText": "${text}",
  "arText": "Translation in Arabic",
  "enText": "Translation in English"
}`;

        const raw = await geminiService.generateRawText(prompt);
        let parsed: any = null;
        try {
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        } catch {}

        const result = {
          frText: text,
          arText: parsed?.arText || text,
          enText: parsed?.enText || text,
        };

        setTranslatedResult(result);
        const spokenLang = isAr ? 'Arabic' : 'English';
        const spokenText = isAr ? result.arText : result.enText;
        speakText(spokenText, spokenLang);
      }
    } catch (err) {
      console.error('Translation error:', err);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleSpeakPhrase = (phrase: TravelPhrase) => {
    cancelSpeech();
    setSpeakingPhraseId(phrase.id);
    speakText(phrase.fr, 'French');
    setTimeout(() => {
      setSpeakingPhraseId(null);
    }, 3500);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const filteredPhrases = TRAVEL_PHRASES.filter(p => {
    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
    const query = searchQuery.toLowerCase().trim();
    if (!query) return matchesCategory;
    const matchesSearch =
      p.fr.toLowerCase().includes(query) ||
      p.ar.toLowerCase().includes(query) ||
      p.en.toLowerCase().includes(query) ||
      p.arPhonetic.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="flex-1 flex flex-col bg-bg-card text-text-main h-full overflow-hidden relative">
      {/* Header */}
      <header className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0 bg-surface-1/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          {onNavigateBack && (
            <button
              onClick={onNavigateBack}
              className="p-2 text-text-muted hover:text-text-main hover:bg-surface-2 rounded-xl transition-all"
              title={localize(profile.language, 'Back', 'رجوع')}
            >
              <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
            </button>
          )}
          {onMenuClick && (
            <button
              onClick={onMenuClick}
              className="p-2 text-text-muted hover:text-text-main hover:bg-surface-2 rounded-xl transition-all md:hidden"
              title={localize(profile.language, 'Open Menu', 'فتح القائمة')}
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <div className="flex items-center gap-2.5">
            <span className="text-2xl shadow-sm rounded-lg">🇫🇷</span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-black tracking-tight text-text-main">
                  {localize(profile.language, 'France Travel & Voice Companion', 'مساعد السفر والصوت لفرنسا')}
                </h1>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  fr-FR HD
                </span>
              </div>
              <p className="text-xs text-text-muted">
                {localize(profile.language, 'Real-time French voice interpreter, local etiquette, phrasebook & emergency', 'مترجم صوتي مباشر، إتيكيت التواصل، عبارات السفر، وأرقام الطوارئ')}
              </p>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center bg-surface-2 border border-border p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('interpreter')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'interpreter'
                ? 'bg-primary text-white shadow-sm'
                : 'text-text-muted hover:text-text-main'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>{localize(profile.language, 'Voice Interpreter', 'المترجم الصوتي')}</span>
          </button>
          <button
            onClick={() => setActiveTab('phrasebook')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'phrasebook'
                ? 'bg-primary text-white shadow-sm'
                : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Languages className="w-3.5 h-3.5" />
            <span>{localize(profile.language, 'Spoken Phrases', 'عبارات السفر')}</span>
          </button>
          <button
            onClick={() => setActiveTab('emergency')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'emergency'
                ? 'bg-rose-500 text-white shadow-sm'
                : 'text-text-muted hover:text-text-main'
            }`}
          >
            <AlertOctagon className="w-3.5 h-3.5" />
            <span>{localize(profile.language, 'Urgences / SOS', 'طوارئ فرنسا')}</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 custom-scrollbar">
        {/* ========================================================= */}
        {/* TAB 1: TWO-WAY LIVE VOICE INTERPRETER */}
        {/* ========================================================= */}
        {activeTab === 'interpreter' && (
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Cultural Etiquette Notice */}
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-3 text-amber-600 dark:text-amber-400">
              <Sparkles className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed">
                <span className="font-bold">
                  {localize(profile.language, 'Crucial French Etiquette Rule:', 'قاعدة اللباقة الذهبية في فرنسا:')}
                </span>{' '}
                {localize(
                  profile.language,
                  'Always say "Bonjour Madame" or "Bonjour Monsieur" before asking any question in shops, metro, or streets. Conclude with "Merci beaucoup, bonne journée !". French locals appreciate this highly!',
                  'احرص دائمًا على بدء أي محادثة بـ "Bonjour Madame" أو "Bonjour Monsieur" قبل طلب أي مساعدة أو سؤال، واختم بـ "Merci beaucoup, bonne journée !". هذا الإتيكيت يضمن لك معاملة لطيفة ومرحبة جدًا من الفرنسيين.'
                )}
              </div>
            </div>

            {/* Mode Switcher Pill */}
            <div className="grid grid-cols-2 gap-3 p-1 bg-surface-2 border border-border rounded-2xl">
              <button
                onClick={() => {
                  setInterpreterMode('traveler-speaks');
                  setLiveTranscript('');
                  setTranslatedResult(null);
                }}
                className={`py-3 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                  interpreterMode === 'traveler-speaks'
                    ? 'bg-primary text-white shadow-md'
                    : 'text-text-muted hover:text-text-main'
                }`}
              >
                <span>🗣️</span>
                <span>
                  {localize(
                    profile.language,
                    'I Speak (Arabic / English) ➔ Speak French',
                    'أنا أتكلم (عربي / إنجليزي) ➔ ينطق بالفرنسية'
                  )}
                </span>
              </button>

              <button
                onClick={() => {
                  setInterpreterMode('local-speaks');
                  setLiveTranscript('');
                  setTranslatedResult(null);
                }}
                className={`py-3 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                  interpreterMode === 'local-speaks'
                    ? 'bg-primary text-white shadow-md'
                    : 'text-text-muted hover:text-text-main'
                }`}
              >
                <span>🇫🇷</span>
                <span>
                  {localize(
                    profile.language,
                    'Local Speaks (French) ➔ Translate to Arabic/EN',
                    'الفرنسي يتكلم ➔ يترجم بالعربية/الإنجليزية'
                  )}
                </span>
              </button>
            </div>

            {/* Active Voice Input Card */}
            <div className="p-6 rounded-3xl bg-surface-1 border border-border space-y-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <h2 className="text-sm font-black uppercase tracking-wider text-text-muted">
                    {interpreterMode === 'traveler-speaks'
                      ? localize(profile.language, 'Your Spoken Message', 'رسالتك الصوتية')
                      : localize(profile.language, 'French Person Speaking (fr-FR)', 'كلام الشخص الفرنسي (استماع مباشر)')}
                  </h2>
                </div>

                {liveTranscript && (
                  <button
                    onClick={() => setLiveTranscript('')}
                    className="text-xs text-text-muted hover:text-rose-500 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{localize(profile.language, 'Clear', 'مسح')}</span>
                  </button>
                )}
              </div>

              {/* Speech Input Box */}
              <div className="relative">
                <textarea
                  value={liveTranscript}
                  onChange={(e) => setLiveTranscript(e.target.value)}
                  rows={3}
                  placeholder={
                    interpreterMode === 'traveler-speaks'
                      ? localize(
                          profile.language,
                          'Tap the microphone and speak in Arabic or English, or type here...',
                          'اضغط على الميكروفون وتحدث بالعربية أو الإنجليزية، أو اكتب هنا...'
                        )
                      : localize(
                          profile.language,
                          'Hold near the French local person and tap "Listen to French Speaker"...',
                          'قرّب الهاتف من الشخص الفرنسي واضغط "استمع للمتحدث الفرنسي"...'
                        )
                  }
                  className="w-full bg-bg-card border border-border-2 rounded-2xl p-4 text-sm focus:border-primary outline-none resize-none leading-relaxed"
                />

                {isListening && (
                  <div className="absolute top-4 end-4 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-rose-500/10 text-rose-500 text-[10px] font-black animate-pulse border border-rose-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                    <span>{localize(profile.language, 'LISTENING...', 'جاري الاستماع...')}</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (isListening) {
                        stopListening();
                      } else {
                        const targetLang =
                          interpreterMode === 'local-speaks'
                            ? 'fr-FR'
                            : isAr
                            ? 'ar-EG'
                            : 'en-US';
                        startListening(targetLang);
                      }
                    }}
                    className={`px-5 py-3 rounded-2xl text-xs font-black flex items-center gap-2 shadow-sm transition-all active:scale-95 ${
                      isListening
                        ? 'bg-rose-500 text-white animate-pulse'
                        : 'bg-primary text-white hover:bg-primary-press'
                    }`}
                  >
                    {isListening ? (
                      <>
                        <MicOff className="w-4 h-4" />
                        <span>{localize(profile.language, 'Stop Listening', 'إيقاف الاستماع')}</span>
                      </>
                    ) : (
                      <>
                        <Mic className="w-4 h-4" />
                        <span>
                          {interpreterMode === 'local-speaks'
                            ? localize(profile.language, '🎙️ Listen to French Speaker', '🎙️ استمع للشخص الفرنسي')
                            : localize(profile.language, '🎙️ Speak Message', '🎙️ تحدث بالرسالة')}
                        </span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={isTranslating || !liveTranscript.trim()}
                    onClick={() => handleTranslateAndSpeak()}
                    className="px-5 py-3 rounded-2xl text-xs font-black bg-surface-2 border border-border hover:border-primary hover:text-primary disabled:opacity-50 disabled:pointer-events-none transition-all flex items-center gap-2"
                  >
                    {isTranslating ? (
                      <span className="animate-spin">⏳</span>
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                    <span>
                      {interpreterMode === 'traveler-speaks'
                        ? localize(profile.language, 'Translate & Speak French', 'ترجم وانطق بالفرنسية')
                        : localize(profile.language, 'Translate for Me', 'ترجم لي')}
                    </span>
                  </button>
                </div>

                {/* Quick Courtesies */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      speakText("Pouvez-vous parler plus lentement s'il vous plaît ?", 'French');
                    }}
                    className="text-[11px] font-bold px-3 py-2 rounded-xl bg-surface-2 border border-border hover:bg-surface-3 text-text-muted hover:text-text-main flex items-center gap-1.5"
                    title="Ask them to speak slower"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>🗣️ {localize(profile.language, 'Speak Slower', 'تحدث ببطء')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      speakText("Excusez-moi, je ne parle pas bien français", 'French');
                    }}
                    className="text-[11px] font-bold px-3 py-2 rounded-xl bg-surface-2 border border-border hover:bg-surface-3 text-text-muted hover:text-text-main flex items-center gap-1.5"
                    title="Say: I don't speak French well"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>🇫🇷 {localize(profile.language, "I don't speak French", 'لا أتحدث الفرنسية')}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Translation Output Card */}
            {translatedResult && (
              <div className="p-6 rounded-3xl bg-primary-soft/30 border border-primary/25 space-y-4 shadow-md animate-fadeIn">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-primary flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4" />
                    {interpreterMode === 'traveler-speaks'
                      ? localize(profile.language, 'French Translation (Spoken Aloud)', 'الترجمة الفرنسية (المنطوقة)')
                      : localize(profile.language, 'Translation for You', 'الترجمة لك')}
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopy(interpreterMode === 'traveler-speaks' ? translatedResult.frText : (isAr ? translatedResult.arText : translatedResult.enText))}
                      className="p-2 rounded-xl bg-surface-1 border border-border text-text-muted hover:text-primary transition-all"
                      title="Copy"
                    >
                      {copiedText ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() =>
                        setFullscreenCard({
                          fr: translatedResult.frText,
                          ar: translatedResult.arText,
                          en: translatedResult.enText,
                          arPhonetic: translatedResult.phonetic
                        })
                      }
                      className="p-2 rounded-xl bg-surface-1 border border-border text-text-muted hover:text-primary transition-all flex items-center gap-1 text-xs font-bold"
                      title="Show Giant Fullscreen Card to French person"
                    >
                      <Maximize2 className="w-4 h-4" />
                      <span className="hidden sm:inline">
                        {localize(profile.language, 'Show Fullscreen Card', 'عرض بطاقة مكبرة')}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Big Display Text */}
                <div className="p-5 rounded-2xl bg-bg-card border border-border/80 space-y-3">
                  <div className="text-xl md:text-2xl font-black text-text-main leading-relaxed">
                    {translatedResult.frText}
                  </div>

                  {translatedResult.phonetic && (
                    <div className="text-xs font-bold text-amber-500 bg-amber-500/10 px-3 py-1.5 rounded-xl inline-block">
                      🗣️ {localize(profile.language, 'How to Pronounce (Arabic):', 'طريقة النطق بالعربية:')}{' '}
                      <span className="text-sm font-black">{translatedResult.phonetic}</span>
                    </div>
                  )}

                  <div className="border-t border-border pt-3 text-sm text-text-muted flex flex-col gap-1">
                    <div className="font-medium text-text-main">{translatedResult.arText}</div>
                    <div className="text-xs text-text-muted">{translatedResult.enText}</div>
                  </div>
                </div>

                {/* Speak Again Button */}
                <div className="flex justify-end">
                  <button
                    onClick={() => speakText(translatedResult.frText, 'French')}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-primary text-white hover:bg-primary-press flex items-center gap-2"
                  >
                    <Volume2 className="w-4 h-4" />
                    <span>{localize(profile.language, 'Repeat in French', 'إعادة النطق بالفرنسية')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: SPOKEN TRAVEL PHRASEBOOK WITH ARABIC PHONETICS */}
        {/* ========================================================= */}
        {activeTab === 'phrasebook' && (
          <div className="max-w-5xl mx-auto space-y-6">
            {/* Category Filter Pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar">
              {[
                { id: 'all', label: localize(profile.language, 'All Phrases', 'كل العبارات'), icon: Sparkles },
                { id: 'polite', label: localize(profile.language, 'Politeness & Etiquette', 'اللباقة والإتيكيت'), icon: Smile },
                { id: 'cafe', label: localize(profile.language, 'Café & Dining', 'المقاهي والمطاعم'), icon: Coffee },
                { id: 'metro', label: localize(profile.language, 'Metro & Trains', 'المترو والقطارات'), icon: Train },
                { id: 'hotel', label: localize(profile.language, 'Hotel & Luggage', 'الفندق والإقامة'), icon: Hotel },
                { id: 'health', label: localize(profile.language, 'Pharmacy & Health', 'الصيدلية والصحة'), icon: HeartPulse },
                { id: 'shopping', label: localize(profile.language, 'Shopping & Stores', 'التسوق والمتاجر'), icon: ShoppingBag },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setSelectedCategory(id)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl whitespace-nowrap transition-all ${
                    selectedCategory === id
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-surface-2 border border-border text-text-muted hover:text-text-main'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={localize(
                  profile.language,
                  'Search in French, Arabic or English (e.g. café, metro, addition, صيدلية, حساب)...',
                  'ابحث بالفرنسية أو العربية أو الإنجليزية (مثلاً: قهوة، مترو، حساب، l\'addition)...'
                )}
                className="w-full bg-surface-1 border border-border rounded-2xl px-4 py-3 text-xs focus:border-primary outline-none"
              />
            </div>

            {/* Phrases Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredPhrases.map((phrase) => (
                <div
                  key={phrase.id}
                  className="p-5 rounded-3xl bg-surface-1 border border-border hover:border-primary/40 transition-all flex flex-col justify-between space-y-4 shadow-sm"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-base font-black text-text-main leading-snug">
                        {phrase.fr}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleSpeakPhrase(phrase)}
                          className={`p-2 rounded-xl transition-all ${
                            speakingPhraseId === phrase.id
                              ? 'bg-primary text-white shadow-sm'
                              : 'bg-surface-2 hover:bg-primary-soft hover:text-primary text-text-muted'
                          }`}
                          title="Listen in French"
                        >
                          <Volume2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setFullscreenCard(phrase)}
                          className="p-2 rounded-xl bg-surface-2 hover:bg-surface-3 text-text-muted hover:text-text-main"
                          title="Show Fullscreen Card"
                        >
                          <Maximize2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Phonetic Pronunciation Guide */}
                    <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs">
                      <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
                        {localize(profile.language, 'Arabic Pronunciation Guide:', 'النطق الصوتي بالحروف العربية:')}
                      </div>
                      <div className="text-sm font-black text-amber-700 dark:text-amber-300 mt-0.5">
                        {phrase.arPhonetic}
                      </div>
                    </div>

                    {/* Translations */}
                    <div className="text-xs space-y-1 pt-1 text-text-muted">
                      <div className="font-semibold text-text-main">{phrase.ar}</div>
                      <div className="text-[11px] opacity-75">{phrase.en}</div>
                    </div>
                  </div>

                  {phrase.notes && (
                    <div className="text-[11px] text-primary bg-primary/5 border border-primary/15 rounded-xl px-3 py-1.5 flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 shrink-0" />
                      <span>{phrase.notes}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: FRANCE EMERGENCY DIALERS & SOS VOICE */}
        {/* ========================================================= */}
        {activeTab === 'emergency' && (
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Urgent Warning */}
            <div className="p-5 rounded-3xl bg-rose-500/10 border border-rose-500/25 flex items-start gap-3.5 text-rose-500">
              <AlertOctagon className="w-6 h-6 shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed space-y-1">
                <div className="font-black text-sm">
                  {localize(profile.language, 'Emergency Numbers in France (Free 24/7):', 'أرقام الطوارئ في فرنسا (مجانية 24/7):')}
                </div>
                <p>
                  {localize(
                    profile.language,
                    'If you are in danger or need medical help in France, these official emergency numbers work from any mobile phone even without roaming or a local SIM.',
                    'في حال الخطر أو الطوارئ الطبية في فرنسا، هذه الأرقام الرسمية تعمل من أي هاتف محمول حتى بدون شريحة فرنسية أو تجوال.'
                  )}
                </p>
              </div>
            </div>

            {/* Spoken SOS Broadcast */}
            <div className="p-6 rounded-3xl bg-surface-1 border border-border space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-text-main">
                    {localize(profile.language, 'Spoken SOS Emergency Announcement', 'نداء الطوارئ الصوتي بالفرنسية')}
                  </h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    {localize(
                      profile.language,
                      'Tap to announce an urgent medical emergency in clear French at maximum volume',
                      'اضغط لإطلاق نداء استغاثة طبي بالفرنسية بصوت واضح وعالٍ'
                    )}
                  </p>
                </div>

                <button
                  onClick={() => {
                    speakText("Bonjour, c'est une urgence médicale, nous avons besoin d'aide immédiatement s'il vous plaît !", 'French');
                  }}
                  className="px-5 py-3 rounded-2xl bg-rose-500 text-white font-black text-xs flex items-center gap-2 hover:bg-rose-600 active:scale-95 shadow-lg shadow-rose-500/20"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>{localize(profile.language, 'Play SOS Audio', 'تشغيل نداء الاستغاثة')}</span>
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-bg-card border border-border text-xs font-mono text-text-muted">
                "Bonjour, c'est une urgence médicale, nous avons besoin d'aide immédiatement s'il vous plaît !"
                <span className="block mt-1 text-text-main font-sans text-xs">
                  (مرحبًا، هذه حالة طوارئ طبية، نحتاج لمساعدة عاجلة فورًا من فضلكم!)
                </span>
              </div>
            </div>

            {/* Emergency Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {EMERGENCY_SERVICES.map((srv) => (
                <div
                  key={srv.number}
                  className={`p-5 rounded-3xl border flex items-center justify-between gap-4 ${srv.color}`}
                >
                  <div className="space-y-1">
                    <div className="text-2xl font-black">{srv.number}</div>
                    <div className="text-xs font-bold text-text-main">{srv.name}</div>
                    <div className="text-[11px] text-text-muted">{srv.descAr}</div>
                    <div className="text-[10px] opacity-75">{srv.descEn}</div>
                  </div>

                  <a
                    href={`tel:${srv.number}`}
                    className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 text-text-main shadow-md hover:scale-105 active:scale-95 transition-all shrink-0 flex items-center gap-2 text-xs font-black"
                  >
                    <Phone className="w-4 h-4 text-emerald-500" />
                    <span>{localize(profile.language, 'Call', 'اتصال')}</span>
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ========================================================= */}
      {/* FULLSCREEN FLASHCARD MODAL (FOR SHOWING TO FRENCH LOCALS) */}
      {/* ========================================================= */}
      {fullscreenCard && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex flex-col justify-between p-6 md:p-12 animate-fadeIn"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white/70 text-xs font-bold">
              <span>🇫🇷</span>
              <span>
                {localize(
                  profile.language,
                  'Show this screen to the French person:',
                  'وجّه هذه الشاشة للشخص الفرنسي:'
                )}
              </span>
            </div>

            <button
              onClick={() => setFullscreenCard(null)}
              className="p-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs flex items-center gap-2"
            >
              <Minimize2 className="w-5 h-5" />
              <span>{localize(profile.language, 'Close', 'إغلاق')}</span>
            </button>
          </div>

          <div className="my-auto max-w-4xl mx-auto w-full text-center space-y-8">
            <div className="text-3xl md:text-5xl lg:text-6xl font-black text-white leading-tight tracking-tight">
              {fullscreenCard.fr}
            </div>

            {fullscreenCard.arPhonetic && (
              <div className="inline-block px-5 py-2.5 rounded-2xl bg-amber-500/20 text-amber-300 text-lg md:text-xl font-black">
                🗣️ {fullscreenCard.arPhonetic}
              </div>
            )}

            <div className="space-y-2 pt-4 border-t border-white/10">
              <div className="text-lg md:text-2xl text-slate-300 font-semibold">
                {fullscreenCard.ar}
              </div>
              <div className="text-sm md:text-base text-slate-500">
                {fullscreenCard.en}
              </div>
            </div>
          </div>

          <div className="flex justify-center gap-4">
            <button
              onClick={() => speakText(fullscreenCard.fr, 'French')}
              className="px-8 py-4 rounded-2xl bg-primary text-white text-sm font-black flex items-center gap-3 shadow-xl hover:scale-105 active:scale-95 transition-all"
            >
              <Volume2 className="w-5 h-5" />
              <span>{localize(profile.language, 'Speak in French Aloud', 'نطق بالفرنسية بصوت عالٍ')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
