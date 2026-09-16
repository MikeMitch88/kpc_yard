import { seedYard } from "../src/services/seed.js";
import {
  processGateEntry,
  allocateBayForTruck,
  startLoading,
  getLiveTrucks,
  getLiveBays,
  TRUCK_STATUS,
} from "../src/services/yard.service.js";
import { verifyCheckpoint } from "../src/services/checkpoint.service.js";
import {
  processGantryExitDetection,
  listExitAuditTrail,
  formatDepartureMessage,
} from "../src/services/gantryExit.service.js";

describe("Demo Truck KDX 100X - Seed, 30s Stay & Exit Workflow", () => {
  beforeAll(async () => {
    await seedYard();
  });

  test("1. KDX 100X is properly seeded in manifest", async () => {
    const { listManifest } = await import("../src/services/yard.service.js");
    const manifest = await listManifest();
    const manifestList = Object.values(manifest);
    const kdxTruck = manifestList.find((m) => String(m.regNo).replace(/\s+/g, "").toUpperCase() === "KDX100X");
    expect(kdxTruck).toBeDefined();
    expect(kdxTruck.regNo).toBe("KDX 100X");
    expect(kdxTruck.product).toBe("DIESEL");
    expect(kdxTruck.capacityLiters).toBe(30_000);
  });

  test("2. Full end-to-end demo cycle: Gate Entry -> Weighbridge -> Bay Alloc -> 30s Stay -> ANPR Exit", async () => {
    // 1. Gate entry
    const entry = await processGateEntry({ regNo: "KDX 100X", depot: "MBA" });
    expect(entry.token).toBeDefined();
    expect(entry.manifestVerified).toBe(true);
    expect(entry.truck.regNo).toBe("KDX 100X");
    expect(entry.truck.status).toBe(TRUCK_STATUS.WAITING);

    const truckId = entry.truck.id;

    // 2. Weighbridge scan & AI Bay Allocation
    const weighResult = await verifyCheckpoint({
      token: entry.token,
      checkpoint: "WEIGHBRIDGE",
      payload: { grossWeightKg: 40_500 },
    });
    expect(weighResult.weight.pass).toBe(true);

    const allocResult = await allocateBayForTruck(truckId);
    expect(allocResult.assignment.bayId).toBeDefined();
    const assignedBayId = allocResult.assignment.bayId;

    // 3. Start Loading
    const startedTruck = await startLoading(truckId, assignedBayId);
    expect(startedTruck.status).toBe(TRUCK_STATUS.LOADING);
    expect(startedTruck.bayId).toBe(assignedBayId);

    // Verify bay is occupied
    const liveBaysBeforeExit = await getLiveBays();
    expect(liveBaysBeforeExit[assignedBayId].currentVehicleId).toBe(truckId);

    // 4. Simulate 30 seconds stay / loading duration
    const stayDurationMs = 30_000;
    const simulatedExitTimestamp = Date.now() + stayDurationMs;

    // 5. ANPR Gantry Exit Detection (Departure)
    const exitResult = await processGantryExitDetection({
      numberPlate: "KDX 100X",
      cameraId: "GANTRY-EXIT-01",
      timestamp: simulatedExitTimestamp,
    });

    expect(exitResult.success).toBe(true);
    expect(exitResult.matched).toBe(true);
    expect(exitResult.loadingStatus).toBe("LOADED");
    expect(exitResult.gantryStatus).toBe("EXITED");
    expect(exitResult.numberPlate).toBe("KDX 100X");
    expect(exitResult.departureMessage).toContain("KDX 100X");
    expect(exitResult.departureMessage).toContain("Thank you for your visit!");

    // Verify truck state updated to COMPLETED / EXITED
    const liveTrucks = await getLiveTrucks();
    const truckAfterExit = liveTrucks[truckId];
    expect(truckAfterExit.status).toBe(TRUCK_STATUS.COMPLETED);
    expect(truckAfterExit.gantryStatus).toBe("EXITED");
    expect(truckAfterExit.exitDetected).toBe(true);

    // Verify bay is freed and available
    const liveBaysAfterExit = await getLiveBays();
    expect(liveBaysAfterExit[assignedBayId].currentVehicleId).toBeFalsy();
    expect(liveBaysAfterExit[assignedBayId].currentVehicleToken).toBeFalsy();

    // Verify exit audit log
    const auditLogs = await listExitAuditTrail();
    const kdxAudit = auditLogs.find((a) => a.numberPlate === "KDX 100X");
    expect(kdxAudit).toBeDefined();
    expect(kdxAudit.matched).toBe(true);
  });
});
