// Priority accounts, at the top of My dashboard: each person sorts the agencies, departments and organizations that
// matter most into tiers (Tier 1, Tier 2, …; tiers, not a ranking), picks the pipeline and work tickets that matter at each, and keeps
// one ordered list of priority tickets, from those or any other pipeline or work ticket. A ticket on anyone's list carries a "Priority" tag.
import { Router } from 'express';
import { db } from '../db.js';

const r = Router();
const DEFAULT_TIERS = ['Tier 1', 'Tier 2', 'Tier 3'];
const STRATEGY_MAX = 10000;
const name = (v) => String(v ?? '').trim().slice(0, 120);

const ownTier = (id, me) => db.prepare('SELECT * FROM priority_tiers WHERE id = ? AND user_id = ?').get(id, me);
const ownAccount = (id, me) => db.prepare(`SELECT a.* FROM priority_accounts a JOIN priority_tiers t ON t.id = a.tier_id
  WHERE a.id = ? AND t.user_id = ?`).get(id, me);

/**
 * An account's activities live on a hidden ticket of type 'account', so they work just as they do on pipeline tickets (next step,
 * subtasks, comments, weekly priorities, My tasks). Ticket lists, boards and reports leave these tickets out; Pipedrive never sees them.
 */
function activityTicket(account) {
  const found = account.ticket_id && db.prepare('SELECT id, ticket_type, opportunity_title, organization FROM tickets WHERE id = ?').get(account.ticket_id);
  if (found) return found;
  return db.transaction(() => {
    const owner = db.prepare('SELECT user_id FROM priority_tiers WHERE id = ?').get(account.tier_id).user_id;
    const id = db.prepare("INSERT INTO tickets (opportunity_title, organization, ticket_type, created_by) VALUES (?, ?, 'account', ?)").run(account.name, account.name, owner).lastInsertRowid;
    db.prepare('UPDATE priority_accounts SET ticket_id = ? WHERE id = ?').run(id, account.id);
    return { id, ticket_type: 'account', opportunity_title: account.name, organization: account.name };
  })();
}

/** Remove accounts' hidden tickets, and with them their activities. Weekly priority cards don't go with a ticket on their own. */
function dropActivityTickets(ids) {
  const list = JSON.stringify(ids.filter(Boolean));
  db.prepare('DELETE FROM priority_cards WHERE ticket_id IN (SELECT value FROM json_each(?))').run(list);
  db.prepare("DELETE FROM tickets WHERE ticket_type = 'account' AND id IN (SELECT value FROM json_each(?))").run(list);
}

/** Someone's tiers, accounts, account tickets and priority list. Tickets archived (by hand or by a full reset) are left out. */
export function priorityAccounts(userId) {
  const tiers = db.prepare('SELECT id, name, position FROM priority_tiers WHERE user_id = ? ORDER BY position, id').all(userId);
  const accounts = db.prepare(`SELECT a.id, a.tier_id, a.name, a.position, a.strategy, a.ticket_id FROM priority_accounts a JOIN priority_tiers t ON t.id = a.tier_id
    WHERE t.user_id = ? ORDER BY a.position, a.id`).all(userId);
  const tickets = db.prepare(`SELECT pt.account_id, pt.position, t.id, t.opportunity_title, t.organization, t.pipeline_status, t.value, t.ticket_type
    FROM priority_account_tickets pt JOIN priority_accounts a ON a.id = pt.account_id JOIN priority_tiers tr ON tr.id = a.tier_id
    JOIN tickets t ON t.id = pt.ticket_id WHERE tr.user_id = ? AND t.archived_at IS NULL ORDER BY pt.position`).all(userId);
  const list = db.prepare(`SELECT l.ticket_id FROM priority_list_tickets l JOIN tickets t ON t.id = l.ticket_id
    WHERE l.user_id = ? AND t.archived_at IS NULL ORDER BY l.position`).all(userId).map((x) => x.ticket_id);
  return {
    tiers: tiers.map((t) => ({
      ...t,
      accounts: accounts.filter((a) => a.tier_id === t.id).map((a) => ({
        ...a, tickets: tickets.filter((k) => k.account_id === a.id).map(({ account_id, position, ...k }) => k),
      })),
    })),
    list,
  };
}

