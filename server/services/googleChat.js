// KIT's Google Chat app: alerts go to a person as a direct message from the app.
//
// A Chat app can't look a person up by email or open a direct message on its own, so the link is made from Google's
// side: when someone opens the KIT app in Google Chat (adds it, or sends it any message), Chat calls
// /api/google-chat/events with that person's Google account email and the direct message space. The email is matched to
// a KIT account and the space is saved on it (users.chat_space). From then on KIT posts their alerts to that space.
//
// Two settings, both from the Google Cloud project that holds the Chat app:
//   GOOGLE_CHAT_CREDENTIALS     the app's service account key (the whole JSON file, as one line): lets KIT post as the app
//   GOOGLE_CHAT_PROJECT_NUMBER  the project's number: every call from Chat is signed for it, and anything else is turned away
import jwt from 'jsonwebtoken';
import { db } from '../db.js';

const CHAT_ISSUER = 'chat@system.gserviceaccount.com';
const CERTS_URL = `https://www.googleapis.com/service_accounts/v1/metadata/x509/${CHAT_ISSUER}`;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://chat.googleapis.com/v1';

let credentialsError = null;
function credentials() {
  const raw = process.env.GOOGLE_CHAT_CREDENTIALS;
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    if (!c.client_email || !c.private_key) throw new Error('it has no client_email or private_key');
    credentialsError = null;
    return c;
  } catch (e) {
    credentialsError = `GOOGLE_CHAT_CREDENTIALS isn’t a service account key: ${e.message}`;
    return null;
  }
}
const projectNumber = () => String(process.env.GOOGLE_CHAT_PROJECT_NUMBER || '').trim();

/** Whether KIT can post to Google Chat, and whether Chat can link people to it. */
export const chatConfigured = () => !!credentials() && !!projectNumber();
export const chatProblem = () => {
  if (!process.env.GOOGLE_CHAT_CREDENTIALS) return 'Set GOOGLE_CHAT_CREDENTIALS';
  if (!credentials()) return credentialsError;
  return projectNumber() ? null : 'Set GOOGLE_CHAT_PROJECT_NUMBER';
};

// ---- Posting as the app

let token = null; // { value, until }
async function accessToken() {
  if (token && token.until > Date.now() + 60 * 1000) return token.value;
  const c = credentials();
  if (!c) throw new Error(chatProblem());
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign({ iss: c.client_email, scope: 'https://www.googleapis.com/auth/chat.bot', aud: TOKEN_URL, iat: now, exp: now + 3600 }, c.private_key, { algorithm: 'RS256' });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) throw new Error(`Google sign-in for the Chat app failed: ${d.error_description || d.error || res.status}`);
  token = { value: d.access_token, until: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return token.value;
}

/** Thrown when the space is gone or the app was removed from it: the person has to open the app again. */
export class ChatSpaceGone extends Error {}

/** Post plain `text` to `space` ("spaces/…") as the KIT app. */
export async function postChat(space, text) {
  if (!/^spaces\/[\w-]+$/.test(space || '')) throw new ChatSpaceGone('Not a Chat space');
  const res = await fetch(`${API}/${space}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text: String(text).slice(0, 4000) }),
  });
  if (res.ok) return;
  const d = await res.json().catch(() => ({}));
  const why = d.error?.message || `HTTP ${res.status}`;
  if (res.status === 404 || res.status === 403) throw new ChatSpaceGone(why);
  throw new Error(`Google Chat: ${why}`);
}

// ---- Calls from Google Chat

let certs = null; // { byKid, until }
async function chatCerts() {
  if (certs && certs.until > Date.now()) return certs.byKid;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error(`Couldn’t read Google Chat’s signing keys: ${res.status}`);
  certs = { byKid: await res.json(), until: Date.now() + 60 * 60 * 1000 };
  return certs.byKid;
}

/** Whether this request really comes from Google Chat, for this project: its bearer token is signed by Chat's own account. */
async function fromGoogleChat(req) {
  const bearer = /^Bearer (.+)$/i.exec(req.get('authorization') || '')?.[1];
  const aud = projectNumber();
  if (!bearer || !aud) return false;
  try {
    const kid = jwt.decode(bearer, { complete: true })?.header?.kid;
    const cert = kid && (await chatCerts())[kid];
    if (!cert) return false;
    jwt.verify(bearer, cert, { algorithms: ['RS256'], audience: aud, issuer: CHAT_ISSUER });
    return true;
  } catch {
    return false;
  }
}

/** The person, space and kind of a Chat event, from either shape Chat sends (a Chat app's, or a Workspace add-on's). */
function readEvent(body = {}) {
  const c = body.chat || {};
  const payload = c.addedToSpacePayload || c.messagePayload || c.removedFromSpacePayload || c.appCommandPayload || {};
  return {
    removed: body.type === 'REMOVED_FROM_SPACE' || !!c.removedFromSpacePayload,
    user: body.user || c.user || null,
    space: body.space || payload.space || body.message?.space || payload.message?.space || null,
  };
}
const isDirect = (space) => !!space && (space.type === 'DM' || space.spaceType === 'DIRECT_MESSAGE' || space.singleUserBotDm === true);

const WELCOME = (first) => `Hi ${first}, you’re connected. Your KIT alerts will arrive here as they happen. To stop them, open KIT › Settings and switch off Google Chat under Alert delivery.`;
const UNKNOWN = (email) => `There’s no KIT account for ${email || 'this Google account'}, so there are no alerts to send here. If you use KIT with another email, ask an admin to change it to this one.`;
const NOT_HERE = 'KIT sends alerts in a direct message, one person at a time. Open the KIT app on its own in Google Chat to get yours.';

/**
 * POST /api/google-chat/events. Links the Google account that opened the app to the KIT account with the same email,
 * or unlinks it when the app is removed. Chat is answered at once; the reply is posted to the space afterwards.
 */
export async function handleChatEvent(req, res) {
  if (!(await fromGoogleChat(req))) return res.status(401).json({ error: 'Not from Google Chat' });
  res.json({});
  const { removed, user, space } = readEvent(req.body);
  if (!space?.name) return;
  try {
    if (removed) {
      db.prepare('UPDATE users SET chat_space = NULL WHERE chat_space = ?').run(space.name);
      return;
    }
    if (user?.type === 'BOT') return;
    if (!isDirect(space)) return void await postChat(space.name, NOT_HERE);
    const email = String(user?.email || '').trim();
    const u = email && db.prepare('SELECT id, first_name, chat_space FROM users WHERE email = ? AND active = 1').get(email);
    if (!u) return void await postChat(space.name, UNKNOWN(email));
    if (u.chat_space === space.name) return; // already connected: say nothing more
    db.prepare('UPDATE users SET chat_space = ? WHERE id = ?').run(space.name, u.id);
    await postChat(space.name, WELCOME(u.first_name));
  } catch (e) {
    console.error('Google Chat event:', e.message);
  }
}
