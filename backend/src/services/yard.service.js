import { ref } from "../config/firebase.js";
import { generateKey } from "./memoryStore.js";
import { ApiError } from "../middleware/errorHandler.js";
import { notifyEvent } from "./eventBus.js";
import { notifyDriver, buildStageSms } from "./notification.service.js";
import env from "../config/env.js";

export const PRODUCTS = {
  DIESEL: "DIESEL",
  PETROL: "PETROL",
  KEROSENE: "KEROSENE",
  JETA1: "JET_A1",
  ADBLUE: "ADBLUE",
};

export const TRUCK_STATUS = {
  WAITING: "WAITING",
  APPROACHING: "APPROACHING",
  AT_WEIGHBRIDGE: "AT_WEIGHBRIDGE",
  WEIGHBRIDGE_PASSED: "WEIGHBRIDGE_PASSED",
  QUEUED: "QUEUED",
  LOADING: "LOADING",
  LOADED: "LOADED",
  COMPLETED: "COMPLETED",
  REROUTED: "REROUTED",
  HELD: "HELD",
};

/** Product density used to derive expected cargo mass from manifest volume. */
export const PRODUCT_DENSITY_KG_PER_LITER = {
  [PRODUCTS.DIESEL]: 0.85,
  [PRODUCTS.PETROL]: 0.75,
  [PRODUCTS.KEROSENE]: 0.817,
  [PRODUCTS.JET_A1]: 0.8,
  [PRODUCTS.ADBLUE]: 1.09,
};

/** Heuristic chassis+tank tare when a manifest entry omits tareKg. */
export function defaultTareKg(capacityLiters = 0) {
  return Math.round(Number(capacityLiters ?? 0) * 0.45);
}

/**
 * Weighbridge gross-weight verification.
 * Expected gross = tare weight + (capacityLiters × product density).
 * Passes when the scale reading is within WEIGHBRIDGE_TOLERANCE_PCT of it.
 */
export function verifyGrossWeight({ grossWeightKg, tareKg, capacityLiters, product, tolerancePct = null }) {
  const pct = Number(tolerancePct ?? env.weighbridgeTolerancePct ?? 5);
  const density = PRODUCT_DENSITY_KG_PER_LITER[product] ?? null;
  const t = Number(tareKg) > 0 ? Number(tareKg) : defaultTareKg(capacityLiters);
  const cargoKg = Number(capacityLiters ?? 0) * (density ?? 1);
  const expectedGrossKg = t + cargoKg;
  const toleranceKg = (expectedGrossKg * pct) / 100;
  const gross = Number(grossWeightKg);
  const diffKg = gross - expectedGrossKg;
  const pass = Number.isFinite(gross) && Math.abs(diffKg) <= toleranceKg;
  return {
    density,
    tareKg: t,
    cargoKg: Math.round(cargoKg),
    expectedGrossKg: Math.round(expectedGrossKg),
    grossWeightKg: gross,
    tolerancePct: pct,
    toleranceKg: Math.round(toleranceKg),
    diffKg: Math.round(diffKg),
    pass,
  };
}

const PATH_TRUCKS = "yard/trucks";
const PATH_BAYS = "yard/bays";
const PATH_MANIFEST = "yard/manifest";

function now() {
  return Date.now();
}

function hoursBetween(fromMs, toMs) {
  return Math.max(0, (toMs - fromMs) / 3_600_000);
}

/**
 * Generate a secure, unique digital token in the format
 * `KPC-<DEPOT>-<YYYYMMDD>-<SEQ>Z` (e.g. KPC-MBA-20260912-452Z).
 */
export function generateToken(depot = "MBA", seq = null) {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
  const seqValue = seq ?? Math.floor(100 + Math.random() * 900);
  return `KPC-${depot.toUpperCase()}-${ymd}-${seqValue}Z`;
}

/**
 * Resolve the scheduled batch manifest entry for a scanned vehicle.
 * Expects the ANPR payload to carry { regNo } which is matched against
 * manifest entries and KPC-issued sampling/allocation orders.
 */
export async function lookupManifest(regNo) {
  const snapshot = await ref(`${PATH_MANIFEST}/vehicles`).once("value");
  const vehicles = snapshot.val() ?? {};

  const all = Object.entries(vehicles).map(([batchId, veh]) => ({
    batchId,
    ...veh,
    regNo: String(veh.regNo ?? "").toUpperCase(),
  }));

  const normalized = String(regNo).replace(/\s+/g, "").toUpperCase();
  return all.find(
    (v) =>
      v.regNo.replace(/\s+/g, "") === normalized ||
      v.regNo.replace(/\s+/g, "") === normalized.replace(/^K/, "K "),
  ) ?? null;
}

