
export type TranslationKey = 
  | 'appName'
  | 'onboardingTitle'
  | 'onboardingSubtitle'
  | 'continue'
  | 'back'
  | 'finish'
  | 'profile'
  | 'chat'
  | 'intelligence'
  | 'settings'
  | 'language'
  | 'accessibilityMode'
  | 'userRole'
  | 'fieldOfStudy'
  | 'iqScore'
  | 'saveChanges'
  | 'edit'
  | 'logout'
  | 'typeMessage'
  | 'analyzing'
  | 'qualityScore'
  | 'history'
  | 'noMessages'
  | 'brainstorm'
  | 'explain'
  | 'summarize'
  | 'student'
  | 'professional'
  | 'medicine'
  | 'engineering'
  | 'business'
  | 'general'
  | 'other'
  | 'none'
  | 'speech'
  | 'visual'
  | 'vocalDeaf'
  | 'signOnly'
  | 'cognitiveGrowth'
  | 'recentLogic'
  | 'newThread'
  | 'chatSession'
  | 'dashboard'
  | 'logicTraining'
  | 'myProfile'
  | 'academicProfile'
  | 'accountDetails'
  | 'difficultyLevel'
  | 'features'
  | 'mainNavigation'
  | 'clearAll'
  | 'chatHistory'
  | 'sandbox'
  | 'returnToChat'
  | 'estimatedIq'
  | 'growthSuggestion'
  | 'growthText'
  | 'totalPoints'
  | 'progressIncreasing'
  | 'intelligenceLevel'
  | 'accessibilityProfiles'
  | 'disabilityModeTitle'
  | 'disabilityModeSubtitle'
  | 'aiAssistant'
  | 'preferences'
  | 'signStudio'
  | 'standardProtocol'
  | 'accessibilityModeDescription'
  | 'trackingActive'
  | 'meritPoints'
  | 'growthIndex'
  | 'progressionCurve'
  | 'noData'
  | 'cognitiveDistribution'
  | 'integration'
  | 'validatedProfile'
  | 'recalibration'
  | 'recalibrationDesc'
  | 'nextAvailable'
  | 'analyticsSubtitle';

