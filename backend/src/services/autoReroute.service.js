import { ref, isEmulator } from "../config/firebase.js";
import { notifyEvent } from "./eventBus.js";
import { ApiError } from "../middleware/errorHandler.js";
import { getLiveBays, getLiveTrucks, loadingDurationMinutes, now, hoursBetween } from "./yard.service.js";
import { sendAlert, notifyDriver, buildStageSms } from "./notification.service.js";
import { scanCompliance } from "./compliance.service.js";
import env from "../config/env.js";

const PATH = "yard/anomalies";
const PATH_BAYS = "yard/bays";
const PATH_PREMOVEMENT = "yard/preMovement";

/**
 * Configuration - each gantry bay can carry explicit thresholds; otherwise we
 * fall back to platform defaults.
 */
export const DEFAULT_ANOMALY_THRESHOLDS = {
  maxQueueDepth: 6,               // > 6 queued vehicles at one bay
  maxWaitMinutes: 45,             // queued wait forecast beyond 45 min
  maxLoadMinutes: 120,            // gantry cycle exceeding 120 minutes (pump-fail guard)
  pumpRateDegradationPct: 40,     // observed rate < 40% of rated pump rate
  maxInactiveMinutes: 15,         // bay busy with no flow for 15 minutes
};

export class AnomalyDetector {
  constructor(thresholds = {}) {
    this.thresholds = { ...DEFAULT_ANOMALY_THRESHOLDS, ...thresholds };
  }

  /**
   * Scan the whole live yard and return a list of detected anomalies.
   * Pure function of persisted state -> deterministic, testable.
   */
  // eslint-disable-next-line no-unused-vars
  async scan(bays, trucks) {
    const anomalies = [];
    const bayList = Object.entries(bays).map(([id, b]) => ({ id, ...b }));

    for (const bay of bayList) {
      const queue = Object.values(bay.queuedVehicles ?? {});
      const queueDepth = queue.length;

      if (bay.status === "DOWN") {
        anomalies.push(fact("BAY_DOWN", bay.id, null, `Gantry ${bay.id} is DOWN — preloading its queue against dead infrastructure`));
        continue;
      }

      if (bay.status === "DEGRADED" || bay.status === "MAINTENANCE") {
        anomalies.push(fact("BAY_DEGRADED", bay.id, null, `Gantry ${bay.id} degraded — divert flow where possible`));
      }

      if (queueDepth > this.thresholds.maxQueueDepth) {
        const waitMin = Math.round(effectiveWait(bay));
        anomalies.push(
          fact("QUEUE_DEPTH", bay.id, null, `Gantry ${bay.id} queue depth ${queueDepth} exceeds threshold ${this.thresholds.maxQueueDepth}`),
        );
        if (waitMin > this.thresholds.maxWaitMinutes) {
          anomalies.push(
            fact("QUEUE_WAIT", bay.id, null, `Gantry ${bay.id} forecast wait ${waitMin} min > ${this.thresholds.maxWaitMinutes} min`),
          );
        }
      }

      if (bay.currentVehicleId) {
        const truck = trucks[bay.currentVehicleId];
        if (truck?.loadStartedAt) {
          const elapsedMin = hoursBetween(truck.loadStartedAt, now()) * 60;
          if (elapsedMin > this.thresholds.maxLoadMinutes) {
            anomalies.push(
              fact(
                "LOAD_HANG",
                bay.id,
                truck.id,
                `Truck ${truck.regNo} on ${bay.id} exceeded ${this.thresholds.maxLoadMinutes} min cycle (${Math.round(elapsedMin)} min)`,
              ),
            );
          }
          const expected = loadingDurationMinutes(truck.capacityLiters, bay.pumpRateLpm);
          if (elapsedMin > expected * 1.35) {
            anomalies.push(
              fact(
                "PUMP_SLOW",
                bay.id,
                truck.id,
                `Gantry ${bay.id} pump rate degradation suspected — ${Math.round(elapsedMin)} min vs expected ${Math.round(expected)} min`,
              ),
            );
          }
        }
      }
    }

    for (const [id, truck] of Object.entries(trucks)) {
      if (!truck.id && id === "_order") continue;
      if (truck.id && truck.status === "WAITING" && truck.enteredAt) {
        const waitMin = hoursBetween(truck.enteredAt, now()) * 60;
        if (waitMin > this.thresholds.maxWaitMinutes && !truck.bayId) {
          anomalies.push(
            fact("STAGING_HOLD", null, truck.id, `Truck ${truck.regNo} waiting ${Math.round(waitMin)} min — manifest/verification hold`),
          );
        }
      }
    }

    return anomalies.filter(Boolean);
  }

