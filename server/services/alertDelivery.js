// Alerts outside KIT: each new alert also goes to its person's email (their Google account's Gmail) and, once they've
// opened the KIT app in Google Chat, as a direct message there. Each person switches either off in Settings.
//
// Nothing that makes an alert knows about this. A sweep each minute picks up alerts neither channel has dealt with yet
// (alerts.emailed_at / chatted_at), so alerts made together reach a person as one message. An alert that was read in
// KIT before the sweep isn't sent, and neither is one more than a day old (after an outage, say).
//
// Email goes through SMTP: SMTP_USER and SMTP_PASS (a Google account's app password; SMTP_HOST defaults to
// smtp.gmail.com), or SMTP_HOST alone for a relay that trusts this server. Google Chat is in googleChat.js.
//
// These reach real inboxes, so like sending to Pipedrive only the production server does it. A development server
// passes alerts over, unless ALERT_DELIVERY_DEV=1 (for trying it out).
import nodemailer from 'nodemailer';
import { db, json } from '../db.js';
import { chatConfigured, chatProblem, postChat, ChatSpaceGone } from './googleChat.js';

// ---- An alert, read with everything its wording needs (the Alerts page and the messages share this)

export const ALERT_SQL = `SELECT a.*, u.first_name, u.last_name, t.opportunity_title AS ticket_title, t.ticket_type, c.title AS card_title,
      m.parent_id AS comment_parent_id, e.name AS event_name, e.date_from AS event_date_from, e.date_to AS event_date_to,
      q.status AS request_status, q.ticket_id AS request_ticket_id, q.title AS request_title, q.category AS request_category, q.due_date AS request_due_date, dp.name AS program_name, dp.organization AS program_organization,
      tr.approval AS trip_approval, tr.date_from AS trip_date_from, tr.location_to AS trip_location_to, te.name AS trip_event_name, tm.name AS team_name,
      (SELECT COUNT(*) FROM support_need_tickets st WHERE st.need_id = a.support_id) AS support_tickets
    FROM alerts a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN tickets t ON t.id = a.ticket_id
    LEFT JOIN priority_cards c ON c.id = a.card_id LEFT JOIN ticket_comments m ON m.id = a.comment_id
    LEFT JOIN events e ON e.id = a.event_id LEFT JOIN event_support_requests q ON q.id = a.request_id
    LEFT JOIN delivery_programs dp ON dp.id = a.program_id
    LEFT JOIN trips tr ON tr.id = a.trip_id LEFT JOIN events te ON te.id = tr.event_id LEFT JOIN teams tm ON tm.id = a.team_id`;

export const shapeAlert = (a) => ({
  id: a.id, kind: a.kind, excerpt: a.excerpt, created_at: a.created_at, read: !!a.read_at,
  ticket_id: a.ticket_id, ticket_title: a.ticket_title, ticket_type: a.ticket_type, card_id: a.card_id, card_title: a.card_title,
  comment_id: a.comment_id, thread_id: a.comment_parent_id || a.comment_id, note_id: a.note_id,
  actor: a.first_name ? { id: a.actor_id, first_name: a.first_name, last_name: a.last_name } : null,
  event_id: a.event_id, event_name: a.event_name, event_date_from: a.event_date_from, event_date_to: a.event_date_to,
  request_id: a.request_id, request_status: a.request_status, request_ticket_id: a.request_ticket_id,
  request_title: a.request_title, request_category: a.request_category, request_due_date: a.request_due_date,
  program_id: a.program_id, program_name: a.program_name, program_organization: a.program_organization,
  trip_id: a.trip_id, trip_approval: a.trip_approval, trip_date_from: a.trip_date_from, trip_event_name: a.trip_event_name,
  trip_destination: a.trip_location_to ? json.parse(a.trip_location_to, {}) : null,
  support_id: a.support_id, support_tickets: a.support_tickets,
  team_name: a.team_name, // set when a mention reached them through this team rather than by name
});

// ---- What an alert says, in the Alerts page's own words

const supportSubject = (a) => (a.event_id ? a.event_name : a.request_title || (a.request_id ? 'a request' : 'a deleted request'));
const tripSubject = (a) => (!a.trip_id ? 'a deleted trip' : a.trip_event_name || [a.trip_destination?.city, a.trip_destination?.state].filter(Boolean).join(', ') || 'a trip');
const DECISION = { approved: 'approved', declined: 'declined', pending: 'is reviewing' };
const isDelivery = (a) => a.kind.startsWith('delivery_');
const isTravel = (a) => a.kind === 'travel_request' || a.kind === 'travel_decision';

