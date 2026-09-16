import { processGateEntry, listManifest, getLiveTrucks } from "../services/yard.service.js";
import { notifyDriver, pushPayload, buildStageSms } from "../services/notification.service.js";

export async function anprEntry(req, res, next) {
  try {
    const result = await processGateEntry({
      regNo: req.body.regNo,
      depot: req.body.depot ?? "MBA",
      driverName: req.body.driverName,
      driverPhone: req.body.driverPhone,
      operatorId: req.user.id,
    });

    // Push a welcome mobile notification + stage-1 SMS (gate entry token) to the driver
    if (req.body.driverPhone) {
      const push = pushPayload({
        token: result.token,
        title: result.manifestVerified ? "Token issued ✅" : "Token issued — verification pending",
        body: result.message,
      });
      const smsMessage = buildStageSms("gate-entry", {
        token: result.token,
        regNo: result.truck.regNo,
        product: result.truck.product,
        volumeLiters: result.truck.capacityLiters,
      });
      await notifyDriver({
        phone: req.body.driverPhone,
        token: result.token,
        regNo: result.truck.regNo,
        message: smsMessage,
        plain: true,
      });
      result.pushNotification = push;
    }

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

export async function manifest(req, res, next) {
  try {
    const data = await listManifest();
    return res.json({ success: true, data });
  } catch (err) {
    return next(err);
  }
}

/**
 * Dispatch the digital queue pass to a driver over SMS (TALK-SASA).
 * Accepts an optional `phone` override; otherwise uses the manifest-registered
 * driver phone for the truck.
 */
export async function dispatchSms(req, res, next) {
  try {
    const { token, phone } = req.body ?? {};
    if (!token) {
      return res.status(400).json({ success: false, error: { message: "token is required" } });
    }

    const trucks = await getLiveTrucks();
    const truck = Object.values(trucks).find((t) => t.token && t.token.toUpperCase() === token.toUpperCase() && t.id);
    if (!truck) {
      return res.status(404).json({ success: false, error: { message: "No active token found" } });
    }

    const target = (phone ?? truck.driverPhone ?? "").toString();
    if (!target.trim()) {
      return res.status(400).json({ success: false, error: { message: "No recipient phone — send a phone or register driverPhone on the manifest" } });
    }

    const message = buildStageSms("gate-entry", {
      token: truck.token,
      regNo: truck.regNo,
      product: truck.product,
      volumeLiters: truck.capacityLiters,
    });
    const sms = await notifyDriver({
      phone: target,
      token: truck.token,
      regNo: truck.regNo,
      message,
      plain: true,
    });

    return res.json({
      success: true,
      data: {
        token: truck.token,
        regNo: truck.regNo,
        to: sms.to ?? target,
        provider: sms.provider ?? null,
        emulated: sms.emulated ?? false,
        ok: Boolean(sms.ok),
        reason: sms.reason ?? null,
        response: sms.response ?? null,
      },
    });
  } catch (err) {
    return next(err);
  }
}