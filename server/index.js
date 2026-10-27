import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { db } from './db.js';
import { requireAuth } from './auth.js';
import { ensureGsaRates } from './services/gsa.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import teamRoutes from './routes/teams.js';
import travelRoutes from './routes/travel.js';
import gsaRoutes from './routes/gsa.js';
import priorityRoutes from './routes/priorities.js';
import ticketRoutes from './routes/tickets.js';
import dashboardRoutes from './routes/dashboard.js';
import alertRoutes from './routes/alerts.js';
import aiRoutes from './routes/ai.js';

ensureGsaRates();

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
app.use('/api/travel', requireAuth, travelRoutes);
app.use('/api/gsa', requireAuth, gsaRoutes);
app.use('/api/priorities', requireAuth, priorityRoutes);
app.use('/api/tickets', requireAuth, ticketRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);
app.use('/api/alerts', requireAuth, alertRoutes);
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

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`KIT API listening on http://localhost:${port}`));
