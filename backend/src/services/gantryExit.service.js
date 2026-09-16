import { ref } from "../config/firebase.js";
import { generateKey } from "./memoryStore.js";
import { ApiError } from "../middleware/errorHandler.js";
import { notifyEvent } from "./eventBus.js";
import { TRUCK_STATUS, now, hoursBetween, loadingDurationMinutes } from "./yard.service.js";
import { recordCompletion } from "./analytics.service.js";

const PATH_TRUCKS = "yard/trucks";
const PATH_BAYS = "yard/bays";
const PATH_CAMERAS = "yard/cameras/gantryExit";
const PATH_EXIT_AUDIT = "yard/exitAudit";
const PATH_ANOMALIES = "yard/anomalies";

// Sliding debounce window (milliseconds) for duplicate plate detections
export const DEBOUNCE_WINDOW_MS = 20_000;
const recentDetections = new Map();

export const DEFAULT_CAMERA = {
  cameraId: "GANTRY-EXIT-01",
  location: "GANTRY_EXIT",
  name: "Gantry Exit ANPR Camera 01",
  enabled: true,
  status: "ONLINE", // ONLINE | OFFLINE | WARNING | PROCESSING
  recognitionMode: "ANPR",
  confidenceThreshold: 50,
  lastDetection: null,
  lastDetectionAt: null,
  totalDetections: 0,
};

/**
 * Standardize registration plate strings for robust matching.
 * e.g. "kda482x" -> "KDA 482X", " KDA  482X " -> "KDA 482X"
 */
export function normalizePlate(regNo) {
  if (!regNo) return "";
  const cleaned = String(regNo).trim().toUpperCase().replace(/\s+/g, "");
  // Match standard Kenyan 3-letter + 3-digit + 1-letter format (e.g. KDA482X -> KDA 482X)
  const match = cleaned.match(/^([A-Z]{3})(\d{3}[A-Z])$/);
  if (match) {
    return `${match[1]} ${match[2]}`;
  }
  return cleaned;
}

/**
 * Compare two plate strings ignoring whitespace and casing.
 */
export function platesMatch(plateA, plateB) {
  if (!plateA || !plateB) return false;
  const a = String(plateA).replace(/\s+/g, "").toUpperCase();
  const b = String(plateB).replace(/\s+/g, "").toUpperCase();
  return a === b;
}

/**
 * Retrieve or initialize camera configuration.
 */
export async function getCameraConfig(cameraId = DEFAULT_CAMERA.cameraId) {
  const snap = await ref(`${PATH_CAMERAS}/${cameraId}`).once("value");
  const existing = snap.val();
  if (existing) return existing;

  // Initialize with defaults if missing
  const initConfig = { ...DEFAULT_CAMERA, cameraId };
  await ref(`${PATH_CAMERAS}/${cameraId}`).set(initConfig);
  return initConfig;
}

/**
 * List all configured gantry exit cameras.
 */
export async function listGantryCameras() {
  const snap = await ref(PATH_CAMERAS).once("value");
  const cameras = snap.val() ?? {};
  if (Object.keys(cameras).length === 0) {
    await ref(`${PATH_CAMERAS}/${DEFAULT_CAMERA.cameraId}`).set(DEFAULT_CAMERA);
    return { [DEFAULT_CAMERA.cameraId]: DEFAULT_CAMERA };
  }
  return cameras;
}

/**
 * Update configuration or operational status for a gantry exit camera.
 */
export async function updateCameraConfig(cameraId, updates = {}) {
  const current = await getCameraConfig(cameraId);
  const updated = {
    ...current,
    ...updates,
    updatedAt: now(),
  };
  await ref(`${PATH_CAMERAS}/${cameraId}`).set(updated);
  return updated;
}

/**
 * Format the official driver-facing departure message dynamically.
 */
export function formatDepartureMessage(numberPlate) {
  return `Thank you for your visit!\n\nVehicle: ${numberPlate}\n\nYour loading process has been completed\nand your departure has been recorded.\n\nWelcome again another day.\nDrive safely!`;
}

/**
 * Process a vehicle exit detection event from an ANPR Gantry Exit Camera.
 *
 * Core Business Rules:
 * 1. Normalize plate & check camera status.
 * 2. Deduplicate rapid consecutive detections (debouncing & idempotency).
 * 3. Find active tanker matching plate.
 * 4. If unknown plate: log anomaly/audit alert without corrupting yard state.
 * 5. If matched active tanker:
 *    - Assume loading is complete: mark LOADED & EXITED.
 *    - Release occupied bay (bayStatus = AVAILABLE).
 *    - Remove tanker from active gantry/queue.
 *    - Retain historical transaction for analytics, ESG, and audit.
 *    - Emit GANTRY_TANKER_EXITED event and return dynamic departure message.
 */