  /**
   * Persist any anomalies that are new (not already open), fan out the event,
   * and escalate via PagerDuty/Slack when a critical anomaly appears.
   */
  async process(bays, trucks) {
    const findings = await this.scan(bays, trucks);
    if (findings.length === 0) return [];

    const openSnap = await ref(PATH).once("value");
    const open = openSnap.val() ?? {};
    const registered = [];

    for (const fx of findings) {
      const existing = Object.values(open).find(
        (o) => o.status === "OPEN" && o.signature === fx.signature,
      );
      if (existing) continue;

      const anomaly = {
        ...fx,
        signature: fx.signature,
        detectedAt: now(),
        status: "OPEN",
        autoReroute: fx.severity === "critical",
        resolutions: [],
      };

      await ref(`${PATH}/${fx.signature}`).set(anomaly);
      open[fx.signature] = anomaly;
      registered.push(anomaly);

      await notifyEvent("anomaly:detected", {
        signature: fx.signature,
        type: fx.type,
        bayId: fx.bayId,
        truckId: fx.truckId,
        message: fx.message,
        severity: fx.severity,
        timestamp: now(),
      });

      await notifyEvent("sla:breach", {
        signature: fx.signature,
        type: fx.type,
        bayId: fx.bayId,
        truckId: fx.truckId,
        message: fx.message,
        severity: fx.severity,
        timestamp: now(),
      });
    }

    if (registered.some((a) => a.severity === "critical")) {
      await this.escalate(registered.filter((a) => a.severity === "critical"));
    }

    return registered;
  }

  async escalate(criticalAnomalies) {
    const summary = criticalAnomalies.map((a) => a.message).join(" | ");
    await sendAlert(
      "KPC-Yard Critical Anomaly",
      summary,
      "critical",
      criticalAnomalies.map((a) => a.type),
    );
    if (isEmulator()) {
      console.warn("[anomaly:escalate] Paged on-call for:", summary);
    }
  }

  /**
   * Closed-loop remediation: reroute queued vehicles away from a failing bay
   * and re-sequence queues across healthy bays.
   */
  async remediate(anomaly, _ctx = {}) {
    const { bayId, truckId } = anomaly;
    const [bays, trucks] = await Promise.all([getLiveBays(), getLiveTrucks()]);

    const movements = [];
    const targetBay = bayId ? bays[bayId] : null;

    if (targetBay && (targetBay.status === "DOWN" || targetBay.status === "MAINTENANCE")) {
      const stranded = Object.entries(targetBay.queuedVehicles ?? {});
      const healthy = Object.entries(bays).filter(
        ([id, b]) => id !== bayId && b.status === "ACTIVE" && (b.product === targetBay.product || b.product === "FLEXIBLE"),
      );

      for (const [qId, qv] of stranded) {
        const match = healthy.find(([, b]) => b.product === targetBay.product || b.product === "FLEXIBLE");
        if (!match) break;
        const [newBayId] = match;
        await ref(`${PATH_BAYS}/${newBayId}/queuedVehicles/${qId}`).set(qv);
        await ref(`${PATH_BAYS}/${bayId}/queuedVehicles/${qId}`).remove();
        movements.push({
          truckId: qId,
          fromBay: bayId,
          toBay: newBayId,
          product: qv.product,
          reroutedAt: now(),
        });
      }
    }

    if (truckId && !bayId && trucks[truckId]?.status === "WAITING") {
      const { allocateBayForTruck } = await import("./yard.service.js");
      try {
        const { assignment } = await allocateBayForTruck(truckId);
        movements.push({
          truckId,
          fromBay: null,
          toBay: assignment.bayId,
          product: trucks[truckId].product,
          reroutedAt: now(),
        });
      } catch (err) {
        await ref(`${PATH}/${anomaly.signature}`).update({ status: "UNRESOLVED", lastError: err.message });
      }
    }

    if (movements.length > 0) {
      const exists = (await ref(`${PATH}/${anomaly.signature}`).once("value")).exists();
      if (exists) {
        await this.resolve(anomaly.signature, "AUTO_REROUTE", movements);
      }
      await notifyEvent("reroute:applied", {
        signature: anomaly.signature,
        movements,
        timestamp: now(),
      });
      await notifyEvent("queue:sequenced", {
        movements,
        timestamp: now(),
      });
    }

    return movements;
  }

  async resolve(signature, resolution = "MANUAL_OVERRIDE", notes = null) {
    const snap = await ref(`${PATH}/${signature}`).once("value");
    const anomaly = snap.val();
    if (!anomaly) throw ApiError.notFound("Anomaly signature not found");
    await ref(`${PATH}/${signature}`).update({
      status: "RESOLVED",
      resolvedAt: now(),
      resolution,
      notes,
    });
    return { signature, resolution, resolvedAt: now() };
  }
}

