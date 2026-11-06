/** Progressive phone formatting to xxx-xxx-xxxx as the user types. */
export function formatPhoneInput(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/** 1.2 GB, 3.4 MB or 12 KB. */
export const fileSize = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
export const fullName = (u) => (u ? `${u.first_name} ${u.last_name}` : '');
export const initials = (u) => (u ? `${u.first_name?.[0] || ''}${u.last_name?.[0] || ''}`.toUpperCase() : '?');

/** "Pipeline Ticket" for tickets meant to win a contract, "Work Ticket" for everything else. */
export const ticketKind = (t) => ({ work: 'Work Ticket', account: 'Priority account' }[t?.ticket_type] || 'Pipeline Ticket');

export const todayIso = () => new Date().toLocaleDateString('en-CA');

export function shortDate(iso, opts = { month: 'short', day: 'numeric' }) {
  if (!iso) return '';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', opts);
}

// SQLite stores UTC timestamps as "YYYY-MM-DD HH:MM:SS".
export const parseUtc = (s) => (s ? new Date(`${s.replace(' ', 'T')}Z`) : null);
export const stamp = (s) => parseUtc(s)?.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
export const fullStamp = (s) => parseUtc(s)?.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' });

/** "just now", "5m ago", "3h ago", "2d ago", then a short date. */
export function ago(s) {
  const d = parseUtc(s);
  if (!d) return '';
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  if (m < 60 * 24 * 7) return `${Math.round(m / 1440)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
