import { EventEmitter } from "node:events";

/**
 * In-process pub/sub used to fan out domain events to:
 *  - SSE /real-time stream consumers
 *  - notification service (SMS/push/PagerDuty)
 *  - analytics aggregators
 */

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

export const STREAM_EVENTS = new Set([
  "gate:entry",
  "bay:assigned",
  "loading:started",
  "loading:progress",
  "loading:completed",
  "checkpoint:crossed",
  "anomaly:detected",
  "reroute:applied",
  "queue:sequenced",
  "control:override",
  "sla:breach",
  "preMovement:alert",
  "compliance:violation",
  "truck:exited",
  "GANTRY_TANKER_EXITED",
  "gantry:exit",
]);

export function notifyEvent(event, payload) {
  const normalized = String(event);
  if (!STREAM_EVENTS.has(normalized)) return;
  const message = {
    event: normalized,
    payload,
    at: Date.now(),
  };
  emitter.emit(normalized, message);
  emitter.emit("all", message);
  return message;
}

export function onEvent(event, listener) {
  emitter.on(event, listener);
  return () => emitter.off(event, listener);
}

export default emitter;