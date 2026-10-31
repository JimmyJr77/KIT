// Fills a local dev database with fake people and activity across every page, for trying features out.
// Run once on a dev database: `npm run seed:demo-data`. Refuses in production and on a database it already filled.
// Everyone it creates has an @kitdemo.com email and the password kitdemouser.
import 'dotenv/config';
import { db, json, setUserTeams } from '../db.js';
import { hashPassword, formatPhone, digitsOnly } from '../auth.js';
import { quarterFor, tripCosts, addDays } from '../../src/lib/travelCalc.js';

if (process.env.NODE_ENV === 'production') throw new Error('Demo data cannot be seeded in production.');
if (db.prepare("SELECT 1 FROM users WHERE email LIKE '%@kitdemo.com'").get()) {
  console.log('Demo data is already here (found @kitdemo.com users). Restore a backup of the database to start over.');
  process.exit(0);
}
const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
if (!admin) throw new Error('Run `npm run seed` first to create the admin account.');

// Same output on every run, so a fresh database always looks the same.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(rand() * list.length)];
const some = (list, n) => [...list].sort(() => rand() - 0.5).slice(0, n);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const today = new Date().toLocaleDateString('en-CA');
const stamp = (iso, time = '15:00:00') => `${iso} ${time}`;
const ago = (days, time) => stamp(addDays(today, -days), time);
const weekStartFor = (iso, dow) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - dow + 7) % 7));
  return d.toISOString().slice(0, 10);
};
const insert = (table, row) => {
  const cols = Object.keys(row);
  return Number(db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(row).lastInsertRowid);
};

const teams = Object.fromEntries(db.prepare('SELECT id, name FROM teams').all().map((t) => [t.name, t.id]));

