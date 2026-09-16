import { useState, useEffect } from "react";
import {
  AlertTriangle,
  Play,
  RefreshCw,
  CheckCircle2,
  SlidersHorizontal,
  Camera,
  Radio,
  Send,
  ShieldAlert,
  History,
  Check,
} from "lucide-react";
import { useDemoAuth } from "../hooks/useDemoAuth.js";
import { useYardSnapshot, useAnomalies } from "../hooks/useYardData.js";
import { useYardStream } from "../hooks/useYardStream.js";
import StatusBadge from "../components/StatusBadge.jsx";
import BayCard from "../components/BayCard.jsx";
import { pushAlert } from "../components/AlertCenter.jsx";
import { yardApi } from "../services/api.js";

const HEALTH_OPTIONS = ["ACTIVE", "DEGRADED", "MAINTENANCE", "DOWN"];
const CAMERA_STATUS_OPTIONS = ["ONLINE", "OFFLINE", "WARNING", "PROCESSING"];

export default function AdminOps() {
  const auth = useDemoAuth("depot-manager", "Depot Manager");
  const { data, refresh } = useYardSnapshot(6000, auth.ready);
  const { data: anomalies, refresh: refreshAnomalies } = useAnomalies(12000, auth.ready);
  const [busy, setBusy] = useState(null);

  // Camera state & audit state
  const [cameras, setCameras] = useState({});
  const [simPlate, setSimPlate] = useState("");
  const [exitAudits, setExitAudits] = useState([]);
  const [activeTab, setActiveTab] = useState("camera"); // camera | audit

  async function loadCameraData() {
    if (!auth.ready) return;
    try {
      const [cams, audits] = await Promise.all([
        yardApi.getGantryCameras(),
        yardApi.getExitAudit(8),
      ]);
      setCameras(cams ?? {});
      setExitAudits(audits ?? []);
    } catch {
      /* non-fatal */
    }
  }

  useEffect(() => {
    loadCameraData();
  }, [auth.ready]);

  useYardStream({
    "anomaly:detected": (m) =>
      pushAlert({ tone: "warning", title: `Anomaly: ${m.payload.type}`, message: m.payload.message }),
    "reroute:applied": (m) =>
      pushAlert({ tone: "warning", title: "Auto-reroute executed", message: `${m.payload.movements.length} trucks moved` }),
    "queue:sequenced": () => refresh(),
    "control:override": (m) => {
      pushAlert({ tone: "success", title: "Override recorded", message: `operator ${m.payload.operator ?? "system"}` });
      refresh();
    },
    "GANTRY_TANKER_EXITED": (m) => {
      pushAlert({
        tone: "success",
        title: "Gantry Exit ANPR Detected",
        message: `Plate ${m.payload.numberPlate} departed — bay ${m.payload.bay ?? "auto"} released.`,
      });
      loadCameraData();
      refresh();
    },
    "gantry:exit": () => {
      loadCameraData();
      refresh();
    },
  });

  const bays = data?.bays ?? {};
  const trucks = Object.values(data?.trucks ?? {}).filter((t) => t.id);
  const staged = trucks.filter((t) => ["WAITING", "AT_WEIGHBRIDGE"].includes(t.status)).slice(0, 8);
  const activeInGantry = trucks.filter((t) => ["QUEUED", "LOADING"].includes(t.status));

  const primaryCamera = cameras["GANTRY-EXIT-01"] ?? {
    cameraId: "GANTRY-EXIT-01",
    location: "Gantry Exit",
    name: "Gantry Exit ANPR Camera 01",
    status: "ONLINE",
    lastDetection: null,
    lastDetectionAt: null,
    totalDetections: 0,
  };

  async function run(act, payload) {
    setBusy(act);
    try {
      const res = await payload();
      pushAlert({ tone: "success", title: "Action executed", message: act });
      if (act === "run-cycle" || act === "allocate") {
        const m = res?.movements ?? res?.assignment ?? null;
        if (m) pushAlert({ tone: "success", title: "Closed-loop result", message: JSON.stringify(m).slice(0, 120) });
      }
      refresh();
      refreshAnomalies();
      loadCameraData();
    } catch (err) {
      pushAlert({ tone: "error", title: "Action failed", message: err.message });
    } finally {
      setBusy(null);
    }
  }

  async function setHealth(bayId, status) {
    await run(`bay:${bayId}`, () => yardApi.setBayHealth(bayId, status));
  }

  async function setCameraStatus(cameraId, status) {
    await run(`cam-status:${status}`, async () => {
      const updated = await yardApi.updateGantryCamera(cameraId, { status });
      setCameras((prev) => ({ ...prev, [cameraId]: updated }));
    });
  }

  async function triggerExitDetection(plate, isManual = false) {
    if (!plate || !plate.trim()) return;
    const cleanPlate = plate.trim().toUpperCase();
    await run(`exit-detect:${cleanPlate}`, async () => {
      const res = isManual
        ? await yardApi.manualExitClearance({ regNo: cleanPlate })
        : await yardApi.gantryExitDetection({ numberPlate: cleanPlate, cameraId: primaryCamera.cameraId });

      if (res.matched) {
        pushAlert({
          tone: "success",
          title: "Tanker Exited & Bay Released",
          message: `${res.numberPlate} (${res.loadingStatus}) — Departure recorded.`,
        });
      } else {
        pushAlert({
          tone: "warning",
          title: "Unmatched Plate Alert",
          message: res.message,
        });
      }
      setSimPlate("");
    });
  }

  const cameraTone =
    primaryCamera.status === "ONLINE"
      ? "text-emerald-400 border-emerald-500/30 bg-emerald-950/30"
      : primaryCamera.status === "OFFLINE"
      ? "text-red-400 border-red-500/30 bg-red-950/30"
      : "text-amber-400 border-amber-500/30 bg-amber-950/30";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Admin Ops — Depot Control Plane</h1>
          <p className="text-sm text-slate-400">Gantry exit ANPR cameras, bay health overrides, anomaly triage</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => run("run-cycle", () => yardApi.runCycle())}
            disabled={busy === "run-cycle"}
            className="btn-primary text-xs"
          >
            {busy === "run-cycle" ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Run closed-loop cycle
          </button>
          <button onClick={() => { refresh(); loadCameraData(); }} className="btn-ghost text-xs">
            Refresh
          </button>
        </div>
      </div>

      {/* Gantry Exit Camera Diagnostics & ANPR Simulator Panel */}
      <div className="card space-y-4 border border-emerald-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/20">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-emerald-500/20 p-2 text-emerald-300">
              <Camera className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-white flex items-center gap-2">
                Gantry Exit Camera System
                <span className={`chip border ${cameraTone} text-[10px] font-mono font-bold uppercase`}>
                  <Radio className="mr-1 h-2.5 w-2.5 inline animate-pulse" />
                  {primaryCamera.status}
                </span>
              </p>
              <p className="text-xs text-slate-400">
                Camera: <span className="font-mono text-slate-300">{primaryCamera.cameraId}</span> · Location: <span className="text-slate-300">{primaryCamera.location}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Camera Health:</span>
            <div className="flex rounded-lg border border-white/10 bg-black/40 p-0.5">
              {CAMERA_STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setCameraStatus(primaryCamera.cameraId, opt)}
                  disabled={busy}
                  className={`rounded px-2.5 py-1 text-[10px] font-mono transition ${
                    primaryCamera.status === opt
                      ? opt === "ONLINE"
                        ? "bg-emerald-500/30 text-emerald-200 shadow-sm"
                        : opt === "OFFLINE"
                        ? "bg-red-500/30 text-red-200"
                        : "bg-amber-500/30 text-amber-200"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Live Camera Stats & Detection Simulator */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Status Details */}
          <div className="rounded-lg border border-white/10 bg-black/30 p-3 space-y-2 text-xs">
            <p className="font-semibold text-slate-300 uppercase tracking-wider text-[10px]">ANPR Telemetry</p>
            <div className="flex justify-between">
              <span className="text-slate-400">Last Plate Detection:</span>
              <span className="font-mono font-bold text-emerald-300">
                {primaryCamera.lastDetection || "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Detection Timestamp:</span>
              <span className="font-mono text-slate-300 text-[11px]">
                {primaryCamera.lastDetectionAt
                  ? new Date(primaryCamera.lastDetectionAt).toLocaleTimeString()
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Total Cleared Detections:</span>
              <span className="font-mono text-slate-200">{primaryCamera.totalDetections ?? 0}</span>
            </div>
          </div>

          {/* Active Tankers In Gantry -> Quick ANPR Trigger */}
          <div className="rounded-lg border border-white/10 bg-black/30 p-3 space-y-2 text-xs lg:col-span-2">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-slate-300 uppercase tracking-wider text-[10px]">
                Active Gantry Tankers (Click to Trigger ANPR Exit)
              </p>
              <span className="text-[10px] text-slate-500 font-mono">
                {activeInGantry.length} in gantry
              </span>
            </div>

            {activeInGantry.length === 0 ? (
              <p className="py-2 text-slate-500 italic text-[11px]">
                No active tankers currently in loading/queued bays. Ingest tankers at the gate to test.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {activeInGantry.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => triggerExitDetection(t.regNo)}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-950/40 px-2.5 py-1.5 font-mono text-xs text-emerald-200 hover:border-emerald-400 hover:bg-emerald-900/50 transition"
                  >
                    <Send className="h-3 w-3 text-emerald-400" />
                    <span className="font-bold">{t.regNo}</span>
                    <span className="text-[10px] text-emerald-400/70">({t.bayId ?? "queued"})</span>
                  </button>
                ))}
              </div>
            )}

            {/* Custom Plate Simulator Input */}
            <div className="pt-2 mt-2 border-t border-white/5 flex gap-2">
              <input
                value={simPlate}
                onChange={(e) => setSimPlate(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && triggerExitDetection(simPlate)}
                placeholder="Enter plate e.g. KDA 482X or test unknown..."
                className="input font-mono text-xs flex-1"
              />
              <button
                onClick={() => triggerExitDetection(simPlate)}
                disabled={busy || !simPlate.trim()}
                className="btn-primary text-xs shrink-0"
              >
                Simulate Camera Capture
              </button>
              {primaryCamera.status === "OFFLINE" && (
                <button
                  onClick={() => triggerExitDetection(simPlate, true)}
                  disabled={busy || !simPlate.trim()}
                  className="btn-ghost text-xs shrink-0 border border-amber-500/30 text-amber-300 hover:bg-amber-950/40"
                  title="Force manual departure clearance"
                >
                  Manual Operator Clearance
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Exit Audit Stream Preview */}
        {exitAudits.length > 0 && (
          <div className="pt-2 border-t border-white/5">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
              <History className="h-3 w-3" /> Recent ANPR Exit Audit Trail
            </p>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
              {exitAudits.slice(0, 4).map((audit) => (
                <div
                  key={audit.id}
                  className={`rounded border p-2 text-xs font-mono ${
                    audit.matched
                      ? "border-emerald-500/20 bg-black/40 text-slate-300"
                      : "border-red-500/30 bg-red-950/30 text-red-200"
                  }`}
                >
                  <div className="flex justify-between font-bold">
                    <span>{audit.numberPlate}</span>
                    <span className={audit.matched ? "text-emerald-300" : "text-red-400"}>
                      {audit.newStatus}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                    <span>Bay: {audit.bay ?? "—"}</span>
                    <span>{new Date(audit.detectionTimestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Anomaly triage */}
        <div className="card lg:col-span-2">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
            <AlertTriangle className="h-4 w-4 text-amber-300" /> Open anomalies / SLA breaches
          </p>
          {(anomalies ?? []).length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">No open anomalies — control loop is green.</p>
          ) : (
            <div className="space-y-2">
              {(anomalies ?? []).map((a) => (
                <div
                  key={a.signature}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold text-slate-200">
                      <span className="chip bg-red-500/20 text-red-300">{a.type}</span>
                      <StatusBadge status={a.status} pulse={a.status === "OPEN"} />
                      {a.severity === "critical" && (
                        <span className="chip bg-amber-500/20 text-amber-300">auto-actioned</span>
                      )}
                    </p>
                    <p className="mt-1 truncate text-xs text-slate-400">{a.message}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-600">{a.signature}</p>
                  </div>
                  <button
                    onClick={() => run(`resolve:${a.signature}`, () => yardApi.resolveAnomaly(a.signature))}
                    disabled={busy}
                    className="btn-ghost shrink-0 text-xs"
                  >
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Re-open/Fix
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Staging override */}
        <div className="card">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
            <SlidersHorizontal className="h-4 w-4" /> Manual allocation
          </p>
          {staged.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">No trucks staging at the gate.</p>
          ) : (
            <div className="space-y-2">
              {staged.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 p-2 text-xs"
                >
                  <div>
                    <p className="font-mono font-semibold">{t.regNo}</p>
                    <p className="text-slate-500">
                      {t.product ?? "?"} · {t.capacityLiters?.toLocaleString()} L
                    </p>
                  </div>
                  <button
                    onClick={() => run("allocate", () => yardApi.allocate(t.id))}
                    disabled={busy}
                    className="btn-primary px-2 py-1 text-[10px]"
                  >
                    Allocate bay
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bay health override grid */}
      <div>
        <p className="mb-3 text-sm font-semibold text-slate-300">
          Gantry bay health — overrides feed the anomaly detector
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Object.entries(bays).map(([bayId, bay]) => (
            <div key={bayId} className="card">
              <BayCard bay={bay} bayId={bayId} />
              <div className="mt-2 flex flex-wrap gap-1">
                {HEALTH_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setHealth(bayId, opt)}
                    className={`rounded px-2 py-1 text-[10px] transition ${
                      bay.status === opt
                        ? "bg-kpc-green/40 text-emerald-200"
                        : "bg-white/5 text-slate-400 hover:bg-white/10"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}