/** A shaped alert as { who, did, detail, path }: "who did", a line of detail under it, and the page in KIT that opens it. */
export function alertText(a) {
  const who = a.kind === 'pipedrive_file_hold' ? 'Pipedrive' : a.actor ? `${a.actor.first_name} ${a.actor.last_name}`.trim() : 'Someone';
  const ticket = a.ticket_title || 'a deleted ticket';
  const program = a.program_name || 'a deleted contract';
  const did = {
    pipedrive_file_hold: `deleted ${a.excerpt} of KIT's files. They're held, not deleted, until an admin decides in Settings › Admin › Pipedrive.`,
    support_need: `needs your support${a.support_id ? '' : ' (request since deleted)'}`,
    support_ticket: `made a work ticket from your support request: ${ticket}`,
    support_request: `requested marketing support${a.event_id ? ' for' : ':'} ${supportSubject(a)}`,
    support_accepted: `created a work ticket for your marketing support request${a.event_id ? ' on' : ':'} ${supportSubject(a)}`,
    delivery_pm: `made you Program Manager for ${program}`,
    delivery_tl: `made you Technical Lead for ${program}`,
    delivery_team: `added you to the delivery team for ${program}`,
    travel_request: `submitted a travel request for ${tripSubject(a)}`,
    travel_decision: `${DECISION[a.trip_approval] || 'decided'} your travel request for ${tripSubject(a)}`,
    comment: `${a.thread_id !== a.comment_id ? 'replied' : 'commented'} on your ${a.ticket_type === 'work' ? 'work ticket' : 'pipeline ticket'} ${ticket}`,
  }[a.kind] || `mentioned ${a.team_name ? `the ${a.team_name} team` : 'you'} in ${a.note_id ? 'a note' : 'a comment'} on ${ticket}`;

  const detail = (a.kind === 'pipedrive_file_hold' ? []
    : isTravel(a) ? [a.trip_date_from, a.excerpt ? `Note: ${a.excerpt}` : null]
    : isDelivery(a) ? [a.program_organization, a.kind === 'delivery_team' && a.excerpt ? `Your role: ${a.excerpt}` : null]
    : [a.card_title ? `Priority: ${a.card_title}` : null, a.excerpt]).filter(Boolean).join(isTravel(a) || isDelivery(a) ? ' · ' : '\n');

  const path = isDelivery(a) && a.program_id ? `/delivery?open=${a.program_id}`
    : a.kind === 'pipedrive_file_hold' ? '/settings?tab=admin'
    : isTravel(a) && a.trip_id ? `/travel?open=${a.trip_id}`
    : (a.kind === 'comment' || a.kind === 'mention') && a.ticket_id && (a.comment_id || a.note_id) ? `/tickets?open=${a.ticket_id}&focus=${a.comment_id ? `c-${a.comment_id}` : `n-${a.note_id}`}`
    : '/alerts';
  return { who, did, detail, path };
}

