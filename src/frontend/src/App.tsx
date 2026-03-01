import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  type MouseEvent,
  type TouchEvent,
} from "react";
import type { LeaderboardEntry } from "./backend.d.ts";
import { useActor } from "./hooks/useActor";
import { useInternetIdentity } from "./hooks/useInternetIdentity";

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen = "MENU" | "PLAYING" | "ROUND_END" | "GAME_OVER" | "LEADERBOARD";

interface Star {
  x: number;
  y: number;
  radius: number;
  offset: number;
  speed: number;
}

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Balloon {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  escaped: boolean;
  popped: boolean;
  stringOffset: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  radius: number;
  life: number;
  maxLife: number;
}

interface GameState {
  screen: Screen;
  round: number;
  score: number;
  lives: number;
  timeLeft: number;
  streak: number;
  missStreak: number;
  totalMissesThisRound: number;
  perfectStreak: number;
  balloonsPopped: number;
  balloonsEscaped: number;
  balloonsTotal: number;
  roundScore: number;
  finalScore: number;
  roundsSurvived: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BALLOON_COLORS = [
  "#ff4444", // red
  "#ff8c00", // orange
  "#ffdd00", // yellow
  "#00ccff", // cyan
  "#ff69b4", // pink
  "#cc44ff", // purple
  "#44ff88", // lime
];

const INITIAL_STATE: GameState = {
  screen: "MENU",
  round: 1,
  score: 0,
  lives: 3,
  timeLeft: 30,
  streak: 0,
  missStreak: 0,
  totalMissesThisRound: 0,
  perfectStreak: 0,
  balloonsPopped: 0,
  balloonsEscaped: 0,
  balloonsTotal: 0,
  roundScore: 0,
  finalScore: 0,
  roundsSurvived: 0,
};

// ─── Audio ────────────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
    )();
  }
  return audioCtx;
}

function playSound(type: "pop" | "miss" | "escape") {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "pop") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.1);
    } else if (type === "miss") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.08);
    } else if (type === "escape") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    }
  } catch {
    // Audio not available
  }
}

// ─── Seeded RNG ───────────────────────────────────────────────────────────────

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 4294967296;
  };
}

// ─── Game Constants ───────────────────────────────────────────────────────────

function getBalloonCount(round: number) {
  return Math.min(20, 2 + Math.floor(round * 0.5));
}
function getBalloonSpeed(round: number) {
  if (round <= 10) return 1.0 + round * 0.08; // ~1.08–1.8 in early rounds
  if (round <= 30) return 1.8 + (round - 10) * 0.07; // ~1.8–3.2
  if (round <= 60) return 3.2 + (round - 30) * 0.07; // ~3.2–5.3
  return 5.3 + (round - 60) * 0.09;
}
function getBalloonRadius(round: number) {
  return Math.max(12, 30 - round * 0.18);
}
function getFlashlightRadius(round: number) {
  // Scope radius: generous starting radius, very gradual shrink
  return Math.max(60, 160 - round * 0.25);
}
function getObstacleCount(round: number) {
  return Math.min(14, 2 + Math.floor(round / 8));
}
function getRoundTime(round: number) {
  return Math.max(10, 30 - round * 0.18);
}

// ─── Scene Generation ─────────────────────────────────────────────────────────

function generateStars(w: number, h: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < 150; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      radius: Math.random() * 1.5 + 0.3,
      offset: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.8 + 0.3,
    });
  }
  return stars;
}

function generateObstacles(round: number, w: number, h: number): Obstacle[] {
  const count = getObstacleCount(round);
  const rng = seededRandom(round * 7919);
  const obstacles: Obstacle[] = [];
  const margin = 60;

  for (let i = 0; i < count; i++) {
    const ow = 60 + rng() * 80;
    const oh = 20 + rng() * 40;
    const x = margin + rng() * (w - margin * 2 - ow);
    const y = margin + rng() * (h - margin * 2 - oh);
    obstacles.push({ x, y, w: ow, h: oh });
  }
  return obstacles;
}

function spawnBalloon(
  id: number,
  round: number,
  w: number,
  h: number,
): Balloon {
  const edge = Math.floor(Math.random() * 4); // 0=top,1=right,2=bottom,3=left
  const radius = getBalloonRadius(round);
  let x = 0;
  let y = 0;

  if (edge === 0) {
    x = Math.random() * w;
    y = -radius;
  } else if (edge === 1) {
    x = w + radius;
    y = Math.random() * h;
  } else if (edge === 2) {
    x = Math.random() * w;
    y = h + radius;
  } else {
    x = -radius;
    y = Math.random() * h;
  }

  const speed = getBalloonSpeed(round);
  const cx = w / 2;
  const cy = h / 2;
  const dx = cx - x + (Math.random() - 0.5) * w * 0.5;
  const dy = cy - y + (Math.random() - 0.5) * h * 0.5;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const vx = (dx / dist) * speed;
  const vy = (dy / dist) * speed;

  return {
    id,
    x,
    y,
    vx,
    vy,
    radius,
    color: BALLOON_COLORS[Math.floor(Math.random() * BALLOON_COLORS.length)],
    escaped: false,
    popped: false,
    stringOffset: Math.random() * Math.PI * 2,
  };
}

function createParticles(x: number, y: number, color: string): Particle[] {
  const particles: Particle[] = [];
  const count = 12 + Math.floor(Math.random() * 5);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const speed = 2 + Math.random() * 4;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      radius: 2 + Math.random() * 3,
      life: 1,
      maxLife: 1,
    });
  }
  return particles;
}

// ─── Streak Multiplier ────────────────────────────────────────────────────────

