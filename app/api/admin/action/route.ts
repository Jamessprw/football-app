import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";

import { getBearerToken, verifyAdminSession } from "@/lib/admin-session";

/* =========================================================
   ADMIN AUTH
========================================================= */

function isAdmin(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  const token = getBearerToken(authorization);

  return verifyAdminSession(token);
}

/* =========================================================
   RECALCULATE SCORE
========================================================= */

async function recalculateMatchScore(matchId: number) {
  const { data: match, error: matchError } = await supabaseAdmin
    .from("matches")
    .select(
      `
        id,
        home_team_id,
        away_team_id
        `,
    )
    .eq("id", matchId)
    .single();

  if (matchError || !match) {
    throw new Error("ไม่พบ Match");
  }

  const { data: goals, error: goalError } = await supabaseAdmin
    .from("match_events")
    .select(
      `
        id,
        team_id,
        event_type
        `,
    )
    .eq("match_id", matchId)
    .eq("event_type", "GOAL");

  if (goalError) {
    throw new Error(goalError.message);
  }

  const homeScore = (goals || []).filter(
    (event) => Number(event.team_id) === Number(match.home_team_id),
  ).length;

  const awayScore = (goals || []).filter(
    (event) => Number(event.team_id) === Number(match.away_team_id),
  ).length;

  const { error: updateError } = await supabaseAdmin
    .from("matches")
    .update({
      home_score: homeScore,

      away_score: awayScore,
    })
    .eq("id", matchId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return {
    home_score: homeScore,

    away_score: awayScore,
  };
}

/* =========================================================
   SYNC SUSPENSION
========================================================= */

async function syncPlayerSuspension(playerId: number) {
  /* =======================================================
     PLAYER
  ======================================================= */

  const { data: player, error: playerError } = await supabaseAdmin
    .from("players")
    .select(
      `
        id,
        team_id
        `,
    )
    .eq("id", playerId)
    .single();

  if (playerError || !player) {
    console.error("PLAYER ERROR:", playerError);

    return;
  }

  const teamId = Number(player.team_id);

  /* =======================================================
     YELLOW / RED EVENTS
  ======================================================= */

  const { data: events, error: eventError } = await supabaseAdmin
    .from("match_events")
    .select(
      `
        id,
        match_id,
        player_id,
        team_id,
        event_type,
        minute,

        match:match_id(
          id,
          kickoff_time,
          status
        )
      `,
    )
    .eq("player_id", playerId)
    .in("event_type", ["YELLOW_CARD", "RED_CARD"]);

  if (eventError) {
    console.error("EVENT ERROR:", eventError);

    return;
  }

  /* =======================================================
     MATCHES OF THIS TEAM
  ======================================================= */

  const { data: teamMatches, error: teamMatchesError } = await supabaseAdmin
    .from("matches")
    .select(
      `
        id,
        matchday,
        home_team_id,
        away_team_id,
        kickoff_time,
        status
        `,
    )
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order("kickoff_time", {
      ascending: true,
    });

  if (teamMatchesError) {
    console.error("TEAM MATCH ERROR:", teamMatchesError);

    return;
  }

  /* =======================================================
     EXISTING SUSPENSIONS
  ======================================================= */

  const { data: existingSuspensions, error: suspensionError } =
    await supabaseAdmin
      .from("player_suspensions")
      .select("*")
      .eq("player_id", playerId)
      .order("created_at", {
        ascending: true,
      });

  if (suspensionError) {
    console.error("SUSPENSION ERROR:", suspensionError);

    return;
  }

  /* =======================================================
     SORT EVENTS
  ======================================================= */

  const sortedEvents = [...(events || [])]
    .filter((event: any) => event.match)
    .sort((a: any, b: any) => {
      const timeA = new Date(a.match?.kickoff_time || 0).getTime();

      const timeB = new Date(b.match?.kickoff_time || 0).getTime();

      if (timeA !== timeB) {
        return timeA - timeB;
      }

      const minuteA = Number(a.minute || 0);

      const minuteB = Number(b.minute || 0);

      if (minuteA !== minuteB) {
        return minuteA - minuteB;
      }

      return Number(a.id) - Number(b.id);
    });

  /* =======================================================
     YELLOW TRIGGERS
  ======================================================= */

  const yellowEvents = sortedEvents.filter(
    (event: any) => event.event_type === "YELLOW_CARD",
  );

  const yellowTriggers = yellowEvents
    .filter((_event: any, index: number) => (index + 1) % 2 === 0)
    .map((event: any) => ({
      event,

      reason: "YELLOW_ACCUMULATION",
    }));

  /* =======================================================
     RED TRIGGERS
  ======================================================= */

  const redTriggers = sortedEvents
    .filter((event: any) => event.event_type === "RED_CARD")
    .map((event: any) => ({
      event,

      reason: "RED_CARD",
    }));

  /* =======================================================
     ALL TRIGGERS
  ======================================================= */

  const triggers = [...yellowTriggers, ...redTriggers].sort(
    (a: any, b: any) => {
      const timeA = new Date(a.event.match?.kickoff_time || 0).getTime();

      const timeB = new Date(b.event.match?.kickoff_time || 0).getTime();

      if (timeA !== timeB) {
        return timeA - timeB;
      }

      return Number(a.event.id) - Number(b.event.id);
    },
  );

  const triggerKeys = new Set(
    triggers.map((trigger: any) => `${trigger.event.id}-${trigger.reason}`),
  );

  /* =======================================================
     CANCEL INVALID
  ======================================================= */

  for (const suspension of existingSuspensions || []) {
    const key = `${suspension.source_event_id}-${suspension.reason}`;

    if (!triggerKeys.has(key) && suspension.status !== "CANCELLED") {
      await supabaseAdmin
        .from("player_suspensions")
        .update({
          status: "CANCELLED",
        })
        .eq("id", suspension.id);
    }
  }

  /* =======================================================
     USED MATCHES
  ======================================================= */

  const usedMatchIds = new Set<number>();

  for (const suspension of existingSuspensions || []) {
    const key = `${suspension.source_event_id}-${suspension.reason}`;

    if (
      triggerKeys.has(key) &&
      suspension.status !== "CANCELLED" &&
      suspension.suspended_match_id
    ) {
      usedMatchIds.add(Number(suspension.suspended_match_id));
    }
  }

  /* =======================================================
     CREATE SUSPENSIONS
  ======================================================= */

  for (const trigger of triggers) {
    const event = trigger.event;

    const sourceMatch = event.match;

    if (!sourceMatch) {
      continue;
    }

    const sourceTime = new Date(sourceMatch.kickoff_time).getTime();

    const existing = (existingSuspensions || []).find(
      (item) =>
        Number(item.source_event_id) === Number(event.id) &&
        item.reason === trigger.reason,
    );

    /* =====================================================
       EXISTING ACTIVE
    ===================================================== */

    if (existing && existing.status !== "CANCELLED") {
      if (existing.suspended_match_id) {
        const suspendedMatch = (teamMatches || []).find(
          (match) => Number(match.id) === Number(existing.suspended_match_id),
        );

        if (
          suspendedMatch &&
          suspendedMatch.status === "FINISHED" &&
          existing.status === "PENDING"
        ) {
          await supabaseAdmin
            .from("player_suspensions")
            .update({
              status: "SERVED",

              served_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
        }
      }

      continue;
    }

    /* =====================================================
       FIND NEXT TEAM MATCH
    ===================================================== */

    const nextMatch = (teamMatches || []).find((match) => {
      const matchTime = new Date(match.kickoff_time).getTime();

      const teamMatch =
        Number(match.home_team_id) === teamId ||
        Number(match.away_team_id) === teamId;

      return (
        teamMatch &&
        matchTime > sourceTime &&
        !usedMatchIds.has(Number(match.id))
      );
    });

    if (nextMatch) {
      usedMatchIds.add(Number(nextMatch.id));
    }

    const status = nextMatch?.status === "FINISHED" ? "SERVED" : "PENDING";

    const servedAt = status === "SERVED" ? new Date().toISOString() : null;

    /* =====================================================
       RESTORE CANCELLED
    ===================================================== */

    if (existing) {
      await supabaseAdmin
        .from("player_suspensions")
        .update({
          source_match_id: sourceMatch.id,

          suspended_match_id: nextMatch?.id ?? null,

          status,

          served_at: servedAt,
        })
        .eq("id", existing.id);

      continue;
    }

    /* =====================================================
       INSERT
    ===================================================== */

    await supabaseAdmin.from("player_suspensions").insert({
      player_id: playerId,

      source_event_id: event.id,

      source_match_id: sourceMatch.id,

      suspended_match_id: nextMatch?.id ?? null,

      reason: trigger.reason,

      status,

      served_at: servedAt,
    });
  }
}

/* =========================================================
   POST ACTION
========================================================= */

export async function POST(request: NextRequest) {
  /* =======================================================
     VERIFY TOKEN
  ======================================================= */

  if (!isAdmin(request)) {
    return NextResponse.json(
      {
        success: false,

        message: "Admin session ไม่ถูกต้องหรือหมดอายุ",
      },
      {
        status: 401,
      },
    );
  }

  let body: Record<string, any>;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,

        message: "Invalid request",
      },
      {
        status: 400,
      },
    );
  }

  const action = String(body.action || "");

  /* =======================================================
     ADD PLAYER
  ======================================================= */

  if (action === "ADD_PLAYER") {
    const teamId = Number(body.teamId);

    const number = Number(body.number);

    const name = String(body.name || "").trim();

    if (!teamId || Number.isNaN(number) || number < 0 || !name) {
      return NextResponse.json(
        {
          success: false,

          message: "ข้อมูลนักเตะไม่ถูกต้อง",
        },
        {
          status: 400,
        },
      );
    }

    const { data: duplicatePlayer, error: duplicateError } = await supabaseAdmin
      .from("players")
      .select("id,name,number")
      .eq("team_id", teamId)
      .eq("number", number)
      .maybeSingle();

    if (duplicateError) {
      return NextResponse.json(
        {
          success: false,

          message: duplicateError.message,
        },
        {
          status: 400,
        },
      );
    }

    if (duplicatePlayer) {
      return NextResponse.json(
        {
          success: false,

          message: `เบอร์ ${number} ถูกใช้โดย ${duplicatePlayer.name} แล้ว`,
        },
        {
          status: 400,
        },
      );
    }

    const { data: player, error } = await supabaseAdmin
      .from("players")
      .insert({
        team_id: teamId,

        number,

        name,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        {
          success: false,

          message: error.message,
        },
        {
          status: 400,
        },
      );
    }

    return NextResponse.json({
      success: true,

      player,
    });
  }

  /* =======================================================
     UPDATE PLAYER
  ======================================================= */

  if (action === "UPDATE_PLAYER") {
    const playerId = Number(body.playerId);

    const number = Number(body.number);

    const name = String(body.name || "").trim();

    if (!playerId || Number.isNaN(number) || number < 0 || !name) {
      return NextResponse.json(
        {
          success: false,

          message: "ข้อมูลนักเตะไม่ถูกต้อง",
        },
        {
          status: 400,
        },
      );
    }

    const { data: currentPlayer, error: currentPlayerError } =
      await supabaseAdmin
        .from("players")
        .select("id,team_id,name,number")
        .eq("id", playerId)
        .single();

    if (currentPlayerError || !currentPlayer) {
      return NextResponse.json(
        {
          success: false,

          message: "ไม่พบข้อมูลนักเตะ",
        },
        {
          status: 404,
        },
      );
    }

    const { data: duplicatePlayer } = await supabaseAdmin
      .from("players")
      .select("id,name,number")
      .eq("team_id", currentPlayer.team_id)
      .eq("number", number)
      .neq("id", playerId)
      .maybeSingle();

    if (duplicatePlayer) {
      return NextResponse.json(
        {
          success: false,

          message: `เบอร์ ${number} ถูกใช้โดย ${duplicatePlayer.name} แล้ว`,
        },
        {
          status: 400,
        },
      );
    }

    const { data: updatedPlayer, error: updateError } = await supabaseAdmin
      .from("players")
      .update({
        number,

        name,
      })
      .eq("id", playerId)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        {
          success: false,

          message: updateError.message,
        },
        {
          status: 400,
        },
      );
    }

    return NextResponse.json({
      success: true,

      player: updatedPlayer,
    });
  }

  /* =======================================================
     START MATCH
  ======================================================= */

  if (action === "START_MATCH") {
    const matchId = Number(body.matchId);

    const { data: match, error } = await supabaseAdmin
      .from("matches")
      .update({
        status: "LIVE",
      })
      .eq("id", matchId)
      .eq("status", "UPCOMING")
      .select()
      .maybeSingle();

    if (error || !match) {
      return NextResponse.json(
        {
          success: false,

          message: error?.message || "Match ไม่อยู่ในสถานะ UPCOMING",
        },
        {
          status: 400,
        },
      );
    }

    return NextResponse.json({
      success: true,

      match,
    });
  }

  /* =======================================================
     FINISH MATCH
  ======================================================= */

  if (action === "FINISH_MATCH") {
    const matchId = Number(body.matchId);

    let score;

    try {
      score = await recalculateMatchScore(matchId);
    } catch (error) {
      return NextResponse.json(
        {
          success: false,

          message:
            error instanceof Error ? error.message : "ไม่สามารถคำนวณ Score ได้",
        },
        {
          status: 400,
        },
      );
    }

    const { data: match, error } = await supabaseAdmin
      .from("matches")
      .update({
        home_score: score.home_score,

        away_score: score.away_score,

        status: "FINISHED",
      })
      .eq("id", matchId)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        {
          success: false,

          message: error.message,
        },
        {
          status: 400,
        },
      );
    }

    /*
     * ปลดแบนหลัง Match ที่โดนแบนจบ
     */

    await supabaseAdmin
      .from("player_suspensions")
      .update({
        status: "SERVED",

        served_at: new Date().toISOString(),
      })
      .eq("suspended_match_id", matchId)
      .eq("status", "PENDING");

    return NextResponse.json({
      success: true,

      match,

      home_score: score.home_score,

      away_score: score.away_score,
    });
  }

  /* =======================================================
     ADD EVENT
  ======================================================= */

  if (action === "ADD_EVENT") {
    const matchId = Number(body.matchId);

    const teamId = Number(body.teamId);

    const playerId = Number(body.playerId);

    const eventType = String(body.eventType || "");

    const minute =
      body.minute === null || body.minute === undefined || body.minute === ""
        ? null
        : Number(body.minute);

    if (!["GOAL", "YELLOW_CARD", "RED_CARD"].includes(eventType)) {
      return NextResponse.json(
        {
          success: false,

          message: "Event Type ไม่ถูกต้อง",
        },
        {
          status: 400,
        },
      );
    }

    const { data: currentMatch, error: matchError } = await supabaseAdmin
      .from("matches")
      .select("*")
      .eq("id", matchId)
      .single();

    if (matchError || !currentMatch) {
      return NextResponse.json(
        {
          success: false,

          message: "ไม่พบ Match",
        },
        {
          status: 404,
        },
      );
    }

    if (!["LIVE", "FINISHED"].includes(currentMatch.status)) {
      return NextResponse.json(
        {
          success: false,

          message: "Match ยังไม่ได้เริ่มการแข่งขัน",
        },
        {
          status: 400,
        },
      );
    }

    const validTeam =
      Number(currentMatch.home_team_id) === teamId ||
      Number(currentMatch.away_team_id) === teamId;

    if (!validTeam) {
      return NextResponse.json(
        {
          success: false,

          message: "ทีมไม่อยู่ใน Match นี้",
        },
        {
          status: 400,
        },
      );
    }

    const { data: player, error: playerError } = await supabaseAdmin
      .from("players")
      .select("*")
      .eq("id", playerId)
      .single();

    if (playerError || !player) {
      return NextResponse.json(
        {
          success: false,

          message: "ไม่พบนักเตะ",
        },
        {
          status: 404,
        },
      );
    }

    if (Number(player.team_id) !== teamId) {
      return NextResponse.json(
        {
          success: false,

          message: "นักเตะไม่ได้อยู่ในทีมที่เลือก",
        },
        {
          status: 400,
        },
      );
    }

    const { data: insertedEvent, error: insertError } = await supabaseAdmin
      .from("match_events")
      .insert({
        match_id: matchId,

        team_id: teamId,

        player_id: playerId,

        event_type: eventType,

        minute,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        {
          success: false,

          message: insertError.message,
        },
        {
          status: 400,
        },
      );
    }

    let homeScore = Number(currentMatch.home_score ?? 0);

    let awayScore = Number(currentMatch.away_score ?? 0);

    if (eventType === "GOAL") {
      const score = await recalculateMatchScore(matchId);

      homeScore = score.home_score;

      awayScore = score.away_score;
    }

    if (eventType === "YELLOW_CARD" || eventType === "RED_CARD") {
      await syncPlayerSuspension(playerId);
    }

    return NextResponse.json({
      success: true,

      event: {
        ...insertedEvent,

        player,
      },

      home_score: homeScore,

      away_score: awayScore,
    });
  }

  /* =======================================================
     DELETE EVENT
  ======================================================= */

  if (action === "DELETE_EVENT") {
    const eventId = Number(body.eventId);

    const { data: event, error: eventError } = await supabaseAdmin
      .from("match_events")
      .select("*")
      .eq("id", eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json(
        {
          success: false,

          message: "ไม่พบ Event",
        },
        {
          status: 404,
        },
      );
    }

    const { data: currentMatch } = await supabaseAdmin
      .from("matches")
      .select("*")
      .eq("id", event.match_id)
      .single();

    if (!currentMatch || !["LIVE", "FINISHED"].includes(currentMatch.status)) {
      return NextResponse.json(
        {
          success: false,

          message: "Match นี้ไม่สามารถแก้ไข Event ได้",
        },
        {
          status: 400,
        },
      );
    }

    const { error: deleteError } = await supabaseAdmin
      .from("match_events")
      .delete()
      .eq("id", eventId);

    if (deleteError) {
      return NextResponse.json(
        {
          success: false,

          message: deleteError.message,
        },
        {
          status: 400,
        },
      );
    }

    let homeScore = Number(currentMatch.home_score ?? 0);

    let awayScore = Number(currentMatch.away_score ?? 0);

    if (event.event_type === "GOAL") {
      const score = await recalculateMatchScore(event.match_id);

      homeScore = score.home_score;

      awayScore = score.away_score;
    }

    if (event.event_type === "YELLOW_CARD" || event.event_type === "RED_CARD") {
      await syncPlayerSuspension(Number(event.player_id));
    }

    return NextResponse.json({
      success: true,

      deleted_event_id: eventId,

      home_score: homeScore,

      away_score: awayScore,
    });
  }

  /* =======================================================
     UNKNOWN ACTION
  ======================================================= */

  return NextResponse.json(
    {
      success: false,

      message: `Unknown action: ${action}`,
    },
    {
      status: 400,
    },
  );
}