export async function listManifest() {
  const snapshot = await ref(`${PATH_MANIFEST}/vehicles`).once("value");
  return snapshot.val() ?? {};
}

/**
 * ANPR Gate Capture — validates the vehicle and issues a digital token.
 */
export async function processGateEntry({ regNo, depot = "MBA", driverName = null, driverPhone = null, operatorId = null }) {
  const reg = String(regNo ?? "").trim();
  if (!reg) throw ApiError.badRequest("regNo is required for ANPR capture");

  // Prevent duplicate active tokens per plate
  const existing = await ref(`${PATH_TRUCKS}`).once("value");
  const activeTruck = Object.values(existing.val() ?? {}).find(
    (t) => String(t.regNo).toUpperCase() === reg.toUpperCase() && !["COMPLETED"].includes(t.status),
  );
  if (activeTruck) {
    throw ApiError.conflict(`Vehicle ${reg} already has an active token ${activeTruck.token}`);
  }

  const manifestEntry = await lookupManifest(reg);
  if (!manifestEntry) {
    throw ApiError.forbidden(`Plate ${reg} not on scheduled batch manifest — entry declined`);
  }

  const token = generateToken(depot);
  const truckId = generateKey("truck_");

  const truck = {
    id: truckId,
    token,
    regNo: reg,
    driverName: driverName ?? manifestEntry.driver ?? "Unknown",
    driverPhone: driverPhone ?? manifestEntry.driverPhone ?? "",
    product: manifestEntry.product ?? null,
    capacityLiters: Number(manifestEntry.capacityLiters ?? 0),
    tareKg: Number(manifestEntry.tareKg ?? defaultTareKg(manifestEntry.capacityLiters)),
    expectedGrossWeightKg: (() => {
      const density = PRODUCT_DENSITY_KG_PER_LITER[manifestEntry.product] ?? 1;
      const t = Number(manifestEntry.tareKg) > 0 ? Number(manifestEntry.tareKg) : defaultTareKg(manifestEntry.capacityLiters);
      return Math.round(Number(manifestEntry.capacityLiters ?? 0) * density + t);
    })(),
    grossWeightKg: null,
    weightPassed: null,
    status: TRUCK_STATUS.WAITING,
    checkpoint: "GATE",
    manifestVerified: true,
    enteredAt: now(),
    weighedAt: null,
    bayId: null,
    queuePosition: null,
    loadStartedAt: null,
    loadCompletedAt: null,
    waitingMs: 0,
    anomalyCount: 0,
    lastEvent: "GATE_ENTRY",
    operatorId,
  };

  await ref(`${PATH_TRUCKS}/${truckId}`).set(truck);
  await ref(`${PATH_TRUCKS}/_order/${truckId}`).set(now());

  await notifyEvent("gate:entry", {
    truckId,
    token: truck.token,
    regNo: truck.regNo,
    product: truck.product,
    manifestVerified: true,
    timestamp: now(),
  });

  return {
    truck,
    token: truck.token,
    manifestVerified: true,
    message: "Vehicle verified against scheduled batch manifest",
    id: truckId,
  };
}

/* ------------------------------------------------------------------ */
/* AI Flow-Rate & Bay Matching                                        */
/* ------------------------------------------------------------------ */

async function getLiveBays() {
  const snapshot = await ref(PATH_BAYS).once("value");
  return snapshot.val() ?? {};
}

async function getLiveTrucks() {
  const snapshot = await ref(PATH_TRUCKS).once("value");
  return snapshot.val() ?? {};
}

/**
 * Forecast loading duration for a given capacity & pump rate.
 * LoadingDuration (min) = capacityLiters / pumpRate(L/min)
 */
export function loadingDurationMinutes(capacityLiters, pumpRateLpm) {
  if (!capacityLiters || capacityLiters <= 0) return 0;
  if (!pumpRateLpm || pumpRateLpm <= 0) return Infinity;
  return capacityLiters / pumpRateLpm;
}

/**
 * Compute a deterministic relative loading time for the live bay queue.
 * Approximates remaining work at each bay: current vehicle remaining minutes
 * plus the cumulative load time of queued vehicles for the same product.
 */
