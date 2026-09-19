"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

/* =========================================================
   TYPES
========================================================= */

type NotificationType =
  | "MATCH_START"
  | "MATCH_FINISH"
  | "GOAL"
  | "YELLOW_CARD"
  | "RED_CARD"
  | "SUSPENSION";

interface LiveNotification {
  id: string;

  type: NotificationType;

  title: string;

  message: string;

  /* PLAYER EVENT */

  playerName?: string;

  playerNumber?: number | null;

  teamName?: string | null;

  minute?: number | null;

  /* MATCH EVENT */

  homeTeamName?: string | null;

  awayTeamName?: string | null;

  homeScore?: number | null;

  awayScore?: number | null;

  matchday?: number | null;
}

/* =========================================================
   COMPONENT
========================================================= */

export default function LiveMatchNotification() {
  const [notification, setNotification] = useState<LiveNotification | null>(
    null,
  );

  const [soundEnabled, setSoundEnabled] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  /*
   * กัน notification เดิมแสดงซ้ำ
   */
  const processedIdsRef = useRef<Set<string>>(new Set());

  /* =======================================================
     ENABLE AUDIO

     Browser มือถือต้องได้รับ interaction
     จาก User อย่างน้อย 1 ครั้ง
  ======================================================= */

  const enableSound = useCallback(async () => {
    try {
      if (typeof window === "undefined") {
        return;
      }

      const AudioContextClass =
        window.AudioContext ||
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;

      if (!AudioContextClass) {
        console.warn("AudioContext ไม่รองรับบน Browser นี้");

        return;
      }

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextClass();
      }

      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
      }

      setSoundEnabled(true);
    } catch (error) {
      console.error("ENABLE SOUND ERROR:", error);
    }
  }, []);

  /* =======================================================
     AUTO UNLOCK AUDIO ON FIRST TOUCH / CLICK
  ======================================================= */

  useEffect(() => {
    async function unlockAudio() {
      await enableSound();

      document.removeEventListener("pointerdown", unlockAudio);

      document.removeEventListener("touchstart", unlockAudio);
    }

    document.addEventListener("pointerdown", unlockAudio, {
      once: true,
    });

    document.addEventListener("touchstart", unlockAudio, {
      once: true,
    });

    return () => {
      document.removeEventListener("pointerdown", unlockAudio);

      document.removeEventListener("touchstart", unlockAudio);
    };
  }, [enableSound]);

  /* =======================================================
     PLAY SOUND
  ======================================================= */

  const playNotificationSound = useCallback(
    (type: NotificationType) => {
      try {
        const context = audioContextRef.current;

        if (!context || !soundEnabled) {
          return;
        }

        if (context.state !== "running") {
          return;
        }

        const oscillator = context.createOscillator();

        const gain = context.createGain();

        oscillator.connect(gain);

        gain.connect(context.destination);

        oscillator.type = "sine";

        /*
         * ปรับเสียงตาม Event
         */

        let startFrequency = 880;

        let endFrequency = 1320;

        let duration = 0.4;

        if (type === "MATCH_START") {
          startFrequency = 700;

          endFrequency = 1100;

          duration = 0.5;
        }

        if (type === "MATCH_FINISH") {
          startFrequency = 900;

          endFrequency = 600;

          duration = 0.55;
        }

        if (type === "GOAL") {
          startFrequency = 900;

          endFrequency = 1600;

          duration = 0.55;
        }

        if (type === "YELLOW_CARD") {
          startFrequency = 700;

          endFrequency = 850;

          duration = 0.35;
        }

        if (type === "RED_CARD") {
          startFrequency = 500;

          endFrequency = 300;

          duration = 0.55;
        }

        if (type === "SUSPENSION") {
          startFrequency = 600;

          endFrequency = 350;

          duration = 0.6;
        }

        oscillator.frequency.setValueAtTime(
          startFrequency,
          context.currentTime,
        );

        oscillator.frequency.exponentialRampToValueAtTime(
          endFrequency,
          context.currentTime + duration * 0.45,
        );

        gain.gain.setValueAtTime(0.0001, context.currentTime);

        gain.gain.exponentialRampToValueAtTime(
          0.25,
          context.currentTime + 0.02,
        );

        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          context.currentTime + duration,
        );

        oscillator.start();

        oscillator.stop(context.currentTime + duration + 0.05);
      } catch (error) {
        console.error("PLAY SOUND ERROR:", error);
      }
    },
    [soundEnabled],
  );

  /* =======================================================
     VIBRATION
  ======================================================= */

  const vibrate = useCallback((type: NotificationType) => {
    if (typeof navigator === "undefined") {
      return;
    }

    if (!("vibrate" in navigator)) {
      return;
    }

    try {
      if (type === "MATCH_START") {
        navigator.vibrate([250, 100, 250]);

        return;
      }

      if (type === "MATCH_FINISH") {
        navigator.vibrate([300, 120, 300, 120, 300]);

        return;
      }

      if (type === "GOAL") {
        navigator.vibrate([200, 100, 200, 100, 300]);

        return;
      }

      if (type === "YELLOW_CARD") {
        navigator.vibrate([150, 100, 150]);

        return;
      }

      if (type === "RED_CARD") {
        navigator.vibrate([400, 150, 400]);

        return;
      }

      if (type === "SUSPENSION") {
        navigator.vibrate([300, 150, 300, 150, 300]);
      }
    } catch (error) {
      console.error("VIBRATION ERROR:", error);
    }
  }, []);

  /* =======================================================
     SHOW POPUP
  ======================================================= */

  const showNotification = useCallback(
    (data: LiveNotification) => {
      /*
       * ป้องกัน notification ซ้ำ
       */

      if (processedIdsRef.current.has(data.id)) {
        return;
      }

      processedIdsRef.current.add(data.id);

      /*
       * ป้องกัน Set โตไม่หยุด
       */

      if (processedIdsRef.current.size > 200) {
        const ids = Array.from(processedIdsRef.current);

        processedIdsRef.current = new Set(ids.slice(-100));
      }

      /*
       * แสดง Popup
       */

      setNotification(data);

      /*
       * Sound
       */

      playNotificationSound(data.type);

      /*
       * Vibration
       */

      vibrate(data.type);

      /*
       * เคลียร์ timer เก่า
       */

      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }

      /*
       * ปิดอัตโนมัติ 5 วินาที
       */

      closeTimerRef.current = setTimeout(() => {
        setNotification(null);
      }, 5000);
    },
    [playNotificationSound, vibrate],
  );

  /* =======================================================
     MATCH STATUS REALTIME

     UPCOMING -> LIVE
     LIVE -> FINISHED
  ======================================================= */

  useEffect(() => {
    const matchChannel = supabase
      .channel("public-live-match-status")

      .on(
        "postgres_changes",
        {
          event: "UPDATE",

          schema: "public",

          table: "matches",
        },

        async (payload) => {
          try {
            const oldRow = payload.old as {
              id?: number;

              status?: string;
            };

            const newRow = payload.new as {
              id: number;

              matchday: number;

              home_team_id: number;

              away_team_id: number;

              home_score: number | null;

              away_score: number | null;

              status: "UPCOMING" | "LIVE" | "FINISHED";
            };

            if (!newRow || !newRow.id) {
              return;
            }

            /* -----------------------------------------
                 START MATCH
              ----------------------------------------- */

            const isStart =
              oldRow?.status === "UPCOMING" && newRow.status === "LIVE";

            /* -----------------------------------------
                 FINISH MATCH
              ----------------------------------------- */

            const isFinish =
              oldRow?.status === "LIVE" && newRow.status === "FINISHED";

            /*
             * UPDATE Score จาก Goal
             * จะเป็น LIVE -> LIVE
             *
             * ดังนั้นจะไม่แจ้ง popup ซ้ำ
             */

            if (!isStart && !isFinish) {
              return;
            }

            /* -----------------------------------------
                 LOAD HOME TEAM
              ----------------------------------------- */

            const { data: homeTeam, error: homeError } = await supabase
              .from("teams")
              .select(
                `
                    id,
                    name
                    `,
              )
              .eq("id", newRow.home_team_id)
              .single();

            /* -----------------------------------------
                 LOAD AWAY TEAM
              ----------------------------------------- */

            const { data: awayTeam, error: awayError } = await supabase
              .from("teams")
              .select(
                `
                    id,
                    name
                    `,
              )
              .eq("id", newRow.away_team_id)
              .single();

            if (homeError || awayError) {
              console.error(
                "MATCH NOTIFICATION TEAM ERROR:",
                homeError || awayError,
              );

              return;
            }

            /* -----------------------------------------
                 START NOTIFICATION
              ----------------------------------------- */

            if (isStart) {
              showNotification({
                id: `match-start-${newRow.id}-${Date.now()}`,

                type: "MATCH_START",

                title: "🔴 MATCH STARTED",

                message: "เริ่มการแข่งขันแล้ว",

                homeTeamName: homeTeam?.name ?? null,

                awayTeamName: awayTeam?.name ?? null,

                matchday: newRow.matchday,

                homeScore: newRow.home_score,

                awayScore: newRow.away_score,
              });

              return;
            }

            /* -----------------------------------------
                 FINISH NOTIFICATION
              ----------------------------------------- */

            if (isFinish) {
              showNotification({
                id: `match-finish-${newRow.id}-${Date.now()}`,

                type: "MATCH_FINISH",

                title: "✅ MATCH FINISHED",

                message: "จบการแข่งขัน",

                homeTeamName: homeTeam?.name ?? null,

                awayTeamName: awayTeam?.name ?? null,

                matchday: newRow.matchday,

                homeScore: newRow.home_score,

                awayScore: newRow.away_score,
              });
            }
          } catch (error) {
            console.error("MATCH STATUS NOTIFICATION ERROR:", error);
          }
        },
      )

      .subscribe((status) => {
        console.log("Match notification status:", status);
      });

    return () => {
      supabase.removeChannel(matchChannel);
    };
  }, [showNotification]);

  /* =======================================================
     MATCH EVENT REALTIME

     GOAL
     YELLOW
     RED
  ======================================================= */

  useEffect(() => {
    const eventChannel = supabase
      .channel("public-live-match-events")

      .on(
        "postgres_changes",
        {
          event: "INSERT",

          schema: "public",

          table: "match_events",
        },

        async (payload) => {
          try {
            const row = payload.new as {
              id: number;

              match_id: number;

              team_id: number;

              player_id: number;

              event_type: "GOAL" | "YELLOW_CARD" | "RED_CARD";

              minute: number | null;
            };

            if (!row || !row.id) {
              return;
            }

            /* -----------------------------------------
                 MATCH MUST BE LIVE
              ----------------------------------------- */

            const { data: match, error: matchError } = await supabase
              .from("matches")
              .select(
                `
                    id,
                    status
                    `,
              )
              .eq("id", row.match_id)
              .single();

            if (matchError || !match) {
              console.error("NOTIFICATION MATCH ERROR:", matchError);

              return;
            }

            /*
             * แจ้ง Goal / Card
             * เฉพาะ Match ที่ LIVE
             */

            if (match.status !== "LIVE") {
              return;
            }

            /* -----------------------------------------
                 LOAD PLAYER + TEAM
              ----------------------------------------- */

            const { data: player, error: playerError } = await supabase
              .from("players")
              .select(
                `
                    id,
                    number,
                    name,
                    team_id,

                    team:team_id(
                      id,
                      name
                    )
                    `,
              )
              .eq("id", row.player_id)
              .single();

            if (playerError || !player) {
              console.error("NOTIFICATION PLAYER ERROR:", playerError);

              return;
            }

            const teamValue = player.team as
              | {
                  id: number;

                  name: string;
                }
              | {
                  id: number;

                  name: string;
                }[]
              | null;

            const team = Array.isArray(teamValue) ? teamValue[0] : teamValue;

            /* -----------------------------------------
                 CREATE MESSAGE
              ----------------------------------------- */

            let title = "";

            let message = "";

            /* GOAL */

            if (row.event_type === "GOAL") {
              title = "⚽ GOAL!";

              message =
                row.minute !== null
                  ? `ยิงประตู นาที ${row.minute}'`
                  : "ยิงประตู";
            }

            /* YELLOW */

            if (row.event_type === "YELLOW_CARD") {
              title = "🟨 ใบเหลือง";

              message =
                row.minute !== null
                  ? `ได้รับใบเหลือง นาที ${row.minute}'`
                  : "ได้รับใบเหลือง";
            }

            /* RED */

            if (row.event_type === "RED_CARD") {
              title = "🟥 ใบแดง";

              message =
                row.minute !== null
                  ? `ได้รับใบแดง นาที ${row.minute}'`
                  : "ได้รับใบแดง";
            }

            showNotification({
              id: `event-${row.id}`,

              type: row.event_type,

              title,

              playerName: player.name,

              playerNumber: player.number,

              teamName: team?.name ?? null,

              message,

              minute: row.minute,
            });
          } catch (error) {
            console.error("LIVE EVENT NOTIFICATION ERROR:", error);
          }
        },
      )

      .subscribe((status) => {
        console.log("Live notification event status:", status);
      });

    return () => {
      supabase.removeChannel(eventChannel);
    };
  }, [showNotification]);

  /* =======================================================
     SUSPENSION REALTIME
  ======================================================= */

  useEffect(() => {
    const suspensionChannel = supabase
      .channel("public-live-suspension")

      .on(
        "postgres_changes",
        {
          event: "*",

          schema: "public",

          table: "player_suspensions",
        },

        async (payload) => {
          try {
            const row = payload.new as {
              id: number;

              player_id: number;

              source_match_id: number;

              suspended_match_id: number | null;

              reason: "YELLOW_ACCUMULATION" | "RED_CARD";

              status: "PENDING" | "SERVED" | "CANCELLED";
            };

            /*
             * DELETE ไม่มี new row
             */

            if (!row || !row.id) {
              return;
            }

            /*
             * แจ้งเฉพาะ Pending Ban
             */

            if (row.status !== "PENDING") {
              return;
            }

            /* -----------------------------------------
                 SOURCE MATCH MUST BE LIVE
              ----------------------------------------- */

            const { data: sourceMatch, error: sourceMatchError } =
              await supabase
                .from("matches")
                .select(
                  `
                    id,
                    status
                    `,
                )
                .eq("id", row.source_match_id)
                .single();

            if (sourceMatchError) {
              console.error("SUSPENSION SOURCE MATCH ERROR:", sourceMatchError);

              return;
            }

            if (!sourceMatch || sourceMatch.status !== "LIVE") {
              return;
            }

            /* -----------------------------------------
                 PLAYER
              ----------------------------------------- */

            const { data: player, error: playerError } = await supabase
              .from("players")
              .select(
                `
                    id,
                    number,
                    name,
                    team_id,

                    team:team_id(
                      id,
                      name
                    )
                    `,
              )
              .eq("id", row.player_id)
              .single();

            if (playerError || !player) {
              console.error("SUSPENSION PLAYER ERROR:", playerError);

              return;
            }

            const teamValue = player.team as
              | {
                  id: number;

                  name: string;
                }
              | {
                  id: number;

                  name: string;
                }[]
              | null;

            const team = Array.isArray(teamValue) ? teamValue[0] : teamValue;

            /* -----------------------------------------
                 MATCH ที่โดน BAN
              ----------------------------------------- */

            let suspendedMatchText = "นัดถัดไป";

            if (row.suspended_match_id) {
              const { data: suspendedMatch } = await supabase
                .from("matches")
                .select(
                  `
                      id,
                      matchday
                      `,
                )
                .eq("id", row.suspended_match_id)
                .single();

              if (suspendedMatch) {
                suspendedMatchText = `Matchday ${suspendedMatch.matchday}`;
              }
            }

            /* -----------------------------------------
                 SHOW BAN
              ----------------------------------------- */

            showNotification({
              id: `suspension-${row.id}`,

              type: "SUSPENSION",

              title: "🚫 ติดโทษแบน",

              playerName: player.name,

              playerNumber: player.number,

              teamName: team?.name ?? null,

              message:
                row.reason === "RED_CARD"
                  ? `ใบแดง • แบน ${suspendedMatchText}`
                  : `ใบเหลืองสะสมครบ 3 ใบ • แบน ${suspendedMatchText}`,

              minute: null,
            });
          } catch (error) {
            console.error("SUSPENSION NOTIFICATION ERROR:", error);
          }
        },
      )

      .subscribe((status) => {
        console.log("Suspension notification status:", status);
      });

    return () => {
      supabase.removeChannel(suspensionChannel);
    };
  }, [showNotification]);

  /* =======================================================
     CLEAN TIMER / AUDIO
  ======================================================= */

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }

      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  /* =======================================================
     UI HELPERS
  ======================================================= */

  function getPopupStyle() {
    if (!notification) {
      return "";
    }

    if (notification.type === "MATCH_START") {
      return `
        border-red-500/60
        theme-card
      `;
    }

    if (notification.type === "MATCH_FINISH") {
      return `
        border-green-500/60
        theme-card
      `;
    }

    if (notification.type === "GOAL") {
      return `
        border-green-500/60
        theme-card
      `;
    }

    if (notification.type === "YELLOW_CARD") {
      return `
        border-yellow-500/60
        theme-card
      `;
    }

    if (notification.type === "RED_CARD") {
      return `
        border-red-500/60
        theme-card
      `;
    }

    return `
      border-orange-500/60
      theme-card
    `;
  }

  function getTitleColor() {
    if (!notification) {
      return "";
    }

    if (notification.type === "MATCH_START") {
      return "text-red-400";
    }

    if (notification.type === "MATCH_FINISH") {
      return "text-green-400";
    }

    if (notification.type === "GOAL") {
      return "text-green-400";
    }

    if (notification.type === "YELLOW_CARD") {
      return "text-yellow-400";
    }

    if (notification.type === "RED_CARD") {
      return "text-red-400";
    }

    return "text-orange-400";
  }

  const isMatchNotification =
    notification?.type === "MATCH_START" ||
    notification?.type === "MATCH_FINISH";

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      {/* =================================================
          SOUND BUTTON
      ================================================= */}

      {!soundEnabled && (
        <button
          type="button"
          onClick={enableSound}
          className="
            fixed
            bottom-4
            left-1/2
            -translate-x-1/2
            z-[9998]
            whitespace-nowrap

            bg-slate-900
            border
            border-slate-700
            shadow-2xl

            rounded-full

            px-4
            py-2

            text-[10px]
            sm:text-xs
            text-slate-300
          "
        >
          🔊 แตะเพื่อเปิดเสียงแจ้งเตือน
        </button>
      )}

      {/* =================================================
          LIVE POPUP
      ================================================= */}

      {notification && (
        <div
          className="
            fixed
            inset-x-0

            top-3
            sm:top-5

            z-[9999]

            flex
            justify-center

            px-3

            pointer-events-none
          "
        >
          <div
            className={`
              relative

              w-full
              max-w-sm

              border
              shadow-2xl

              rounded-2xl

              px-4
              py-4

              pointer-events-auto

              animate-[notificationSlide_.25s_ease-out]

              ${getPopupStyle()}
            `}
          >
            {/* ===========================================
                CLOSE
            =========================================== */}

            <button
              type="button"
              onClick={() => {
                setNotification(null);

                if (closeTimerRef.current) {
                  clearTimeout(closeTimerRef.current);
                }
              }}
              className="
                absolute
                right-3
                top-2

                text-slate-500
                hover:text-white

                text-lg
              "
            >
              ×
            </button>

            {/* ===========================================
                LIVE UPDATE LABEL
            =========================================== */}

            <div className="flex items-center gap-1.5 mb-2">
              <span className="relative flex h-2 w-2">
                <span
                  className="
                    absolute
                    inline-flex
                    h-full
                    w-full

                    animate-ping

                    rounded-full

                    bg-red-500

                    opacity-75
                  "
                />

                <span
                  className="
                    relative
                    inline-flex

                    h-2
                    w-2

                    rounded-full

                    bg-red-500
                  "
                />
              </span>

              <span
                className="
                  text-[9px]
                  font-black
                  tracking-widest
                  text-red-400
                "
              >
                LIVE UPDATE
              </span>
            </div>

            {/* ===========================================
                TITLE
            =========================================== */}

            <h3
              className={`
                text-xl
                font-black

                ${getTitleColor()}
              `}
            >
              {notification.title}
            </h3>

            {/* ===========================================
                MATCH START / FINISH
            =========================================== */}

            {isMatchNotification ? (
              <div className="mt-3">
                {/* MATCHDAY */}

                {notification.matchday !== null &&
                  notification.matchday !== undefined && (
                    <p
                      className="
                      text-[10px]
                      text-slate-500
                      font-bold

                      mb-3
                    "
                    >
                      Matchday {notification.matchday}
                    </p>
                  )}

                {/* TEAMS */}

                <div
                  className="
                    grid
                    grid-cols-[1fr_auto_1fr]

                    gap-3

                    items-center
                  "
                >
                  {/* HOME */}

                  <div className="text-right min-w-0">
                    <p
                      className="
                        text-sm
                        sm:text-base

                        font-black

                        text-white

                        break-words
                      "
                    >
                      {notification.homeTeamName || "-"}
                    </p>
                  </div>

                  {/* CENTER */}

                  <div className="text-center">
                    {notification.type === "MATCH_FINISH" ? (
                      <div
                        className="
                          whitespace-nowrap

                          text-lg
                          font-black

                          text-green-400

                          bg-slate-900
                          border
                          border-slate-800

                          rounded-lg

                          px-2
                          py-1
                        "
                      >
                        {notification.homeScore ?? 0}
                        {" - "}
                        {notification.awayScore ?? 0}
                      </div>
                    ) : (
                      <div
                        className="
                          text-xs
                          font-black

                          text-red-400

                          bg-slate-900
                          border
                          border-slate-800

                          rounded-lg

                          px-2
                          py-1
                        "
                      >
                        VS
                      </div>
                    )}
                  </div>

                  {/* AWAY */}

                  <div className="min-w-0">
                    <p
                      className="
                        text-sm
                        sm:text-base

                        font-black

                        text-white

                        break-words
                      "
                    >
                      {notification.awayTeamName || "-"}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              /* =========================================
                 PLAYER EVENT
              ========================================= */

              <div className="mt-2">
                <p className="theme-text text-lg font-black">
                  {notification.playerNumber !== null &&
                    notification.playerNumber !== undefined && (
                      <>
                        No.
                        {notification.playerNumber}{" "}
                      </>
                    )}

                  {notification.playerName || "-"}
                </p>

                {notification.teamName && (
                  <p
                    className="
                      text-xs
                      text-slate-500
                      font-bold
                    "
                  >
                    {notification.teamName}
                  </p>
                )}
              </div>
            )}

            {/* ===========================================
                MESSAGE
            =========================================== */}

            <div className="mt-3 theme-soft border theme-border rounded-xl px-3 py-2">
              <p
                className="
                  text-sm
                  font-bold
                  text-slate-200
                "
              >
                {notification.message}
              </p>
            </div>

            {/* ===========================================
                AUTO CLOSE BAR
            =========================================== */}

            <div
              className="
                mt-3

                h-[2px]

                bg-slate-800

                overflow-hidden

                rounded-full
              "
            >
              <div
                key={notification.id}
                className="
                  h-full

                  bg-green-500

                  animate-[notificationTimer_5s_linear_forwards]
                "
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
