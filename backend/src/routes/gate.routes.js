import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { ROLES, authorize } from "../middleware/roles.js";
import { anprEntry, manifest, dispatchSms } from "../controllers/gate.controller.js";

const router = Router();

router.use(authenticate);

/**
 * POST /gate/entry
 * Simulated ANPR camera capture → validates manifest → issues Njiasmart digital token.
 */
router.post("/entry", authorize(ROLES.GATE_OFFICER, ROLES.SYSTEM, ROLES.DEPOT_MANAGER, ROLES.EXECUTIVE), anprEntry);

/**
 * POST /gate/dispatch-sms — push the digital pass to the driver over SMS.
 */
router.post("/dispatch-sms", authorize(ROLES.GATE_OFFICER, ROLES.DEPOT_MANAGER, ROLES.EXECUTIVE, ROLES.SYSTEM), dispatchSms);

/**
 * GET /gate/manifest — current scheduled batch manifest
 */
router.get("/manifest", authorize(...Object.values(ROLES)), manifest);

export default router;