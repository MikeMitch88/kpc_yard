import env from "../config/env.js";

const PAGERDUTY_V2_URL = (url) => (url.includes("events/v2") ? url : `${url}/v2`).replace(/\/+$/, "");

/**
 * Normalize an outbound phone number to E.164.
 * Accepts local formats ("0745074245") and international ("+254745074245").
 */
export function normalizePhone(phone) {
  const raw = String(phone ?? "").replace(/[^\d+]/g, "");
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;
  if (raw.startsWith("0")) return `+254${raw.slice(1)}`;
  if (raw.startsWith("254")) return `+${raw}`;
  return `+${raw}`;
}

/**
 * Stage-aware SMS templates. Each message is your-driver-facing, fully branded
 * and self-contained (token + plate included) so no header/footer is appended.
 */
const SMS_STAGE_TEMPLATES = {
  "gate-entry":
    "Njiasmart | Digital queue pass issued. Token: {token} | Reg: {reg}. Present at Main Gate & Weighbridge. Product: {product}, {volume}L.",
  "bay-assigned":
    "Njiasmart | Bay Assigned! Token: {token} | Reg: {reg}. You have been allocated Loading Bay {bayId}. Proceed from Holding Yard immediately.",
  "pre-movement":
    "Njiasmart | Pre-Movement Alert! Token: {token} | Reg: {reg}. Bay {bayId} is completing cycle. Start engine and prepare to move from Holding Yard.",
};

/**
 * Build a stage-specific, context-aware SMS payload.
 * stage ∈ { "gate-entry", "bay-assigned", "pre-movement" }
 */
export function buildStageSms(stage, data = {}) {
  const template = SMS_STAGE_TEMPLATES[stage];
  if (!template) throw new Error(`Unknown SMS stage template: ${stage}`);
  const liters = Number(data.volume ?? data.volumeLiters ?? data.capacityLiters ?? 0);
  return template
    .replace("{token}", data.token ?? "—")
    .replace("{reg}", data.regNo ?? data.reg ?? "—")
    .replace("{bayId}", data.bayId ?? "—")
    .replace("{product}", data.product ?? "—")
    .replace("{volume}", liters > 0 ? liters.toLocaleString() : "—");
}

/**
 * Send an operational alert to PagerDuty (Events API v2) and/or Slack.
 * Failures are swallowed and logged — alerting must never break yard logic.
 */
export async function sendAlert(summary, detail, severity = "critical", customDetails = null) {
  const results = { pagerDuty: null, slack: null };
  try {
    if (env.alerts.pagerDutyUrl) {
      await fetch(PAGERDUTY_V2_URL(env.alerts.pagerDutyUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routing_key: env.alerts.pagerDutyUrl.split("/").pop(),
          event_action: "trigger",
          payload: {
            summary,
            source: "kpc-yard-control-plane",
            severity,
            custom_details: { detail, ...(customDetails ? { anomalies: customDetails } : {}) },
          },
        }),
      });
      results.pagerDuty = "sent";
    }
  } catch (err) {
    console.warn("[notification] PagerDuty send failed:", err.message);
    results.pagerDuty = `failed: ${err.message}`;
  }

  try {
    if (env.alerts.slackUrl) {
      await fetch(env.alerts.slackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `:rotating_light: *${summary}*\n${detail}`,
        }),
      });
      results.slack = "sent";
    }
  } catch (err) {
    console.warn("[notification] Slack send failed:", err.message);
    results.slack = `failed: ${err.message}`;
  }

  return results;
}

/**
 * TALK-SASA bulk SMS gateway — sends chauffeur/driver notifications with the
 * token & bay assignment so the driver knows exactly where to stage.
 *
 * Configuration (env):
 *   TALKSASA_API_KEY / TALKSASA_API_TOKEN  — secret api key/token
 *   TALKSASA_SENDER_ID                     — branded sender ID (default TALK-SASA)
 *   TALKSASA_ENDPOINT / TALKSASA_BASE_URL  — gateway REST endpoint
 */
export async function sendSms(phone, message) {
  if (!phone) return { ok: false, reason: "no-phone" };

  const apiKey = env.sms.apiKey || env.sms.token;
  const endpoint = env.sms.endpoint || (env.sms.baseUrl ? `${String(env.sms.baseUrl).replace(/\/+$/, "")}/sms/send` : "");
  const recipient = normalizePhone(phone);
  if (!recipient) return { ok: false, reason: "invalid-phone" };

  if (!apiKey || !endpoint || env.nodeEnv === "test") {
    // Sandbox/emulator mode (and always during test runs): log instead of sending.
    console.log(`[sms:emulated] → ${recipient}: ${message}`);
    return { ok: true, emulated: true, to: recipient };
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        recipient,
        sender_id: String(env.sms.senderId ?? "TALK-SASA"),
        type: "plain",
        message,
      }),
    });
    const json = await res.json().catch(() => ({}));
    const gatewayErr = json?.status === "error" ? json?.message || json?.error : null;
    if (!res.ok || gatewayErr) {
      const detail = gatewayErr ?? json?.message ?? JSON.stringify(json);
      console.warn(`[sms] TALK-SASA rejected (HTTP ${res.status}):`, detail);
      return { ok: false, status: res.status, reason: detail };
    }
    return { ok: true, provider: "talksasa", to: recipient, response: json };
  } catch (err) {
    console.warn("[sms] TALK-SASA send failed:", err.message);
    return { ok: false, reason: err.message };
  }
}

/**
 * Send a driver notification over TALK-SASA.
 * When `plain` is true the message is sent verbatim (for stage templates that
 * are already branded and self-contained); otherwise a heading + token/reg
 * footer is appended for one-off operational messages.
 */
export async function notifyDriver({ phone, token, regNo, message, heading = "Njiasmart Control Plane", plain = false }) {
  const text = plain ? message : `${heading}\n${message}\nToken: ${token}${regNo ? ` | Reg ${regNo}` : ""}`;
  return sendSms(phone, text);
}

/**
 * Build a web-push ready notification payload for the Driver Mobile UI.
 */
export function pushPayload({ token, title, body, badge = null }) {
  return {
    token,
    title,
    body,
    badge: badge ?? `KPC-${token?.split("-")[1] ?? "MBA"}`,
    timestamp: Date.now(),
  };
}