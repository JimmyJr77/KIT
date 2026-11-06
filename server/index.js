import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { db } from './db.js';
import { requireAuth } from './auth.js';
import { ensureGsaRates } from './services/gsa.js';
import { scheduleForecastSnapshots } from './forecast.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import teamRoutes from './routes/teams.js';
import territoryRoutes from './routes/territories.js';
import targetRoutes from './routes/targets.js';
import objectiveRoutes from './routes/objectives.js';
import financialRoutes from './routes/financials.js';
import archiveRoutes from './routes/archive.js';
import sampleRoutes from './routes/sample.js';
import { ensureSample } from './sample/index.js';
import activityRoutes from './routes/activities.js';
import pipedriveRoutes from './routes/pipedrive.js';
import labelRoutes from './routes/labels.js';
import { schedulePipedriveSync, scheduleProjectRefresh } from './services/pipedrive.js';
import { handleWebhook, scheduleLive } from './services/pipedriveLive.js';
import { scheduleAutoSend } from './services/pipedriveSend.js';
import travelRoutes from './routes/travel.js';
import gsaRoutes from './routes/gsa.js';
import priorityRoutes from './routes/priorities.js';
import taskRoutes from './routes/tasks.js';
import supportRoutes from './routes/support.js';
import ticketRoutes from './routes/tickets.js';
import dashboardRoutes from './routes/dashboard.js';
import alertRoutes from './routes/alerts.js';
import eventRoutes from './routes/events.js';
import eventScoutRoutes from './routes/eventScout.js';
import contactRoutes from './routes/contacts.js';
import deliveryRoutes from './routes/delivery.js';
import marketingRoutes from './routes/marketing.js';
import priorityAccountRoutes from './routes/priorityAccounts.js';
import lessonRoutes from './routes/lessons.js';
import retroRoutes from './routes/retros.js';
import aiRoutes from './routes/ai.js';

ensureGsaRates();
scheduleForecastSnapshots();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
app.get('/api/health', (req, res) => {
  db.prepare('SELECT 1').get();
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', requireAuth, userRoutes);
app.use('/api/teams', teamRoutes); // GET is public (used by account activation)
app.use('/api/territories', requireAuth, territoryRoutes);
app.use('/api/targets', requireAuth, targetRoutes);
app.use('/api/objectives', requireAuth, objectiveRoutes);
app.use('/api/financials', requireAuth, financialRoutes);
app.use('/api/archive', requireAuth, archiveRoutes);
app.use('/api/sample', requireAuth, sampleRoutes);
app.use('/api/travel', requireAuth, travelRoutes);
app.use('/api/gsa', requireAuth, gsaRoutes);
app.use('/api/priorities', requireAuth, priorityRoutes);
app.use('/api/tasks', requireAuth, taskRoutes);
app.use('/api/support', requireAuth, supportRoutes);
app.use('/api/tickets', requireAuth, ticketRoutes);
app.use('/api/activities', requireAuth, activityRoutes);
// Pipedrive's webhooks sign in with HTTP Basic auth (see pipedriveLive.js), not a KIT session.
app.post('/api/pipedrive/webhook', handleWebhook);
app.use('/api/pipedrive', requireAuth, pipedriveRoutes);
app.use('/api/labels', requireAuth, labelRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);
app.use('/api/alerts', requireAuth, alertRoutes);
app.use('/api/event-scout', requireAuth, eventScoutRoutes);
app.use('/api/events', requireAuth, eventRoutes);
app.use('/api/contacts', requireAuth, contactRoutes);
app.use('/api/delivery', requireAuth, deliveryRoutes);
app.use('/api/marketing', requireAuth, marketingRoutes);
app.use('/api/priority-accounts', requireAuth, priorityAccountRoutes);
app.use('/api/lessons', requireAuth, lessonRoutes);
app.use('/api/retros', requireAuth, retroRoutes);
app.use('/api/ai', requireAuth, aiRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// In production, serve the built React app.
const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// The sample data is always available to show; load it the first time the server starts.
try {
  if (ensureSample()) console.log('Loaded the sample data');
} catch (e) {
  console.error(`Couldn't load the sample data: ${e.message}`);
}

schedulePipedriveSync();
scheduleProjectRefresh();
scheduleAutoSend();
scheduleLive();

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`KIT API listening on http://localhost:${port}`));
