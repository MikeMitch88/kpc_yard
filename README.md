# KPC Yard Control Plane

**KPC Depot Autonomous Yard & Queue Control Plane** — a full-stack application for the Kenya Pipeline Company MBA depot that autonomously manages tanker truck flow through the yard: gate entry, weighbridge verification, AI bay matching, gantry loading, and exit — with zero human dispatcher required.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Pages](#pages)
- [Backend](#backend)
- [Frontend](#frontend)
- [Analytics](#analytics)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)
- [Testing](#testing)
- [Project Structure](#project-structure)

---

## Overview

The system models a fuel depot where tanker trucks follow a strict lifecycle:

```
Gate Entry → Weighbridge → Staging Queue → Gantry Loading → Exit
```

Key autonomous features:
- **ANPR Gate Capture** — plates validated against batch manifest; digital KPC tokens issued
- **AI Bay Matching** — optimal gantry assigned by pump rate, queue forecast, product match, and bay health
- **Closed-Loop Auto-Reroute** — anomalies (dead gantries, queue overflow, load hangs) trigger automatic vehicle re-sequencing
- **Pre-Movement SMS** — drivers staged 5 minutes before bay clearance, zero wasted demurrage time
- **Real-Time Dashboard** — SSE stream powers live KPIs, ESG scorecards, compliance panels, and depot maps
- **Alerting** — PagerDuty, Slack, and TALK-SASA SMS escalation paths

---

## Architecture

```
┌──────────────┐       ┌───────────────────┐       ┌──────────────────┐
│   Frontend    │◄─────►│     Backend        │◄─────►│  Firebase RTDB   │
│  (React 18)  │  REST │  (Node + Express)  │       │  (or Emulator)   │
│  + Vite      │  /SSE │  + SSE Stream      │       │                  │
└──────────────┘       └───────────────────┘       └──────────────────┘
                              │
                              │  PagerDuty / Slack / TALK-SASA
                              ▼
                     ┌───────────────────┐
                     │  Alerting Channels │
                     └───────────────────┘

┌──────────────┐
│  Analytics    │  (Python: data simulation + ML queue-delay model)
└──────────────┘
```

| Service     | Port | Description                            |
|-------------|------|----------------------------------------|
| Backend     | 8080 | REST API + SSE real-time stream  |
| Frontend    | 5173 | Vite dev server (proxies to backend)   |

---

## Quick Start

### Prerequisites

- Node.js >= 20
- npm >= 10
- Python 3 (for analytics scripts, optional)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env as needed (defaults work for demo mode)
```

### 3. Start both services

```bash
npm run dev
```

This starts the backend (port 8080) and frontend (port 5173) concurrently. Open http://localhost:5173.

### Individual commands

```bash
npm run dev:backend     # Backend only
npm run dev:frontend    # Frontend only
npm run build           # Frontend production build
npm test                # Backend tests (Jest)
```

---

## Pages

| Page                 | Route         | Role (auto-login)        | Highlights                                         |
|----------------------|---------------|--------------------------|----------------------------------------------------|
| Executive Dashboard  | `/`           | executive                | KPI cards, KES/throughput charts, ESG, compliance  |
| Depot Map            | `/depot-map`  | executive                | Yard topology, gate→gantry flow, bay cards         |
| Gate Kiosk           | `/gate-kiosk` | gate-officer             | ANPR simulation, token issuance, SMS dispatch      |
| Driver Mobile        | `/driver`     | driver                   | Token tracker, checkpoint progress, push alerts    |
| Admin Ops            | `/admin`      | depot-manager            | Anomaly triage, manual allocation, bay overrides   |

Each page auto-authenticates with a demo JWT for its role on mount.

---

## Backend

- **Location**: `backend/`
- **Framework**: Express 4 + Node.js >= 20
- **Auth**: JWT with 5 roles (gate-officer, driver, depot-manager, executive, system)
- **Database**: Firebase Realtime DB (production) or in-memory emulator (dev/demo)
- **API**: REST endpoints under `/api` + SSE at `/api/stream`
- **Key services**: yard service (truck lifecycle), auto-reroute (anomaly detection + closed-loop), compliance (speed/dwell), ESG scorecard, analytics, notification (PagerDuty/Slack/SMS)

See [backend/README.md](backend/README.md) for full details.

---

## Frontend

- **Location**: `frontend/`
- **Framework**: React 18 + Vite + Tailwind CSS 3
- **Charts**: Recharts
- **Real-time**: SSE (EventSource) + polling fallbacks
- **Build output**: `frontend/dist/`

See [frontend/README.md](frontend/README.md) for full details.

---

## Analytics

Python scripts for traffic simulation and ML-based queue delay prediction.

| Script                | Purpose                                     |
|-----------------------|---------------------------------------------|
| `analytics/data_simulator.py` | Simulate tanker arrivals + gantry cycles → CSV  |
| `analytics/flow_model.py`     | Train gradient-boosted regressor → predict bay wait times |

```bash
# Install analytics dependencies
pip install -r analytics/requirements.txt

# Simulate traffic
python3 analytics/data_simulator.py --cycles 5

# Train model and predict
python3 analytics/flow_model.py --data yard_simulation.csv --predict
```

---

## Environment Variables

Full reference: [`.env.example`](.env.example)

Key variables:

| Variable                       | Default                 | Description                             |
|--------------------------------|-------------------------|-----------------------------------------|
| `NODE_ENV`                     | `development`           | Runtime mode                            |
| `PORT`                         | `8080`                  | Backend listen port                    |
| `JWT_SECRET`                   | (dev insecure)         | JWT signing secret (min 16 chars)  |
| `EMULATOR_MODE`                | `true`                  | Use in-memory store (no Firebase creds) |
| `LOOP_INTERVAL_MS`             | `45000`                 | Closed-loop cycle interval (ms)          |
| `DEMURRAGE_RATE_PER_HOUR_KES` | `12000`                 | Hourly demurrage rate                  |
| `OPTIMAL_TURNAROUND_HOURS`   | `4.5`                   | Baseline turnaround for ROI calc       |
| `CORS_ORIGIN`                  | `*`                     | Allowed CORS origins                    |
| `TALKSASA_API_KEY`             |                         | TALK-SASA SMS gateway key              |
| `PAGERDUTY_WEBHOOK_URL`        |                         | PagerDuty Events API v2 URL            |
| `SLACK_WEBHOOK_URL`            |                         | Slack incoming webhook URL             |
| `VITE_API_URL`                 | `/api`                  | Frontend API base URL (dev proxy)      |
| `VITE_API_PROXY`               | `http://localhost:8080` | Dev proxy target                       |

---

## Deployment

A Render blueprint is provided at [`render.yaml`](render.yaml) for one-click deployment:

- **kpc-yard-backend** — Node.js web service (port 8080, health check at `/api/health`)
- **kpc-yard-frontend** — Static site (builds with `npm install && npm run build`, SPA rewrite to `index.html`)

Environment secrets (`JWT_SECRET`, Firebase credentials, PagerDuty/Slack/TALK-SASA keys) are configured in the Render dashboard — they are marked `sync: false` in the blueprint.

---

## Testing

### Backend (Jest + Supertest)

```bash
cd backend
npm test           # Run all tests
npm run test:watch # Watch mode
```

Test suites cover: API surface, compliance scanning, anomaly detection, pre-movement alerts, ESG scorecard, and checkpoint verification.

### Frontend

```bash
cd frontend
npm run lint       # ESLint
```

---

## Project Structure

```
kpc_yard/
├── .env.example              # Environment template
├── .gitignore
├── package.json              # Root: npm workspaces, scripts
├── render.yaml               # Render deployment blueprint
├── backend/
│   ├── README.md             # Backend docs
│   ├── package.json
│   ├── .eslintrc.cjs
│   ├── src/                  # Server, routes, controllers, services, middleware, config, tests
│   └── tests/                # Jest test suites
├── frontend/
│   ├── README.md             # Frontend docs
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── eslint.config.js
│   ├── index.html
│   └── src/                  # Components, pages, hooks, services
├── analytics/
│   ├── flow_model.py         # ML queue-delay prediction
│   ├── data_simulator.py     # Traffic simulator
│   └── requirements.txt      # numpy, pandas, scikit-learn, scipy
└── node_modules/             # Workspace symlinks (after npm install)
```

---

## Demo

The application runs fully in demo mode out of the box:

1. **Start**: `npm run dev`
2. **Landing**: Executive Dashboard auto-logs in as executive — see KPIs, charts, ESG, compliance
3. **Gate Kiosk**: Enter `KKH 135E` (or any manifest plate) → capture → token issued → AI bay assigned
4. **Depot Map**: Watch the truck move through gate → weighbridge → staging → gantry in real time
5. **Driver Mobile**: Track the truck's token status, receive push alerts, scan exit
6. **Admin Ops**: Trigger closed-loop cycles, resolve anomalies, override bay health

No external services required — Firebase emulator mode + emulated SMS/PagerDuty/Slack active by default.
