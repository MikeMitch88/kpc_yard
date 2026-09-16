import { useState, useEffect, useMemo } from "react";
import {
  Camera,
  QrCode,
  ScanLine,
  ArrowRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Volume2,
  VolumeX,
  AlertTriangle,
} from "lucide-react";
import { useDemoAuth } from "../hooks/useDemoAuth.js";
import { yardApi } from "../services/api.js";
import { speak } from "../services/speech.js";
import DepotCameraGrid from "../components/DepotCameraGrid.jsx";
import TankerSvg from "../components/TankerSvg.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { pushAlert } from "../components/AlertCenter.jsx";

const MANIFEST_PLATES = [
  "KCA 123X",
  "KDB 456Y",
  "KEC 789Z",
  "KFD 321A",
  "KGE 654B",
  "KHF 987C",
  "KJG 246D",
  "KKH 135E",
  "KMJ 864F",
  "KNK 753G",
];

const rnd = (chars) => chars[Math.floor(Math.random() * chars.length)];

function PlateReadout({ text, locked, status, conf }) {
  const raw = (text || "").padEnd(8, "·").slice(0, 8).split("");
  return (
    <div className="absolute bottom-[15%] left-1/2 z-10 -translate-x-1/2 w-fit">
      <div
        className={`rounded-md px-3 py-1.5 font-mono text-sm font-bold tracking-[0.4em] transition-all duration-300 ${
          status === "ok"
            ? "bg-emerald-400 text-emerald-950 shadow-[0_0_22px_rgba(16,185,129,0.65)]"
            : status === "no"
              ? "bg-red-500 text-red-950"
              : "bg-white/95 text-slate-900"
        }`}
      >
        {raw.map((c, i) => {
          if (c === "·")
            return (
              <span key={i} className="opacity-30">
                ·
              </span>
            );
          if (status === "ok" || status === "no") return <span key={i}>{c}</span>;
          if (i < locked)
            return (
              <span key={i} className="text-kpc-green">
                {c}
              </span>
            );
          return (
            <span key={i} className="opacity-60">
              {i % 2 ? rnd("1234567890") : rnd("ABCDEFGHJKMNPQRSTUVWXZ")}
            </span>
          );
        })}
      </div>
      <div className="mt-1 text-center font-mono text-[9px] tracking-widest text-white/50">
        {status === "ok" ? `READ OK · ${conf}% CONF` : status === "no" ? "NO READ" : "READING…"}
      </div>
    </div>
  );
}

function OcrReticle({ active, confirmed }) {
  const tone = confirmed ? "border-emerald-400" : active ? "border-amber-300" : "border-white/20";
  return (
    <div
      className={`pointer-events-none absolute inset-x-[18%] top-[30%] bottom-[12%] z-[6] rounded-lg border-2 ${tone} transition-colors duration-300 ${
        active ? "animate-pulse" : "opacity-30"
      }`}
    >
      <span className="absolute -top-2.5 left-2 rounded bg-black/70 px-1.5 font-mono text-[9px] tracking-widest text-white/80">
        OCR-{confirmed ? "LOCKED" : "TRACKING"}
      </span>
      <span className="absolute -top-2.5 right-2 font-mono text-[9px] text-white/60">
        {confirmed ? "✓ 100%" : "23.4 fps"}
      </span>
    </div>
  );
}

