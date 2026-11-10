// Sidebar pages a person can hide from their own sidebar (Settings), by path. Settings itself isn't one, so it can
// always be reached. A page missing from this list can't be hidden; a page added later shows until someone hides it,
// since what's saved is the list of hidden ones. Shared with the server, which keeps only these when saving.
export const HIDEABLE_NAV = [
  '/alerts', '/dashboard', '/playbook', '/reports', '/events', '/travel', '/priorities', '/tickets', '/pipeline',
  '/delivery', '/closed-deals', '/compensation', '/crm', '/solutions', '/marketing', '/retros', '/lessons',
  '/member', '/my-team', '/admin',
];

/** Only known paths, once each. */
export const cleanHiddenNav = (list) =>
  [...new Set((Array.isArray(list) ? list : []).filter((p) => typeof p === 'string' && HIDEABLE_NAV.includes(p)))];

/** The paths this user hid from their sidebar, from users.hidden_nav (a JSON array). */
export function hiddenNav(user) {
  try {
    return cleanHiddenNav(JSON.parse(user?.hidden_nav || '[]'));
  } catch {
    return [];
  }
}
