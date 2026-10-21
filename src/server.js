/**
 * server.js — SIMPLE API on top of the Mail.td *web* backend.
 *
 *
 *   GET /create                       -> a brand-new mail
 *   GET /inbox?email=you@qabq.com     -> its messages
 *   GET /message?email=..&msg=<id>    -> one full message
 *   GET /otp?email=you@qabq.com       -> wait for a mail and give you the code
 *   GET /wait?email=you@qabq.com      -> wait for the next new mail
 *   GET /domains                      -> available domains
 *   GET /login?email=..&password=..   -> get a mail back after a restart
 *
 * The server remembers the mail you created, so after /create you only
 * ever pass `email` — no ids, no tokens, no headers.
 * If the server restarted, add `&password=..` once (or call /login) and
 * it logs that mail back in automatically.
 *
 * The full REST routes under /accounts/:id/* still work too (see README).
 */

import express from 'express';
import cors from 'cors';
import { MailTDClient, MailTDError } from './mailtd.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/** Sessions remembered by this server, keyed both ways. */
const byId = new Map();
const byEmail = new Map();

function remember(client) {
  if (client.id) byId.set(client.id, client);
  if (client.address) byEmail.set(client.address.toLowerCase(), client);
  return client;
}

function handleError(res, err) {
  if (err instanceof MailTDError) {
    return res.status(err.status || 500).json({ error: err.code, ...err.data });
  }
  console.error(err);
  return res.status(500).json({ error: 'internal_error', message: err.message });
}

const secs = (v, fallback) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 300) * 1000 : fallback;
};

/** The friendly shape returned by /create and /login. */
function mailInfo(req, client) {
  const base = `${req.protocol}://${req.get('host')}`;
  const email = client.address;
  return {
    email,
    password: client.password,
    id: client.id,
    token: client.token,
    inbox: `${base}/inbox?email=${encodeURIComponent(email)}`,
    otp: `${base}/otp?email=${encodeURIComponent(email)}`,
  };
}

/**
 * Find (or restore) the client for a simple route.
 * Looks up ?email= / ?id= in the remembered sessions; if a password is
 * also given and nothing is remembered, it logs the mail in on the spot.
 */
async function resolveSimple(req, res, next) {
  try {
    const q = { ...req.query, ...(req.body || {}) };
    const email = (q.email || q.mail || q.address || '').toLowerCase() || null;
    const id = q.id || null;
    let client = (email && byEmail.get(email)) || (id && byId.get(id)) || null;

    if (!client && email && q.password) {
      client = remember(new MailTDClient());
      await client.login(email, q.password);
    }
    if (!client) {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
      if (token && id) client = remember(new MailTDClient({ id, token }));
    }
    if (!client) {
      return res.status(404).json({
        error: 'mail_not_found',
        message: 'Unknown mail. Call /create first, or add &password=<its password> so it can log back in.',
      });
    }
    req.client = client;
    next();
  } catch (err) { handleError(res, err); }
}

/** Resolve for the classic /accounts/:id/* routes. */
function resolveClient(req, res, next) {
  let client = byId.get(req.params.id);
  if (!client) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      return res.status(404).json({
        error: 'session_not_found',
        message: 'No local session for this account id. Create/login first, or send its JWT as Authorization: Bearer <token>.',
      });
    }
    client = remember(new MailTDClient({ id: req.params.id, token }));
  }
  req.client = client;
  next();
}

// ============================ SIMPLE API ============================

app.all('/', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    ok: true,
    how_to_use: {
      '1_create_a_mail': `GET ${base}/create`,
      '2_read_its_inbox': `GET ${base}/inbox?email=<the mail from step 1>`,
      '3_get_an_otp': `GET ${base}/otp?email=<the mail>`,
    },
    endpoints: {
      create: 'GET|POST /create?name=&domain=&password=',
      inbox: 'GET /inbox?email=',
      message: 'GET /message?email=&msg=<message id>',
      wait: 'GET /wait?email=&timeout=<seconds, default 60>',
      otp: 'GET /otp?email=&timeout=<seconds, default 60>',
      login: 'GET|POST /login?email=&password=',
      domains: 'GET /domains',
      delete: 'GET|DELETE /delete?email=&msg=<message id, omit for all>',
    },
  });
});

