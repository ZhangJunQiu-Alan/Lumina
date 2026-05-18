import { BookOpenCheck, ChevronRight, Headphones, Timer } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function IeltsHomeView() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7">
      <header className="rounded-[34px] border border-white/70 bg-white/78 p-8 shadow-[0_18px_44px_rgba(14,26,56,0.07)]">
        <p className="text-xs font-black uppercase tracking-[0.26em] text-text-secondary">Cambridge IELTS</p>
        <h2 className="mt-3 text-3xl font-black tracking-tight text-text-primary sm:text-4xl">剑桥雅思真题训练</h2>
        <p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-text-secondary">
          阅读和听力分开练。先按真实考试节奏完成一套，再用得分和错题回看复盘。
        </p>
      </header>

      <section className="grid gap-5 lg:grid-cols-2">
        <button
          type="button"
          onClick={() => navigate('/app/ielts-reading')}
          className="group rounded-[34px] border border-white/70 bg-white/82 p-7 text-left shadow-[0_18px_44px_rgba(14,26,56,0.07)] transition-transform hover:scale-[1.01] active:scale-[0.99]"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-[22px] bg-apple-blue/12 text-apple-blue">
              <BookOpenCheck className="h-7 w-7" />
            </div>
            <ChevronRight className="mt-3 h-6 w-6 text-text-secondary transition-transform group-hover:translate-x-1" />
          </div>
          <h3 className="mt-6 text-2xl font-black text-text-primary">Academic Reading</h3>
          <p className="mt-2 text-sm font-bold leading-7 text-text-secondary">
            3 篇文章、40 题、60 分钟。支持答题卡、表格内填空、提交评分和错题回看。
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-apple-blue px-4 py-3 text-sm font-black text-white">
            进入阅读训练
          </div>
        </button>

        <button
          type="button"
          onClick={() => navigate('/app/ielts-listening')}
          className="group rounded-[34px] border border-white/70 bg-white/82 p-7 text-left shadow-[0_18px_44px_rgba(14,26,56,0.07)] transition-transform hover:scale-[1.01] active:scale-[0.99]"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-[22px] bg-apple-orange/12 text-apple-orange">
              <Headphones className="h-7 w-7" />
            </div>
            <ChevronRight className="mt-3 h-6 w-6 text-text-secondary transition-transform group-hover:translate-x-1" />
          </div>
          <h3 className="mt-6 text-2xl font-black text-text-primary">Listening</h3>
          <p className="mt-2 text-sm font-bold leading-7 text-text-secondary">
            Cambridge 4-10 已上线。4 个 Section、40 题、30 分钟，音频和题目在同一页完成。
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-apple-orange px-4 py-3 text-sm font-black text-white">
            <Timer className="h-4 w-4" />
            进入听力训练
          </div>
        </button>
      </section>
    </div>
  );
}
