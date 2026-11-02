// How yearly figures run: by calendar year, or over the trailing four quarters (the last four finished quarters). The
// choice is remembered in this browser and shared by every view that offers it, so switching one switches them all.
import { useEffect, useState } from 'react';

const KEY = 'kit:yearBasis';
const EVENT = 'kit:yearBasis';
let current = (() => {
  try { return localStorage.getItem(KEY) === 't4q' ? 't4q' : 'calendar'; } catch { return 'calendar'; }
})();

/** [basis, setBasis]: 'calendar' or 't4q'. */
export function useYearBasis() {
  const [basis, setLocal] = useState(current);
  useEffect(() => {
    const h = () => setLocal(current);
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);
  const set = (b) => {
    current = b === 't4q' ? 't4q' : 'calendar';
    try { localStorage.setItem(KEY, current); } catch { /* not remembered, still applied */ }
    window.dispatchEvent(new Event(EVENT));
  };
  return [basis, set];
}

const qName = (i) => `${Math.floor(i / 4)} Q${(i % 4) + 1}`;

/** The last four finished quarters before the one containing `iso` (`back` = 1 for the four before those): "2025 Q4 – 2026 Q3". */
export function trailingLabel(iso, back = 0) {
  const now = Number(iso.slice(0, 4)) * 4 + Math.ceil(Number(iso.slice(5, 7)) / 3) - 1;
  const first = now - 4 * (back + 1);
  return `${qName(first)} – ${qName(first + 3)}`;
}
