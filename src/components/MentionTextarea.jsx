import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { fullName } from '../lib/format.js';
import Avatar from './Avatar.jsx';

// Everyone who can be mentioned, fetched once and shared by every box.
let cache = null;
let pending = null;
function useMentionUsers() {
  const [users, setUsers] = useState(cache || []);
  useEffect(() => {
    if (cache) return;
    pending ||= api.get('/users').then((d) => (cache = d.users.filter((u) => u.active !== 0)));
    pending.then(setUsers).catch(() => {});
  }, []);
  return users;
}

// "@" at the start or after a space, then a letter, then up to one more word (for a last name).
const QUERY = /(^|\s)@([A-Za-z][\w.'-]*(?: [A-Za-z][\w.'-]*)?)$/;

/**
 * A textarea that suggests people when you type "@" and a letter. Picking one inserts "@First Last".
 * Accepts the usual textarea props; `inputRef` reaches the textarea itself.
 */
export default function MentionTextarea({ value, onChange, onKeyDown, inputRef, className = '', ...rest }) {
  const users = useMentionUsers();
  const own = useRef(null);
  const ref = inputRef || own;
  const [query, setQuery] = useState(null); // { text, start } where start is the "@" position
  const [active, setActive] = useState(0);

  const matches = query
    ? users.filter((u) => {
      const q = query.text.toLowerCase();
      return fullName(u).toLowerCase().includes(q) || u.username?.toLowerCase().startsWith(q);
    }).slice(0, 6)
    : [];

  const readQuery = (el) => {
    const before = el.value.slice(0, el.selectionStart);
    const m = before.match(QUERY);
    setQuery(m ? { text: m[2], start: before.length - m[2].length - 1 } : null);
    setActive(0);
  };

  const pick = (u) => {
    const el = ref.current;
    const insert = `@${fullName(u)} `;
    const next = value.slice(0, query.start) + insert + value.slice(el.selectionStart);
    onChange({ target: { value: next } });
    setQuery(null);
    const caret = query.start + insert.length;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret); });
  };

  const keyDown = (e) => {
    if (matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); return setActive((i) => (i + 1) % matches.length); }
      if (e.key === 'ArrowUp') { e.preventDefault(); return setActive((i) => (i - 1 + matches.length) % matches.length); }
      if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === 'Tab') { e.preventDefault(); return pick(matches[active]); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return setQuery(null); }
    }
    onKeyDown?.(e);
  };

  return (
    <div className="relative">
      <textarea ref={ref} value={value} className={className} {...rest}
        onChange={(e) => { onChange(e); readQuery(e.target); }}
        onKeyDown={keyDown}
        onClick={(e) => readQuery(e.target)}
        onBlur={() => setTimeout(() => setQuery(null), 150)} />
      {matches.length > 0 && (
        <ul role="listbox" className="absolute left-2 z-[60] mt-1 w-64 overflow-hidden rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200">
          {matches.map((u, i) => (
            <li key={u.id} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(u); }} onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left ${i === active ? 'bg-brand-50' : ''}`}>
                <Avatar user={u} size="xs" />
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{fullName(u)}</span>
                <span className="truncate text-[11px] text-slate-400">{u.team_name || u.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Text with each "@First Last" mention highlighted. */
export function MentionText({ text }) {
  const users = useMentionUsers();
  if (!text || !text.includes('@') || !users.length) return text;
  const names = users.map((u) => fullName(u)).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(@(?:${names.join('|')}))`, 'gi'));
  return parts.map((p, i) => (i % 2
    ? <span key={i} className="rounded bg-brand-50 px-0.5 font-medium text-brand-700">{p}</span>
    : <Fragment key={i}>{p}</Fragment>));
}
