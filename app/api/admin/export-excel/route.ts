import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  getBearerToken,
  verifyAdminSession,
} from "@/lib/admin-session";

export const runtime = "nodejs";

/* =========================================================
   TYPES
========================================================= */

type Team = {
  id: number;
  name: string;
};

type Player = {
  id: number;
  team_id: number;
  number: number;
  name: string;
};

type Match = {
  id: number;
  matchday: number;
  home_team_id: number;
  away_team_id: number;
  kickoff_time: string;
  home_score: number | null;
  away_score: number | null;
  status: "UPCOMING" | "LIVE" | "FINISHED";
};

type MatchEvent = {
  id: number;
  match_id: number;
  team_id: number;
  player_id: number;
  event_type: "GOAL" | "YELLOW_CARD" | "RED_CARD";
  minute: number | null;
};

type Suspension = {
  id: number;
  player_id: number;
  reason: "YELLOW_ACCUMULATION" | "RED_CARD";
  source_event_id: number | null;
  source_match_id: number | null;
  suspended_match_id: number | null;
  status: "PENDING" | "SERVED" | "CANCELLED";
  created_at?: string | null;
};

type Standing = {
  teamId: number;
  teamName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
};

type PlayerSummary = {
  playerId: number;
  number: number;
  playerName: string;
  teamName: string;
  goals: number;
  yellow: number;
  red: number;
  suspensions: number;
};

/* =========================================================
   AUTH
========================================================= */

function isAdmin(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const token = getBearerToken(authorization);

  return verifyAdminSession(token);
}

/* =========================================================
   HELPERS
========================================================= */

function safeNumber(value: number | null | undefined) {
  return typeof value === "number" ? value : 0;
}

function getMatchName(
  match: Match | undefined,
  teamMap: Map<number, Team>,
) {
  if (!match) {
    return "-";
  }

  const home =
    teamMap.get(Number(match.home_team_id))?.name ?? "-";

  const away =
    teamMap.get(Number(match.away_team_id))?.name ?? "-";

  return `${home} vs ${away}`;
}

function getReasonText(reason: string) {
  if (reason === "YELLOW_ACCUMULATION") {
    return "ใบเหลืองสะสมครบ 3 ใบ";
  }

  if (reason === "RED_CARD") {
    return "ใบแดง";
  }

  return reason;
}

function getSuspensionStatus(status: string) {
  if (status === "PENDING") {
    return "รอรับโทษ";
  }

  if (status === "SERVED") {
    return "รับโทษแล้ว";
  }

  if (status === "CANCELLED") {
    return "ยกเลิก";
  }

  return status;
}

function formatDate(dateString?: string | null) {
  if (!dateString) {
    return "-";
  }

  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString("th-TH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  });
}

function formatDateTime(dateString?: string | null) {
  if (!dateString) {
    return "-";
  }

  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("th-TH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Bangkok",
  });
}

/* =========================================================
   STANDINGS
========================================================= */

function calculateStandings(
  teams: Team[],
  matches: Match[],
): Standing[] {
  const table = new Map<number, Standing>();

  teams.forEach((team) => {
    table.set(Number(team.id), {
      teamId: Number(team.id),
      teamName: team.name,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      points: 0,
    });
  });

  const finishedMatches = matches.filter(
    (match) => match.status === "FINISHED",
  );

  finishedMatches.forEach((match) => {
    const home = table.get(Number(match.home_team_id));
    const away = table.get(Number(match.away_team_id));

    if (!home || !away) {
      return;
    }

    const homeScore = safeNumber(match.home_score);
    const awayScore = safeNumber(match.away_score);

    home.played += 1;
    away.played += 1;

    home.gf += homeScore;
    home.ga += awayScore;

    away.gf += awayScore;
    away.ga += homeScore;

    if (homeScore > awayScore) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
    } else if (awayScore > homeScore) {
      away.won += 1;
      away.points += 3;
      home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;

      home.points += 1;
      away.points += 1;
    }
  });

  const standings = Array.from(table.values());

  standings.forEach((team) => {
    team.gd = team.gf - team.ga;
  });

  /*
   * ใช้ Points > GD > GF
   * แล้วใช้ชื่อทีมเป็น fallback
   *
   * ถ้าต้องการ Head-to-Head แบบเดียวกับหน้าเว็บ 100%
   * สามารถเพิ่ม logic H2H ภายหลังได้
   */
  standings.sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }

    if (b.gd !== a.gd) {
      return b.gd - a.gd;
    }

    if (b.gf !== a.gf) {
      return b.gf - a.gf;
    }

    return a.teamName.localeCompare(b.teamName);
  });

  return standings;
}

