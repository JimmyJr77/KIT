import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Flag, Home, Send, X } from 'lucide-react';
import { api } from '../lib/api.js';
import RaceGame from './RaceGame.jsx';

const PROMPT = 'Tell me how i can improve this site!';
const REPLY = 'Right away, Michael!';
const BUBBLE_MS = 3000;
const CAR_WIDTH = 112; // w-28
const DRAG_START_PX = 4; // a press that moves less than this is a click, not a drag
const PARK_KEY = 'kit.kitt.park';

/** Where the car was last left, and which way it faced: { x, y, flipped }. Nothing saved means his home spot in the sidebar. */
const readPark = () => { try { return JSON.parse(localStorage.getItem(PARK_KEY)) || null; } catch { return null; } };
const writePark = (p) => { try { localStorage.setItem(PARK_KEY, JSON.stringify(p)); } catch { /* private mode */ } };
const clearPark = () => { try { localStorage.removeItem(PARK_KEY); } catch { /* private mode */ } };

/** Keeps the car's top-left corner inside the window. */
const clamp = (x, y, w, h) => ({
  x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - w)),
  y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - h)),
});

/**
 * KITT on every signed-in page. Hovering asks for feedback; clicking opens a short form. What's sent is kept with
 * the page it came from (admins work through it in the Developer section of Admin Access), and KITT answers with a word bubble that goes away on its
 * own. He parks in the sidebar, just above More, until someone drags him somewhere else: he drives the way he's dragged,
 * so pulling him right turns him around, and he stays where he's left, facing that way, between visits. "Send home" on
 * his right-click menu puts him back. The sidebar renders him, and at home he holds his own room there; he is fixed
 * either way, so the sidebar never clips him or his bubbles.
 */
