import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import TankerSvg from "./TankerSvg.jsx";

const CAM_META = [
  { id: "CAM-01", name: "Outer Approach", model: "SBX-2200 · PERIMETER" },
  { id: "CAM-02", name: "Main Gate ANPR", model: "VTG-4K OCR · SLOW-MO" },
  { id: "CAM-03", name: "Weighbridge Scale", model: "WB-100T · AXLE" },
  { id: "CAM-04", name: "Holding Yard Grid", model: "YD-360 · TOP-DOWN" },
];

function useLiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function CctvFrame({ meta, surge, children }) {
  const clock = useLiveClock();
  return (
    <div
      className={`relative overflow-hidden rounded-xl border transition-colors duration-500 ${
        surge
          ? "border-red-500/70 shadow-[0_0_24px_rgba(239,68,68,0.4)]"
          : "border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
      }`}
    >
      <div className="flex items-center justify-between border-b border-white/10 bg-gradient-to-b from-[#0c1216] to-[#070c0f] px-2.5 py-1.5">
        <span className="font-mono text-[10px] font-semibold tracking-widest text-slate-300">
          {meta.id} · {meta.name}
        </span>
        <span className="hidden font-mono text-[9px] text-slate-500 md:inline">{meta.model}</span>
      </div>
      <div className="cctv-feed cctv-flicker relative h-44 overflow-hidden bg-[#0a0f12]">
        {children}
        <div className="absolute left-2 top-2 z-30 flex items-center gap-1.5 font-mono text-[10px] font-semibold text-white">
          <span className="live-dot h-2 w-2 rounded-full bg-red-500 text-red-500" />
          <span className="text-red-400">REC</span>
        </div>
        <div className="absolute bottom-2 right-2 z-30 font-mono text-[9px] text-white/45">
          {clock.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase()}{" "}
          {clock.toLocaleTimeString("en-GB")}
        </div>
        {surge && (
          <div className="absolute right-2 top-2 z-40 flex items-center gap-1 rounded bg-red-500/95 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest text-white animate-pulse">
            <AlertTriangle className="h-3 w-3" /> CONGESTION
          </div>
        )}
      </div>
    </div>
  );
}

function CamApproach({ surge }) {
  const count = surge ? 12 : 4;
  const lane = [0, 1, 2, 3, 4];
  return (
    <div className="absolute inset-0">
      <div className={surge ? "queue-lane queue-lane-surge" : "queue-lane"}>
        {[0, 1].map((dup) => (
          <div key={dup} className="flex min-w-max items-center gap-2 px-2">
            {lane.map((k) => (
              <TankerSvg key={`${dup}-${k}`} gradientId={`q${dup}${k}`} wheels={false} className="w-14 shrink-0" />
            ))}
          </div>
        ))}
      </div>
      <div className="queue-road" />
      <div className="absolute left-2 top-[3.25rem] z-20 font-mono text-[9px] text-slate-400">
        {surge ? (
          <span className="inline-flex items-center gap-1 text-red-300">
            <AlertTriangle className="h-3 w-3" /> QUEUE SPIKE
          </span>
        ) : (
          "QUEUE NORMAL"
        )}
      </div>
      <div className="absolute left-2 top-[4.5rem] z-20 font-mono text-lg font-bold text-emerald-300">
        {count}
        <span className="ml-1 text-[9px] font-normal text-slate-400">TANKERS</span>
      </div>
    </div>
  );
}

function CamAnpr({ surge, plateText }) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute bottom-0 left-0 right-0 h-2/5 bg-gradient-to-t from-[#0a1c11] to-transparent" />
      <div className={surge ? "anpr-micro anpr-micro-surge" : "anpr-micro"}>
        <TankerSvg gradientId="micro-tank" className="h-full w-full" />
      </div>
      <div className={surge ? "anpr-micro-laser anpr-micro-laser-surge" : "anpr-micro-laser"} />
      <div className="absolute left-1/2 top-[38%] z-20 -translate-x-1/2 rounded border border-emerald-400/70 bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.25em] text-emerald-200">
        {plateText}
      </div>
      <div className="absolute bottom-1.5 left-2 z-20 font-mono text-[9px] text-emerald-300/85">
        {surge ? "OCR LOCK · 99.1% · MANIFEST ✓" : "OCR LOCK · 98.4% MATCH"}
      </div>
    </div>
  );
}

