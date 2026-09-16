import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { authorize, ROLES } from "../middleware/roles.js";
import {
  runCycle,
  anomalies,
  resolveAnomaly,
  overrideResequence,
  bayHealthOverride,
  metrics,
  throughput,
  yardSnapshot,
  manualAlloc,
  esg,
  compliance,
  complianceViolations,
  resolveCompliance,
  integrations,
  stalledTruck,
  resolveStalled,
} from "../controllers/controlPlane.controller.js";

const router = Router();

const manager = authorize(ROLES.DEPOT_MANAGER, ROLES.EXECUTIVE);
const executive = authorize(ROLES.EXECUTIVE, ROLES.DEPOT_MANAGER);

/*
 * Read-only telemetry & demo response triggers stay accessible.
 */
router.get("/metrics", metrics);
router.get("/esg", esg);
router.get("/compliance", compliance);
router.get("/integrations", integrations);
router.get("/snapshot", yardSnapshot);
router.post("/stalled-truck", stalledTruck);

/* Everything below the line requires a valid session + role. */
router.use(authenticate);

/**
 * Control plane routes — cleared for depot managers & the executive suite.
 * Drivers and gate officers never reach this surface.
 */
router.get("/throughput", executive, throughput);
router.get("/anomalies", manager, anomalies);
router.post("/anomalies/:signature/resolve", manager, resolveAnomaly);
router.post("/cycle", manager, runCycle);
router.post("/resequence", manager, overrideResequence);
router.post("/bay/:bayId/health", manager, bayHealthOverride);
router.post("/allocate", manager, manualAlloc);
router.get("/compliance/violations", manager, complianceViolations);
router.post("/compliance/violations/:signature/resolve", manager, resolveCompliance);
router.post("/stalled-truck/:truckId/resolve", resolveStalled);

export default router;