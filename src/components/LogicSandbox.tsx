import React, { useState, useEffect, useRef } from 'react';
import { UserProfile, Message } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Brain, Sparkles, Target, Zap, ChevronRight, HelpCircle, Lightbulb, Menu, Send, Loader2, ArrowLeft } from 'lucide-react';
import { generateLogicResponse } from '../services/gemini';
import Markdown from 'react-markdown';
import { getTranslation } from '../lib/translations';

interface LogicSandboxProps {
  profile: UserProfile;
  onMenuClick?: () => void;
}

export default function LogicSandbox({ profile, onMenuClick }: LogicSandboxProps) {
  const [selectedModule, setSelectedModule] = useState<number | null>(null);
  const [isTraining, setIsTraining] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const modules = [
    {
      id: 1,
      title: 'Pattern Recognition',
      description: 'Strengthen your ability to identify complex sequences in data arrays.',
      iqRequirement: 0,
      intensity: 'Low',
      icon: Target
    },
    {
      id: 2,
      title: 'Abstract Thinking',
      description: 'Connect disparate concepts into a unified cognitive framework.',
      iqRequirement: 40,
      intensity: 'Medium',
      icon: Brain
    },
    {
      id: 3,
      title: 'Advanced IQ Prep',
      description: 'Train on high-level riddles, logical deductions, and test puzzles.',
      iqRequirement: 80,
      intensity: 'Extreme',
      icon: Zap
    }
  ];

  const getActiveModule = () => modules.find(m => m.id === selectedModule);

  const startTraining = async () => {
    if (!selectedModule) return;
    setIsTraining(true);
    setIsLoading(true);
    setMessages([]);
    
    const activeMod = getActiveModule();
    try {
      const response = await generateLogicResponse(
        `Hello, I would like to start training my "${activeMod?.title}". Before giving me a puzzle, please briefly introduce the concept we are focusing on and check if I'm ready to begin processing this logically.`, 
        profile, 
        activeMod?.title || "Logic"
      );
      
      setMessages([{
        id: Date.now().toString(),
        role: 'assistant',
        content: response,
        timestamp: new Date().toISOString()
      }]);
    } catch (err) {
      console.error(err);
      setMessages([{
        id: Date.now().toString(),
        role: 'assistant',
        content: "Error initializing training module. Please try again.",
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString()
    };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');
    setIsLoading(true);

    try {
      const formattedHistory = messages.map(m => ({
        role: m.role === 'user' ? 'user' as const : 'model' as const,
        parts: [{ text: m.content }]
      }));

      const response = await generateLogicResponse(
        userMsg.content,
        profile,
        getActiveModule()?.title || "Logic",
        formattedHistory
      );

      setMessages([...newHistory, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: new Date().toISOString()
      }]);
    } catch (err) {
      console.error(err);
      setMessages([...newHistory, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "System communication error.",
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  return (
    <div className="flex-1 h-screen overflow-y-auto bg-slate-50 p-6 md:p-10 flex flex-col gap-6 md:gap-10 custom-scrollbar">
      <header className="flex items-start gap-4 space-y-2">
        <button 
          onClick={onMenuClick}
          className="lg:hidden p-2 mt-2 text-slate-500 bg-white shadow-sm border border-slate-200 hover:bg-slate-50 rounded-lg active:scale-95 shrink-0"
        >
          <Menu className="w-6 h-6" />
        </button>
        <div>
          <h1 className="text-2xl md:text-4xl font-black text-slate-900 tracking-tighter uppercase">{getTranslation(profile.language, 'sandbox')}</h1>
          <p className="text-xs md:text-sm text-slate-500 font-medium italic mt-1">Training modules calibrated for your IQ Score: {profile.iqScore || 0}</p>
        </div>
      </header>

      <div className={`grid grid-cols-1 ${isTraining ? 'lg:grid-cols-1' : 'lg:grid-cols-2'} gap-8 flex-1 w-full max-w-6xl mx-auto min-h-0`}>
        {!isTraining && (
          <div className="space-y-6">
            <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest ml-2">Available Training Modules</div>
            <div className="flex flex-col gap-4">
              {modules.map((m) => {
                const isLocked = (profile.iqScore || 0) < m.iqRequirement;
                return (
                  <button
                    key={m.id}
                    onClick={() => !isLocked && setSelectedModule(m.id)}
                    disabled={isLocked}
                    className={`group relative text-left p-6 rounded-[32px] border transition-all ${
                      isLocked 
                        ? 'bg-slate-100 border-slate-200 grayscale opacity-60' 
                        : selectedModule === m.id 
                          ? 'bg-slate-900 border-slate-900 text-white shadow-2xl shadow-slate-200 scale-[1.02]' 
                          : 'bg-white border-slate-100 hover:border-primary shadow-sm hover:shadow-md'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`p-4 rounded-2xl ${selectedModule === m.id ? 'bg-primary' : 'bg-slate-50'}`}>
                        <m.icon className={`w-6 h-6 ${selectedModule === m.id ? 'text-white' : 'text-primary'}`} />
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between">
                          <h4 className="font-black text-sm uppercase tracking-widest">{m.title}</h4>
                          {isLocked && <div className="text-[9px] font-black bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full uppercase">IQ {m.iqRequirement}+ Required</div>}
                        </div>
                        <p className={`text-xs leading-relaxed ${selectedModule === m.id ? 'text-slate-300' : 'text-slate-500'}`}>
                          {m.description}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className={`bg-white rounded-[40px] border border-slate-200 shadow-sm flex flex-col ${isTraining ? 'flex-1 overflow-hidden h-full' : 'p-8 items-center justify-center text-center gap-6'}`}>
          <AnimatePresence mode="wait">
            {!isTraining ? (
              selectedModule ? (
                <motion.div 
                  key="preview"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6 flex flex-col items-center"
                >
                  <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center border-2 border-emerald-100">
                    <Lightbulb className="w-10 h-10 text-emerald-600 animate-pulse" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-black text-slate-900 uppercase">Module Ready</h3>
                    <p className="text-slate-500 max-w-xs mx-auto text-sm">System is primed for interactive logic training and problem-solving.</p>
                  </div>
                  <button 
                    onClick={startTraining}
                    className="mt-4 px-10 py-4 bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl hover:bg-black transition-all hover:-translate-y-1"
                  >
                    Initiate Session
                  </button>
                </motion.div>
              ) : (
                <div key="empty" className="space-y-6 flex flex-col items-center opacity-40">
                  <Brain className="w-24 h-24 text-slate-300" />
                  <div className="space-y-1">
                    <h3 className="text-xl font-black text-slate-900 uppercase">Select a Module</h3>
                    <p className="text-xs text-slate-500">Select a training module to refine your logic skills.</p>
                  </div>
                </div>
              )
            ) : (
              <motion.div 
                key="training"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col h-full w-full"
              >
                <div className="flex items-center justify-between p-6 border-b border-slate-100 shrink-0">
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={() => { setIsTraining(false); setMessages([]); }}
                      className="p-2 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-900 rounded-xl transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div>
                      <h3 className="font-black text-slate-900 tracking-tight">{getActiveModule()?.title}</h3>
                      <p className="text-xs text-primary font-bold uppercase tracking-widest flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Active Session
                      </p>
                    </div>
                  </div>
                  <div className="p-2 bg-primary/10 rounded-xl">
                    <Brain className="w-5 h-5 text-primary" />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-slate-50/50">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex max-w-[85%] ${m.role === 'user' ? 'ml-auto justify-end' : 'mr-auto justify-start'}`}>
                      <div className={`p-5 rounded-[24px] ${
                        m.role === 'user' 
                          ? 'bg-primary text-white rounded-br-sm shadow-md' 
                          : 'bg-white border border-slate-200 text-slate-700 rounded-bl-sm shadow-sm'
                      }`}>
                        <div className={`prose prose-sm max-w-none ${m.role === 'user' ? 'prose-invert' : ''}`}>
                          <Markdown>{m.content}</Markdown>
                        </div>
                      </div>
                    </div>
                  ))}
                  {isLoading && (
                    <div className="flex max-w-[85%] mr-auto justify-start">
                      <div className="p-5 rounded-[24px] bg-white border border-slate-200 rounded-bl-sm shadow-sm">
                        <Loader2 className="w-5 h-5 text-primary animate-spin" />
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div className="p-6 bg-white border-t border-slate-100 shrink-0">
                  <form onSubmit={handleSend} className="relative flex items-center">
                    <input 
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={getTranslation(profile.language, 'typeMessage')}
                      className="w-full bg-slate-50 pl-6 pr-14 py-4 rounded-2xl border border-slate-200 focus:border-primary focus:ring-4 focus:ring-primary/5 outline-none transition-all text-sm font-medium"
                      disabled={isLoading}
                    />
                    <button 
                      type="submit"
                      disabled={!input.trim() || isLoading}
                      className="absolute right-2 p-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 disabled:opacity-50 disabled:hover:bg-primary transition-colors"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </form>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="mt-auto bg-slate-900 p-8 rounded-[40px] text-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center border border-white/20">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <div className="space-y-1">
             <h4 className="text-lg font-black uppercase tracking-tighter">Logic Level: {profile.iqScore ? (profile.iqScore > 120 ? 'Savant' : profile.iqScore > 100 ? 'Analytical' : 'Standard') : 'Initializing'}</h4>
             <p className="text-white/50 text-xs font-medium italic">Based on your integrated IQ score: {profile.iqScore || 'N/A'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
             <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Next Evolution</p>
             <p className="text-sm font-black text-white">+ {150 - (profile.points % 150)} Merit Points</p>
          </div>
          <div className="w-12 h-12 rounded-full border-2 border-white/10 flex items-center justify-center">
             <ChevronRight className="w-6 h-6 text-white/40" />
          </div>
        </div>
      </div>
    </div>
  );
}