/** Where KIT is opened in a browser, for links: APP_URL, else this server's own public address. Empty when unknown. */
export function appUrl() {
  const raw = process.env.APP_URL || process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '';
  try { return new URL(raw).origin; } catch { return ''; }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** One person's new alerts as an email: { subject, text, html }. */
export function alertEmail(alerts) {
  const base = appUrl();
  const items = alerts.map(alertText);
  const one = items.length === 1 ? items[0] : null;
  const subject = (one ? `${one.who} ${one.did}` : `${items.length} new alerts in KIT`).replace(/\s+/g, ' ').slice(0, 150);
  const text = [
    ...items.map((i) => [`${i.who} ${i.did}`, i.detail, base && `${base}${i.path}`].filter(Boolean).join('\n')),
    `You get these because email alerts are on for you in KIT. Switch them off in KIT › Settings › Alert delivery.${base ? `\n${base}/settings` : ''}`,
  ].join('\n\n');
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;color:#0f172a;font-size:14px;line-height:1.5">
${items.map((i) => `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:0 0 10px">
  <div><strong>${esc(i.who)}</strong> ${esc(i.did)}</div>
  ${i.detail ? `<div style="margin-top:6px;color:#475569;white-space:pre-wrap">${esc(i.detail)}</div>` : ''}
  ${base ? `<div style="margin-top:10px"><a href="${esc(base + i.path)}" style="color:#2563eb;font-weight:600;text-decoration:none">Open in KIT →</a></div>` : ''}
</div>`).join('\n')}
<p style="color:#94a3b8;font-size:12px;margin-top:16px">You get these because email alerts are on for you in KIT. Switch them off in ${base ? `<a href="${esc(base)}/settings" style="color:#94a3b8">KIT › Settings</a>` : 'KIT › Settings'} › Alert delivery.</p>
</div>`;
  return { subject, text, html };
}

/** One person's new alerts as a Google Chat message (plain text; Chat makes the addresses links). */
export function alertChat(alerts) {
  const base = appUrl();
  return alerts.map(alertText).map((i) => [`${i.who} ${i.did}`, i.detail, base && `${base}${i.path}`].filter(Boolean).join('\n')).join('\n\n');
}

// ---- Email

const smtpHost = () => process.env.SMTP_HOST || (process.env.SMTP_USER ? 'smtp.gmail.com' : '');
export const emailConfigured = () => !!smtpHost() && (!process.env.SMTP_USER || !!process.env.SMTP_PASS);
const fromAddress = () => process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER || '';

let transport = null;
function mailer() {
  if (transport) return transport;
  const port = Number(process.env.SMTP_PORT) || 587;
  transport = nodemailer.createTransport({
    host: smtpHost(), port, secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  });
  return transport;
}

export async function sendEmail(to, { subject, text, html }) {
  if (!emailConfigured()) throw new Error('Email isn’t set up on this server (set SMTP_USER and SMTP_PASS)');
  const from = fromAddress();
  if (!from) throw new Error('Set ALERT_EMAIL_FROM to the address alerts are sent from');
  await mailer().sendMail({ from: { name: 'KIT', address: from }, to, subject, text, html });
}

// ---- The sweep

/** Only the production server sends (see the top of this file). */
export const deliveryAllowed = () => process.env.NODE_ENV === 'production' || process.env.ALERT_DELIVERY_DEV === '1';

const CHANNELS = [
  {
    key: 'email', column: 'emailed_at', wanted: 'alert_email', on: emailConfigured,
    reaches: (u) => !!u.email,
    send: (u, alerts) => sendEmail(u.email, alertEmail(alerts)),
  },
  {
    key: 'chat', column: 'chatted_at', wanted: 'alert_chat', on: chatConfigured,
    reaches: (u) => !!u.chat_space,
    send: (u, alerts) => postChat(u.chat_space, alertChat(alerts)),
  },
];

const lastError = { email: null, chat: null };
const mark = (column, ids) => ids.length && db.prepare(`UPDATE alerts SET ${column} = datetime('now') WHERE id IN (SELECT value FROM json_each(?))`).run(JSON.stringify(ids));

async function sweepChannel(ch) {
  const rows = db.prepare(`${ALERT_SQL} WHERE a.${ch.column} IS NULL ORDER BY a.user_id, a.created_at, a.id LIMIT 500`).all();
  if (!rows.length) return;
  // Not sending from here: these are passed over for good, so switching delivery on later starts from that moment.
  if (!ch.on() || !deliveryAllowed()) return void mark(ch.column, rows.map((a) => a.id));

  const fresh = db.prepare("SELECT datetime('now', '-1 day') AS t").get().t;
  const byUser = new Map();
  rows.forEach((a) => byUser.set(a.user_id, [...(byUser.get(a.user_id) || []), a]));
  for (const [userId, mine] of byUser) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const send = u?.active && u[ch.wanted] && ch.reaches(u) ? mine.filter((a) => !a.read_at && a.created_at >= fresh) : [];
    mark(ch.column, mine.filter((a) => !send.includes(a)).map((a) => a.id));
    if (!send.length) continue;
    try {
      await ch.send(u, send.map(shapeAlert));
      mark(ch.column, send.map((a) => a.id));
      lastError[ch.key] = null;
    } catch (e) {
      if (e instanceof ChatSpaceGone) { // they removed the app: forget the space until they open it again
        db.prepare('UPDATE users SET chat_space = NULL WHERE id = ?').run(u.id);
        mark(ch.column, send.map((a) => a.id));
        continue;
      }
      // Left unmarked: tried again next minute, for up to a day.
      lastError[ch.key] = e.message;
      console.error(`Alert ${ch.key} to user ${u.id}: ${e.message}`);
    }
  }
}

let sweeping = false;
export async function sweepAlerts() {
  if (sweeping) return;
  sweeping = true;
  try {
    for (const ch of CHANNELS) await sweepChannel(ch);
  } catch (e) {
    console.error('Alert delivery:', e.message);
  } finally {
    sweeping = false;
  }
}

export function scheduleAlertDelivery() {
  setTimeout(sweepAlerts, 20 * 1000).unref();
  setInterval(sweepAlerts, 60 * 1000).unref();
}

/** What Settings shows: which channels this server sends on, and anything wrong with them. */
export function deliveryStatus() {
  const sending = deliveryAllowed();
  return {
    sending, // false on a development server
    email: { configured: emailConfigured(), from: emailConfigured() ? fromAddress() : null, error: lastError.email },
    chat: { configured: chatConfigured(), problem: process.env.GOOGLE_CHAT_CREDENTIALS || process.env.GOOGLE_CHAT_PROJECT_NUMBER ? chatProblem() : null, error: lastError.chat },
  };
}
