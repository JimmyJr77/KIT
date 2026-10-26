/** Progressive phone formatting to xxx-xxx-xxxx as the user types. */
export function formatPhoneInput(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

export const fullName = (u) => (u ? `${u.first_name} ${u.last_name}` : '');
export const initials = (u) => (u ? `${u.first_name?.[0] || ''}${u.last_name?.[0] || ''}`.toUpperCase() : '?');

export const todayIso = () => new Date().toLocaleDateString('en-CA');

export function shortDate(iso, opts = { month: 'short', day: 'numeric' }) {
  if (!iso) return '';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', opts);
}
