import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'motion/react';
import { ease } from '../../lib/motion';

const COLORS = ['#0e8f88', '#79b6aa', '#e6a43a', '#d86652', '#687caf', '#4e9272'];

const createPieces = (count: number) =>
  Array.from({ length: count }, (_, id) => {
    const angle = (Math.PI * 2 * id) / count + (Math.random() - 0.5) * 0.6;
    const distance = 120 + Math.random() * 160;
    return {
      id,
      color: COLORS[id % COLORS.length],
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance * 0.7 - 60,
      rotate: (Math.random() - 0.5) * 720,
      size: 6 + Math.random() * 6,
      isRound: id % 3 === 0,
      delay: Math.random() * 0.12,
    };
  });

/** One-shot celebratory burst over the viewport, portaled so it never clips or scrolls its host. */
export const Confetti = ({ count = 32, delay = 0.3 }: { count?: number; delay?: number }) => {
  const reduceMotion = useReducedMotion();
  const [pieces] = useState(() => createPieces(count));

  if (reduceMotion) return null;

  return createPortal(
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[120] flex h-[70vh] items-center justify-center overflow-hidden"
    >
      {pieces.map((piece) => (
        <motion.span
          key={piece.id}
          className="absolute"
          style={{
            width: piece.size,
            height: piece.isRound ? piece.size : piece.size * 0.45,
            borderRadius: piece.isRound ? '9999px' : '2px',
            backgroundColor: piece.color,
          }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0 }}
          animate={{
            x: piece.x,
            y: [0, piece.y, piece.y + 140],
            opacity: [1, 1, 0],
            rotate: piece.rotate,
            scale: 1,
          }}
          transition={{
            duration: 1.4,
            delay: delay + piece.delay,
            ease: ease.out,
            y: { duration: 1.4, delay: delay + piece.delay, times: [0, 0.45, 1], ease: ['easeOut', 'easeIn'] },
            opacity: { duration: 1.4, delay: delay + piece.delay, times: [0, 0.7, 1] },
          }}
        />
      ))}
    </div>,
    document.body,
  );
};
