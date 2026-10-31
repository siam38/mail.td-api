<div align="center">

# MailTD API

**A Node.js client and REST API for [mail.td](https://mail.td) — built on the website's own backend, by SiAM**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

[![Release](https://img.shields.io/github/v/release/siam38/mail.td-api)](https://github.com/siam38/mail.td-api/releases)
[![Stars](https://img.shields.io/github/stars/siam38/mail.td-api)](https://github.com/siam38/mail.td-api/stargazers)
[![Forks](https://img.shields.io/github/forks/siam38/mail.td-api)](https://github.com/siam38/mail.td-api/forks)
[![Issues](https://img.shields.io/github/issues/siam38/mail.td-api)](https://github.com/siam38/mail.td-api/issues)
[![Last commit](https://img.shields.io/github/last-commit/siam38/mail.td-api)](https://github.com/siam38/mail.td-api/commits/main)

Create disposable mailboxes, read incoming mail, and extract OTP codes —
with **no API key, no paid account, and no signup**.

</div>

---

## Overview

The official mail.td API (documented at `mail.td/api`) requires a paid Pro account and a `td_...` API token created in the console.

This project takes a different route: it replicates exactly what your browser does when you open the mail.td inbox page — the same requests, the same cryptography, the same anti-bot proof-of-work. The result is a free, fully working client library plus a ready-to-run REST API server.

## Features

- **Zero-config mailbox creation** — one call creates a mailbox with a random address and password
- **Authentic web flow** — Argon2id key derivation and SHA-256 proof-of-work, identical to the official website
- **Full inbox access** — list, read, search, delete, mark as read, download attachments, view raw source
- **OTP extraction** — wait for a verification email and get the code, ready to use
- **Real-time delivery** — WebSocket listener for new mail, no polling required
- **Dual API surface** — a simple GET-based API for quick use, and a full REST API for integrations
- **Session restore** — log back into any mailbox with its address and password, at any time
- **Lightweight** — WASM cryptography (no native builds), four small runtime dependencies

## How It Works

Reverse-engineered from the site's frontend JS By SiAM

| Step | Detail |
| --- | --- |
| Base URL | `https://api.mail.td/api` (the site proxies it as `https://mail.td/api`) |
| Password protection | The plain password never leaves the client. `auth_key = Argon2id(password, salt = SHA256(lowercase(address)), p=1, t=3, mem=16384 KiB, len=32, hex)` |
| Anti-bot | Account creation requires Proof-of-Work: find a nonce so `SHA256(address + timestamp + nonce)` has 15 leading zero bits. The server can demand a retry at a higher difficulty (`{status:"retry", required_difficulty, token}`) |
| Create | `POST /accounts { address, auth_key, pow:{t,n,d} }` → `201 { id, address, token }` (JWT, ~7 days) |
| Login | `POST /token { address, auth_key }` → fresh JWT |
| Inbox | REST under `/accounts/:id/...` with `Authorization: Bearer <JWT>` |
| Live mail | WebSocket `wss://api.mail.td/api/ws` — send `{type:"auth", token}`, receive `auth_ok`, then `new_email` events |

**Service limits** (per mail.td's own FAQ): free accounts keep each message for **1 hour**, accounts inactive for 3 consecutive months are deleted, and mailboxes are receive-only.

**Available domains** are fetched live and rotate. At the time of writing: `qabq.com` (default), `nqmo.com`, `end.tw`, `uuf.me`, `6n9.net`, `sugtbt.com`.

## Requirements

- Node.js **18 or later** (uses the global `fetch` API)
- No build step, no native dependencies

## Installation

```bash
git clone https://github.com/siam38/mail.td-api.git
cd mail.td-api
npm install
```

## Quick Start

```bash
npm start   # server on http://localhost:3000 (override with the PORT env var)
```

Three calls do almost everything:

```bash
# 1. Create a new mailbox
curl http://localhost:3000/create
```

```json
{
  "email": "xdp5loyb@qabq.com",
  "password": "Q$PjvmG3RooA",
  "id": "064d499b-7940-4c97-839b-74e4ba93f8bd",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "inbox": "http://localhost:3000/inbox?email=xdp5loyb%40qabq.com",
  "otp": "http://localhost:3000/otp?email=xdp5loyb%40qabq.com"
}
```

> **Save the email and password.** The password cannot be recovered — the server only stores a derived key.

```bash
# 2. Read the inbox (the server remembers the session — only the email is needed)
curl "http://localhost:3000/inbox?email=xdp5loyb@qabq.com"

# 3. Wait for a verification code (up to `timeout` seconds)
curl "http://localhost:3000/otp?email=xdp5loyb@qabq.com&timeout=120"
# -> { "email": "...", "otp": "482910", "subject": "...", ... }
```

Optional parameters on creation:

```bash
curl "http://localhost:3000/create?name=mytest&domain=qabq.com&password=MyPass123!"
```

## API Reference

### Simple API

Plain GET endpoints, designed to be usable directly from a browser or a single `curl`.

| Endpoint | Description |
| --- | --- |
| `GET /` | Help — returns this endpoint list as JSON |
| `GET\|POST /create` | Create a new mailbox. Optional: `name`, `domain`, `password` |
| `GET /inbox?email=` | List messages in a mailbox |
| `GET /message?email=&msg=` | Read one full message (`msg` = message id from `/inbox`) |
| `GET /wait?email=&timeout=` | Wait for the next new message and return it in full (`timeout` in seconds, default `60`) |
| `GET /otp?email=&timeout=` | Wait for a message containing a code; returns `{ otp }` (`null` if none arrived) |
| `GET\|POST /login?email=&password=` | Restore a mailbox session (e.g. after a server restart) |
| `GET /domains` | List available domains |
| `GET /delete?email=&msg=` | Delete one message, or the whole inbox when `msg` is omitted |
| `GET /health` | Health check |

**Session behaviour:** after `/create`, the server remembers the mailbox, so later calls only need `email`. If the server has restarted, add `&password=<password>` to any simple call and the mailbox is logged back in automatically.

### Full REST API

Resource-oriented routes for integrations. Sessions are resolved by account `id`; alternatively, send the mailbox JWT as `Authorization: Bearer <token>` for stateless use.

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/accounts` | Create a mailbox — body `{ username?, domain?, password? }` |
| `POST` | `/accounts/login` | Log in — body `{ address, password }` |
| `GET` | `/accounts` | List mailboxes held by this server |
| `GET` | `/accounts/:id` | Mailbox info and quota |
| `GET` | `/accounts/:id/messages?page=1` | List messages |
| `GET` | `/accounts/:id/messages/:messageId` | Read one message |
| `GET` | `/accounts/:id/messages/:messageId/source` | Raw message source (plain text) |
| `GET` | `/accounts/:id/messages/:messageId/attachments/:index` | Download an attachment |
| `PUT` | `/accounts/:id/messages/:messageId/read` | Mark one message as read |
| `PUT` | `/accounts/:id/messages/read-all` | Mark all messages as read |
| `DELETE` | `/accounts/:id/messages/:messageId` | Delete one message |
| `DELETE` | `/accounts/:id/messages` | Delete all messages |
| `GET` | `/accounts/:id/wait?timeout=<ms>&full=true` | Wait for a new message (`204` on timeout) |
| `GET` | `/accounts/:id/otp?timeout=<ms>` | Wait for a code (`204` on timeout) |

Errors are returned as JSON: `{ "error": "<code>" }` with the matching HTTP status.

## Library Usage

The client can be used directly, without the server — this is the "scraper" layer (`src/mailtd.js`).

```js
import { MailTDClient } from './src/mailtd.js';

const client = new MailTDClient();

// Create a mailbox (Argon2 derivation + proof-of-work handled for you)
const session = await client.createAccount();
console.log(session.address, session.password); // save these

// Read the inbox
const { messages } = await client.listMessages(1);
const message = await client.getMessage(messages[0].id);

// Wait for an OTP email
const hit = await client.waitForOTP({ timeout: 120000 });
console.log(hit.otps, hit.message.subject);

// Or listen in real time over WebSocket
const stop = client.listen((item) => console.log('New mail:', item.subject));
// stop() to disconnect

// Later, or in another process: log back in
const restored = new MailTDClient();
await restored.login(session.address, session.password);
```

A live end-to-end demonstration is included:

```bash
npm run demo
```

## Project Structure

```
mail.td-api/
├── src/
│   ├── mailtd.js      # Web-backend client: Argon2, PoW, REST, WebSocket, OTP helpers
│   └── server.js      # Express API server (simple + full REST surfaces)
├── examples/
│   └── demo.js        # Live end-to-end demonstration / smoke test
├── .env.example       # Optional configuration (PORT, endpoint overrides)
├── package.json
└── README.md
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port for the API server |
| `MAILTD_BASE_URL` | `https://api.mail.td/api` | Web-backend base URL |
| `MAILTD_WS_URL` | derived from base URL | WebSocket endpoint |

## Tech Stack

- **Runtime:** Node.js (ES modules, global `fetch`)
- **Server:** Express 4, CORS
- **Cryptography:** `hash-wasm` — Argon2id and SHA-256 in WebAssembly, no native compilation
- **Real-time:** `ws` WebSocket client (with `https-proxy-agent` support for proxied networks)

## Notes and Limitations

- API server sessions are **in-memory only**. Restarting the server forgets tokens; any mailbox can be restored with `/login` (address + password).
- The `auth_key` is deterministic for a given address + password pair — **never reuse a real password** for a mailbox.
- Proof-of-work difficulty starts at 15, matching the website. If mail.td raises it, the retry flow follows the server's demanded difficulty automatically.
- Prefer `/wait`, `/otp`, or the WebSocket listener over tight polling loops.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Disclaimer

This is an independent, unofficial project. It is not affiliated with or endorsed by mail.td. It interacts with mail.td's public web interface in the same way a browser does; service terms, availability, and rate limits of mail.td apply. Use responsibly and only for lawful purposes.

## Author

**SiAM** — [@siam38](https://github.com/siam38)

## License

Released under the [MIT License](./LICENSE).