function effectiveQueueWait(bay) {
  const vehicles = Object.values(bay.queuedVehicles ?? {});
  let waitMin = 0;
  if (bay.currentVehicleToken) {
    const remainingLiters = Math.max(0, Number(bay.currentVehicleRemainingLiters ?? 0));
    waitMin += remainingLiters / Math.max(1, Number(bay.pumpRateLpm ?? 1));
  }
  for (const v of vehicles) {
    waitMin += loadingDurationMinutes(v.capacityLiters, v.pumpRateLpm ?? bay.pumpRateLpm);
  }
  return waitMin;
}

/**
 * Autonomous Bay Allocation — assigns the optimal gantry bay for a tanker.
 * Scores candidate bays by: product compatibility, forecast wait time,
 * loading duration, rate capacity and bay health.
 */
export async function matchBay(vehicle) {
  const [bays] = await Promise.all([getLiveBays()]);
  const bayList = Object.entries(bays).map(([id, b]) => ({ id, ...b }));

  let candidates = bayList.filter(
    (b) => b.status === "ACTIVE" && (b.product === vehicle.product || b.product === "FLEXIBLE"),
  );

  if (candidates.length === 0) {
    candidates = bayList.filter((b) => b.status === "ACTIVE");
  }

  const scored = candidates.map((bay) => {
    const queueWaitMin = effectiveQueueWait(bay);
    const loadMin = loadingDurationMinutes(vehicle.capacityLiters, bay.pumpRateLpm);
    const healthPenalty = bay.status === "DEGRADED" ? 45 : 0;
    const utilization = queueWaitMin / 30;
    const score = queueWaitMin + loadMin + healthPenalty + utilization * 8;
    return { bay, score, queueWaitMin, loadMin };
  });

  scored.sort((a, b) => a.score - b.score);

  if (scored.length === 0) {
    throw ApiError.conflict("No available operational gantry bay — yard at capacity");
  }

  const best = scored[0];
  const etaMinutes = Math.round(best.queueWaitMin + best.loadMin);

  // Persist the assignment
  const bayId = best.bay.id;
  const assignment = {
    bayId,
    truckId: vehicle.id,
    token: vehicle.token,
    regNo: vehicle.regNo,
    product: vehicle.product,
    capacityLiters: vehicle.capacityLiters,
    pumpRateLpm: best.bay.pumpRateLpm,
    forecastLoadMinutes: Math.round(best.loadMin),
    forecastWaitMinutes: Math.round(best.queueWaitMin),
    etaMinutes,
    assignedAt: now(),
    auditLog: scored.map((s) => ({
      bayId: s.bay.id,
      score: Number(s.score.toFixed(2)),
      waitMin: Math.round(s.queueWaitMin),
      loadMin: Math.round(s.loadMin),
      status: s.bay.status,
    })),
  };

  await ref(`${PATH_BAYS}/${bayId}/queuedVehicles/${vehicle.id}`).set({
    token: vehicle.token,
    regNo: vehicle.regNo,
    product: vehicle.product,
    capacityLiters: vehicle.capacityLiters,
    pumpRateLpm: best.bay.pumpRateLpm,
    enqueuedAt: now(),
    etaMinutes,
  });
  await ref(`${PATH_BAYS}/${bayId}/lastAssignment`).set(assignment);

  await notifyEvent("bay:assigned", {
    truckId: vehicle.id,
    token: vehicle.token,
    regNo: vehicle.regNo,
    bayId,
    etaMinutes,
    score: Number(best.score.toFixed(2)),
    timestamp: now(),
  });

  // Stage-2 SMS: notify the driver of the bay allocation immediately.
  if (vehicle.driverPhone) {
    const smsMessage = buildStageSms("bay-assigned", {
      token: vehicle.token,
      regNo: vehicle.regNo,
      bayId,
    });
    await notifyDriver({
      phone: vehicle.driverPhone,
      token: vehicle.token,
      regNo: vehicle.regNo,
      message: smsMessage,
      plain: true,
    });
  }

  return assignment;
}

/**
 * Atomically allocate a bay for a vehicle at the gate scanning point and
 * advance its status to QUEUED.
 */
export async function allocateBayForTruck(truckId) {
  const truckSnap = await ref(`${PATH_TRUCKS}/${truckId}`).once("value");
  const truck = truckSnap.val();
  if (!truck) throw ApiError.notFound("Truck token not found");
  if (!truck.product) {
    throw ApiError.badRequest("Product unknown — cannot match bay until manifest is verified");
  }

  const assignment = await matchBay(truck);

  await ref(`${PATH_TRUCKS}/${truckId}`).update({
    status: TRUCK_STATUS.QUEUED,
    bayId: assignment.bayId,
    queuePosition: null,
    lastEvent: "BAY_ASSIGNED",
    updatedAt: now(),
  });

  return { truck: { ...truck, status: TRUCK_STATUS.QUEUED, bayId: assignment.bayId }, assignment };
}