/** ?user=<id> (default: you). Anyone can look; only the owner changes them. A first look at your own starts three empty tiers. */
r.get('/', (req, res) => {
  const userId = Number(req.query.user) || req.user.id;
  const mine = userId === req.user.id;
  if (mine && !db.prepare('SELECT 1 FROM priority_tiers WHERE user_id = ?').get(userId)) {
    const add = db.prepare('INSERT INTO priority_tiers (user_id, name, position) VALUES (?, ?, ?)');
    db.transaction(() => DEFAULT_TIERS.forEach((n, i) => add.run(userId, n, i)))();
  }
  // Names to suggest for a new account: every organization KIT knows of.
  const organizations = db.prepare(`SELECT organization AS name FROM tickets WHERE organization IS NOT NULL AND TRIM(organization) != ''
    UNION SELECT organization FROM contacts WHERE organization IS NOT NULL AND TRIM(organization) != ''
    UNION SELECT organization FROM account_objectives WHERE organization IS NOT NULL AND TRIM(organization) != ''
    ORDER BY 1 COLLATE NOCASE`).all().map((o) => o.name);
  res.json({ ...priorityAccounts(userId), canEdit: mine, organizations });
});

/** ?users=1,2,3: several people's tiers and lists at once, for the Strategic view of Priorities. Nothing is created. */
r.get('/people', (req, res) => {
  const ids = [...new Set(String(req.query.users || '').split(',').map(Number).filter(Boolean))].slice(0, 300);
  res.json({ people: ids.map((id) => ({ user_id: id, ...priorityAccounts(id) })) });
});

r.post('/tiers', (req, res) => {
  const n = name(req.body?.name);
  if (!n) return res.status(400).json({ error: 'Name the tier' });
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM priority_tiers WHERE user_id = ?').get(req.user.id).n;
  db.prepare('INSERT INTO priority_tiers (user_id, name, position) VALUES (?, ?, ?)').run(req.user.id, n, pos);
  res.json(priorityAccounts(req.user.id));
});

r.put('/tiers/:id', (req, res) => {
  const n = name(req.body?.name);
  if (!n) return res.status(400).json({ error: 'Name the tier' });
  if (!ownTier(req.params.id, req.user.id)) return res.status(404).json({ error: 'Tier not found' });
  db.prepare('UPDATE priority_tiers SET name = ? WHERE id = ?').run(n, req.params.id);
  res.json(priorityAccounts(req.user.id));
});

/** Removing a tier removes its accounts and their activities. Their tickets stay on the priority list. */
r.delete('/tiers/:id', (req, res) => {
  if (!ownTier(req.params.id, req.user.id)) return res.status(404).json({ error: 'Tier not found' });
  const held = db.prepare('SELECT ticket_id FROM priority_accounts WHERE tier_id = ?').all(req.params.id).map((a) => a.ticket_id);
  db.transaction(() => {
    db.prepare('DELETE FROM priority_tiers WHERE id = ?').run(req.params.id);
    dropActivityTickets(held);
  })();
  res.json(priorityAccounts(req.user.id));
});

/** Body: { tiers: [{ id, accounts: [account ids] }] }, in order: where every tier and account sits. Anything not yours is ignored. */
r.put('/layout', (req, res) => {
  const tiers = Array.isArray(req.body?.tiers) ? req.body.tiers : [];
  db.transaction(() => {
    tiers.forEach((t, i) => {
      if (!ownTier(t.id, req.user.id)) return;
      db.prepare('UPDATE priority_tiers SET position = ? WHERE id = ?').run(i, t.id);
      (Array.isArray(t.accounts) ? t.accounts : []).forEach((a, k) => {
        if (ownAccount(a, req.user.id)) db.prepare('UPDATE priority_accounts SET tier_id = ?, position = ? WHERE id = ?').run(t.id, k, a);
      });
    });
  })();
  res.json(priorityAccounts(req.user.id));
});