function CamWeighbridge({ surge, expected }) {
  const target = expected && expected > 0 ? expected : 48100;
  const [kg, setKg] = useState(41200);
  const done = kg >= target;
  useEffect(() => {
    const t = setInterval(() => {
      setKg((k) => {
        if (k >= target + (surge ? 140 : 0)) return k;
        return Math.min(k + Math.round(140 + Math.random() * 640), target + (surge ? 140 : 0));
      });
    }, 420);
    return () => clearInterval(t);
  }, [target, surge]);
  const pct = Math.min(100, Math.round((kg / target) * 100));
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute left-2 top-[3.25rem] z-20 font-mono text-[9px] text-slate-400">GROSS AXLE</div>
      <div className="absolute left-2 top-11 z-20 font-mono text-lg font-bold text-emerald-300 tabular-nums">
        {kg.toLocaleString()}
        <span className="ml-1 text-[9px] font-normal text-slate-400">KG</span>
      </div>
      <div className="absolute right-2 top-[3.25rem] z-20 text-right font-mono text-[9px]">
        {done ? (
          <span className="text-emerald-300">STATUS: VERIFIED ✓</span>
        ) : (
          <span className="text-amber-300">WEIGHING…</span>
        )}
      </div>
      <div className="absolute bottom-11 left-0 right-0 z-20 px-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full transition-all duration-300 ${
              done ? "bg-emerald-400" : "bg-amber-400"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[8px] text-slate-500">
          <span>0</span>
          <span>{pct}%</span>
          <span>{target.toLocaleString()}</span>
        </div>
      </div>
      <TankerSvg
        gradientId="wb-tank"
        wheels={false}
        className={surge ? "wb-platform wb-platform-surge" : "wb-platform"}
      />
    </div>
  );
}

function CamYard({ surge }) {
  const cells = Array.from({ length: 12 }, (_, i) => i);
  const occupied = surge ? 12 : 7;
  return (
    <div className="absolute inset-0 p-2">
      <div className="grid h-full grid-cols-4 gap-1.5">
        {cells.map((c) => {
          const full = c < occupied;
          return (
            <div
              key={c}
              className={`relative flex flex-col items-center justify-center rounded-md border ${
                full
                  ? surge
                    ? "border-red-400/70 bg-red-500/20 animate-pulse"
                    : "border-emerald-400/40 bg-kpc-green/15"
                  : "border-white/10 bg-white/5"
              }`}
            >
              {full && (
                <>
                  <span className="h-3.5 w-8 rounded-sm bg-slate-200/90" />
                  <span className="mt-0.5 h-1 w-6 rounded bg-slate-300/60" />
                </>
              )}
              <span className="absolute left-1 top-0.5 font-mono text-[7px] text-white/40">{c + 1}</span>
            </div>
          );
        })}
      </div>
      <div className="absolute left-2 top-2 z-20 font-mono text-[9px] text-slate-400">
        <span className={surge ? "text-red-300" : "text-emerald-300"}>
          OCCUPANCY {occupied}/12 LOT
        </span>
      </div>
    </div>
  );
}

export default function DepotCameraGrid({ surgeActive = false, plateText = "KFD 321A" }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <CctvFrame meta={CAM_META[0]} surge={surgeActive}>
        <CamApproach surge={surgeActive} />
      </CctvFrame>
      <CctvFrame meta={CAM_META[1]} surge={surgeActive}>
        <CamAnpr surge={surgeActive} plateText={plateText} />
      </CctvFrame>
      <CctvFrame meta={CAM_META[2]} surge={surgeActive}>
        <CamWeighbridge surge={surgeActive} />
      </CctvFrame>
      <CctvFrame meta={CAM_META[3]} surge={surgeActive}>
        <CamYard surge={surgeActive} />
      </CctvFrame>
    </div>
  );
}