import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { ROLES, authorize } from "../middleware/roles.js";
import {
  detectExit,
  getCameras,
  updateCamera,
  getRecentDepartures,
  getExitAudit,
  manualExitClearance,
} from "../controllers/gantryExit.controller.js";

const router = Router();

/**
 * Public / Read-Only telemetry & Camera Ingestion
 * The ANPR camera stream sends detections directly; dashboards poll recent departures.
 */
router.post("/exit-detection", detectExit);
router.get("/recent-departures", getRecentDepartures);
router.get("/cameras", getCameras);

/* Management & Audit operations require valid role authorization */
router.use(authenticate);

router.patch(
  "/cameras/:cameraId",
  authorize(ROLES.DEPOT_MANAGER, ROLES.EXECUTIVE, ROLES.SYSTEM),
  updateCamera,
);

router.post(
  "/manual-exit",
  authorize(ROLES.DEPOT_MANAGER, ROLES.GATE_OFFICER, ROLES.SYSTEM),
  manualExitClearance,
);

router.get(
  "/audit",
  authorize(ROLES.DEPOT_MANAGER, ROLES.EXECUTIVE, ROLES.GATE_OFFICER),
  getExitAudit,
);

export default router;
