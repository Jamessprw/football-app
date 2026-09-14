import { NextRequest, NextResponse } from "next/server";

import { getBearerToken, verifyAdminSession } from "@/lib/admin-session";

/* =========================================================
   CHECK ADMIN SESSION
========================================================= */

export async function GET(request: NextRequest) {
  /*
   * อ่าน:
   *
   * Authorization: Bearer xxxxx
   */

  const authorization = request.headers.get("authorization");

  const token = getBearerToken(authorization);

  const authenticated = verifyAdminSession(token);

  if (!authenticated) {
    return NextResponse.json(
      {
        authenticated: false,
      },
      {
        status: 401,
      },
    );
  }

  return NextResponse.json({
    authenticated: true,
  });
}
