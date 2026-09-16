import { ref } from "../config/firebase.js";
import env from "../config/env.js";
import { getLiveTrucks, getLiveBays, now, hoursBetween } from "./yard.service.js";

const PATH_STATS = "yard/stats";

/**
 * Baseline yard performance in passive/legacy mode (used as the control group
 * for ROI telemetry). Configured so the sandbox produces realistic "period-over-
 * period improvement" numbers.
 */
export const BASELINE = {
  averageTurnaroundHours: 8.0,        // legacy manual-dispatch turnaround
  throughputPerShift: 28,             // trucks dispatched per 24h (manual)
  jockeyIdleMinutes: 0,
};

function dayKey(ts = now()) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Record a completed truck into the running analytics ledger.
 */
export async function recordCompletion({ truck, completion }) {
  const today = dayKey();
  const turnaroundHours = hoursBetween(truck.enteredAt ?? now(), truck.loadCompletedAt ?? now());
  const baselineHours = BASELINE.averageTurnaroundHours;
  const hoursPrevented = Math.max(0, baselineHours - turnaroundHours);
  const kesSaved = Math.round(hoursPrevented * env.demurrageRatePerHourKes);
  const liters = Number(truck.capacityLiters ?? 0);

  const statsSnap = await ref(PATH_STATS).once("value");
  const stats = statsSnap.val() ?? {};
  const totals = stats.totals ?? {};
  const dailyKey = stats.daily?.[today] ?? {};

  await ref(`${PATH_STATS}/totals`).set({
    completedCount: Number(totals.completedCount ?? 0) + 1,
    totalLitersSupplied: Number(totals.totalLitersSupplied ?? 0) + liters,
    totalTurnaroundHours: Number(totals.totalTurnaroundHours ?? 0) + turnaroundHours,
    totalHoursPrevented: Number(totals.totalHoursPrevented ?? 0) + hoursPrevented,
    totalKesSavedInDemurrage: Number(totals.totalKesSavedInDemurrage ?? 0) + kesSaved,
    totalLoadingMinutes: Number(totals.totalLoadingMinutes ?? 0) + Number(completion?.actualLoadingMinutes ?? 0),
  });

  await ref(`${PATH_STATS}/daily/${today}`).set({
    completedCount: Number(dailyKey.completedCount ?? 0) + 1,
    totalLitersSupplied: Number(dailyKey.totalLitersSupplied ?? 0) + liters,
    totalTurnaroundHours: Number(dailyKey.totalTurnaroundHours ?? 0) + turnaroundHours,
    totalHoursPrevented: Number(dailyKey.totalHoursPrevented ?? 0) + hoursPrevented,
    totalKesSaved: Number(dailyKey.totalKesSaved ?? 0) + kesSaved,
  });

  return { turnaroundHours, baselineHours, hoursPrevented, kesSaved };
}

/** Collect a (mutating-free) snapshot for the executive dashboard. */
export async function computeMetrics({ nowTs = now() } = {}) {
  const [statsSnap, trucks, bays] = await Promise.all([
    ref(PATH_STATS).once("value"),
    getLiveTrucks(),
    getLiveBays(),
  ]);
  const stats = statsSnap.val() ?? { totals: {}, daily: {} };

  const completed = Object.values(trucks).filter((t) => t.id && t.status === "COMPLETED");
  const active = Object.values(trucks).filter((t) => t.id && t.status !== "COMPLETED");
  const loading = active.filter((t) => t.status === "LOADING");
  const queued = active.filter((t) => t.status === "QUEUED");
  const waiting = active.filter((t) => t.status === "WAITING" || t.status === "AT_WEIGHBRIDGE" || t.status === "WEIGHBRIDGE_PASSED");

  const processedCount = completed.length;
  const hoursSinceMidnight = hourOfDay(nowTs);
  const throughputRate = hoursSinceMidnight > 0 ? processedCount / hoursSinceMidnight : 0;
  const baselineRate = BASELINE.throughputPerShift / env.yardOperatingHoursPerDay;
  const throughputDeltaPct =
    baselineRate > 0 ? Math.round(((throughputRate - baselineRate) / baselineRate) * 100) : 0;

  const totalTurnaround = completed.reduce(
    (sum, t) => sum + hoursBetween(t.enteredAt ?? nowTs, t.loadCompletedAt ?? nowTs),
    0,
  );
  const avgTurnaround = processedCount ? totalTurnaround / processedCount : 0;
  const hoursPrevented = completed.reduce((sum, t) => {
    const ta = hoursBetween(t.enteredAt ?? nowTs, t.loadCompletedAt ?? nowTs);
    return sum + Math.max(0, BASELINE.averageTurnaroundHours - ta);
  }, 0);

  const activeBays = Object.values(bays).filter((b) => b.status === "ACTIVE").length;
  const totalBays = Object.keys(bays).length;
  const bayUtilizationPct = totalBays ? Math.round((activeBays / totalBays) * 100) : 0;

  const inYard = active.length;
  const demurrageSaved = Math.round(hoursPrevented * env.demurrageRatePerHourKes);

  return {
    generatedAt: nowTs,
    kpis: {
      demurrageSavedKes: demurrageSaved,
      demurrageRatePerHourKes: env.demurrageRatePerHourKes,
      hoursPrevented: Number(hoursPrevented.toFixed(2)),
      avgTurnaroundHours: Number(avgTurnaround.toFixed(2)),
      baselineTurnaroundHours: BASELINE.averageTurnaroundHours,
      turnaroundImprovementPct: BASELINE.averageTurnaroundHours
        ? Math.round((1 - avgTurnaround / BASELINE.averageTurnaroundHours) * 100)
        : 0,
      throughputDeltaPct,
      throughputRatePerHour: Number(throughputRate.toFixed(2)),
      baselineThroughputPerHour: Number(baselineRate.toFixed(2)),
      capacityUtilizationPct: bayUtilizationPct,
    },
    live: {
      processedCount,
      activeInYard: inYard,
      loadingCount: loading.length,
      queuedCount: queued.length,
      waitingCount: waiting.length,
      activeBays,
      totalBays,
      totalLitersInQueue: queued.reduce((s, t) => s + Number(t.capacityLiters ?? 0), 0),
      totalLitersLoadingNow: loading.reduce((s, t) => s + Number(t.capacityLiters ?? 0), 0),
    },
    baselines: BASELINE,
    daily: (() => {
      const out = {};
      for (const [day, d] of Object.entries(stats.daily ?? {})) out[day] = { ...d };
      return out;
    })(),
  };
}

function hourOfDay(ts) {
  const d = new Date(ts);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

export async function throughputSeries(days = 7) {
  const statsSnap = await ref(PATH_STATS).once("value");
  const daily = statsSnap.val()?.daily ?? {};
  const series = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now() - i * 86_400_000);
    const key = dayKey(d.getTime());
    const rec = daily[key];
    series.push({
      day: key,
      completed: rec?.completedCount ?? 0,
      liters: rec?.totalLitersSupplied ?? 0,
      kesSaved: rec?.totalKesSaved ?? 0,
      avgTurnaroundHours: rec?.completedCount ? Number((rec.totalTurnaroundHours / rec.completedCount).toFixed(2)) : 0,
    });
  }
  return series;
}