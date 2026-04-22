interface LuminaMarkProps {
  size?: number;
  className?: string;
}

interface LuminaWordmarkProps {
  className?: string;
}

interface LuminaLogoProps extends LuminaMarkProps {
  showWordmark?: boolean;
  textClassName?: string;
  wordmarkClassName?: string;
  markClassName?: string;
}

export function LuminaMark({ size = 28, className = '' }: LuminaMarkProps) {
  return (
    <img
      aria-hidden="true"
      src="/logo.png"
      alt=""
      width={size}
      height={size}
      className={`shrink-0 object-contain ${className}`.trim()}
    />
  );
}

export function LuminaWordmark({ className = '' }: LuminaWordmarkProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 420 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`h-7 w-auto overflow-visible text-[#102544] ${className}`.trim()}
    >
      <g stroke="currentColor" strokeWidth="11.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 18V84H70" />
        <path d="M86 18V60C86 76 96 84 111 84C126 84 136 76 136 60V18" />
        <path d="M150 84V34C150 24 158 18 168 18C178 18 186 25 186 37V84" />
        <path d="M186 37C186 25 194 18 204 18C214 18 222 25 222 37V84" />
        <path d="M242 18V84" />
        <path d="M272 84V34C272 24 280 18 291 18C302 18 310 25 310 37V84" />
        <path d="M386 84V52C386 33 374 18 356 18C337 18 324 32 324 52C324 72 337 84 355 84C371 84 383 73 386 58" />
      </g>
      <path
        d="M242 4C244.2 13.7 248.3 17.8 258 20C248.3 22.2 244.2 26.3 242 36C239.8 26.3 235.7 22.2 226 20C235.7 17.8 239.8 13.7 242 4Z"
        fill="#F7BE54"
      />
    </svg>
  );
}

export function LuminaLogo({
  size = 28,
  className = '',
  showWordmark = true,
  textClassName = '',
  wordmarkClassName = '',
  markClassName = '',
}: LuminaLogoProps) {
  return (
    <div className={`inline-flex items-center gap-3.5 ${className}`.trim()}>
      <LuminaMark size={size} className={`shrink-0 drop-shadow-[0_8px_18px_rgba(0,122,255,0.12)] ${markClassName}`.trim()} />
      {showWordmark && (
        <LuminaWordmark className={`${wordmarkClassName} ${textClassName}`.trim()} />
      )}
    </div>
  );
}