r.post('/accounts', (req, res) => {
  const n = name(req.body?.name);
  if (!n) return res.status(400).json({ error: 'Name the agency or organization' });
  const tier = ownTier(req.body?.tier_id, req.user.id);
  if (!tier) return res.status(404).json({ error: 'Tier not found' });
  const dup = db.prepare(`SELECT 1 FROM priority_accounts a JOIN priority_tiers t ON t.id = a.tier_id WHERE t.user_id = ? AND a.name = ? COLLATE NOCASE`).get(req.user.id, n);
  if (dup) return res.status(409).json({ error: `${n} is already in your tiers` });
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM priority_accounts WHERE tier_id = ?').get(tier.id).n;
  const id = db.prepare('INSERT INTO priority_accounts (tier_id, name, position) VALUES (?, ?, ?)').run(tier.id, n, pos).lastInsertRowid;
  res.json({ ...priorityAccounts(req.user.id), id });
});

r.put('/accounts/:id', (req, res) => {
  const n = name(req.body?.name);
  if (!n) return res.status(400).json({ error: 'Name the agency or organization' });
  const account = ownAccount(req.params.id, req.user.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  db.prepare('UPDATE priority_accounts SET name = ? WHERE id = ?').run(n, req.params.id);
  if (account.ticket_id) db.prepare('UPDATE tickets SET opportunity_title = ?, organization = ? WHERE id = ?').run(n, n, account.ticket_id);
  res.json(priorityAccounts(req.user.id));
});

r.delete('/accounts/:id', (req, res) => {
  const account = ownAccount(req.params.id, req.user.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  db.transaction(() => {
    db.prepare('DELETE FROM priority_accounts WHERE id = ?').run(req.params.id);
    dropActivityTickets([account.ticket_id]);
  })();
  res.json(priorityAccounts(req.user.id));
});

/** The ticket that holds an account's activities, made the first time anyone opens them. As on pipeline tickets, anyone can work on them. */
r.post('/accounts/:id/activity-ticket', (req, res) => {
  const account = db.prepare('SELECT * FROM priority_accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  res.json({ ticket: activityTicket(account) });
});

/** Body: { strategy }: how the owner plans to gain a foothold at this account. */
r.put('/accounts/:id/strategy', (req, res) => {
  if (!ownAccount(req.params.id, req.user.id)) return res.status(404).json({ error: 'Account not found' });
  const strategy = String(req.body?.strategy ?? '').trim().slice(0, STRATEGY_MAX) || null;
  db.prepare('UPDATE priority_accounts SET strategy = ? WHERE id = ?').run(strategy, req.params.id);
  res.json(priorityAccounts(req.user.id));
});

/** Body: { ticket_ids: [] }, in order: the account's priority tickets (pipeline or work; never an account's hidden ticket). The priority list stands on its own, so it doesn't change. */
r.put('/accounts/:id/tickets', (req, res) => {
  if (!ownAccount(req.params.id, req.user.id)) return res.status(404).json({ error: 'Account not found' });
  const ids = [...new Set((Array.isArray(req.body?.ticket_ids) ? req.body.ticket_ids : []).map(Number).filter(Boolean))]
    .filter((id) => db.prepare("SELECT 1 FROM tickets WHERE id = ? AND ticket_type IN ('bid', 'work')").get(id));
  db.transaction(() => {
    db.prepare('DELETE FROM priority_account_tickets WHERE account_id = ?').run(req.params.id);
    const add = db.prepare('INSERT INTO priority_account_tickets (account_id, ticket_id, position) VALUES (?, ?, ?)');
    ids.forEach((id, i) => add.run(req.params.id, id, i));
  })();
  res.json(priorityAccounts(req.user.id));
});

/** Body: { ticket_ids: [] }, in order: your priority tickets, from under your accounts or any other pipeline or work ticket. */
r.put('/list', (req, res) => {
  const ids = [...new Set((Array.isArray(req.body?.ticket_ids) ? req.body.ticket_ids : []).map(Number).filter(Boolean))]
    .filter((id) => db.prepare("SELECT 1 FROM tickets WHERE id = ? AND ticket_type IN ('bid', 'work')").get(id));
  db.transaction(() => {
    db.prepare('DELETE FROM priority_list_tickets WHERE user_id = ?').run(req.user.id);
    const add = db.prepare('INSERT INTO priority_list_tickets (user_id, ticket_id, position) VALUES (?, ?, ?)');
    ids.forEach((id, i) => add.run(req.user.id, id, i));
  })();
  res.json(priorityAccounts(req.user.id));
});

export default r;
