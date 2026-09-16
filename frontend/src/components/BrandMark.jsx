const BRAND_ORANGE = "#F97316";
const BRAND_GREEN_DARK = "#072C1B";

function Emblem({ size = 36, className }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} role="img" aria-label="Njiasmart emblem">
      <defs>
        <radialGradient id="njs-ring" cx="50%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#FB923C" />
          <stop offset="55%" stopColor={BRAND_ORANGE} />
          <stop offset="100%" stopColor="#EA580C" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="url(#njs-ring)" />
      <circle cx="32" cy="32" r="25.5" fill="none" stroke="#000000" strokeOpacity="0.18" strokeWidth="1.4" />
      {/* stylized tanker truck in motion */}
      <g fill="#0A0A0A">
        <rect x="9.5" y="26" width="25" height="15" rx="3.5" />
        <rect x="9.5" y="26" width="25" height="6" rx="3" opacity="0.35" />
        <rect x="35.5" y="27" width="16" height="11.5" rx="2.5" />
        <rect x="39" y="29" width="4.5" height="6" rx="1.2" fill={BRAND_ORANGE} opacity="0.85" />
        <circle cx="20" cy="44" r="4.2" />
        <circle cx="43.5" cy="44" r="4.2" />
      </g>
      {/* motion trail */}
      <g stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" opacity="0.75">
        <line x1="9" y1="19" x2="20" y2="19" />
        <line x1="13" y1="14" x2="26" y2="14" />
      </g>
    </svg>
  );
}

export default function BrandMark({ size = 36, showWordmark = true, className }) {
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`}>
      <Emblem size={size} />
      {showWordmark && (
        <div className="leading-none">
          <p className="text-base font-extrabold uppercase tracking-wide text-white">Njiasmart</p>
          <p className="mt-1 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.3em] text-orange-400">
            Okoa Muda
            <span className="h-px w-4 bg-orange-400/60" />
            <span className="font-normal normal-case tracking-normal text-slate-400">Save Time</span>
          </p>
        </div>
      )}
    </div>
  );
}

export { Emblem, BRAND_ORANGE, BRAND_GREEN_DARK };