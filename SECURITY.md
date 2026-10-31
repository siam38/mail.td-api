# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | ✅        |
| < 1.0   | ❌        |

## Reporting a Vulnerability

Please **do not** open a public issue for a security vulnerability.

Report it privately through GitHub:
[Report a vulnerability](https://github.com/siam38/mail.td-api/security/advisories/new)

Include, where possible:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- The affected version, Node.js version, and operating system

You can expect an acknowledgement within 7 days. Please give the issue a
reasonable chance to be fixed before disclosing it publicly.

## Notes for Users

- Mailbox passwords cannot be recovered — the server only stores a derived key.
- Never reuse a real, important password for a disposable mailbox.
- Run the API server only in environments you trust; sessions are held in memory.
