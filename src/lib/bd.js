/**
 * Whether someone is a BD director: on the BD team and counted in its numbers (the BD Team page's "BD numbers" switch,
 * the server's BD_DIRECTOR_IDS). Use it for anything that lists BD directors in reporting.
 */
export const isBdDirector = (u) => !!u?.teams?.some((t) => t.name === 'BD' && t.in_numbers !== false);
