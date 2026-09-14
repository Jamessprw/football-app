import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createAdminSession } from "@/lib/admin-session";

export async function POST(request: Request) {
  try {
    let body: { code?: string };

    try {
      body = await request.json();
    } catch (error) {
      console.error("LOGIN REQUEST JSON ERROR:", error);

      return NextResponse.json(
        {
          success: false,
          message: "Request ไม่ถูกต้อง",
        },
        {
          status: 400,
        },
      );
    }

    const code = String(body.code || "").trim();

    if (!code) {
      return NextResponse.json(
        {
          success: false,
          message: "กรุณากรอกรหัส Admin",
        },
        {
          status: 400,
        },
      );
    }

    const { data, error } = await supabaseAdmin.rpc("verify_admin_code", {
      input_code: code,
    });

    if (error) {
      console.error("ADMIN VERIFY ERROR:", error);
      return NextResponse.json(
        {
          success: false,
          message: "ไม่สามารถตรวจสอบรหัส Admin ได้",
          detail: error.message,
        },
        {
          status: 500,
        },
      );
    }

    if (data !== true) {
      return NextResponse.json(
        {
          success: false,
          message: "รหัส Admin ไม่ถูกต้อง",
        },
        {
          status: 401,
        },
      );
    }

    let token: string;
    try {
      token = createAdminSession();
    } catch (error) {
      console.error("CREATE ADMIN TOKEN ERROR:", error);
      return NextResponse.json(
        {
          success: false,
          message: "ไม่สามารถสร้าง Admin Session ได้",
        },
        {
          status: 500,
        },
      );
    }

    const response = NextResponse.json({
      success: true,
      token,
      expires_in: 60 * 60 * 8,
    });

    response.cookies.set("football_admin_session", "", {
      httpOnly: true,
      path: "/",
      expires: new Date(0),
      maxAge: 0,
      sameSite: "lax",
    });
    return response;
  } catch (error) {
    console.error("ADMIN LOGIN UNKNOWN ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        message: "เกิดข้อผิดพลาดภายในระบบ",
      },
      {
        status: 500,
      },
    );
  }
}
