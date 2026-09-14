import crypto from "crypto";

/* =========================================================
   CONFIG
========================================================= */

const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;

if (!SESSION_SECRET) {
  throw new Error("ADMIN_SESSION_SECRET is missing");
}

/*
 * Admin session อายุ 8 ชั่วโมง
 */
const SESSION_DURATION_SECONDS = 60 * 60 * 8;

/* =========================================================
   TYPE
========================================================= */

interface AdminSessionPayload {
  admin: true;

  /*
   * เวลาออก token
   */
  iat: number;

  /*
   * เวลาหมดอายุ
   */
  exp: number;

  /*
   * random session id
   */
  sid: string;
}

/* =========================================================
   SIGN
========================================================= */

function sign(value: string) {
  return crypto
    .createHmac("sha256", SESSION_SECRET!)
    .update(value)
    .digest("base64url");
}

/* =========================================================
   CREATE ADMIN TOKEN
========================================================= */

export function createAdminSession() {
  const now = Math.floor(Date.now() / 1000);

  const payload: AdminSessionPayload = {
    admin: true,

    iat: now,

    exp: now + SESSION_DURATION_SECONDS,

    sid: crypto.randomUUID(),
  };

  /*
   * Encode payload
   */
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );

  /*
   * Sign payload
   */
  const signature = sign(encodedPayload);

  /*
   * token:
   *
   * payload.signature
   */
  return `${encodedPayload}.${signature}`;
}

/* =========================================================
   VERIFY ADMIN TOKEN
========================================================= */

export function verifyAdminSession(token?: string | null) {
  if (!token) {
    return false;
  }

  try {
    const parts = token.split(".");

    if (parts.length !== 2) {
      return false;
    }

    const [encodedPayload, receivedSignature] = parts;

    if (!encodedPayload || !receivedSignature) {
      return false;
    }

    /*
     * สร้าง signature ที่ server คาดหวัง
     */
    const expectedSignature = sign(encodedPayload);

    /*
     * timingSafeEqual
     * ป้องกัน timing attack
     */
    const receivedBuffer = Buffer.from(receivedSignature);

    const expectedBuffer = Buffer.from(expectedSignature);

    if (receivedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    const validSignature = crypto.timingSafeEqual(
      receivedBuffer,
      expectedBuffer,
    );

    if (!validSignature) {
      return false;
    }

    /*
     * Decode payload
     */
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as AdminSessionPayload;

    if (payload.admin !== true) {
      return false;
    }

    if (!payload.exp) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);

    /*
     * Token หมดอายุ
     */
    if (payload.exp <= now) {
      return false;
    }

    return true;
  } catch (error) {
    console.error("VERIFY ADMIN TOKEN ERROR:", error);

    return false;
  }
}

/* =========================================================
   GET BEARER TOKEN
========================================================= */

export function getBearerToken(authorizationHeader: string | null) {
  if (!authorizationHeader) {
    return null;
  }
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }
  return token;
}