export default function GateKiosk() {
  const auth = useDemoAuth("gate-officer", "Gate Operator");
  const [regNo, setRegNo] = useState("");
  const [plate, setPlate] = useState(null);
  const [entry, setEntry] = useState(null);
  const [busy, setBusy] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [voiceOn, setVoiceOn] = useState(() => localStorage.getItem("kpc_voice_enabled") !== "off");
  const [smsPhone, setSmsPhone] = useState("");
  const [smsResult, setSmsResult] = useState(null);
  const [weightResult, setWeightResult] = useState(null);

  const [driveTick, setDriveTick] = useState(0);
  const [recording, setRecording] = useState(false);
  const [lockedChars, setLockedChars] = useState(0);
  const [readInfo, setReadInfo] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [now, setNow] = useState(() => new Date());
  const [surgeSimulated, setSurgeSimulated] = useState(false);
  const [surgeBanner, setSurgeBanner] = useState(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const decodeTarget = (regNo.trim() || plate || "").toUpperCase();

  async function capture() {
    if (!regNo.trim()) return;
    if (surgeSimulated) resolveSurge();
    const target = regNo.trim().toUpperCase();
    setBusy(true);
    setRecording(true);
    setLockedChars(0);
    setReadInfo(null);
    setScanResult(null);
    setEntry(null);
    setPlate(null);
    setPhase("scanning");
    setDriveTick((t) => t + 1);
    setSmsResult(null);
    setWeightResult(null);

    const iv = setInterval(() => setLockedChars((n) => Math.min(n + 1, target.length)), 220);
    try {
      const result = await yardApi.gateEntry({ regNo: target, depot: "MBA" });
      setEntry(result);
      setSmsPhone(result.truck.driverPhone ?? "");
      setPlate(result.truck.regNo);
      localStorage.setItem("kpc_latest_token", result.token);
      setReadInfo({ ok: true, conf: 94 + Math.floor(Math.random() * 5) });
      setPhase("confirmed");
      speak(`Vehicle ${result.truck.regNo} verified against manifest. Token ${result.token}. Please proceed to the weigh bridge.`);
      pushAlert({
        tone: result.manifestVerified ? "success" : "warning",
        title: "ANPR Match Confirmed",
        message: `${result.token} — ${result.truck.regNo}`,
      });
    } catch (err) {
      setReadInfo({ ok: false });
      setPhase("rejected");
      speak(`Unable to verify plate ${target}. ${err.message}`);
      pushAlert({ tone: "error", title: "Gate Capture Failed", message: err.message });
    } finally {
      clearInterval(iv);
      setLockedChars(target.length);
      setRecording(false);
      setBusy(false);
    }
  }

  async function runCheckpoint(checkpoint) {
    if (!entry) return;
    setBusy(true);
    try {
      const checkpointPayload = { token: entry.truck.token, checkpoint };
      if (checkpoint === "WEIGHBRIDGE" && entry.truck.expectedGrossWeightKg) {
        // Simulated scale reading: nominal expected gross with a tiny jitter
        const jitter = 1 + (Math.random() - 0.5) * 0.008;
        checkpointPayload.payload = { grossWeightKg: Math.round(entry.truck.expectedGrossWeightKg * jitter) };
      }
      const result = await yardApi.scanCheckpoint(checkpointPayload);
      setScanResult(result);
      if (result.weight) setWeightResult(result.weight);
      if (result.allocation) {
        const { assignment } = result.allocation;
        speak(`Bay ${assignment.bayId} assigned. Estimated wait ${assignment.etaMinutes} minutes. Please proceed to gantry ${assignment.bayId.replace(/^G/i, "")}.`);
        pushAlert({
          tone: "success",
          title: "Bay Auto-Assigned",
          message: `${entry.truck.regNo} → ${assignment.bayId} (ETA ~${assignment.etaMinutes} min)`,
        });
      } else {
        speak(`Checkpoint ${checkpoint} verified. Continue forward.`);
        pushAlert({
          tone: checkpoint === "WEIGHBRIDGE" ? "warning" : "success",
          title: `RFID @ ${checkpoint}`,
          message: `${entry.truck.token}`,
        });
      }
    } catch (err) {
      speak(`Scanner error at ${checkpoint}. ${err.message}`);
      pushAlert({ tone: "error", title: "Scanner Error", message: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function dispatchSmsPass() {
    if (!entry) return;
    setBusy(true);
    setSmsResult(null);
    try {
      const phone = smsPhone.trim() || entry.truck.driverPhone || "";
      const res = await yardApi.dispatchSms({ token: entry.token, phone: phone || undefined });
      setSmsResult(res);
      if (res.ok) {
        speak(`SMS queue pass dispatched to ${res.to}.`);
        pushAlert({
          tone: res.emulated ? "info" : "success",
          title: res.emulated ? "SMS queued (gateway offline)" : "SMS dispatched — TALK-SASA",
          message: `Token ${entry.token} → ${res.to}`,
        });
      } else {
        speak(`SMS dispatch failed. ${res.reason}`);
        pushAlert({ tone: "error", title: "SMS dispatch failed", message: res.reason });
      }
    } catch (err) {
      speak(`SMS dispatch error. ${err.message}`);
      pushAlert({ tone: "error", title: "SMS dispatch failed", message: err.message });
    } finally {
      setBusy(false);
    }
  }

  function toggleVoice() {
    setVoiceOn((v) => {
      const next = !v;
      localStorage.setItem("kpc_voice_enabled", next ? "on" : "off");
      if (next) speak("Voice guidance enabled.");
      return next;
    });
  }

  function resolveSurge() {
    setSurgeSimulated(false);
    setSurgeBanner(null);
    pushAlert({
      tone: "success",
      title: "Surge Resolved",
      message: "Traffic normalized. Queue cleared.",
    });
  }

  function simulateSurge() {
    if (surgeSimulated) {
      resolveSurge();
      return;
    }
    setSurgeSimulated(true);
    setSurgeBanner({
      active: true,
      at: new Date(),
      queued: 12,
      message: "12 tankers staged at Main Gate · Holding Yard congestion critical · auto-reroute engaged",
    });
    pushAlert({
      tone: "error",
      title: "Surge Simulation Active",
      message: "12 tankers staged · Holding Yard congestion high · auto-rerouting engaged",
    });
    speak("Warning: fleet surge detected. Twelve tankers staged at the main gate. Holding yard congestion is critical.");
  }

  const filtered = useMemo(
    () => MANIFEST_PLATES.filter((p) => p.toLowerCase().includes(regNo.toLowerCase())),
    [regNo],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gate Kiosk — Cinematic ANPR Entry</h1>
          <p className="text-sm text-slate-400">
            Slow-motion capture · OCR lock → manifest validation → digital token issuance
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge pulse status={auth.ready ? "ACTIVE" : "WAITING"} />
          <button
            onClick={simulateSurge}
            disabled={busy}
            className={`btn px-3 py-1.5 ${
              surgeSimulated
                ? "border border-red-400/70 bg-red-500/25 text-red-200 animate-pulse"
                : "btn-ghost border border-red-400/40 text-red-300 hover:bg-red-500/10"
            }`}
            title="Toggle a fleet surge to stage 12 tankers and raise yard congestion alerts"
          >
            <AlertTriangle className="h-4 w-4" />
            {surgeSimulated ? "End Fleet Surge" : "Simulate Fleet Surge"}
          </button>
          <button onClick={toggleVoice} title="Toggle voice guidance" className="btn-ghost px-2 py-1.5">
            {voiceOn ? <Volume2 className="h-4 w-4 text-emerald-300" /> : <VolumeX className="h-4 w-4 text-slate-500" />}
          </button>
        </div>
      </div>

      {surgeBanner?.active && (
        <div className="flex items-center gap-3 rounded-lg border border-red-400/60 bg-red-500/10 px-4 py-3 animate-pulse">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-300" />
          <div className="flex-1">
            <p className="text-sm font-bold text-red-100">FLEET SURGE — HOLDING YARD CONGESTION CRITICAL</p>
            <p className="text-xs text-red-200/80">{surgeBanner.message}</p>
          </div>
          <span className="font-mono text-xs text-red-200/70">{surgeBanner.queued} tankers staged</span>
        </div>
      )}

      <DepotCameraGrid surgeActive={surgeSimulated} plateText={entry?.truck?.regNo ?? plate ?? "KFD 321A"} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Cinematic ANPR camera */}
        <div className="card space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
            <Camera className="h-4 w-4" /> ANPR Camera 01 — Main Gate
          </div>

          <div className="anpr-scene aspect-video">
            <div className="anpr-road" />

            <div key={driveTick} className={`anpr-truck ${recording ? "enter" : "cruise"}`}>
              <TankerSvg gradientId="gate-tank" className="h-full w-full" />
            </div>

            <div className="anpr-corner tl" />
            <div className="anpr-corner tr" />
            <div className="anpr-corner bl" />
            <div className="anpr-corner br" />
            <div className="anpr-scanline" />
            <div className="anpr-laser" />
            {phase === "scanning" && <div className="anpr-laser-sweep" />}

            {(phase === "scanning" || phase === "confirmed") && (
              <div
                className={`ocr-snap ${phase === "confirmed" ? "border-emerald-300" : "opacity-80"}`}
                style={{ left: "30%", right: "30%", top: "56%", height: "34px" }}
              />
            )}

            {phase === "confirmed" && (
              <div className="conf-pop absolute left-1/2 top-[38%] z-20 rounded-lg border border-emerald-400/70 bg-emerald-950/90 px-3 py-1.5 text-center font-mono text-base font-bold tracking-widest text-emerald-200 shadow-[0_0_24px_rgba(16,185,129,0.55)]">
                {readInfo?.conf ?? 98.4}% MATCH
              </div>
            )}

            <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded bg-red-600/90 px-2 py-0.5 font-mono text-[10px] font-semibold text-white">
              <span className={`h-2 w-2 rounded-full bg-white ${recording ? "animate-ping" : "opacity-70"}`} />
              REC{recording ? "" : " · IDLE"}
            </div>
            {recording && (
              <div className="absolute left-3 top-8 z-10 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] text-amber-200">
                ⏪ SLOW-MO · 0.25×
              </div>
            )}

            {phase === "confirmed" && (
              <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 flex-col items-center gap-1 rounded-xl border border-emerald-400/60 bg-emerald-950/85 px-3 py-1.5 text-center backdrop-blur">
                <p className="flex items-center gap-1.5 font-mono text-xs font-bold tracking-widest text-emerald-200">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> ANPR MATCH CONFIRMED
                </p>
                <p className="font-mono text-[9px] text-emerald-300/80">
                  {readInfo?.conf}% CONF · {entry?.truck?.product ?? "—"} · MANIFEST {entry?.manifestVerified ? "✓" : "HOLD"}
                </p>
              </div>
            )}
            {phase === "rejected" && (
              <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-xl border border-red-400/60 bg-red-950/85 px-3 py-1.5 backdrop-blur">
                <XCircle className="h-3.5 w-3.5 text-red-300" />
                <p className="font-mono text-xs font-bold tracking-widest text-red-200">READ FAILED</p>
              </div>
            )}

            <div className="absolute right-3 top-3 z-10 font-mono text-[10px] text-emerald-200/90">
              {now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}{" "}
              {now.toLocaleTimeString("en-GB")}
            </div>
            <div className="absolute bottom-3 right-3 z-10 font-mono text-[9px] text-white/40">CAM-01 · SBX-2200 · 4K OCR</div>

            <OcrReticle active={phase === "scanning"} confirmed={phase === "confirmed"} />
            <PlateReadout
              text={decodeTarget}
              locked={lockedChars}
              status={readInfo ? (readInfo.ok ? "ok" : "no") : "reading"}
              conf={readInfo?.conf}
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-slate-400">Vehicle Reg No.</label>
            <div className="mt-1 flex gap-2">
              <input
                value={regNo}
                onChange={(e) => setRegNo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && capture()}
                placeholder="e.g. KKH 135E"
                className="input font-mono"
              />
              <button onClick={capture} disabled={busy} className="btn-primary shrink-0">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
              </button>
            </div>
            {filtered.length > 0 && regNo && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {filtered.map((p) => (
                  <button
                    key={p}
                    onClick={() => setRegNo(p)}
                    className="chip border border-white/15 bg-white/5 text-slate-300 hover:bg-white/10"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Token & journey status */}
        <div className="card space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
            <QrCode className="h-4 w-4" /> Digital Token / Journey
          </div>

          {!entry ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Capture a vehicle to issue its digital token.
            </p>
          ) : (
            <>
              <div className="rounded-lg border border-kpc-green/40 bg-kpc-green/10 p-4 text-center">
                <p className="text-xs uppercase tracking-widest text-emerald-300">Issued Token</p>
                <p className="mt-1 font-mono text-lg font-bold text-white">{entry.token}</p>
                <div className="mt-2 flex justify-center gap-2">
                  <StatusBadge pulse status={entry.truck.status} />
                  {entry.manifestVerified ? (
                    <span className="chip bg-emerald-500/20 text-emerald-300">Manifest ✓</span>
                  ) : (
                    <span className="chip bg-amber-500/20 text-amber-300">Verification Hold</span>
                  )}
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <p className="flex justify-between">
                  <span className="text-slate-400">Product</span>
                  <b>{entry.truck.product ?? "—"}</b>
                </p>
                <p className="flex justify-between">
                  <span className="text-slate-400">Capacity</span>
                  <b>{entry.truck.capacityLiters?.toLocaleString()} L</b>
                </p>
                <p className="flex justify-between">
                  <span className="text-slate-400">Driver</span>
                  <b>{entry.truck.driverName}</b>
                </p>
                <p className="flex justify-between">
                  <span className="text-slate-400">Assigned Bay</span>
                  <b className="text-emerald-300">{entry.truck.bayId ?? "auto (at weighbridge)"}</b>
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button onClick={() => runCheckpoint("GATE")} disabled={busy} className="btn-ghost text-xs">
                  RFID Gate
                </button>
                <button onClick={() => runCheckpoint("WEIGHBRIDGE")} disabled={busy} className="btn-primary text-xs">
                  Weighbridge → Auto Bay Allocate
                </button>
              </div>

              {weightResult && (
                <div
                  className={`mt-2 rounded-lg border p-3 text-xs ${
                    weightResult.pass
                      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                      : "border-red-400/40 bg-red-500/10 text-red-200"
                  }`}
                >
                  <p className="font-semibold">Weighbridge Verification {weightResult.pass ? "✓ PASS" : "✗ HOLD"}</p>
                  <p className="mt-1">
                    Gross {weightResult.grossWeightKg?.toLocaleString()} kg — expected {weightResult.expectedGrossKg?.toLocaleString()} kg (Δ{" "}
                    {weightResult.diffKg} kg / ±{weightResult.tolerancePct}%)
                  </p>
                </div>
              )}

              <div className="mt-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
                <p className="text-xs font-semibold text-blue-300">Dispatch & Send SMS Pass</p>
                <label className="mt-2 block text-[10px] uppercase tracking-wider text-slate-400">Driver Phone</label>
                <div className="mt-1 flex gap-2">
                  <input
                    value={smsPhone}
                    onChange={(e) => setSmsPhone(e.target.value)}
                    placeholder="+254711000001 or 0745074245"
                    className="input font-mono text-xs"
                  />
                  <button onClick={dispatchSmsPass} disabled={busy || !entry?.token} className="btn-primary shrink-0 text-xs">
                    Send SMS Pass
                  </button>
                </div>
                {smsResult && (
                  <p className={`mt-2 text-xs ${smsResult.ok ? "text-emerald-300" : "text-red-300"}`}>
                    {smsResult.ok
                      ? `✓ ${smsResult.emulated ? "Queued — SMS gateway offline" : "Sent via TALK-SASA"} → ${smsResult.to}`
                      : `✗ ${smsResult.reason}`}
                  </p>
                )}
              </div>

              {scanResult?.allocation && (
                <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                  <p className="font-semibold">Autonomous Bay Allocation Engine</p>
                  <p className="mt-1">
                    Assigned <b>{scanResult.allocation.assignment.bayId}</b> — wait ~
                    {scanResult.allocation.assignment.etaMinutes} min, load ~
                    {scanResult.allocation.assignment.forecastLoadMinutes} min
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {scanResult.allocation.assignment.auditLog.map((a) => (
                      <span key={a.bayId} className="chip border border-white/10 bg-black/20 text-slate-300">
                        {a.bayId} · score {a.score}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Journey pipeline */}
      <div className="card">
        <p className="mb-3 text-sm font-semibold text-slate-300">Closed-loop journey</p>
        <div className="grid gap-2 md:grid-cols-4">
          {[
            { label: "Gate Entry", done: Boolean(entry?.token) },
            { label: "Weighbridge RFID", done: Boolean(scanResult?.checkpoint?.checkpoint === "WEIGHBRIDGE") },
            { label: "Bay Auto-Assigned", done: Boolean(scanResult?.allocation) },
            { label: "Loading Gantry", done: false },
          ].map((s, i) => (
            <div
              key={s.label}
              className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${
                s.done
                  ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                  : "border-white/10 bg-black/20 text-slate-500"
              }`}
            >
              {s.done ? <CheckCircle2 className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
              <span>{s.label}</span>
              <span className="ml-auto font-mono text-[10px]">0{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}