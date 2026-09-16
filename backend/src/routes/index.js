import { Router } from "express";
import gateRouter from "./gate.routes.js";
import checkpointRouter from "./checkpoint.routes.js";
import controlPlaneRouter from "./controlPlane.routes.js";
import authRouter from "./auth.routes.js";
import driverRouter from "./driver.routes.js";
import gantryRouter from "./gantry.routes.js";
import { onEvent } from "../services/eventBus.js";

const router = Router();

function ok(res, data) {
  return res.json({ success: true, data });
}

router.get("/health", (_req, res) =>
  ok(res, {
    service: "kpc-yard-control-plane",
    status: "UP",
    timestamp: Date.now(),
    uptimeSec: Math.round(process.uptime()),
  }),
);

/**
 * GET /stream — Server-Sent Events realtime feed.
 * Frontend hooks (useYardStream) subscribe here for live yard telemetry.
 */
router.get("/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  // Immediate open frame — flushes headers so EventSource connects promptly.
  res.write("retry: 3000\n\n: connected\n\n");

  const heartbeat = setInterval(() => res.write(`: ping\n\n`), 25_000);
  const off = onEvent("all", (message) => {
    res.write(`event: ${message.event}\ndata: ${JSON.stringify(message)}\n\n`);
  });

  req.on("close", () => {
    clearInterval(heartbeat);
    off();
  });
});

router.use("/auth", authRouter);
router.use("/gate", gateRouter);
router.use("/checkpoints", checkpointRouter);
router.use("/control-plane", controlPlaneRouter);
router.use("/driver", driverRouter);
router.use("/gantry", gantryRouter);

export default router;