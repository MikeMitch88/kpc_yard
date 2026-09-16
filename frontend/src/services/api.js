import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

export { API_BASE };

const TOKEN_PREFIX = "kpc_demo_token";
const LEGACY_TOKEN_KEY = "kpc_demo_token";
const ROLES = ["executive", "depot-manager", "gate-officer", "driver"];

/**
 * Demo JWTs are minted per role. Pages log in with different roles
 * (gate-officer, driver, depot-manager, executive), so each role gets its
 * own localStorage slot instead of clobbering a single shared token.
 */
function tokenKey(role) {
  return `${TOKEN_PREFIX}_${role}`;
}

export function getToken(role) {
  return localStorage.getItem(role ? tokenKey(role) : LEGACY_TOKEN_KEY);
}

export function setToken(token, role) {
  if (role && token) localStorage.setItem(tokenKey(role), token);
  if (token && !role) localStorage.setItem(LEGACY_TOKEN_KEY, token);
}

export function clearSession() {
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(TOKEN_PREFIX)) localStorage.removeItem(key);
  }
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}

function tokenRole(token) {
  try {
    return JSON.parse(atob(token.split(".")[1])).role ?? null;
  } catch {
    return null;
  }
}

/** Role-slot tokens first (freshest wins), legacy key as last resort only. */
function allTokens() {
  const slots = ROLES.map((r) => getToken(r)).filter(Boolean);
  const legacy = getToken(null);
  return legacy ? slots.concat(legacy) : slots;
}

/**
 * Pick a token whose decoded role matches the path's requirement — never the
 * first existing token, so a stale/legacy token can't mask a fresher one.
 */
function pickTokenFor(url) {
  const required =
    url.startsWith("/control-plane")
      ? ["depot-manager", "executive"]
      : url.startsWith("/checkpoints") || url.startsWith("/gate")
        ? ["gate-officer", "depot-manager"]
        : url.startsWith("/driver")
          ? ["driver", "depot-manager"]
          : ["depot-manager"];
  for (const role of required) {
    const found = allTokens().find((t) => tokenRole(t) === role);
    if (found) return found;
  }
  return allTokens().find(Boolean) ?? null;
}

export const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = pickTokenFor(config.url ?? "");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const message = err.response?.data?.error?.message ?? err.message ?? "Request failed";
    return Promise.reject(new Error(message));
  },
);

export async function authenticateDemo(role, name) {
  const { data } = await api.post("/auth/demo", { role, name });
  setToken(data.data.token, role);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  return data.data;
}

export const yardApi = {
  gateEntry: (payload) => api.post("/gate/entry", payload).then((r) => r.data.data),
  dispatchSms: (payload) => api.post("/gate/dispatch-sms", payload).then((r) => r.data.data),
  scanCheckpoint: (payload) => api.post("/checkpoints/scan", payload).then((r) => r.data.data),
  driverStatus: (token) => api.get(`/driver/${token}?includeBay=true`).then((r) => r.data.data),
  metrics: () => api.get("/control-plane/metrics").then((r) => r.data.data),
  throughput: (days = 7) => api.get(`/control-plane/throughput?days=${days}`).then((r) => r.data.data),
  anomalies: () => api.get("/control-plane/anomalies").then((r) => r.data.data),
  esg: () => api.get("/control-plane/esg").then((r) => r.data.data),
  compliance: () => api.get("/control-plane/compliance").then((r) => r.data.data),
  complianceViolations: () => api.get("/control-plane/compliance/violations").then((r) => r.data.data),
  resolveCompliance: (signature) => api.post(`/control-plane/compliance/violations/${signature}/resolve`, { resolution: "MANUAL_ACK" }).then((r) => r.data.data),
  integrations: () => api.get("/control-plane/integrations").then((r) => r.data.data),
  runCycle: () => api.post("/control-plane/cycle").then((r) => r.data.data),
  snapshot: () => api.get("/control-plane/snapshot").then((r) => r.data.data),
  resequence: (movements) => api.post("/control-plane/resequence", { movements }).then((r) => r.data.data),
  setBayHealth: (bayId, status) => api.post(`/control-plane/bay/${bayId}/health`, { bayId, status }).then((r) => r.data.data),
  resolveAnomaly: (signature) => api.post(`/control-plane/anomalies/${signature}/resolve`, { resolution: "MANUAL_OVERRIDE" }).then((r) => r.data.data),
  allocate: (truckId) => api.post("/control-plane/allocate", { truckId }).then((r) => r.data.data),
  startLoading: (truckId, bayId) => api.post("/checkpoints/loading/start", { truckId, bayId }).then((r) => r.data.data),
  completeLoading: (truckId, bayId) => api.post("/checkpoints/loading/complete", { truckId, bayId }).then((r) => r.data.data),
  gantryExitDetection: (payload) => api.post("/gantry/exit-detection", payload).then((r) => r.data.data),
  getGantryCameras: () => api.get("/gantry/cameras").then((r) => r.data.data),
  updateGantryCamera: (cameraId, updates) => api.patch(`/gantry/cameras/${cameraId}`, updates).then((r) => r.data.data),
  getRecentDepartures: (limit = 10) => api.get(`/gantry/recent-departures?limit=${limit}`).then((r) => r.data.data),
  getExitAudit: (limit = 50) => api.get(`/gantry/audit?limit=${limit}`).then((r) => r.data.data),
  manualExitClearance: (payload) => api.post("/gantry/manual-exit", payload).then((r) => r.data.data),
};