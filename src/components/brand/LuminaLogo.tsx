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
      viewBox="0 0 462 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`h-7 w-auto overflow-visible text-[#102544] ${className}`.trim()}
    >
      <g stroke="currentColor" strokeWidth="11.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M26 16V84H78" />
        <path d="M114 36V62C114 77.5 123.5 86 139.5 86C155.5 86 165 77.5 165 62V36" />
        <path d="M201 84V40C201 29.5 208 23 218.5 23C229.5 23 237 30.5 237 42V84" />
        <path d="M237 42C237 30.5 245 23 256 23C267 23 274.5 30.5 274.5 42V84" />
        <path d="M300 38V84" />
        <path d="M332 84V40C332 29.5 340 23 351 23C362 23 369.5 30.5 369.5 42V84" />
        <path d="M448 84V54C448 35 435 22 417.5 22C399 22 386.5 35.5 386.5 54C386.5 73 399 86 417 86C433.5 86 445.5 75 448 60" />
      </g>
      <path
        d="M300 4C302.2 13.7 306.3 17.8 316 20C306.3 22.2 302.2 26.3 300 36C297.8 26.3 293.7 22.2 284 20C293.7 17.8 297.8 13.7 300 4Z"
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
