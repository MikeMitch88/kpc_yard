import request from "supertest";
import app from "../src/app.js";
import {
  processGantryExitDetection,
  normalizePlate,
  platesMatch,
  getCameraConfig,
  updateCameraConfig,
  listRecentDepartures,
  listExitAuditTrail,
  formatDepartureMessage,
} from "../src/services/gantryExit.service.js";
import {
  processGateEntry,
  allocateBayForTruck,
  startLoading,
  TRUCK_STATUS,
} from "../src/services/yard.service.js";
import { verifyCheckpoint } from "../src/services/checkpoint.service.js";
import { ref } from "../src/config/firebase.js";

let testToken;
let testTruckId;
const TEST_PLATE = "KDA 482X";

beforeAll(async () => {
  // Populate scheduled manifest
  await ref("yard/manifest/vehicles/kda482x").set({
    regNo: TEST_PLATE,
    driver: "Otieno Omondi",
    driverPhone: "+254722111222",
    product: "DIESEL",
    capacityLiters: 40000,
    tareKg: 18000,
    status: "SCHEDULED",
  });

  // Populate an active bay
  await ref("yard/bays/B03").set({
    name: "Gantry Bay B03",
    product: "DIESEL",
    pumpRateLpm: 1200,
    status: "ACTIVE",
    queuedVehicles: {},
    currentVehicleToken: null,
    completedCount: 0,
  });

  // Ingest vehicle at gate
  const entry = await processGateEntry({ regNo: TEST_PLATE, depot: "MBA" });
  testToken = entry.token;
  testTruckId = entry.id;

  // Pass weighbridge
  await verifyCheckpoint({
    token: testToken,
    checkpoint: "WEIGHBRIDGE",
    payload: { grossWeightKg: 52000 },
  });

  // Assign to Bay B03 and start loading
  await allocateBayForTruck(testTruckId);
  await startLoading(testTruckId, "B03");
});

