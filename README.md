# MailTD API

A Node.js client and REST API for [mail.td](https://mail.td), by SiAM.

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Create disposable mailboxes, read mail, and get OTP codes. No API key, no signup.
The official mail.td API needs a paid Pro account; this uses the same backend as the mail.td website itself.

Requires Node.js 18+.

## Install

```bash
git clone https://github.com/siam38/mail.td-api.git
cd mail.td-api
npm install
npm start        # http://localhost:3000
```

## Quick start

```bash
# Create a mailbox
curl http://localhost:3000/create
# -> { "email": "xdp5loyb@qabq.com", "password": "Q$PjvmG3RooA", "id": "...", "token": "..." }

# Read the inbox
curl "http://localhost:3000/inbox?email=xdp5loyb@qabq.com"

# Wait for an OTP code
curl "http://localhost:3000/otp?email=xdp5loyb@qabq.com&timeout=120"
# -> { "email": "...", "otp": "482910", ... }
```

Save the email and password from `/create`. The password cannot be recovered.

## Endpoints

| Endpoint | Description |
| --- | --- |
| `GET /create` | New mailbox. Optional: `name`, `domain`, `password` |
| `GET /inbox?email=` | List messages |
| `GET /message?email=&msg=` | Read one message |
| `GET /wait?email=&timeout=` | Wait for the next message |
| `GET /otp?email=&timeout=` | Wait for a message with a code |
| `GET /login?email=&password=` | Restore a session after a restart |
| `GET /domains` | Available domains |
| `GET /delete?email=&msg=` | Delete a message, or the whole inbox if `msg` is omitted |
| `GET /health` | Health check |

After `/create` the server remembers the session, so later calls only need `email`.
A full REST API under `/accounts` is also available; `GET /` on the running server lists everything.

## Library usage

```js
import { MailTDClient } from './src/mailtd.js';

const client = new MailTDClient();
const session = await client.createAccount();   // save address + password

const { messages } = await client.listMessages(1);
const hit = await client.waitForOTP({ timeout: 120000 });
console.log(hit.otps);
```

Run `npm run demo` for a live end-to-end example.

## Config

| Variable | Default |
| --- | --- |
| `PORT` | `3000` |
| `MAILTD_BASE_URL` | `https://api.mail.td/api` |

## Notes

- Free mail.td accounts keep messages for 1 hour and are receive-only.
- Server sessions are in memory. After a restart, use `/login` with the address and password.
- Don't reuse a real password for a mailbox.

## License

MIT. Made by [SiAM](https://github.com/siam38).

Unofficial project, not affiliated with mail.td.
