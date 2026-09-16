import request from "supertest";
import app from "../src/app.js";
import { seedYard } from "../src/services/seed.js";

let gateToken;
let managerToken;
let truckToken;

describe("REST API Surface", () => {
  beforeAll(async () => {
    await seedYard();
  });

  test("GET /api/health returns sUP state", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("UP");
  });

  test("issues role tokens via /auth/demo", async () => {
    const gate = await request(app).post("/api/auth/demo").send({ role: "gate-officer", name: "Gate Ops" });
    expect(gate.status).toBe(200);
    gateToken = gate.body.data.token;

    const mgr = await request(app).post("/api/auth/demo").send({ role: "depot-manager", name: "Manager" });
    managerToken = mgr.body.data.token;
  });

  test("rejects gate entry without auth", async () => {
    const res = await request(app).post("/api/gate/entry").send({ regNo: "KCA 123X" });
    expect(res.status).toBe(401);
  });

  test("full ANPR → token → bay allocation journey", async () => {
    await request(app).post("/api/gate/entry")
      .set("Authorization", `Bearer ${gateToken}`)
      .send({ regNo: "KKH 135E", depot: "MBA" })
      .expect(201)
      .then((res) => {
        expect(res.body.data.token).toMatch(/^KPC-MBA-\d{8}-\d+Z$/);
        truckToken = res.body.data.token;
      });

    const scan = await request(app)
      .post("/api/checkpoints/scan")
      .set("Authorization", `Bearer ${gateToken}`)
      .send({ token: truckToken, checkpoint: "WEIGHBRIDGE", payload: { grossWeightKg: 58750 } });
    expect(scan.status).toBe(200);
    expect(scan.body.data.allocation.assignment.bayId).toBe("G1");
  });

  test("control-plane telemetry is public but commands stay gated", async () => {
    for (const ep of ["metrics", "esg", "compliance", "integrations", "snapshot"]) {
      const res = await request(app).get(`/api/control-plane/${ep}`);
      expect(res.status).toBe(200);
    }

    const publicSnap = await request(app).get("/api/control-plane/snapshot");
    const snapTrucks = Object.values(publicSnap.body.data.trucks ?? {});
    for (const t of snapTrucks) {
      if (t && typeof t === "object") expect(t.token).toBeUndefined();
    }

    const ok = await request(app)
      .get("/api/control-plane/metrics")
      .set("Authorization", `Bearer ${managerToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.kpis).toBeDefined();
    expect(ok.body.data.kpis.demurrageRatePerHourKes).toBeGreaterThan(0);

    for (const path of ["/api/control-plane/throughput", "/api/control-plane/anomalies"]) {
      const denied = await request(app).get(path);
      expect(denied.status).toBe(401);
    }
  });

  test("driver can look up their own token", async () => {
    const res = await request(app)
      .get(`/api/driver/${truckToken}`)
      .set("Authorization", `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe(truckToken);
  });

  test("gate officer can dispatch the SMS queue pass", async () => {
    const res = await request(app)
      .post("/api/gate/dispatch-sms")
      .set("Authorization", `Bearer ${gateToken}`)
      .send({ token: truckToken });
    expect(res.status).toBe(200);
    expect(res.body.data.to).toMatch(/^\+\d{12}$/);
    expect(res.body.data.ok).toBe(true);
  });

  test("dispatches response team alert on stalled truck / breakdown", async () => {
    const res = await request(app)
      .post("/api/control-plane/stalled-truck")
      .send({ bayId: "G2", reason: "MECHANICAL_BREAKDOWN_3MIN_TIMEOUT" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.voiceAnnouncement).toContain("Alert for Response Team");
    expect(res.body.data.bayId).toBe("G2");
  });
});