/* =========================================================
   PLAYER SUMMARY
========================================================= */

function calculatePlayerSummary(
  players: Player[],
  events: MatchEvent[],
  suspensions: Suspension[],
  teamMap: Map<number, Team>,
): PlayerSummary[] {
  const stats = new Map<number, PlayerSummary>();

  players.forEach((player) => {
    stats.set(Number(player.id), {
      playerId: Number(player.id),
      number: Number(player.number),
      playerName: player.name,
      teamName:
        teamMap.get(Number(player.team_id))?.name ?? "-",
      goals: 0,
      yellow: 0,
      red: 0,
      suspensions: 0,
    });
  });

  events.forEach((event) => {
    const player = stats.get(Number(event.player_id));

    if (!player) {
      return;
    }

    if (event.event_type === "GOAL") {
      player.goals += 1;
    }

    if (event.event_type === "YELLOW_CARD") {
      player.yellow += 1;
    }

    if (event.event_type === "RED_CARD") {
      player.red += 1;
    }
  });

  suspensions.forEach((suspension) => {
    if (suspension.status === "CANCELLED") {
      return;
    }

    const player = stats.get(Number(suspension.player_id));

    if (player) {
      player.suspensions += 1;
    }
  });

  return Array.from(stats.values()).sort((a, b) => {
    if (b.goals !== a.goals) {
      return b.goals - a.goals;
    }

    if (b.yellow !== a.yellow) {
      return b.yellow - a.yellow;
    }

    return a.playerName.localeCompare(b.playerName);
  });
}

/* =========================================================
   EXCEL STYLES
========================================================= */

const COLORS = {
  dark: "0F172A",
  dark2: "1E293B",
  green: "22C55E",
  greenDark: "166534",
  orange: "F97316",
  yellow: "FACC15",
  red: "EF4444",
  blue: "3B82F6",
  white: "FFFFFF",
  light: "F8FAFC",
  gray: "64748B",
  border: "CBD5E1",
};

function styleTitle(
  sheet: ExcelJS.Worksheet,
  title: string,
  subtitle: string,
  endColumn: number,
) {
  sheet.mergeCells(1, 1, 1, endColumn);

  const titleCell = sheet.getCell(1, 1);

  titleCell.value = title;

  titleCell.font = {
    bold: true,
    size: 20,
    color: {
      argb: COLORS.white,
    },
  };

  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: {
      argb: COLORS.dark,
    },
  };

  titleCell.alignment = {
    vertical: "middle",
    horizontal: "left",
  };

  sheet.getRow(1).height = 34;

  sheet.mergeCells(2, 1, 2, endColumn);

  const subtitleCell = sheet.getCell(2, 1);

  subtitleCell.value = subtitle;

  subtitleCell.font = {
    size: 10,
    color: {
      argb: "CBD5E1",
    },
  };

  subtitleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: {
      argb: COLORS.dark,
    },
  };

  subtitleCell.alignment = {
    vertical: "middle",
  };

  sheet.getRow(2).height = 22;
}

function styleHeader(
  row: ExcelJS.Row,
  color = COLORS.greenDark,
) {
  row.eachCell((cell) => {
    cell.font = {
      bold: true,
      color: {
        argb: COLORS.white,
      },
    };

    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: color,
      },
    };

    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };

    cell.border = {
      top: {
        style: "thin",
        color: { argb: COLORS.border },
      },
      bottom: {
        style: "thin",
        color: { argb: COLORS.border },
      },
      left: {
        style: "thin",
        color: { argb: COLORS.border },
      },
      right: {
        style: "thin",
        color: { argb: COLORS.border },
      },
    };
  });

  row.height = 28;
}

function styleBody(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  columns: number,
) {
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber++) {
    const row = sheet.getRow(rowNumber);

    for (let column = 1; column <= columns; column++) {
      const cell = row.getCell(column);

      cell.alignment = {
        vertical: "middle",
        wrapText: true,
      };

      cell.border = {
        bottom: {
          style: "hair",
          color: {
            argb: "E2E8F0",
          },
        },
      };

      if (rowNumber % 2 === 0) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: COLORS.light,
          },
        };
      }
    }
  }
}

function setupSheet(
  sheet: ExcelJS.Worksheet,
  widths: number[],
) {
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  sheet.views = [
    {
      state: "frozen",
      ySplit: 4,
    },
  ];

  sheet.properties.defaultRowHeight = 20;
}