function getStreakMultiplier(streak: number): number {
  if (streak >= 4) return 3;
  if (streak === 3) return 2;
  if (streak === 2) return 1.5;
  return 1;
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const { actor } = useActor();
  const { identity, login, clear, isLoggingIn, isInitializing } =
    useInternetIdentity();
  const isAuthenticated = !!identity && !identity.getPrincipal().isAnonymous();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>({ ...INITIAL_STATE });
  const [screenState, setScreenState] = useState<Screen>("MENU");
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);

  // Canvas dimensions
  const [canvasSize, setCanvasSize] = useState({
    w: window.innerWidth,
    h: window.innerHeight,
  });

  // Leaderboard
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [playerName, setPlayerName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [personalBest, setPersonalBest] = useState<bigint | null>(null);
  const [roundEndInfo, setRoundEndInfo] = useState({
    popped: 0,
    escaped: 0,
    roundScore: 0,
    streak: 0,
    lifeGained: false,
    lifeSaved: false,
  });
  const [gameOverInfo, setGameOverInfo] = useState({
    score: 0,
    rounds: 0,
  });

  // Game refs (avoid stale closures in rAF)
  const balloonIdRef = useRef(0);
  const balloonsRef = useRef<Balloon[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const starsRef = useRef<Star[]>([]);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const mouseRef = useRef({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  });
  const shakeRef = useRef({ frames: 0, x: 0, y: 0 });
  const timeRef = useRef(0);
  const lastTimeRef = useRef(0);
  const animFrameRef = useRef(0);
  const roundTimerRef = useRef(0);
  const spawnTimerRef = useRef(0);
  const spawnedCountRef = useRef(0);
  const isPlayingRef = useRef(false);
  const roundEndPendingRef = useRef(false);
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // ─── Resize ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setCanvasSize({ w, h });
      // Also directly update canvas dimensions immediately
      if (canvasRef.current) {
        canvasRef.current.width = w;
        canvasRef.current.height = h;
      }
      starsRef.current = generateStars(w, h);
    };
    window.addEventListener("resize", handleResize);
    starsRef.current = generateStars(window.innerWidth, window.innerHeight);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ─── Start Round ─────────────────────────────────────────────────────────

  const startRound = useCallback((round: number) => {
    const { w, h } = { w: window.innerWidth, h: window.innerHeight };
    obstaclesRef.current = generateObstacles(round, w, h);
    balloonsRef.current = [];
    particlesRef.current = [];
    spawnedCountRef.current = 0;
    spawnTimerRef.current = 0;
    roundTimerRef.current = getRoundTime(round);
    isPlayingRef.current = true;
    roundEndPendingRef.current = false;

    const s = stateRef.current;
    s.timeLeft = getRoundTime(round);
    s.balloonsPopped = 0;
    s.balloonsEscaped = 0;
    s.balloonsTotal = getBalloonCount(round);
    s.roundScore = 0;
    s.streak = 0;
    s.missStreak = 0;
    s.totalMissesThisRound = 0;
  }, []);

  // ─── End Round ────────────────────────────────────────────────────────────

  const endRound = useCallback(() => {
    if (roundEndPendingRef.current) return;
    roundEndPendingRef.current = true;
    isPlayingRef.current = false;

    const s = stateRef.current;
    const isPerfect =
      s.balloonsPopped === s.balloonsTotal &&
      s.balloonsEscaped === 0 &&
      s.totalMissesThisRound === 0;

    let newPerfectStreak = isPerfect ? s.perfectStreak + 1 : 0;
    // Only lose a life if at least one balloon escaped — popping all balloons saves your life
    const allBalloonsPopped =
      s.balloonsEscaped === 0 && s.balloonsPopped === s.balloonsTotal;
    let newLives = allBalloonsPopped ? s.lives : s.lives - 1;
    let lifeGained = false;

    if (newPerfectStreak >= 3) {
      newLives = Math.min(9, newLives + 1);
      newPerfectStreak = 0;
      lifeGained = true;
    }

    s.perfectStreak = newPerfectStreak;
    s.lives = newLives;
    s.roundsSurvived = s.round;

    setRoundEndInfo({
      popped: s.balloonsPopped,
      escaped: s.balloonsEscaped,
      roundScore: s.roundScore,
      streak: s.streak,
      lifeGained,
      lifeSaved: allBalloonsPopped && !lifeGained,
    });

    if (newLives <= 0) {
      s.finalScore = s.score;
      setGameOverInfo({ score: s.score, rounds: s.roundsSurvived });
      setScreenState("GAME_OVER");
      stateRef.current.screen = "GAME_OVER";
    } else {
      setScreenState("ROUND_END");
      stateRef.current.screen = "ROUND_END";

      // Auto advance after 3s
      autoAdvanceTimerRef.current = setTimeout(() => {
        advanceToNextRound();
      }, 3000);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const advanceToNextRound = useCallback(() => {
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    const s = stateRef.current;
    s.round = s.round + 1;
    s.screen = "PLAYING";
    startRound(s.round);
    setScreenState("PLAYING");
  }, [startRound]);

  // ─── Input Handling ───────────────────────────────────────────────────────

  const handleShot = useCallback(
    (clickX: number, clickY: number) => {
      if (!isPlayingRef.current) return;

      const s = stateRef.current;

      // Screen shake
      shakeRef.current = {
        frames: 8,
        x: (Math.random() - 0.5) * 8,
        y: (Math.random() - 0.5) * 8,
      };

      const flashR = getFlashlightRadius(s.round);
      let hit = false;

      for (const b of balloonsRef.current) {
        if (b.popped || b.escaped) continue;
        const dx = b.x - clickX;
        const dy = b.y - clickY;
        const distToClick = Math.sqrt(dx * dx + dy * dy);
        const mx = b.x - mouseRef.current.x;
        const my = b.y - mouseRef.current.y;
        const distToFlash = Math.sqrt(mx * mx + my * my);

        if (distToFlash < flashR && distToClick < b.radius + 10) {
          b.popped = true;
          hit = true;
          s.streak++;
          s.missStreak = 0;
          const multiplier = getStreakMultiplier(s.streak);
          const points = Math.floor(10 * s.round * multiplier);
          s.score += points;
          s.roundScore += points;
          s.balloonsPopped++;
          particlesRef.current.push(...createParticles(b.x, b.y, b.color));
          playSound("pop");
          break;
        }
      }

      if (!hit) {
        playSound("miss");
        s.streak = 0;
        s.missStreak++;
        s.totalMissesThisRound++;
        // Penalty after 3 consecutive misses
        if (s.missStreak > 3) {
          const penalty = 5 * s.round;
          s.score = Math.max(0, s.score - penalty);
          s.roundScore = Math.max(0, s.roundScore - penalty);
        }
      }

      // Check if round should end (all balloons handled)
      const remaining = balloonsRef.current.filter(
        (b) => !b.popped && !b.escaped,
      ).length;
      if (remaining === 0 && spawnedCountRef.current >= s.balloonsTotal) {
        endRound();
      }
    },
    [endRound],
  );

  const getCanvasPos = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: clientX, y: clientY };
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = getCanvasPos(e.clientX, e.clientY);
      mouseRef.current = { x, y };
    },
    [getCanvasPos],
  );

  const handleMouseClick = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = getCanvasPos(e.clientX, e.clientY);
      handleShot(x, y);
    },
    [getCanvasPos, handleShot],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const { x, y } = getCanvasPos(touch.clientX, touch.clientY);
      mouseRef.current = { x, y };
    },
    [getCanvasPos],
  );

  const handleTouchStart = useCallback(
    (e: TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const { x, y } = getCanvasPos(touch.clientX, touch.clientY);
      mouseRef.current = { x, y };
      handleShot(x, y);
    },
    [getCanvasPos, handleShot],
  );

  // ─── Game Loop ────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;

    const loop = (timestamp: number) => {
      if (!running) return;

      const dt = Math.min((timestamp - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = timestamp;
      timeRef.current = timestamp / 1000;

      const w = canvas.width;
      const h = canvas.height;
      const s = stateRef.current;
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      // ── Update ──────────────────────────────────────────────────

      if (
        isPlayingRef.current &&
        s.screen === "PLAYING" &&
        !isPausedRef.current
      ) {
        // Timer
        s.timeLeft -= dt;
        if (s.timeLeft <= 0) {
          s.timeLeft = 0;
          endRound();
        }

        // Spawn balloons with delay
        const spawnDelay = Math.max(0.3, 1.5 - s.round * 0.015);
        spawnTimerRef.current += dt;
        if (
          spawnedCountRef.current < s.balloonsTotal &&
          spawnTimerRef.current >= spawnDelay
        ) {
          spawnTimerRef.current = 0;
          balloonsRef.current.push(
            spawnBalloon(balloonIdRef.current++, s.round, w, h),
          );
          spawnedCountRef.current++;
        }

        // Update balloons
        const obstacles = obstaclesRef.current;
        for (const b of balloonsRef.current) {
          if (b.popped || b.escaped) continue;

          b.x += b.vx;
          b.y += b.vy;

          // Bounce off obstacles
          for (const obs of obstacles) {
            const nearX = Math.max(obs.x, Math.min(b.x, obs.x + obs.w));
            const nearY = Math.max(obs.y, Math.min(b.y, obs.y + obs.h));
            const dx = b.x - nearX;
            const dy = b.y - nearY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < b.radius) {
              if (Math.abs(dx) > Math.abs(dy)) {
                b.vx *= -1;
                b.x += b.vx * 2;
              } else {
                b.vy *= -1;
                b.y += b.vy * 2;
              }
            }
          }

          // Check escape — use actual viewport dimensions for mobile accuracy
          // Very large margin so balloons must travel well off-screen
          // before being counted as escaped, giving the player time to shoot
          const viewW = window.innerWidth;
          const viewH = window.innerHeight;
          const margin = b.radius + 600;
          if (
            b.x < -margin ||
            b.x > viewW + margin ||
            b.y < -margin ||
            b.y > viewH + margin
          ) {
            if (!b.escaped) {
              b.escaped = true;
              s.balloonsEscaped++;
              playSound("escape");
            }
          }
        }

        // Update particles
        for (const p of particlesRef.current) {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.15; // gravity
          p.life -= dt / 0.4;
        }
        particlesRef.current = particlesRef.current.filter((p) => p.life > 0);

        // Check if all spawned balloons are done
        const done = balloonsRef.current.every((b) => b.popped || b.escaped);
        if (
          done &&
          spawnedCountRef.current >= s.balloonsTotal &&
          !roundEndPendingRef.current
        ) {
          endRound();
        }
      }

      // ── Draw ────────────────────────────────────────────────────

      const flashR = getFlashlightRadius(s.round);

      // Apply screen shake
      ctx.save();
      if (shakeRef.current.frames > 0) {
        shakeRef.current.frames--;
        ctx.translate(shakeRef.current.x, shakeRef.current.y);
      }

      // === Step 1: Draw full scene ===
      ctx.fillStyle = "#05060f";
      ctx.fillRect(0, 0, w, h);

      // Stars (full scene)
      const t = timeRef.current;
      for (const star of starsRef.current) {
        const alpha = 0.4 + 0.5 * Math.sin(t * star.speed + star.offset);
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200, 220, 255, ${alpha})`;
        ctx.fill();
      }

      // Obstacles
      for (const obs of obstaclesRef.current) {
        ctx.fillStyle = "#1a1a2e";
        ctx.strokeStyle = "#2a2a4e";
        ctx.lineWidth = 1;
        const r = 6;
        ctx.beginPath();
        ctx.moveTo(obs.x + r, obs.y);
        ctx.lineTo(obs.x + obs.w - r, obs.y);
        ctx.arcTo(obs.x + obs.w, obs.y, obs.x + obs.w, obs.y + r, r);
        ctx.lineTo(obs.x + obs.w, obs.y + obs.h - r);
        ctx.arcTo(
          obs.x + obs.w,
          obs.y + obs.h,
          obs.x + obs.w - r,
          obs.y + obs.h,
          r,
        );
        ctx.lineTo(obs.x + r, obs.y + obs.h);
        ctx.arcTo(obs.x, obs.y + obs.h, obs.x, obs.y + obs.h - r, r);
        ctx.lineTo(obs.x, obs.y + r);
        ctx.arcTo(obs.x, obs.y, obs.x + r, obs.y, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // Balloons
      for (const b of balloonsRef.current) {
        if (b.popped || b.escaped) continue;

        ctx.save();
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 12;

        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.fill();

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(
          b.x - b.radius * 0.3,
          b.y - b.radius * 0.3,
          b.radius * 0.35,
          b.radius * 0.22,
          -Math.PI / 5,
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fill();
        ctx.restore();
        ctx.restore();

        const strLen = b.radius * 1.8;
        const strCtrlX = b.x + Math.sin(t * 2 + b.stringOffset) * 4;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y + b.radius);
        ctx.quadraticCurveTo(
          strCtrlX,
          b.y + b.radius + strLen * 0.5,
          b.x + Math.sin(t + b.stringOffset) * 3,
          b.y + b.radius + strLen,
        );
        ctx.strokeStyle = "rgba(180,180,180,0.6)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Particles
      for (const p of particlesRef.current) {
        const alpha = p.life;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * p.life, 0, Math.PI * 2);
        ctx.fillStyle =
          p.color +
          Math.floor(alpha * 255)
            .toString(16)
            .padStart(2, "0");
        ctx.fill();
      }

      // === Step 2: Darkness overlay (only during gameplay) ===
      if (s.screen === "PLAYING") {
        // Wide feather zone so there's a visible halo around the scope
        const softenRadius = flashR * 0.6; // wider soft feather zone
        const innerR = flashR - softenRadius * 0.2; // fully lit core
        const outerR = flashR + softenRadius; // fully dark past here

        const darkMask = ctx.createRadialGradient(
          mx,
          my,
          innerR,
          mx,
          my,
          outerR,
        );
        darkMask.addColorStop(0, "rgba(0,0,0,0)"); // fully transparent = fully lit
        darkMask.addColorStop(0.4, "rgba(0,0,0,0.35)"); // gentle dim start
        darkMask.addColorStop(0.75, "rgba(0,0,0,0.82)"); // mostly dark
        darkMask.addColorStop(1, "rgba(0,0,0,0.97)"); // nearly black outside

        ctx.fillStyle = darkMask;
        ctx.fillRect(0, 0, w, h);
      }

      // === Step 3: Crosshair ring drawn on top (only during gameplay) ===
      if (s.screen === "PLAYING") {
        ctx.save();

        // Outer scope ring
        ctx.beginPath();
        ctx.arc(mx, my, flashR, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(0,255,136,0.9)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Tick marks outside ring
        ctx.strokeStyle = "rgba(0,255,136,0.95)";
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 4; i++) {
          const angle = (i * Math.PI) / 2;
          ctx.beginPath();
          ctx.moveTo(
            mx + Math.cos(angle) * (flashR + 3),
            my + Math.sin(angle) * (flashR + 3),
          );
          ctx.lineTo(
            mx + Math.cos(angle) * (flashR + 10),
            my + Math.sin(angle) * (flashR + 10),
          );
          ctx.stroke();
        }

        // Center crosshair lines (very small, inside scope)
        ctx.strokeStyle = "rgba(0,255,136,0.45)";
        ctx.lineWidth = 1;
        const crossLen = 7;
        ctx.beginPath();
        ctx.moveTo(mx - crossLen, my);
        ctx.lineTo(mx + crossLen, my);
        ctx.moveTo(mx, my - crossLen);
        ctx.lineTo(mx, my + crossLen);
        ctx.stroke();

        // Center dot
        ctx.beginPath();
        ctx.arc(mx, my, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,255,136,0.8)";
        ctx.fill();

        ctx.restore();
      }

      ctx.restore(); // restore screen shake

      animFrameRef.current = requestAnimationFrame(loop);
    };

    lastTimeRef.current = performance.now();
    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [endRound]);

  // ─── Start Game ───────────────────────────────────────────────────────────

  const startGame = useCallback(() => {
    const fresh: GameState = {
      ...INITIAL_STATE,
      screen: "PLAYING",
    };
    stateRef.current = fresh;
    isPausedRef.current = false;
    setIsPaused(false);
    startRound(1);
    setScreenState("PLAYING");
  }, [startRound]);

  const quitToMenu = useCallback(() => {
    isPlayingRef.current = false;
    isPausedRef.current = false;
    setIsPaused(false);
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    const fresh: GameState = { ...INITIAL_STATE, screen: "MENU" };
    stateRef.current = fresh;
    setScreenState("MENU");
  }, []);

  // ─── Leaderboard ──────────────────────────────────────────────────────────

  const loadLeaderboard = useCallback(async () => {
    if (!actor) return;
    try {
      const entries = await actor.getLeaderboard();
      setLeaderboard(entries);
    } catch {
      setLeaderboard([]);
    }
  }, [actor]);

  const submitScore = useCallback(async () => {
    const name = nameInput.trim();
    if (!name || !actor) return;
    setSubmitting(true);
    try {
      await actor.submitScore(name, BigInt(stateRef.current.finalScore));
      setPlayerName(name);
      const pb = await actor.getPersonalBest(name);
      setPersonalBest(pb);
      await loadLeaderboard();
      setScreenState("LEADERBOARD");
      stateRef.current.screen = "LEADERBOARD";
    } catch {
      // Submit failed, still go to leaderboard
      setScreenState("LEADERBOARD");
      stateRef.current.screen = "LEADERBOARD";
    } finally {
      setSubmitting(false);
    }
  }, [nameInput, actor, loadLeaderboard]);

  const goToLeaderboard = useCallback(async () => {
    await loadLeaderboard();
    setScreenState("LEADERBOARD");
    stateRef.current.screen = "LEADERBOARD";
  }, [loadLeaderboard]);

  // Also load leaderboard on menu
  useEffect(() => {
    if (screenState === "LEADERBOARD") {
      loadLeaderboard();
    }
  }, [screenState, loadLeaderboard]);

  // ─── Computed display values ──────────────────────────────────────────────

  const s = stateRef.current;
  const flashR = getFlashlightRadius(s.round);
  const roundTimeTotal = getRoundTime(s.round);
  const timerPct = Math.max(0, s.timeLeft / roundTimeTotal);
  const multiplier = getStreakMultiplier(s.streak);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="game-canvas-container relative w-screen h-screen overflow-hidden bg-black select-none"
      style={{ fontFamily: "'JetBrains Mono', monospace" }}
    >
      <canvas
        ref={canvasRef}
        width={canvasSize.w}
        height={canvasSize.h}
        className="absolute inset-0"
        onMouseMove={screenState === "PLAYING" ? handleMouseMove : undefined}
        onClick={screenState === "PLAYING" ? handleMouseClick : undefined}
        onKeyDown={
          screenState === "PLAYING"
            ? (e) => {
                if (e.code === "Space" || e.code === "Enter") {
                  handleShot(mouseRef.current.x, mouseRef.current.y);
                }
              }
            : undefined
        }
        onTouchMove={screenState === "PLAYING" ? handleTouchMove : undefined}
        onTouchStart={screenState === "PLAYING" ? handleTouchStart : undefined}
        tabIndex={0}
        style={{ touchAction: "none", outline: "none" }}
      />

      {/* ── HUD overlay (PLAYING only) ── */}
      {screenState === "PLAYING" && (
        <div className="absolute inset-0 pointer-events-none">
          {/* Top row */}
          <div className="absolute top-4 left-0 right-0 flex items-start justify-between px-5">
            {/* Round */}
            <div
              style={{
                color: "#00ff88",
                textShadow: "0 0 8px #00ff88",
                fontSize: "0.75rem",
                letterSpacing: "0.15em",
              }}
            >
              <div
                style={{ opacity: 0.6, fontSize: "0.6rem", marginBottom: 2 }}
              >
                ROUND
              </div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                {s.round}
              </div>
              <div style={{ opacity: 0.5, fontSize: "0.6rem" }}>of 100</div>
            </div>

            {/* Score */}
            <div
              style={{
                color: "#00ff88",
                textShadow: "0 0 8px #00ff88",
                textAlign: "center",
                fontSize: "0.75rem",
                letterSpacing: "0.15em",
              }}
            >
              <div
                style={{ opacity: 0.6, fontSize: "0.6rem", marginBottom: 2 }}
              >
                SCORE
              </div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                {s.score.toLocaleString()}
              </div>
              {multiplier > 1 && (
                <div
                  style={{
                    color: "#ffdd00",
                    textShadow: "0 0 8px #ffdd00",
                    fontSize: "0.7rem",
                    animation: "pulse-glow 1s infinite",
                  }}
                >
                  ×{multiplier} STREAK
                </div>
              )}
            </div>

            {/* Lives + Pause */}
            <div
              style={{
                color: "#ff4444",
                textShadow: "0 0 8px #ff4444",
                textAlign: "right",
                fontSize: "0.75rem",
                letterSpacing: "0.15em",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 4,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* Pause button — pointer-events-auto to be clickable */}
                <button
                  type="button"
                  onClick={() => {
                    isPausedRef.current = true;
                    setIsPaused(true);
                  }}
                  style={{
                    pointerEvents: "auto",
                    background: "rgba(0,255,136,0.08)",
                    border: "1px solid rgba(0,255,136,0.3)",
                    borderRadius: 5,
                    color: "#00ff88",
                    fontSize: "0.65rem",
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: "0.1em",
                    padding: "0.2rem 0.5rem",
                    cursor: "pointer",
                    lineHeight: 1.4,
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "rgba(0,255,136,0.18)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "rgba(0,255,136,0.08)";
                  }}
                >
                  ⏸
                </button>
                <div>
                  <div
                    style={{
                      opacity: 0.6,
                      fontSize: "0.6rem",
                      marginBottom: 2,
                      color: "#00ff88",
                      textShadow: "0 0 8px #00ff88",
                    }}
                  >
                    LIVES
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 4,
                      justifyContent: "flex-end",
                    }}
                  >
                    {([0, 1, 2, 3, 4, 5, 6, 7, 8] as const).map((i) => (
                      <span
                        key={`ls${i}`}
                        style={{
                          fontSize: "1rem",
                          opacity: i < s.lives ? 1 : 0.15,
                          filter:
                            i < s.lives
                              ? "drop-shadow(0 0 4px #ff4444)"
                              : "none",
                        }}
                      >
                        ♥
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              {s.perfectStreak > 0 && (
                <div
                  style={{
                    color: "#ffdd00",
                    textShadow: "0 0 8px #ffdd00",
                    fontSize: "0.6rem",
                    marginTop: 2,
                  }}
                >
                  PERFECT ×{s.perfectStreak}
                </div>
              )}
            </div>
          </div>

          {/* Bottom row */}
          <div className="absolute bottom-0 left-0 right-0">
            {/* Timer bar */}
            <div
              style={{
                height: 4,
                background: "rgba(0,255,136,0.15)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${timerPct * 100}%`,
                  background: timerPct > 0.3 ? "#00ff88" : "#ff4444",
                  boxShadow: `0 0 8px ${timerPct > 0.3 ? "#00ff88" : "#ff4444"}`,
                  transition: "background 0.3s",
                }}
              />
            </div>

            <div className="flex items-end justify-between px-5 pb-5 pt-3">
              {/* Streak indicator */}
              <div style={{ textAlign: "center" }}>
                {s.streak >= 2 && (
                  <div
                    style={{
                      color: "#ffdd00",
                      textShadow: "0 0 12px #ffdd00",
                      fontSize: "0.9rem",
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                    }}
                  >
                    🔥 {s.streak} HIT STREAK
                  </div>
                )}
                {s.missStreak >= 2 && (
                  <div
                    style={{
                      color: "#ff4444",
                      textShadow: "0 0 8px #ff4444",
                      fontSize: "0.8rem",
                      letterSpacing: "0.1em",
                    }}
                  >
                    ✗ {s.missStreak} MISSES
                  </div>
                )}
              </div>

              {/* Flashlight radius indicator */}
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    opacity: 0.6,
                    fontSize: "0.6rem",
                    color: "#00ff88",
                    textShadow: "0 0 8px #00ff88",
                    letterSpacing: "0.15em",
                    marginBottom: 4,
                  }}
                >
                  VISION
                </div>
                <div
                  style={{
                    width: 60,
                    height: 6,
                    borderRadius: 3,
                    background: "rgba(0,255,136,0.15)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${(flashR / 120) * 100}%`,
                      height: "100%",
                      background: "#00cc66",
                      boxShadow: "0 0 4px #00cc66",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PAUSE Overlay ── */}
      {isPaused && screenState === "PLAYING" && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-auto"
          style={{ background: "rgba(5,6,15,0.75)" }}
        >
          <div
            style={{
              background: "rgba(5,6,15,0.96)",
              border: "1px solid rgba(0,255,136,0.35)",
              borderRadius: 12,
              padding: "2rem 2.5rem",
              textAlign: "center",
              minWidth: 260,
              boxShadow:
                "0 0 40px rgba(0,255,136,0.1), inset 0 1px 0 rgba(0,255,136,0.1)",
            }}
          >
            <div
              style={{
                color: "#00ff88",
                textShadow: "0 0 12px #00ff88",
                fontSize: "0.7rem",
                letterSpacing: "0.3em",
                marginBottom: "0.5rem",
              }}
            >
              PAUSED
            </div>
            <div
              style={{
                color: "white",
                fontFamily: "'Bricolage Grotesque', sans-serif",
                fontSize: "2rem",
                fontWeight: 800,
                marginBottom: "2rem",
              }}
            >
              ⏸
            </div>
            <button
              type="button"
              onClick={() => {
                isPausedRef.current = false;
                setIsPaused(false);
              }}
              style={{
                background: "#00ff88",
                color: "#05060f",
                border: "none",
                borderRadius: 6,
                padding: "0.75rem 1rem",
                fontSize: "0.85rem",
                fontWeight: 700,
                letterSpacing: "0.15em",
                cursor: "pointer",
                fontFamily: "'JetBrains Mono', monospace",
                width: "100%",
                marginBottom: "0.6rem",
                boxShadow: "0 0 16px rgba(0,255,136,0.3)",
              }}
            >
              RESUME
            </button>
            <button
              type="button"
              onClick={quitToMenu}
              style={{
                background: "transparent",
                color: "rgba(255,255,255,0.45)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 6,
                padding: "0.65rem 1rem",
                fontSize: "0.75rem",
                letterSpacing: "0.15em",
                cursor: "pointer",
                fontFamily: "'JetBrains Mono', monospace",
                width: "100%",
              }}
            >
              QUIT TO MENU
            </button>
          </div>
        </div>
      )}

      {/* ── MENU Screen ── */}
      {screenState === "MENU" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div
            className="text-center"
            style={{ animation: "fade-in 0.6s ease-out" }}
          >
            <div
              style={{
                fontSize: "clamp(2.5rem, 8vw, 5rem)",
                fontWeight: 800,
                color: "#00ff88",
                textShadow: "0 0 20px #00ff88, 0 0 60px rgba(0,255,136,0.3)",
                letterSpacing: "0.05em",
                fontFamily: "'Bricolage Grotesque', sans-serif",
                lineHeight: 1,
                marginBottom: "0.25em",
              }}
            >
              NIGHT
            </div>
            <div
              style={{
                fontSize: "clamp(2.5rem, 8vw, 5rem)",
                fontWeight: 800,
                color: "#ffffff",
                textShadow: "0 0 20px rgba(255,255,255,0.3)",
                letterSpacing: "0.15em",
                fontFamily: "'Bricolage Grotesque', sans-serif",
                lineHeight: 1,
                marginBottom: "2rem",
              }}
            >
              HUNTER
            </div>

            <div
              style={{
                color: "rgba(0,255,136,0.5)",
                fontSize: "0.75rem",
                letterSpacing: "0.3em",
                marginBottom: "3rem",
              }}
            >
              POP ALL THE BALLOONS TO ADVANCE
            </div>

            <div
              style={{
                background: "rgba(0,255,136,0.05)",
                border: "1px solid rgba(0,255,136,0.2)",
                borderRadius: 8,
                padding: "1.25rem 2rem",
                marginBottom: "2.5rem",
                maxWidth: 360,
                textAlign: "left",
              }}
            >
              {[
                ["MOVE", "Aim your flashlight"],
                ["CLICK", "Fire — unlimited shots"],
                ["SURVIVE", "Pop ALL balloons = life saved!"],
                ["PERFECT", "3 perfect rounds = +1 life"],
              ].map(([key, val]) => (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "2rem",
                    marginBottom: "0.5rem",
                    fontSize: "0.7rem",
                  }}
                >
                  <span
                    style={{ color: "#00ff88", textShadow: "0 0 6px #00ff88" }}
                  >
                    {key}
                  </span>
                  <span style={{ color: "rgba(255,255,255,0.5)" }}>{val}</span>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={startGame}
              style={{
                background: "#00ff88",
                color: "#05060f",
                border: "none",
                borderRadius: 6,
                padding: "0.9rem 3.5rem",
                fontSize: "1rem",
                fontWeight: 700,
                letterSpacing: "0.15em",
                cursor: "pointer",
                fontFamily: "'JetBrains Mono', monospace",
                boxShadow: "0 0 20px rgba(0,255,136,0.4)",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.target as HTMLButtonElement).style.boxShadow =
                  "0 0 40px rgba(0,255,136,0.7)";
                (e.target as HTMLButtonElement).style.transform = "scale(1.04)";
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLButtonElement).style.boxShadow =
                  "0 0 20px rgba(0,255,136,0.4)";
                (e.target as HTMLButtonElement).style.transform = "scale(1)";
              }}
            >
              DEPLOY
            </button>

            <div style={{ marginTop: "1.5rem" }}>
              <button
                type="button"
                onClick={goToLeaderboard}
                style={{
                  background: "transparent",
                  color: "rgba(0,255,136,0.6)",
                  border: "1px solid rgba(0,255,136,0.2)",
                  borderRadius: 6,
                  padding: "0.5rem 1.5rem",
                  fontSize: "0.7rem",
                  letterSpacing: "0.15em",
                  cursor: "pointer",
                  fontFamily: "'JetBrains Mono', monospace",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLButtonElement).style.color = "#00ff88";
                  (e.target as HTMLButtonElement).style.borderColor =
                    "rgba(0,255,136,0.5)";
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLButtonElement).style.color =
                    "rgba(0,255,136,0.6)";
                  (e.target as HTMLButtonElement).style.borderColor =
                    "rgba(0,255,136,0.2)";
                }}
              >
                LEADERBOARD
              </button>
            </div>

            {/* Login / Logout on menu */}
            <div style={{ marginTop: "1rem" }}>
              {isAuthenticated ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      color: "rgba(0,255,136,0.45)",
                      fontSize: "0.6rem",
                      letterSpacing: "0.15em",
                    }}
                  >
                    ● IDENTITY LINKED
                  </div>
                  <button
                    type="button"
                    onClick={clear}
                    style={{
                      background: "transparent",
                      color: "rgba(255,255,255,0.3)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 6,
                      padding: "0.3rem 1rem",
                      fontSize: "0.6rem",
                      letterSpacing: "0.12em",
                      cursor: "pointer",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    LOGOUT
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={login}
                  disabled={isLoggingIn || isInitializing}
                  style={{
                    background: "transparent",
                    color: "rgba(0,255,136,0.4)",
                    border: "1px solid rgba(0,255,136,0.12)",
                    borderRadius: 6,
                    padding: "0.3rem 1.2rem",
                    fontSize: "0.6rem",
                    letterSpacing: "0.12em",
                    cursor:
                      isLoggingIn || isInitializing ? "default" : "pointer",
                    fontFamily: "'JetBrains Mono', monospace",
                    opacity: isLoggingIn || isInitializing ? 0.5 : 1,
                  }}
                >
                  {isLoggingIn || isInitializing
                    ? "CONNECTING..."
                    : "LOGIN TO TRACK SCORES"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── ROUND END overlay ── */}
      {screenState === "ROUND_END" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-auto">
          <div
            style={{
              background: "rgba(5,6,15,0.92)",
              border: "1px solid rgba(0,255,136,0.3)",
              borderRadius: 12,
              padding: "2rem 2.5rem",
              textAlign: "center",
              minWidth: 280,
              animation: "scale-in 0.3s ease-out",
              boxShadow:
                "0 0 40px rgba(0,255,136,0.1), inset 0 1px 0 rgba(0,255,136,0.1)",
            }}
          >
            <div
              style={{
                color: "#00ff88",
                textShadow: "0 0 12px #00ff88",
                fontSize: "0.7rem",
                letterSpacing: "0.3em",
                marginBottom: "0.5rem",
              }}
            >
              ROUND {stateRef.current.round} COMPLETE
            </div>
            <div
              style={{
                color: "white",
                fontSize: "2rem",
                fontWeight: 700,
                marginBottom: "1.5rem",
              }}
            >
              +{roundEndInfo.roundScore.toLocaleString()}
            </div>

            {roundEndInfo.lifeGained && (
              <div
                style={{
                  color: "#ff4444",
                  textShadow: "0 0 12px #ff4444",
                  fontSize: "0.85rem",
                  marginBottom: "1rem",
                  letterSpacing: "0.1em",
                }}
              >
                ♥ BONUS LIFE EARNED!
              </div>
            )}

            {roundEndInfo.lifeSaved && (
              <div
                style={{
                  color: "#00ff88",
                  textShadow: "0 0 12px #00ff88",
                  fontSize: "0.85rem",
                  marginBottom: "1rem",
                  letterSpacing: "0.1em",
                }}
              >
                ✓ ALL CLEAR — LIFE SAVED!
              </div>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.5rem 1.5rem",
                marginBottom: "1.5rem",
              }}
            >
              {[
                ["POPPED", roundEndInfo.popped],
                ["ESCAPED", roundEndInfo.escaped],
                ["STREAK", roundEndInfo.streak],
                ["LIVES LEFT", stateRef.current.lives],
              ].map(([label, val]) => (
                <div key={String(label)} style={{ textAlign: "left" }}>
                  <div
                    style={{
                      color: "rgba(0,255,136,0.5)",
                      fontSize: "0.6rem",
                      letterSpacing: "0.15em",
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      color: "white",
                      fontSize: "1.1rem",
                      fontWeight: 600,
                    }}
                  >
                    {val}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                color: "rgba(0,255,136,0.4)",
                fontSize: "0.65rem",
                marginBottom: "1rem",
              }}
            >
              Auto-advancing in 3s...
            </div>

            <button
              type="button"
              onClick={advanceToNextRound}
              style={{
                background: "#00ff88",
                color: "#05060f",
                border: "none",
                borderRadius: 6,
                padding: "0.7rem 2rem",
                fontSize: "0.85rem",
                fontWeight: 700,
                letterSpacing: "0.15em",
                cursor: "pointer",
                fontFamily: "'JetBrains Mono', monospace",
                width: "100%",
              }}
            >
              NEXT ROUND →
            </button>
          </div>
        </div>
      )}

      {/* ── GAME OVER Screen ── */}
      {screenState === "GAME_OVER" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-auto">
          <div
            style={{
              background: "rgba(5,6,15,0.95)",
              border: "1px solid rgba(255,68,68,0.3)",
              borderRadius: 12,
              padding: "2rem 2.5rem",
              textAlign: "center",
              minWidth: 300,
              animation: "scale-in 0.3s ease-out",
              boxShadow: "0 0 60px rgba(255,68,68,0.1)",
            }}
          >
            <div
              style={{
                color: "#ff4444",
                textShadow: "0 0 12px #ff4444",
                fontSize: "0.7rem",
                letterSpacing: "0.3em",
                marginBottom: "0.5rem",
              }}
            >
              MISSION FAILED
            </div>
            <div
              style={{
                color: "white",
                fontFamily: "'Bricolage Grotesque', sans-serif",
                fontSize: "2.5rem",
                fontWeight: 800,
                marginBottom: "0.25rem",
              }}
            >
              {gameOverInfo.score.toLocaleString()}
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.4)",
                fontSize: "0.7rem",
                letterSpacing: "0.2em",
                marginBottom: "1.5rem",
              }}
            >
              ROUNDS SURVIVED: {gameOverInfo.rounds}
            </div>

            <div
              style={{
                borderTop: "1px solid rgba(255,255,255,0.08)",
                paddingTop: "1.25rem",
                marginBottom: "1rem",
              }}
            >
              <div
                style={{
                  color: "rgba(0,255,136,0.6)",
                  fontSize: "0.65rem",
                  letterSpacing: "0.2em",
                  marginBottom: "0.75rem",
                }}
              >
                SUBMIT SCORE
              </div>

              {!isAuthenticated ? (
                /* Not logged in — prompt II login */
                <div style={{ marginBottom: "0.5rem" }}>
                  <div
                    style={{
                      color: "rgba(255,255,255,0.45)",
                      fontSize: "0.7rem",
                      letterSpacing: "0.08em",
                      marginBottom: "0.75rem",
                      lineHeight: 1.5,
                    }}
                  >
                    Login with Internet Identity to submit your score to the
                    leaderboard.
                  </div>
                  <button
                    type="button"
                    onClick={login}
                    disabled={isLoggingIn || isInitializing}
                    style={{
                      background:
                        isLoggingIn || isInitializing
                          ? "rgba(0,255,136,0.3)"
                          : "#00ff88",
                      color: "#05060f",
                      border: "none",
                      borderRadius: 6,
                      padding: "0.65rem 1rem",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      cursor:
                        isLoggingIn || isInitializing ? "default" : "pointer",
                      fontFamily: "'JetBrains Mono', monospace",
                      width: "100%",
                      marginBottom: "0.5rem",
                    }}
                  >
                    {isLoggingIn || isInitializing
                      ? "CONNECTING..."
                      : "LOGIN WITH INTERNET IDENTITY"}
                  </button>
                </div>
              ) : (
                /* Logged in — show name input + submit */
                <div style={{ marginBottom: "0.5rem" }}>
                  <input
                    type="text"
                    placeholder="ENTER YOUR NAME"
                    maxLength={20}
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitScore()}
                    style={{
                      background: "rgba(0,255,136,0.05)",
                      border: "1px solid rgba(0,255,136,0.3)",
                      borderRadius: 6,
                      padding: "0.6rem 1rem",
                      color: "#00ff88",
                      fontSize: "0.85rem",
                      fontFamily: "'JetBrains Mono', monospace",
                      letterSpacing: "0.1em",
                      width: "100%",
                      outline: "none",
                      marginBottom: "0.75rem",
                      textAlign: "center",
                    }}
                  />
                  <button
                    type="button"
                    onClick={submitScore}
                    disabled={submitting || !nameInput.trim()}
                    style={{
                      background: nameInput.trim()
                        ? "#00ff88"
                        : "rgba(0,255,136,0.15)",
                      color: nameInput.trim()
                        ? "#05060f"
                        : "rgba(0,255,136,0.4)",
                      border: "none",
                      borderRadius: 6,
                      padding: "0.65rem 1rem",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      letterSpacing: "0.15em",
                      cursor: nameInput.trim() ? "pointer" : "default",
                      fontFamily: "'JetBrains Mono', monospace",
                      width: "100%",
                      marginBottom: "0.5rem",
                    }}
                  >
                    {submitting ? "SUBMITTING..." : "SUBMIT & VIEW BOARD"}
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={goToLeaderboard}
                style={{
                  background: "transparent",
                  color: "rgba(0,255,136,0.5)",
                  border: "none",
                  padding: "0.4rem 1rem",
                  fontSize: "0.7rem",
                  letterSpacing: "0.15em",
                  cursor: "pointer",
                  fontFamily: "'JetBrains Mono', monospace",
                  width: "100%",
                }}
              >
                SKIP → VIEW LEADERBOARD
              </button>
            </div>

            <button
              type="button"
              onClick={startGame}
              style={{
                background: "transparent",
                color: "rgba(255,255,255,0.3)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6,
                padding: "0.5rem 1rem",
                fontSize: "0.65rem",
                letterSpacing: "0.2em",
                cursor: "pointer",
                fontFamily: "'JetBrains Mono', monospace",
                width: "100%",
              }}
            >
              PLAY AGAIN
            </button>
          </div>
        </div>
      )}

      {/* ── LEADERBOARD Screen ── */}
      {screenState === "LEADERBOARD" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-auto overflow-y-auto py-8">
          <div
            style={{
              background: "rgba(5,6,15,0.95)",
              border: "1px solid rgba(0,255,136,0.25)",
              borderRadius: 12,
              padding: "2rem",
              width: "min(480px, 90vw)",
              animation: "fade-in 0.4s ease-out",
            }}
          >
            <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
              <div
                style={{
                  color: "#00ff88",
                  textShadow: "0 0 12px #00ff88",
                  fontSize: "0.7rem",
                  letterSpacing: "0.3em",
                  marginBottom: "0.25rem",
                }}
              >
                HALL OF FAME
              </div>
              <div
                style={{
                  color: "white",
                  fontFamily: "'Bricolage Grotesque', sans-serif",
                  fontSize: "1.8rem",
                  fontWeight: 800,
                }}
              >
                LEADERBOARD
              </div>
              {/* Auth status indicator */}
              <div style={{ marginTop: "0.6rem" }}>
                {isAuthenticated ? (
                  <span
                    style={{
                      color: "rgba(0,255,136,0.5)",
                      fontSize: "0.6rem",
                      letterSpacing: "0.15em",
                    }}
                  >
                    ● LOGGED IN WITH INTERNET IDENTITY
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={login}
                    disabled={isLoggingIn || isInitializing}
                    style={{
                      background: "transparent",
                      color: "rgba(0,255,136,0.4)",
                      border: "1px solid rgba(0,255,136,0.15)",
                      borderRadius: 5,
                      padding: "0.25rem 0.85rem",
                      fontSize: "0.6rem",
                      letterSpacing: "0.12em",
                      cursor:
                        isLoggingIn || isInitializing ? "default" : "pointer",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {isLoggingIn || isInitializing
                      ? "CONNECTING..."
                      : "LOGIN TO SUBMIT SCORES"}
                  </button>
                )}
              </div>
            </div>

            {personalBest !== null && playerName && (
              <div
                style={{
                  background: "rgba(0,255,136,0.07)",
                  border: "1px solid rgba(0,255,136,0.25)",
                  borderRadius: 8,
                  padding: "0.75rem 1rem",
                  marginBottom: "1rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    color: "rgba(0,255,136,0.7)",
                    fontSize: "0.7rem",
                    letterSpacing: "0.15em",
                  }}
                >
                  {playerName.toUpperCase()} PERSONAL BEST
                </span>
                <span
                  style={{
                    color: "#00ff88",
                    textShadow: "0 0 8px #00ff88",
                    fontWeight: 700,
                  }}
                >
                  {Number(personalBest).toLocaleString()}
                </span>
              </div>
            )}

            {/* Table header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2.5rem 1fr auto",
                gap: "0 1rem",
                padding: "0.4rem 0.75rem",
                borderBottom: "1px solid rgba(0,255,136,0.15)",
                marginBottom: "0.5rem",
              }}
            >
              {["#", "NAME", "SCORE"].map((h) => (
                <div
                  key={h}
                  style={{
                    color: "rgba(0,255,136,0.5)",
                    fontSize: "0.6rem",
                    letterSpacing: "0.2em",
                    textAlign: h === "SCORE" ? "right" : "left",
                  }}
                >
                  {h}
                </div>
              ))}
            </div>

            {leaderboard.length === 0 ? (
              <div
                style={{
                  color: "rgba(255,255,255,0.3)",
                  textAlign: "center",
                  padding: "2rem",
                  fontSize: "0.75rem",
                  letterSpacing: "0.15em",
                }}
              >
                NO SCORES YET
              </div>
            ) : (
              leaderboard.slice(0, 10).map((entry, i) => {
                const isPlayer = entry.name === playerName;
                const medal =
                  i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
                return (
                  <div
                    key={`${entry.name}-${i}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2.5rem 1fr auto",
                      gap: "0 1rem",
                      padding: "0.6rem 0.75rem",
                      borderRadius: 6,
                      background: isPlayer
                        ? "rgba(0,255,136,0.07)"
                        : i % 2 === 0
                          ? "rgba(255,255,255,0.02)"
                          : "transparent",
                      border: isPlayer
                        ? "1px solid rgba(0,255,136,0.2)"
                        : "1px solid transparent",
                      marginBottom: "0.25rem",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        color:
                          i < 3
                            ? ["#ffd700", "#c0c0c0", "#cd7f32"][i]
                            : "rgba(255,255,255,0.3)",
                        fontSize: i < 3 ? "1rem" : "0.75rem",
                        fontWeight: 600,
                      }}
                    >
                      {medal || `${i + 1}`}
                    </div>
                    <div
                      style={{
                        color: isPlayer ? "#00ff88" : "rgba(255,255,255,0.8)",
                        fontSize: "0.8rem",
                        letterSpacing: "0.05em",
                        textShadow: isPlayer ? "0 0 8px #00ff88" : "none",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {entry.name.toUpperCase()}
                    </div>
                    <div
                      style={{
                        color: isPlayer ? "#00ff88" : "rgba(255,255,255,0.7)",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        textAlign: "right",
                        textShadow: isPlayer ? "0 0 8px #00ff88" : "none",
                      }}
                    >
                      {Number(entry.score).toLocaleString()}
                    </div>
                  </div>
                );
              })
            )}

            <div
              style={{
                borderTop: "1px solid rgba(255,255,255,0.06)",
                marginTop: "1.5rem",
                paddingTop: "1.25rem",
                display: "flex",
                gap: "0.75rem",
              }}
            >
              <button
                type="button"
                onClick={startGame}
                style={{
                  flex: 1,
                  background: "#00ff88",
                  color: "#05060f",
                  border: "none",
                  borderRadius: 6,
                  padding: "0.7rem",
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  letterSpacing: "0.15em",
                  cursor: "pointer",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                PLAY AGAIN
              </button>
              <button
                type="button"
                onClick={() => {
                  stateRef.current.screen = "MENU";
                  setScreenState("MENU");
                }}
                style={{
                  flex: 1,
                  background: "transparent",
                  color: "rgba(0,255,136,0.6)",
                  border: "1px solid rgba(0,255,136,0.2)",
                  borderRadius: 6,
                  padding: "0.7rem",
                  fontSize: "0.8rem",
                  letterSpacing: "0.15em",
                  cursor: "pointer",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                MENU
              </button>
            </div>
          </div>

          <div
            style={{
              marginTop: "1.5rem",
              color: "rgba(255,255,255,0.2)",
              fontSize: "0.6rem",
              letterSpacing: "0.15em",
              textAlign: "center",
            }}
          >
            © {new Date().getFullYear()}. Built with love using{" "}
            <a
              href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "rgba(0,255,136,0.4)", textDecoration: "none" }}
            >
              caffeine.ai
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
