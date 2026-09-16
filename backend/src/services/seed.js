import { ref } from "../config/firebase.js";
import { generateKey } from "./memoryStore.js";
import { PRODUCTS, getLiveBays } from "./yard.service.js";

export const SEED_BAYS = [
  { id: "G1", name: "Gantry 1", product: PRODUCTS.DIESEL, pumpRateLpm: 1200 },
  { id: "G2", name: "Gantry 2", product: PRODUCTS.DIESEL, pumpRateLpm: 1150 },
  { id: "G3", name: "Gantry 3", product: PRODUCTS.PETROL, pumpRateLpm: 1100 },
  { id: "G4", name: "Gantry 4", product: PRODUCTS.PETROL, pumpRateLpm: 1050 },
  { id: "G5", name: "Gantry 5", product: PRODUCTS.KEROSENE, pumpRateLpm: 950 },
  { id: "G6", name: "Gantry 6", product: PRODUCTS.JET_A1, pumpRateLpm: 1300 },
  { id: "G7", name: "Gantry 7", product: PRODUCTS.ADBLUE, pumpRateLpm: 600 },
  { id: "G8", name: "Gantry 8", product: PRODUCTS.FLEXIBLE, pumpRateLpm: 1000, flexible: true },
];

export const SEED_MANIFEST = [
  { regNo: "KCA 123X", driver: "James Otieno", driverPhone: "+254711000001", product: PRODUCTS.DIESEL, capacityLiters: 45_000, tareKg: 20_500 },
  { regNo: "KDB 456Y", driver: "Mary Wambui", driverPhone: "+254711000002", product: PRODUCTS.DIESEL, capacityLiters: 38_000, tareKg: 18_000 },
  { regNo: "KEC 789Z", driver: "Peter Mwangi", driverPhone: "+254711000003", product: PRODUCTS.PETROL, capacityLiters: 33_000, tareKg: 16_500 },
  { regNo: "KFD 321A", driver: "Grace Njeri", driverPhone: "+254711000004", product: PRODUCTS.PETROL, capacityLiters: 42_000, tareKg: 19_500 },
  { regNo: "KGE 654B", driver: "Charles Kiptoo", driverPhone: "+254711000005", product: PRODUCTS.KEROSENE, capacityLiters: 30_000, tareKg: 15_500 },
  { regNo: "KHF 987C", driver: "Alice Chebet", driverPhone: "+254711000006", product: PRODUCTS.JET_A1, capacityLiters: 50_000, tareKg: 22_000 },
  { regNo: "KJG 246D", driver: "Samuel Karanja", driverPhone: "+254711000007", product: PRODUCTS.ADBLUE, capacityLiters: 20_000, tareKg: 12_500 },
  { regNo: "KKH 135E", driver: "David Omondi", driverPhone: "+254711000008", product: PRODUCTS.DIESEL, capacityLiters: 45_000, tareKg: 20_500 },
  { regNo: "KMJ 864F", driver: "Faith Akinyi", driverPhone: "+254711000009", product: PRODUCTS.PETROL, capacityLiters: 34_500, tareKg: 17_000 },
  { regNo: "KNK 753G", driver: "George Barasa", driverPhone: "+254711000010", product: PRODUCTS.DIESEL, capacityLiters: 41_000, tareKg: 19_000 },
  { regNo: "KDX 110X", driver: "Kipchoge Keino", driverPhone: "+254711000011", product: PRODUCTS.DIESEL, capacityLiters: 30_000, tareKg: 15_000 },
  { regNo: "KDX 100X", driver: "Kipchoge Keino", driverPhone: "+254711000012", product: PRODUCTS.DIESEL, capacityLiters: 30_000, tareKg: 15_000 },
  { regNo: "KDD 001D", driver: "Karanja Kibaki", driverPhone: "+254711000099", product: PRODUCTS.DIESEL, capacityLiters: 45_000, tareKg: 20_500, stagingYard: "Yard 2" },
  { regNo: "KLM 246A", driver: "Wanjiru Kamau", driverPhone: "+254711000013", product: PRODUCTS.DIESEL, capacityLiters: 35_000, tareKg: 17_000 },
  { regNo: "KNP 357B", driver: "Ochieng Odhiambo", driverPhone: "+254711000014", product: PRODUCTS.PETROL, capacityLiters: 28_000, tareKg: 14_500 },
  { regNo: "KQR 468C", driver: "Amina Hassan", driverPhone: "+254711000015", product: PRODUCTS.KEROSENE, capacityLiters: 32_000, tareKg: 16_000 },
  { regNo: "KST 579D", driver: "Brian Mutua", driverPhone: "+254711000016", product: PRODUCTS.JET_A1, capacityLiters: 48_000, tareKg: 21_000 },
  { regNo: "KUV 680E", driver: "Nancy Wairimu", driverPhone: "+254711000017", product: PRODUCTS.DIESEL, capacityLiters: 40_000, tareKg: 18_500 },
  { regNo: "KVW 791F", driver: "Hassan Ali", driverPhone: "+254711000018", product: PRODUCTS.ADBLUE, capacityLiters: 22_000, tareKg: 13_000 },
];

/**
 * Idempotent seed for the yard: gantry bay topology + scheduled batch manifest.
 */
export async function seedYard() {
  const baysSnap = await ref("yard/bays").once("value");
  const bays = baysSnap.val() ?? {};

  if (Object.keys(bays).length === 0) {
    for (const bay of SEED_BAYS) {
      await ref(`yard/bays/${bay.id}`).set({
        name: bay.name,
        product: bay.product,
        pumpRateLpm: bay.pumpRateLpm,
        status: "ACTIVE",
        flexible: bay.flexible ?? false,
        currentVehicleToken: null,
        currentVehicleId: null,
        currentVehicleRemainingLiters: null,
        loadStartedAt: null,
        lastCompletionAt: null,
        completedCount: 0,
        createdAt: Date.now(),
      });
    }
    console.log("[seed] Created gantry topology (8 bays)");
  }

  const manifestSnap = await ref("yard/manifest/vehicles").once("value");
  const existing = manifestSnap.val() ?? {};
  if (Object.keys(existing).length === 0) {
    for (const entry of SEED_MANIFEST) {
      const batchId = generateKey("batch_").toLowerCase();
      await ref(`yard/manifest/vehicles/${batchId}`).set({
        ...entry,
        status: "SCHEDULED",
        allocatedAt: Date.now(),
      });
    }
    console.log("[seed] Populated scheduled batch manifest");
  } else {
    // Ensure KDD 001D is always present in manifest
    const hasKdd001d = Object.values(existing).some((v) => String(v.regNo).replace(/\s+/g, "").toUpperCase() === "KDD001D");
    if (!hasKdd001d) {
      const kddBatchId = generateKey("batch_kdd001d_").toLowerCase();
      await ref(`yard/manifest/vehicles/${kddBatchId}`).set({
        regNo: "KDD 001D",
        driver: "Karanja Kibaki",
        driverPhone: "+254711000099",
        product: PRODUCTS.DIESEL,
        capacityLiters: 45_000,
        tareKg: 20_500,
        stagingYard: "Yard 2",
        status: "SCHEDULED",
        allocatedAt: Date.now(),
      });
    }
  }
}

export async function seedIsEmpty() {
  const bays = await getLiveBays();
  return Object.keys(bays).length === 0;
}