/* =========================================================
   GET
========================================================= */

export async function GET(request: NextRequest) {
  try {
    /* =====================================================
       AUTH
    ===================================================== */

    const authorized = await isAdmin(request);

    if (!authorized) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    /* =====================================================
       FETCH DATA
    ===================================================== */

    const [
      teamsResult,
      playersResult,
      matchesResult,
      eventsResult,
      suspensionsResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("teams")
        .select("id,name")
        .order("id", {
          ascending: true,
        }),

      supabaseAdmin
        .from("players")
        .select("id,team_id,number,name")
        .order("team_id", {
          ascending: true,
        })
        .order("number", {
          ascending: true,
        }),

      supabaseAdmin
        .from("matches")
        .select(
          `
            id,
            matchday,
            home_team_id,
            away_team_id,
            kickoff_time,
            home_score,
            away_score,
            status
          `,
        )
        .order("kickoff_time", {
          ascending: true,
        }),

      supabaseAdmin
        .from("match_events")
        .select(
          `
            id,
            match_id,
            team_id,
            player_id,
            event_type,
            minute
          `,
        )
        .order("id", {
          ascending: true,
        }),

      supabaseAdmin
        .from("player_suspensions")
        .select(
          `
            id,
            player_id,
            reason,
            source_event_id,
            source_match_id,
            suspended_match_id,
            status,
            created_at
          `,
        )
        .order("created_at", {
          ascending: true,
        }),
    ]);

    if (teamsResult.error) {
      throw new Error(teamsResult.error.message);
    }

    if (playersResult.error) {
      throw new Error(playersResult.error.message);
    }

    if (matchesResult.error) {
      throw new Error(matchesResult.error.message);
    }

    if (eventsResult.error) {
      throw new Error(eventsResult.error.message);
    }

    if (suspensionsResult.error) {
      throw new Error(suspensionsResult.error.message);
    }

    const teams = (teamsResult.data || []) as Team[];
    const players = (playersResult.data || []) as Player[];
    const matches = (matchesResult.data || []) as Match[];
    const events = (eventsResult.data || []) as MatchEvent[];

    const suspensions = (suspensionsResult.data ||
      []) as Suspension[];

    /* =====================================================
       MAP
    ===================================================== */

    const teamMap = new Map<number, Team>(
      teams.map((team) => [Number(team.id), team]),
    );

    const playerMap = new Map<number, Player>(
      players.map((player) => [
        Number(player.id),
        player,
      ]),
    );

    const matchMap = new Map<number, Match>(
      matches.map((match) => [
        Number(match.id),
        match,
      ]),
    );

    /* =====================================================
       CALCULATIONS
    ===================================================== */

    const standings = calculateStandings(
      teams,
      matches,
    );

    const playerSummary =
      calculatePlayerSummary(
        players,
        events,
        suspensions,
        teamMap,
      );

    const finishedMatches = matches.filter(
      (match) => match.status === "FINISHED",
    );

    const liveMatches = matches.filter(
      (match) => match.status === "LIVE",
    );

    const upcomingMatches = matches.filter(
      (match) => match.status === "UPCOMING",
    );

    const totalGoals = events.filter(
      (event) => event.event_type === "GOAL",
    ).length;

    const totalYellow = events.filter(
      (event) =>
        event.event_type === "YELLOW_CARD",
    ).length;

    const totalRed = events.filter(
      (event) =>
        event.event_type === "RED_CARD",
    ).length;

    const totalSuspensions = suspensions.filter(
      (suspension) =>
        suspension.status !== "CANCELLED",
    ).length;

    /* =====================================================
       WORKBOOK
    ===================================================== */

    const workbook = new ExcelJS.Workbook();

    workbook.creator = "NMB Football League";
    workbook.company = "NMB Football League";
    workbook.subject = "Football League Report";
    workbook.title = "NMB Football League Report";

    workbook.created = new Date();
    workbook.modified = new Date();

    /* =====================================================
       1. SUMMARY
    ===================================================== */

    const summary =
      workbook.addWorksheet("SUMMARY", {
        views: [
          {
            showGridLines: false,
          },
        ],
      });

    summary.columns = Array.from(
      { length: 10 },
      () => ({
        width: 15,
      }),
    );

    summary.mergeCells("A1:J1");
    summary.getCell("A1").value =
      "NMB FOOTBALL LEAGUE";

    summary.getCell("A1").font = {
      bold: true,
      size: 24,
      color: {
        argb: COLORS.white,
      },
    };

    summary.getCell("A1").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: COLORS.dark,
      },
    };

    summary.getCell("A1").alignment = {
      vertical: "middle",
    };

    summary.getRow(1).height = 42;

    summary.mergeCells("A2:J2");

    summary.getCell("A2").value =
      "TOURNAMENT SUMMARY REPORT";

    summary.getCell("A2").font = {
      bold: true,
      size: 12,
      color: {
        argb: "CBD5E1",
      },
    };

    summary.getCell("A2").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: COLORS.dark,
      },
    };

    summary.mergeCells("A3:J3");

    summary.getCell("A3").value =
      `Generated: ${formatDateTime(new Date().toISOString())}`;

    summary.getCell("A3").font = {
      size: 9,
      color: {
        argb: COLORS.gray,
      },
    };

    /*
     * KPI CARDS
     */

    const kpis = [
      {
        label: "TOTAL MATCHES",
        value: matches.length,
      },
      {
        label: "FINISHED",
        value: finishedMatches.length,
      },
      {
        label: "LIVE",
        value: liveMatches.length,
      },
      {
        label: "UPCOMING",
        value: upcomingMatches.length,
      },
      {
        label: "GOALS",
        value: totalGoals,
      },
      {
        label: "YELLOW",
        value: totalYellow,
      },
      {
        label: "RED",
        value: totalRed,
      },
      {
        label: "SUSPENSIONS",
        value: totalSuspensions,
      },
    ];

    kpis.forEach((kpi, index) => {
      const startColumn =
        (index % 4) * 2 + 1;

      const row =
        index < 4 ? 5 : 8;

      summary.mergeCells(
        row,
        startColumn,
        row,
        startColumn + 1,
      );

      const labelCell =
        summary.getCell(
          row,
          startColumn,
        );

      labelCell.value = kpi.label;

      labelCell.font = {
        bold: true,
        size: 9,
        color: {
          argb: COLORS.gray,
        },
      };

      labelCell.alignment = {
        horizontal: "center",
      };

      summary.mergeCells(
        row + 1,
        startColumn,
        row + 1,
        startColumn + 1,
      );

      const valueCell =
        summary.getCell(
          row + 1,
          startColumn,
        );

      valueCell.value = kpi.value;

      valueCell.font = {
        bold: true,
        size: 20,
        color: {
          argb: COLORS.dark,
        },
      };

      valueCell.alignment = {
        horizontal: "center",
        vertical: "middle",
      };

      valueCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
          argb: "ECFDF5",
        },
      };
    });

    /*
     * CURRENT STANDINGS
     */

    summary.mergeCells("A12:J12");

    summary.getCell("A12").value =
      "CURRENT STANDINGS";

    summary.getCell("A12").font = {
      bold: true,
      size: 14,
      color: {
        argb: COLORS.white,
      },
    };

    summary.getCell("A12").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: COLORS.greenDark,
      },
    };

    const summaryHeader =
      summary.getRow(13);

    [
      "#",
      "TEAM",
      "P",
      "W",
      "D",
      "L",
      "GF",
      "GA",
      "GD",
      "PTS",
    ].forEach((value, index) => {
      summaryHeader.getCell(
        index + 1,
      ).value = value;
    });

    styleHeader(
      summaryHeader,
      COLORS.dark2,
    );

    standings.forEach(
      (team, index) => {
        const row = summary.addRow([
          index + 1,
          team.teamName,
          team.played,
          team.won,
          team.drawn,
          team.lost,
          team.gf,
          team.ga,
          team.gd,
          team.points,
        ]);

        if (index === 0) {
          row.font = {
            bold: true,
          };

          row.getCell(1).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: {
              argb: "FEF3C7",
            },
          };
        }
      },
    );

    styleBody(
      summary,
      14,
      13 + standings.length,
      10,
    );

    const scorerStart =
      15 + standings.length;

    summary.mergeCells(
      scorerStart,
      1,
      scorerStart,
      5,
    );

    summary.getCell(
      scorerStart,
      1,
    ).value = "TOP SCORERS";

    summary.getCell(
      scorerStart,
      1,
    ).font = {
      bold: true,
      color: {
        argb: COLORS.white,
      },
    };

    summary.getCell(
      scorerStart,
      1,
    ).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: COLORS.blue,
      },
    };

    summary.mergeCells(
      scorerStart,
      6,
      scorerStart,
      10,
    );

    summary.getCell(
      scorerStart,
      6,
    ).value = "DISCIPLINE";

    summary.getCell(
      scorerStart,
      6,
    ).font = {
      bold: true,
      color: {
        argb: COLORS.white,
      },
    };

    summary.getCell(
      scorerStart,
      6,
    ).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: COLORS.orange,
      },
    };

    const topScorers = playerSummary
      .filter((player) => player.goals > 0)
      .slice(0, 10);

    const disciplinePlayers =
      [...playerSummary]
        .filter(
          (player) =>
            player.yellow > 0 ||
            player.red > 0 ||
            player.suspensions > 0,
        )
        .sort((a, b) => {
          if (b.red !== a.red) {
            return b.red - a.red;
          }

          if (b.yellow !== a.yellow) {
            return b.yellow - a.yellow;
          }

          return (
            b.suspensions -
            a.suspensions
          );
        })
        .slice(0, 10);

    const detailHeaderRow =
      summary.getRow(
        scorerStart + 1,
      );

    [
      "#",
      "PLAYER",
      "TEAM",
      "GOALS",
      "",
      "PLAYER",
      "TEAM",
      "Y",
      "R",
      "BAN",
    ].forEach((value, index) => {
      detailHeaderRow.getCell(
        index + 1,
      ).value = value;
    });

    styleHeader(
      detailHeaderRow,
      COLORS.dark2,
    );

    const detailLength = Math.max(
      topScorers.length,
      disciplinePlayers.length,
      1,
    );

    for (
      let index = 0;
      index < detailLength;
      index++
    ) {
      const scorer =
        topScorers[index];

      const discipline =
        disciplinePlayers[index];

      const row =
        summary.getRow(
          scorerStart + 2 + index,
        );

      if (scorer) {
        row.getCell(1).value =
          index + 1;

        row.getCell(2).value =
          `#${scorer.number} ${scorer.playerName}`;

        row.getCell(3).value =
          scorer.teamName;

        row.getCell(4).value =
          scorer.goals;
      }

      if (discipline) {
        row.getCell(6).value =
          `#${discipline.number} ${discipline.playerName}`;

        row.getCell(7).value =
          discipline.teamName;

        row.getCell(8).value =
          discipline.yellow;

        row.getCell(9).value =
          discipline.red;

        row.getCell(10).value =
          discipline.suspensions;
      }
    }

    summary.views = [
      {
        showGridLines: false,
        state: "frozen",
        ySplit: 3,
      },
    ];

    /* =====================================================
       2. STANDINGS
    ===================================================== */

    const standingSheet =
      workbook.addWorksheet(
        "STANDINGS",
      );

    setupSheet(standingSheet, [
      8,
      28,
      10,
      10,
      10,
      10,
      10,
      10,
      10,
      12,
    ]);

    styleTitle(
      standingSheet,
      "LEAGUE STANDINGS",
      "ตารางคะแนนปัจจุบัน",
      10,
    );

    const standingHeader =
      standingSheet.getRow(4);

    [
      "RANK",
      "TEAM",
      "P",
      "W",
      "D",
      "L",
      "GF",
      "GA",
      "GD",
      "PTS",
    ].forEach((value, index) => {
      standingHeader.getCell(
        index + 1,
      ).value = value;
    });

    styleHeader(standingHeader);

    standings.forEach(
      (team, index) => {
        standingSheet.addRow([
          index + 1,
          team.teamName,
          team.played,
          team.won,
          team.drawn,
          team.lost,
          team.gf,
          team.ga,
          team.gd,
          team.points,
        ]);
      },
    );

    styleBody(
      standingSheet,
      5,
      4 + standings.length,
      10,
    );

    standingSheet.autoFilter = {
      from: "A4",
      to: "J4",
    };

    /* =====================================================
       3. MATCH HISTORY
    ===================================================== */

    const matchSheet =
      workbook.addWorksheet(
        "MATCH HISTORY",
      );

    setupSheet(matchSheet, [
      10,
      14,
      20,
      28,
      10,
      10,
      28,
      16,
    ]);

    styleTitle(
      matchSheet,
      "MATCH HISTORY",
      "ประวัติการแข่งขันทั้งหมด",
      8,
    );

    const matchHeader =
      matchSheet.getRow(4);

    [
      "MATCHDAY",
      "DATE",
      "TIME",
      "HOME TEAM",
      "HOME",
      "AWAY",
      "AWAY TEAM",
      "STATUS",
    ].forEach((value, index) => {
      matchHeader.getCell(
        index + 1,
      ).value = value;
    });

    styleHeader(matchHeader);

    matches.forEach((match) => {
      const kickoff =
        new Date(
          match.kickoff_time,
        );

      matchSheet.addRow([
        match.matchday,
        formatDate(
          match.kickoff_time,
        ),
        kickoff.toLocaleTimeString(
          "th-TH",
          {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone:
              "Asia/Bangkok",
          },
        ),
        teamMap.get(
          Number(
            match.home_team_id,
          ),
        )?.name ?? "-",
        match.home_score ?? "-",
        match.away_score ?? "-",
        teamMap.get(
          Number(
            match.away_team_id,
          ),
        )?.name ?? "-",
        match.status,
      ]);
    });

    styleBody(
      matchSheet,
      5,
      4 + matches.length,
      8,
    );

    matchSheet.autoFilter = {
      from: "A4",
      to: "H4",
    };

    /* =====================================================
       4. MATCH PLAYERS
    ===================================================== */

    const matchPlayerSheet =
      workbook.addWorksheet(
        "MATCH PLAYERS",
      );

    setupSheet(matchPlayerSheet, [
      10,
      14,
      28,
      28,
      28,
      10,
      24,
      10,
      10,
      10,
      14,
    ]);

    styleTitle(
      matchPlayerSheet,
      "PLAYER MATCH HISTORY",
      "สรุปผลงานนักเตะแต่ละคนในแต่ละ Match",
      11,
    );

    const matchPlayerHeader =
      matchPlayerSheet.getRow(4);

    [
      "MATCHDAY",
      "DATE",
      "MATCH",
      "TEAM",
      "PLAYER",
      "NO.",
      "EVENTS",
      "GOALS",
      "YELLOW",
      "RED",
      "MATCH STATUS",
    ].forEach((value, index) => {
      matchPlayerHeader.getCell(
        index + 1,
      ).value = value;
    });

    styleHeader(matchPlayerHeader);

    /*
     * สร้าง Player Match History จาก Event
     *
     * หมายเหตุ:
     * ระบบปัจจุบันไม่มี Lineup/Appearance table
     * ดังนั้น Sheet นี้สรุปเฉพาะนักเตะที่มี Event
     * ใน Match นั้น เช่น Goal / Yellow / Red
     */

    const playerMatchMap =
      new Map<
        string,
        {
          match: Match;
          player: Player;
          team: Team | undefined;
          goals: number;
          yellow: number;
          red: number;
          eventTexts: string[];
        }
      >();

    events.forEach((event) => {
      const match =
        matchMap.get(
          Number(event.match_id),
        );

      const player =
        playerMap.get(
          Number(event.player_id),
        );

      if (!match || !player) {
        return;
      }

      const key =
        `${match.id}-${player.id}`;

      if (!playerMatchMap.has(key)) {
        playerMatchMap.set(key, {
          match,
          player,
          team: teamMap.get(
            Number(event.team_id),
          ),
          goals: 0,
          yellow: 0,
          red: 0,
          eventTexts: [],
        });
      }

      const item =
        playerMatchMap.get(key)!;

      const minuteText =
        event.minute === null ||
        event.minute === undefined
          ? ""
          : ` ${event.minute}'`;

      if (
        event.event_type ===
        "GOAL"
      ) {
        item.goals += 1;

        item.eventTexts.push(
          `GOAL${minuteText}`,
        );
      }

      if (
        event.event_type ===
        "YELLOW_CARD"
      ) {
        item.yellow += 1;

        item.eventTexts.push(
          `YELLOW${minuteText}`,
        );
      }

      if (
        event.event_type ===
        "RED_CARD"
      ) {
        item.red += 1;

        item.eventTexts.push(
          `RED${minuteText}`,
        );
      }
    });

    const playerMatchRows =
      Array.from(
        playerMatchMap.values(),
      ).sort((a, b) => {
        const dateCompare =
          new Date(
            a.match.kickoff_time,
          ).getTime() -
          new Date(
            b.match.kickoff_time,
          ).getTime();

        if (dateCompare !== 0) {
          return dateCompare;
        }

        if (
          a.team?.name !==
          b.team?.name
        ) {
          return String(
            a.team?.name ?? "",
          ).localeCompare(
            String(
              b.team?.name ?? "",
            ),
          );
        }

        return (
          Number(a.player.number) -
          Number(b.player.number)
        );
      });

    playerMatchRows.forEach(
      (item) => {
        matchPlayerSheet.addRow([
          item.match.matchday,
          formatDate(
            item.match.kickoff_time,
          ),
          getMatchName(
            item.match,
            teamMap,
          ),
          item.team?.name ?? "-",
          item.player.name,
          item.player.number,
          item.eventTexts.join(", "),
          item.goals,
          item.yellow,
          item.red,
          item.match.status,
        ]);
      },
    );

    styleBody(
      matchPlayerSheet,
      5,
      4 + playerMatchRows.length,
      11,
    );

    matchPlayerSheet.autoFilter = {
      from: "A4",
      to: "K4",
    };

    /* =====================================================
       5. PLAYER SUMMARY
    ===================================================== */

    const playerSheet =
      workbook.addWorksheet(
        "PLAYER SUMMARY",
      );

    setupSheet(playerSheet, [
      8,
      12,
      28,
      28,
      12,
      12,
      12,
      14,
    ]);

    styleTitle(
      playerSheet,
      "PLAYER SUMMARY",
      "สรุปสถิตินักเตะทั้งหมด",
      8,
    );

    const playerHeader =
      playerSheet.getRow(4);

    [
      "#",
      "NO.",
      "PLAYER",
      "TEAM",
      "GOALS",
      "YELLOW",
      "RED",
      "SUSPENSIONS",
    ].forEach((value, index) => {
      playerHeader.getCell(
        index + 1,
      ).value = value;
    });

    styleHeader(playerHeader);

    playerSummary.forEach(
      (player, index) => {
        playerSheet.addRow([
          index + 1,
          player.number,
          player.playerName,
          player.teamName,
          player.goals,
          player.yellow,
          player.red,
          player.suspensions,
        ]);
      },
    );

    styleBody(
      playerSheet,
      5,
      4 + playerSummary.length,
      8,
    );

    playerSheet.autoFilter = {
      from: "A4",
      to: "H4",
    };

    /* =====================================================
       6. DISCIPLINE
    ===================================================== */

    const disciplineSheet =
      workbook.addWorksheet(
        "DISCIPLINE",
      );

    setupSheet(disciplineSheet, [
      10,
      14,
      28,
      28,
      12,
      28,
      18,
      12,
    ]);

    styleTitle(
      disciplineSheet,
      "DISCIPLINARY HISTORY",
      "ประวัติใบเหลือง / ใบแดง",
      8,
    );

    const disciplineHeader =
      disciplineSheet.getRow(4);

    [
      "MATCHDAY",
      "DATE",
      "MATCH",
      "TEAM",
      "NO.",
      "PLAYER",
      "CARD",
      "MINUTE",
    ].forEach((value, index) => {
      disciplineHeader.getCell(
        index + 1,
      ).value = value;
    });

    styleHeader(
      disciplineHeader,
      COLORS.orange,
    );

    const cardEvents = events
      .filter(
        (event) =>
          event.event_type ===
            "YELLOW_CARD" ||
          event.event_type ===
            "RED_CARD",
      )
      .sort((a, b) => {
        const matchA =
          matchMap.get(
            Number(a.match_id),
          );

        const matchB =
          matchMap.get(
            Number(b.match_id),
          );

        return (
          new Date(
            matchA?.kickoff_time ??
              0,
          ).getTime() -
          new Date(
            matchB?.kickoff_time ??
              0,
          ).getTime()
        );
      });

    cardEvents.forEach(
      (event) => {
        const match =
          matchMap.get(
            Number(event.match_id),
          );

        const player =
          playerMap.get(
            Number(event.player_id),
          );

        disciplineSheet.addRow([
          match?.matchday ?? "-",
          formatDate(
            match?.kickoff_time,
          ),
          getMatchName(
            match,
            teamMap,
          ),
          teamMap.get(
            Number(event.team_id),
          )?.name ?? "-",
          player?.number ?? "-",
          player?.name ?? "-",
          event.event_type ===
          "YELLOW_CARD"
            ? "YELLOW"
            : "RED",
          event.minute === null ||
          event.minute === undefined
            ? "-"
            : `${event.minute}'`,
        ]);
      },
    );

    styleBody(
      disciplineSheet,
      5,
      4 + cardEvents.length,
      8,
    );

    /*
     * สี Yellow / Red
     */

    for (
      let rowNumber = 5;
      rowNumber <
      5 + cardEvents.length;
      rowNumber++
    ) {
      const cell =
        disciplineSheet.getCell(
          rowNumber,
          7,
        );

      if (
        cell.value === "YELLOW"
      ) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: "FEF08A",
          },
        };

        cell.font = {
          bold: true,
          color: {
            argb: "854D0E",
          },
        };
      }

      if (cell.value === "RED") {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: "FECACA",
          },
        };

        cell.font = {
          bold: true,
          color: {
            argb: "991B1B",
          },
        };
      }
    }

    disciplineSheet.autoFilter = {
      from: "A4",
      to: "H4",
    };

    /* =====================================================
       7. SUSPENSIONS
    ===================================================== */

    const suspensionSheet =
      workbook.addWorksheet(
        "SUSPENSIONS",
      );

    setupSheet(suspensionSheet, [
      12,
      28,
      28,
      26,
      12,
      32,
      12,
      32,
      18,
      18,
    ]);

    styleTitle(
      suspensionSheet,
      "SUSPENSION HISTORY",
      "ประวัติโทษแบนของนักเตะ",
      10,
    );

    const suspensionHeader =
      suspensionSheet.getRow(4);

    [
      "NO.",
      "PLAYER",
      "TEAM",
      "REASON",
      "SOURCE MD",
      "SOURCE MATCH",
      "BAN MD",
      "SUSPENDED MATCH",
      "STATUS",
      "CREATED",
    ].forEach((value, index) => {
      suspensionHeader.getCell(
        index + 1,
      ).value = value;
    });

    styleHeader(
      suspensionHeader,
      COLORS.red,
    );

    suspensions.forEach(
      (suspension) => {
        const player =
          playerMap.get(
            Number(
              suspension.player_id,
            ),
          );

        const team = player
          ? teamMap.get(
              Number(
                player.team_id,
              ),
            )
          : undefined;

        const sourceMatch =
          suspension.source_match_id
            ? matchMap.get(
                Number(
                  suspension.source_match_id,
                ),
              )
            : undefined;

        const suspendedMatch =
          suspension.suspended_match_id
            ? matchMap.get(
                Number(
                  suspension.suspended_match_id,
                ),
              )
            : undefined;

        suspensionSheet.addRow([
          player?.number ?? "-",
          player?.name ?? "-",
          team?.name ?? "-",
          getReasonText(
            suspension.reason,
          ),
          sourceMatch?.matchday ??
            "-",
          getMatchName(
            sourceMatch,
            teamMap,
          ),
          suspendedMatch?.matchday ??
            "-",
          getMatchName(
            suspendedMatch,
            teamMap,
          ),
          getSuspensionStatus(
            suspension.status,
          ),
          formatDate(
            suspension.created_at,
          ),
        ]);
      },
    );

    styleBody(
      suspensionSheet,
      5,
      4 + suspensions.length,
      10,
    );

    /*
     * Status color
     */

    for (
      let rowNumber = 5;
      rowNumber <
      5 + suspensions.length;
      rowNumber++
    ) {
      const statusCell =
        suspensionSheet.getCell(
          rowNumber,
          9,
        );

      if (
        statusCell.value ===
        "รอรับโทษ"
      ) {
        statusCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: "FEF3C7",
          },
        };

        statusCell.font = {
          bold: true,
          color: {
            argb: "92400E",
          },
        };
      }

      if (
        statusCell.value ===
        "รับโทษแล้ว"
      ) {
        statusCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: "DCFCE7",
          },
        };

        statusCell.font = {
          bold: true,
          color: {
            argb: "166534",
          },
        };
      }

      if (
        statusCell.value === "ยกเลิก"
      ) {
        statusCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: "F1F5F9",
          },
        };

        statusCell.font = {
          color: {
            argb: "64748B",
          },
        };
      }
    }

    suspensionSheet.autoFilter = {
      from: "A4",
      to: "J4",
    };

    /* =====================================================
       GENERATE FILE
    ===================================================== */

    const buffer =
      await workbook.xlsx.writeBuffer();

    const date =
      new Date()
        .toISOString()
        .slice(0, 10);

    const fileName =
      `NMB_Football_League_Report_${date}.xlsx`;

    return new NextResponse(
      Buffer.from(buffer),
      {
        status: 200,

        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

          "Content-Disposition":
            `attachment; filename="${fileName}"`,

          "Cache-Control":
            "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "EXPORT EXCEL ERROR:",
      error,
    );

    return NextResponse.json(
      {
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "ไม่สามารถสร้าง Excel ได้",
      },
      {
        status: 500,
      },
    );
  }
}