app.get('/health', (req, res) => res.json({ ok: true }));

/** 1) Create a new mail. That's it — one call, everything random by default. */
async function createHandler(req, res) {
  try {
    const q = { ...req.query, ...(req.body || {}) };
    const client = new MailTDClient();
    await client.createAccount({
      username: q.name || q.username || undefined,
      domain: q.domain || undefined,
      password: q.password || undefined,
    });
    remember(client);
    res.status(201).json(mailInfo(req, client));
  } catch (err) { handleError(res, err); }
}
app.get('/create', createHandler);
app.post('/create', createHandler);

/** Get a mail back (after a server restart, or from another client). */
async function loginHandler(req, res) {
  try {
    const q = { ...req.query, ...(req.body || {}) };
    const email = q.email || q.mail || q.address;
    if (!email || !q.password) {
      return res.status(400).json({ error: 'email_and_password_required' });
    }
    const client = new MailTDClient();
    await client.login(email, q.password);
    remember(client);
    res.json(mailInfo(req, client));
  } catch (err) { handleError(res, err); }
}
app.get('/login', loginHandler);
app.post('/login', loginHandler);

/** 2) The inbox of a mail. */
app.get('/inbox', resolveSimple, async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const data = await req.client.listMessages(page);
    res.json({ email: req.client.address, count: (data.messages || []).length, messages: data.messages || [] });
  } catch (err) { handleError(res, err); }
});

/** One full message: /message?email=..&msg=<id from /inbox> */
app.get('/message', resolveSimple, async (req, res) => {
  try {
    const msgId = req.query.msg || req.query.message || req.query.messageId;
    if (!msgId) return res.status(400).json({ error: 'msg_required', message: 'Pass &msg=<message id from /inbox>' });
    res.json(await req.client.getMessage(msgId));
  } catch (err) { handleError(res, err); }
});

/** 3) Wait for the next new mail and return it in full. */
app.get('/wait', resolveSimple, async (req, res) => {
  try {
    const message = await req.client.waitForMessage({
      timeout: secs(req.query.timeout, 60000),
      interval: 3000,
      full: true,
    });
    res.json({ email: req.client.address, message: message || null });
  } catch (err) { handleError(res, err); }
});

/** Wait for a mail with a code in it, return just the code. */
app.get('/otp', resolveSimple, async (req, res) => {
  try {
    const result = await req.client.waitForOTP({
      timeout: secs(req.query.timeout, 60000),
      interval: 3000,
    });
    if (!result) return res.json({ email: req.client.address, otp: null });
    res.json({
      email: req.client.address,
      otp: result.otps[0] || null,
      otps: result.otps,
      subject: result.message.subject || null,
      from: result.message.from || result.message.sender || null,
      message: result.message,
    });
  } catch (err) { handleError(res, err); }
});

/** Delete one message (&msg=) or the whole inbox (no msg). */
async function deleteHandler(req, res) {
  try {
    const msgId = req.query.msg || req.query.message;
    const out = msgId
      ? await req.client.deleteMessage(msgId)
      : await req.client.deleteAllMessages();
    res.json(out ?? { ok: true });
  } catch (err) { handleError(res, err); }
}
app.get('/delete', resolveSimple, deleteHandler);
app.delete('/delete', resolveSimple, deleteHandler);

/** Available domains, as a plain list of names. */
app.get('/domains', async (req, res) => {
  try {
    const domains = await new MailTDClient().getDomains();
    res.json({ domains: domains.filter((d) => !d.pro_only).map((d) => d.domain), all: domains });
  } catch (err) { handleError(res, err); }
});

// ====================== CLASSIC REST API (full) ======================

