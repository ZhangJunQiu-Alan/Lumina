import React from 'react';
import { motion } from 'motion/react';
import { BookOpen } from 'lucide-react';
import { Word } from '../../types';

interface ArticleViewProps {
  essay: string;
  words: Word[];
  onFinish: () => void | Promise<void>;
}

export const ArticleView = ({ essay, words, onFinish }: ArticleViewProps) => {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }} 
      className="w-full max-w-4xl mx-auto py-12"
    >
      <div className="glass rounded-apple-lg p-10 md:p-16 jelly-shadow relative">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between mb-12">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-apple-green rounded-2xl flex items-center justify-center shadow-lg shadow-apple-green/20">
              <BookOpen className="text-white w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight">文章巩固</h2>
              <p className="text-xs font-bold text-text-secondary uppercase tracking-widest">收个尾</p>
            </div>
          </div>
          <button
            onClick={onFinish}
            className="px-8 py-4 bg-apple-blue text-white font-black rounded-2xl shadow-xl shadow-apple-blue/25 hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            读完了，回首页
          </button>
        </div>
        <div className="prose prose-xl max-w-none text-gray-800 leading-[1.85] font-medium selection:bg-apple-blue/10">
          {essay.split(' ').map((word, i) => {
            const cleanWord = word.replace(/[.,!?;:()"]/g, '').toLowerCase();
            const isTarget = words.some((w) => w.word.toLowerCase() === cleanWord);
            return (
              <span 
                key={i} 
                className={isTarget ? 'bg-apple-blue/10 text-apple-blue font-bold px-1 rounded transition-colors hover:bg-apple-blue/20 cursor-default' : ''}
              >
                {word}{' '}
              </span>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
};
