import { runClosedLoopCycle, listOpenAnomalies, detector, handleStalledVehicle, resolveStalledVehicle } from "../services/autoReroute.service.js";
import { computeMetrics, throughputSeries } from "../services/analytics.service.js";
import { getComplianceSummary, listOpenComplianceViolations, resolveComplianceViolation } from "../services/compliance.service.js";
import { computeEsgScorecard } from "../services/esg_scorecard.service.js";
import { ref } from "../config/firebase.js";
import env from "../config/env.js";
import { notifyEvent } from "../services/eventBus.js";
import { getLiveBays, getLiveTrucks, allocateBayForTruck } from "../services/yard.service.js";

export async function stalledTruck(req, res, next) {
  try {
    const { truckId, bayId, reason } = req.body || {};
    const result = await handleStalledVehicle(truckId, bayId, reason);
    return res.json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

export async function resolveStalled(req, res, next) {
  try {
    const { truckId } = req.params;
    const result = await resolveStalledVehicle(truckId);
    return res.json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

export async function runCycle(req, res, next) {
  try {
    const result = await runClosedLoopCycle();
    return res.json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

export async function anomalies(req, res, next) {
  try {
    const data = await listOpenAnomalies();
    return res.json({ success: true, data });
  } catch (err) {
    return next(err);
  }
}

export async function resolveAnomaly(req, res, next) {
  try {
    const resolved = await detector.resolve(req.params.signature, req.body.resolution, req.body.notes);
    return res.json({ success: true, data: resolved });
  } catch (err) {
    return next(err);
  }
}

/** Depot manager override — manually re-sequence the yard queue. */
export async function overrideResequence(req, res, next) {
  try {
    const { movements } = req.body;
    if (!Array.isArray(movements) || movements.length === 0) {
      // No explicit movements provided: re-balance by product demand against active bays
      await runClosedLoopCycle();
      return res.json({ success: true, data: { note: "Executed full closed-loop re-balancing cycle" } });
    }

    for (const mv of movements) {
      await ref(`yard/bays/${mv.toBay}/queuedVehicles/${mv.truckId}`).set({
        token: mv.token,
        regNo: mv.regNo,
        product: mv.product,
        capacityLiters: mv.capacityLiters,
        pumpRateLpm: mv.pumpRateLpm,
        enqueuedAt: Date.now(),
        reroutedByOverride: true,
      });
      if (mv.fromBay) {
        await ref(`yard/bays/${mv.fromBay}/queuedVehicles/${mv.truckId}`).remove();
      }
      await ref(`yard/trucks/${mv.truckId}`).update({ bayId: mv.toBay, lastEvent: "MANUAL_RESEQUENCE", updatedAt: Date.now() });
    }

    await notifyEvent("control:override", {
      operator: req.user.id,
      movements,
      timestamp: Date.now(),
    });

    return res.json({ success: true, data: { applied: movements.length } });
  } catch (err) {
    return next(err);
  }
}

export async function bayHealthOverride(req, res, next) {
  try {
    const { bayId, status } = req.body;
    if (!bayId || !status) {
      return res.status(400).json({ success: false, error: { message: "bayId and status are required" } });
    }
    const allowed = ["ACTIVE", "DEGRADED", "MAINTENANCE", "DOWN"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, error: { message: `status must be one of ${allowed.join(", ")}` } });
    }
    await ref(`yard/bays/${bayId}`).update({ status, lastOverrideAt: Date.now(), overriddenBy: req.user.id });
    await notifyEvent("control:override", { operator: req.user.id, bayId, status, timestamp: Date.now() });
    return res.json({ success: true, data: { bayId, status } });
  } catch (err) {
    return next(err);
  }
}

export async function metrics(req, res, next) {
  try {
    const data = await computeMetrics({ nowTs: Date.now() });
    return res.json({ success: true, data });
  } catch (err) {
    return next(err);
  }
}

export async function throughput(req, res, next) {
  try {
    const days = Number(req.query.days ?? 7);
    const series = await throughputSeries(Math.min(30, Math.max(1, days)));
    return res.json({ success: true, data: series });
  } catch (err) {
    return next(err);
  }
}

export async function yardSnapshot(req, res, next) {
  try {
    const [bays, trucks] = await Promise.all([getLiveBays(), getLiveTrucks()]);
    /* Snapshot is served unauthenticated (read-only telemetry): never leak
       driver access tokens to anonymous callers. */
    for (const key of Object.keys(trucks ?? {})) {
      const t = trucks[key];
      if (t && typeof t === "object" && !Array.isArray(t) && "token" in t) {
        delete t.token;
      }
    }
    return res.json({ success: true, data: { bays, trucks } });
  } catch (err) {
    return next(err);
  }
}

/** Used by the admin panel to nudge a staged truck to an optimal bay. */
export async function manualAlloc(req, res, next) {
  try {
    const { truckId } = req.body;
    const result = await allocateBayForTruck(truckId);
    await notifyEvent("control:override", {
      operator: req.user.id,
      truckId,
      bayId: result.assignment.bayId,
      timestamp: Date.now(),
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

/** ESG & carbon-spill risk scorecard for the executive suite. */
export async function esg(req, res, next) {
  try {
    const data = await computeEsgScorecard();
    return res.json({ success: true, data });
  } catch (err) {
    return next(err);
  }
}

/** Depot speed / transit compliance guard — fleet summary. */
export async function compliance(req, res, next) {
  try {
    const data = await getComplianceSummary();
    return res.json({ success: true, data });
  } catch (err) {
    return next(err);
  }
}

export async function complianceViolations(req, res, next) {
  try {
    const data = await listOpenComplianceViolations();
    return res.json({ success: true, data });
  } catch (err) {
    return next(err);
  }
}

export async function resolveCompliance(req, res, next) {
  try {
    const data = await resolveComplianceViolation(req.params.signature, req.body.resolution, req.body.notes);
    if (!data) return res.status(404).json({ success: false, error: { message: "Violation not found" } });
    return res.json({ success: true, data });
  } catch (err) {
    return next(err);
  }
}

/** Integration health — which external channels are wired in the live environment. */
export async function integrations(req, res, next) {
  try {
    return res.json({
      success: true,
      data: {
        pagerDuty: Boolean(env.alerts.pagerDutyUrl),
        slack: Boolean(env.alerts.slackUrl),
        sms: Boolean((env.sms.apiKey || env.sms.token) && (env.sms.endpoint || env.sms.baseUrl)),
        emulatorMode: env.firebase.emulatorMode,
        nodeEnv: env.nodeEnv,
      },
    });
  } catch (err) {
    return next(err);
  }
}