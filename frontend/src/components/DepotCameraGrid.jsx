import React from "react";

const camLabels = [
  "Cam 01 · Outer Approach",
  "Cam 02 · Main Gate ANPR",
  "Cam 03 · Weighbridge",
  "Cam 04 · Holding Yard",
];

const camColors = ["#10B981", "#3B82F6", "#F59E0B", "#EF4444"];

export default function DepotCameraGrid() {
  return (
    <div className="grid grid-cols-2 gap-4 mb-6">
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="rounded-lg border p-3 backdrop-blur bg-black/30 border-white/20"
        >
          <div
            className="relative h-40 rounded-md overflow-hidden"
            style={{ backgroundColor: camColors[i] }}
          >
            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle,rgba(255,255,255,0.4)_1px,transparent_1px)] bg-[size:16px_16px]" />
            <div className="absolute top-2 left-2 flex items-center gap-1.5 text-[11px] font-semibold text-white bg-black/40 rounded px-2 py-1">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              <span className="tracking-widest">REC</span>
            </div>
            <span className="absolute bottom-2 left-2 text-xs font-medium text-white drop-shadow">
              {camLabels[i]}
            </span>
            <div className="absolute inset-0 border-2 border-white/0 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}