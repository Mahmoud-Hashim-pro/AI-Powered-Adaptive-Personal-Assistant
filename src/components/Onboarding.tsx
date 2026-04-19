import React, { useState, useEffect, useRef } from "react";
import { UserProfile, UserRole, CognitiveLevel } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { Mail, GraduationCap, Briefcase, Brain, ArrowRight, CheckCircle, Trophy, Timer, AlertCircle, Quote } from "lucide-react";
import { auth } from "../lib/firebase";

interface OnboardingProps {
  onComplete: (data: Partial<UserProfile>) => void;
}

interface Question {
  id: number;
  text: string;
  options: string[];
  correctAnswer?: string;
  isTricky?: boolean;
}

const MASTER_QUESTION_POOL: Question[] = [
  // Logic & Riddles
  { id: 1, text: "If you have two coins that total 30 cents, and one is not a nickel, what are the coins?", options: ["Penny & Quarter", "One is a Dime", "Both are Dimes", "Impossible"], correctAnswer: "TRICK", isTricky: true },
  { id: 2, text: "Continue the pattern: 1, 1, 2, 3, 5, 8, ...", options: ["11", "12", "13", "14"], correctAnswer: "13" },
  { id: 3, text: "Which word is spelled incorrectly in every dictionary?", options: ["Misspell", "Abbreviation", "Language", "None of these"], correctAnswer: "TRICK", isTricky: true },
  { id: 4, text: "A butcher is 5'10'' tall and wears size 10 shoes. What does he weigh?", options: ["180 lbs", "210 lbs", "150 lbs", "250 lbs"], correctAnswer: "TRICK", isTricky: true },
  { id: 5, text: "If 5 machines make 5 widgets in 5 minutes, how long does it take 100 machines to make 100 widgets?", options: ["100 mins", "5 mins", "50 mins", "1 min"], correctAnswer: "5 mins" },
  { id: 6, text: "How many months have 28 days?", options: ["1", "6", "None", "11"], correctAnswer: "TRICK", isTricky: true },
  { id: 7, text: "A plane crashes on the border of US and Canada. Where do you bury the survivors?", options: ["US", "Canada", "Neutral zone", "Border Line"], correctAnswer: "TRICK", isTricky: true },
  { id: 8, text: "A doctor gives you 3 pills and tells you to take one every half hour. How long stay with you?", options: ["1.5 hrs", "30 mins", "2 hrs", "90 mins"], correctAnswer: "TRICK", isTricky: true },
  { id: 9, text: "Mary’s father has 5 daughters: Nana, Nene, Nini, Nono. What is the 5th daughter's name?", options: ["Nunu", "Nono", "Nana", "Nini"], correctAnswer: "TRICK", isTricky: true },
  { id: 10, text: "What goes up but never comes down?", options: ["Smoke", "Weight", "Age", "Balloon"], correctAnswer: "Age" },
  // Math & Patterns
  { id: 11, text: "If 4+4=20, 5+5=30, 6+6=42, then what is 9+9?", options: ["70", "80", "90", "100"], correctAnswer: "90" },
  { id: 12, text: "Which number should come next in the series: 7, 10, 8, 11, 9, 12, ...", options: ["7", "10", "12", "13"], correctAnswer: "10" },
  { id: 13, text: "You pass the person in 2nd place in a race. What place are you in?", options: ["1st", "2nd", "3rd", "Last"], correctAnswer: "2nd", isTricky: true },
  { id: 14, text: "If you scramble the letters 'NEW DOOR', you get one word. What is the word?", options: ["Wonder", "Modern", "One Word", "Owner"], correctAnswer: "One Word", isTricky: true },
  { id: 15, text: "Which of the following is least like the others?", options: ["Copper", "Iron", "Brass", "Tin"], correctAnswer: "Brass" },
  { id: 16, text: "What has keys but no locks, space but no room?", options: ["Piano", "Keyboard", "Library", "Galaxy"], correctAnswer: "Keyboard" },
  { id: 17, text: "A snail is at the bottom of a 20-foot well. Each day it climbs up 3 feet, but at night it slips back 2 feet. How many days does it take to reach the top?", options: ["18", "20", "19", "17"], correctAnswer: "18" },
  { id: 18, text: "Which number is one quarter of the distance between 10 and 30?", options: ["20", "15", "25", "22.5"], correctAnswer: "15" },
  { id: 19, text: "If David’s father has three sons: Snap, Crackle, and ?", options: ["Pop", "David", "John", "Peter"], correctAnswer: "David" },
  { id: 20, text: "Light is to Darkness as Knowledge is to:", options: ["Ignorance", "Intelligence", "Books", "School"], correctAnswer: "Ignorance" }
];

