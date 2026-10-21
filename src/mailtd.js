import crypto from 'node:crypto';
import { argon2id, sha256 } from 'hash-wasm';
import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';

const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
const WS_AGENT = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;

export const BASE_URL = process.env.MAILTD_BASE_URL || 'https://api.mail.td/api';
export const WS_URL =
  process.env.MAILTD_WS_URL || BASE_URL.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';


const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export class MailTDError extends Error {
  constructor(status, code, data = {}) {
    super(code);
    this.name = 'MailTDError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}



function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return out;
}


export async function deriveAuthKey(address, password) {
  const saltHex = await sha256(String(address).toLowerCase().trim());
  return argon2id({
    password,
    salt: hexToBytes(saltHex),
    parallelism: 1,
    iterations: 3,
    memorySize: 16384, // KiB
    hashLength: 32,
    outputType: 'hex',
  });
}

function hasLeadingZeroBits(buf, bits) {
  const fullBytes = Math.floor(bits / 8);
  const rem = bits % 8;
  for (let i = 0; i < fullBytes; i++) if (buf[i] !== 0) return false;
  if (rem > 0 && (buf[fullBytes] & ((0xff << (8 - rem)) & 0xff)) !== 0) return false;
  return true;
}


export function solvePow(address, timestamp, difficulty) {
  const base = String(address).toLowerCase().trim() + String(timestamp);
  let nonce = 0;
  for (;;) {
    const hash = crypto.createHash('sha256').update(base + String(nonce)).digest();
    if (hasLeadingZeroBits(hash, difficulty)) return String(nonce);
    nonce++;
  }
}



export function randomUsername(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export function randomPassword(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

// ---------- small helpers ----------

async function fetchWithRetry(url, options = {}, retries = 3) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetch(url, {
        ...options,
        headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) },
      });
    } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

export function extractOTPs(text = '') {
  if (!text) return [];
  const found = new Set();
  // "code is 123456", "OTP: 1234", "verification code 123456", etc.
  for (const m of String(text).matchAll(/(?:code|otp|pin|verification|verify)[^0-9]{0,30}(\d{4,8})/gi)) {
    found.add(m[1]);
  }
  // Fallback: any standalone 4-8 digit run
  if (found.size === 0) {
    for (const m of String(text).matchAll(/\b(\d{4,8})\b/g)) found.add(m[1]);
  }
  return [...found];
}

// ---------- client ----------

export class MailTDClient {
  /**
   * @param {{id?: string, address?: string, password?: string, auth_key?: string, token?: string, baseUrl?: string}} [session]
   */
  constructor(session = {}) {
    this.baseUrl = (session.baseUrl || BASE_URL).replace(/\/$/, '');
    this.id = session.id || null;
    this.address = session.address || null;
    this.password = session.password || null;
    this.auth_key = session.auth_key || null;
    this.token = session.token || null;
    this.powDifficulty = 15; // web default
  }

  toJSON() {
    return {
      id: this.id,
      address: this.address,
      password: this.password,
      auth_key: this.auth_key,
      token: this.token,
    };
  }

