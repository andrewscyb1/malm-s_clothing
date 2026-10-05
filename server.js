'use strict';

require('dotenv').config();

const path = require('path');
const qs = require('qs');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const Database = require('better-sqlite3');
const argon2 = require('argon2');
const Stripe = require('stripe');
const { Issuer } = require('openid-client');

const PORT = Number(process.env.PORT) || 5502;
const DATABASE_PATH = process.env.DATABASE_PATH || ':memory:';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.set('query parser', (str) => qs.parse(str));

// Shared services. Stripe is only configured when a key is present.
const db = new Database(DATABASE_PATH);
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

app.locals.db = db;
app.locals.stripe = stripe;
app.locals.argon2 = argon2;
app.locals.OpenIdIssuer = Issuer;

// Middleware
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});

// Graceful shutdown
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);

  const forceExit = setTimeout(() => process.exit(1), 10000);
  forceExit.unref();

  server.close(() => {
    try {
      db.close();
    } catch (err) {
      console.error(err);
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  shutdown('uncaughtException');
});
