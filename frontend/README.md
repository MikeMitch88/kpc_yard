# KPC Yard Control Plane — Frontend

React 18 + Vite + Tailwind CSS dashboard for the KPC Depot Autonomous Yard & Queue Control Plane.

---

## Overview

The frontend provides five operational views for the KPC MBA depot control plane, all consuming the backend REST API and SSE real-time stream:

| Page                       | Route            | Description                                        |
|----------------------------|------------------|----------------------------------------------------|
| **Executive Dashboard** | `/`              | KPIs, charts (KES savings, throughput), ESG scorecard, compliance panel, SLA uptime |
| **Depot Map**            | `/depot-map`     | Live yard topology: gate → weighbridge → staging lanes → 8 gantry bays |
| **Gate Kiosk**           | `/gate-kiosk`    | Cinematic ANPR entry simulation, digital token issuance, SMS dispatch |
| **Driver Mobile**        | `/driver`        | Token tracking, checkpoint progress, push alerts, exit scan |
| **Admin Ops**            | `/admin`         | Depot manager override: anomaly triage, manual allocation, bay health |

---

## Tech Stack

| Layer            | Technology                                      |
|------------------|-------------------------------------------------|
| Framework        | React 18                                        |
| Build Tool       | Vite 6                                          |
| Styling          | Tailwind CSS 3                                  |
| Charts           | Recharts                                        |
| Icons            | Lucide React                                    |
| HTTP Client      | Axios                                           |
| Routing          | React Router 6                                  |
| Real-Time        | Server-Sent Events (EventSource)            |
| Voice            | Web Speech API (TTS)                        |
| Language         | JavaScript (JSX)                              |

---

## Project Structure

```
frontend/
├── index.html                  # Entry HTML (title, meta, favicon)
├── vite.config.js              # Vite config: dev proxy, build chunks
├── tailwind.config.js          # KPC theme (colors, font)
├── postcss.config.js           # Tailwind + Autoprefixer
├── eslint.config.js            # ESLint flat config (React)
└── src/
    ├── main.jsx                # React root + BrowserRouter
    ├── App.jsx                 # Route definitions + AlertCenter (toast)
    ├── index.css               # Tailwind directives + custom utilities
    ├── main.jsx
    ├── hooks/
    │   ├── useYardStream.js    # SSE subscription to backend events
    │   ├── useYardData.js      # Polling hooks (metrics, ESG, snapshot, etc.)
    │   └── useDemoAuth.js      # Sandbox JWT login + persistence
    ├── services/
    │   ├── api.js              # Axios instance + role-slot token management + yard API
    │   └── speech.js           # Web Speech API TTS (voice guidance)
    ├── components/
    │   ├── Layout.jsx          # Sidebar nav + Outlet
    │   ├── StatusBadge.jsx     # Status chip with color mapping
    │   ├── KpiCard.jsx         # Glassmorphism KPI card w/ animated number
    │   ├── AnimatedNumber.jsx  # Eased count-up number
    │   ├── EsgScorecard.jsx    # ESG + carbon-spill risk display
    │   ├── CompliancePanel.jsx # Depot speed/transit compliance
    │   ├── BayCard.jsx         # Gantry bay card w/ queue + pump telemetry
    │   └── AlertCenter.jsx     # Toast alert system (cross-page)
    └── pages/
        ├── ExecutiveDashboard.jsx
        ├── DepotMap.jsx
        ├── GateKiosk.jsx
        ├── DriverMobile.jsx
        └── AdminOps.jsx
```

---

## Key Patterns

### Role-Based Token Management
The `api.js` service stores JWTs per role in `localStorage` (`kpc_demo_token_executive`, `kpc_demo_token_depot-manager`, etc.). An Axios request interceptor picks the token matching the route's required role — never stale/legacy tokens.

### Real-Time Events
`useYardStream` opens an SSE connection to `/api/stream` and registers handlers for 14 domain events: `gate:entry`, `bay:assigned`, `loading:started/progress/completed`, `checkpoint:crossed`, `anomaly:detected`, `reroute:applied`, `queue:sequenced`, `control:override`, `sla:breach`, `preMovement:alert`, `compliance:violation`, `truck:exited`.

### Data Polling Fallback
`useYardData` provides interval-based polling hooks as a resilient fallback alongside SSE: `useMetrics`, `useEsg`, `useCompliance`, `useAnomalies`, `useYardSnapshot`, `useIntegrations`.

### Voice Guidance
`speech.js` uses the Web Speech API to announce events (bay assignments, pre-movement alerts, etc.). Toggleable via `localStorage.kpc_voice_enabled` and UI buttons.

---

## Scripts

```bash
# Development server (port 5173, proxies /api to backend)
npm run dev

# Production build (outputs to dist/)
npm run build

# Preview production build
npm run preview

# Lint
npm run lint
```

---

## Running

### Prerequisites
- Node.js >= 20
- Backend running on `http://localhost:8080` (or set `VITE_API_PROXY`)

### Quick Start

```bash
cd frontend
npm install
npm run dev
```

The dev server starts on `http://localhost:5173`. The `/api` proxy forwards to the backend (configurable via `VITE_API_PROXY` env variable, default `http://localhost:8080`).

### Walkthrough
1. Open the app — the Executive Dashboard auto-authenticates with the `executive` role via `/auth/demo`.
2. Navigate to **Gate Kiosk**, enter a manifest plate (e.g., `KKH 135E`), and capture to issue a digital token.
3. Simulate checkpoints (Gate → Weighbridge) to trigger autonomous bay allocation.
4. Watch real-time events flow across all pages via the SSE stream.

---

## Environment Variables

| Variable            | Default                    | Description                          |
|---------------------|----------------------------|--------------------------------------|
| `VITE_API_URL`      | `/api`                     | API base URL (or proxy prefix)    |
| `VITE_API_PROXY`    | `http://localhost:8080`    | Proxy target for `/api` in dev    |

---

## Build Output

```bash
npm run build
```

Produces `dist/` with code-split bundles:
- `vendor` — React, ReactDOM, Router, Axios
- `charts` — Recharts
- `icons` — Lucide React

The production build targets static hosting (see root `render.yaml` for the SPA rewrite rule).
