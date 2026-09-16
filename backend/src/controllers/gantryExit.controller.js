import {
  processGantryExitDetection,
  listGantryCameras,
  updateCameraConfig,
  listRecentDepartures,
  listExitAuditTrail,
} from "../services/gantryExit.service.js";

function ok(res, data, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data });
}

/**
 * POST /api/gantry/exit-detection
 * Process ANPR camera detection or manual plate exit trigger.
 */
export async function detectExit(req, res, next) {
  try {
    const payload = {
      numberPlate: req.body.numberPlate ?? req.body.regNo ?? req.body.plate,
      cameraId: req.body.cameraId ?? "GANTRY-EXIT-01",
      timestamp: req.body.timestamp ?? null,
      confidence: req.body.confidence ?? 100,
      source: req.body.source ?? "ANPR",
      operatorId: req.body.operatorId ?? req.user?.id ?? null,
      notes: req.body.notes ?? null,
      allowOfflineOverride: req.body.allowOfflineOverride === true,
    };

    const result = await processGantryExitDetection(payload);
    return ok(res, result, result.success ? 200 : 202);
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/gantry/cameras
 * List all configured gantry exit cameras and their live health.
 */
export async function getCameras(_req, res, next) {
  try {
    const cameras = await listGantryCameras();
    return ok(res, cameras);
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/gantry/cameras/:cameraId
 * Update camera configuration, enable/disable, or set health status.
 */
export async function updateCamera(req, res, next) {
  try {
    const { cameraId } = req.params;
    const updated = await updateCameraConfig(cameraId, req.body);
    return ok(res, updated);
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/gantry/recent-departures
 * Fetch list of recent tanker departures.
 */
export async function getRecentDepartures(req, res, next) {
  try {
    const limit = Number(req.query.limit ?? 10);
    const departures = await listRecentDepartures(limit);
    return ok(res, departures);
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/gantry/audit
 * Fetch historical ANPR exit detection audits.
 */
export async function getExitAudit(req, res, next) {
  try {
    const limit = Number(req.query.limit ?? 50);
    const auditRecords = await listExitAuditTrail(limit);
    return ok(res, auditRecords);
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/gantry/manual-exit
 * Authorized operator manual clearance fallback when camera is offline.
 */
export async function manualExitClearance(req, res, next) {
  try {
    const payload = {
      numberPlate: req.body.numberPlate ?? req.body.regNo,
      cameraId: req.body.cameraId ?? "MANUAL-OPERATOR",
      source: "MANUAL_OPERATOR",
      operatorId: req.user?.name ?? req.user?.id ?? "Depot Operator",
      notes: req.body.notes ?? "Manual operator departure clearance",
      allowOfflineOverride: true,
    };
    const result = await processGantryExitDetection(payload);
    return ok(res, result);
  } catch (err) {
    return next(err);
  }
}
