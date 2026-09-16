import { useEffect, useState } from "react";
import {
  Smartphone,
  RefreshCw,
  MapPin,
  BellRing,
  Clock,
  Volume2,
  VolumeX,
  ScanLine,
  CheckCircle2,
  ShieldCheck,
  Award,
} from "lucide-react";
import { useDemoAuth } from "../hooks/useDemoAuth.js";
import { useYardStream } from "../hooks/useYardStream.js";
import { yardApi } from "../services/api.js";
import { speak, isVoiceEnabled } from "../services/speech.js";
import StatusBadge from "../components/StatusBadge.jsx";
import { pushAlert } from "../components/AlertCenter.jsx";

export default function DriverMobile() {
  useDemoAuth("driver", "Truck Driver");
  const [token, setToken] = useState(() => localStorage.getItem("kpc_latest_token") ?? "");
  const [status, setStatus] = useState(null);
  const [alertFeed, setAlertFeed] = useState([]);
  const [error, setError] = useState(null);
  const [voiceOn, setVoiceOn] = useState(() => isVoiceEnabled());
  const [departureDisplay, setDepartureDisplay] = useState(null); // { numberPlate, exitTime }

  useYardStream({
    "gate:entry": (m) => {
      pushSms("Token issued", `You were logged into the yard: ${m.payload.token}`);
    },
    "bay:assigned": (m) => {
      pushSms("Bay assigned", `Report to ${m.payload.bayId} — ETA ~${m.payload.etaMinutes} min`);
      speak(
        `Attention driver. Bay ${m.payload.bayId} assigned. Estimated wait ${m.payload.etaMinutes} minutes. Proceed to gantry ${String(
          m.payload.bayId,
        ).replace(/^G/i, "")}.`,
      );
      if (m.payload.token === token) refresh();
    },
    "queue:sequenced": () => {
      pushSms("Queue re-sequenced", "Closed-loop rerouting adjusted your queue position.");
      speak("Your queue position has been updated by the control plane.");
      refresh();
    },
    "reroute:applied": () => pushSms("Route updated", "Your bay assignment changed — check latest status."),
    "sla:breach": (m) => pushSms("SLA alert", m.payload.message),
    "control:override": () => refresh(),
    "preMovement:alert": (m) => {
      pushSms("Pre-movement", `Gantry ${m.payload.bayId} nearly clear — prepare to move forward`);
      speak(`Gantry ${m.payload.bayId} is nearly clear. Get ready to move forward to the gantry.`);
    },
    "GANTRY_TANKER_EXITED": (m) => {
      const isMyTruck =
        (status && (m.payload.token === status.token || m.payload.numberPlate === status.regNo)) ||
        (token && m.payload.token === token);

      if (isMyTruck || !token) {
        setDepartureDisplay({
          numberPlate: m.payload.numberPlate,
          bay: m.payload.bay,
          exitTime: m.payload.exitTime,
        });
        pushSms("Gantry Exit Recorded", `Vehicle ${m.payload.numberPlate} departure detected by ANPR camera.`);
        speak(
          `Thank you for your visit! Vehicle ${m.payload.numberPlate}. Your loading process has been completed and your departure has been recorded. Welcome again another day, drive safely!`,
        );
        refresh();
      }
    },
    "truck:exited": (m) => {
      if (status && (m.payload.token === status.token || m.payload.regNo === status.regNo)) {
        pushSms("Journey complete", `Vehicle ${m.payload.regNo} cleared the exit gate — token redeemed.`);
        speak(`Vehicle ${m.payload.regNo} has exited the yard. Journey complete. Safe travels!`);
        refresh();
      }
    },
    "compliance:violation": (m) => pushSms("Compliance notice", m.payload.message),
  });

  function pushSms(title, body) {
    setAlertFeed((prev) => [{ title, body, at: new Date().toLocaleTimeString() }, ...prev].slice(0, 8));
    pushAlert({ tone: "success", title, message: body });
  }

  function toggleVoice() {
    const next = !voiceOn;
    setVoiceOn(next);
    localStorage.setItem("kpc_voice_enabled", next ? "on" : "off");
    if (next) speak("Voice guidance enabled.");
  }

  async function refresh() {
    if (!token) return;
    try {
      const data = await yardApi.driverStatus(token);
      setStatus(data);
      if (data?.status === "COMPLETED" || data?.exitDetected) {
        setDepartureDisplay({
          numberPlate: data.regNo,
          bay: data.bayId,
          exitTime: data.exitedAt,
        });
      }
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function track() {
    if (!token.trim()) return;
    localStorage.setItem("kpc_latest_token", token.trim().toUpperCase());
    refresh();
  }

  const [scanning, setScanning] = useState(false);

  async function scanExit() {
    if (!token) return;
    setScanning(true);
    try {
      if (status?.regNo) {
        await yardApi.gantryExitDetection({ numberPlate: status.regNo, cameraId: "GANTRY-EXIT-01" });
      } else {
        await yardApi.scanCheckpoint({ token, checkpoint: "EXIT" });
      }
      pushSms("Exit gate scanned", "Barrier raised — token redeemed. Safe journey.");
      speak("Exit barrier cleared. Your journey is complete. Safe travels.");
      await refresh();
    } catch (err) {
      pushSms("Exit scan failed", err.message);
    } finally {
      setScanning(false);
    }
  }

  const eta = status?.etaMinutes;
  const stage = status?.checkpoint ?? "GATE";
  const stageIndex = ["GATE", "WEIGHBRIDGE", "GANTRY", "EXIT"].indexOf(stage) + 1;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Driver Mobile</h1>
          <p className="text-xs text-slate-400">Real-time token tracking & push alerts</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleVoice} title="Toggle voice guidance" className="btn-ghost px-2 py-1.5">
            {voiceOn ? <Volume2 className="h-4 w-4 text-emerald-300" /> : <VolumeX className="h-4 w-4 text-slate-500" />}
          </button>
          <Smartphone className="h-5 w-5 text-emerald-300" />
        </div>
      </div>

      {/* Driver-Facing Departure Display Billboard */}
      {departureDisplay && (
        <div className="relative overflow-hidden rounded-xl border-2 border-emerald-400 bg-gradient-to-b from-emerald-950 via-slate-900 to-black p-5 text-center shadow-[0_0_35px_rgba(16,185,129,0.3)] animate-in fade-in zoom-in duration-300">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
            <CheckCircle2 className="h-6 w-6 text-emerald-400" />
          </div>

          <p className="font-mono text-xs uppercase tracking-[0.25em] text-emerald-400">
            ━━━━━━━━━━━━━━━━━━━━━━━━━━
          </p>
          <h2 className="text-base font-black uppercase tracking-wider text-white">
            THANK YOU FOR YOUR VISIT
          </h2>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-emerald-400">
            ━━━━━━━━━━━━━━━━━━━━━━━━━━
          </p>

          <div className="my-4 rounded-lg border border-white/10 bg-black/50 py-3">
            <p className="text-[10px] uppercase tracking-widest text-slate-400">Vehicle Number Plate</p>
            <p className="mt-1 font-mono text-2xl font-black tracking-widest text-emerald-300">
              {departureDisplay.numberPlate}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-left text-xs bg-emerald-950/40 border border-emerald-500/20 rounded-lg p-2.5 mb-3">
            <div>
              <span className="text-[10px] uppercase text-slate-400 block">Loading Status</span>
              <span className="font-bold text-emerald-300">COMPLETED ✓</span>
            </div>
            <div>
              <span className="text-[10px] uppercase text-slate-400 block">Gantry Departure</span>
              <span className="font-bold text-emerald-300">RECORDED ✓</span>
            </div>
          </div>

          <p className="text-xs text-slate-300 italic">Welcome again another day.</p>
          <p className="mt-1 font-bold text-sm uppercase tracking-wider text-emerald-400 font-mono">
            DRIVE SAFELY
          </p>

          <button
            onClick={() => setDepartureDisplay(null)}
            className="mt-4 btn-ghost text-xs w-full border border-white/10 py-1.5"
          >
            Dismiss Departure Card
          </button>
        </div>
      )}

      <div className="card flex gap-2">
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && track()}
          placeholder="Njiasmart token…"
          className="input font-mono"
        />
        <button onClick={track} className="btn-primary shrink-0">
          Track
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-400/40 bg-red-950/60 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {status && (
        <>
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-sm font-bold">{status.regNo}</p>
                <p className="text-[10px] uppercase tracking-widest text-slate-500">{status.token}</p>
              </div>
              <StatusBadge pulse status={status.status} />
            </div>

            <div className="flex gap-1">
              {["Gate", "Weighbridge", "Gantry", "Exit"].map((label, i) => (
                <div key={label} className="flex-1 text-center">
                  <div
                    className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full border text-[10px] ${
                      i + 1 <= stageIndex
                        ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                        : "border-white/10 text-slate-600"
                    }`}
                  >
                    {i + 1}
                  </div>
                  <p className="mt-1 text-[9px] text-slate-400">{label}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg bg-black/25 p-2">
                <Clock className="mx-auto mb-1 h-4 w-4 text-amber-300" />
                <p className="font-mono text-lg">{eta ?? "—"}</p>
                <p className="text-[10px] text-slate-500">ETA (min)</p>
              </div>
              <div className="rounded-lg bg-black/25 p-2">
                <MapPin className="mx-auto mb-1 h-4 w-4 text-emerald-300" />
                <p className="font-mono text-lg">{status.bayId ?? "—"}</p>
                <p className="text-[10px] text-slate-500">Assigned Bay</p>
              </div>
            </div>

            {status.bay && (
              <div className="rounded-lg border border-emerald-400/30 bg-emerald-950/40 p-3 text-xs text-emerald-200">
                <p className="font-semibold">{status.bay.name}</p>
                <p className="mt-0.5 text-emerald-300/80">
                  {status.bay.product} · {status.bay.pumpRateLpm} L/min · queue{" "}
                  {Object.keys(status.bay.queuedVehicles ?? {}).length}
                </p>
              </div>
            )}
          </div>

          <button onClick={refresh} className="btn-ghost w-full text-xs">
            <RefreshCw className="mr-1 h-3 w-3" /> Refresh status
          </button>

          {status.status === "LOADED" && (
            <button onClick={scanExit} disabled={scanning} className="btn-primary w-full text-xs">
              <ScanLine className="mr-1 h-3 w-3" />{" "}
              {scanning ? "Triggering exit camera…" : "Pass Gantry Exit Camera — Complete Journey"}
            </button>
          )}
        </>
      )}

      <div className="card">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300">
          <BellRing className="h-4 w-4" /> Push alerts
        </div>
        {alertFeed.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">No alerts yet — the yard is quiet.</p>
        ) : (
          <div className="space-y-2">
            {alertFeed.map((a, i) => (
              <div key={i} className="rounded-lg bg-black/25 p-2 text-xs">
                <p className="font-semibold text-emerald-300">{a.title}</p>
                <p className="text-slate-400">{a.body}</p>
                <p className="mt-1 font-mono text-[10px] text-slate-600">{a.at}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}