db.transaction(() => {
  // ---- Teams check in on different days, which is what most week-boundary bugs need.
  const checkin = { BD: 1, Operations: 4, 'Technical Solutioning': 3, Marketing: 2, Admin: 5 };
  Object.entries(checkin).forEach(([name, dow]) => db.prepare('UPDATE teams SET checkin_dow = ? WHERE id = ?').run(dow, teams[name]));

  // ---- People and the teams they're on.
  const PEOPLE = [
    ['Phil', 'Hargrove', 'BD Director', ['BD']],
    ['Dana', 'Whitfield', 'Capture Manager', ['BD', 'Technical Solutioning']],
    ['Marcus', 'Bell', 'BD Director', ['BD']],
    ['Priya', 'Raman', 'Proposal Manager', ['BD', 'Marketing']],
    ['Leo', 'Santos', 'BD Analyst', ['BD']],
    ['Grace', 'Okafor', 'Director of Operations', ['Operations']],
    ['Tom', 'Becker', 'Program Manager', ['Operations']],
    ['Hannah', 'Liu', 'Program Manager', ['Operations', 'Admin']],
    ['Victor', 'Alvarez', 'Logistics Lead', ['Operations']],
    ['Sam', 'Chen', 'Chief Architect', ['Technical Solutioning']],
    ['Nadia', 'Petrova', 'Solutions Engineer', ['Technical Solutioning']],
    ['Omar', 'Haddad', 'Cloud Engineer', ['Technical Solutioning', 'Operations']],
    ['Ella', 'Brooks', 'Marketing Director', ['Marketing']],
    ['Jules', 'Moreau', 'Graphic Designer', ['Marketing']],
    ['Ken', 'Watanabe', 'Content Writer', ['Marketing']],
    ['Rosa', 'Delgado', 'Office Manager', ['Admin']],
    ['Ian', 'Fletcher', 'Contracts Manager', ['Admin', 'BD']],
  ];
  const password = hashPassword('kitdemouser');
  const people = PEOPLE.map(([first_name, last_name, title, teamNames], i) => {
    const email = `${first_name}.${last_name}@kitdemo.com`.toLowerCase();
    db.prepare('INSERT OR IGNORE INTO approved_accounts (email, role) VALUES (?, ?)').run(email, 'member');
    const phone = formatPhone(`571555${String(1000 + i)}`);
    const id = insert('users', {
      first_name, last_name, email, phone, phone_digits: digitsOnly(phone), username: `${first_name[0]}${last_name}`.toLowerCase(),
      title, role: 'member', password_hash: password, created_at: ago(120 - i),
    });
    setUserTeams(id, teamNames.map((n) => teams[n]));
    return { id, first_name, last_name, title, teams: teamNames.map((n) => teams[n]) };
  });
  const byName = (first) => people.find((p) => p.first_name === first);
  // Someone who left: still in history (tickets, contacts), hidden from boards and pickers.
  const departed = byName('Victor');
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(departed.id);
  const everyone = [{ ...admin, teams: [admin.team_id || teams.BD] }, ...people.filter((p) => p !== departed)];
  const onTeam = (name) => everyone.filter((p) => p.teams.includes(teams[name]));

  // ---- Contacts at customer organizations
  const ORGS = [
    ['Army PEO STRI', 'Army'], ['Army Futures Command', 'Army'], ['Fort Liberty G6', 'Army'],
    ['AFLCMC Hanscom', 'Air Force'], ['Air Force Research Lab', 'Air Force'], ['Space Systems Command', 'Air Force'],
    ['NAVWAR', 'Navy / Marine'], ['Marine Corps Systems Command', 'Navy / Marine'], ['NAVAIR PMA-281', 'Navy / Marine'],
  ];
  const CONTACTS = [
    ['Rebecca', 'Stone', 'Contracting Officer'], ['Darnell', 'Price', 'Program Manager'], ['Colonel Ann', 'Mercer', 'Program Executive'],
    ['Steve', 'Kowalski', 'Deputy PM'], ['Lisa', 'Tran', 'Contract Specialist'], ['Major Ben', 'Ortiz', 'Requirements Lead'],
    ['Helen', 'Cho', 'Chief Engineer'], ['Raj', 'Mehta', 'Small Business Liaison'], ['Karen', 'Doyle', 'Branch Chief'],
    ['Lt Col Mike', 'Grant', 'Division Chief'], ['Tanya', 'Rhodes', 'Technical Director'], ['Paul', 'Whitman', 'Contracting Officer'],
    ['Angela', 'Ruiz', 'Program Analyst'], ['Chris', 'Nolan', 'Portfolio Manager'], ['Dr. Irene', 'Vasquez', 'Lab Director'],
  ];
  const contacts = CONTACTS.map(([first_name, last_name, role], i) => {
    const [organization] = ORGS[i % ORGS.length];
    const author = pick(onTeam('BD'));
    const id = insert('contacts', {
      first_name, last_name, organization, role, relationship: int(0, 5),
      email: `${first_name.split(' ').pop()}.${last_name}@example.mil`.toLowerCase(), phone: formatPhone(`703555${String(2000 + i)}`),
      notes: pick(['Prefers email over calls.', 'Met at AUSA last year.', 'Reports up to the PEO.', 'Very responsive; values short white papers.', null]),
      created_by: author.id, created_at: ago(int(30, 200)),
    });
    for (let n = int(0, 3); n > 0; n--) {
      insert('contact_interactions', {
        contact_id: id, author_id: pick(onTeam('BD')).id, created_at: ago(int(1, 90), '14:30:00'),
        body: pick(['Intro call — interested in our data platform work.', 'Coffee at the Pentagon City mall; discussed FY27 budget.',
          'Sent capability statement as follow-up.', 'Asked about our CMMC status.', 'Quick check-in; RFP slipping to Q2.']),
      });
    }
    return { id, organization };
  });

  // ---- Tickets: bids across the pipeline, plus work tickets in each swim lane.
  const BIDS = [
    ['Synthetic Training Environment Data Pipeline', 'Army PEO STRI', 'Army', 'Proposal', 18_500_000],
    ['Enterprise Cloud Migration Support', 'AFLCMC Hanscom', 'Air Force', 'Capture', 42_000_000],
    ['Tactical Network Modernization', 'Fort Liberty G6', 'Army', 'Qualified', 9_800_000],
    ['AI-Enabled Maintenance Forecasting', 'NAVAIR PMA-281', 'Navy / Marine', 'Submitted', 12_300_000],
    ['Zero Trust Architecture Pilot', 'Space Systems Command', 'Air Force', 'Identified', 5_500_000],
    ['Digital Engineering Environment', 'Air Force Research Lab', 'Air Force', 'Awarded', 21_000_000],
    ['Logistics Readiness Dashboard', 'Marine Corps Systems Command', 'Navy / Marine', 'Awarded', 3_400_000],
    ['Cyber Range as a Service', 'Army Futures Command', 'Army', 'Lost', 15_000_000],
    ['Shipboard Network Refresh', 'NAVWAR', 'Navy / Marine', 'No Bid', 27_000_000],
    ['Software Factory Support', 'Army Futures Command', 'Army', 'Proposal', 33_000_000],
    ['Satellite Ground Systems Sustainment', 'Space Systems Command', 'Air Force', 'Capture', 61_000_000],
    ['Medical Readiness Data Platform', 'Fort Liberty G6', 'Army', 'Identified', 2_100_000],
    ['ISR Data Fusion Prototype', 'Air Force Research Lab', 'Air Force', 'Qualified', 7_750_000],
    ['C5ISR Help Desk Recompete', 'NAVWAR', 'Navy / Marine', 'Submitted', 14_600_000],
  ];
  const WORK = [
    ['Update capability statement', null, 'in_work'], ['Renew SAM.gov registration', null, 'todo'],
    ['CMMC Level 2 assessment prep', null, 'in_work'], ['Q4 past performance write-ups', null, 'stale'],
    ['Redesign proposal template', null, 'done'], ['Onboard new program staff', null, 'todo'],
  ];
  const tickets = [];
  BIDS.forEach(([title, org, account, status, value], i) => {
    const owner = i === 7 ? departed : pick(onTeam('BD'));
    const created = ago(int(20, 160), '13:00:00');
    const id = insert('tickets', {
      opportunity_title: title, organization: org, account_type: account, pipeline_status: status, value, ticket_type: 'bid',
      created_by: owner.id, created_at: created, updated_at: created,
      strategy: i % 3 === 0 ? 'Lead with our existing data platform past performance; team with a large prime for scale.' : null,
      assessment: i % 4 === 0 ? 'Strong customer intimacy; pricing will be the deciding factor.' : null,
    });
    tickets.push({ id, title, org, status, owner, type: 'bid' });
  });
  WORK.forEach(([title, org, lane]) => {
    const owner = pick(everyone);
    const created = ago(int(5, 60), '10:00:00');
    const id = insert('tickets', {
      opportunity_title: title, organization: org, ticket_type: 'work', lane, created_by: owner.id, created_at: created, updated_at: created,
      done_at: lane === 'done' ? ago(3) : null,
    });
    tickets.push({ id, title, org, owner, type: 'work' });
  });
  const bids = tickets.filter((t) => t.type === 'bid');

  // Contacts on the bids for the same organization.
  bids.forEach((t) => contacts.filter((c) => c.organization === t.org)
    .forEach((c) => db.prepare('INSERT OR IGNORE INTO ticket_contacts (ticket_id, contact_id, added_by) VALUES (?, ?, ?)').run(t.id, c.id, t.owner.id)));

  // Next steps, tasks and process flow on the open bids.
  const STEPS = ['Schedule customer call', 'Draft white paper outline', 'Confirm teaming partner', 'Pricing review with finance', 'Submit questions by deadline'];
  bids.filter((t) => !['Lost', 'No Bid'].includes(t.status)).forEach((t) => {
    some(STEPS, int(2, 4)).forEach((text, position) => {
      const done = position === 0 && rand() < 0.6;
      insert('ticket_steps', { ticket_id: t.id, text, position, done: done ? 1 : 0, done_at: done ? ago(int(1, 10)) : null, is_next: position === 1 ? 1 : 0, author_id: t.owner.id });
    });
    some(['Pull past performance refs', 'Draft compliance matrix', 'Get resumes for key personnel', 'Review Section M'], int(1, 3)).forEach((text, position) => {
      insert('ticket_tasks', { ticket_id: t.id, text, position, done: rand() < 0.3 ? 1 : 0, created_by: t.owner.id });
    });
    if (['Capture', 'Proposal', 'Submitted', 'Awarded'].includes(t.status)) {
      ['RFI', 'Initial Gate Review', 'RFP'].slice(0, int(1, 3)).forEach((step_type, i) => {
        const reviewers = some(onTeam('Technical Solutioning'), 2).map((p) => p.id);
        insert('ticket_process_steps', {
          ticket_id: t.id, step_type, step_date: addDays(today, -60 + i * 20), author_id: t.owner.id,
          notes: step_type === 'RFI' ? 'Responded with a 10-page capability brief.' : null,
          reviews: json.str({ technical: { people: reviewers, notes: 'Architecture approach approved.' }, pricing: { people: [], notes: '' },
            strategy: { people: [t.owner.id], notes: '' }, support: { people: [], notes: '' } }),
        });
      });
    }
  });

  // ---- Delivery: the triggers made a program for each Awarded bid; give them a PM and a team.
  db.prepare('SELECT * FROM delivery_programs WHERE ticket_id IN (SELECT value FROM json_each(?))').all(json.str(bids.map((t) => t.id))).forEach((p, i) => {
    const pm = onTeam('Operations')[i % onTeam('Operations').length];
    db.prepare("UPDATE delivery_programs SET program_manager_id = ?, awarded_at = ?, notes = ? WHERE id = ?")
      .run(pm.id, ago(40 + i * 25), 'Kickoff complete; first deliverable due next month.', p.id);
    some(onTeam('Technical Solutioning'), 2).forEach((u) => insert('delivery_team', { program_id: p.id, user_id: u.id, role: pick(['Lead Engineer', 'Data Engineer', 'Architect']) }));
    insert('delivery_team', { program_id: p.id, name: 'Jamie Partner (subcontractor)', role: 'Scrum Master' });
  });

  // ---- Weekly priorities: this week and the three before it, for every team.
  const CARD_TITLES = ['Finish technical volume draft', 'Customer meeting prep', 'Update pipeline forecast', 'Teaming agreement redlines',
    'Draft white paper', 'Pricing build-up', 'Review RFP amendments', 'Schedule site visit', 'Write past performance narrative', 'Status report to customer'];
  const CHECKLIST = ['Outline', 'First draft', 'Internal review', 'Send to customer', 'Gather inputs', 'Final edits'];
  const NOTES = ['Waiting on partner input.', 'Customer pushed the meeting to Thursday.', 'Draft is in SharePoint.', 'Need pricing from finance by Wednesday.'];
  db.prepare('SELECT * FROM teams').all().forEach((team) => {
    const current = weekStartFor(today, team.checkin_dow);
    const members = everyone.filter((p) => p.teams[0] === team.id || (p.teams.includes(team.id) && rand() < 0.5));
    [3, 2, 1, 0].forEach((back) => {
      const week = addDays(current, -7 * back);
      const past = back > 0;
      if (past || team.name === 'Marketing') insert('week_planning', { team_id: team.id, week_start: week, closed_by: admin.id, closed_at: stamp(addDays(week, 0), '11:00:00') });
      members.forEach((m) => {
        const count = int(2, 4);
        for (let pos = 0; pos < count; pos++) {
          const ticket = team.name === 'BD' || rand() < 0.5 ? pick(bids) : pick(tickets);
          const items = some(CHECKLIST, int(0, 4)).map((text) => ({ text, done: past ? rand() < 0.85 : rand() < 0.35 }));
          const completed = past ? rand() < 0.75 : rand() < 0.2;
          const card = insert('priority_cards', {
            ticket_id: ticket.id, team_id: team.id, week_start: week, title: pick(CARD_TITLES), due_date: addDays(week, int(1, 6)),
            checklist: json.str(items), completed: completed ? 1 : 0, created_by: m.id, created_at: stamp(week, '09:30:00'),
          });
          insert('card_assignees', { card_id: card, user_id: m.id, position: pos });
          if (rand() < 0.35) insert('card_notes', { card_id: card, body: pick(NOTES), author_id: m.id, created_at: stamp(addDays(week, 2), '16:00:00') });
          if (past && completed) {
            insert('work_log', { team_id: team.id, week_start: week, user_id: m.id, kind: 'completed', ticket_id: ticket.id, card_id: card, summary: 'Wrapped up', created_at: stamp(addDays(week, 4)) });
          }
        }
        // Unplanned work picked up after check-in.
        if ((past || team.name === 'Marketing') && rand() < 0.5) {
          const ticket = pick(tickets);
          const card = insert('priority_cards', {
            ticket_id: ticket.id, team_id: team.id, week_start: week, title: pick(['Urgent customer data call', 'Fix proposal formatting', 'Support event booth']),
            is_planned: 0, checklist: '[]', completed: past ? 1 : 0, created_by: m.id, created_at: stamp(addDays(week, 2), '13:00:00'),
          });
          insert('card_assignees', { card_id: card, user_id: m.id, position: count });
          insert('work_log', { team_id: team.id, week_start: week, user_id: m.id, kind: 'task', ticket_id: ticket.id, card_id: card, summary: 'Picked up unplanned work', created_at: stamp(addDays(week, 2), '13:05:00') });
        }
      });
    });
  });

  // ---- Conversations on tickets, with a few @mentions of the admin waiting in Alerts.
  bids.slice(0, 8).forEach((t, i) => {
    const asker = pick(people);
    const q = insert('ticket_comments', { ticket_id: t.id, kind: i % 2 ? 'question' : 'comment', author_id: asker.id, created_at: ago(int(1, 12), '11:15:00'),
      body: i % 2 ? `Do we have a teaming partner lined up for ${t.title}?` : `Customer hinted the RFP drops next month. @${admin.username} can you join the call?` });
    if (i % 2 === 0) insert('alerts', { user_id: admin.id, actor_id: asker.id, kind: 'mention', ticket_id: t.id, comment_id: q, excerpt: 'Customer hinted the RFP drops next month…', created_at: ago(int(0, 5), '11:16:00') });
    if (rand() < 0.7) insert('ticket_comments', { ticket_id: t.id, kind: 'reply', parent_id: q, author_id: t.owner.id, created_at: ago(int(0, 1), '15:40:00'), body: pick(['Yes — talking with two primes now.', 'On it, will follow up today.', 'Not yet; let us discuss at check-in.']) });
    db.prepare("UPDATE tickets SET updated_at = datetime('now', ?) WHERE id = ?").run(`-${int(0, 20)} days`, t.id);
  });

  // ---- Events, attendees and marketing support requests.
  const EVENTS = [
    ['AUSA Annual Meeting', 12, 14, 'Washington', 'DC', 'Meet PEO STRI and Futures Command leadership.', 1795],
    ['AFCEA TechNet Cyber', 40, 42, 'Baltimore', 'MD', 'Zero trust and cyber range positioning.', 1200],
    ['Sea-Air-Space', 80, 82, 'National Harbor', 'MD', 'Navy customer meetings.', 950],
    ['Space Symposium', 150, 153, 'Colorado Springs', 'CO', 'Space Systems Command pipeline.', 2100],
    ['Modern Day Marine', 175, 177, 'Washington', 'DC', 'Marine Corps logistics opportunities.', 0],
    ['I/ITSEC', -20, -16, 'Orlando', 'FL', 'Simulation and training customers.', 1450],
  ];
  const events = EVENTS.map(([name, from, to, city, state, goal, fee]) => {
    const id = insert('events', {
      name, date_from: addDays(today, from), date_to: addDays(today, to), goal, fee, description: `${name} — annual industry event.`,
      website: 'https://example.com/events', address: `${city} Convention Center`, created_by: pick(onTeam('Marketing')).id,
      location: json.str({ intl: false, city, state, country: 'United States' }), poc_name: 'Event Desk', poc_phone: '(555) 010-0000',
    });
    some(everyone, int(2, 5)).forEach((u) => db.prepare('INSERT OR IGNORE INTO event_attendees (event_id, user_id) VALUES (?, ?)').run(id, u.id));
    return { id, name, from, city, state };
  });
  events.filter((e) => e.from > 0).slice(0, 3).forEach((e, i) => {
    insert('event_support_requests', {
      event_id: e.id, title: pick(['Booth banner', 'One-pager for booth', 'Social posts before the show']), category: pick(['Graphic design', 'Collateral / print', 'Social media', 'Event support']),
      details: `Need materials for ${e.name}.`, requested_by: pick(onTeam('BD')).id, due_date: addDays(today, e.from - 7),
      status: i === 0 ? 'accepted' : 'open', accepted_by: i === 0 ? byName('Jules').id : null, accepted_at: i === 0 ? ago(2) : null,
    });
  });

  // ---- Marketing copy library.
  [['Company boilerplate', 'Boilerplate', 'Knexus delivers data, cloud and AI solutions that help defense customers decide faster.'],
   ['30-second pitch', 'Elevator pitch', 'We turn mission data into decisions — fast, secure and built for the warfighter.'],
   ['Data platform capability', 'Capabilities', 'Our platform ingests, fuses and serves mission data across classification levels.'],
   ['LinkedIn: AUSA invite', 'Social post', 'Heading to AUSA? Stop by booth 1234 to see our synthetic training data demo.']]
    .forEach(([title, category, body]) => insert('marketing_copy', { title, category, body, created_by: byName('Ken').id, created_at: ago(int(5, 60)) }));

  // ---- Trips, booked so the page's estimate refresh doesn't hit live lookups for them.
  const CITIES = [['San Diego', 'CA', 210], ['Colorado Springs', 'CO', 160], ['Orlando', 'FL', 150], ['Huntsville', 'AL', 140], ['Dayton', 'OH', 130], ['Boston', 'MA', 260], ['Norfolk', 'VA', 0]];
  const home = { intl: false, city: 'Washington', state: 'DC', country: 'United States' };
  for (let i = 0; i < 16; i++) {
    const traveler = pick(everyone);
    const [city, state, air] = pick(CITIES);
    const from = addDays(today, int(-60, 200));
    const to = addDays(from, int(1, 4));
    const dest = { intl: false, city, state, country: 'United States' };
    const event = i % 4 === 0 ? pick(events) : null;
    const trip = {
      traveler_id: traveler.id, purposes: event ? ['Conference'] : some(['Internal', 'Client', 'Partner', 'Other'], int(1, 2)),
      location_from: home, location_to: dest, details: event ? event.name : pick(['Customer meetings.', 'Site visit and demo.', 'Partner planning session.']),
      date_from: from, date_to: to, train: air ? 0 : 180,
      airfare: air ? { mode: 'booked', tripType: 'round-trip', bookedAmount: String(air * 2 + int(0, 200)), airline: pick(['United', 'American', 'Delta', 'Southwest']), confirmation: `X${int(10000, 99999)}`, departDate: from, returnDate: to } : { mode: 'none' },
      pov: { enabled: false, miles: '', roundTrip: true, rate: 0.725 },
      car: air && rand() < 0.6 ? { enabled: true, mode: 'booked', vehicleClass: 'Economy / Compact', bookedAmount: String(int(140, 320)), pickupDate: from, dropoffDate: to } : { enabled: false },
      lodging: [{ id: `demo${i}`, hotelName: pick(['Marriott', 'Hilton Garden Inn', 'Hampton Inn', '']), location: dest, checkIn: from, checkOut: to, overrideRate: String(int(130, 260)) }],
      mie: { overrideRate: String(pick([68, 74, 79, 86])) },
    };
    insert('trips', {
      ...trip, purposes: json.str(trip.purposes), location_from: json.str(home), location_to: json.str(dest), airfare: json.str(trip.airfare),
      pov: json.str(trip.pov), car: json.str(trip.car), lodging: json.str(trip.lodging), mie: json.str(trip.mie),
      quarter: quarterFor(from), total_estimate: tripCosts(trip).total, event_id: event?.id ?? null, created_by: traveler.id,
    });
  }

  // ---- People waiting on Admin Access.
  [['Wes', 'Turner', 'Joining the Operations team next month.'], ['Mei', 'Tanaka', 'Marketing contractor for the Space Symposium.']]
    .forEach(([first_name, last_name, reason]) => insert('access_requests', { first_name, last_name, reason, email: `${first_name}.${last_name}@kitdemo.com`.toLowerCase() }));
})();

const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
console.log('Demo data added:', ['users', 'tickets', 'priority_cards', 'contacts', 'events', 'trips', 'delivery_programs', 'ticket_comments', 'alerts']
  .map((t) => `${count(t)} ${t}`).join(', '));
console.log('Demo people sign in with their username (e.g. phargrove) and the password kitdemouser');
