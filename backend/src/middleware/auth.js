import jwt from "jsonwebtoken";
import env from "../config/env.js";
import { ApiError } from "./errorHandler.js";

export function authenticate(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(ApiError.unauthorized("Missing bearer token"));

  try {
    const payload = jwt.verify(token, env.jwt.secret);
    req.user = {
      id: payload.sub,
      role: payload.role,
      name: payload.name,
      truckId: payload.truckId ?? null,
    };
    return next();
  } catch {
    return next(ApiError.unauthorized("Invalid or expired token"));
  }
}

/** Issue a signed enterprise JWT — used by the sandbox token factory and seed gate. */
export function issueToken({ sub, role, name, truckId = null }) {
  return jwt.sign({ sub, role, name, truckId }, env.jwt.secret, {
    expiresIn: env.jwt.expiresIn,
  });
}