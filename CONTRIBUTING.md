# Contributing to MailTD API

Thanks for your interest in improving this project.

## Getting started

```bash
git clone https://github.com/siam38/mail.td-api.git
cd mail.td-api
npm install
npm run demo   # live end-to-end check against the real service
npm start      # run the API server locally
```

## Making changes

1. Fork the repository and create a branch from `main`.
2. Keep changes focused — one feature or fix per pull request.
3. Match the existing code style: ES modules, light comments, no build step.
4. Verify your change live with `npm run demo` and a manual run of the server.
5. Open a pull request with a clear description of what changed and why.

## Reporting issues

Please include your Node.js version, the endpoint or method involved, and the
full error response. Never include a real mailbox password or token in an issue.
