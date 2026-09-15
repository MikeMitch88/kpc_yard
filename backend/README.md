# KPC Yard Control Plane — Backend

Node.js + Express REST API and real-time event infrastructure for the KPC Depot Autonomous Yard & Queue Control Plane.

---

## Overview

The backend provides the control plane for the Kenya Pipeline Company (KPC) MBA depot. It manages the full lifecycle of tanker trucks flowing through the yard — gate entry, weighbridge verification, AI bay matching, gantry loading, and exit — entirely through an autonomous closed-loop control system with no human dispatcher required.

**Key capabilities:**
- **ANPR Gate Entry** — license plate capture validated against the scheduled batch manifest, issuing KPC digital tokens
- **Checkpoint Verification** — RFID readings at Gate → Weighbridge → Gantry → Exit with strict sequence enforcement and weighbridge gross-weight validation
- **AI Bay Matching** — scores candidate gantries by product compatibility, pump rate, queue forecast, and health to assign the optimal bay
- **Closed-Loop Auto-Reroute** — anomaly detector scans for dead gantries, queue overflows, load hangs, and pump degradation, then automatically reroutes queued vehicles
- **Pre-Movement Dispatch** — SMS staging alerts fired when a gantry load is within the alert window, zero wasted demurrage time
- **ESG & Compliance** — carbon-spill risk scoring, fleet transit compliance (speed + dwell), and demurrage ROI telemetry
- **Real-Time Events** — Server-Sent Events (SSE) stream at `/api/stream` fanning out domain events to all connected clients
- **Alerting** — PagerDuty (Events API v2), Slack webhooks, and TALK-SASA bulk SMS

---

## Tech Stack

| Layer            | Technology                                      |
|------------------|-------------------------------------------------|
| Runtime          | Node.js >= 20                                   |
| Framework        | Express 4                                       |
| Auth             | JWT (jsonwebtoken) + role-based middleware        |
| Database         | Firebase Realtime DB (or in-memory emulator)    |
| Validation       | Joi (env schema)                                |
| Security         | Helmet, CORS, express-rate-limit                |
| Logging          | Morgan (HTTP), console (application)            |
| Testing          | Jest + Supertest                                |
| Lint             | ESLint                                          |

---

## Project Structure

```
backend/
├── src/
│   ├── server.js              # Bootstrap, startup, graceful shutdown, closed-loop watcher
│   ├── app.js                 # Express app wiring (middleware + routes)
│   ├── config/
│   │   ├── env.js             # Environment validation (Joi schema) + typed config object
│   │   └── firebase.js        # Firebase Admin SDK init or in-memory emulator factory
│   ├── middleware/
│   │   ├── auth.js            # JWT authentication + token issuance
│   │   ├── roles.js           # Role-based authorization (RBAC)
│   │   └── errorHandler.js    # Custom ApiError class + Express error middleware
│   ├── routes/
│   │   ├── index.js           # Router mount + /stream SSE handler + /health
│   │   ├── auth.routes.js     # POST /auth/demo (dev token factory)
│   │   ├── gate.routes.js     # ANPR entry, manifest, dispatch SMS
│   │   ├── checkpoint.routes.js  # RFID scan, history, loading start/complete
│   │   ├── controlPlane.routes.js # Metrics, ESG, compliance, anomalies, cycle commands
│   │   └── driver.routes.js   # Driver status lookup by token
│   ├── controllers/
│   │   ├── gate.controller.js
│   │   ├── checkpoint.controller.js
│   │   ├── controlPlane.controller.js
│   │   └── ...
│   ├── services/
│   │   ├── yard.service.js    # Core domain: tokens, bays, truck lifecycle, bay matching
│   │   ├── checkpoint.service.js  # Checkpoint verification + trail
│   │   ├── autoReroute.service.js # Anomaly detector, closed-loop cycle, pump sim
│   │   ├── compliance.service.js  # Speed/dwell violation scanning
│   │   ├── esg_scorecard.service.js # CO₂ savings, spill risk per bay
│   │   ├── analytics.service.js   # Metrics computation, throughput series
│   │   ├── notification.service.js # PagerDuty, Slack, TALK-SASA SMS
│   │   ├── seed.js            # Yard topology + manifest seed data
│   │   ├── memoryStore.js     # In-memory Firebase RTDB emulator
│   │   └── eventBus.js        # In-process pub/sub for SSE + notifications
│   └── tests/                 # Jest test suites
│       ├── api.test.js
│       └── *.service.test.js
├── package.json
└── .eslintrc.cjs
```

---

## API Endpoints

All endpoints are prefixed with `/api` (mounted in `app.js`).

### Public (no auth required)
| Method | Endpoint               | Description                                   |
|--------|------------------------|-----------------------------------------------|
| GET    | `/health`              | Service health check                          |
| GET    | `/stream`              | SSE real-time event stream                    |
| GET    | `/control-plane/metrics` | KPI metrics (demurrage, turnaround, etc.)    |
| GET    | `/control-plane/esg`   | ESG scorecard & carbon-spill risk             |
| GET    | `/control-plane/compliance` | Fleet compliance summary                   |
| GET    | `/control-plane/integrations` | Integration health status                 |
| GET    | `/control-plane/snapshot` | Live yard snapshot (tokens stripped)        |