export async function processGantryExitDetection({
  numberPlate,
  cameraId = DEFAULT_CAMERA.cameraId,
  timestamp = null,
  confidence = 100,
  source = "ANPR",
  operatorId = null,
  notes = null,
  allowOfflineOverride = false,
}) {
  if (!numberPlate || !String(numberPlate).trim()) {
    throw ApiError.badRequest("numberPlate is required for exit detection");
  }

  const normalizedPlate = normalizePlate(numberPlate);
  const eventTime = timestamp ? new Date(timestamp).getTime() || now() : now();
  const camera = await getCameraConfig(cameraId);

  // Validate camera operational health
  if (!allowOfflineOverride && (camera.status === "OFFLINE" || !camera.enabled)) {
    throw ApiError.conflict(
      `Gantry Exit Camera ${cameraId} is OFFLINE or disabled. Use manual operator departure override.`,
    );
  }

  // Check confidence score
  const confNum = Number(confidence ?? 100);
  if (confNum < (camera.confidenceThreshold ?? 50)) {
    const lowConfAnomaly = {
      signature: `LOW_CONF_EXIT_${normalizedPlate.replace(/\s+/g, "")}_${eventTime}`,
      type: "LOW_CONFIDENCE_DETECTION",
      severity: "warning",
      status: "OPEN",
      message: `Exit camera ${cameraId} read plate ${normalizedPlate} with low confidence (${confNum}% < ${camera.confidenceThreshold}% threshold)`,
      cameraId,
      numberPlate: normalizedPlate,
      confidence: confNum,
      detectedAt: eventTime,
    };
    await ref(`${PATH_ANOMALIES}/${lowConfAnomaly.signature}`).set(lowConfAnomaly);
    await notifyEvent("anomaly:detected", lowConfAnomaly);
    return {
      success: false,
      status: "LOW_CONFIDENCE",
      message: `Plate ${normalizedPlate} read with low confidence (${confNum}%). Manual verification required.`,
      anomaly: lowConfAnomaly,
    };
  }

  // Idempotency & Debounce Check: If this plate was processed very recently, return cached response
  const lastProcessed = recentDetections.get(normalizedPlate.replace(/\s+/g, ""));
  if (lastProcessed && eventTime - lastProcessed.timestamp < DEBOUNCE_WINDOW_MS) {
    return {
      success: true,
      duplicate: true,
      idempotent: true,
      message: `Duplicate detection for ${normalizedPlate} within debounce window ignored.`,
      numberPlate: normalizedPlate,
      tankerId: lastProcessed.truckId,
      token: lastProcessed.token,
      bayId: lastProcessed.bayId,
      departureMessage: formatDepartureMessage(normalizedPlate),
      exitedAt: lastProcessed.timestamp,
    };
  }

  // Search active tankers
  const [trucksSnap, baysSnap] = await Promise.all([
    ref(PATH_TRUCKS).once("value"),
    ref(PATH_BAYS).once("value"),
  ]);
  const trucks = trucksSnap.val() ?? {};
  const bays = baysSnap.val() ?? {};

  const allTrucks = Object.values(trucks).filter((t) => t && t.id);
  const activeTruck = allTrucks.find(
    (t) => platesMatch(t.regNo, normalizedPlate) && t.status !== TRUCK_STATUS.COMPLETED,
  );

  // UNKNOWN PLATE HANDLING
  if (!activeTruck) {
    const anomalySignature = `UNKNOWN_EXIT_${normalizedPlate.replace(/\s+/g, "")}_${Math.floor(eventTime / 60000)}`;
    const unknownAuditId = generateKey("audit_unmatched_");

    const unknownFact = {
      signature: anomalySignature,
      type: "UNKNOWN_VEHICLE_EXIT",
      severity: "critical",
      status: "OPEN",
      message: `Unknown vehicle detected at exit camera ${cameraId} (Plate: ${normalizedPlate}) — no active tanker match.`,
      cameraId,
      numberPlate: normalizedPlate,
      detectedAt: eventTime,
    };

    const auditRecord = {
      id: unknownAuditId,
      numberPlate: normalizedPlate,
      tankerId: null,
      token: null,
      bay: null,
      cameraId,
      detectionTimestamp: eventTime,
      exitTimestamp: eventTime,
      previousStatus: "UNKNOWN",
      newStatus: "UNMATCHED",
      source,
      confidence: confNum,
      matched: false,
      operatorId,
      notes: notes ?? "Unmatched ANPR plate at gantry exit",
      createdAt: eventTime,
    };

    await Promise.all([
      ref(`${PATH_ANOMALIES}/${anomalySignature}`).set(unknownFact),
      ref(`${PATH_EXIT_AUDIT}/${unknownAuditId}`).set(auditRecord),
      ref(`${PATH_CAMERAS}/${cameraId}`).update({
        lastDetection: normalizedPlate,
        lastDetectionAt: eventTime,
        totalDetections: (camera.totalDetections ?? 0) + 1,
      }),
    ]);

    await notifyEvent("anomaly:detected", unknownFact);
    await notifyEvent("sla:breach", {
      type: "UNKNOWN_VEHICLE_EXIT",
      signature: anomalySignature,
      message: `⚠ Unknown Vehicle Detected at ${cameraId}: ${normalizedPlate}`,
      numberPlate: normalizedPlate,
      cameraId,
      timestamp: eventTime,
    });

    return {
      success: false,
      matched: false,
      numberPlate: normalizedPlate,
      cameraId,
      message: `No active tanker matched plate ${normalizedPlate}. Anomaly logged for security investigation.`,
      auditId: unknownAuditId,
    };
  }

  // SUCCESSFUL ACTIVE TANKER MATCH
  const truckId = activeTruck.id;
  let bayId = activeTruck.bayId ?? null;

  // If bayId is not recorded on the truck, search bays
  if (!bayId) {
    for (const [bId, b] of Object.entries(bays)) {
      if (b.currentVehicleId === truckId || b.currentVehicleToken === activeTruck.token) {
        bayId = bId;
        break;
      }
    }
  }

  const assignedBay = bayId ? bays[bayId] : null;
  const loadStart = activeTruck.loadStartedAt ?? activeTruck.enteredAt ?? eventTime;
  const loadEnd = activeTruck.loadCompletedAt ?? eventTime;
  const pumpRate = Number(assignedBay?.pumpRateLpm ?? 1000);
  const capacity = Number(activeTruck.capacityLiters ?? 0);
  const actualLoadingMinutes = hoursBetween(loadStart, loadEnd) * 60;
  const theoreticalMinutes = loadingDurationMinutes(capacity, pumpRate);
  const efficiencyPct =
    theoreticalMinutes > 0
      ? Math.min(100, Math.round((theoreticalMinutes / Math.max(actualLoadingMinutes, 0.1)) * 100))
      : 100;

  const completedTruck = {
    ...activeTruck,
    status: TRUCK_STATUS.COMPLETED,
    loadingStatus: "LOADED",
    gantryStatus: "EXITED",
    checkpoint: "EXIT",
    exitDetected: true,
    exitDetectedAt: eventTime,
    exitTime: eventTime,
    exitedAt: eventTime,
    loadCompletedAt: loadEnd,
    actualLoadingMinutes: Math.round(actualLoadingMinutes * 100) / 100,
    theoreticalLoadingMinutes: Number(theoreticalMinutes.toFixed(2)),
    loadingEfficiencyPct: efficiencyPct,
    lastEvent: "GANTRY_EXIT_DETECTED",
    updatedAt: eventTime,
  };

  const auditId = generateKey("audit_exit_");
  const auditRecord = {
    id: auditId,
    numberPlate: activeTruck.regNo,
    tankerId: truckId,
    token: activeTruck.token,
    bay: bayId,
    cameraId,
    detectionTimestamp: eventTime,
    exitTimestamp: eventTime,
    previousStatus: activeTruck.status,
    newStatus: "LOADED / EXITED",
    status: "LOADED",
    source,
    confidence: confNum,
    matched: true,
    operatorId,
    turnaroundHours: Number(hoursBetween(activeTruck.enteredAt ?? eventTime, eventTime).toFixed(2)),
    loadingMinutes: completedTruck.actualLoadingMinutes,
    efficiencyPct,
    notes,
    createdAt: eventTime,
  };

  // Updates batch
  const updates = [
    ref(`${PATH_TRUCKS}/${truckId}`).set(completedTruck),
    ref(`${PATH_EXIT_AUDIT}/${auditId}`).set(auditRecord),
    ref(`${PATH_CAMERAS}/${cameraId}`).update({
      lastDetection: activeTruck.regNo,
      lastDetectionAt: eventTime,
      totalDetections: (camera.totalDetections ?? 0) + 1,
    }),
  ];

  // Release the occupied bay
  if (bayId) {
    const bayPatch = {
      currentVehicleToken: null,
      currentVehicleId: null,
      currentVehicleRegNo: null,
      currentVehicleCapacityLiters: null,
      currentVehicleRemainingLiters: null,
      loadStartedAt: null,
      loadProgressPct: 0,
      lastCompletionAt: eventTime,
      completedCount: Number(assignedBay?.completedCount ?? 0) + 1,
    };
    updates.push(ref(`${PATH_BAYS}/${bayId}`).update(bayPatch));
    updates.push(ref(`${PATH_BAYS}/${bayId}/queuedVehicles/${truckId}`).remove());
  }

  // Also clean from queuedVehicles in any other bays if present
  for (const [bId, b] of Object.entries(bays)) {
    if (bId !== bayId && b.queuedVehicles && b.queuedVehicles[truckId]) {
      updates.push(ref(`${PATH_BAYS}/${bId}/queuedVehicles/${truckId}`).remove());
    }
  }

  await Promise.all(updates);

  // Update analytics ledger for throughput, dwell, and ESG calculations
  await recordCompletion({
    truck: completedTruck,
    completion: { actualLoadingMinutes: completedTruck.actualLoadingMinutes },
  });

  // Record into in-memory debounce cache
  recentDetections.set(normalizedPlate.replace(/\s+/g, ""), {
    timestamp: eventTime,
    truckId,
    token: activeTruck.token,
    bayId,
  });

  const departureMessage = formatDepartureMessage(activeTruck.regNo);

  // Emit Real-Time Events on Event Bus
  const exitPayload = {
    event: "GANTRY_TANKER_EXITED",
    numberPlate: activeTruck.regNo,
    tankerId: truckId,
    token: activeTruck.token,
    bay: bayId,
    status: "LOADED",
    loadingStatus: "LOADED",
    gantryStatus: "EXITED",
    exitTime: new Date(eventTime).toISOString(),
    timestamp: eventTime,
    departureMessage,
    audit: auditRecord,
  };

  await notifyEvent("GANTRY_TANKER_EXITED", exitPayload);
  await notifyEvent("gantry:exit", exitPayload);
  await notifyEvent("truck:exited", {
    truckId,
    token: activeTruck.token,
    regNo: activeTruck.regNo,
    bayId,
    loadCompletedAt: loadEnd,
    exitedAt: eventTime,
    latchedEfficiencyPct: efficiencyPct,
  });

  return {
    success: true,
    matched: true,
    numberPlate: activeTruck.regNo,
    tankerId: truckId,
    token: activeTruck.token,
    bayId,
    loadingStatus: "LOADED",
    gantryStatus: "EXITED",
    exitDetected: true,
    exitTime: new Date(eventTime).toISOString(),
    departureMessage,
    truck: completedTruck,
    audit: auditRecord,
  };
}

