"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import LiveMatchNotification from "@/components/LiveMatchNotification";
import ThemeToggle from "@/components/ThemeToggle";
import PlayerAvatar from "@/components/PlayerAvatar";

/* =========================================================
   TYPES
========================================================= */

interface Team {
  id: number;
  name: string;
  logo_url?: string | null;
}

interface Player {
  id: number;
  team_id: number;
  number: number;
  name: string;
  team?: Team | null;
  image_url: string | null;
}

interface MatchEvent {
  id: number;
  match_id: number;
  team_id: number;
  player_id: number;
  event_type: "GOAL" | "YELLOW_CARD" | "RED_CARD";
  minute: number | null;
  player?: Player | null;
}

interface Match {
  id: number;
  matchday: number;
  home_team_id: number;
  away_team_id: number;
  kickoff_time: string;
  home_score: number | null;
  away_score: number | null;
  status: "UPCOMING" | "LIVE" | "FINISHED";

  home?: Team | null;
  away?: Team | null;

  match_events?: MatchEvent[];
}

interface StandingTeam extends Team {
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
}

interface PlayerStat extends Player {
  goals: number;
  yellowCards: number;
  redCards: number;
}

interface Suspension {
  id: number;
  player_id: number;
  source_event_id: number;
  source_match_id: number;
  suspended_match_id: number | null;

  reason: "YELLOW_ACCUMULATION" | "RED_CARD";
  status: "PENDING" | "SERVED" | "CANCELLED";

  created_at: string;
  served_at: string | null;

  player?: Player | null;
  source_match?: Match | null;
  suspended_match?: Match | null;
}

/* =========================================================
   HOME
========================================================= */

