import { useEffect, useRef, useState } from 'react';
import { Flag, Trophy, X, RotateCcw, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { TRACKS, buildCourse, carOutline, touchesWall, strokePath, fmtMs } from '../lib/race.js';

const GOODBYE = 'Good bye, Michael.';
const STEP = 3; // px the car moves between wall checks, so it can't skip through a wall
const EXPLOSION_MS = 900;
const KEYS = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down' };

/**
 * The KITT race, full screen. The lobby lists the three tracks with their best times; a run costs a token (admins race
 * free). On the track, drive with the arrow keys or WASD, or drag the car with the mouse. The car faces the way it
 * goes, left or right. Touch a wall and it's over; cross the finish clean and the time goes on the board.
 */
export default function RaceGame({ onClose, track: initialTrack }) {
  const [info, setInfo] = useState(null);
  const [selected, setSelected] = useState(initialTrack || TRACKS[0].id);
  const [run, setRun] = useState(null); // { track, n } while on the track
  const [error, setError] = useState('');
  const load = () => api.get('/race').then(setInfo).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (run) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, onClose]);

  const start = async (trackId) => {
    setError('');
    try {
      const s = await api.post('/race/start', { track: trackId });
      setInfo((i) => ({ ...i, ...s }));
      setRun({ track: TRACKS.find((t) => t.id === trackId), n: Date.now() });
    } catch (e) {
      setError(e.message);
    }
  };
  const canRace = !!info && (info.unlimited || info.tokens >= info.cost);

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950 text-slate-100" role="dialog" aria-label="KIT Raceway">
      {run ? (
        <Race key={run.n} track={run.track} info={info} canRace={canRace} error={error}
          onAgain={() => start(run.track.id)} onExit={() => { setRun(null); load(); }}
          onResult={(res) => setInfo((i) => ({ ...i, ...res, tracks: i.tracks.map((t) => (t.id === run.track.id ? { ...t, times: res.times, leader: res.times[0] || null, best: Math.min(t.best ?? Infinity, res.ms) } : t)) }))} />
      ) : (
        <Lobby info={info} error={error} selected={selected} onSelect={setSelected} canRace={canRace} onRace={() => start(selected)} onClose={onClose} />
      )}
    </div>
  );
}

