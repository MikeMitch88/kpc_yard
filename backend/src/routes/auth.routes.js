import { Router } from "express";
import { issueToken } from "../middleware/auth.js";
import env from "../config/env.js";

const router = Router();

/**
 * POST /auth/demo — sandbox token factory for the enterprise UI.
 * In production gate this behind identity federation (IdP / PAM).
 */
router.post("/demo", (req, res) => {
  if (env.nodeEnv === "production" && !req.headers["x-demo-key"]) {
    return res.status(403).json({ success: false, error: { message: "Sandbox access disabled in production" } });
  }
  const { role = "gate-officer", name = "Yard Operator", truckId = null } = req.body;
  const sub = `${role}-${Date.now().toString(36)}`;
  const token = issueToken({ sub, role, name, truckId });
  return res.json({ success: true, data: { token, role, name, expiresIn: env.jwt.expiresIn } });
});

export default router;