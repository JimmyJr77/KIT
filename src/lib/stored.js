import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth.jsx';

/*
 * What a person leaves set on a page (filters, search, sort, view) is kept on this browser, under their own user id, so it
 * is still set after a reload or a trip to another page, and two people sharing a browser never see each other's.
 * One key per setting: kit.keep.<user id>.<page>.<setting>. A setting back at its default has no key at all.
 */
const keyFor = (userId, name) => `kit.keep.${userId ?? 'anon'}.${name}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fromStore = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const toStore = (key, entry) => {
  try { if (entry) localStorage.setItem(key, JSON.stringify(entry)); else localStorage.removeItem(key); } catch { /* not kept, still applied */ }
};

/**
 * useState that remembers. `name` is "<page>.<setting>", e.g. "tickets.scope".
 *   valid:  (value) => boolean. A stored value that fails (wrong shape, a choice that's gone) gives the default.
 *   legacy: an older, browser-wide localStorage key to start from when this person has nothing stored yet.
 *   until:  a token stored beside the value; once it changes (say, a new week) the stored value is dropped.
 *   skip:   true to ignore what's stored on this visit (a link that says what to show wins), without wiping it.
 * Setting the value back to its default clears the stored copy.
 */
export function useStored(name, initial, { valid, legacy, until, skip = false } = {}) {
  const { user } = useAuth() || {};
  const key = keyFor(user?.id, name);
  const fallback = useRef(typeof initial === 'function' ? initial() : initial).current;
  const ok = (v) => { try { return v !== undefined && v !== null && (!valid || !!valid(v)); } catch { return false; } };
  const [value, setValue] = useState(() => {
    if (skip) return fallback;
    const entry = fromStore(key);
    if (entry && typeof entry === 'object' && 'v' in entry && (until === undefined || entry.t === until) && ok(entry.v)) return entry.v;
    if (entry) toStore(key, null);
    if (legacy) {
      let old = null;
      try { old = localStorage.getItem(legacy); } catch { /* none */ }
      if (old != null) {
        let v = old;
        try { v = JSON.parse(old); } catch { /* a plain string */ }
        if (ok(v)) return v;
        if (ok(old)) return old; // "1" kept as text, not the number
      }
    }
    return fallback;
  });
  const set = useCallback((next) => {
    setValue((prev) => {
      const v = typeof next === 'function' ? next(prev) : next;
      toStore(key, same(v, fallback) ? null : until === undefined ? { v } : { v, t: until });
      return v;
    });
  }, [key, until]); // eslint-disable-line react-hooks/exhaustive-deps
  return [value, set];
}

/**
 * Once a page knows what can be picked (`known`: the values that exist, or null while they load), a stored pick that no
 * longer exists (a deleted team, tag, person) is dropped: a list loses just those entries, a single value goes to `fallback`.
 */
export function usePrune(value, setValue, known, fallback = '') {
  const sig = known ? known.map(String).join('\u0001') : null;
  useEffect(() => {
    if (!known) return;
    const has = new Set(known.map(String));
    if (Array.isArray(value)) {
      const kept = value.filter((v) => has.has(String(v)));
      if (kept.length !== value.length) setValue(kept);
    } else if (!same(value, fallback) && !has.has(String(value))) setValue(fallback);
  }, [sig, JSON.stringify(value)]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Checks for `valid`.
export const isText = (v) => typeof v === 'string';
export const oneOf = (...choices) => (v) => choices.includes(v);
/** A { key, dir } sort whose key is one of `keys` (an array, or the object the sorts are kept in). */
export const isSort = (keys, dirs = ['asc', 'desc']) => (v) => (Array.isArray(keys) ? keys.includes(v?.key) : !!keys[v?.key]) && dirs.includes(v.dir);
