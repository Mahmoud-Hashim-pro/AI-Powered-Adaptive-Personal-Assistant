import React, { useMemo } from 'react';
import { UserProfile } from '../types';
import { motion } from 'motion/react';
import { Brain, TrendingUp, Star, Search, ShieldCheck, BarChart3, PieChart as PieChartIcon, Activity, Menu } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { formatDate } from '../lib/utils';
import { getTranslation } from '../lib/translations';

interface IntelligenceHubProps {
  profile: UserProfile;
  onMenuClick?: () => void;
}

const IntelligenceHub = React.memo(({ profile, onMenuClick }: IntelligenceHubProps) => {
  const levelDistribution = useMemo(() => [
    { name: 'Basic', value: profile.level === 'Basic' ? 100 : 0, color: '#f97316' },
    { name: 'Intermediate', value: profile.level === 'Intermediate' ? 100 : 0, color: '#3b82f6' },
    { name: 'Advanced', value: profile.level === 'Advanced' ? 100 : 0, color: '#a855f7' },
  ].filter(d => d.value > 0), [profile.level]);

  const chartData = useMemo(() => 
    profile.questionHistory.map((h, i) => ({
      name: `${formatDate(h.date).split(',')[0]} #${i}`, // Make name unique for recharts
      score: h.score,
      fullDate: formatDate(h.date)
    })), [profile.questionHistory]);

  const growthIndex = useMemo(() => 
    ((profile.points / 2000) * 100).toFixed(1), 
    [profile.points]
  );

  return (
    <div className="flex-1 h-screen overflow-y-auto bg-slate-50 p-6 md:p-10 flex flex-col gap-6 md:gap-10 custom-scrollbar">
      <header className="flex flex-col md:flex-row justify-between md:items-end gap-4">
        <div className="flex items-start gap-4">
          <button 
            onClick={onMenuClick}
            className="lg:hidden p-2 mt-1 text-slate-500 bg-white shadow-sm border border-slate-200 hover:bg-slate-50 rounded-lg active:scale-95"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-2xl md:text-4xl font-black text-slate-900 tracking-tighter uppercase">{getTranslation(profile.language, 'dashboard')}</h1>
            <p className="text-xs md:text-sm text-slate-500 font-medium mt-1">{getTranslation(profile.language, 'analyticsSubtitle')}</p>
          </div>
        </div>
        <div className="flex self-start md:self-auto items-center gap-3 px-6 py-2 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <Activity className="w-4 h-4 text-emerald-500 animate-pulse" />
          <span className="text-xs font-black text-slate-900 uppercase tracking-widest">{getTranslation(profile.language, 'trackingActive')}</span>
        </div>
      </header>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard 
          label={getTranslation(profile.language, 'iqScore')} 
          value={profile.iqScore || 0} 
          icon={Brain} 
          color="blue"
          trend={`+${(profile.questionHistory.length * 0.5).toFixed(1)}`}
        />
        <MetricCard 
          label={getTranslation(profile.language, 'meritPoints')} 
          value={profile.points} 
          icon={Star} 
          color="amber"
          trend="Validated"
        />
        <MetricCard 
          label={getTranslation(profile.language, 'growthIndex')} 
          value={`${growthIndex}%`} 
          icon={TrendingUp} 
          color="emerald"
          trend="Upward"
        />
        <MetricCard 
          label={getTranslation(profile.language, 'difficultyLevel')} 
          value={profile.level} 
          icon={ShieldCheck} 
          color="purple"
          trend="Certified"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Progression Chart */}
        <div className="lg:col-span-2 bg-white p-8 rounded-[40px] border border-slate-200 shadow-sm min-h-[400px] flex flex-col">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-lg font-black text-slate-900 flex items-center gap-3">
              <BarChart3 className="w-5 h-5 text-primary" /> {getTranslation(profile.language, 'progressionCurve')}
            </h3>
          </div>
          
          <div className="flex-1 w-full h-full min-h-[300px]">
            {chartData.length === 0 ? (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 gap-3 border-2 border-dashed border-slate-100 rounded-[32px]">
                <Search className="w-8 h-8" />
                <p className="text-sm font-bold uppercase tracking-widest">{getTranslation(profile.language, 'noData')}</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 700}}
                    dy={10} 
                  />
                  <YAxis 
                    hide 
                    domain={[0, 10]} 
                  />
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-slate-900 text-white p-3 rounded-2xl border border-slate-800 shadow-2xl">
                            <p className="text-[10px] font-black text-slate-400 uppercase mb-1">{payload[0].payload.fullDate}</p>
                            <p className="text-sm font-black">Score: {payload[0].value}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="score" 
                    stroke="#2563eb" 
                    strokeWidth={4}
                    fillOpacity={1} 
                    fill="url(#colorScore)" 
                    animationDuration={1500}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Side Charts */}
        <div className="space-y-8 flex flex-col">
          <div className="bg-white p-8 rounded-[40px] border border-slate-200 shadow-sm flex-1 flex flex-col">
            <h3 className="text-lg font-black text-slate-900 mb-6 flex items-center gap-3">
              <PieChartIcon className="w-5 h-5 text-purple-500" /> {getTranslation(profile.language, 'cognitiveDistribution')}
            </h3>
            <div className="flex-1 flex items-center justify-center min-h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={levelDistribution}
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                    animationDuration={1500}
                  >
                    {levelDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {['Basic', 'Intermediate', 'Advanced'].map(l => (
                <div key={l} className="flex justify-between items-center text-xs font-bold">
                  <div className="flex items-center gap-2">
                    <div className={ `w-2 h-2 rounded-full ${l === 'Advanced' ? 'bg-purple-500' : l === 'Intermediate' ? 'bg-blue-500' : 'bg-orange-500'}` } />
                    <span className="text-slate-500">{l} {getTranslation(profile.language, 'integration')}</span>
                  </div>
                  <span className="text-slate-900">{profile.level === l ? '100%' : '0%'}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-900 p-8 rounded-[40px] text-white shadow-xl relative overflow-hidden group">
            <div className="absolute -end-4 -top-4 w-24 h-24 bg-primary/20 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700" />
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-4 text-primary">
                <ShieldCheck className="w-5 h-5" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em]">{getTranslation(profile.language, 'validatedProfile')}</span>
              </div>
              <h3 className="text-xl font-bold mb-2">{getTranslation(profile.language, 'recalibration')}</h3>
              <p className="text-slate-400 text-sm mb-6 leading-relaxed">{getTranslation(profile.language, 'recalibrationDesc')}</p>
              <div className="p-4 bg-white/5 rounded-2xl border border-white/10 text-center">
                <span className="text-xs font-bold text-slate-300">{getTranslation(profile.language, 'nextAvailable')} </span>
                <span className="text-xs font-black text-white ml-2">
                  {profile.lastQuizDate ? new Date(new Date(profile.lastQuizDate).getTime() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString() : 'Now'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default IntelligenceHub;

function MetricCard({ label, value, icon: Icon, color, trend }: { label: string, value: string | number, icon: any, color: string, trend: string }) {
  const colors: any = {
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    purple: 'bg-purple-50 text-purple-600'
  };

  return (
    <div className="bg-white p-8 rounded-[40px] border border-slate-200 shadow-sm transition-all hover:shadow-xl hover:-translate-y-1">
      <div className={`w-12 h-12 ${colors[color]} rounded-2xl flex items-center justify-center mb-6`}>
        <Icon className="w-6 h-6" />
      </div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-black text-slate-900 tracking-tighter">{value}</span>
        <span className={ `text-[10px] font-bold ${trend.startsWith('+') ? 'text-emerald-500' : 'text-slate-400'} uppercase` }>{trend}</span>
      </div>
    </div>
  );
}
