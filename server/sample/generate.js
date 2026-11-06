// The sample data itself: fake people and a believable year of BD activity, so every page has something to show.
// It only ever INSERTS (recordSample in registry.js records what it creates), uses only its own sample people, and
// never changes real rows: no real user is assigned, alerted or put on a team's closed planning week.
import crypto from 'node:crypto';
import { db, json, setUserTeams } from '../db.js';
import { hashPassword } from '../auth.js';
import { CRITERIA } from '../../src/lib/assessment.js';
import { quarterFor, tripCosts, addDays } from '../../src/lib/travelCalc.js';

export const SAMPLE_DOMAIN = 'kitdemo.com';
export const SAMPLE_PASSWORD = 'kitdemouser';

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(rand() * list.length)];
const some = (list, n) => [...list].sort(() => rand() - 0.5).slice(0, n);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const insert = (table, row) => {
  const cols = Object.keys(row);
  return Number(db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(row).lastInsertRowid);
};
const weekStartFor = (iso, dow) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - dow + 7) % 7));
  return d.toISOString().slice(0, 10);
};

/**
 * Create the sample. In production, sample people get a random password nobody knows, so they can't sign in;
 * elsewhere they sign in with SAMPLE_PASSWORD.
 */
export function generateSample({ production = process.env.NODE_ENV === 'production' } = {}) {
  seed = 42;
  const today = new Date().toLocaleDateString('en-CA');
  const stamp = (iso, time = '14:00:00') => `${iso} ${time}`;
  const ago = (days, time) => stamp(addDays(today, -days), time);
  const teams = Object.fromEntries(db.prepare('SELECT id, name, checkin_dow FROM teams').all().map((t) => [t.name, t]));
  const territories = db.prepare('SELECT id, name FROM territories ORDER BY position').all();
  const terr = (name) => territories.find((t) => t.name === name)?.id ?? null;
  if (!teams.BD) throw new Error('The sample data needs a team named BD.');

  // ---- People (fictional names; 202-555-01xx phone numbers are reserved for fiction)
  const PEOPLE = [
    ['Avery', 'Collins', 'BD Director', ['BD'], ['Army'], true],
    ['Jordan', 'Reyes', 'BD Director', ['BD'], ['Navy/USMC', 'DoD 4th Estate']],
    ['Taylor', 'Nguyen', 'Capture Manager', ['BD', 'Technical Solutioning'], ['USAF/USSF']],
    ['Morgan', 'Patel', 'BD Director', ['BD'], ['Intel']],
    ['Casey', 'Brooks', 'BD Director', ['BD'], ['DHS/DOJ', 'FedCiv (Other)']],
    ['Riley', 'Kim', 'Proposal Manager', ['BD', 'Marketing'], []],
    ['Quinn', 'Okafor', 'Director of Operations', ['Operations'], []],
    ['Drew', 'Becker', 'Program Manager', ['Operations'], []],
    ['Skyler', 'Liu', 'Program Manager', ['Operations', 'Admin'], []],
    ['Rowan', 'Chen', 'Chief Architect', ['Technical Solutioning'], []],
    ['Emerson', 'Petrova', 'Solutions Engineer', ['Technical Solutioning'], []],
    ['Hayden', 'Moreau', 'Marketing Director', ['Marketing'], []],
    ['Parker', 'Watanabe', 'Content Writer', ['Marketing'], []],
    ['Sage', 'Delgado', 'Office Manager', ['Admin'], []],
  ];
  const people = PEOPLE.map(([first_name, last_name, title, teamNames, terrNames, lead], i) => {
    const email = `${first_name}.${last_name}@${SAMPLE_DOMAIN}`.toLowerCase();
    insert('approved_accounts', { email, role: 'member' });
    const phone = `202-555-01${String(10 + i).padStart(2, '0')}`;
    const password = production ? crypto.randomBytes(24).toString('hex') : SAMPLE_PASSWORD;
    const id = insert('users', {
      first_name, last_name, email, phone, phone_digits: phone.replace(/\D/g, ''), username: `${first_name}.${last_name}.sample`.toLowerCase(),
      title, role: 'member', password_hash: hashPassword(password), created_at: ago(200 - i),
    });
    setUserTeams(id, teamNames.map((n) => teams[n]?.id).filter(Boolean));
    if (lead && teams.BD) db.prepare("UPDATE user_teams SET role = 'lead' WHERE user_id = ? AND team_id = ?").run(id, teams.BD.id);
    terrNames.map(terr).filter(Boolean).forEach((tid) => insert('user_territories', { user_id: id, territory_id: tid }));
    return { id, first_name, last_name, title, teamNames, territories: terrNames };
  });
  const onTeam = (name) => people.filter((p) => p.teamNames.includes(name));
  const bd = onTeam('BD');
  const directors = bd.filter((p) => p.territories.length);

  // ---- Customers and contacts
  const ORGS = [['Army PEO STRI', 'Army'], ['Army Futures Command', 'Army'], ['AFLCMC Hanscom', 'USAF/USSF'], ['Space Systems Command', 'USAF/USSF'],
    ['NAVWAR', 'Navy/USMC'], ['Marine Corps Systems Command', 'Navy/USMC'], ['DIA', 'Intel'], ['NGA', 'Intel'],
    ['DLA J6', 'DoD 4th Estate'], ['DISA', 'DoD 4th Estate'], ['CBP', 'DHS/DOJ'], ['FBI CJIS', 'DHS/DOJ'], ['HHS', 'FedCiv (Other)']];
  const directorFor = (territoryName) => directors.find((d) => d.territories.includes(territoryName)) || pick(directors);
  const CONTACTS = [['Rebecca', 'Stone', 'Contracting Officer'], ['Darnell', 'Price', 'Program Manager'], ['Ann', 'Mercer', 'Program Executive'], ['Steve', 'Kowalski', 'Deputy PM'],
    ['Lisa', 'Tran', 'Contract Specialist'], ['Ben', 'Ortiz', 'Requirements Lead'], ['Helen', 'Cho', 'Chief Engineer'], ['Raj', 'Mehta', 'Small Business Liaison'],
    ['Karen', 'Doyle', 'Branch Chief'], ['Mike', 'Grant', 'Division Chief'], ['Tanya', 'Rhodes', 'Technical Director'], ['Paul', 'Whitman', 'Contracting Officer'], ['Irene', 'Vasquez', 'Lab Director']];
  const contacts = CONTACTS.map(([first_name, last_name, role], i) => {
    const [organization, territoryName] = ORGS[i % ORGS.length];
    const id = insert('contacts', {
      first_name, last_name, organization, role, relationship: int(0, 5), email: `${first_name}.${last_name}@example.gov`.toLowerCase(),
      notes: pick(['Prefers email over calls.', 'Met at an industry day last year.', 'Values short white papers.', null]),
      created_by: directorFor(territoryName).id, created_at: ago(int(30, 200)),
    });
    for (let n = int(0, 2); n > 0; n--) {
      insert('contact_interactions', { contact_id: id, author_id: directorFor(territoryName).id, created_at: ago(int(1, 90), '14:30:00'),
        body: pick(['Intro call; interested in our data platform work.', 'Discussed the FY27 budget outlook.', 'Sent our capability statement.', 'Quick check-in; the RFP is slipping a quarter.']) });
    }
    return { id, organization };
  });

  // ---- Pipeline tickets: open ones across the pipeline, and closed ones over the past five quarters.
  const assessment = (strong) => Object.fromEntries(CRITERIA.map((c) => [c.key, { score: strong ? int(3, 5) : int(2, 4) }]));
  const STAGES = ['Prospecting', 'Qualified', 'Capture', 'Proposal', 'Under Evaluation'];
  const OPEN = [['Synthetic Training Data Pipeline', 0, 'Proposal', 18_500_000], ['Enterprise Cloud Migration Support', 2, 'Capture', 42_000_000],
    ['Tactical Network Modernization', 1, 'Qualified', 9_800_000], ['AI-Enabled Maintenance Forecasting', 5, 'Under Evaluation', 12_300_000],
    ['Zero Trust Architecture Pilot', 3, 'Prospecting', 5_500_000], ['Software Factory Support', 1, 'Proposal', 33_000_000],
    ['Satellite Ground Systems Sustainment', 3, 'Capture', 61_000_000], ['ISR Data Fusion Prototype', 7, 'Qualified', 7_750_000],
    ['C5ISR Help Desk Recompete', 4, 'Under Evaluation', 14_600_000], ['Biometric Matching Modernization', 11, 'Capture', 19_000_000],
    ['Grants Analytics Platform', 12, 'Prospecting', 2_100_000], ['Defense Logistics Data Exchange', 8, 'Qualified', 8_400_000]];
  const CLOSED = [['Joint Logistics Data Hub', 8, 'Awarded', 9_200_000, 420], ['Space Domain Awareness Analytics', 3, 'Awarded', 14_500_000, 330],
    ['Fleet Readiness Portal', 4, 'Awarded', 6_800_000, 250], ['Intel Data Lake Modernization', 6, 'Awarded', 22_000_000, 160],
    ['Border Analytics Pilot', 10, 'Awarded', 4_100_000, 70], ['Army Training Records Cloud', 1, 'Lost', 11_000_000, 300],
    ['Case Data Migration', 11, 'Lost', 8_500_000, 200], ['Wargaming Lab Support', 5, 'Lost', 5_000_000, 110],
    ['Mobile Inspection App', 10, 'Lost', 3_200_000, 90], ['Imagery Tagging Service', 7, 'Awarded', 7_400_000, 30]];
  const history = db.prepare(`INSERT INTO ticket_history (ticket_id, pipeline_status, value, bd_director_id, territory_id, projected_win_date, win_date_undetermined, changed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  /** Replace a new pipeline ticket's automatic history row with a climb through the stages from creation to now (or to its close). */
  const backdate = (id, t, finalStatus, closedOn) => {
    db.prepare('DELETE FROM ticket_history WHERE ticket_id = ?').run(id);
    const end = closedOn || today;
    const path = ['Awarded', 'Lost'].includes(finalStatus) ? STAGES.slice(0, int(2, 5)).concat(finalStatus) : STAGES.slice(0, STAGES.indexOf(finalStatus) + 1);
    const span = Math.max(1, (Date.parse(end) - Date.parse(t.created)) / 864e5);
    path.forEach((stage, i) => {
      const day = i === path.length - 1 && closedOn ? closedOn : addDays(t.created, Math.round((span * i) / path.length));
      const value = i === path.length - 1 ? t.value : Math.round((t.value * (0.7 + (0.3 * (i + 1)) / path.length)) / 1000) * 1000;
      history.run(id, stage, value, t.director, t.territory, t.date, t.undetermined, stamp(day));
    });
  };
  const bids = [];
  OPEN.forEach(([title, orgIndex, status, value], i) => {
    const [org, territoryName] = ORGS[orgIndex];
    const director = directorFor(territoryName);
    const created = addDays(today, -int(40, 260));
    const undetermined = i % 5 === 2 ? 1 : 0;
    const date = undetermined || i === OPEN.length - 1 ? null : addDays(today, int(15, 400));
    const t = { created, value, director: director.id, territory: terr(territoryName), date, undetermined };
    const id = insert('tickets', {
      opportunity_title: title, organization: org, pipeline_status: status, value, ticket_type: 'bid', created_by: director.id,
      created_at: stamp(created), updated_at: stamp(created), bd_director_id: director.id, territory_id: t.territory,
      projected_win_date: date, win_date_undetermined: undetermined, assessment: i % 4 === 3 ? null : json.str(assessment(['Proposal', 'Under Evaluation'].includes(status))),
      strategy: i % 3 === 0 ? 'Lead with our data platform past performance; team with a large prime for scale.' : null,
    });
    backdate(id, t, status);
    bids.push({ id, title, org, status, owner: director });
  });
  const closed = [];
  CLOSED.forEach(([title, orgIndex, status, value, daysAgo]) => {
    const [org, territoryName] = ORGS[orgIndex];
    const director = directorFor(territoryName);
    const closedOn = addDays(today, -daysAgo);
    const created = addDays(closedOn, -int(120, 260));
    const t = { created, value, director: director.id, territory: terr(territoryName), date: addDays(closedOn, int(-30, 30)), undetermined: 0 };
    const id = insert('tickets', {
      opportunity_title: title, organization: org, pipeline_status: status, value, ticket_type: 'bid', created_by: director.id,
      created_at: stamp(created), updated_at: stamp(closedOn), bd_director_id: director.id, territory_id: t.territory,
      projected_win_date: t.date, assessment: json.str(assessment(status === 'Awarded')),
    });
    db.prepare('UPDATE tickets SET done_at = ?, deal_status = ?, won_at = ?, lost_at = ? WHERE id = ?')
      .run(stamp(closedOn), status === 'Awarded' ? 'won' : 'lost', status === 'Awarded' ? stamp(closedOn) : null, status === 'Lost' ? stamp(closedOn) : null, id);
    backdate(id, t, status, closedOn);
    closed.push({ id, title, status, closedOn, value, director });
  });

  // ---- Work tickets, one in each swim lane.
  const work = [['Update capability statement', 'in_work'], ['Renew SAM.gov registration', 'todo'], ['CMMC Level 2 assessment prep', 'in_work'],
    ['Past performance write-ups', 'stale'], ['Redesign proposal template', 'done']].map(([title, lane]) => {
    const owner = pick(people);
    const created = ago(int(5, 60), '10:00:00');
    const id = insert('tickets', { opportunity_title: title, ticket_type: 'work', lane, created_by: owner.id, created_at: created, updated_at: created, done_at: lane === 'done' ? ago(3) : null });
    return { id, title, owner };
  });

  // Contacts on pipeline tickets for the same organization; activities (next steps first) and process flow on open pipeline tickets; a few conversations.
  bids.forEach((t) => contacts.filter((c) => c.organization === t.org).forEach((c) => insert('ticket_contacts', { ticket_id: t.id, contact_id: c.id, added_by: t.owner.id })));
  bids.forEach((t) => {
    const steps = some(['Schedule customer call', 'Draft white paper outline', 'Confirm teaming partner', 'Pricing review with finance', 'Submit questions by deadline'], int(2, 4))
      .map((text, i) => ({ text, activity_type: i ? 'Task' : 'Call', due_date: rand() < 0.7 ? addDays(today, int(-3, 20)) : null }));
    const tasks = some(['Pull past performance references', 'Draft compliance matrix', 'Get resumes for key personnel', 'Review Section M'], int(1, 3))
      .map((text) => ({ text, activity_type: 'Task', due_date: null, done: rand() < 0.3 ? 1 : 0 }));
    [...steps, ...tasks].forEach((k, position) => insert('ticket_tasks', {
      ticket_id: t.id, position, done: 0, assignee_id: t.owner.id, created_by: t.owner.id, created_at: ago(int(1, 20), '09:00:00'), ...k,
      done_at: k.done ? ago(int(0, 5)) : null,
    }));
    if (['Capture', 'Proposal', 'Under Evaluation'].includes(t.status)) {
      ['RFI', 'Initial Gate Review', 'RFP'].slice(0, int(1, 3)).forEach((step_type, i) => insert('ticket_process_steps', {
        ticket_id: t.id, step_type, step_date: addDays(today, -60 + i * 20), author_id: t.owner.id,
        reviews: json.str({ technical: { people: some(onTeam('Technical Solutioning'), 2).map((p) => p.id), notes: 'Architecture approach approved.' },
          pricing: { people: [], notes: '' }, strategy: { people: [t.owner.id], notes: '' }, support: { people: [], notes: '' } }),
      }));
    }
  });
  bids.slice(0, 6).forEach((t, i) => {
    const asker = pick(people.filter((p) => p !== t.owner));
    const q = insert('ticket_comments', { ticket_id: t.id, kind: i % 2 ? 'question' : 'comment', author_id: asker.id, created_at: ago(int(1, 12), '11:15:00'),
      body: i % 2 ? `Do we have a teaming partner lined up for ${t.title}?` : 'Customer hinted the RFP drops next month.' });
    insert('ticket_comments', { ticket_id: t.id, kind: 'reply', parent_id: q, author_id: t.owner.id, created_at: ago(int(0, 1), '15:40:00'), body: pick(['Talking with two primes now.', 'On it; will follow up today.']) });
  });

  // ---- Contracts won (the award trigger made them): a PM, a team, funding received and monthly billing.
  const awarded = closed.filter((c) => c.status === 'Awarded');
  awarded.forEach((c, i) => {
    const p = db.prepare('SELECT * FROM delivery_programs WHERE ticket_id = ?').get(c.id);
    if (!p) return;
    db.prepare('UPDATE delivery_programs SET awarded_at = ?, program_manager_id = ?, notes = ? WHERE id = ?')
      .run(stamp(c.closedOn), onTeam('Operations')[i % onTeam('Operations').length]?.id ?? null, 'Kickoff complete; first deliverable due next month.', p.id);
    some(onTeam('Technical Solutioning'), 2).forEach((u) => insert('delivery_team', { program_id: p.id, user_id: u.id, role: pick(['Lead Engineer', 'Data Engineer', 'Architect']) }));
    const funded = 0.35 + rand() * 0.5;
    const increments = int(1, 3);
    for (let k = 0; k < increments; k++) {
      const on = addDays(c.closedOn, k * 120);
      if (on > today) break;
      insert('program_entries', { program_id: p.id, kind: 'funding', amount: Math.round((c.value * funded) / increments / 1000) * 1000, entry_date: on, note: k ? `Incremental funding ${k}` : 'Initial obligation' });
    }
    const monthly = c.value / int(30, 48);
    for (let d = addDays(c.closedOn, 30); d <= today; d = addDays(d, 30)) insert('program_entries', { program_id: p.id, kind: 'billing', amount: Math.round(monthly * (0.85 + rand() * 0.3)), entry_date: d, note: 'Monthly invoice' });
  });

  // ---- Weekly priorities for sample people only: their teams' current week and the three before it.
  const TITLES = ['Finish technical volume draft', 'Customer meeting prep', 'Update pipeline forecast', 'Teaming agreement redlines', 'Draft white paper', 'Pricing build-up', 'Review RFP amendments', 'Write past performance narrative'];
  const ITEMS = ['Outline', 'First draft', 'Internal review', 'Send to customer', 'Gather inputs', 'Final edits'];
  const tickets = [...bids, ...work];
  Object.values(teams).forEach((team) => {
    const members = people.filter((p) => p.teamNames[0] === team.name);
    const current = weekStartFor(today, team.checkin_dow);
    [3, 2, 1, 0].forEach((back) => {
      const week = addDays(current, -7 * back);
      const past = back > 0;
      members.forEach((m) => {
        const count = int(2, 4);
        for (let pos = 0; pos < count; pos++) {
          // Each priority is an activity on its ticket, with its checklist as subtasks and its status updates as comments.
          const ticket = team.name === 'BD' ? pick(bids) : pick(tickets);
          const title = pick(TITLES);
          const due = addDays(week, int(1, 6));
          const completed = (past ? rand() < 0.75 : rand() < 0.2) ? 1 : 0;
          const checklist = some(ITEMS, int(0, 4)).map((text) => ({ text, done: past ? rand() < 0.85 : rand() < 0.35 }));
          const created = stamp(week, '09:30:00');
          const activity = insert('ticket_tasks', {
            ticket_id: ticket.id, text: title, activity_type: 'Task', due_date: due, done: completed, done_at: completed ? stamp(due, '17:00:00') : null,
            assignee_id: m.id, created_by: m.id, created_at: created,
            position: db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM main.ticket_tasks WHERE ticket_id = ?').get(ticket.id).p,
          });
          checklist.forEach((i, n) => insert('activity_subtasks', { task_id: activity, text: i.text, done: i.done ? 1 : 0, position: n, created_by: m.id, created_at: created }));
          const card = insert('priority_cards', {
            ticket_id: ticket.id, team_id: team.id, week_start: week, activity_id: activity, title, due_date: due,
            checklist: json.str(checklist), completed, created_by: m.id, created_at: created,
          });
          insert('card_assignees', { card_id: card, user_id: m.id, position: pos });
          if (rand() < 0.3) {
            insert('ticket_comments', { ticket_id: ticket.id, card_id: card, kind: 'comment', target_type: 'activity', target_id: activity, author_id: m.id,
              created_at: stamp(addDays(week, 2), '16:00:00'), body: pick(['Waiting on partner input.', 'Customer pushed the meeting to Thursday.', 'Draft is in SharePoint.']) });
          }
        }
      });
    });
  });

  // ---- Events, support requests, marketing copy and trips.
  const EVENTS = [['AUSA Annual Meeting', 12, 14, 'Washington', 'DC', 1795], ['AFCEA TechNet Cyber', 40, 42, 'Baltimore', 'MD', 1200], ['Sea-Air-Space', 80, 82, 'National Harbor', 'MD', 950],
    ['Space Symposium', 150, 153, 'Colorado Springs', 'CO', 2100], ['I/ITSEC', -20, -16, 'Orlando', 'FL', 1450]];
  const events = EVENTS.map(([name, from, to, city, state, fee]) => {
    const id = insert('events', { name, date_from: addDays(today, from), date_to: addDays(today, to), goal: 'Customer meetings and pipeline building.', fee, description: `${name}: annual industry event.`,
      website: 'https://example.com/events', address: `${city} Convention Center`, created_by: (onTeam('Marketing')[0] || people[0]).id, location: json.str({ intl: false, city, state, country: 'United States' }) });
    some(people, int(2, 5)).forEach((u) => insert('event_attendees', { event_id: id, user_id: u.id }));
    return { id, name, from };
  });
  events.filter((e) => e.from > 0).slice(0, 2).forEach((e) => insert('event_support_requests', {
    event_id: e.id, title: pick(['Booth banner', 'One-pager for the booth']), category: pick(['Graphic design', 'Collateral / print']), details: `Materials for ${e.name}.`,
    requested_by: pick(bd).id, due_date: addDays(today, e.from - 7), status: 'open',
  }));
  // Marketing spend over the last year: event sponsorships (split between whoever goes), spend on specific pipeline tickets and
  // directors, territory campaigns, and some company-wide.
  const spender = (onTeam('Marketing')[0] || people[0]).id;
  events.forEach((e) => insert('marketing_spend', { spent_on: addDays(today, Math.min(e.from, 0) - int(10, 40)), amount: int(4, 15) * 1000, description: `${e.name} sponsorship`,
    category: 'Event sponsorship', vendor: e.name, event_id: e.id, created_by: spender }));
  for (let i = 0; i < 14; i++) {
    const b = pick(bids);
    const on = addDays(today, -int(5, 360));
    const kind = i % 4;
    insert('marketing_spend', {
      spent_on: on, amount: int(5, 60) * 100, created_by: spender,
      ...(kind === 0 ? { description: `Capture collateral: ${b.title}`, category: 'Collateral & print', ticket_id: b.id }
        : kind === 1 ? { description: 'Customer dinner', category: 'Hospitality', user_id: pick(directors).id, organization: b.org }
        : kind === 2 ? { description: 'Targeted LinkedIn campaign', category: 'Digital & web', territory_id: terr(pick(directors).territories[0]) }
        : { description: pick(['Brand video refresh', 'Website update', 'Trade show swag']), category: pick(['Content & video', 'Digital & web', 'Swag & giveaways']) }),
    });
  }

  [['Company boilerplate', 'Boilerplate', 'We deliver data, cloud and AI solutions that help defense customers decide faster.'],
    ['30-second pitch', 'Elevator pitch', 'We turn mission data into decisions: fast, secure, and built for the warfighter.']]
    .forEach(([title, category, body]) => insert('marketing_copy', { title, category, body, created_by: (onTeam('Marketing')[1] || people[0]).id }));
  const CITIES = [['San Diego', 'CA', 210], ['Colorado Springs', 'CO', 160], ['Orlando', 'FL', 150], ['Huntsville', 'AL', 140], ['Dayton', 'OH', 130], ['Norfolk', 'VA', 0]];
  const home = { intl: false, city: 'Washington', state: 'DC', country: 'United States' };
  for (let i = 0; i < 12; i++) {
    const traveler = pick(people);
    const [city, state, air] = pick(CITIES);
    const from = addDays(today, int(-60, 200));
    const to = addDays(from, int(1, 4));
    const dest = { intl: false, city, state, country: 'United States' };
    const trip = {
      traveler_id: traveler.id, purposes: some(['Internal', 'Client', 'Partner', 'Other'], int(1, 2)), date_from: from, date_to: to, train: air ? 0 : 180,
      airfare: air ? { mode: 'booked', bookedAmount: String(air * 2 + int(0, 200)), airline: pick(['United', 'American', 'Delta']) } : { mode: 'none' },
      pov: { enabled: false }, car: { enabled: false }, lodging: [{ id: `sample${i}`, location: dest, checkIn: from, checkOut: to, overrideRate: String(int(130, 260)) }],
      mie: { overrideRate: String(pick([68, 74, 79])) },
    };
    insert('trips', { ...trip, purposes: json.str(trip.purposes), location_from: json.str(home), location_to: json.str(dest), details: 'Customer meetings.',
      airfare: json.str(trip.airfare), pov: json.str(trip.pov), car: json.str(trip.car), lodging: json.str(trip.lodging), mie: json.str(trip.mie),
      quarter: quarterFor(from), total_estimate: tripCosts(trip).total, created_by: traveler.id });
  }

  // ---- BD goals and account plans: booking targets for sample directors, and account objectives.
  const year = Number(today.slice(0, 4));
  directors.forEach((d) => [year, year + 1].forEach((y) => [1, 2, 3, 4].forEach((q) => {
    const booking = int(3, 9) * 1_000_000;
    insert('booking_targets', { user_id: d.id, year: y, quarter: q, amount: booking });
    // A qualified pipeline worth about three times the quarter's bookings.
    insert('qualified_targets', { user_id: d.id, year: y, quarter: q, amount: booking * 3 });
  })));
  const OBJ = ['Brief the program office on our data platform', 'Meet the new contracting officer', 'Get our approach into the draft requirement', 'Host a capability demo for the requirements team'];
  directors.forEach((d) => {
    for (let i = int(1, 3); i > 0; i--) {
      const status = pick(['Not started', 'In progress', 'In progress', 'Achieved', 'Missed']);
      const target = addDays(today, int(-60, 120));
      insert('account_objectives', { organization: pick(ORGS.filter(([, t]) => d.territories.includes(t)).map(([o]) => o).concat('DISA')), territory_id: terr(d.territories[0]), owner_id: d.id,
        objective: pick(OBJ), target_date: target, status, created_by: d.id, created_at: ago(int(20, 120)),
        completed_at: ['Achieved', 'Missed'].includes(status) ? stamp(addDays(target, -int(0, 20))) : null });
    }
  });

  // Last quarter's forecast for the sample pipeline tickets projected into it, so forecast reliability has a quarter to judge.
  const lastQuarter = quarterFor(addDays(today, -95));
  const [ly, lq] = lastQuarter.split(' Q').map(Number);
  const qStart = `${ly}-${String((lq - 1) * 3 + 1).padStart(2, '0')}-01`;
  const qEnd = new Date(Date.UTC(ly, lq * 3, 0)).toISOString().slice(0, 10);
  closed.filter((c) => c.status === 'Awarded' && c.closedOn >= qStart && c.closedOn <= qEnd).forEach((c) => insert('forecast_snapshots', {
    quarter: lastQuarter, taken_on: qStart, ticket_id: c.id, opportunity_title: c.title, bd_director_id: c.director.id, pipeline_status: 'Under Evaluation', value: c.value, pwin: 0.55, weighted: c.value * 0.55,
  }));

  generateSampleLessons({ people, today });

  return { people: people.length, bids: bids.length + closed.length, work: work.length, contacts: contacts.length, events: events.length };
}

/**
 * The sample's retrospectives and lessons, for `people` (sample users: { id }) as of `today`. Apart from generateSample so a
 * development database that already has the sample can take just these (recordSample records what they add).
 */
export function generateSampleLessons({ people, today }) {
  const stamp = (iso, time = '14:00:00') => `${iso} ${time}`;
  // ---- Retrospectives and Lessons Learned: a run of bid hot washes over the past year and a half, and the lessons they
  // and people on their own wrote down. The same few problems come back (pricing late, past performance thin, color
  // teams slipping) while others get fixed and stay fixed, so the trends have something to say.
  const tagId = (name) => db.prepare('SELECT id FROM lesson_tags WHERE name = ? COLLATE NOCASE').get(name)?.id
    ?? insert('lesson_tags', { name, tag_group: 'Added by users', created_by: people[0].id });
  const linkTag = db.prepare('INSERT OR IGNORE INTO lesson_tag_links (lesson_id, tag_id) VALUES (?, ?)');
  const RETROS = [['Army Training Records Cloud hot wash', 470], ['Case Data Migration hot wash', 330], ['Intel Data Lake hot wash', 230],
    ['Wargaming Lab Support hot wash', 150], ['Software Factory pink team retro', 75], ['Q3 BD retro', 25]];
  const retroNotes = RETROS.map(([name, daysAgo]) => {
    const retroDate = addDays(today, -daysAgo);
    const boardId = insert('retro_boards', { name, retro_date: retroDate, template: 'hot_wash', stage: 'closed', hide_notes: 0, created_by: people[0].id, created_at: stamp(retroDate, '09:00:00') });
    const lanes = [['Helped us', 'good'], ['Hurt us', 'bad'], ['Surprised us', null]].map(([laneName, lean], position) => insert('retro_lanes', { board_id: boardId, name: laneName, lean, position }));
    const note = (lane, text) => insert('retro_notes', { board_id: boardId, lane_id: lanes[lane], text, author_key: crypto.createHash('sha256').update(`${boardId}:${int(1, 6)}`).digest('hex').slice(0, 16) });
    return { retroDate, good: (t) => note(0, t), bad: (t) => note(1, t) };
  });
  // [retro index or days ago, kind, action, title, tags, context, problem, solution, author index]
  const LESSONS = [
    [0, 'bad', 'change', 'Price volume started after the technical volume was done', ['Proposal', 'Pricing', 'ROM'], 'Army Training Records Cloud, a $11M full-and-open bid.', 'Pricing began in the last ten days. The BOE never matched the staffing in the technical volume and we came in 18% high.', 'Start the ROM at the Initial Gate Review and refresh it at every color team.', 0],
    [0, 'bad', 'change', 'Past performance citations were a year out of date', ['Proposal', 'Past performance'], 'Same bid.', 'Two of three citations ended before the recency window. The evaluators scored past performance Marginal.', null, 1],
    [0, 'good', 'continue', 'Capture calls with the program office before the draft RFP', ['Capture', 'Customer calls'], 'Three calls with the PM and the requirements lead in the six months before release.', null, 'Keep booking the calls as KIT activities so the whole team sees them.', 0],
    [0, 'bad', 'change', 'Teaming agreement signed a week before submission', ['Capture', 'Teaming'], 'Our data partner on the bid.', 'The partner’s workshare was still open at pink team, so their section arrived late and unreviewed.', 'Sign teaming agreements before the Initial Gate Review or drop the partner.', 2],
    [1, 'bad', 'change', 'Pricing still started late', ['Proposal', 'Pricing'], 'Case Data Migration, DHS/DOJ.', 'We started the ROM at the gate review as planned, but nobody refreshed it; the final price was built in four days again.', 'Make the pricing refresh a named step on each color team checklist.', 3],
    [1, 'bad', 'change', 'Red team ran two days before submission', ['Proposal', 'Color team'], 'Case Data Migration.', 'Red team comments could not be worked in; half were ignored.', null, 1],
    [1, 'good', 'change', 'Win themes were set early but never made it into the volumes', ['Capture', 'Proposal', 'Win themes'], 'Themes agreed at the Initial Gate Review.', 'Writers did not have them in front of them.', 'Put the win themes at the top of every volume outline.', 0],
    [1, 'good', 'continue', 'Teaming agreement signed before the gate review', ['Capture', 'Teaming'], 'The fix from the Army bid, applied here.', null, 'Worked: the partner section was in the pink team draft.', 2],
    [2, 'bad', 'change', 'Past performance again thin on the data lake bid', ['Proposal', 'Past performance'], 'Intel Data Lake Modernization, $22M. Won, but past performance scored lowest.', 'We have the work but nobody keeps the citations current; writing them from scratch each time.', null, 4],
    [2, 'good', 'continue', 'Pink team held three weeks out', ['Proposal', 'Color team'], 'The pink team date was set at the gate review and held.', null, 'Keep setting color team dates at the Initial Gate Review.', 3],
    [2, 'good', 'continue', 'Pricing refreshed at pink team', ['Proposal', 'Pricing'], 'First bid where the color team checklist had the pricing refresh on it.', null, 'The final price took one day instead of four. Keep the checklist step.', 0],
    [2, 'bad', 'change', 'Compliance matrix built from the draft RFP, not the final', ['Proposal', 'Compliance'], 'Section L changed between draft and final.', 'Two required attachments were missed until the red team caught them.', 'Rebuild the compliance matrix from the final RFP on release day.', 1],
    [3, 'bad', 'change', 'Price was not competitive on Wargaming Lab Support', ['Proposal', 'Pricing', 'Under Evaluation'], 'Lost on price; debrief said we were 22% above the winner.', 'Pricing started on time, but the labor mix assumed senior staff throughout.', null, 4],
    [3, 'bad', 'change', 'Red team slipped again', ['Proposal', 'Color team'], 'Wargaming Lab Support.', 'Red team moved from ten days out to three because the technical volume was not ready.', 'Hold the red team date even if the draft is rough.', 3],
    [3, 'good', 'continue', 'KIT activities kept the capture plan visible', ['Capture', 'KIT'], 'Every customer call and gate review was a KIT activity with a next step.', null, 'The weekly check-in ran off the ticket. Keep doing this on every pipeline ticket.', 0],
    [3, 'bad', 'change', 'No key personnel identified until the proposal phase', ['Capture', 'Staffing'], 'The PM named in the proposal had never met the customer.', 'Customer asked about the PM at orals and we had little to say.', 'Name the PM candidate by the Final Gate Review.', 2],
    [4, 'good', 'continue', 'Red team held ten days out', ['Proposal', 'Color team'], 'Software Factory Support, $33M, in evaluation.', null, 'The date was held even with a rough draft; the comments were all worked in.', 3],
    [4, 'bad', 'change', 'Past performance volume still written from scratch', ['Proposal', 'Past performance'], 'Software Factory Support.', 'Third bid in a row where the citations took a week of a writer’s time.', 'Build a past performance library in the shared drive with one owner.', 1],
    [4, 'bad', 'change', 'Pricing labor mix too senior again', ['Proposal', 'Pricing'], 'Software Factory Support.', 'Same mix as Wargaming Lab; we corrected it only after the Operations review.', 'Have Operations review the labor mix at pink team, not at red.', 4],
    [4, 'good', 'continue', 'Win themes on every volume outline', ['Proposal', 'Win themes'], 'The fix from Case Data Migration.', null, 'Writers used them; the pink team scored the themes clear. Keep it.', 0],
    [5, 'bad', 'change', 'Key personnel letters of commitment arrived late', ['Proposal', 'Staffing'], 'Two bids this quarter.', 'Letters came the day before submission; one candidate withdrew the week after.', null, 2],
    [5, 'bad', 'change', 'Customer calls dropped off during proposal phase', ['Capture', 'Customer calls'], 'C5ISR Help Desk Recompete and Satellite Ground Systems.', 'Once writing started nobody called the customer for two months; we missed a change in the evaluation board.', 'Keep one capture call a month through submission.', 0],
    [5, 'good', 'continue', 'Past performance library in use', ['Proposal', 'Past performance'], 'Started after the Software Factory retro.', null, 'Citations took two days on the last bid. Keep it current after every award.', 1],
    [5, 'bad', 'change', 'Pink team moved for a trade show', ['Proposal', 'Color team'], 'Satellite Ground Systems Sustainment.', 'Half the reviewers were at a conference; pink team slipped a week.', null, 3],
    // Lessons people wrote on their own, apart from a retro.
    [440, 'bad', 'change', 'Gate review packages missing the ROM', ['Initial Gate Review', 'ROM'], 'Three gate reviews in a row.', 'Reviewers could not judge price-to-win without a ROM.', 'A gate review is not scheduled until the ROM is attached in KIT.', 0],
    [410, 'good', 'continue', 'Weekly BD check-in runs off KIT', ['KIT', 'Admin'], 'Moved the check-in from a slide deck to the KIT pipeline board.', null, 'Thirty minutes shorter. Keep it.', 1],
    [290, 'bad', 'change', 'RFI responses written without a capture plan', ['RFI Response', 'Capture'], 'Two RFIs answered in the same week.', 'Both read as capability statements; neither shaped the requirement.', 'Treat an RFI as a capture step: a call with the customer first, then the response.', 2],
    [260, 'good', 'change', 'Debriefs requested on every loss', ['Lost', 'Capture'], 'We asked for a debrief on both losses this quarter.', 'One debrief came late because the request went in after the deadline.', 'Request the debrief the day the notice arrives.', 4],
    [200, 'bad', 'change', 'Teaming partner unresponsive after award', ['Awarded', 'Teaming', 'Software'], 'Joint Logistics Data Hub.', 'The partner’s staff were not cleared in time for transition.', 'Add clearance status to the teaming checklist.', 3],
    [120, 'bad', 'change', 'ROM in KIT left unlocked after the gate review', ['ROM', 'KIT'], 'Two tickets had ROMs edited after the decision.', 'The gate review decided on a number that then changed.', 'Lock the estimate at the gate review.', 0],
    [60, 'good', 'continue', 'Estimate lock after gate reviews', ['ROM', 'KIT', 'Final/Follow-on Gate Review'], 'The lock from the earlier lesson is in KIT now.', null, 'No surprises since. Keep it.', 0],
    [40, 'bad', 'change', 'Orals rehearsal scheduled for the day before', ['Proposal', 'Orals'], 'AI-Enabled Maintenance Forecasting.', 'One rehearsal, the night before; the PM read from slides.', null, 2],
    [10, 'bad', 'change', 'Pricing started late on the Biometric bid', ['Proposal', 'Pricing'], 'Biometric Matching Modernization, in capture.', 'The ROM has not been refreshed since the gate review four months ago.', null, 4],
  ];
  LESSONS.forEach(([when, kind, action, title, tags, context, problem, solution, who]) => {
    const retro = typeof when === 'number' && when < RETROS.length ? retroNotes[when] : null;
    const retroDate = retro ? retro.retroDate : addDays(today, -when);
    const sourceId = retro ? (kind === 'good' ? retro.good : retro.bad)(title) : null;
    const id = insert('lessons', {
      title, kind, action, context, problem, solution, retro_date: retroDate, source: retro ? 'retro' : 'manual', source_id: sourceId,
      created_by: people[who].id, created_at: stamp(addDays(retroDate, int(0, 3)), '15:00:00'),
    });
    tags.forEach((t) => linkTag.run(id, tagId(t)));
  });

}