app.post('/accounts', createHandlerFull);
async function createHandlerFull(req, res) {
  try {
    const { username, domain, password } = req.body || {};
    const client = new MailTDClient();
    const session = await client.createAccount({ username, domain, password });
    remember(client);
    res.status(201).json(session);
  } catch (err) { handleError(res, err); }
}

app.post('/accounts/login', async (req, res) => {
  try {
    const { address, password } = req.body || {};
    if (!address || !password) return res.status(400).json({ error: 'address_and_password_required' });
    const client = new MailTDClient();
    const session = await client.login(address, password);
    remember(client);
    res.json(session);
  } catch (err) { handleError(res, err); }
});

app.get('/accounts', (req, res) => {
  res.json({ accounts: [...byId.values()].map((c) => ({ id: c.id, address: c.address })) });
});

app.get('/accounts/:id', resolveClient, async (req, res) => {
  try { res.json(await req.client.getAccount()); }
  catch (err) { handleError(res, err); }
});

app.get('/accounts/:id/messages', resolveClient, async (req, res) => {
  try { res.json(await req.client.listMessages(parseInt(req.query.page || '1', 10))); }
  catch (err) { handleError(res, err); }
});

app.get('/accounts/:id/wait', resolveClient, async (req, res) => {
  try {
    const message = await req.client.waitForMessage({
      timeout: secs(req.query.timeout ? String(Number(req.query.timeout) / 1000) : undefined, 60000),
      interval: parseInt(req.query.interval || '3000', 10),
      full: req.query.full === 'true',
    });
    if (!message) return res.status(204).send();
    res.json({ message });
  } catch (err) { handleError(res, err); }
});

app.get('/accounts/:id/otp', resolveClient, async (req, res) => {
  try {
    const result = await req.client.waitForOTP({
      timeout: secs(req.query.timeout ? String(Number(req.query.timeout) / 1000) : undefined, 60000),
      interval: parseInt(req.query.interval || '3000', 10),
    });
    if (!result) return res.status(204).send();
    res.json(result);
  } catch (err) { handleError(res, err); }
});

app.put('/accounts/:id/messages/read-all', resolveClient, async (req, res) => {
  try { res.json(await req.client.markAllRead()); }
  catch (err) { handleError(res, err); }
});

app.delete('/accounts/:id/messages', resolveClient, async (req, res) => {
  try { res.json(await req.client.deleteAllMessages()); }
  catch (err) { handleError(res, err); }
});

app.get('/accounts/:id/messages/:messageId', resolveClient, async (req, res) => {
  try { res.json(await req.client.getMessage(req.params.messageId)); }
  catch (err) { handleError(res, err); }
});

app.get('/accounts/:id/messages/:messageId/source', resolveClient, async (req, res) => {
  try { res.type('text/plain').send(await req.client.getMessageSource(req.params.messageId)); }
  catch (err) { handleError(res, err); }
});

app.get('/accounts/:id/messages/:messageId/attachments/:index', resolveClient, async (req, res) => {
  try {
    const { buffer, contentType } = await req.client.downloadAttachment(req.params.messageId, req.params.index);
    res.type(contentType).send(buffer);
  } catch (err) { handleError(res, err); }
});

app.put('/accounts/:id/messages/:messageId/read', resolveClient, async (req, res) => {
  try { res.json(await req.client.markRead(req.params.messageId)); }
  catch (err) { handleError(res, err); }
});

app.delete('/accounts/:id/messages/:messageId', resolveClient, async (req, res) => {
  try { res.json(await req.client.deleteMessage(req.params.messageId)); }
  catch (err) { handleError(res, err); }
});

app.use((req, res) => res.status(404).json({ error: 'not_found' }));

app.listen(PORT, () => {
  console.log(`mailtd-api listening on http://localhost:${PORT}`);
  console.log(`  create a mail:  http://localhost:${PORT}/create`);
  console.log(`  read its inbox: http://localhost:${PORT}/inbox?email=<the mail>`);
});

export default app;