const QUESTION_TIMER = 60; // 60 seconds per question

const UNIVERSITIES = [
  // Public Universities (الجامعات الحكومية)
  "Cairo University", "Ain Shams University", "Alexandria University", "Assiut University", "Tanta University",
  "Mansoura University", "Zagazig University", "Helwan University", "Minia University", "Menoufia University",
  "Suez Canal University", "South Valley University", "Benha University", "Fayoum University", "Beni-Suef University",
  "Kafrelsheikh University", "Sohag University", "Port Said University", "Damanhour University", "Aswan University",
  "Damietta University", "University of Sadat City", "Suez University", "Arish University", "New Valley University",
  "Matrouh University", "Luxor University", "Hurghada University", "Al-Azhar University",
  
  // National Universities (الجامعات الأهلية)
  "Galala University", "King Salman International University", "Alamein International University",
  "New Mansoura University", "Nile University", "Egypt University of Informatics (EUI)",
  "Alexandria National University", "Assiut National University", "Menoufia National University",
  "Zagazig National University", "Benha National University", "Beni-Suef National University",
  "South Valley National University",
  
  // Private Universities (الجامعات الخاصة)
  "AUC (American University in Cairo)", "GUC (German University in Cairo)", "BUE (British University in Egypt)",
  "MIU (Misr International University)", "MUST (Misr University for Science and Technology)", "O6U (October 6 University)",
  "MSA University", "Future University in Egypt (FUE)", "Badr University in Cairo (BUC)", "Nahda University",
  "Pharos University", "Delta University for Science and Technology", "Heliopolis University", "Sinai University",
  "New Giza University (NGU)", "Deraya University", "Ahram Canadian University (ACU)", "Horus University",
  "Egyptian Russian University (ERU)", "Egyptian Chinese University (ECU)",
  
  // International Branches (الجامعات الدولية / الفروع الأجنبية)
  "German International University (GIU)", "French University in Egypt (UFE)", "European Universities in Egypt (EUE)",
  "University of Hertfordshire (Egypt Branch)", "Coventry University (Egypt Branch)", "University of London (Egypt Branch)",
  
  // Technological Universities (الجامعات التكنولوجية)
  "New Cairo Technological University", "Delta Technological University", "Beni-Suef Technological University",
  "East Port Said Technological University", "6th of October Technological University", "Borg El Arab Technological University",
  "Assiut Technological University",
  
  "Other"
];

const FACULTIES = [
  "Medicine (طب بشري)", "Dentistry (طب أسنان)", "Pharmacy (صيدلة)", "Physical Therapy (علاج طبيعي)", 
  "Nursing (تمريض)", "Engineering (هندسة)", "Computer Science & IT (حاسبات ومعلومات)", 
  "Artificial Intelligence (ذكاء اصطناعي)", "Science (علوم)", "Business / Commerce (تجارة)", 
  "Economics & Political Science (اقتصاد وعلوم سياسية)", "Mass Communication (إعلام)", 
  "Arts / Humanities (آداب)", "Law (حقوق)", "Education (تربية)", "Agriculture (زراعة)", 
  "Tourism and Hotels (سياحة وفنادق)", "Fine Arts (فنون جميلة)", "Applied Arts (فنون تطبيقية)", 
  "Physical Education (تربية رياضية)", "Languages / Al-Alsun (ألسن)", "Archaeology (آثار)", "Other"
];

const WORKPLACES = [
  "Tech Startup", "Corporate Enterprise", "Medical Center / Hospital", 
  "Government Agency", "Freelance / Self-employed", "NGO / Non-profit", 
  "Banking & Finance", "Education / Research", "Construction / Engineering Firm", 
  "Retail", "Hospitality", "Manufacturing", "Other"
];