/**
 * Fetch recent completed departures for dashboards.
 */
export async function listRecentDepartures(limit = 10) {
  const [auditSnap, trucksSnap] = await Promise.all([
    ref(PATH_EXIT_AUDIT).once("value"),
    ref(PATH_TRUCKS).once("value"),
  ]);

  const audits = Object.values(auditSnap.val() ?? {}).filter((a) => a && a.matched);
  audits.sort((a, b) => (b.exitTimestamp ?? 0) - (a.exitTimestamp ?? 0));

  if (audits.length > 0) {
    return audits.slice(0, limit);
  }

  // Fallback to completed trucks if audit ledger is empty
  const trucks = Object.values(trucksSnap.val() ?? {}).filter(
    (t) => t && t.status === TRUCK_STATUS.COMPLETED && (t.exitedAt || t.loadCompletedAt),
  );
  trucks.sort((a, b) => (b.exitedAt ?? b.loadCompletedAt ?? 0) - (a.exitedAt ?? a.loadCompletedAt ?? 0));

  return trucks.slice(0, limit).map((t) => ({
    id: t.id,
    numberPlate: t.regNo,
    tankerId: t.id,
    token: t.token,
    bay: t.bayId,
    exitTimestamp: t.exitedAt ?? t.loadCompletedAt ?? now(),
    previousStatus: "LOADING",
    newStatus: "LOADED / EXITED",
    status: "LOADED",
    turnaroundHours: Number(hoursBetween(t.enteredAt ?? now(), t.exitedAt ?? now()).toFixed(2)),
    loadingMinutes: t.actualLoadingMinutes ?? 0,
    efficiencyPct: t.loadingEfficiencyPct ?? 100,
    source: t.lastEvent === "GANTRY_EXIT_DETECTED" ? "ANPR" : "SYSTEM",
  }));
}

/**
 * Fetch exit audit records.
 */
export async function listExitAuditTrail(limit = 50) {
  const auditSnap = await ref(PATH_EXIT_AUDIT).once("value");
  const records = Object.values(auditSnap.val() ?? {});
  records.sort((a, b) => (b.detectionTimestamp ?? 0) - (a.detectionTimestamp ?? 0));
  return records.slice(0, limit);
}