export const translations: Record<string, Record<TranslationKey, string>> = {
  English: {
    appName: 'Cognify AI',
    onboardingTitle: 'Welcome to Cognify',
    onboardingSubtitle: 'Personalized AI coaching for logic and accessibility.',
    continue: 'Continue',
    back: 'Back',
    finish: 'Get Started',
    profile: 'Profile',
    chat: 'Chat',
    intelligence: 'Intelligence',
    settings: 'Settings',
    language: 'Language',
    accessibilityMode: 'Accessibility Mode',
    userRole: 'User Role',
    fieldOfStudy: 'Field of Study',
    iqScore: 'IQ Score',
    saveChanges: 'Save Changes',
    edit: 'Edit',
    logout: 'Logout',
    typeMessage: 'Type your message...',
    analyzing: 'AI is thinking...',
    qualityScore: 'Quality Score',
    history: 'History',
    noMessages: 'No messages yet. Start a conversation!',
    brainstorm: 'Brainstorm',
    explain: 'Explain',
    summarize: 'Summarize',
    student: 'Student',
    professional: 'Professional',
    medicine: 'Medicine',
    engineering: 'Engineering',
    business: 'Business',
    general: 'General',
    other: 'Other',
    none: 'None',
    speech: 'Speech',
    visual: 'Visual (Blind)',
    vocalDeaf: 'Vocal/Deaf',
    signOnly: 'Sign Only',
    cognitiveGrowth: 'Cognitive Growth',
    recentLogic: 'Recent Logic Threads',
    newThread: 'New Chat',
    chatSession: 'Chat Session',
    dashboard: 'Dashboard',
    sandbox: 'Sandbox',
    logicTraining: 'Logic Training',
    myProfile: 'My Profile',
    academicProfile: 'Academic Profile',
    accountDetails: 'Account Details',
    difficultyLevel: 'Difficulty Level',
    features: 'Features',
    mainNavigation: 'Main Navigation',
    clearAll: 'Clear All',
    chatHistory: 'Chat History',
    returnToChat: 'Return to Chat',
    estimatedIq: 'Estimated IQ Score',
    growthSuggestion: 'Growth Suggestion',
    growthText: 'Your current engagement shows high technical maturity. Consider exploring how Cognitive Load Theory could further refine your interactions in the {field} domain.',
    totalPoints: 'Total Points',
    progressIncreasing: 'Progress Increasing',
    intelligenceLevel: 'Intelligence Level',
    accessibilityProfiles: 'Accessibility Profiles',
    disabilityModeTitle: 'Accessibility Hub',
    disabilityModeSubtitle: 'Empowering all neuro-diverse and differently-abled individuals.',
    aiAssistant: 'AI Assistant',
    preferences: 'Preferences',
    signStudio: 'Sign Studio',
    standardProtocol: 'Standard Protocol',
    accessibilityModeDescription: 'Select an interaction mode. The interface will adapt dynamically to empower your workflow.',
    trackingActive: 'Tracking Active',
    meritPoints: 'Merit Points',
    growthIndex: 'Growth Index',
    progressionCurve: 'Intelligence Progression Curve',
    noData: 'No spectral data detected',
    cognitiveDistribution: 'Cognitive Distribution',
    integration: 'Integration',
    validatedProfile: 'Validated Profile',
    recalibration: 'Recalibration',
    recalibrationDesc: 'System allows assessment retakes every 30 days to ensure validity.',
    nextAvailable: 'Next available:',
    analyticsSubtitle: 'Analytics and intelligence tracking over time.'
  },
  Arabic: {
    appName: 'كوجنيفي AI',
    onboardingTitle: 'مرحباً بك في كوجنيفي',
    onboardingSubtitle: 'تدريب ذكاء اصطناعي مخصص للمنطق وإمكانية الوصول.',
    continue: 'استمرار',
    back: 'رجوع',
    finish: 'ابدأ الآن',
    profile: 'الملف الشخصي',
    chat: 'المحادثة',
    intelligence: 'الذكاء',
    settings: 'الإعدادات',
    language: 'اللغة',
    accessibilityMode: 'وضع إمكانية الوصول',
    userRole: 'دور المستخدم',
    fieldOfStudy: 'مجال الدراسة',
    iqScore: 'درجة الذكاء (IQ)',
    saveChanges: 'حفظ التغييرات',
    edit: 'تعديل',
    logout: 'تسجيل الخروج',
    typeMessage: 'اكتب رسالتك هنا...',
    analyzing: 'الذكاء الاصطناعي يفكر...',
    qualityScore: 'درجة الجودة',
    history: 'السجل',
    noMessages: 'لا توجد رسائل بعد. ابدأ محادثة!',
    brainstorm: 'عصف ذهني',
    explain: 'اشرح لي',
    summarize: 'لخص لي',
    student: 'طالب',
    professional: 'محترف',
    medicine: 'الطب',
    engineering: 'الهندسة',
    business: 'الأعمال',
    general: 'عام',
    other: 'آخر',
    none: 'بدون',
    speech: 'صوتي',
    visual: 'بصري (للمكفوفين)',
    vocalDeaf: 'إشاري/صم',
    signOnly: 'لغة الإشارة فقط',
    cognitiveGrowth: 'النمو المعرفي',
    recentLogic: 'محادثات المنطق الأخيرة',
    newThread: 'محادثة جديدة',
    chatSession: 'جلسة محادثة',
    dashboard: 'لوحة القيادة',
    sandbox: 'ساحة العمل',
    logicTraining: 'تدريب المنطق',
    myProfile: 'ملفي الشخصي',
    academicProfile: 'الملف الأكاديمي',
    accountDetails: 'تفاصيل الحساب',
    difficultyLevel: 'مستوى الصعوبة',
    features: 'المميزات',
    mainNavigation: 'القائمة الرئيسية',
    clearAll: 'مسح الكل',
    chatHistory: 'سجل المحادثات',
    returnToChat: 'العودة للمحادثة',
    estimatedIq: 'درجة الذكاء المتوقعة',
    growthSuggestion: 'اقتراح للنمو المعرفي',
    growthText: 'مشاركتك الحالية تظهر نضجاً تقنياً عالياً. فكر في كيفية استخدام "نظرية الحمل المعرفي" لتحسين تفاعلاتك في مجال {field}.',
    totalPoints: 'إجمالي النقاط',
    progressIncreasing: 'التقدم مستمر',
    intelligenceLevel: 'مستوى الذكاء',
    accessibilityProfiles: 'ملفات إمكانية الوصول',
    disabilityModeTitle: 'مركز إمكانية الوصول',
    disabilityModeSubtitle: 'تمكين جميع الأفراد ذوي التنوع العصبي والقدرات المختلفة.',
    aiAssistant: 'مساعد الذكاء الاصطناعي',
    preferences: 'التفضيلات',
    signStudio: 'استوديو الإشارة',
    standardProtocol: 'البروتوكول القياسي',
    accessibilityModeDescription: 'اختر وضع التفاعل. ستتكيف الواجهة ديناميكياً لتمكين سير عملك.',
    trackingActive: 'التتبع نشط',
    meritPoints: 'نقاط الاستحقاق',
    growthIndex: 'مؤشر النمو',
    progressionCurve: 'منحنى تقدم الذكاء',
    noData: 'لم يتم اكتشاف بيانات طيفية',
    cognitiveDistribution: 'التوزيع المعرفي',
    integration: 'تكامل',
    validatedProfile: 'ملف معتمد',
    recalibration: 'إعادة المعايرة',
    recalibrationDesc: 'يسمح النظام بإعادة إجراء التقييم كل 30 يومًا لضمان الصلاحية.',
    nextAvailable: 'الموعد القادم:',
    analyticsSubtitle: 'التحليلات وتتبع الذكاء مع مرور الوقت.'
  },
  'Egyptian Ammiya': {
    appName: 'كوجنيفي AI',
    onboardingTitle: 'نورت كوجنيفي',
    onboardingSubtitle: 'مساعد ذكاء اصطناعي معاك عشان يسهلك الدنيا.',
    continue: 'كمل',
    back: 'ارجع',
    finish: 'يلا بينا',
    profile: 'بروفايلك',
    chat: 'دردشة',
    intelligence: 'الذكاء',
    settings: 'الضبط',
    language: 'اللغة',
    accessibilityMode: 'طريقة التعامل',
    userRole: 'انت بتعمل ايه؟',
    fieldOfStudy: 'مجالك',
    iqScore: 'درجة ذكائك',
    saveChanges: 'احفظ الكلام ده',
    edit: 'عدل',
    logout: 'اخرج',
    typeMessage: 'قول اللي في نفسك...',
    analyzing: 'بفكر ثواني...',
    qualityScore: 'مستوى السؤال',
    history: 'اللي فات',
    noMessages: 'لسه مفيش كلام، ابدأ وقول أي حاجة!',
    brainstorm: 'شغل دماغك',
    explain: 'فهمني',
    summarize: 'هات من الآخر',
    student: 'طالب',
    professional: 'برنس في مجالي',
    medicine: 'طب',
    engineering: 'هندسة',
    business: 'بيزنس',
    general: 'عام',
    other: 'حاجة تانية',
    none: 'عادي',
    speech: 'صوت',
    visual: 'بصري',
    vocalDeaf: 'كلام وإشارة',
    signOnly: 'إشارة بس',
    cognitiveGrowth: 'تطورك',
    recentLogic: 'آخر كلامنا',
    newThread: 'كلام جديد',
    chatSession: 'دردشة',
    dashboard: 'الدنيا سهلة',
    sandbox: 'جرب هنا',
    logicTraining: 'تمرين دماغ',
    myProfile: 'بروفايلي',
    academicProfile: 'دراستك',
    accountDetails: 'بياناتك',
    difficultyLevel: 'المستوى',
    features: 'الحركات',
    mainNavigation: 'القائمة',
    clearAll: 'امسح كله',
    chatHistory: 'كلامنا اللي فات',
    returnToChat: 'ارجع للشات',
    estimatedIq: 'ذكاءك واصل فين',
    growthSuggestion: 'نصيحة ليك',
    growthText: 'طريقتك في الكلام بتقول إنك فاهم كويس. جرب تركز في "نظرية الحمل المعرفي" عشان تطور تركيزك أكتر في {field}.',
    totalPoints: 'نقطك كلها',
    progressIncreasing: 'ماشي في الطريق الصح',
    intelligenceLevel: 'مستوى ذكاءك',
    accessibilityProfiles: 'طرق التعامل',
    disabilityModeTitle: 'مركز الدعم',
    disabilityModeSubtitle: 'معاك عشان نسهلك كل حاجة وندعم قدراتك.',
    aiAssistant: 'المساعد الذكي',
    preferences: 'ظبط حالك',
    signStudio: 'استوديو الإشارة',
    standardProtocol: 'العادي',
    accessibilityModeDescription: 'اختار اللي يريحك في التعامل، والبرنامج هيظبط نفسه معاك.',
    trackingActive: 'شغالين تتبع',
    meritPoints: 'نقطك',
    growthIndex: 'مؤشر تطورك',
    progressionCurve: 'مستوى ذكاءك مع الوقت',
    noData: 'مفيش بيانات لسة',
    cognitiveDistribution: 'توزيع قدراتك',
    integration: 'تركيز',
    validatedProfile: 'بروفايل مأكد',
    recalibration: 'تعديل القياس',
    recalibrationDesc: 'تقدر تعيد الاختبار كل 30 يوم عشان نشوف وصلت لفين.',
    nextAvailable: 'الموعد الجاي:',
    analyticsSubtitle: 'متابعة ذكاءك وتطورك بالتفصيل.'
  }
};

export const getTranslation = (lang: string | undefined, key: TranslationKey): string => {
  const language = lang || 'English';
  return translations[language]?.[key] || translations['English'][key];
};

export const isRTL = (lang: string | undefined): boolean => {
  return lang === 'Arabic' || lang === 'Egyptian Ammiya';
};