  async #request(path, options = {}) {
    const res = await fetchWithRetry(this.baseUrl + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(options.headers || {}),
      },
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new MailTDError(res.status, data.error || 'request_failed', data);
    return data;
  }

  #accountPath(suffix = '') {
    if (!this.id) throw new MailTDError(401, 'no_account_id');
    return `/accounts/${this.id}${suffix}`;
  }

  // ----- domains -----

  /** GET /domains — public, no auth needed. */
  async getDomains() {
    const res = await fetchWithRetry(this.baseUrl + '/domains');
    if (!res.ok) throw new MailTDError(res.status, 'request_failed');
    const data = await res.json();
    return data.domains || [];
  }

   
  async createAccount(opts = {}) {
    let { username, domain, password } = opts;
    if (!domain) {
      const domains = await this.getDomains();
      const usable = domains.filter((d) => !d.pro_only);
      domain = (usable.find((d) => d.default) || usable[0] || domains[0])?.domain;
      if (!domain) throw new MailTDError(500, 'no_domains_available');
    }
    username = username || randomUsername(8);
    password = password || randomPassword(12);
    const address = `${username}@${domain}`.toLowerCase();

    const auth_key = await deriveAuthKey(address, password);

    let difficulty = this.powDifficulty;
    let powToken;
    for (let attempt = 0; attempt < 5; attempt++) {
      opts.onPow?.(difficulty);
      const t = Math.floor(Date.now() / 1000);
      const n = solvePow(address, t, difficulty);

      const res = await fetchWithRetry(this.baseUrl + '/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          auth_key,
          pow: { t, n, d: difficulty, ...(powToken ? { token: powToken } : {}) },
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (data?.status === 'retry') {
        if (!data.required_difficulty || !data.token) {
          throw new MailTDError(res.status || 500, 'invalid_pow_retry_response', data);
        }
        difficulty = data.required_difficulty;
        powToken = data.token;
        continue;
      }
      if (!res.ok) throw new MailTDError(res.status, data.error || 'request_failed', data);
      if (!data?.id || !data?.address || !data?.token) {
        throw new MailTDError(500, 'invalid_account_response', data);
      }
      if (data.suggested_next_difficulty) this.powDifficulty = data.suggested_next_difficulty;

      this.id = data.id;
      this.address = data.address;
      this.password = password;
      this.auth_key = auth_key;
      this.token = data.token;
      return this.toJSON();
    }
    throw new MailTDError(429, 'pow_retry_exhausted');
  }

  /**
   * Log back into an existing mailbox with address + plain password
   * (same as the website's "sign in" for a mailbox): derive + POST /token.
   */
  async login(address, password) {
    const auth_key = await deriveAuthKey(address, password);
    const res = await fetchWithRetry(this.baseUrl + '/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: String(address).toLowerCase(), auth_key }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new MailTDError(res.status, data.error || 'request_failed', data);

    this.id = data.id;
    this.address = data.address;
    this.password = password;
    this.auth_key = auth_key;
    this.token = data.token;
    return this.toJSON();
  }

  /** Restore a client from a saved session object (no network call). */
  static fromSession(session) {
    return new MailTDClient(session);
  }

  // ----- mailbox (all Bearer-JWT, like the web inbox) -----

  async getAccount() {
    return this.#request(this.#accountPath());
  }

  async listMessages(page = 1) {
    return this.#request(this.#accountPath(`/messages?page=${page}`));
  }

  async getMessage(messageId) {
    return this.#request(this.#accountPath(`/messages/${messageId}`));
  }

  async deleteMessage(messageId) {
    return this.#request(this.#accountPath(`/messages/${messageId}`), { method: 'DELETE' });
  }

  async deleteAllMessages() {
    return this.#request(this.#accountPath('/messages'), { method: 'DELETE' });
  }

  async markRead(messageId) {
    return this.#request(this.#accountPath(`/messages/${messageId}/read`), { method: 'PUT' });
  }

  async markAllRead() {
    return this.#request(this.#accountPath('/messages/read'), {
      method: 'PUT',
      body: JSON.stringify({ all: true }),
    });
  }

  async getMessageSource(messageId) {
    const res = await fetchWithRetry(this.baseUrl + this.#accountPath(`/messages/${messageId}/source`), {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });
    if (!res.ok) throw new MailTDError(res.status, 'source_failed');
    return res.text();
  }

  /** Returns { buffer, contentType } for an attachment (index from message.attachments). */
  async downloadAttachment(messageId, index) {
    const res = await fetchWithRetry(
      this.baseUrl + this.#accountPath(`/messages/${messageId}/attachments/${index}`),
      { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {} },
    );
    if (!res.ok) throw new MailTDError(res.status, 'download_failed');
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') || 'application/octet-stream',
    };
  }

  // ----- waiting / live -----

  /**
   * Poll until a new message arrives (or timeout). Returns the message list item,
   * or the full message when `full: true`.
   */
  async waitForMessage({ timeout = 60000, interval = 3000, full = false, sinceIds } = {}) {
    const seen = sinceIds ? new Set(sinceIds) : null;
    const baseline = seen || new Set(((await this.listMessages(1)).messages || []).map((m) => m.id));
    const deadline = Date.now() + timeout;
    for (;;) {
      const { messages = [] } = await this.listMessages(1);
      const fresh = messages.find((m) => !baseline.has(m.id));
      if (fresh) return full ? this.getMessage(fresh.id) : fresh;
      if (Date.now() >= deadline) return null;
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  /** Poll until a message containing an OTP-like code arrives; returns { message, otps }. */
  async waitForOTP({ timeout = 60000, interval = 3000 } = {}) {
    const deadline = Date.now() + timeout;
    const checked = new Set();
    for (;;) {
      const { messages = [] } = await this.listMessages(1);
      for (const item of messages) {
        if (checked.has(item.id)) continue;
        checked.add(item.id);
        const msg = await this.getMessage(item.id);
        const otps = extractOTPs(`${msg.subject || ''}\n${msg.text_body || ''}\n${msg.html_body || ''}`);
        if (otps.length) return { message: msg, otps };
      }
      if (Date.now() >= deadline) return null;
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  /**
   * Live listener — the website's WebSocket channel.
   * Calls onMessage(item) for every new_email event. Returns a close() function.
   */
  listen(onMessage, { onStatus, onError } = {}) {
    if (!this.token) throw new MailTDError(401, 'no_token');
    let closed = false;
    let delay = 3000;
    let ws;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(WS_URL, {
        agent: WS_AGENT,
        headers: { Origin: 'https://mail.td', 'User-Agent': USER_AGENT },
      });
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: this.token })));
      ws.on('message', (raw) => {
        let data;
        try { data = JSON.parse(raw.toString()); } catch { return; }
        if (data.type === 'auth_ok') {
          delay = 3000;
          onStatus?.(true);
        } else if (data.error === 'invalid_token' || data.error === 'account_revoked') {
          closed = true;
          onError?.(new MailTDError(401, data.error));
          ws.close();
        } else if (data.type === 'new_email') {
          onMessage({
            id: data.id,
            sender: data.sender,
            from: data.from || null,
            subject: data.subject || null,
            preview_text: data.preview_text || null,
            size: parseInt(data.size, 10) || 0,
            is_read: false,
            created_at: data.created_at || new Date().toISOString(),
          });
        }
      });
      ws.on('close', () => {
        onStatus?.(false);
        if (!closed) {
          setTimeout(connect, delay);
          delay = Math.min(delay * 2, 60000);
        }
      });
      ws.on('error', () => { try { ws.close(); } catch {} });
    };
    connect();

    return () => {
      closed = true;
      try { ws?.close(); } catch {}
    };
  }
}

export default MailTDClient;