const JOB_TITLES = [
  "Software Engineer", "Business Analyst", "Marketing Specialist", 
  "Medical Doctor", "Pharmacist", "Designer", "Content Creator", 
  "Project Manager", "Data Scientist", "Research Lead", "Consultant", 
  "Teacher / Professor", "Accountant", "Sales Representative", "Other"
];

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(2);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [quizQuestions, setQuizQuestions] = useState<Question[]>([]);
  const [questionTimeLeft, setQuestionTimeLeft] = useState(QUESTION_TIMER);
  
  const [formData, setFormData] = useState<Partial<UserProfile>>({
    email: auth.currentUser?.email || "",
    role: "Student",
    university: "",
    faculty: "",
    work: "",
    jobTitle: "",
    points: 100,
    questionHistory: [],
    onboardingComplete: false
  });
  
  const [quizStartTime, setQuizStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
  const [userPOVs, setUserPOVs] = useState<Record<number, string>>({});
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const questionTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Shuffle and pick 15 questions
    const shuffled = [...MASTER_QUESTION_POOL].sort(() => 0.5 - Math.random());
    setQuizQuestions(shuffled.slice(0, 15));
  }, []);

  useEffect(() => {
    if (step === 3) {
      // Overall timer
      if (!quizStartTime) setQuizStartTime(Date.now());
      timerRef.current = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);

      // Per-question timer
      setQuestionTimeLeft(QUESTION_TIMER);
      questionTimerRef.current = setInterval(() => {
        setQuestionTimeLeft(prev => {
          if (prev <= 1) {
            handleAnswerSelect("TIMEOUT"); // Auto-skip on timeout
            return QUESTION_TIMER;
          }
          return prev - 1;
        });
      }, 1000);
    }
    
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (questionTimerRef.current) clearInterval(questionTimerRef.current);
    };
  }, [step, currentQIndex]);

  const handleNextStep = () => setStep(step + 1);

  const handleAnswerSelect = (answer: string) => {
    setUserAnswers(prev => ({ ...prev, [quizQuestions[currentQIndex].id]: answer }));
    handleNextQuestion();
  };

  const handleNextQuestion = () => {
    if (questionTimerRef.current) clearInterval(questionTimerRef.current);
    
    if (currentQIndex < quizQuestions.length - 1) {
      setCurrentQIndex(currentQIndex + 1);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setStep(4); // Results step
    }
  };

  const calculateResults = () => {
    let correctCount = 0;
    quizQuestions.forEach(q => {
      if (userAnswers[q.id] === q.correctAnswer) {
        correctCount++;
      }
    });

    const totalPossible = quizQuestions.length;
    const scorePercentage = (correctCount / totalPossible) * 100;
    
    // Improved IQ Calculation Logic
    // Accuracy-focus as requested, ignoring total speed but strictly validating responses.
    const baseIq = 70;
    const iqPerQuestion = 5.5; // (15 * 5.5) + 70 = ~152 max
    const finalIq = Math.round(baseIq + (correctCount * iqPerQuestion));

    // Cognitive Level Determination based on normalized scales
    let finalLevel: CognitiveLevel = 'Basic';
    if (finalIq >= 135) finalLevel = 'Advanced';
    else if (finalIq >= 105) finalLevel = 'Intermediate';

    return {
      score: finalIq,
      level: finalLevel,
      correctCount,
      percentage: scorePercentage,
      lastQuizDate: new Date().toISOString()
    };
  };

  const renderResults = () => {
    const results = calculateResults();
    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center gap-8 w-full max-w-lg bg-white p-6 md:p-10 rounded-3xl shadow-2xl border border-border"
      >
        <div className="w-20 h-20 bg-primary/10 rounded-2xl flex items-center justify-center text-primary mb-2">
          <Trophy className="w-10 h-10" />
        </div>
        
        <div className="text-center space-y-2">
          <h2 className="text-4xl font-black text-text-main tracking-tighter">Test Complete</h2>
          <p className="text-text-muted font-medium">Your initial profile has been successfully generated.</p>
        </div>

        <div className="grid grid-cols-2 gap-4 w-full">
          <div className="bg-bg-main p-6 rounded-2xl border border-border flex flex-col items-center">
            <span className="text-[10px] uppercase font-black text-text-muted tracking-widest mb-1">IQ Score</span>
            <span className="text-3xl font-black text-primary">{results.score}</span>
          </div>
          <div className="bg-bg-main p-6 rounded-2xl border border-border flex flex-col items-center">
            <span className="text-[10px] uppercase font-black text-text-muted tracking-widest mb-1">Intelligence Level</span>
            <span className={`text-xl font-bold uppercase ${
              results.level === 'Advanced' ? 'text-purple-600' : 
              results.level === 'Intermediate' ? 'text-blue-600' : 'text-orange-600'
            }`}>
              {results.level}
            </span>
          </div>
        </div>

        <div className="w-full space-y-3">
          <div className="flex justify-between text-xs font-bold uppercase text-text-muted">
            <span>Accuracy</span>
            <span>{results.correctCount}/{quizQuestions.length}</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${results.percentage}%` }} />
          </div>
          <div className="flex justify-between text-[10px] font-bold text-slate-400">
            <span>Time Taken: {Math.floor(elapsedTime / 60)}m {elapsedTime % 60}s</span>
            <span>Test Integrity: 100%</span>
          </div>
        </div>

        <button
          onClick={() => onComplete({ 
            ...formData, 
            iqScore: results.score, 
            level: results.level, 
            quizDuration: elapsedTime,
            lastQuizDate: results.lastQuizDate,
            onboardingComplete: true 
          })}
          className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-black transition-all flex items-center justify-center gap-2 group"
        >
          Initialize Account <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </button>
      </motion.div>
    );
  };

  const validateEmail = (email: string | undefined) => {
    return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const renderRoleStep = () => (
    <motion.div 
      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
      className="flex flex-col gap-6 w-full max-w-lg"
    >
      <div className="space-y-2 text-center">
        <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 leading-tight">Profession</h2>
        <p className="text-slate-500">What is your current occupation?</p>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        {(["Student", "Professional"] as UserRole[]).map((r) => (
          <button
            key={r}
            onClick={() => setFormData({ ...formData, role: r })}
            className={`flex flex-col items-center gap-4 p-6 rounded-2xl border-2 transition-all ${
              formData.role === r 
                ? 'border-primary bg-primary/5 text-primary' 
                : 'border-border bg-white text-slate-400 hover:border-primary/20'
            }`}
          >
            {r === "Student" ? <GraduationCap className="w-10 h-10" /> : <Briefcase className="w-10 h-10" />}
            <span className="font-bold text-sm uppercase tracking-wider">{r}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">
              {formData.role === "Student" ? "Educational Institution" : "Primary Workspace"}
            </label>
            <select
              className="w-full bg-white border border-border rounded-xl px-4 py-3 shadow-sm focus:ring-4 focus:ring-primary/5 focus:border-primary outline-none transition-all text-sm appearance-none cursor-pointer"
              value={formData.role === "Student" ? (UNIVERSITIES.includes(formData.university || "") ? formData.university : "Other") : (WORKPLACES.includes(formData.work || "") ? formData.work : "Other")}
              onChange={(e) => {
                const val = e.target.value;
                setFormData({ 
                  ...formData, 
                  [formData.role === "Student" ? "university" : "work"]: val === "Other" ? "" : val 
                });
              }}
            >
              <option value="" disabled>Select {formData.role === "Student" ? "University" : "Entity"}</option>
              {(formData.role === "Student" ? UNIVERSITIES : WORKPLACES).map(item => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>

          {((formData.role === "Student" && formData.university === "") || (formData.role === "Professional" && formData.work === "")) && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
               <input
                type="text"
                placeholder={formData.role === "Student" ? "Enter your University" : "Enter your Organization"}
                className="w-full bg-slate-50 border border-dashed border-slate-300 rounded-xl px-4 py-3 text-sm focus:ring-4 focus:ring-primary/5 focus:border-primary outline-none transition-all"
                value={formData.role === "Student" ? formData.university : formData.work}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  [formData.role === "Student" ? "university" : "work"]: e.target.value 
                })}
              />
            </motion.div>
          )}
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">
              {formData.role === "Student" ? "Academic Faculty" : "Operational Role"}
            </label>
            <select
              className="w-full bg-white border border-border rounded-xl px-4 py-3 shadow-sm focus:ring-4 focus:ring-primary/5 focus:border-primary outline-none transition-all text-sm appearance-none cursor-pointer"
              value={formData.role === "Student" ? (FACULTIES.includes(formData.faculty || "") ? formData.faculty : "Other") : (JOB_TITLES.includes(formData.jobTitle || "") ? formData.jobTitle : "Other")}
              onChange={(e) => {
                const val = e.target.value;
                setFormData({ 
                  ...formData, 
                  [formData.role === "Student" ? "faculty" : "jobTitle"]: val === "Other" ? "" : val 
                });
              }}
            >
              <option value="" disabled>Select {formData.role === "Student" ? "Faculty" : "Title"}</option>
              {(formData.role === "Student" ? FACULTIES : JOB_TITLES).map(item => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>

          {((formData.role === "Student" && formData.faculty === "") || (formData.role === "Professional" && formData.jobTitle === "")) && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
               <input
                type="text"
                placeholder={formData.role === "Student" ? "Enter Faculty/Major" : "Enter Job Title"}
                className="w-full bg-slate-50 border border-dashed border-slate-300 rounded-xl px-4 py-3 text-sm focus:ring-4 focus:ring-primary/5 focus:border-primary outline-none transition-all"
                value={formData.role === "Student" ? formData.faculty : formData.jobTitle}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  [formData.role === "Student" ? "faculty" : "jobTitle"]: e.target.value 
                })}
              />
            </motion.div>
          )}
        </div>
      </div>

      <button
        onClick={handleNextStep}
        disabled={formData.role === "Student" 
          ? (!formData.university || !formData.faculty) 
          : (!formData.work || !formData.jobTitle)
        }
        className="w-full bg-primary text-white font-bold py-4 rounded-xl shadow-lg hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 transition-all flex items-center justify-center gap-2 group"
      >
        Start Initial Quiz <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
      </button>
    </motion.div>
  );

  const renderQuizStep = () => {
    if (!quizQuestions.length) return null;
    const q = quizQuestions[currentQIndex];
    if (!q) return null;
    const progress = ((currentQIndex + 1) / quizQuestions.length) * 100;
    
    return (
      <motion.div 
        key={q.id}
        initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col gap-6 w-full max-w-2xl bg-white p-6 md:p-10 rounded-3xl shadow-2xl border border-border overflow-hidden relative"
      >
        <div className="absolute top-0 left-0 h-1.5 bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
        
        <div className="flex justify-between items-start mb-4">
          <div className="space-y-1">
            <span className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Quiz Question {currentQIndex + 1}/15</span>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-text-muted text-xs font-bold">
                <Timer className="w-3.5 h-3.5" />
                {Math.floor(elapsedTime / 60)}:{String(elapsedTime % 60).padStart(2, '0')}
              </div>
              <div className="flex items-center gap-2 text-amber-600 text-xs font-black bg-amber-50 px-3 py-1 rounded-lg border border-amber-100">
                LAPSING: {questionTimeLeft}s
              </div>
            </div>
          </div>
          {q.isTricky && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-purple-50 text-purple-700 rounded-lg border border-purple-200 text-[10px] font-bold uppercase animate-pulse">
              <AlertCircle className="w-3 h-3" /> Logic Anomaly Detected
            </div>
          )}
        </div>

        <h3 className="text-2xl font-bold text-text-main leading-snug mb-4">
          {q.text}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          {q.options.map(opt => (
            <button
              key={opt}
              onClick={() => handleAnswerSelect(opt)}
              className={`text-left px-6 py-4 rounded-xl border-2 transition-all ${
                userAnswers[q.id] === opt 
                  ? 'border-primary bg-primary/5 text-primary font-bold shadow-md scale-[1.02]' 
                  : 'border-border bg-white text-text-muted hover:border-primary/20 hover:bg-slate-50'
              }`}
            >
              {opt}
            </button>
          ))}
          <button
            onClick={() => handleAnswerSelect("TRICK")}
            className={`text-left px-6 py-4 rounded-xl border-2 transition-all flex items-center gap-3 ${
              userAnswers[q.id] === "TRICK" 
                ? 'border-purple-600 bg-purple-50 text-purple-700 font-bold' 
                : 'border-dashed border-border bg-white text-slate-400 hover:border-purple-200'
            }`}
          >
             <Brain className="w-4 h-4" /> Point of View Assessment
          </button>
        </div>

        {userAnswers[q.id] === "TRICK" && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            className="space-y-3 mb-4"
          >
            <textarea
              placeholder="Justify your identification of this logic anomaly..."
              className="w-full bg-purple-50/50 border border-purple-100 rounded-xl p-4 text-sm text-purple-900 focus:ring-4 focus:ring-purple-100 focus:border-purple-300 outline-none transition-all min-h-[80px] resize-none"
              value={userPOVs[q.id] || ""}
              onChange={(e) => setUserPOVs({ ...userPOVs, [q.id]: e.target.value })}
            />
          </motion.div>
        )}

        <button
          onClick={handleNextQuestion}
          disabled={!userAnswers[q.id]}
          className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-black disabled:bg-slate-200 disabled:text-slate-400 transition-all flex items-center justify-center gap-2 group"
        >
          {currentQIndex === quizQuestions.length - 1 ? "Analyze Results" : "Confirm Answer"} 
          <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </button>
      </motion.div>
    );
  };

  return (
    <div className="fixed inset-0 bg-bg-main z-[100] flex items-center justify-center p-6 overflow-y-auto custom-scrollbar">
      {step < 4 && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 flex items-center gap-6">
          {[2, 3].map(s => (
            <div key={s} className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                step >= s ? 'bg-primary text-white' : 'bg-slate-200 text-slate-400'
              }`}>
                {s - 1}
              </div>
              {s < 3 && <div className={`w-12 h-[2px] ${step > s ? 'bg-primary' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>
      )}

      <AnimatePresence mode="wait">
        {step === 2 && renderRoleStep()}
        {step === 3 && renderQuizStep()}
        {step === 4 && renderResults()}
      </AnimatePresence>

      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 text-[10px] text-slate-400 font-mono tracking-[0.3em] uppercase">
        AI-LA Initialization
      </div>
    </div>
  );
}