function fact(type, bayId, truckId, message, severity = "warning", extra = {}) {
  const signature = `${type}_${bayId ?? "YARD"}_${truckId ?? "GLOBAL"}`;
  return { type, bayId, truckId, message, severity, signature, ...extra };
}

function effectiveWait(bay) {
  const vehicles = Object.values(bay.queuedVehicles ?? {});
  let waitMin = 0;
  if (bay.currentVehicleToken) {
    waitMin += (bay.currentVehicleRemainingLiters ?? 0) / Math.max(1, bay.pumpRateLpm ?? 1);
  }
  for (const v of vehicles) waitMin += loadingDurationMinutes(v.capacityLiters, v.pumpRateLpm ?? bay.pumpRateLpm);
  return waitMin;
}

/* ---- singleton instance used by controllers & workers ---- */
export const detector = new AnomalyDetector();

/**
 * Advance simulated pump flow for every actively-loading gantry so the live
 * dashboard shows real progress without a physical rig. When a tank is fully
 * drained the loop auto-completes the load (feeding analytics) — a self-
 * cleaning autonomous yard with no human dispatcher in the loop.
 */
export async function simulatePumpFlow(bays, trucks) {
  if (!env.simulatePumpFlow) return { advanced: 0, completed: [] };
  const simMinutes = Math.max(0, Number(env.simMinutesPerLoop ?? 0));
  if (simMinutes <= 0) return { advanced: 0, completed: [] };

  const advanced = [];
  const completed = [];

  for (const [bayId, bay] of Object.entries(bays)) {
    const queued = Object.entries(bay.queuedVehicles ?? {}).sort(
      (a, b) => (a[1].enqueuedAt ?? 0) - (b[1].enqueuedAt ?? 0),
    );
    let justFreed = false;

    if (bay.currentVehicleId && bay.currentVehicleRemainingLiters) {
      const truck = trucks[bay.currentVehicleId];
      if (!truck || !bay.loadStartedAt) continue;

      const pumpRate = Number(bay.pumpRateLpm ?? 0);
      const capacity = Number(truck.capacityLiters ?? 0);
      if (pumpRate <= 0 || capacity <= 0) continue;

      let remaining = Number(bay.currentVehicleRemainingLiters ?? capacity);
      const drained = Math.min(remaining, (pumpRate * simMinutes) / 60);
      remaining = Math.max(0, remaining - drained);

      if (remaining <= 0) {
        const { completeLoading } = await import("./yard.service.js");
        const latestBay = (await getLiveBays())[bayId] ?? bay;
        try {
          await completeLoading(truck.id, bayId, latestBay);
          completed.push({ truckId: truck.id, bayId, regNo: truck.regNo });
          justFreed = true;
        } catch (err) {
          // completed concurrently by the operator — non-fatal
        }
      } else {
        const loadProgressPct = capacity > 0 ? Math.min(100, Math.round(((capacity - remaining) / capacity) * 100)) : 0;
        await ref(`${PATH_BAYS}/${bayId}`).update({ currentVehicleRemainingLiters: remaining, loadProgressPct });
        advanced.push({ bayId, truckId: truck.id, regNo: truck.regNo, remainingLiters: remaining, loadProgressPct });

        await notifyEvent("loading:progress", {
          bayId,
          truckId: truck.id,
          regNo: truck.regNo,
          remainingLiters: remaining,
          loadProgressPct,
          timestamp: now(),
        });
      }
    }

    // Gantry freed (just now or earlier) with a driver staged via pre-movement
    // SMS: pull them onto the deck automatically — zero dispatcher in the loop.
    if ((justFreed || !bay.currentVehicleId || !bay.currentVehicleRemainingLiters) && queued.length > 0) {
      const nextId = queued[0][0];
      try {
        const { startLoading } = await import("./yard.service.js");
        await startLoading(nextId, bayId);
      } catch (err) {
        // raced by the operator kiosk — non-fatal
      }
    }
  }

  return { advanced, completed };
}

/**
 * Proactive pre-movement dispatch: when a gantry load is within the alert
 * window (95% complete / ~5 min remaining) the next queued driver gets an SMS
 * so they can stage tenjin and drive-off the instant the bay clears — zero
 * wasted demurrage time between loads.
 */