### Authenticated (JWT Bearer token required)
| Method | Endpoint                          | Roles                          | Description                       |
|--------|-----------------------------------|--------------------------------|-----------------------------------|
| POST   | `/auth/demo`                      | *                              | Issue a demo JWT                  |
| POST   | `/gate/entry`                     | gate-officer, system, depot-manager, executive | ANPR gate capture → token issue |
| POST   | `/gate/dispatch-sms`              | gate-officer, depot-manager, executive, system | Send SMS queue pass         |
| GET    | `/gate/manifest`                  | all                            | Current batch manifest            |
| POST   | `/checkpoints/scan`               | gate-officer, system, depot-manager, driver | RFID checkpoint reading     |
| GET    | `/checkpoints/:token`             | all                            | Checkpoint trail for a token      |
| POST   | `/checkpoints/loading/start`      | system, depot-manager, gate-officer | Begin gantry loading          |
| POST   | `/checkpoints/loading/complete`   | system, depot-manager, gate-officer | Complete gantry loading         |
| GET    | `/driver/:token`                  | all                            | Driver status by token            |
| GET    | `/control-plane/throughput`       | executive, depot-manager       | Throughput series (N days)        |
| GET    | `/control-plane/anomalies`        | depot-manager, executive       | Open anomaly list                 |
| POST   | `/control-plane/anomalies/:sig/resolve` | depot-manager, executive | Resolve an anomaly              |
| POST   | `/control-plane/cycle`            | depot-manager, executive       | Trigger closed-loop cycle         |
| POST   | `/control-plane/resequence`       | depot-manager, executive       | Manual queue re-sequence          |
| POST   | `/control-plane/bay/:id/health`   | depot-manager, executive       | Override bay health status        |
| POST   | `/control-plane/allocate`         | depot-manager, executive       | Manual bay allocation             |
| GET    | `/control-plane/compliance/violations` | depot-manager, executive | Open compliance violations    |
| POST   | `/control-plane/compliance/violations/:sig/resolve` | depot-manager, executive | Resolve violation |

---

## Roles

| Role           | Description                        |
|----------------|------------------------------------|
| `gate-officer` | Gate capture, checkpoint scanning  |
| `driver`       | Own token tracking + exit scan     |
| `depot-manager`| Full control plane + overrides     |
| `executive`    | Read-heavy dashboards + commands   |
| `system`       | Service-level operations           |

---

## Environment Variables

See root `.env.example` for the full list. Key variables:

| Variable                        | Default              | Description                             |
|---------------------------------|----------------------|-----------------------------------------|
| `NODE_ENV`                      | `development`        | Runtime mode                            |
| `PORT`                          | `8080`               | HTTP listen port                        |
| `JWT_SECRET`                    | (dev insecure)       | JWT signing secret (min 16 chars)       |
| `JWT_EXPIRES_IN`                | `12h`                | Token TTL                               |
| `EMULATOR_MODE`                 | `true`               | Use in-memory store (no Firebase creds) |
| `LOOP_INTERVAL_MS`              | `45000`              | Closed-loop cycle interval              |
| `DEMURRAGE_RATE_PER_HOUR_KES`   | `12000`              | Hourly demurrage rate                   |
| `OPTIMAL_TURNAROUND_HOURS`      | `4.5`                | Baseline turnaround for ROI calc        |
| `CORS_ORIGIN`                   | `*`                  | Allowed CORS origins                    |
| `RATE_LIMIT_WINDOW_MS`          | `60000`              | Rate limit window                       |
| `RATE_LIMIT_MAX`                | `120`                | Max requests per window                 |
| `TALKSASA_API_KEY`              |                      | TALK-SASA SMS gateway key               |
| `TALKSASA_SENDER_ID`            | `TALK-SASA`          | Branded SMS sender ID                   |
| `PAGERDUTY_WEBHOOK_URL`         |                      | PagerDuty Events API v2 URL             |
| `SLACK_WEBHOOK_URL`             |                      | Slack incoming webhook URL              |
| `FIREBASE_*`                    |                      | Firebase Admin SDK credentials          |

---

## Scripts

```bash
# Start production server
npm start

# Start with auto-reload (dev)
npm run dev

# Run tests (Jest + Supertest)
npm test

# Run tests in watch mode
npm run test:watch

# Lint source
npm run lint
```

---

## Running

```bash
cd backend
npm install
npm run dev
```

The server starts on `http://localhost:8080` and begins the closed-loop watcher (every `LOOP_INTERVAL_MS` ms by default). In emulator mode it seeds 8 gantry bays and a 10-truck manifest on first boot.

---

## Testing

Tests use Jest with Supertest against the in-memory Express app. The `EMULATOR_MODE` environment is used for test isolation.

```bash
npm test
```

Test coverage includes: API surface (auth, gate, checkpoints, control-plane, driver), compliance scanning, auto-reroute/anomaly detection, pre-movement alerts, ESG scorecard, and checkpoint verification.

---

## Architecture Notes

- **Emulator Mode**: When Firebase credentials are absent (or `EMULATOR_MODE=true`), the backend uses an in-memory RTDB-compatible store (`src/services/memoryStore.js`) — no external database required for development or hackathon demos.
- **SSE Stream**: `/api/stream` opens a persistent Server-Sent Events connection. The `useYardStream` React hook on the frontend subscribes to this for live updates. Heartbeat every 25s, reconnection hint of 3s.
- **Closed-Loop Cycle**: The `runClosedLoopCycle()` function (called on a timer and via API) runs: anomaly scan → auto-reroute remediation → pump flow simulation → pre-movement SMS dispatch → compliance scan — fully autonomous.
- **Event Bus**: Domain events (`gate:entry`, `anomaly:detected`, `reroute:applied`, etc.) are emitted via `src/services/eventBus.js` and consumed by both the SSE stream and notification services.
- **Token Security**: The `/control-plane/snapshot` endpoint strips `token` fields from truck objects before returning to anonymous callers.
