// The LazyCreatives Backups mark (brand/logo-mark.svg): a shield holding a green
// verify check over a gold waveform. The waveform bars animate while `active`.
export function BrandMark({ active = false }: { active?: boolean }) {
  return (
    <svg className={`mark${active ? " mark--on" : ""}`} viewBox="0 0 64 72" fill="none"
      role="img" aria-label="LazyCreatives Backups">
      <defs>
        <linearGradient id="bmTile" x1="0" y1="0" x2="0" y2="72" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1C1F25" /><stop offset="1" stopColor="#0B0C0F" />
        </linearGradient>
        <radialGradient id="bmGlow" cx="50%" cy="28%" r="62%">
          <stop offset="0" stopColor="#F5C451" stopOpacity="0.22" />
          <stop offset="1" stopColor="#F5C451" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M32 3 L57 13 V31 C57 47 47.5 57.5 32 61.5 C16.5 57.5 7 47 7 31 V13 Z"
        fill="url(#bmTile)" stroke="#F5C451" strokeWidth="2.4" />
      <path d="M32 3 L57 13 V31 C57 47 47.5 57.5 32 61.5 C16.5 57.5 7 47 7 31 V13 Z" fill="url(#bmGlow)" />
      <g className="mark__wave" stroke="#F5C451" strokeWidth="3.2" strokeLinecap="round" opacity="0.85">
        <line x1="19" y1="34" x2="19" y2="40" />
        <line x1="25" y1="29" x2="25" y2="45" />
      </g>
      <g className="mark__wave mark__wave--single" stroke="#F5C451" strokeWidth="3.2" strokeLinecap="round" opacity="0.5">
        <line x1="45" y1="31" x2="45" y2="43" />
      </g>
      <path d="M22 37 l7 7 l16 -17" stroke="#4ADE80" strokeWidth="4" fill="none"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
