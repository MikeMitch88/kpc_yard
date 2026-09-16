import { useMemo, useState, useEffect } from "react";
import {
  TrendingUp,
  Wallet,
  Gauge,
  Activity,
  ShieldCheck,
  Bell,
  MessageSquare,
  Satellite,
  RefreshCw,
  Siren,
  Camera,
  CheckCircle2,
  Clock,
  ArrowUpRight,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";
import { useDemoAuth } from "../hooks/useDemoAuth.js";
import { useMetrics, useEsg, useCompliance, useIntegrations } from "../hooks/useYardData.js";
import { useYardStream } from "../hooks/useYardStream.js";
import { yardApi } from "../services/api.js";
import KpiCard from "../components/KpiCard.jsx";
import AnimatedNumber from "../components/AnimatedNumber.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import EsgScorecard from "../components/EsgScorecard.jsx";
import CompliancePanel from "../components/CompliancePanel.jsx";
import { pushAlert } from "../components/AlertCenter.jsx";

export default function ExecutiveDashboard() {
  const auth = useDemoAuth("executive", "Executive Officer");
  const { data: metrics, error, loading, refresh } = useMetrics(10000, auth.ready);
  const { data: esg } = useEsg(15000, auth.ready);
  const { data: compliance } = useCompliance(10000, auth.ready);
  const { data: integrations } = useIntegrations(30000, auth.ready);
  const [recentDepartures, setRecentDepartures] = useState([]);
  const [slaBreaches, setSlaBreaches] = useState(0);
  const [now, setNow] = useState(() => new Date());

  async function loadDepartures() {
    try {
      const data = await yardApi.getRecentDepartures(6);
      setRecentDepartures(data ?? []);
    } catch {
      /* non-fatal */
    }
  }

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    loadDepartures();
  }, [auth.ready]);

  useYardStream({
    "sla:breach": (m) => {
      setSlaBreaches((n) => n + 1);
      pushAlert({ tone: "error", title: "SLA Breach", message: m.payload.message, key: m.payload.signature });
    },
    "anomaly:detected": (m) =>
      pushAlert({ tone: "warning", title: `Anomaly ${m.payload.type}`, message: m.payload.message }),
    "reroute:applied": (m) =>
      pushAlert({ tone: "warning", title: "Self-healing reroute", message: `${m.payload.movements.length} vehicles re-sequenced` }),
    "gate:entry": (m) => pushAlert({ tone: "success", title: "Yard entry", message: `${m.payload.regNo} tokenised` }),
    "loading:completed": (m) =>
      pushAlert({ tone: "success", title: "Load complete", message: `${m.payload.regNo} @ ${m.payload.bayId} (${m.payload.efficiencyPct}% eff)` }),
    "preMovement:alert": (m) =>
      pushAlert({ tone: "success", title: "Pre-movement notify", message: `${m.payload.nextRegNo} staged — gantry ${m.payload.bayId} at ${m.payload.progressPct}%` }),
    "compliance:violation": (m) => pushAlert({ tone: "warning", title: m.payload.type, message: m.payload.message }),
    "GANTRY_TANKER_EXITED": (m) => {
      pushAlert({
        tone: "success",
        title: "Gantry Exit ANPR",
        message: `Plate ${m.payload.numberPlate} departed gantry ${m.payload.bay ?? "auto"}`,
      });
      loadDepartures();
      refresh();
    },
    "gantry:exit": () => {
      loadDepartures();
      refresh();
    },
    "truck:exited": () => {
      loadDepartures();
      refresh();
    },
  });

  const series = useMemo(() => {
    const daily = metrics?.daily ?? {};
    return Object.entries(daily)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, d]) => ({
        day,
        trucks: d.completedCount ?? 0,
        kes: Math.round(d.totalKesSaved ?? 0),
        turnaround: Number(((d.totalTurnaroundHours ?? 0) / Math.max(1, d.completedCount ?? 1)).toFixed(2)),
      }));
  }, [metrics]);

  const kpis = metrics?.kpis;
  const live = metrics?.live;
  const uptimePct = Math.max(97, Math.min(100, 100 - slaBreaches * 0.2));
  const uptimeTone = uptimePct >= 99.5 ? "text-emerald-300" : uptimePct >= 99 ? "text-amber-300" : "text-red-300";

  const integrationChips = [
    { key: "pagerDuty", label: "PagerDuty", icon: Siren, on: Boolean(integrations?.pagerDuty) },
    { key: "slack", label: "Slack", icon: MessageSquare, on: Boolean(integrations?.slack) },
    { key: "sms", label: "TALK-SASA SMS", icon: Satellite, on: Boolean(integrations?.sms) },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Glassmorphism hero band */}
      <div className="hero-sheen glass glass-outline flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-300">Njiasmart · MBA Depot</p>
            <span className="rounded-full border border-orange-400/40 bg-orange-500/10 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-orange-300">
              Okoa Muda
            </span>
          </div>
          <h1 className="mt-1 text-3xl font-bold">Yard & Queue Control Plane</h1>
          <p className="mt-1 text-sm text-slate-400">
            Automated logistics telemetry · autonomous dispatch · ROI + SLA watchtower
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <span className="live-dot h-2 w-2 rounded-full bg-emerald-400" />
            <span className="font-mono text-xs text-slate-300">
              {now.toLocaleTimeString("en-KE", { hour12: false })} EAT
            </span>
            <button onClick={() => { refresh(); loadDepartures(); }} className="btn-ghost p-1.5" title="Refresh metrics">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-[10px] text-slate-500">Autonomous ANPR Gantry Control Active</p>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-400/40 bg-red-950/60 p-4 text-sm text-red-200">{error}</div>}

      {loading && !metrics ? (
        <div className="flex h-64 items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-emerald-400" />
        </div>
      ) : (
        <>
{/* ROI KPI band — animated counters */}
          <div className="glass glass-outline flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-300">
              <Satellite className="h-4 w-4 text-orange-400" /> Executive summary · Automated Control Plane
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-slate-500">
              Njiasmart <span className="text-orange-400">·</span> Okoa Muda <span className="mx-1 text-slate-700">|</span>
              <span className="text-emerald-300"> Live Telemetry</span>
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              accent="emerald"
              icon={Wallet}
              animate
              label="Demurrage Prevented"
              value={kpis?.demurrageSavedKes ?? 0}
              format={(n) => `KES ${Math.round(n).toLocaleString()}`}
              sub={`@ KES ${kpis?.demurrageRatePerHourKes?.toLocaleString()}/hr SLA limit`}
            />
            <KpiCard
              accent="amber"
              icon={TrendingUp}
              animate
              label="Throughput Delta"
              value={kpis?.throughputDeltaPct ?? 0}
              format={(n) => `${n > 0 ? "+" : ""}${Math.round(n)}%`}
              sub={`${kpis?.throughputRatePerHour ?? 0} trucks/hr (vs ${kpis?.baselineThroughputPerHour ?? 0} baseline)`}
            />
            <KpiCard
              accent="sky"
              icon={Gauge}
              animate
              label="Avg Turnaround"
              value={kpis?.avgTurnaroundHours ?? 0}
              format={(n) => `${(Math.round(n * 10) / 10).toFixed(1)}h`}
              sub={`Baseline ${kpis?.baselineTurnaroundHours}h · ${kpis?.turnaroundImprovementPct ?? 0}% improvement`}
            />
            <KpiCard
              accent="emerald"
              icon={Activity}
              animate
              label="Bay Utilization"
              value={kpis?.capacityUtilizationPct ?? 0}
              format={(n) => `${Math.round(n)}%`}
              sub={`${live?.activeBays ?? 0}/${live?.totalBays ?? 0} gantries active`}
            />
          </div>

          {/* SLA uptime + integrations strip */}
          <div className="glass glass-outline grid gap-3 p-5 md:grid-cols-2">
            <div className="flex items-center gap-4">
              <div>
                <p className={`tick-up font-mono text-4xl font-bold ${uptimeTone}`}>
                  <AnimatedNumber value={uptimePct} format={(n) => `${Math.round(n * 100) / 100}%`} />
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
                  <ShieldCheck className="h-3 w-3" /> SLA watchtower uptime
                </p>
              </div>
              <div className="ml-2 space-y-1 text-[10px] text-slate-500">
                <p className="font-mono">{live?.processedCount ?? 0} loads · {live?.activeInYard ?? 0} in yard</p>
                <p className="font-mono">{slaBreaches} SLA events today</p>
              </div>
            </div>

            <div className="flex flex-col justify-center gap-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Escalation channels</p>
              <div className="flex flex-wrap gap-2">
                {integrationChips.map(({ key, label, icon: Icon, on }) => (
                  <span
                    key={key}
                    className={`chip border ${
                      on ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300" : "border-white/10 bg-white/5 text-slate-500"
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    {label} {on ? <span className="live-dot ml-1 inline-block h-1.5 w-1.5 rounded-full bg-current" /> : <Bell className="ml-1 h-3 w-3 opacity-50" />}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Live fleet strip */}
          <div className="grid gap-3 md:grid-cols-5">
            {[
              { label: "Processed (today)", value: String(live?.processedCount ?? 0), tone: "text-emerald-300" },
              { label: "In yard", value: String(live?.activeInYard ?? 0), tone: "text-slate-200" },
              { label: "Queued", value: String(live?.queuedCount ?? 0), tone: "text-amber-300" },
              { label: "Loading now", value: String(live?.loadingCount ?? 0), tone: "text-sky-300" },
              { label: "Liters in queue", value: `${((live?.totalLitersInQueue ?? 0) / 1000).toFixed(0)} kL`, tone: "text-violet-300" },
            ].map((s) => (
              <div key={s.label} className="glass glass-outline p-3 text-center">
                <p className="tick-up font-mono text-xl font-bold text-white">
                  <AnimatedNumber
                    value={Number(s.value.replace(/[^0-9.]/g, "") || 0)}
                    format={(n) => (s.label.startsWith("Liters") ? `${Math.round(n)} kL` : `${Math.round(n)}`)}
                  />
                </p>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Recent Departures Strip */}
          <div className="glass glass-outline p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="h-4 w-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-slate-200">Recent Gantry Departures (ANPR Verified)</h3>
              </div>
              <span className="text-[10px] font-mono text-slate-400">Autonomous Gantry Exit Camera Live</span>
            </div>

            {recentDepartures.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-500">
                No recent departures recorded. Departures log automatically as tankers pass the exit camera.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {recentDepartures.map((dep, idx) => (
                  <div
                    key={dep.id || idx}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 p-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-white">{dep.numberPlate}</span>
                        <span className="chip border border-emerald-400/30 bg-emerald-500/10 text-emerald-300 text-[10px]">
                          LOADED / EXITED
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400 flex items-center gap-1.5">
                        <span>Bay: <b className="text-slate-200 font-mono">{dep.bay ?? "—"}</b></span>
                        <span>·</span>
                        <span>Source: <b className="text-slate-300">{dep.source ?? "ANPR"}</b></span>
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-slate-200 font-semibold">
                        {dep.exitTimestamp ? new Date(dep.exitTimestamp).toLocaleTimeString() : "—"}
                      </p>
                      <p className="text-[10px] text-slate-500">Exit Time</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Charts */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="glass glass-outline p-5">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300">
                <Wallet className="h-4 w-4" /> KES Demurrage Saved — 7d
              </p>
              {series.length === 0 ? (
                <p className="py-10 text-center text-xs text-slate-500">No completed loads yet — telemetry accrues as trucks exit.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={series}>
                    <defs>
                      <linearGradient id="kes" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.6} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
                    <Tooltip
                      contentStyle={{ background: "#0f172a", border: "1px solid #ffffff22", borderRadius: 8 }}
                      formatter={(v) => [`KES ${Number(v).toLocaleString()}`, "Demurrage saved"]}
                    />
                    <Area type="monotone" dataKey="kes" stroke="#10b981" fill="url(#kes)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="glass glass-outline p-5">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300">
                <TrendingUp className="h-4 w-4" /> Throughput — loads & turnaround
              </p>
              {series.length === 0 ? (
                <p className="py-10 text-center text-xs text-slate-500">Waiting for first completed loads.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                    <YAxis yAxisId="l" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                    <YAxis yAxisId="t" orientation="right" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                    <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #ffffff22", borderRadius: 8 }} />
                    <Bar yAxisId="l" dataKey="trucks" name="Trucks" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="t" dataKey="turnaround" name="Avg hrs" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* ESG + Compliance */}
          <div className="grid gap-4 lg:grid-cols-2">
            <EsgScorecard data={esg} />
            <CompliancePanel data={compliance} />
          </div>
        </>
      )}

      <div className="glass glass-outline flex items-start gap-3 p-5">
        <ShieldCheck className="mt-0.5 h-5 w-5 text-amber-300" />
        <div className="text-xs text-slate-400">
          <p className="font-semibold text-slate-200">Autonomous control loop & ANPR Gantry Exit</p>
          <p className="mt-1">
Every gate capture is verified against the batch manifest; the Autonomous Bay Allocation Engine assigns the optimal
            gantry by pump rate and queue forecast. Gantry Exit ANPR cameras automatically detect departing tankers, finalize
            loading, and release the bay. Anomalies (dead pumps, queue overflow, load hangs) trigger{" "}
            <b className="text-amber-300">closed-loop re-sequencing</b>, pre-movement SMS staging, and PagerDuty/Slack escalation —
            no human dispatcher required.
          </p>
        </div>
      </div>
    </div>
  );
}