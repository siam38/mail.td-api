# MailTD API

Node.js client + REST API for [mail.td](https://mail.td) by SiAM

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Create disposable mailboxes, read mail, and get OTP codes. No API key, no signup.

The official mail.td API needs a paid Pro account and a token. This project does not use it.
It talks to the same backend the mail.td website uses, so everything works on a free account.

## Features

- Create a mailbox with one call (random address + password, or pick your own)
- Read, search, and delete messages, download attachments, view raw source
- Wait for an OTP code and get it back parsed
- New mail pushed in real time over WebSocket, no polling
- Two ways to use it: simple GET endpoints, or a full REST API
- Log back into a mailbox any time with its address and password
- No build step and no native dependencies

## How it works

Reverse-engineered from the site's frontend JS By SiAM

The client does what the browser does on mail.td: it derives the login key from
your password (Argon2id), solves the proof-of-work the site asks for when an
account is created, and then uses the normal REST + WebSocket endpoints with a
JWT. All of that is handled inside `src/mailtd.js` — you just call the methods.

- Base URL: `https://api.mail.td/api`
- Domains are fetched live from mail.td. Current ones include `qabq.com` (default), `nqmo.com`, `end.tw`, `uuf.me`, `6n9.net`, `sugtbt.com`
- Free accounts keep each message for 1 hour, and mailboxes are receive-only

## Requirements

- Node.js 18 or later

## Install

```bash
git clone https://github.com/siam38/mail.td-api.git
cd mail.td-api
npm install
npm start        # http://localhost:3000
```

## Quick start

```bash
# 1. Create a mailbox
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

Save the email and password. The password cannot be recovered.

```bash
# 2. Read the inbox
curl "http://localhost:3000/inbox?email=xdp5loyb@qabq.com"

# 3. Wait for an OTP code (up to `timeout` seconds)
curl "http://localhost:3000/otp?email=xdp5loyb@qabq.com&timeout=120"
# -> { "email": "...", "otp": "482910", "subject": "...", ... }
```

Optional parameters on create: `name`, `domain`, `password`

```bash
curl "http://localhost:3000/create?name=mytest&domain=qabq.com&password=MyPass123!"
```

## Simple API

After `/create`, the server remembers the session, so later calls only need `email`.
If the server restarted, add `&password=` to any call and it logs back in on its own.

| Endpoint | Description |
| --- | --- |
| `GET /` | List all endpoints |
| `GET\|POST /create` | New mailbox. Optional: `name`, `domain`, `password` |
| `GET /inbox?email=` | List messages |
| `GET /message?email=&msg=` | Read one message (`msg` = message id from `/inbox`) |
| `GET /wait?email=&timeout=` | Wait for the next message, returned in full (default 60s) |
| `GET /otp?email=&timeout=` | Wait for a message with a code, returns `{ otp }` |
| `GET\|POST /login?email=&password=` | Restore a session |
| `GET /domains` | Available domains |
| `GET /delete?email=&msg=` | Delete one message, or the whole inbox if `msg` is omitted |
| `GET /health` | Health check |

## Full REST API

Sessions are resolved by account `id`, or send the mailbox JWT as
`Authorization: Bearer <token>`. Errors come back as `{ "error": "<code>" }`.

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/accounts` | Create a mailbox — body `{ username?, domain?, password? }` |
| `POST` | `/accounts/login` | Log in — body `{ address, password }` |
| `GET` | `/accounts` | List mailboxes held by this server |
| `GET` | `/accounts/:id` | Mailbox info and quota |
| `GET` | `/accounts/:id/messages?page=1` | List messages |
| `GET` | `/accounts/:id/messages/:messageId` | Read one message |
| `GET` | `/accounts/:id/messages/:messageId/source` | Raw message source |
| `GET` | `/accounts/:id/messages/:messageId/attachments/:index` | Download an attachment |
| `PUT` | `/accounts/:id/messages/:messageId/read` | Mark as read |
| `PUT` | `/accounts/:id/messages/read-all` | Mark all as read |
| `DELETE` | `/accounts/:id/messages/:messageId` | Delete one message |
| `DELETE` | `/accounts/:id/messages` | Delete all messages |
| `GET` | `/accounts/:id/wait?timeout=<ms>&full=true` | Wait for a new message (`204` on timeout) |
| `GET` | `/accounts/:id/otp?timeout=<ms>` | Wait for a code (`204` on timeout) |

## Library usage

The client can be used on its own, without the server:

```js
import { MailTDClient } from './src/mailtd.js';

const client = new MailTDClient();

// Create a mailbox
const session = await client.createAccount();
console.log(session.address, session.password); // save these

// Read the inbox
const { messages } = await client.listMessages(1);
const message = await client.getMessage(messages[0].id);

// Wait for an OTP email
const hit = await client.waitForOTP({ timeout: 120000 });
console.log(hit.otps, hit.message.subject);

// Listen for new mail in real time
const stop = client.listen((item) => console.log('New mail:', item.subject));
// stop() to disconnect

// Later, in another process: log back in
const restored = new MailTDClient();
await restored.login(session.address, session.password);
```

A live end-to-end demo is included:

```bash
npm run demo
```

## Project structure

```
mail.td-api/
├── src/
│   ├── mailtd.js    # Client: auth, proof-of-work, REST, WebSocket, OTP helpers
│   └── server.js    # Express server (simple API + full REST API)
├── examples/
│   └── demo.js      # Live end-to-end demo
├── .env.example
├── package.json
└── README.md
```

## Config

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Server port |
| `MAILTD_BASE_URL` | `https://api.mail.td/api` | Backend base URL |
| `MAILTD_WS_URL` | derived from base URL | WebSocket endpoint |

## Notes

- Server sessions are in memory only. A restart forgets tokens; restore any mailbox with `/login`.
- The login key is derived from the address + password, so don't reuse a real password for a mailbox.
- Prefer `/wait`, `/otp`, or the WebSocket listener over polling the inbox in a loop.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Disclaimer

Unofficial project, not affiliated with or endorsed by mail.td. It uses mail.td's
public web interface the same way a browser does; mail.td's own terms and limits apply.

## Author

**SiAM** — [@siam38](https://github.com/siam38)

## License

[MIT](./LICENSE)
