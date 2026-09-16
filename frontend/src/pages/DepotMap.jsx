import { useMemo } from "react";
import { Map as MapIcon, Flame, ArrowDown } from "lucide-react";
import { useDemoAuth } from "../hooks/useDemoAuth.js";
import { useYardSnapshot } from "../hooks/useYardData.js";
import { useYardStream } from "../hooks/useYardStream.js";
import BayCard from "../components/BayCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { pushAlert } from "../components/AlertCenter.jsx";

export default function DepotMap() {
  const auth = useDemoAuth("executive", "Executive Viewer");
  const { data, error, loading } = useYardSnapshot(5000, auth.ready);

  useYardStream({
    "anomaly:detected": (m) =>
      pushAlert({
        tone: "warning",
        title: `Anomaly: ${m.payload.type}`,
        message: m.payload.message,
      }),
    "reroute:applied": (m) =>
      pushAlert({
        tone: "warning",
        title: "Auto-reroute applied",
        message: `${m.payload.movements.length} vehicle(s) re-assigned`,
      }),
    "gate:entry": (m) =>
      pushAlert({
        tone: "success",
        title: "New entry",
        message: `${m.payload.regNo} — ${m.payload.token}`,
      }),
  });

  const { bays = {}, trucks = {} } = data ?? {};
  const activeList = useMemo(() => Object.values(trucks).filter((t) => t.id), [trucks]);
  const waiting = activeList.filter((t) => t.status === "WAITING");
  const queued = activeList.filter((t) => t.status === "QUEUED");
  const loadingNow = activeList.filter((t) => t.status === "LOADING");
  const bottlenecks = Object.entries(bays)
    .filter(([, b]) => b.status === "DOWN" || b.status === "DEGRADED" || Object.keys(b.queuedVehicles ?? {}).length >= 5)
    .map(([id]) => id);

  const lanes = useMemo(() => {
    const byProduct = {};
    for (const t of waiting) {
      byProduct[t.product ?? "UNKNOWN"] = (byProduct[t.product ?? "UNKNOWN"] ?? 0) + 1;
    }
    return byProduct;
  }, [waiting]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Live Depot Map</h1>
          <p className="text-sm text-slate-400">MBA Facility — gate → weighbridge → staging → gantries</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge pulse status={auth.ready ? "ACTIVE" : "WAITING"} />
          <span className="chip border border-red-400/30 bg-red-500/10 text-red-300">
            <Flame className="h-3 w-3" /> {bottlenecks.length} bottleneck{bottlenecks.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {error && <div className="rounded-lg border border-amber-400/40 bg-amber-950/60 p-3 text-sm text-amber-200">{error}</div>}
      {!loading && !data && !error && <p className="text-sm text-slate-500">No yard data yet — capture a truck at the gate.</p>}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="card text-center">
          <p className="font-mono text-2xl font-bold text-emerald-300">{activeList.length}</p>
          <p className="text-xs text-slate-400">Trucks in yard</p>
        </div>
        <div className="card text-center">
          <p className="font-mono text-2xl font-bold text-amber-300">{queued.length}</p>
          <p className="text-xs text-slate-400">Queued at gantries</p>
        </div>
        <div className="card text-center">
          <p className="font-mono text-2xl font-bold text-sky-300">{loadingNow.length}</p>
          <p className="text-xs text-slate-400">Loading now</p>
        </div>
        <div className="card text-center">
          <p className="font-mono text-2xl font-bold text-violet-300">{waiting.length}</p>
          <p className="text-xs text-slate-400">Staging / weighbridge</p>
        </div>
      </div>

      {/* Yard topology */}
      <div className="card">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
          <MapIcon className="h-4 w-4" /> Yard topology flow
        </div>

        {/* Gate → Weighbridge */}
        <div className="grid gap-2 md:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-center">
            <StatusBadge status="WAITING" />
            <p className="mt-2 text-xs text-slate-400">Main Gate · ANPR + RFID</p>
            <div className="mt-2 flex flex-wrap justify-center gap-1">
              {waiting.slice(0, 5).map((t) => (
                <span key={t.id} className="chip border border-white/10 bg-white/5 text-slate-300">
                  {t.regNo}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center">
            <ArrowDown className="h-4 w-4 rotate-90 text-slate-600 md:rotate-0" />
          </div>
          <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-center">
            <StatusBadge status="AT_WEIGHBRIDGE" />
            <p className="mt-2 text-xs text-slate-400">Weighbridge · RFID + autonomous bay allocation</p>
            <div className="mt-2 flex flex-wrap justify-center gap-1">
              {activeList
                .filter((t) => t.status === "AT_WEIGHBRIDGE")
                .map((t) => (
                  <span key={t.id} className="chip border border-violet-400/30 bg-violet-500/10 text-violet-300">
                    {t.regNo}
                  </span>
                ))}
            </div>
          </div>
        </div>

        {/* Staging lanes */}
        <div className="my-3 rounded-lg border border-white/10 bg-black/20 p-3">
          <p className="mb-2 text-xs uppercase tracking-wider text-slate-500">Staging lanes by product</p>
          <div className="grid gap-2 md:grid-cols-5">
            {Object.entries(lanes).map(([product, count]) => (
              <div key={product} className="rounded bg-black/30 p-2 text-center">
                <p className="font-mono text-lg text-slate-200">{count}</p>
                <p className="text-[10px] text-slate-500">{product}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Gantry bays */}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Object.entries(bays).map(([bayId, bay]) => (
            <BayCard key={bayId} bay={bay} bayId={bayId} />
          ))}
        </div>
      </div>
    </div>
  );
}