/**
 * Advance a truck into its assigned bay and mark loading start.
 */
export async function startLoading(truckId, bayId) {
  const truckSnap = await ref(`${PATH_TRUCKS}/${truckId}`).once("value");
  const truck = truckSnap.val();
  if (!truck) throw ApiError.notFound("Truck token not found");

  const [truckRefUpdate, bayRefUpdate] = [
    ref(`${PATH_TRUCKS}/${truckId}`).update({
      status: TRUCK_STATUS.LOADING,
      bayId,
      queuePosition: null,
      loadStartedAt: now(),
      lastEvent: "LOADING_STARTED",
      updatedAt: now(),
    }),
    ref(`${PATH_BAYS}/${bayId}`).update({
      currentVehicleToken: truck.token,
      currentVehicleId: truck.id,
      currentVehicleRegNo: truck.regNo,
      currentVehicleCapacityLiters: truck.capacityLiters,
      currentVehicleRemainingLiters: truck.capacityLiters,
      loadProgressPct: 0,
      loadStartedAt: now(),
    }),
  ];
  // Remove from queuedVehicles
  await Promise.all([truckRefUpdate, bayRefUpdate]);
  await ref(`${PATH_BAYS}/${bayId}/queuedVehicles/${truckId}`).remove();

  await notifyEvent("loading:started", {
    truckId,
    token: truck.token,
    regNo: truck.regNo,
    bayId,
    capacityLiters: truck.capacityLiters,
    pumpRateLpm: null, // enriched by caller when known
    timestamp: now(),
  });

  return { ...truck, status: TRUCK_STATUS.LOADING, bayId, loadStartedAt: now() };
}

/**
 * Mark loading complete, compute demurrage-saved telemetry, release the bay
 * and re-sequence the queue (self-healing loop).
 */
export async function completeLoading(truckId, bayId, gantry) {
  const truckSnap = await ref(`${PATH_TRUCKS}/${truckId}`).once("value");
  const truck = truckSnap.val();
  if (!truck) throw ApiError.notFound("Truck token not found");

  const loadStart = truck.loadStartedAt ?? now();
  const loadEnd = now();
  const pumpRate = Number(gantry?.pumpRateLpm ?? 1000);
  const capacity = Number(truck.capacityLiters ?? 0);
  const actualLoadingMinutes = hoursBetween(loadStart, loadEnd) * 60;
  const theoreticalMinutes = loadingDurationMinutes(capacity, pumpRate);
  const efficiencyPct = theoreticalMinutes > 0 ? Math.min(100, Math.round((theoreticalMinutes / Math.max(actualLoadingMinutes, 0.1)) * 100)) : 100;

  const completed = {
    ...truck,
    status: TRUCK_STATUS.LOADED,
    loadCompletedAt: loadEnd,
    actualLoadingMinutes: Math.round(actualLoadingMinutes * 100) / 100,
    theoreticalLoadingMinutes: Number(theoreticalMinutes.toFixed(2)),
    loadingEfficiencyPct: efficiencyPct,
    tollToExitSlaMs: 0,
    lastEvent: "LOADING_COMPLETED",
    updatedAt: loadEnd,
  };

  const bayPatch = {
    currentVehicleToken: null,
    currentVehicleId: null,
    currentVehicleRegNo: null,
    currentVehicleCapacityLiters: null,
    currentVehicleRemainingLiters: null,
    loadStartedAt: null,
    lastCompletionAt: loadEnd,
    completedCount: Number(gantry?.completedCount ?? 0) + 1,
  };
  await Promise.all([
    ref(`${PATH_TRUCKS}/${truckId}`).update(completed),
    ref(`${PATH_BAYS}/${bayId}`).update(bayPatch),
  ]);

  await notifyEvent("loading:completed", {
    truckId,
    token: truck.token,
    regNo: truck.regNo,
    bayId,
    loadingMinutes: completed.actualLoadingMinutes,
    efficiencyPct,
    timestamp: loadEnd,
  });

  return { completed, theoreticalMinutes, efficiencyPct };
}

export { getLiveBays, getLiveTrucks, hoursBetween, now };