export async function dispatchPreMovementAlerts(bays, trucks) {
  const preMinutes = Number(env.preMovementAlertMinutes ?? 5);
  const dispatched = [];

  const notifiedSnap = await ref(PATH_PREMOVEMENT).once("value");
  const notified = notifiedSnap.val() ?? {};

  for (const [bayId, bay] of Object.entries(bays)) {
    if (!bay.currentVehicleId || !bay.loadStartedAt) continue;
    const truck = trucks[bay.currentVehicleId];
    if (!truck?.loadStartedAt) continue;

    const expectedMin = loadingDurationMinutes(truck.capacityLiters, bay.pumpRateLpm);
    if (!isFinite(expectedMin) || expectedMin <= 0) continue;

    const simMinutes = Math.max(0, Number(env.simMinutesPerLoop ?? 0));
    const pumpRateLpm = Number(bay.pumpRateLpm ?? 0);
    const tickLiters = simMinutes > 0 && pumpRateLpm > 0 ? (pumpRateLpm * simMinutes) / 60 : 0;
    const capacityLiters = Number(truck.capacityLiters ?? 0);
    const remainingLiters = Number(bay.currentVehicleRemainingLiters ?? capacityLiters);

    // Liters-based truth (drives the gantry progress bar), fused with the
    // elapsed-looking-glass so staging fires either way. A sim-tick lookahead
    // guarantees staging lands a full animation-frame before the bay frees
    // even when the time-lapse jumps straight past 95%.
    const remainingMinByLiters = remainingLiters > 0 && pumpRateLpm > 0 ? remainingLiters / pumpRateLpm : 0;
    const progressPctByLiters = capacityLiters > 0 ? Math.min(100, ((capacityLiters - remainingLiters) / capacityLiters) * 100) : 0;
    const elapsedMin = hoursBetween(truck.loadStartedAt, now()) * 60;
    const remainingMinByElapsed = Math.max(0, expectedMin - elapsedMin);
    const progressPctByElapsed = Math.min(100, (elapsedMin / expectedMin) * 100);

    const remainingMin = Math.min(remainingMinByLiters, remainingMinByElapsed);
    const progressPct = Math.max(progressPctByLiters, progressPctByElapsed);
    const insideFinalTick = tickLiters > 0 && remainingLiters > 0 && remainingLiters <= tickLiters * 1.6;
    const isWindow = remainingMin <= preMinutes || progressPct >= 95 || insideFinalTick;

    if (!isWindow) continue;

    const signature = `PRE_MOVEMENT_${bayId}_${truck.id}`;
    if (notified[signature]) continue;

    const queueEntries = Object.entries(bay.queuedVehicles ?? {}).sort(
      (a, b) => (a[1].enqueuedAt ?? 0) - (b[1].enqueuedAt ?? 0),
    );
    const [nextId, next] = queueEntries[0] ?? [];
    if (!next) continue;

    const nextTruck = trucks[nextId] ?? null;

    const message = buildStageSms("pre-movement", {
      token: next.token ?? nextTruck?.token,
      regNo: next.regNo ?? nextTruck?.regNo,
      bayId,
    });
    const smsPromise = notifyDriver({
      phone: nextTruck?.driverPhone,
      token: next.token ?? nextTruck?.token,
      regNo: next.regNo ?? nextTruck?.regNo,
      message,
      plain: true,
    }).catch(() => ({ ok: false }));

    const record = {
      signature,
      bayId,
      truckId: truck.id,
      regNo: truck.regNo,
      movingUpRegNo: next.regNo,
      movingUpToken: next.token,
      remainingMin: Number(remainingMin.toFixed(1)),
      progressPct: Math.round(progressPct),
      firedAt: now(),
      sms: await smsPromise,
    };
    await ref(`${PATH_PREMOVEMENT}/${signature}`).set(record);
    notified[signature] = record;
    dispatched.push(record);

    await notifyEvent("preMovement:alert", {
      signature,
      bayId,
      loadingRegNo: truck.regNo,
      nextRegNo: next.regNo,
      nextToken: next.token,
      nextEtaMinutes: next.etaMinutes ?? null,
      progressPct: record.progressPct,
      remainingMin: record.remainingMin,
      timestamp: now(),
    });
  }

  return dispatched;
}

export async function runClosedLoopCycle() {
  const [bays, trucks] = await Promise.all([getLiveBays(), getLiveTrucks()]);
  const registered = await detector.process(bays, trucks);
  let movements = [];
  for (const anomaly of registered) {
    if (anomaly.autoReroute || ["BAY_DOWN", "BAY_DEGRADED", "LOAD_HANG"].includes(anomaly.type)) {
      movements.push(...(await detector.remediate(anomaly)));
    }
  }

  const flow = await simulatePumpFlow(bays, trucks);

  const [freshBays, freshTrucks] = await Promise.all([getLiveBays(), getLiveTrucks()]);
  const preMovement = await dispatchPreMovementAlerts(freshBays, freshTrucks);
  const compliance = await scanCompliance(freshBays, freshTrucks);

  return { scanned: Date.now(), anomalies: registered, movements, flow, preMovement, compliance };
}

export async function listOpenAnomalies() {
  const snap = await ref(PATH).once("value");
  return Object.values(snap.val() ?? {}).filter((a) => a.status !== "RESOLVED" || a.status === null);
}