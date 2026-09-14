"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
const ADMIN_TOKEN_KEY = "football_admin_token";

/* =========================================================
   TYPES
========================================================= */

interface Player {
  id: number;
  team_id: number;
  number: number;
  name: string;
}

interface Team {
  id: number;
  name: string;
  players?: Player[];
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

  home?: Team;
  away?: Team;
}

interface MatchEvent {
  id: number;

  match_id: number;

  team_id: number;

  player_id: number;

  event_type: "GOAL" | "YELLOW_CARD" | "RED_CARD";

  minute: number | null;

  player?: Player;
}

interface AdminActionResult {
  success: boolean;

  message?: string;

  player?: Player;

  match?: Match;

  event?: MatchEvent;

  deleted_event_id?: number;

  home_score?: number;

  away_score?: number;
}

/* =========================================================
   ADMIN PAGE
========================================================= */

export default function AdminPage() {
  const router = useRouter();

  const [authenticated, setAuthenticated] = useState(false);

  const [checkingSession, setCheckingSession] = useState(true);

  const [password, setPassword] = useState("");

  const [loginError, setLoginError] = useState("");

  const [loginLoading, setLoginLoading] = useState(false);

  const [matches, setMatches] = useState<Match[]>([]);

  const [teams, setTeams] = useState<Team[]>([]);

  const [loading, setLoading] = useState(false);

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const [playerNumber, setPlayerNumber] = useState("");

  const [playerName, setPlayerName] = useState("");

  /* =======================================================
     PLAYER LIST
  ======================================================= */

  const [showPlayerList, setShowPlayerList] = useState(false);

  const [expandedTeamId, setExpandedTeamId] = useState<number | null>(null);

  const [editingPlayerId, setEditingPlayerId] = useState<number | null>(null);

  const [editPlayerNumber, setEditPlayerNumber] = useState("");

  const [editPlayerName, setEditPlayerName] = useState("");

  const [playerSaving, setPlayerSaving] = useState(false);

  /* =======================================================
     SESSION
  ======================================================= */

  useEffect(() => {
    checkSession();
  }, []);

  async function checkSession() {
    setAuthenticated(false);
    setCheckingSession(true);
    try {
      const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
      if (!token) {
        setAuthenticated(false);
        return;
      }

      const response = await fetch("/api/admin/session", {
        method: "GET",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        setAuthenticated(false);
        return;
      }
      const text = await response.text();

      if (!text) {
        sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        setAuthenticated(false);
        return;
      }

      const result = JSON.parse(text);
      if (result.authenticated === true) {
        setAuthenticated(true);
        return;
      }

      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      setAuthenticated(false);
    } catch (error) {
      console.error("SESSION CHECK ERROR:", error);
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      setAuthenticated(false);
    } finally {
      setCheckingSession(false);
    }
  }

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
        if (!token) {
          setAuthenticated(false);
        }
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  /* =======================================================
     LOGIN
  ======================================================= */

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();

    if (!password.trim()) {
      setLoginError("กรุณากรอกรหัส Admin");
      return;
    }

    setLoginLoading(true);
    setLoginError("");

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: password,
        }),
      });

      const rawText = await response.text();
      console.log("LOGIN STATUS:", response.status);
      console.log("LOGIN RAW RESPONSE:", rawText);

      let result: {
        success?: boolean;
        token?: string;
        message?: string;
      } = {};

      if (rawText) {
        try {
          result = JSON.parse(rawText);
        } catch (parseError) {
          console.error("LOGIN JSON PARSE ERROR:", parseError);
          setLoginError("Server ตอบกลับข้อมูลไม่ถูกต้อง");
          return;
        }
      }

      if (!response.ok || !result.success) {
        setLoginError(
          result.message || `เข้าสู่ระบบไม่สำเร็จ (${response.status})`,
        );
        return;
      }

      if (!result.token) {
        setLoginError("Server ไม่ได้ส่ง Admin Token กลับมา");
        return;
      }

      sessionStorage.setItem(ADMIN_TOKEN_KEY, result.token);
      setPassword("");
      setAuthenticated(true);
    } catch (error) {
      console.error("LOGIN ERROR:", error);
      setLoginError("ไม่สามารถเชื่อมต่อระบบ Admin ได้");
    } finally {
      setLoginLoading(false);
    }
  }

  /* =======================================================
     LOGOUT
  ======================================================= */

  async function handleLogout() {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    setAuthenticated(false);
    try {
      await fetch("/api/admin/logout", {
        method: "POST",
        cache: "no-store",
      });
    } catch (error) {
      console.error("LOGOUT ERROR:", error);
    }
    window.location.replace("/");
  }

  /* =======================================================
     FETCH DATA
  ======================================================= */

  const fetchData = useCallback(async () => {
    const { data: matchData, error: matchError } = await supabase
      .from("matches")
      .select(
        `
              *,
              home:home_team_id(*),
              away:away_team_id(*)
            `,
      )
      .order("kickoff_time", {
        ascending: true,
      });

    if (matchError) {
      console.error("MATCH FETCH ERROR:", matchError);
    }

    const { data: teamData, error: teamError } = await supabase
      .from("teams")
      .select(
        `
              *,
              players(*)
            `,
      )
      .order("id", {
        ascending: true,
      });

    if (teamError) {
      console.error("TEAM FETCH ERROR:", teamError);
    }

    const formattedTeams = ((teamData as Team[]) || []).map((team) => ({
      ...team,

      players: [...(team.players || [])].sort(
        (a, b) =>
          Number(a.number) - Number(b.number) || a.name.localeCompare(b.name),
      ),
    }));

    setMatches((matchData as Match[]) || []);

    setTeams(formattedTeams);
  }, []);

  useEffect(() => {
    if (authenticated) {
      fetchData();
    }
  }, [authenticated, fetchData]);

  /* =======================================================
     ADMIN ACTION
  ======================================================= */

  async function adminAction(
    data: Record<string, unknown>,
  ): Promise<AdminActionResult> {
    const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);

    if (!token) {
      setAuthenticated(false);
      throw new Error("กรุณาเข้าสู่ระบบ Admin");
    }

    const response = await fetch("/api/admin/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });

    const result: AdminActionResult = await response.json();
    console.log("ADMIN ACTION:", data);
    console.log("ADMIN ACTION RESPONSE:", response.status, result);

    if (response.status === 401) {
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      setAuthenticated(false);
      throw new Error("Admin Session หมดอายุ กรุณาเข้าสู่ระบบใหม่");
    }

    if (!response.ok || !result.success) {
      throw new Error(result.message || "เกิดข้อผิดพลาด");
    }
    return result;
  }

  /* =======================================================
     ADD PLAYER
  ======================================================= */

  async function handleAddPlayer(event: React.FormEvent) {
    event.preventDefault();

    if (!selectedTeamId || !playerNumber || !playerName.trim()) {
      alert("กรุณากรอกข้อมูลให้ครบ");

      return;
    }

    try {
      await adminAction({
        action: "ADD_PLAYER",

        teamId: Number(selectedTeamId),

        number: Number(playerNumber),

        name: playerName.trim(),
      });

      setPlayerNumber("");

      setPlayerName("");

      await fetchData();

      alert("เพิ่มนักเตะเรียบร้อย");
    } catch (error) {
      alert(error instanceof Error ? error.message : "เกิดข้อผิดพลาด");
    }
  }

  /* =======================================================
     EDIT PLAYER
  ======================================================= */

  function handleEditPlayer(player: Player) {
    setEditingPlayerId(player.id);

    setEditPlayerNumber(String(player.number));

    setEditPlayerName(player.name);
  }

  function handleCancelEditPlayer() {
    setEditingPlayerId(null);

    setEditPlayerNumber("");

    setEditPlayerName("");
  }

  async function handleSavePlayer(playerId: number) {
    const number = Number(editPlayerNumber);

    const name = editPlayerName.trim();

    if (editPlayerNumber === "") {
      alert("กรุณากรอกเบอร์เสื้อ");

      return;
    }

    if (Number.isNaN(number) || number < 0) {
      alert("เบอร์เสื้อไม่ถูกต้อง");

      return;
    }

    if (!name) {
      alert("กรุณากรอกชื่อนักเตะ");

      return;
    }

    setPlayerSaving(true);

    try {
      const result = await adminAction({
        action: "UPDATE_PLAYER",

        playerId,

        number,

        name,
      });

      /*
       * UPDATE LOCAL STATE ทันที
       */

      if (result.player) {
        setTeams((currentTeams) =>
          currentTeams.map((team) => ({
            ...team,

            players: (team.players || [])
              .map((player) =>
                player.id === result.player?.id
                  ? {
                      ...player,

                      ...result.player,
                    }
                  : player,
              )
              .sort(
                (a, b) =>
                  Number(a.number) - Number(b.number) ||
                  a.name.localeCompare(b.name),
              ),
          })),
        );
      }

      handleCancelEditPlayer();

      /*
       * Background confirm
       */

      await fetchData();
    } catch (error) {
      console.error("SAVE PLAYER ERROR:", error);

      alert(
        error instanceof Error
          ? error.message
          : "ไม่สามารถแก้ไขข้อมูลนักเตะได้",
      );
    } finally {
      setPlayerSaving(false);
    }
  }

  /* =======================================================
     START MATCH
  ======================================================= */

  async function handleStartMatch(matchId: number) {
    const confirmed = window.confirm("ยืนยันเริ่มการแข่งขัน?");

    if (!confirmed) {
      return;
    }

    setLoading(true);

    try {
      const result = await adminAction({
        action: "START_MATCH",

        matchId,
      });

      /*
       * LOCAL UPDATE
       */

      setMatches((currentMatches) =>
        currentMatches.map((match) =>
          match.id === matchId
            ? {
                ...match,

                status: "LIVE",
              }
            : match,
        ),
      );

      if (result.match) {
        setMatches((currentMatches) =>
          currentMatches.map((match) =>
            match.id === matchId
              ? {
                  ...match,

                  ...result.match,
                }
              : match,
          ),
        );
      }

      /*
       * Confirm จาก DB
       */

      await fetchData();
    } catch (error) {
      alert(error instanceof Error ? error.message : "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
  }

  /* =======================================================
     FINISH MATCH
  ======================================================= */

  async function handleFinishMatch(
    matchId: number,

    homeScore: number,

    awayScore: number,
  ) {
    const confirmed = window.confirm("ยืนยันจบการแข่งขัน?");

    if (!confirmed) {
      return;
    }

    setLoading(true);

    try {
      const result = await adminAction({
        action: "FINISH_MATCH",

        matchId,

        homeScore,

        awayScore,
      });

      const newHomeScore =
        typeof result.home_score === "number" ? result.home_score : homeScore;

      const newAwayScore =
        typeof result.away_score === "number" ? result.away_score : awayScore;

      /*
       * LOCAL UPDATE
       */

      setMatches((currentMatches) =>
        currentMatches.map((match) =>
          match.id === matchId
            ? {
                ...match,

                status: "FINISHED",

                home_score: newHomeScore,

                away_score: newAwayScore,
              }
            : match,
        ),
      );

      /*
       * Confirm DB
       */

      await fetchData();

      alert("จบการแข่งขันเรียบร้อย");
    } catch (error) {
      alert(error instanceof Error ? error.message : "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
  }

  /* =======================================================
     LOADING SESSION
  ======================================================= */

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        กำลังตรวจสอบสิทธิ์...
      </div>
    );
  }

  /* =======================================================
     LOGIN
  ======================================================= */

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6"
        >
          <div className="text-center mb-6">
            <div className="text-4xl mb-3">🔐</div>

            <h1 className="text-2xl font-black text-white">ADMIN LOGIN</h1>

            <p className="text-xs text-slate-500 mt-1">NMB FOOTBALL LEAGUE</p>
          </div>

          <label className="text-xs font-bold text-slate-400">Admin Code</label>

          <input
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);

              setLoginError("");
            }}
            placeholder="กรอกรหัส Admin"
            autoFocus
            className="w-full mt-2 px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-white outline-none focus:border-green-500"
          />

          {loginError && (
            <div className="text-red-400 text-xs mt-2">{loginError}</div>
          )}

          <button
            type="submit"
            disabled={loginLoading}
            className="w-full mt-4 py-3 rounded-xl bg-green-500 hover:bg-green-400 disabled:opacity-50 text-slate-950 font-black"
          >
            {loginLoading ? "กำลังตรวจสอบ..." : "Sign in"}
          </button>

          <button
            type="button"
            onClick={() => router.push("/")}
            className="w-full mt-2 py-2 text-xs text-slate-500 hover:text-white"
          >
            ← กลับหน้าหลัก
          </button>
        </form>
      </div>
    );
  }

  /* =======================================================
     ADMIN PAGE
  ======================================================= */

  return (
    <div className="max-w-4xl mx-auto p-4 min-h-screen bg-slate-950 text-white space-y-8">
      {/* ===================================================
          HEADER
      =================================================== */}

      <header className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-black">
            ADMIN <span className="text-green-400">PANEL</span>
          </h1>

          <p className="text-xs text-slate-400">Live Match Control</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => router.push("/")}
            className="text-xs px-3 py-2 border border-slate-700 rounded-lg text-slate-400 hover:text-white hover:border-slate-500 transition"
          >
            หน้าเว็บ
          </button>

          <button
            onClick={handleLogout}
            className="text-xs px-3 py-2 border border-red-900 rounded-lg text-red-400 hover:bg-red-950 transition"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ===================================================
          1. ADD PLAYER
      =================================================== */}

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <h2 className="text-green-400 font-black mb-4">1. เพิ่มนักเตะ</h2>

        <form
          onSubmit={handleAddPlayer}
          className="grid grid-cols-1 md:grid-cols-4 gap-3"
        >
          <select
            value={selectedTeamId ?? ""}
            onChange={(event) => setSelectedTeamId(event.target.value || null)}
            className="w-full h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 text-sm text-white outline-none focus:border-green-500"
          >
            <option value="">-- เลือกทีม --</option>

            {teams.map((team) => (
              <option key={team.id} value={String(team.id)}>
                {team.name}
              </option>
            ))}
          </select>

          <input
            type="number"
            min="0"
            value={playerNumber}
            onChange={(event) => setPlayerNumber(event.target.value)}
            placeholder="เบอร์เสื้อ"
            className="h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 text-sm text-white outline-none focus:border-green-500"
          />

          <input
            type="text"
            value={playerName}
            onChange={(event) => setPlayerName(event.target.value)}
            placeholder="ชื่อนักเตะ"
            className="h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 text-sm text-white outline-none focus:border-green-500"
          />

          <button
            type="submit"
            className="h-[42px] bg-orange-500 hover:bg-orange-400 text-slate-950 font-black rounded-xl transition"
          >
            + เพิ่มนักเตะ
          </button>
        </form>
      </section>

      {/* ===================================================
          2. PLAYER LIST
      =================================================== */}

      <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        {/* MAIN HEADER */}

        <button
          type="button"
          onClick={() => {
            setShowPlayerList((current) => !current);

            if (showPlayerList) {
              setExpandedTeamId(null);

              setEditingPlayerId(null);
            }
          }}
          className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-slate-800/50 transition"
        >
          <div className="text-left">
            <h2 className="text-green-400 font-black">
              2. รายชื่อนักเตะแต่ละทีม
            </h2>

            <p className="text-[10px] text-slate-500 mt-1">
              ดูและแก้ไขชื่อ / เบอร์เสื้อนักเตะ
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[10px] text-slate-500">
              {teams.reduce(
                (total, team) => total + (team.players?.length || 0),
                0,
              )}{" "}
              คน
            </span>

            <span
              className={`text-slate-400 text-sm transition-transform duration-200 ${
                showPlayerList ? "rotate-180" : ""
              }`}
            >
              ▼
            </span>
          </div>
        </button>

        {/* LIST */}

        {showPlayerList && (
          <div className="border-t border-slate-800 p-3 space-y-2">
            {teams.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">
                ยังไม่มีข้อมูลทีม
              </div>
            ) : (
              teams.map((team) => {
                const isExpanded = expandedTeamId === team.id;

                const sortedPlayers = [...(team.players || [])].sort(
                  (a, b) =>
                    Number(a.number) - Number(b.number) ||
                    a.name.localeCompare(b.name),
                );

                return (
                  <div
                    key={team.id}
                    className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden"
                  >
                    {/* TEAM */}

                    <button
                      type="button"
                      onClick={() => {
                        setExpandedTeamId(isExpanded ? null : team.id);

                        setEditingPlayerId(null);

                        setEditPlayerNumber("");

                        setEditPlayerName("");
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/50 transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-sm">
                          ⚽
                        </div>

                        <div className="text-left">
                          <p className="font-black text-white text-sm">
                            {team.name}
                          </p>

                          <p className="text-[10px] text-slate-500">
                            {sortedPlayers.length} นักเตะ
                          </p>
                        </div>
                      </div>

                      <span
                        className={`text-xs text-slate-500 transition-transform duration-200 ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                      >
                        ▼
                      </span>
                    </button>

                    {/* PLAYERS */}

                    {isExpanded && (
                      <div className="border-t border-slate-800">
                        {sortedPlayers.length === 0 ? (
                          <div className="px-4 py-6 text-center text-xs text-slate-600">
                            ยังไม่มีนักเตะในทีมนี้
                          </div>
                        ) : (
                          sortedPlayers.map((player, index) => {
                            const isEditing = editingPlayerId === player.id;

                            return (
                              <div
                                key={player.id}
                                className="border-b border-slate-800/70 last:border-b-0"
                              >
                                {/* VIEW */}

                                {!isEditing && (
                                  <div className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-900/60">
                                    <div className="flex items-center gap-3 min-w-0">
                                      <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center flex-shrink-0">
                                        <span className="text-green-400 font-black text-sm">
                                          #{player.number}
                                        </span>
                                      </div>

                                      <div className="min-w-0">
                                        <p className="font-bold text-sm text-white truncate">
                                          {player.name}
                                        </p>

                                        <p className="text-[10px] text-slate-500">
                                          ลำดับ {index + 1}
                                        </p>
                                      </div>
                                    </div>

                                    <button
                                      type="button"
                                      onClick={() => handleEditPlayer(player)}
                                      className="flex-shrink-0 text-[11px] font-bold text-green-400 border border-green-500/30 hover:bg-green-500/10 px-3 py-1.5 rounded-lg transition"
                                    >
                                      ✎ Edit
                                    </button>
                                  </div>
                                )}

                                {/* EDIT */}

                                {isEditing && (
                                  <div className="px-4 py-4 bg-slate-900/70">
                                    <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr_auto] gap-2">
                                      <div>
                                        <label className="text-[9px] text-slate-500 block mb-1">
                                          เบอร์เสื้อ
                                        </label>

                                        <input
                                          type="number"
                                          min="0"
                                          value={editPlayerNumber}
                                          onChange={(event) =>
                                            setEditPlayerNumber(
                                              event.target.value,
                                            )
                                          }
                                          className="w-full h-[40px] bg-slate-950 border border-slate-700 rounded-xl px-3 text-sm text-white outline-none focus:border-green-500"
                                        />
                                      </div>

                                      <div>
                                        <label className="text-[9px] text-slate-500 block mb-1">
                                          ชื่อนักเตะ
                                        </label>

                                        <input
                                          type="text"
                                          value={editPlayerName}
                                          onChange={(event) =>
                                            setEditPlayerName(
                                              event.target.value,
                                            )
                                          }
                                          className="w-full h-[40px] bg-slate-950 border border-slate-700 rounded-xl px-3 text-sm text-white outline-none focus:border-green-500"
                                        />
                                      </div>

                                      <div className="flex items-end gap-2">
                                        <button
                                          type="button"
                                          disabled={playerSaving}
                                          onClick={() =>
                                            handleSavePlayer(player.id)
                                          }
                                          className="h-[40px] px-4 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-slate-950 font-black text-xs rounded-xl transition"
                                        >
                                          {playerSaving
                                            ? "กำลังบันทึก..."
                                            : "Save"}
                                        </button>

                                        <button
                                          type="button"
                                          disabled={playerSaving}
                                          onClick={handleCancelEditPlayer}
                                          className="h-[40px] px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>

      {/* ===================================================
          3. MATCHES
      =================================================== */}

      <section className="space-y-4">
        <h2 className="text-green-400 font-black">3. จัดการการแข่งขัน</h2>

        {matches.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-sm text-slate-500">
            ยังไม่มีข้อมูลการแข่งขัน
          </div>
        ) : (
          matches.map((match) => (
            <MatchAdminRow
              key={match.id}
              match={match}
              teams={teams}
              loading={loading}
              onStartMatch={handleStartMatch}
              onFinishMatch={handleFinishMatch}
              onRefresh={fetchData}
              adminAction={adminAction}
            />
          ))
        )}
      </section>
    </div>
  );
}

/* =========================================================
   MATCH ADMIN ROW
========================================================= */

function MatchAdminRow({
  match,
  teams,
  loading,
  onStartMatch,
  onFinishMatch,
  onRefresh,
  adminAction,
}: {
  match: Match;

  teams: Team[];

  loading: boolean;

  onStartMatch: (id: number) => Promise<void>;

  onFinishMatch: (
    id: number,
    homeScore: number,
    awayScore: number,
  ) => Promise<void>;

  onRefresh: () => Promise<void>;

  adminAction: (data: Record<string, unknown>) => Promise<AdminActionResult>;
}) {
  const [homeScore, setHomeScore] = useState(match.home_score ?? 0);

  const [awayScore, setAwayScore] = useState(match.away_score ?? 0);

  const [events, setEvents] = useState<MatchEvent[]>([]);

  const [selectedTeam, setSelectedTeam] = useState(Number(match.home_team_id));

  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);

  const [eventType, setEventType] = useState<
    "GOAL" | "YELLOW_CARD" | "RED_CARD"
  >("GOAL");

  const [minute, setMinute] = useState("");

  const [isEditingFinished, setIsEditingFinished] = useState(false);

  /*
   * สำคัญ:
   * ป้องกัน request ซ้อน
   */

  const [eventSaving, setEventSaving] = useState(false);

  /* =======================================================
     SCORE PROP SYNC
  ======================================================= */

  useEffect(() => {
    setHomeScore(match.home_score ?? 0);

    setAwayScore(match.away_score ?? 0);
  }, [match.home_score, match.away_score]);

  /* =======================================================
     EVENT FETCH
  ======================================================= */

  const fetchEvents = useCallback(async () => {
    const { data, error } = await supabase
      .from("match_events")
      .select(
        `
              *,
              player:player_id(*)
            `,
      )
      .eq("match_id", match.id)
      .order("minute", {
        ascending: true,
      });

    if (error) {
      console.error("EVENT FETCH ERROR:", error);

      return;
    }

    setEvents((data as MatchEvent[]) || []);
  }, [match.id]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  /* =======================================================
     PLAYERS
  ======================================================= */

  const homePlayers =
    teams.find((team) => Number(team.id) === Number(match.home_team_id))
      ?.players || [];

  const awayPlayers =
    teams.find((team) => Number(team.id) === Number(match.away_team_id))
      ?.players || [];

  const activePlayers =
    Number(selectedTeam) === Number(match.home_team_id)
      ? homePlayers
      : awayPlayers;

  /* =======================================================
     CAN EDIT
  ======================================================= */

  const canEditMatch =
    match.status === "LIVE" ||
    (match.status === "FINISHED" && isEditingFinished);

  /* =======================================================
     SORT EVENT
  ======================================================= */

  function sortEvents(eventList: MatchEvent[]) {
    return [...eventList].sort((a, b) => {
      const minuteA = a.minute ?? 9999;

      const minuteB = b.minute ?? 9999;

      if (minuteA !== minuteB) {
        return minuteA - minuteB;
      }

      return Number(a.id) - Number(b.id);
    });
  }

  /* =======================================================
     ADD EVENT
  ======================================================= */

  async function handleAddEvent() {
    if (!canEditMatch) {
      if (match.status === "FINISHED") {
        alert("กรุณากด Edit Match ก่อนแก้ไขข้อมูล");
      } else {
        alert("ต้อง Start Match ก่อน");
      }

      return;
    }

    if (!selectedPlayer) {
      alert("กรุณาเลือกนักเตะ");

      return;
    }

    if (eventSaving) {
      return;
    }

    const playerId = Number(selectedPlayer);

    const selectedPlayerData = activePlayers.find(
      (player) => Number(player.id) === playerId,
    );

    setEventSaving(true);

    try {
      /* ---------------------------------------------------
         CALL API
      --------------------------------------------------- */

      const result = await adminAction({
        action: "ADD_EVENT",

        matchId: match.id,

        teamId: selectedTeam,

        playerId,

        eventType,

        minute: minute === "" ? null : Number(minute),
      });

      /* ---------------------------------------------------
         SCORE UPDATE IMMEDIATELY
      --------------------------------------------------- */

      if (typeof result.home_score === "number") {
        setHomeScore(result.home_score);
      }

      if (typeof result.away_score === "number") {
        setAwayScore(result.away_score);
      }

      /* ---------------------------------------------------
         EVENT UPDATE IMMEDIATELY
      --------------------------------------------------- */

      if (result.event) {
        const newEvent: MatchEvent = {
          ...result.event,

          player: result.event.player || selectedPlayerData,
        };

        setEvents((currentEvents) => {
          const exists = currentEvents.some(
            (event) => Number(event.id) === Number(newEvent.id),
          );

          if (exists) {
            return currentEvents;
          }

          return sortEvents([...currentEvents, newEvent]);
        });
      }

      /*
       * Clear form ทันที
       */

      setSelectedPlayer(null);

      setMinute("");

      /* ---------------------------------------------------
         CONFIRM DATABASE

         UI เปลี่ยนไปแล้ว
         ส่วนนี้เป็น sync ความถูกต้อง
      --------------------------------------------------- */

      await Promise.all([fetchEvents(), onRefresh()]);
    } catch (error) {
      console.error("ADD EVENT ERROR:", error);

      /*
       * ถ้า fail
       * โหลดข้อมูลจริงกลับมา
       */

      await Promise.all([fetchEvents(), onRefresh()]);

      alert(error instanceof Error ? error.message : "เกิดข้อผิดพลาด");
    } finally {
      setEventSaving(false);
    }
  }

  /* =======================================================
     DELETE EVENT
  ======================================================= */

  async function handleDeleteEvent(event: MatchEvent) {
    if (!canEditMatch) {
      if (match.status === "FINISHED") {
        alert("กรุณากด Edit Match ก่อนแก้ไขข้อมูล");
      } else {
        alert("สามารถแก้ไข Event ได้หลังเริ่มการแข่งขันเท่านั้น");
      }

      return;
    }

    if (eventSaving) {
      return;
    }

    const eventName =
      event.event_type === "GOAL"
        ? "ประตู"
        : event.event_type === "YELLOW_CARD"
          ? "ใบเหลือง"
          : "ใบแดง";

    const confirmed = window.confirm(
      `ยืนยันลบ ${eventName} ของ ${event.player?.name || "นักเตะ"} ?`,
    );

    if (!confirmed) {
      return;
    }

    /*
     * Save state เดิม
     * กรณี API fail
     */

    const previousEvents = [...events];

    /*
     * Optimistic UI:
     * ลบ Event ออกจากจอทันที
     */

    setEvents((currentEvents) =>
      currentEvents.filter((item) => Number(item.id) !== Number(event.id)),
    );

    setEventSaving(true);

    try {
      const result = await adminAction({
        action: "DELETE_EVENT",

        eventId: event.id,
      });

      /*
       * SCORE UPDATE IMMEDIATELY
       */

      if (typeof result.home_score === "number") {
        setHomeScore(result.home_score);
      }

      if (typeof result.away_score === "number") {
        setAwayScore(result.away_score);
      }

      /*
       * Confirm DB
       */

      await Promise.all([fetchEvents(), onRefresh()]);
    } catch (error) {
      /*
       * Restore UI
       */

      setEvents(previousEvents);

      await Promise.all([fetchEvents(), onRefresh()]);

      alert(error instanceof Error ? error.message : "เกิดข้อผิดพลาด");
    } finally {
      setEventSaving(false);
    }
  }

  /* =======================================================
     MATCH UI
  ======================================================= */

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
      {/* ===================================================
          MATCH INFO
      =================================================== */}

      <div className="flex flex-col sm:flex-row sm:justify-between gap-1 text-xs text-slate-400">
        <span>Matchday {match.matchday}</span>

        <span>
          {new Date(match.kickoff_time).toLocaleString("th-TH", {
            dateStyle: "medium",

            timeStyle: "short",
          })}
        </span>
      </div>

      {/* ===================================================
          SCORE
      =================================================== */}

      <div className="flex items-center justify-between gap-2">
        {/* HOME */}

        <span className="w-4/12 text-right font-bold text-xs sm:text-sm truncate">
          {match.home?.name}
        </span>

        {/* SCORE */}

        <div className="w-4/12 flex justify-center items-center gap-2">
          <div className="w-11 sm:w-12 h-10 flex items-center justify-center bg-slate-950 border border-slate-800 rounded-lg text-xl font-black text-green-400">
            {homeScore}
          </div>

          <span className="font-black text-slate-500">-</span>

          <div className="w-11 sm:w-12 h-10 flex items-center justify-center bg-slate-950 border border-slate-800 rounded-lg text-xl font-black text-green-400">
            {awayScore}
          </div>
        </div>

        {/* AWAY */}

        <span className="w-4/12 font-bold text-xs sm:text-sm truncate">
          {match.away?.name}
        </span>
      </div>

      {/* ===================================================
          MATCH CONTROL
      =================================================== */}

      <div className="border-t border-slate-800 pt-3 space-y-3">
        <div className="flex justify-between items-center gap-3">
          {/* STATUS */}

          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">
              Match Status
            </div>

            {/* UPCOMING */}

            {match.status === "UPCOMING" && (
              <span className="text-xs font-black text-slate-300">
                ● UPCOMING
              </span>
            )}

            {/* LIVE */}

            {match.status === "LIVE" && (
              <span className="inline-flex items-center gap-1.5 text-xs font-black text-red-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />

                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
                LIVE
              </span>
            )}

            {/* FINISHED */}

            {match.status === "FINISHED" && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-green-400">
                  ✓ FINISHED
                </span>

                {isEditingFinished && (
                  <span className="text-[9px] bg-orange-500/10 border border-orange-500/30 text-orange-400 px-2 py-0.5 rounded-full font-black">
                    EDIT MODE
                  </span>
                )}
              </div>
            )}
          </div>

          {/* UPCOMING CONTROL */}

          {match.status === "UPCOMING" && (
            <button
              disabled={loading}
              onClick={() => onStartMatch(match.id)}
              className="bg-green-500 hover:bg-green-400 text-slate-950 px-4 py-2 rounded-xl text-xs font-black disabled:opacity-50 transition"
            >
              ▶ Start Match
            </button>
          )}

          {/* LIVE CONTROL */}

          {match.status === "LIVE" && (
            <button
              disabled={loading || eventSaving}
              onClick={() =>
                onFinishMatch(
                  match.id,

                  Number(homeScore),

                  Number(awayScore),
                )
              }
              className="bg-red-500 hover:bg-red-400 text-white px-4 py-2 rounded-xl text-xs font-black disabled:opacity-50 transition"
            >
              ■ Finish Match
            </button>
          )}

          {/* FINISHED CONTROL */}

          {match.status === "FINISHED" && (
            <div className="flex items-center gap-2">
              {!isEditingFinished ? (
                <button
                  type="button"
                  onClick={() => setIsEditingFinished(true)}
                  className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-orange-400 px-4 py-2 rounded-xl text-xs font-black transition"
                >
                  ✎ Edit Match
                </button>
              ) : (
                <button
                  type="button"
                  disabled={eventSaving}
                  onClick={() => setIsEditingFinished(false)}
                  className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-slate-950 px-4 py-2 rounded-xl text-xs font-black transition"
                >
                  ✓ Finish Editing
                </button>
              )}
            </div>
          )}
        </div>

        {/* EDIT WARNING */}

        {match.status === "FINISHED" && isEditingFinished && (
          <div className="bg-orange-950/20 border border-orange-500/20 rounded-xl px-3 py-2 text-[10px] text-orange-300">
            ⚠ กำลังแก้ไข Match ที่จบการแข่งขันแล้ว การเพิ่มหรือลบ Goal จะคำนวณ
            Score ใหม่อัตโนมัติ และการแก้ Yellow / Red จะคำนวณโทษแบนใหม่
          </div>
        )}
      </div>

      {/* ===================================================
          EVENT CONTROL
      =================================================== */}

      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-bold text-slate-400">
            ⚽ 🟨 🟥 บันทึกเหตุการณ์
          </div>

          {eventSaving && (
            <span className="text-[10px] text-green-400 animate-pulse">
              กำลังอัปเดต...
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-2">
          {/* TEAM */}

          <div className="md:col-span-3">
            <select
              disabled={!canEditMatch || eventSaving}
              value={selectedTeam}
              onChange={(event) => {
                setSelectedTeam(Number(event.target.value));

                setSelectedPlayer(null);
              }}
              className="w-full h-[36px] bg-slate-900 border border-slate-800 rounded-xl px-2 text-xs text-white outline-none focus:border-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value={match.home_team_id}>{match.home?.name}</option>

              <option value={match.away_team_id}>{match.away?.name}</option>
            </select>
          </div>

          {/* PLAYER */}

          <div className="md:col-span-3">
            <select
              disabled={!canEditMatch || eventSaving}
              value={selectedPlayer ?? ""}
              onChange={(event) =>
                setSelectedPlayer(event.target.value || null)
              }
              className="w-full h-[36px] bg-slate-900 border border-slate-800 rounded-xl px-2 text-xs text-white outline-none focus:border-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">-- เลือกนักเตะ --</option>

              {[...activePlayers]
                .sort(
                  (a, b) =>
                    Number(a.number) - Number(b.number) ||
                    a.name.localeCompare(b.name),
                )
                .map((player) => (
                  <option key={player.id} value={String(player.id)}>
                    {player.number} {player.name}
                  </option>
                ))}
            </select>
          </div>

          {/* EVENT TYPE */}

          <div className="md:col-span-2">
            <select
              disabled={!canEditMatch || eventSaving}
              value={eventType}
              onChange={(event) =>
                setEventType(
                  event.target.value as "GOAL" | "YELLOW_CARD" | "RED_CARD",
                )
              }
              className="w-full h-[36px] bg-slate-900 border border-slate-800 rounded-xl px-2 text-xs text-white outline-none focus:border-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="GOAL">⚽ Goal</option>

              <option value="YELLOW_CARD">🟨 Yellow</option>

              <option value="RED_CARD">🟥 Red</option>
            </select>
          </div>

          {/* MINUTE */}

          <div className="md:col-span-2">
            <input
              disabled={!canEditMatch || eventSaving}
              type="number"
              min="0"
              placeholder="นาที"
              value={minute}
              onChange={(event) => setMinute(event.target.value)}
              className="w-full h-[36px] bg-slate-900 border border-slate-800 rounded-xl px-3 text-xs text-white outline-none focus:border-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* SAVE */}

          <div className="md:col-span-2">
            <button
              disabled={!canEditMatch || !selectedPlayer || eventSaving}
              onClick={handleAddEvent}
              className={`w-full h-[36px] rounded-xl font-black text-xs transition ${
                canEditMatch && selectedPlayer && !eventSaving
                  ? "bg-green-500 hover:bg-green-400 text-slate-950"
                  : "bg-slate-900 text-slate-600 cursor-not-allowed"
              }`}
            >
              {eventSaving
                ? "กำลังบันทึก..."
                : canEditMatch
                  ? "+ บันทึก"
                  : match.status === "FINISHED"
                    ? "กด Edit Match ก่อน"
                    : "ยังไม่เริ่ม"}
            </button>
          </div>
        </div>

        {/* =================================================
            EVENT LIST
        ================================================= */}

        <div className="flex flex-wrap gap-2 pt-1">
          {events.length === 0 ? (
            <span className="text-[10px] text-slate-600">
              ยังไม่มีเหตุการณ์
            </span>
          ) : (
            events.map((event) => (
              <div
                key={event.id}
                className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs flex items-center gap-1"
              >
                <span>
                  {event.event_type === "GOAL"
                    ? "⚽"
                    : event.event_type === "YELLOW_CARD"
                      ? "🟨"
                      : "🟥"}
                </span>

                <span className="text-slate-200">
                  No. {event.player?.number} {event.player?.name}
                  {event.minute !== null && event.minute !== undefined
                    ? ` (${event.minute}')`
                    : ""}
                </span>

                {canEditMatch && (
                  <button
                    type="button"
                    disabled={eventSaving}
                    onClick={() => handleDeleteEvent(event)}
                    className="text-red-400 hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed font-black ml-1"
                  >
                    ×
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
