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
  Fuel,
  Send,
  Sparkles,
  Radio,
} from "lucide-react";
import { useDemoAuth } from "../hooks/useDemoAuth.js";
import { useYardStream } from "../hooks/useYardStream.js";
import { yardApi } from "../services/api.js";
import { speak } from "../services/speech.js";
import DepotCameraGrid from "../components/DepotCameraGrid.jsx";
import TankerSvg from "../components/TankerSvg.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { pushAlert } from "../components/AlertCenter.jsx";

const MANIFEST_PLATES = [
  "KDX 100X",
  "KDX 110X",
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
  "KDD 001D",
  "KLM 246A",
  "KNP 357B",
  "KQR 468C",
  "KST 579D",
  "KUV 680E",
  "KVW 791F",
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

  // Gantry filled & exit states
  const [gantryStatus, setGantryStatus] = useState("IDLE"); // IDLE | LOADING | FILLED | EXITED
  const [spokenMessage, setSpokenMessage] = useState(null);
  const [exitDetection, setExitDetection] = useState(null);
  const [countdown, setCountdown] = useState(null);

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

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      handleGantryFilledAndExit();
      return;
    }
    const timer = setTimeout(() => {
      setCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  useYardStream({
    "loading:completed": (m) => {
      if (entry && (m.payload.truckId === entry.truck.id || m.payload.regNo === entry.truck.regNo)) {
        setGantryStatus("FILLED");
        const msg = `Gantry filled! Vehicle ${m.payload.regNo} has completed fuel loading at bay ${m.payload.bayId}. Please proceed to the exit ANPR camera.`;
        setSpokenMessage(msg);
        speak(msg);
        pushAlert({
          tone: "success",
          title: "Gantry Filled",
          message: `${m.payload.regNo} @ ${m.payload.bayId} — 100% loaded.`,
        });
      }
    },
    "GANTRY_TANKER_EXITED": (m) => {
      if (entry && (m.payload.tankerId === entry.truck.id || m.payload.numberPlate === entry.truck.regNo)) {
        setGantryStatus("EXITED");
        setExitDetection(m.payload);
        setCountdown(null);
        const msg = `Thank you for your visit! Vehicle ${m.payload.numberPlate}. Your loading process has been completed and your departure has been recorded. Welcome again another day. Drive safely!`;
        setSpokenMessage(msg);
        speak(msg);
        pushAlert({
          tone: "success",
          title: "Departure Voice Broadcast",
          message: `${m.payload.numberPlate} departed — bay released.`,
        });
      }
    },
  });

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
    setGantryStatus("IDLE");
    setCountdown(null);
    setSpokenMessage(null);
    setExitDetection(null);
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
      const msg = `Vehicle ${result.truck.regNo} verified against manifest. Token ${result.token}. Please proceed to the weigh bridge.`;
      setSpokenMessage(msg);
      speak(msg);
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
        const jitter = 1 + (Math.random() - 0.5) * 0.008;
        checkpointPayload.payload = { grossWeightKg: Math.round(entry.truck.expectedGrossWeightKg * jitter) };
      }
      const result = await yardApi.scanCheckpoint(checkpointPayload);
      setScanResult(result);
      if (result.weight) setWeightResult(result.weight);
      if (result.allocation) {
        const { assignment } = result.allocation;
        const msg = `Bay ${assignment.bayId} assigned. Estimated wait ${assignment.etaMinutes} minutes. Please proceed to gantry ${assignment.bayId.replace(/^G/i, "")}.`;
        setSpokenMessage(msg);
        speak(msg);
        pushAlert({
          tone: "success",
          title: "Bay Auto-Assigned",
          message: `${entry.truck.regNo} → ${assignment.bayId} (ETA ~${assignment.etaMinutes} min)`,
        });
      } else {
        const msg = `Checkpoint ${checkpoint} verified. Continue forward.`;
        setSpokenMessage(msg);
        speak(msg);
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

  async function handleStartLoading(withTimer = false, duration = 30) {
    if (!entry) return;
    const assignedBayId = scanResult?.allocation?.assignment?.bayId ?? entry.truck.bayId ?? "B03";
    setBusy(true);
    try {
      await yardApi.startLoading(entry.truck.id, assignedBayId);
      setGantryStatus("LOADING");
      if (withTimer) {
        setCountdown(duration);
      }
      const msg = `Loading started for vehicle ${entry.truck.regNo} at bay ${assignedBayId}. Pumps are now active.${withTimer ? ` Auto-departure timer set for ${duration} seconds.` : ""}`;
      setSpokenMessage(msg);
      speak(msg);
      pushAlert({
        tone: "success",
        title: "Gantry Loading Started",
        message: `${entry.truck.regNo} @ ${assignedBayId}${withTimer ? ` (30s stay demo active)` : ""}`,
      });
    } catch (err) {
      speak(`Error starting loading. ${err.message}`);
      pushAlert({ tone: "error", title: "Loading Error", message: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleGantryFilledAndExit() {
    if (!entry) return;
    setCountdown(null);
    const targetPlate = entry.truck.regNo;
    const assignedBayId = scanResult?.allocation?.assignment?.bayId ?? entry.truck.bayId ?? "B03";
    setBusy(true);
    try {
      setGantryStatus("FILLED");
      // Trigger ANPR exit camera detection directly — marks LOADED + EXITED, frees bay, speaks thank-you voice
      const res = await yardApi.gantryExitDetection({
        numberPlate: targetPlate,
        cameraId: "GANTRY-EXIT-01",
      });

      setExitDetection(res);
      setGantryStatus("EXITED");
      const voiceSpeech = `Thank you for your visit! Vehicle ${targetPlate}. Your loading process has been completed and your departure has been recorded. Welcome again another day. Drive safely!`;
      setSpokenMessage(voiceSpeech);
      speak(voiceSpeech);

      pushAlert({
        tone: "success",
        title: "Gantry Filled & Departure Voice Broadcast",
        message: `${targetPlate} completed at ${assignedBayId}. Bay released.`,
      });
    } catch (err) {
      speak(`Exit detection failed. ${err.message}`);
      pushAlert({ tone: "error", title: "Exit Error", message: err.message });
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
          <h1 className="text-2xl font-bold">Gate Kiosk — ANPR & Gantry Control</h1>
          <p className="text-sm text-slate-400">
            ANPR entry capture → weighbridge → AI bay assignment → Gantry filled & voice departure
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

      {/* Live Voice Broadcast Banner when talking */}
      {spokenMessage && (
        <div className="relative overflow-hidden rounded-xl border border-emerald-400/40 bg-gradient-to-r from-emerald-950/80 via-slate-900 to-black p-4 text-xs shadow-lg animate-in fade-in duration-300">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-emerald-500/20 p-2 text-emerald-300">
                <Radio className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <span className="live-dot h-2 w-2 rounded-full bg-emerald-400" />
                  Njiasmart Voice Guidance · Live Audio Broadcast
                </p>
                <p className="mt-1 font-medium text-slate-200 text-sm italic">
                  &ldquo;{spokenMessage}&rdquo;
                </p>
              </div>
            </div>
            <button
              onClick={() => speak(spokenMessage)}
              className="btn-ghost shrink-0 border border-emerald-400/30 text-emerald-300 text-[11px] px-2.5 py-1"
              title="Repeat speech"
            >
              <Volume2 className="mr-1 h-3.5 w-3.5" /> Re-play Speech
            </button>
          </div>
        </div>
      )}
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

            <OcrReticle active={recording} confirmed={phase === "confirmed"} />

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

            <PlateReadout
              text={decodeTarget}
              locked={lockedChars}
              status={readInfo?.ok ? "ok" : readInfo ? "no" : "reading"}
              conf={readInfo?.conf ?? 96}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-wider text-slate-400">
              Scheduled Plate on Manifest
            </label>
            <div className="flex gap-2">
              <input
                value={regNo}
                onChange={(e) => setRegNo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && capture()}
                placeholder="e.g. KDB 456Y"
                className="input font-mono"
              />
              <button onClick={capture} disabled={busy || !regNo.trim()} className="btn-primary shrink-0">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
                Ingest Vehicle
              </button>
            </div>

            <div className="flex flex-wrap gap-1 pt-1">
              {filtered.slice(0, 5).map((p) => (
                <button
                  key={p}
                  onClick={() => setRegNo(p)}
                  className="chip border border-white/10 bg-white/5 font-mono text-[10px] text-slate-300 hover:bg-white/10"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Token & journey status */}
        <div className="card space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
            <QrCode className="h-4 w-4" /> Digital Token / Operational Control
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
                  <StatusBadge pulse status={gantryStatus === "EXITED" ? "COMPLETED" : gantryStatus === "FILLED" ? "LOADED" : entry.truck.status} />
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
                  <b className="text-emerald-300">
                    {scanResult?.allocation?.assignment?.bayId ?? entry.truck.bayId ?? "auto (at weighbridge)"}
                  </b>
                </p>
              </div>

              <div className="flex flex-wrap gap-2 pt-1 border-t border-white/10">
                <button onClick={() => runCheckpoint("GATE")} disabled={busy} className="btn-ghost text-xs">
                  RFID Gate
                </button>
                <button onClick={() => runCheckpoint("WEIGHBRIDGE")} disabled={busy} className="btn-primary text-xs">
                  Weighbridge → Auto Bay Allocate
                </button>
              </div>

              {/* Gantry Loading & Filled Talking Controls */}
              {scanResult?.allocation && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                      <Fuel className="h-4 w-4" /> Gantry Operations & Voice Announcement
                    </p>
                    {countdown !== null && (
                      <span className="chip border border-emerald-400 bg-emerald-500/20 text-emerald-200 font-mono text-[11px] animate-pulse">
                        ⏳ 30s Stay: {countdown}s left
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-300">
                    Once at the gantry, click below to start loading (with optional 30s stay demo), fill the tanker, and trigger the voice departure broadcast.
                  </p>

                  {countdown !== null && (
                    <div className="space-y-1.5 pt-1 rounded-md bg-black/30 p-2.5 border border-emerald-500/20">
                      <div className="flex justify-between text-[11px] text-emerald-300 font-mono font-medium">
                        <span>Demo Stay in Progress ({entry.truck.regNo})</span>
                        <span>{countdown}s until exit</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 transition-all duration-1000"
                          style={{ width: `${Math.max(0, Math.min(100, ((30 - countdown) / 30) * 100))}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => handleStartLoading(false)}
                      disabled={busy || gantryStatus === "FILLED" || gantryStatus === "EXITED"}
                      className="btn-ghost text-xs border border-white/10"
                    >
                      Start Loading
                    </button>
                    <button
                      onClick={() => handleStartLoading(true, 30)}
                      disabled={busy || countdown !== null || gantryStatus === "FILLED" || gantryStatus === "EXITED"}
                      className="btn-primary text-xs bg-cyan-600 hover:bg-cyan-500 text-white font-bold flex items-center gap-1.5"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> Start 30s Demo Stay & Auto-Exit
                    </button>
                    <button
                      onClick={handleGantryFilledAndExit}
                      disabled={busy}
                      className="btn-primary text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> {countdown !== null ? "Exit Now (Skip 30s)" : "Gantry Filled → Speak & Clear Exit"}
                    </button>
                    {countdown !== null && (
                      <button
                        onClick={() => setCountdown(null)}
                        className="btn-ghost text-xs text-rose-300 hover:bg-rose-500/20 border border-rose-500/30"
                      >
                        Cancel Timer
                      </button>
                    )}
                  </div>
                </div>
              )}

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

      {/* Closed-loop journey pipeline */}
      <div className="card">
        <p className="mb-3 text-sm font-semibold text-slate-300">Closed-loop journey</p>
        <div className="grid gap-2 md:grid-cols-5">
          {[
            { label: "Gate Entry", done: Boolean(entry?.token) },
            { label: "Weighbridge RFID", done: Boolean(scanResult?.checkpoint?.checkpoint === "WEIGHBRIDGE") },
{ label: "Bay Auto-Assigned", done: Boolean(scanResult?.allocation) },
            { label: "Gantry Filled", done: gantryStatus === "FILLED" || gantryStatus === "EXITED" },
            { label: "Exit ANPR (Voice)", done: gantryStatus === "EXITED" },
          ].map((s, i) => (
            <div
              key={s.label}
              className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${
                s.done
                  ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200 font-semibold"
                  : "border-white/10 bg-black/20 text-slate-500"
              }`}
            >
              {s.done ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <ArrowRight className="h-4 w-4" />}
              <span>{s.label}</span>
              <span className="ml-auto font-mono text-[10px]">0{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}