function Lobby({ info, error, selected, onSelect, canRace, onRace, onClose }) {
  const { user } = useAuth();
  const track = info?.tracks.find((t) => t.id === selected) || null;
  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Flag className="text-red-500" /> KIT Raceway</h1>
          <p className="mt-1 text-sm text-slate-400">Drive from the start line to the chequered flag as fast as you can. Arrow keys or WASD, or drag the car. Touch a wall and it’s over.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close"><X size={18} /></button>
      </div>
      <Tokens info={info} />
      {error && <p className="text-sm text-red-400">{error}</p>}
      {info && (
        <div className="grid min-h-0 flex-1 gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="space-y-3">
            {info.tracks.map((t) => (
              <button key={t.id} type="button" onClick={() => onSelect(t.id)}
                className={`w-full rounded-xl border p-4 text-left transition ${t.id === selected ? 'border-red-500 bg-slate-900' : 'border-slate-800 bg-slate-900/50 hover:border-slate-600'}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{t.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${{ Easy: 'bg-emerald-900 text-emerald-200', Medium: 'bg-amber-900 text-amber-200', Hard: 'bg-red-900 text-red-200' }[t.difficulty]}`}>{t.difficulty}</span>
                </div>
                <p className="mt-1 text-sm text-slate-400">{t.tagline}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {t.best ? `Your best ${fmtMs(t.best)}` : 'No clean run yet'}{t.leader && ` · Leader ${t.leader.user.name} ${fmtMs(t.leader.ms)}`}
                </p>
              </button>
            ))}
          </div>
          {track && (
            <div className="flex min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 font-semibold"><Trophy size={16} className="text-amber-400" /> Top times · {track.name}</h2>
                <button type="button" onClick={onRace} disabled={!canRace} className="btn-primary bg-red-600 hover:bg-red-500 disabled:opacity-50"><Flag size={15} /> Race</button>
              </div>
              {!canRace && <p className="mt-2 text-xs text-amber-300">No tokens left. Finish a task to earn one; a priority earns five.</p>}
              <Board times={track.times} userId={user?.id} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const Tokens = ({ info }) => info && !info.unlimited && (
  <p className="text-sm text-slate-300">
    <span className="font-semibold text-amber-300">{info.tokens} token{info.tokens === 1 ? '' : 's'}</span> · a race costs {info.cost}. Finish a task to earn one, a priority to earn five.
  </p>
);

/** The track's twenty best, fastest first, with the viewer's own runs picked out. */
function Board({ times, userId, highlight }) {
  if (!times?.length) return <p className="mt-4 text-sm text-slate-500">No clean runs yet. Be the first.</p>;
  return (
    <ol className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto text-sm">
      {times.map((t, i) => (
        <li key={t.id} className={`flex items-center gap-3 rounded-md px-2 py-1 ${t.id === highlight ? 'bg-red-900/60 ring-1 ring-red-500' : t.user.id === userId ? 'bg-slate-800' : ''}`}>
          <span className="w-6 text-right tabular-nums text-slate-500">{i + 1}.</span>
          <span className="flex-1 truncate">{t.user.name}</span>
          <span className="tabular-nums font-semibold">{fmtMs(t.ms)}</span>
        </li>
      ))}
    </ol>
  );
}

/** One run on one track. */
function Race({ track, info, canRace, error, onAgain, onExit, onResult }) {
  const { user } = useAuth();
  const box = useRef(null);
  const canvas = useRef(null);
  const timeEl = useRef(null);
  const g = useRef(null); // the whole game state, outside React so the loop never waits on a render
  const [status, setStatus] = useState('loading'); // loading | ready | running | crashed | finished
  const [crashAt, setCrashAt] = useState(null); // where the car blew up, for the bubble
  const [result, setResult] = useState(null);
  const [showPanel, setShowPanel] = useState(false);

  useEffect(() => {
    const el = box.current;
    const W = Math.floor(el.clientWidth), H = Math.floor(el.clientHeight);
    const img = new Image();
    let raf = 0;
    let alive = true;
    img.onload = () => {
      if (!alive) return;
      const course = buildCourse(track, W, H);
      const outline = carOutline(img, course.carW, course.carH);
      const maxSpeed = course.carW * 5.5;
      const st = {
        course, outline, img, W, H, maxSpeed,
        pos: { ...course.startAt }, vel: { x: 0, y: 0 }, flipped: course.facesRight, keys: new Set(), drag: null,
        status: 'ready', t0: 0, ms: 0, crash: null, particles: [], last: performance.now(),
      };
      g.current = st;
      const c = canvas.current;
      if (import.meta.env.DEV) c.__race = st; // for poking at a run from the console
      const dpr = window.devicePixelRatio || 1;
      c.width = W * dpr;
      c.height = H * dpr;
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      setStatus('ready');

      const begin = (now) => { if (st.status === 'ready') { st.status = 'running'; st.t0 = now; setStatus('running'); } };
      const crash = (now) => {
        st.status = 'crashed';
        st.ms = st.t0 ? Math.round(now - st.t0) : 0;
        st.crash = { x: st.pos.x, y: st.pos.y, at: now };
        st.vel = { x: 0, y: 0 };
        st.drag = null;
        st.particles = Array.from({ length: 42 }, () => {
          const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 300;
          return { vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: 3 + Math.random() * 6, color: ['#fbbf24', '#f97316', '#ef4444', '#fde68a', '#94a3b8'][Math.floor(Math.random() * 5)] };
        });
        setCrashAt({ x: st.pos.x, y: st.pos.y, up: st.pos.y - course.carH / 2 > 72 }); // the bubble goes under the car when there's no room above
        setStatus('crashed');
      };
      const finish = (now) => {
        st.status = 'finished';
        st.ms = Math.round(now - st.t0);
        st.vel = { x: 0, y: 0 };
        st.drag = null;
        setStatus('finished');
      };
      /** Moves the car towards a point in small steps, stopping at the first wall. Returns false when it hit one. */
      const travel = (tx, ty, now) => {
        const sx = st.pos.x, sy = st.pos.y;
        const dx = tx - sx, dy = ty - sy;
        const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / STEP));
        for (let k = 1; k <= n; k++) {
          const x = sx + (dx * k) / n, y = sy + (dy * k) / n;
          if (touchesWall(course, outline, x, y, st.flipped)) { st.pos = { x, y }; crash(now); return false; }
          st.pos = { x, y };
          if (course.pastFinish(x, y)) { finish(now); return false; }
        }
        return true;
      };
      const face = (dx) => { if (dx > 0.5) st.flipped = true; else if (dx < -0.5) st.flipped = false; };

      const step = (dt, now) => {
        if (st.status !== 'ready' && st.status !== 'running') return;
        if (st.drag) return; // the mouse is driving
        const k = st.keys;
        let ix = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0);
        let iy = (k.has('down') ? 1 : 0) - (k.has('up') ? 1 : 0);
        if (ix && iy) { ix *= Math.SQRT1_2; iy *= Math.SQRT1_2; }
        if (ix || iy) begin(now);
        const ease = Math.min(1, dt * 9);
        st.vel.x += (ix * maxSpeed - st.vel.x) * ease;
        st.vel.y += (iy * maxSpeed - st.vel.y) * ease;
        if (Math.hypot(st.vel.x, st.vel.y) < 2) st.vel = { x: 0, y: 0 };
        if (!st.vel.x && !st.vel.y) return;
        face(st.vel.x * dt);
        travel(st.pos.x + st.vel.x * dt, st.pos.y + st.vel.y * dt, now);
      };

      const draw = (now) => {
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, W, H);
        const { path, width } = course;
        strokePath(ctx, path, width + 12, '#f1f5f9');
        strokePath(ctx, path, width + 6, '#dc2626');
        strokePath(ctx, path, width, '#334155');
        ctx.setLineDash([16, 14]);
        strokePath(ctx, path, 2, 'rgba(241,245,249,0.35)');
        ctx.setLineDash([]);
        line(ctx, course.start, course.startDir, width, 4, '#f8fafc');
        chequer(ctx, course.end, course.endDir, width);
        if (st.status !== 'crashed' || now - st.crash.at < 100) {
          ctx.save();
          ctx.translate(st.pos.x, st.pos.y);
          if (st.flipped) ctx.scale(-1, 1);
          ctx.drawImage(img, -course.carW / 2, -course.carH / 2, course.carW, course.carH);
          ctx.restore();
        }
        if (st.status === 'crashed') {
          const age = now - st.crash.at;
          if (age < EXPLOSION_MS) {
            const f = age / EXPLOSION_MS;
            ctx.globalAlpha = 1 - f;
            ctx.fillStyle = '#fde68a';
            ctx.beginPath();
            ctx.arc(st.crash.x, st.crash.y, course.carW * (0.2 + f * 0.9), 0, Math.PI * 2);
            ctx.fill();
            st.particles.forEach((p) => {
              ctx.fillStyle = p.color;
              ctx.beginPath();
              ctx.arc(st.crash.x + (p.vx * age) / 1000, st.crash.y + (p.vy * age) / 1000 + 120 * f * f, p.r * (1 - f), 0, Math.PI * 2);
              ctx.fill();
            });
            ctx.globalAlpha = 1;
          }
        }
        if (timeEl.current) timeEl.current.textContent = fmtMs(st.status === 'running' ? now - st.t0 : st.ms);
      };
      const frame = (now) => {
        const dt = Math.min(0.05, (now - st.last) / 1000);
        st.last = now;
        step(dt, now);
        draw(now);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);

      // ---- Input
      const onKeyDown = (e) => {
        if (e.key === 'Escape') { onExit(); return; }
        const k = KEYS[e.key];
        if (!k) return;
        e.preventDefault();
        st.keys.add(k);
      };
      const onKeyUp = (e) => { const k = KEYS[e.key]; if (k) st.keys.delete(k); };
      const local = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      const onDown = (e) => {
        if (e.button !== 0 || (st.status !== 'ready' && st.status !== 'running')) return;
        const p = local(e);
        if (Math.abs(p.x - st.pos.x) > course.carW / 2 || Math.abs(p.y - st.pos.y) > course.carH / 2) return;
        st.drag = { ox: st.pos.x - p.x, oy: st.pos.y - p.y };
        st.vel = { x: 0, y: 0 };
        st.keys.clear();
        try { c.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer has no capture */ }
      };
      const onMove = (e) => {
        if (!st.drag) return;
        const p = local(e);
        const now = performance.now();
        const tx = p.x + st.drag.ox, ty = p.y + st.drag.oy;
        if (Math.hypot(tx - st.pos.x, ty - st.pos.y) < 0.5) return;
        begin(now);
        face(tx - st.pos.x);
        travel(tx, ty, now);
      };
      const onUp = () => { st.drag = null; };
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      c.addEventListener('pointerdown', onDown);
      c.addEventListener('pointermove', onMove);
      c.addEventListener('pointerup', onUp);
      c.addEventListener('pointercancel', onUp);
      st.cleanup = () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        c.removeEventListener('pointerdown', onDown);
        c.removeEventListener('pointermove', onMove);
        c.removeEventListener('pointerup', onUp);
        c.removeEventListener('pointercancel', onUp);
      };
    };
    img.src = '/kitt.webp';
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      g.current?.cleanup?.();
    };
  }, [track]); // eslint-disable-line react-hooks/exhaustive-deps

  // The result goes on the board; the panel waits for the explosion to settle.
  useEffect(() => {
    if (status === 'finished') {
      api.post('/race/finish', { track: track.id, ms: g.current.ms }).then((res) => { setResult(res); onResult(res); }).catch((e) => setResult({ error: e.message, ms: g.current.ms }));
      setShowPanel(true);
    }
    if (status === 'crashed') {
      const t = setTimeout(() => setShowPanel(true), EXPLOSION_MS + 200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!showPanel) return undefined;
    const onKey = (e) => { if (e.key === 'Enter' && canRace) onAgain(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPanel, canRace, onAgain]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-4 border-b border-slate-800 px-4 text-sm">
        <button type="button" onClick={onExit} className="flex items-center gap-1 text-slate-400 hover:text-white"><ArrowLeft size={15} /> Tracks</button>
        <span className="font-semibold">{track.name}</span>
        <span className="text-slate-500">{track.difficulty}</span>
        <span ref={timeEl} className="ml-auto text-lg font-bold tabular-nums">0.00s</span>
        <span className="text-slate-500">{status === 'ready' ? 'Press an arrow key, or drag the car, to start the clock' : status === 'running' ? 'Go!' : ''}</span>
        <span className="text-xs text-slate-500">{info?.unlimited ? '' : `${info?.tokens ?? 0} token${info?.tokens === 1 ? '' : 's'} · `}Esc to quit</span>
      </div>
      <div ref={box} className="relative min-h-0 flex-1 select-none">
        <canvas ref={canvas} className={`block ${status === 'ready' || status === 'running' ? 'cursor-grab' : ''}`} />
        {crashAt && (
          <div className={`pointer-events-none absolute -translate-x-1/2 ${crashAt.up ? '-translate-y-full' : ''}`}
            style={{ left: crashAt.x, top: crashAt.up ? crashAt.y - g.current.course.carH / 2 - 12 : crashAt.y + g.current.course.carH / 2 + 12 }}>
            <div className="relative rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold whitespace-nowrap text-slate-800 shadow-md">
              {GOODBYE}
              <span aria-hidden className={`absolute left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-slate-200 bg-white ${crashAt.up ? '-bottom-1.5 border-r border-b' : '-top-1.5 border-l border-t'}`} />
            </div>
          </div>
        )}
        {showPanel && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 p-4">
            <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
              {status === 'finished' ? (
                <>
                  <h2 className="flex items-center gap-2 text-xl font-bold"><Flag className="text-emerald-400" /> Clean run · {fmtMs(g.current.ms)}</h2>
                  {result?.error && <p className="mt-1 text-sm text-red-400">{result.error}</p>}
                  {result && !result.error && (
                    <p className="mt-1 text-sm text-slate-300">{result.rank ? `#${result.rank} on ${track.name}` : `Not among the twenty best on ${track.name} this time`}</p>
                  )}
                  {result?.times && <div className="mt-3 max-h-64 overflow-hidden"><Board times={result.times} userId={user?.id} highlight={result.times[(result.rank ?? 0) - 1]?.id} /></div>}
                </>
              ) : (
                <>
                  <h2 className="text-xl font-bold">{GOODBYE}</h2>
                  <p className="mt-1 text-sm text-slate-300">The car touched the wall. Only clean runs count.</p>
                </>
              )}
              {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button type="button" onClick={onAgain} disabled={!canRace} className="btn-primary bg-red-600 hover:bg-red-500 disabled:opacity-50"><RotateCcw size={15} /> Race again{info && !info.unlimited ? ` (${info.cost} token)` : ''}</button>
                <button type="button" onClick={onExit} className="btn"><ArrowLeft size={15} /> Tracks</button>
                {!canRace && <span className="text-xs text-amber-300">No tokens left. Finish a task to earn one.</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A line across the road at a point, square to the road's direction. */
function line(ctx, at, dir, width, thickness, style) {
  const nx = -dir.y, ny = dir.x, h = width / 2;
  ctx.lineCap = 'butt';
  ctx.lineWidth = thickness;
  ctx.strokeStyle = style;
  ctx.beginPath();
  ctx.moveTo(at.x + nx * h, at.y + ny * h);
  ctx.lineTo(at.x - nx * h, at.y - ny * h);
  ctx.stroke();
}

/** The chequered flag across the road at the finish. */
function chequer(ctx, at, dir, width) {
  const nx = -dir.y, ny = dir.x;
  const s = Math.max(6, width / 10);
  const n = Math.ceil(width / s);
  for (let col = 0; col < 2; col++) {
    for (let row = 0; row < n; row++) {
      const u = -width / 2 + row * s;
      const v = -s + col * s;
      ctx.fillStyle = (row + col) % 2 ? '#0f172a' : '#f8fafc';
      ctx.beginPath();
      [[u, v], [u + s, v], [u + s, v + s], [u, v + s]].forEach(([a, b], i) => {
        const x = at.x + nx * a + dir.x * b, y = at.y + ny * a + dir.y * b;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
    }
  }
}