export default function Home() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [standings, setStandings] = useState<StandingTeam[]>([]);
  const [playerStats, setPlayerStats] = useState<PlayerStat[]>([]);
  const [suspensions, setSuspensions] = useState<Suspension[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<"matches" | "standings" | "stats">(
    "matches",
  );

  const [matchFilter, setMatchFilter] = useState<"ALL" | "TODAY" | "FINISH">(
    "ALL",
  );

  const [expandedMatchId, setExpandedMatchId] = useState<number | null>(null);

  /* =========================================================
     INITIAL LOAD + REALTIME
  ========================================================= */

  useEffect(() => {
    fetchData();

    const channel = supabase
      .channel("football-live-updates")

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "matches",
        },
        () => {
          fetchData();
        },
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "match_events",
        },
        () => {
          fetchData();
        },
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players",
        },
        () => {
          fetchData();
        },
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "player_suspensions",
        },
        () => {
          fetchData();
        },
      )

      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  /* =========================================================
     FETCH DATA
  ========================================================= */

  async function fetchData() {
    setLoading(true);

    try {
      const { data: matchData, error: matchError } = await supabase
        .from("matches")
        .select(
          `
          *,
          home:home_team_id(*),
          away:away_team_id(*),
          match_events(
            *,
            player:player_id(*)
          )
        `,
        )
        .order("kickoff_time", {
          ascending: true,
        });

      if (matchError) {
        console.error("MATCH ERROR:", matchError);
      }

      const { data: teamData, error: teamError } = await supabase
        .from("teams")
        .select("*");

      if (teamError) {
        console.error("TEAM ERROR:", teamError);
      }

      const { data: playerData, error: playerError } = await supabase.from(
        "players",
      ).select(`
            *,
            team:team_id(*)
          `);

      if (playerError) {
        console.error("PLAYER ERROR:", playerError);
      }

      const { data: suspensionData, error: suspensionError } = await supabase
        .from("player_suspensions")
        .select(
          `
          *,
          player:player_id(
            *,
            team:team_id(*)
          ),
          source_match:source_match_id(
            *,
            home:home_team_id(*),
            away:away_team_id(*)
          ),
          suspended_match:suspended_match_id(
            *,
            home:home_team_id(*),
            away:away_team_id(*)
          )
        `,
        )
        .order("created_at", {
          ascending: false,
        });

      if (suspensionError) {
        console.error("SUSPENSION ERROR:", suspensionError);
      }

      const typedMatches = (matchData as Match[]) || [];

      const typedTeams = (teamData as Team[]) || [];

      const typedPlayers = (playerData as Player[]) || [];

      const typedSuspensions = (suspensionData as Suspension[]) || [];

      setMatches(typedMatches);

      calculateStandings(typedTeams, typedMatches);

      calculatePlayerStats(typedPlayers, typedMatches);

      setSuspensions(typedSuspensions);
    } catch (error) {
      console.error("FETCH ERROR:", error);
    } finally {
      setLoading(false);
    }
  }

  /* =========================================================
     PLAYER STATS
  ========================================================= */

  function calculatePlayerStats(players: Player[], matchList: Match[]) {
    const stats: Record<number, PlayerStat> = {};

    players.forEach((player) => {
      stats[player.id] = {
        ...player,
        goals: 0,
        yellowCards: 0,
        redCards: 0,
      };
    });

    matchList.forEach((match) => {
      const events = match.match_events || [];

      events.forEach((event) => {
        const player = stats[event.player_id];

        if (!player) {
          return;
        }

        if (event.event_type === "GOAL") {
          player.goals += 1;
        }

        if (event.event_type === "YELLOW_CARD") {
          player.yellowCards += 1;
        }

        if (event.event_type === "RED_CARD") {
          player.redCards += 1;
        }
      });
    });

    setPlayerStats(Object.values(stats));
  }

  /* =========================================================
     STANDINGS
  ========================================================= */

  function calculateStandings(teams: Team[], matchList: Match[]) {
    const stats: Record<number, StandingTeam> = {};

    teams.forEach((team) => {
      stats[team.id] = {
        ...team,
        p: 0,
        w: 0,
        d: 0,
        l: 0,
        gf: 0,
        ga: 0,
        gd: 0,
        pts: 0,
      };
    });

    const finishedMatches = matchList.filter(
      (match) =>
        match.status === "FINISHED" &&
        match.home_score !== null &&
        match.away_score !== null,
    );

    finishedMatches.forEach((match) => {
      const home = stats[match.home_team_id];

      const away = stats[match.away_team_id];

      if (!home || !away) {
        return;
      }

      const homeScore = Number(match.home_score);

      const awayScore = Number(match.away_score);

      home.p += 1;
      away.p += 1;

      home.gf += homeScore;
      home.ga += awayScore;

      away.gf += awayScore;
      away.ga += homeScore;

      if (homeScore > awayScore) {
        home.w += 1;
        home.pts += 3;
        away.l += 1;
      } else if (homeScore < awayScore) {
        away.w += 1;
        away.pts += 3;
        home.l += 1;
      } else {
        home.d += 1;
        away.d += 1;

        home.pts += 1;
        away.pts += 1;
      }

      home.gd = home.gf - home.ga;
      away.gd = away.gf - away.ga;
    });

    /* =======================================================
       HEAD TO HEAD
    ======================================================= */

    function getHeadToHead(teamAId: number, teamBId: number) {
      const h2hMatches = finishedMatches.filter(
        (match) =>
          (Number(match.home_team_id) === Number(teamAId) &&
            Number(match.away_team_id) === Number(teamBId)) ||
          (Number(match.home_team_id) === Number(teamBId) &&
            Number(match.away_team_id) === Number(teamAId)),
      );

      let teamAPoints = 0;
      let teamBPoints = 0;

      let teamAGF = 0;
      let teamBGF = 0;

      let teamAGA = 0;
      let teamBGA = 0;

      h2hMatches.forEach((match) => {
        const homeId = Number(match.home_team_id);

        const homeScore = Number(match.home_score);

        const awayScore = Number(match.away_score);

        if (homeId === Number(teamAId)) {
          teamAGF += homeScore;
          teamAGA += awayScore;

          teamBGF += awayScore;
          teamBGA += homeScore;

          if (homeScore > awayScore) {
            teamAPoints += 3;
          } else if (homeScore < awayScore) {
            teamBPoints += 3;
          } else {
            teamAPoints += 1;
            teamBPoints += 1;
          }
        } else {
          teamAGF += awayScore;
          teamAGA += homeScore;

          teamBGF += homeScore;
          teamBGA += awayScore;

          if (awayScore > homeScore) {
            teamAPoints += 3;
          } else if (awayScore < homeScore) {
            teamBPoints += 3;
          } else {
            teamAPoints += 1;
            teamBPoints += 1;
          }
        }
      });

      return {
        teamAPoints,
        teamBPoints,

        teamAGD: teamAGF - teamAGA,
        teamBGD: teamBGF - teamBGA,

        teamAGF,
        teamBGF,
      };
    }

    const sorted = Object.values(stats).sort((a, b) => {
      // 1. Points
      if (b.pts !== a.pts) {
        return b.pts - a.pts;
      }

      // 2. Goal Difference
      if (b.gd !== a.gd) {
        return b.gd - a.gd;
      }

      // 3. Goals For
      if (b.gf !== a.gf) {
        return b.gf - a.gf;
      }

      // 4. Head To Head
      const h2h = getHeadToHead(a.id, b.id);

      if (h2h.teamAPoints !== h2h.teamBPoints) {
        return h2h.teamBPoints - h2h.teamAPoints;
      }

      if (h2h.teamAGD !== h2h.teamBGD) {
        return h2h.teamBGD - h2h.teamAGD;
      }

      if (h2h.teamAGF !== h2h.teamBGF) {
        return h2h.teamBGF - h2h.teamAGF;
      }

      return String(a.name).localeCompare(String(b.name));
    });

    setStandings(sorted);
  }

  /* =========================================================
     EVENT ICON
  ========================================================= */

  function getEventIcon(type: string) {
    if (type === "GOAL") {
      return "⚽";
    }

    if (type === "YELLOW_CARD") {
      return "🟨";
    }

    if (type === "RED_CARD") {
      return "🟥";
    }

    return "";
  }

  /* =========================================================
   YELLOW ACCUMULATION / SUSPENSION HELPERS
========================================================= */

  /*
   * ตรวจว่า Yellow event นี้คือใบที่ทำให้สะสมครบ 3 หรือไม่
   *
   * ใช้ player_suspensions เป็น source of truth
   * ดังนั้นเราไม่สร้าง RED_CARD ปลอมลง match_events
   */
  function isYellowAccumulationTrigger(event: MatchEvent) {
    if (event.event_type !== "YELLOW_CARD") {
      return false;
    }

    return suspensions.some(
      (suspension) =>
        Number(suspension.source_event_id) === Number(event.id) &&
        suspension.reason === "YELLOW_ACCUMULATION" &&
        suspension.status !== "CANCELLED",
    );
  }

  /*
   * icon ที่ใช้แสดงใน Match Detail
   *
   * Yellow ปกติ     = 🟨
   * Yellow ใบที่ 3  = 🟨 🟥
   * Red จริง        = 🟥
   * Goal            = ⚽
   */
  function getDisplayEventIcon(event: MatchEvent) {
    if (event.event_type === "GOAL") {
      return "⚽";
    }

    if (event.event_type === "RED_CARD") {
      return "🟥";
    }

    if (event.event_type === "YELLOW_CARD") {
      if (isYellowAccumulationTrigger(event)) {
        return "🟨 🟥";
      }

      return "🟨";
    }

    return "";
  }

  /*
   * หานักเตะที่ถูกแบนใน Match นี้
   */
  function getMatchSuspensions(matchId: number) {
    return suspensions.filter(
      (suspension) =>
        Number(suspension.suspended_match_id) === Number(matchId) &&
        suspension.status === "PENDING",
    );
  }

  /* =========================================================
     DATE
  ========================================================= */

  function formatMatchDate(dateString: string) {
    if (!dateString) {
      return "";
    }

    const date = new Date(dateString);

    return date.toLocaleDateString("th-TH", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  /* =========================================================
     MATCH FILTER
  ========================================================= */

  function getFilteredMatches() {
    /* MATCH FINISH */

    if (matchFilter === "FINISH") {
      return [...matches]
        .filter((match) => match.status === "FINISHED")
        .sort(
          (a, b) =>
            new Date(a.kickoff_time).getTime() -
            new Date(b.kickoff_time).getTime(),
        );
    }

    /* MATCH DAY */

    if (matchFilter === "TODAY") {
      const sortedMatches = [...matches].sort(
        (a, b) =>
          new Date(a.kickoff_time).getTime() -
          new Date(b.kickoff_time).getTime(),
      );

      const liveMatches = sortedMatches.filter(
        (match) => match.status === "LIVE",
      );

      if (liveMatches.length > 0) {
        const currentLive = liveMatches[0];

        const nextUpcoming = sortedMatches.find(
          (match) =>
            match.status === "UPCOMING" &&
            new Date(match.kickoff_time).getTime() >
              new Date(currentLive.kickoff_time).getTime(),
        );

        if (nextUpcoming) {
          return [currentLive, nextUpcoming];
        }

        return [currentLive];
      }

      const finishedMatches = sortedMatches.filter(
        (match) => match.status === "FINISHED",
      );

      const latestFinished =
        finishedMatches.length > 0
          ? finishedMatches[finishedMatches.length - 1]
          : null;

      const upcomingMatches = sortedMatches.filter(
        (match) => match.status === "UPCOMING",
      );

      const nextUpcoming =
        upcomingMatches.length > 0 ? upcomingMatches[0] : null;

      if (latestFinished && nextUpcoming) {
        return [latestFinished, nextUpcoming];
      }

      if (latestFinished) {
        return [latestFinished];
      }

      if (nextUpcoming) {
        return [nextUpcoming];
      }

      return [];
    }

    /* ALL */

    return [...matches].sort(
      (a, b) =>
        new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime(),
    );
  }

  const filteredMatches = getFilteredMatches();

  /* =========================================================
     PLAYER STATS SORT
  ========================================================= */

  const topScorers = [...playerStats]
    .filter((player) => player.goals > 0)
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));

  const cardStats = [...playerStats]
    .filter((player) => player.yellowCards > 0 || player.redCards > 0)
    .sort(
      (a, b) =>
        b.redCards - a.redCards ||
        b.yellowCards - a.yellowCards ||
        a.name.localeCompare(b.name),
    );

  /* =========================================================
     LOADING
  ========================================================= */

  if (loading) {
    return (
      <div className="min-h-screen theme-page flex items-center justify-center">
        <span className="text-sm font-bold theme-muted">
          กำลังโหลดข้อมูล...
        </span>
      </div>
    );
  }

  /* =========================================================
     UI
  ========================================================= */

  return (
    <>
      <LiveMatchNotification />

      <div className="min-h-screen theme-page">
        <div className="max-w-3xl mx-auto p-4 min-h-screen font-sans">
          {/* =================================================
              TOP BUTTONS
          ================================================= */}

          <div className="flex justify-end items-center gap-2 pt-1">
            <ThemeToggle />

            <button
              type="button"
              onClick={() => {
                window.location.href = "/admin";
              }}
              className="theme-toggle"
            >
              <span>🔒</span>
              <span>Admin</span>
            </button>
          </div>

          {/* =================================================
              HEADER
          ================================================= */}

          <header className="text-center my-8">
            <h1 className="text-3xl md:text-4xl font-black tracking-wider uppercase theme-text">
              NMB FOOTBALL <span className="text-green-400">LEAGUE 2026</span>
            </h1>

            <p className="text-xs theme-muted font-semibold tracking-widest mt-1">
              OFFICIAL TOURNAMENT MATCHES
            </p>
          </header>

          {/* =================================================
              MAIN TAB
          ================================================= */}

          <div className="grid grid-cols-3 theme-card p-1.5 rounded-xl mb-4 border gap-1">
            <button
              type="button"
              onClick={() => setActiveTab("matches")}
              className={`py-2.5 px-1 font-extrabold rounded-lg text-[10px] sm:text-sm transition ${
                activeTab === "matches"
                  ? "bg-green-500 text-slate-950"
                  : "theme-muted hover:text-green-400"
              }`}
            >
              ตารางแข่งขัน
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("standings")}
              className={`py-2.5 px-1 font-extrabold rounded-lg text-[10px] sm:text-sm transition ${
                activeTab === "standings"
                  ? "bg-green-500 text-slate-950"
                  : "theme-muted hover:text-green-400"
              }`}
            >
              ตารางคะแนน
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("stats")}
              className={`py-2.5 px-1 font-extrabold rounded-lg text-[10px] sm:text-sm transition ${
                activeTab === "stats"
                  ? "bg-green-500 text-slate-950"
                  : "theme-muted hover:text-green-400"
              }`}
            >
              สถิติผู้เล่น
            </button>
          </div>

          {/* =================================================
              MATCH FILTER
          ================================================= */}

          {activeTab === "matches" && (
            <div className="flex items-center justify-between gap-2 theme-card p-1.5 rounded-xl mb-6 border">
              <button
                type="button"
                onClick={() => setMatchFilter("FINISH")}
                className={`flex-1 py-1.5 text-[9px] sm:text-xs font-black rounded-lg transition tracking-wider uppercase ${
                  matchFilter === "FINISH"
                    ? "bg-green-500 text-slate-950"
                    : "theme-muted hover:text-green-400"
                }`}
              >
                MATCH FINISH
              </button>

              <button
                type="button"
                onClick={() => setMatchFilter("TODAY")}
                className={`flex-1 py-1.5 text-[9px] sm:text-xs font-black rounded-lg transition tracking-wider uppercase ${
                  matchFilter === "TODAY"
                    ? "bg-green-500 text-slate-950"
                    : "theme-muted hover:text-green-400"
                }`}
              >
                MATCH DAY
              </button>

              <button
                type="button"
                onClick={() => setMatchFilter("ALL")}
                className={`flex-1 py-1.5 text-[9px] sm:text-xs font-black rounded-lg transition tracking-wider uppercase ${
                  matchFilter === "ALL"
                    ? "bg-green-500 text-slate-950"
                    : "theme-muted hover:text-green-400"
                }`}
              >
                ALL MATCH
              </button>
            </div>
          )}

          {/* =================================================
              MATCHES
          ================================================= */}

          {activeTab === "matches" && (
            <div className="space-y-4">
              {filteredMatches.length === 0 ? (
                <div className="text-center py-8 theme-muted font-bold text-xs uppercase tracking-wider">
                  ไม่พบรายการแข่งขัน
                </div>
              ) : (
                filteredMatches.map((match) => {
                  const matchSuspensions = getMatchSuspensions(match.id);

                  const homeSuspensions = matchSuspensions.filter(
                    (suspension) =>
                      Number(suspension.player?.team_id) ===
                      Number(match.home_team_id),
                  );

                  const awaySuspensions = matchSuspensions.filter(
                    (suspension) =>
                      Number(suspension.player?.team_id) ===
                      Number(match.away_team_id),
                  );

                  const isExpanded = expandedMatchId === match.id;

                  const homeEvents = (match.match_events || [])
                    .filter(
                      (event) =>
                        Number(event.team_id) === Number(match.home_team_id),
                    )
                    .sort((a, b) => (a.minute || 0) - (b.minute || 0));

                  const awayEvents = (match.match_events || [])
                    .filter(
                      (event) =>
                        Number(event.team_id) === Number(match.away_team_id),
                    )
                    .sort((a, b) => (a.minute || 0) - (b.minute || 0));

                  return (
                    <div
                      key={match.id}
                      onClick={() =>
                        setExpandedMatchId(isExpanded ? null : match.id)
                      }
                      className={`theme-card p-4 rounded-2xl border transition cursor-pointer shadow-sm ${
                        isExpanded
                          ? "border-green-500"
                          : "hover:border-green-500"
                      }`}
                    >
                      {/* STATUS */}

                      <div className="flex justify-between items-center mb-4 text-xs font-bold theme-muted">
                        <span className="uppercase tracking-wider">
                          Matchday {match.matchday}
                          {match.kickoff_time && (
                            <span className="theme-muted font-medium ml-1.5">
                              {" "}
                              - {formatMatchDate(match.kickoff_time)}
                            </span>
                          )}
                        </span>

                        {match.status === "LIVE" && (
                          <span className="flex items-center space-x-1.5 text-red-500 font-black bg-red-950/60 border border-red-800/80 px-2.5 py-0.5 rounded-full">
                            <span className="relative flex h-2 w-2">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />

                              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                            </span>

                            <span>LIVE</span>
                          </span>
                        )}

                        {match.status === "FINISHED" && (
                          <span className="theme-soft text-green-400 border border-green-500/30 px-2.5 py-0.5 rounded-full font-bold">
                            จบการแข่งขัน
                          </span>
                        )}

                        {match.status === "UPCOMING" && (
                          <span className="theme-muted font-semibold">
                            {new Date(match.kickoff_time).toLocaleTimeString(
                              "th-TH",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}{" "}
                            น.
                          </span>
                        )}
                      </div>

                      {/* SCORE */}

                      <div className="flex items-center justify-between gap-2">
                        {/* HOME */}

                        <div className="flex items-center space-x-2 md:space-x-3 w-5/12 justify-end min-w-0">
                          <span className="font-extrabold theme-text text-right text-xs md:text-base truncate">
                            {match.home?.name}
                          </span>

                          <img
                            src={match.home?.logo_url || ""}
                            alt={match.home?.name || ""}
                            className="w-7 h-7 md:w-9 md:h-9 object-contain flex-shrink-0"
                          />
                        </div>

                        {/* SCORE / VS */}

                        <div className="w-2/12 text-center flex-shrink-0">
                          {match.status === "UPCOMING" ? (
                            <span className="theme-soft border px-2 py-1 rounded-lg font-black theme-secondary text-xs">
                              VS
                            </span>
                          ) : (
                            <span
                              className={`px-2 md:px-3 py-1 rounded-lg font-black text-base md:text-2xl tracking-widest whitespace-nowrap ${
                                match.status === "LIVE"
                                  ? "bg-red-600 text-white animate-pulse"
                                  : "bg-green-500 text-slate-950"
                              }`}
                            >
                              {match.home_score ?? 0} - {match.away_score ?? 0}
                            </span>
                          )}
                        </div>

                        {/* AWAY */}

                        <div className="flex items-center space-x-2 md:space-x-3 w-5/12 min-w-0">
                          <img
                            src={match.away?.logo_url || ""}
                            alt={match.away?.name || ""}
                            className="w-7 h-7 md:w-9 md:h-9 object-contain flex-shrink-0"
                          />

                          <span className="font-extrabold theme-text text-left text-xs md:text-base truncate">
                            {match.away?.name}
                          </span>
                        </div>
                      </div>

                      {/* =================================================
                            SUSPENDED PLAYERS
                        ================================================= */}

                      {matchSuspensions.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {matchSuspensions.map((suspension) => {
                            const playerTeamId = Number(
                              suspension.player?.team_id,
                            );

                            const teamName =
                              playerTeamId === Number(match.home_team_id)
                                ? match.home?.name
                                : playerTeamId === Number(match.away_team_id)
                                  ? match.away?.name
                                  : "";

                            return (
                              <div
                                key={suspension.id}
                                className="
                                flex
                                items-center
                                justify-center
                                flex-wrap
                                gap-x-1.5
                                gap-y-0.5
                                text-[8px]
                                sm:text-[9px]
                                font-semibold
                                text-red-500
                              "
                              >
                                <span className="whitespace-nowrap">🚫</span>

                                <span className="whitespace-nowrap">
                                  {teamName}
                                </span>

                                <span className="flex items-center gap-1 whitespace-nowrap">
                                  <PlayerAvatar
                                    imageUrl={suspension.player?.image_url}
                                    name={suspension.player?.name}
                                    size="xs"
                                  />

                                  <span className="font-black">
                                    #{suspension.player?.number}{" "}
                                    {suspension.player?.name}
                                  </span>
                                </span>

                                <span>•</span>

                                <span className="whitespace-nowrap">
                                  {suspension.reason === "YELLOW_ACCUMULATION"
                                    ? "🟨 สะสมครบ 3 ใบ"
                                    : "🟥 ใบแดง"}
                                </span>

                                <span>•</span>

                                <span className="whitespace-nowrap">
                                  แบน Match นี้
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* EXPAND */}

                      <div className="text-center mt-3">
                        <span className="text-[10px] font-extrabold tracking-wider theme-muted uppercase">
                          {isExpanded ? "▲ Hide details" : "▼ View details"}
                        </span>
                      </div>

                      {/* EVENTS */}

                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t theme-border grid grid-cols-2 gap-4 text-xs">
                          {/* HOME */}

                          <div className="space-y-1.5 text-right">
                            <span className="font-bold theme-muted block border-b theme-border pb-1 text-[11px]">
                              {match.home?.name}
                            </span>

                            {homeEvents.length === 0 ? (
                              <span className="theme-muted text-[11px]">
                                ไม่มีเหตุการณ์
                              </span>
                            ) : (
                              homeEvents.map((event) => {
                                const isThirdYellow =
                                  isYellowAccumulationTrigger(event);

                                return (
                                  <div
                                    key={event.id}
                                    className={`font-semibold flex items-center justify-end gap-1.5 ${
                                      isThirdYellow
                                        ? "text-red-500 font-black"
                                        : "theme-secondary"
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <PlayerAvatar
                                        imageUrl={event.player?.image_url}
                                        name={event.player?.name}
                                        size="xs"
                                      />
                                      <span>
                                        {event.minute
                                          ? `(${event.minute}') `
                                          : ""}
                                        #{event.player?.number}{" "}
                                        {event.player?.name}
                                      </span>
                                    </div>

                                    <span className="whitespace-nowrap">
                                      {getDisplayEventIcon(event)}
                                    </span>
                                  </div>
                                );
                              })
                            )}
                          </div>

                          {/* AWAY */}

                          <div className="space-y-1.5 text-left border-l theme-border pl-4">
                            <span className="font-bold theme-muted block border-b theme-border pb-1 text-[11px]">
                              {match.away?.name}
                            </span>

                            {awayEvents.length === 0 ? (
                              <span className="theme-muted text-[11px]">
                                ไม่มีเหตุการณ์
                              </span>
                            ) : (
                              awayEvents.map((event) => {
                                const isThirdYellow =
                                  isYellowAccumulationTrigger(event);

                                return (
                                  <div
                                    key={event.id}
                                    className={`font-semibold flex items-center gap-1.5 ${
                                      isThirdYellow
                                        ? "text-red-500 font-black"
                                        : "theme-secondary"
                                    }`}
                                  >
                                    <span className="whitespace-nowrap">
                                      {getDisplayEventIcon(event)}
                                    </span>

                                    <div className="flex items-center gap-1.5">
                                      <PlayerAvatar
                                        imageUrl={event.player?.image_url}
                                        name={event.player?.name}
                                        size="xs"
                                      />
                                      <span>
                                        #{event.player?.number}{" "}
                                        {event.player?.name}
                                        {event.minute
                                          ? ` (${event.minute}')`
                                          : ""}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* =================================================
              STANDINGS
          ================================================= */}

          {activeTab === "standings" && (
            <div className="theme-card rounded-2xl border overflow-hidden shadow-sm">
              <table className="w-full table-fixed text-[9px] sm:text-[10px] md:text-xs">
                <thead className="theme-soft theme-secondary font-bold border-b theme-border uppercase">
                  <tr>
                    <th className="w-[6%] py-2 px-1 text-center">#</th>

                    <th className="w-[28%] py-2 px-1 text-left">Team</th>

                    <th className="w-[7%] py-2 px-0.5 text-center">P</th>

                    <th className="w-[7%] py-2 px-0.5 text-center">W</th>

                    <th className="w-[7%] py-2 px-0.5 text-center">D</th>

                    <th className="w-[7%] py-2 px-0.5 text-center">L</th>

                    <th className="w-[8%] py-2 px-0.5 text-center">GF</th>

                    <th className="w-[8%] py-2 px-0.5 text-center">GA</th>

                    <th className="w-[10%] py-2 px-0.5 text-center">GD</th>

                    <th className="w-[12%] py-2 px-0.5 text-center">Pts</th>
                  </tr>
                </thead>

                <tbody className="font-semibold">
                  {standings.map((team, index) => (
                    <tr
                      key={team.id}
                      className="border-b theme-border transition"
                    >
                      <td className="py-2 px-1 text-center font-bold theme-muted">
                        {index + 1}
                      </td>

                      <td className="py-2 px-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <img
                            src={team.logo_url || ""}
                            alt={team.name}
                            className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 object-contain flex-shrink-0"
                          />

                          <span className="font-extrabold theme-text truncate">
                            {team.name}
                          </span>
                        </div>
                      </td>

                      <td className="py-2 px-0.5 text-center theme-secondary">
                        {team.p}
                      </td>

                      <td className="py-2 px-0.5 text-center text-green-400 font-bold">
                        {team.w}
                      </td>

                      <td className="py-2 px-0.5 text-center theme-secondary">
                        {team.d}
                      </td>

                      <td className="py-2 px-0.5 text-center text-red-400">
                        {team.l}
                      </td>

                      <td className="py-2 px-0.5 text-center theme-secondary">
                        {team.gf}
                      </td>

                      <td className="py-2 px-0.5 text-center theme-secondary">
                        {team.ga}
                      </td>

                      <td
                        className={`py-2 px-0.5 text-center font-bold ${
                          team.gd > 0
                            ? "text-green-400"
                            : team.gd < 0
                              ? "text-red-400"
                              : "theme-muted"
                        }`}
                      >
                        {team.gd > 0 ? `+${team.gd}` : team.gd}
                      </td>

                      <td className="py-2 px-0.5 text-center font-black text-green-400 text-[10px] sm:text-xs md:text-sm">
                        {team.pts}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* LEGEND */}

              <div className="px-3 py-2.5 border-t theme-border theme-soft">
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[8px] sm:text-[9px] md:text-[10px] theme-muted font-semibold">
                  <span>P = แข่ง</span>

                  <span>W = ชนะ</span>

                  <span>D = เสมอ</span>

                  <span>L = แพ้</span>

                  <span>GF = ได้</span>

                  <span>GA = เสีย</span>

                  <span>GD = ผลต่าง</span>

                  <span>Pts = คะแนน</span>
                </div>
              </div>
            </div>
          )}

          {/* =================================================
              PLAYER STATS
          ================================================= */}

          {activeTab === "stats" && (
            <div className="space-y-5">
              {/* TOP SCORERS */}

              <div className="theme-card border rounded-2xl overflow-hidden">
                <div className="px-4 py-3 theme-soft border-b theme-border">
                  <h2 className="text-green-400 font-black">⚽ ดาวซัลโว</h2>

                  <p className="text-[10px] theme-muted mt-0.5">TOP SCORERS</p>
                </div>

                {topScorers.length === 0 ? (
                  <div className="py-8 text-center text-xs theme-muted">
                    ยังไม่มีผู้ทำประตู
                  </div>
                ) : (
                  topScorers.map((player, index) => (
                    <div
                      key={player.id}
                      className="flex items-center justify-between px-4 py-3 border-b theme-border last:border-b-0"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-7 h-7 flex items-center justify-center rounded-full font-black ${
                            index === 0
                              ? "bg-yellow-500 text-slate-950"
                              : "theme-soft theme-muted"
                          }`}
                        >
                          {index + 1}
                        </div>

                        <div className="min-w-0">
                          {/* <p className="theme-text font-extrabold text-sm truncate"> */}
                          <div className="flex items-center gap-2">
                            <PlayerAvatar
                              imageUrl={player.image_url}
                              name={player.name}
                              size="sm"
                            />

                            <div>
                              <div className="font-bold">
                                #{player.number} {player.name}
                                <p className="text-[10px] theme-muted truncate">
                                  {player.team?.name}
                                </p>
                              </div>
                            </div>
                          </div>
                          {/* </p> */}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span>⚽</span>

                        <span className="text-xl font-black text-green-400">
                          {player.goals}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* CARD STATS */}

              <div className="theme-card border rounded-2xl overflow-hidden">
                <div className="px-4 py-3 theme-soft border-b theme-border">
                  <h2 className="theme-text font-black">
                    🟨 🟥 ใบเตือน / โทษแบน
                  </h2>

                  <p className="text-[10px] theme-muted mt-0.5">
                    FAIR PLAY / DISCIPLINARY
                  </p>
                </div>

                {cardStats.length === 0 ? (
                  <div className="py-8 text-center text-xs theme-muted">
                    ยังไม่มีใบเตือน
                  </div>
                ) : (
                  cardStats.map((player) => {
                    const activeSuspensions = suspensions.filter(
                      (suspension) =>
                        Number(suspension.player_id) === Number(player.id) &&
                        suspension.status === "PENDING",
                    );

                    const servedCount = suspensions.filter(
                      (suspension) =>
                        Number(suspension.player_id) === Number(player.id) &&
                        suspension.status === "SERVED",
                    ).length;

                    return (
                      <div
                        key={player.id}
                        className="px-4 py-3 border-b theme-border last:border-b-0"
                      >
                        <div className="flex justify-between items-center gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <PlayerAvatar
                              imageUrl={player.image_url}
                              name={player.name}
                              size="md"
                            />

                            <div className="min-w-0">
                              <p className="theme-text font-extrabold text-sm truncate">
                                #{player.number} {player.name}
                              </p>

                              <p className="text-[10px] theme-muted truncate">
                                {player.team?.name}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 flex-shrink-0">
                            <span className="text-yellow-400 font-black">
                              🟨 {player.yellowCards}
                            </span>

                            <span className="text-red-400 font-black">
                              🟥 {player.redCards}
                            </span>
                          </div>
                        </div>

                        {/* ACTIVE BAN */}

                        {activeSuspensions.map((suspension) => (
                          <div
                            key={suspension.id}
                            className="mt-2 bg-red-950/40 border border-red-900/60 rounded-xl px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-red-400 text-xs font-black">
                                🚫 ติดโทษแบน
                              </span>

                              <span className="text-[10px] text-red-300">
                                {suspension.reason === "YELLOW_ACCUMULATION"
                                  ? "เหลืองสะสม 3 ใบ"
                                  : "ใบแดง"}
                              </span>
                            </div>

                            {suspension.suspended_match ? (
                              <div className="mt-1 text-[10px] theme-secondary">
                                แบน Matchday{" "}
                                {suspension.suspended_match.matchday}
                                {" • "}
                                {suspension.suspended_match.home?.name}
                                {" vs "}
                                {suspension.suspended_match.away?.name}
                              </div>
                            ) : (
                              <div className="mt-1 text-[10px] theme-muted">
                                ยังไม่มีแมตช์ถัดไป
                              </div>
                            )}
                          </div>
                        ))}

                        {servedCount > 0 && (
                          <p className="text-[10px] theme-muted mt-2">
                            เคยรับโทษแบนแล้ว {servedCount} ครั้ง
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* SUSPENSION HISTORY */}

              <div className="theme-card border rounded-2xl overflow-hidden">
                <div className="px-4 py-3 theme-soft border-b theme-border">
                  <h2 className="theme-text font-black">🚫 ประวัติโทษแบน</h2>
                </div>

                {suspensions.length === 0 ? (
                  <div className="py-8 text-center text-xs theme-muted">
                    ยังไม่มีประวัติโทษแบน
                  </div>
                ) : (
                  suspensions.map((suspension) => (
                    <div
                      key={suspension.id}
                      className="px-4 py-3 border-b theme-border last:border-b-0"
                    >
                      <div className="flex justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <PlayerAvatar
                            imageUrl={suspension.player?.image_url}
                            name={suspension.player?.name}
                            size="md"
                          />

                          <div className="min-w-0">
                            <p className="theme-text text-sm font-extrabold truncate">
                              #{suspension.player?.number}{" "}
                              {suspension.player?.name}
                            </p>

                            <p className="text-[10px] theme-muted mt-1">
                              {suspension.reason === "YELLOW_ACCUMULATION"
                                ? "🟨 ใบเหลืองสะสมครบ 3 ใบ"
                                : "🟥 ใบแดง"}
                            </p>

                            {suspension.suspended_match && (
                              <p className="text-[10px] theme-secondary mt-1">
                                Matchday {suspension.suspended_match.matchday}
                                {" • "}
                                {suspension.suspended_match.home?.name}
                                {" vs "}
                                {suspension.suspended_match.away?.name}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex-shrink-0">
                          {suspension.status === "PENDING" ? (
                            <span className="text-red-400 text-xs font-black">
                              ติดโทษแบน
                            </span>
                          ) : suspension.status === "SERVED" ? (
                            <span className="text-green-400 text-xs font-black">
                              รับโทษแล้ว
                            </span>
                          ) : (
                            <span className="theme-muted text-xs font-black">
                              ยกเลิก
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
