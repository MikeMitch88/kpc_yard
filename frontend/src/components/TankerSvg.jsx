export default function TankerSvg({ gradientId = "tank", wheels = true, className, style }) {
  const wheelCls = wheels ? "anpr-wheel" : undefined;
  return (
    <svg viewBox="0 0 210 62" className={className} style={style} role="img" aria-label="Njiasmart fuel tanker">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0D7E43" />
          <stop offset="1" stopColor="#0B6B3A" />
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="29" rx="13" ry="12" fill="#ffffff" opacity="0.05" />
      <rect x="6" y="15" width="116" height="27" rx="13.5" fill={`url(#${gradientId})`} />
      <rect x="6" y="15" width="116" height="8" rx="4" fill="#ffffff" opacity="0.18" />
      <text
        x="64"
        y="34.5"
        textAnchor="middle"
        fontSize="14"
        fontWeight="800"
        fontStyle="italic"
        fill="#ffffff"
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        letterSpacing="2"
      >
        NJS
      </text>
      <text
        x="64"
        y="39.5"
        textAnchor="middle"
        fontSize="5"
        fill="#ffffff"
        opacity="0.65"
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        letterSpacing="1"
      >
        NJIASMART ENERGY
      </text>
      <rect x="98" y="20" width="10" height="10" fill="#F59E0B" stroke="#111111" strokeWidth="1.2" />
      <rect x="5" y="23" width="3" height="6" fill="#DC2626" />

      <path d="M124 15 h32 q-12 13 -8 28 h-24 Z" fill="#0F2C1A" />
      <rect x="144" y="15" width="50" height="28" rx="5" fill="#0F2C1A" />
      <path d="M142 15 h7 q-3 12 2 28 h-7 q-4 -14 -2 -28 Z" fill="#0E2726" />
      <path d="M176 16 L196 20 L196 31 L170 31 Q174 22 176 16Z" fill="#9FD8C6" opacity="0.35" />
      <rect x="150" y="6" width="5" height="11" fill="#475569" />
      <rect x="149.5" y="5" width="6" height="3" rx="1.5" fill="#64748B" />

      <rect x="6" y="41" width="188" height="3" fill="#0A1F13" />
      <rect x="188" y="38" width="8" height="6" rx="2" fill="#334155" />
      <rect x="190" y="27" width="3" height="4" fill="#FBBF24" />
      <rect x="186" y="34" width="3" height="8" fill="#1E293B" />

      {[
        { x: 30, y: 46 },
        { x: 52, y: 46 },
        { x: 150, y: 46 },
        { x: 170, y: 46 },
      ].map((w, i) => (
        <g key={i} transform={`translate(${w.x} ${w.y})`} className={wheelCls}>
          <circle r="8.5" fill="#0A0A0A" stroke="#1F2937" strokeWidth="1.5" />
          {[0, 90, 180, 270].map((a) => (
            <line
              key={a}
              x1="0"
              y1="0"
              x2={Math.cos((a * Math.PI) / 180) * 6}
              y2={Math.sin((a * Math.PI) / 180) * 6}
              stroke="#475569"
              strokeWidth="1.5"
            />
          ))}
          <circle r="3.2" fill="#CBD5E1" />
        </g>
      ))}
    </svg>
  );
}