export default function FeedbackWidget() {
  const { pathname, search } = useLocation();
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reply, setReply] = useState(0); // a counter so a second send restarts the bubble
  const [park, setPark] = useState(readPark); // null = home, in the sidebar
  const [menu, setMenu] = useState(false); // the right-click menu
  const [tokens, setTokens] = useState(null); // { tokens, unlimited } for the menu
  const [race, setRace] = useState(false);
  const wrap = useRef(null);
  const [dragging, setDragging] = useState(false);
  const textarea = useRef(null);
  const car = useRef(null);
  const press = useRef(null); // the pointer press in progress: where it began, and whether it became a drag
  const dropped = useRef(false); // the click that follows a drop shouldn't open the form

  useEffect(() => { if (open) textarea.current?.focus(); }, [open]);
  useEffect(() => {
    if (!reply) return undefined;
    const t = setTimeout(() => setReply(0), BUBBLE_MS);
    return () => clearTimeout(t);
  }, [reply]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  // The right-click menu closes on a click anywhere else, or Escape.
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => { if (!wrap.current?.contains(e.target)) setMenu(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenu(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [menu]);
  const openMenu = (e) => {
    e.preventDefault();
    if (press.current?.moved) return;
    setOpen(false);
    setMenu(true);
    api.get('/race').then((r) => setTokens({ tokens: r.tokens, unlimited: r.unlimited })).catch(() => setTokens(null));
  };
  const startRace = () => { setMenu(false); setHover(false); setRace(true); };
  const goHome = () => { setMenu(false); setHover(false); clearPark(); setPark(null); };

  // A smaller window shouldn't leave him parked off-screen.
  useEffect(() => {
    const onResize = () => setPark((p) => {
      if (!p || !car.current) return p;
      const { width, height } = car.current.getBoundingClientRect();
      const c = clamp(p.x, p.y, width, height);
      return c.x === p.x && c.y === p.y ? p : { ...p, ...c };
    });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ---- Dragging the car
  const onPointerDown = (e) => {
    if (e.button !== 0 || !car.current) return;
    const rect = car.current.getBoundingClientRect();
    press.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top, w: rect.width, h: rect.height, lastX: e.clientX, moved: false };
    car.current.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.moved) {
      if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < DRAG_START_PX) return;
      p.moved = true;
      setDragging(true);
      setHover(false);
      setOpen(false);
    }
    const dx = e.clientX - p.lastX;
    p.lastX = e.clientX;
    const at = clamp(e.clientX - p.offsetX, e.clientY - p.offsetY, p.w, p.h);
    // He faces the way he's going: the picture points left, so a pull to the right turns him around.
    setPark((prev) => ({ ...at, flipped: dx > 0 ? true : dx < 0 ? false : !!prev?.flipped }));
  };
  const onPointerUp = (e) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    if (!p.moved) return; // a plain click: onClick opens the form
    dropped.current = true;
    setTimeout(() => { dropped.current = false; }, 0); // the click event lands before this runs
    setDragging(false);
    setHover(e.pointerType === 'mouse'); // the mouse is still over him, so the prompt comes back
    setPark((prev) => { if (prev) writePark(prev); return prev; });
  };
  const onClick = () => {
    if (dropped.current) return;
    toggle();
  };

  const toggle = () => { setOpen((o) => !o); setError(''); };
  const submit = async (e) => {
    e.preventDefault();
    const text = message.trim();
    if (!text) { setError('Type something first'); return; }
    setBusy(true);
    setError('');
    try {
      await api.post('/feedback', { message: text, path: `${pathname}${search}` });
      setMessage('');
      setOpen(false);
      setHover(false);
      setReply((n) => n + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Bubbles and the form hang off the car (above him, or below when he's parked near the top; towards the side of the
  // screen with more room) without taking any room of their own, so he never shifts to make way for them.
  const flipped = !!park?.flipped;
  const onLeft = !park || park.x + CAR_WIDTH / 2 < window.innerWidth / 2; // home is on the left
  const below = !!park && park.y < 240;
  const showPrompt = hover && !open && !reply && !dragging && !menu && !race;
  const bubbleProps = { onLeft, below };
  const style = park ? { left: park.x, top: park.y } : undefined;
  return (
    <>
    {/* At home he has no left or top, so he sits where the sidebar put him, over this stand-in that holds his room. */}
    {!park && <img src="/kitt.webp" alt="" aria-hidden className="invisible block w-28 shrink-0" />}
    <div ref={wrap} style={style}
      className={`fixed z-50 whitespace-normal text-slate-800 print:hidden ${dragging ? 'select-none' : ''}`}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {race && <RaceGame onClose={() => setRace(false)} />}
      <div className={`absolute flex w-max max-w-[calc(100vw-1.5rem)] ${below ? 'top-full flex-col-reverse' : 'bottom-full flex-col'} ${onLeft ? 'left-0 items-start' : 'right-0 items-end'}`}>
        {menu && (
          <div role="menu" className={`${below ? 'mt-1' : 'mb-1'} ${onLeft ? 'ml-6' : 'mr-6'} w-56 rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-lg`}>
            <button type="button" role="menuitem" onClick={startRace} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-semibold text-slate-800 hover:bg-slate-100">
              <Flag size={15} className="text-red-600" /> Race
            </button>
            {!tokens?.unlimited && (
              <p className="px-3 pb-1.5 pt-0.5 text-[11px] text-slate-500">
                {tokens == null ? 'Checking your tokens…' : `${tokens.tokens} token${tokens.tokens === 1 ? '' : 's'} · finish a task to earn one`}
              </p>
            )}
            {park && (
              <button type="button" role="menuitem" onClick={goHome} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-semibold text-slate-800 hover:bg-slate-100">
                <Home size={15} className="text-slate-500" /> Send home
              </button>
            )}
          </div>
        )}
        {showPrompt && (
          <Bubble role="tooltip" className="cursor-pointer" onClick={toggle} {...bubbleProps}>{PROMPT}</Bubble>
        )}
        {reply > 0 && (
          <Bubble key={reply} role="status" className="animate-kitt-bubble font-semibold text-brand-700" {...bubbleProps}>{REPLY}</Bubble>
        )}
        {open && (
          <form onSubmit={submit} className={`${below ? 'mt-1' : 'mb-1'} w-80 max-w-full space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg`} aria-label="Site feedback">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-800">{PROMPT}</span>
              <button type="button" onClick={toggle} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X size={14} /></button>
            </div>
            <textarea ref={textarea} className="input min-h-24 resize-y" placeholder="An issue you hit, or something that would make KIT better…" value={message}
              onChange={(e) => setMessage(e.target.value)} maxLength={4000} disabled={busy}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }} />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">Sent with the page you&apos;re on</span>
              <button type="submit" className="btn-primary px-3 py-1.5 text-xs" disabled={busy || !message.trim()}><Send size={12} /> {busy ? 'Sending…' : 'Send'}</button>
            </div>
          </form>
        )}
      </div>
      <button ref={car} type="button" onClick={onClick} onContextMenu={openMenu} aria-label="Send site feedback" aria-expanded={open} title={open || dragging || menu ? undefined : PROMPT}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        className={`group block touch-none rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}>
        <img src="/kitt.webp" alt="" draggable={false}
          className={`block w-28 drop-shadow-md transition-[filter] group-hover:drop-shadow-lg ${flipped ? '-scale-x-100' : ''} ${dragging ? 'drop-shadow-xl' : ''}`} />
      </button>
    </div>
    </>
  );
}

/** A word bubble by the car, its tail pointing at him: down at the hood, or up at him when he's parked near the top. */
function Bubble({ children, className = '', onLeft = false, below = false, ...rest }) {
  const tail = below
    ? `-top-1.5 border-l border-t ${onLeft ? 'left-5' : 'right-5'}`
    : `-bottom-1.5 border-r border-b ${onLeft ? 'left-5' : 'right-5'}`;
  return (
    <div {...rest} className={`relative ${below ? 'mt-1' : 'mb-1'} ${onLeft ? 'ml-6' : 'mr-6'} max-w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-md ${className}`}>
      {children}
      <span aria-hidden className={`absolute h-3 w-3 rotate-45 border-slate-200 bg-white ${tail}`} />
    </div>
  );
}
