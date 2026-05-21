import { motion } from 'motion/react';
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  History,
  Sparkles,
  Layers,
  FileText,
  ChevronRight,
  CheckCircle2,
  PlusCircle,
  Settings2,
  BarChart3,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { LuminaLogo } from '../brand/LuminaLogo';
import { useAuth } from '../../contexts/AuthContext';
import { isGoogleAuthEnabled } from '../../lib/authFeatures';
import { AI_CONTENT_FEATURES_ENABLED } from '../../lib/aiFeatures';

const learningFlowSteps = [
  { round: 'Round 1', title: '建立连接', desc: '先把词形、发音和含义对上' },
  { round: 'Round 2', title: '语境填空', desc: '在真实例句里主动回忆词形' },
  { round: 'Round 3', title: '快速识别', desc: '压缩确认，固定长时记忆' },
  ...(AI_CONTENT_FEATURES_ENABLED
    ? [{ round: 'Article', title: '文章巩固', desc: '把词放回鲜活的语境中收尾' }]
    : []),
];

export const LandingView = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isAuthLoading } = useAuth();
  
  const primaryTarget = isAuthenticated ? '/app/home' : isGoogleAuthEnabled ? '/auth' : '/auth?mode=login';
  const primaryLabel = isAuthenticated
    ? '回到今天的学习路线'
    : isGoogleAuthEnabled
      ? '用 Google 接上进度'
      : '用邮箱进入系统';

  return (
    <div className="min-h-screen bg-[#F5F5F7] px-6 py-12 md:py-20 flex flex-col items-center">
      {/* --- Hero Section --- */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-5xl text-center mb-20"
      >
        <LuminaLogo size={50} className="mx-auto mb-10" />
        <h1 className="text-4xl sm:text-5xl md:text-7xl font-black leading-[1.1] sm:leading-[1.05] tracking-tight text-text-primary">
          建立你的个人词汇护城河。<br/>从机械记忆，进化为深度吸收。
        </h1>
        <p className="mt-8 text-lg md:text-xl text-text-secondary max-w-3xl mx-auto leading-relaxed font-medium">
          借助 Lumina 的学习引擎，单词将依次经历：明示关联、语境复现与快速确认。复习权重会跟随真实记忆状态持续更新，助你更彻底地攻克每一个单词。
        </p>
        
        <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            onClick={() => navigate(primaryTarget)}
            disabled={isAuthLoading}
            className="group relative flex items-center gap-3 rounded-full bg-apple-blue px-10 py-5 text-lg font-black text-white shadow-[0_20px_40px_rgba(0,122,255,0.25)] transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-70"
          >
            {primaryLabel}
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </button>
          
          {!isAuthenticated && (
            <button
              onClick={() => navigate('/auth?mode=login')}
              className="px-10 py-5 text-lg font-bold text-text-primary transition-colors hover:text-apple-blue"
            >
              已有账号登录
            </button>
          )}
        </div>
      </motion.div>

      {/* --- Bento Grid Section --- */}
      <section className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-12 gap-6">
        
        {/* 1. Large Focus: Learning Flow (7 cols) */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="md:col-span-12 lg:col-span-7 glass rounded-[40px] p-8 md:p-12 jelly-shadow flex flex-col relative overflow-hidden group"
        >
          <div className="absolute -right-20 -top-20 w-80 h-80 bg-apple-blue/5 rounded-full blur-[80px] group-hover:bg-apple-blue/10 transition-colors" />
          
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-apple-blue/10 rounded-xl flex items-center justify-center">
              <Layers className="w-5 h-5 text-apple-blue" />
            </div>
            <span className="text-sm font-black uppercase tracking-widest text-apple-blue">学习路径</span>
          </div>

          <h2 className="text-3xl md:text-4xl font-black text-text-primary tracking-tight mb-10">
            多轮吸收链路，<br/>让单词在语境中彻底鲜活。
          </h2>

          <div className="space-y-4">
            {learningFlowSteps.map((step, idx) => (
              <div key={step.round} className="flex items-start gap-5 p-4 rounded-3xl transition-colors hover:bg-white/40">
                <div className="mt-1 w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm text-xs font-black text-text-secondary shrink-0">
                  0{idx + 1}
                </div>
                <div>
                  <h4 className="font-black text-text-primary flex items-center gap-2">
                    {step.title}
                    <span className="text-[10px] bg-black/5 px-2 py-0.5 rounded-full uppercase opacity-60">{step.round}</span>
                  </h4>
                  <p className="mt-1 text-sm text-text-secondary leading-relaxed font-medium">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* 2. SRS Engine - FIXED DARK CARD (5 cols) */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="md:col-span-12 lg:col-span-5 rounded-[40px] p-8 md:p-12 shadow-2xl bg-[#1C1C1E] text-white overflow-hidden relative group"
        >
           <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-apple-blue/20 rounded-full blur-[60px]" />
           
           <div className="flex items-center gap-3 mb-8 text-white/40 font-black">
            <BrainCircuit className="w-5 h-5" />
            <span className="text-sm uppercase tracking-widest text-white/60">记忆调度引擎</span>
          </div>

          <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-6 leading-tight">
            不再只有对错。<br/>精准捕捉每一次迟疑。
          </h2>
          <p className="text-white/60 leading-relaxed font-medium mb-10 text-base md:text-lg">
            系统将记忆细分为：新词、模糊、慢回忆、稳回忆、已掌握。错词不会立即消失，毕业也需要反复确证。
          </p>

          <div className="flex flex-wrap gap-2">
            {['Fuzzy', 'Slow', 'Stable', 'Mastered'].map(s => (
              <span key={s} className="px-5 py-2.5 bg-white/10 border border-white/5 rounded-full text-[11px] font-black tracking-wider uppercase text-white/90 shadow-sm">{s}</span>
            ))}
          </div>
        </motion.div>

        {/* 3. Official Libraries (4 cols) */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="md:col-span-6 lg:col-span-4 glass rounded-[40px] p-8 md:p-10 jelly-shadow flex flex-col justify-between"
        >
          <div>
            <div className="w-12 h-12 bg-apple-green/10 rounded-2xl flex items-center justify-center mb-8 text-apple-green shadow-sm">
              <BookOpen className="w-6 h-6" />
            </div>
            <h3 className="text-2xl font-black text-text-primary tracking-tight">官方精选词库</h3>
            <p className="mt-4 text-sm text-text-secondary leading-relaxed font-medium">
              内置《雅思词汇真经》与《GRE镇考机经词 7.0》。支持顺序与乱序抽取，过滤已学，精准推进。
            </p>
          </div>
          <div className="mt-8 flex items-center justify-between text-[11px] font-black text-text-secondary uppercase tracking-widest border-t border-black/5 pt-6">
            <span>IELTS 真经</span>
            <div className="w-1 h-1 bg-black/10 rounded-full" />
            <span>GRE V7 镇考</span>
          </div>
        </motion.div>

        {AI_CONTENT_FEATURES_ENABLED && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="md:col-span-6 lg:col-span-4 glass rounded-[40px] p-8 md:p-10 jelly-shadow flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 bg-apple-orange/10 rounded-2xl flex items-center justify-center mb-8 text-apple-orange shadow-sm">
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-black text-text-primary tracking-tight">AI 词条全景增强</h3>
              <p className="mt-4 text-sm text-text-secondary leading-relaxed font-medium">
                不止是释义。包含构词拆解、派生、近反义、易混对比及助记词。基于 Gemini 2.5 Flash。
              </p>
            </div>
            <div className="mt-8 flex flex-wrap gap-2 pt-6 border-t border-black/5">
              {['构词', '例句', '对比', '助记'].map(tag => (
                <span key={tag} className="text-[10px] font-bold bg-apple-orange/10 text-apple-orange px-2 py-0.5 rounded-md">{tag}</span>
              ))}
            </div>
          </motion.div>
        )}

        {AI_CONTENT_FEATURES_ENABLED && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.4 }}
            className="md:col-span-6 lg:col-span-4 glass rounded-[40px] p-8 md:p-10 jelly-shadow flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 bg-apple-teal/10 rounded-2xl flex items-center justify-center mb-8 text-apple-teal shadow-sm">
                <PlusCircle className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-black text-text-primary tracking-tight">自由导入，即刻起步</h3>
              <p className="mt-4 text-sm text-text-secondary leading-relaxed font-medium">
                粘贴单词，按换行或逗号切分。AI 自动补齐所有维度数据，生成你的私人词组。
              </p>
            </div>
            <p className="mt-8 text-[11px] font-bold text-apple-teal uppercase tracking-widest pt-6 border-t border-black/5">Customizable Batches</p>
          </motion.div>
        )}

        {/* 6. Settings & Sync (6 cols) */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
          className="md:col-span-6 lg:col-span-6 glass rounded-[40px] p-8 md:p-10 jelly-shadow flex items-start gap-8"
        >
           <div className="w-14 h-14 bg-apple-blue/10 rounded-2xl flex items-center justify-center shrink-0 text-apple-blue shadow-sm">
              <Settings2 className="w-7 h-7" />
           </div>
           <div>
              <h3 className="text-2xl font-black text-text-primary tracking-tight">个性化学习偏好</h3>
              <p className="mt-3 text-sm text-text-secondary leading-relaxed font-medium">
                云端同步你的发音偏好（英音/美音）、自动播放频率及间隔。所有进度随账号随时接续。
              </p>
           </div>
        </motion.div>

        {/* 7. Results & Analytics (6 cols) */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.6 }}
          className="md:col-span-6 lg:col-span-6 glass rounded-[40px] p-8 md:p-10 jelly-shadow flex items-start gap-8"
        >
           <div className="w-14 h-14 bg-apple-indigo/10 rounded-2xl flex items-center justify-center shrink-0 text-apple-indigo shadow-sm">
              <BarChart3 className="w-7 h-7" />
           </div>
           <div>
              <h3 className="text-2xl font-black text-text-primary tracking-tight">看见记忆的成长</h3>
              <p className="mt-3 text-sm text-text-secondary leading-relaxed font-medium">
                复习结束后，系统会清晰展示哪些词升级了、哪些毕业了。每一分努力，状态变化都看得见。
              </p>
           </div>
        </motion.div>

      </section>

      {/* --- Footer CTA --- */}
      <motion.footer 
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        className="mt-32 text-center"
      >
        <p className="text-sm font-bold text-text-secondary mb-8 uppercase tracking-[0.3em]">Ready to start?</p>
        <button
          onClick={() => navigate(primaryTarget)}
          className="px-12 py-5 bg-white rounded-full font-black text-text-primary shadow-[0_12px_40px_rgba(0,0,0,0.06)] hover:scale-105 hover:shadow-[0_20px_60px_rgba(0,0,0,0.1)] transition-all border border-black/5"
        >
          开始接上你的进度
        </button>
        <div className="mt-12 text-xs text-text-secondary/50 space-x-4">
          <Link to="/privacy" className="hover:text-text-primary transition-colors">隐私政策</Link>
          <Link to="/terms" className="hover:text-text-primary transition-colors">服务条款</Link>
        </div>
      </motion.footer>
    </div>
  );
};
