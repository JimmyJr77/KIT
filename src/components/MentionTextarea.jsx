import { Fragment, useEffect, useRef, useState } from 'react';
import { Users } from 'lucide-react';
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

// Teams: "@Marketing" reaches everyone on the team.
let teamCache = null;
let teamPending = null;
function useMentionTeams() {
  const [teams, setTeams] = useState(teamCache || []);
  useEffect(() => {
    if (teamCache) return;
    teamPending ||= api.get('/teams').then((d) => (teamCache = d.teams));
    teamPending.then(setTeams).catch(() => {});
  }, []);
  return teams;
}

const people = (n) => (n === 1 ? '1 person' : n ? `${n} people` : 'no one on it');

// "@" at the start or after a space, then a letter, then up to one more word (for a last name or a two-word team).
const QUERY = /(^|\s)@([A-Za-z][\w.'-]*(?: [A-Za-z][\w.'-]*)?)$/;

/**
 * A textarea that suggests teams and people when you type "@" and a letter. Picking a person inserts "@First Last";
 * picking a team inserts "@Team Name", which alerts everyone on that team. Teams come first and say how many they reach.
 * Accepts the usual textarea props; `inputRef` reaches the textarea itself.
 */
export default function MentionTextarea({ value, onChange, onKeyDown, inputRef, className = '', ...rest }) {
  const users = useMentionUsers();
  const teams = useMentionTeams();
  const own = useRef(null);
  const ref = inputRef || own;
  const [query, setQuery] = useState(null); // { text, start } where start is the "@" position
  const [active, setActive] = useState(0);

  const matches = query
    ? [
      ...teams.filter((t) => t.name.toLowerCase().startsWith(query.text.toLowerCase()))
        .map((t) => ({ ...t, team: true, members: users.filter((u) => u.team_ids?.includes(t.id)).length })),
      ...users.filter((u) => {
        const q = query.text.toLowerCase();
        return fullName(u).toLowerCase().includes(q) || u.username?.toLowerCase().startsWith(q);
      }),
    ].slice(0, 6)
    : [];

  const readQuery = (el) => {
    const before = el.value.slice(0, el.selectionStart);
    const m = before.match(QUERY);
    setQuery(m ? { text: m[2], start: before.length - m[2].length - 1 } : null);
    setActive(0);
  };

  const pick = (u) => {
    const el = ref.current;
    const insert = `@${u.team ? u.name : fullName(u)} `;
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
        <ul role="listbox" className="absolute left-2 z-[60] mt-1 w-80 overflow-hidden rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200">
          {matches.map((u, i) => (
            <li key={`${u.team ? 't' : 'u'}${u.id}`} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(u); }} onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left ${i === active ? 'bg-brand-50' : ''}`}>
                {u.team
                  ? <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700"><Users size={11} /></span>
                  : <Avatar user={u} size="xs" />}
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{u.team ? u.name : fullName(u)}</span>
                {u.team
                  ? <span className="shrink-0 rounded-full bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">Team · {people(u.members)}</span>
                  : <span className="truncate text-[11px] text-slate-400">{u.team_name || u.title}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const escape = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Text with each "@First Last" and "@Team Name" mention highlighted, read the way the server reads them: the longest
 * name wins, and a team name has to stand alone ("@BDs" and "press@marketing.example" aren't mentions).
 */
export function MentionText({ text }) {
  const users = useMentionUsers();
  const teams = useMentionTeams();
  if (!text || !text.includes('@') || !(users.length || teams.length)) return text;
  const persons = new Set(users.map((u) => fullName(u).toLowerCase()));
  const names = [
    ...users.map((u) => ({ n: fullName(u), re: escape(fullName(u)) })),
    ...teams.map((t) => ({ n: t.name, re: `${escape(t.name)}(?!\\w)` })),
  ].sort((a, b) => b.n.length - a.n.length); // a stable sort: a person comes before a team of the same length
  const parts = text.split(new RegExp(`(@(?:${names.map((x) => x.re).join('|')}))`, 'gi'));
  return parts.map((p, i) => {
    const glued = i % 2 && !persons.has(p.slice(1).toLowerCase()) && /[\w.+-]$/.test(parts[i - 1]);
    return i % 2 && !glued
      ? <span key={i} className="rounded bg-brand-50 px-0.5 font-medium text-brand-700">{p}</span>
      : <Fragment key={i}>{p}</Fragment>;
  });
}