describe("Gantry Exit ANPR Service & Number Plate Processing", () => {
  test("normalizePlate standardizes spacing and casing", () => {
    expect(normalizePlate("kda482x")).toBe("KDA 482X");
    expect(normalizePlate(" KDA  482X ")).toBe("KDA 482X");
    expect(normalizePlate("kda 482x")).toBe("KDA 482X");
  });

  test("platesMatch handles whitespace and case variations", () => {
    expect(platesMatch("KDA 482X", "kda482x")).toBe(true);
    expect(platesMatch("KDA482X", "KDA 482X")).toBe(true);
    expect(platesMatch("KDA 482X", "KDB 456Y")).toBe(false);
  });

  test("formatDepartureMessage outputs dynamic plate text", () => {
    const msg = formatDepartureMessage("KDA 482X");
    expect(msg).toContain("Vehicle: KDA 482X");
    expect(msg).toContain("Thank you for your visit!");
    expect(msg).toContain("Drive safely!");
  });

  test("processes exit detection for active loading tanker automatically", async () => {
    const result = await processGantryExitDetection({
      numberPlate: "KDA 482X",
      cameraId: "GANTRY-EXIT-01",
    });

    expect(result.success).toBe(true);
    expect(result.matched).toBe(true);
    expect(result.numberPlate).toBe("KDA 482X");
    expect(result.loadingStatus).toBe("LOADED");
    expect(result.gantryStatus).toBe("EXITED");
    expect(result.bayId).toBe("B03");
    expect(result.departureMessage).toContain("KDA 482X");

    // Verify tanker database state
    const truckSnap = await ref(`yard/trucks/${testTruckId}`).once("value");
    const truck = truckSnap.val();
    expect(truck.status).toBe(TRUCK_STATUS.COMPLETED);
    expect(truck.loadingStatus).toBe("LOADED");
    expect(truck.gantryStatus).toBe("EXITED");
    expect(truck.checkpoint).toBe("EXIT");
    expect(truck.exitDetected).toBe(true);
    expect(truck.exitedAt).toBeTruthy();

    // Verify bay is released and available
    const baySnap = await ref("yard/bays/B03").once("value");
    const bay = baySnap.val();
    expect(bay.currentVehicleToken).toBeFalsy();
    expect(bay.currentVehicleId).toBeFalsy();
    expect(bay.completedCount).toBeGreaterThanOrEqual(1);

    // Verify audit record exists
    const audits = await listExitAuditTrail();
    const matchAudit = audits.find((a) => a.numberPlate === "KDA 482X");
    expect(matchAudit).toBeTruthy();
    expect(matchAudit.matched).toBe(true);
    expect(matchAudit.newStatus).toBe("LOADED / EXITED");
  });

  test("debouncing / idempotency: ignores rapid duplicate plate detection", async () => {
    const dupResult = await processGantryExitDetection({
      numberPlate: "KDA 482X",
      cameraId: "GANTRY-EXIT-01",
    });

    expect(dupResult.success).toBe(true);
    expect(dupResult.duplicate).toBe(true);
    expect(dupResult.idempotent).toBe(true);
    expect(dupResult.departureMessage).toContain("KDA 482X");
  });

  test("unknown plate creates anomaly alert without corrupting database", async () => {
    const unknownPlate = "KZZ 999Z";
    const result = await processGantryExitDetection({
      numberPlate: unknownPlate,
      cameraId: "GANTRY-EXIT-01",
      allowOfflineOverride: true,
    });

    expect(result.success).toBe(false);
    expect(result.matched).toBe(false);
    expect(result.numberPlate).toBe("KZZ 999Z");
    expect(result.message).toContain("No active tanker matched");

    // Verify anomaly is logged
    const anomaliesSnap = await ref("yard/anomalies").once("value");
    const anomalies = anomaliesSnap.val() ?? {};
    const unknownAnomaly = Object.values(anomalies).find(
      (a) => a.type === "UNKNOWN_VEHICLE_EXIT" && a.numberPlate === "KZZ 999Z",
    );
    expect(unknownAnomaly).toBeTruthy();
    expect(unknownAnomaly.status).toBe("OPEN");
  });

  test("low confidence detection flags warning anomaly", async () => {
    const result = await processGantryExitDetection({
      numberPlate: "KDA 482X",
      cameraId: "GANTRY-EXIT-01",
      confidence: 30, // Below default 50% threshold
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("LOW_CONFIDENCE");
  });

  test("camera offline mode rejects ANPR until manual override", async () => {
    await updateCameraConfig("GANTRY-EXIT-01", { status: "OFFLINE" });

    await expect(
      processGantryExitDetection({
        numberPlate: "KDA 482X",
        cameraId: "GANTRY-EXIT-01",
      }),
    ).rejects.toThrow(/OFFLINE/);

    // Restore camera to ONLINE
    await updateCameraConfig("GANTRY-EXIT-01", { status: "ONLINE" });
    const config = await getCameraConfig("GANTRY-EXIT-01");
    expect(config.status).toBe("ONLINE");
  });
});

describe("Gantry Exit REST APIs", () => {
  let demoToken;
  let apiTruckPlate = "KEC 789Z";

  beforeAll(async () => {
    // Generate auth token for demo manager
    const authRes = await request(app).post("/api/auth/demo").send({
      role: "depot-manager",
      name: "Depot Manager",
    });
    demoToken = authRes.body.data.token;

    // Register manifest for KEC 789Z
    await ref("yard/manifest/vehicles/kec789z").set({
      regNo: apiTruckPlate,
      driver: "Daniel Kiprop",
      driverPhone: "+254711000003",
      product: "PETROL",
      capacityLiters: 35000,
      tareKg: 15750,
      status: "SCHEDULED",
    });

    // Ingest at gate
    await request(app)
      .post("/api/gate/entry")
      .set("Authorization", `Bearer ${demoToken}`)
      .send({ regNo: apiTruckPlate, depot: "MBA" });
  });

  test("POST /api/gantry/exit-detection processes vehicle exit", async () => {
    const res = await request(app)
      .post("/api/gantry/exit-detection")
      .send({
        numberPlate: apiTruckPlate,
        cameraId: "GANTRY-EXIT-01",
        confidence: 98,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.numberPlate).toBe(apiTruckPlate);
    expect(res.body.data.loadingStatus).toBe("LOADED");
    expect(res.body.data.gantryStatus).toBe("EXITED");
  });

  test("GET /api/gantry/recent-departures lists departed tankers", async () => {
    const res = await request(app).get("/api/gantry/recent-departures");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const plates = res.body.data.map((d) => d.numberPlate);
    expect(plates).toContain(apiTruckPlate);
  });

  test("GET /api/gantry/cameras returns camera list", async () => {
    const res = await request(app).get("/api/gantry/cameras");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data["GANTRY-EXIT-01"]).toBeTruthy();
  });

  test("GET /api/gantry/audit returns audit records", async () => {
    const res = await request(app)
      .get("/api/gantry/audit")
      .set("Authorization", `Bearer ${demoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
