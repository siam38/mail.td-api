# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-10-21

### Added

- Node.js client library (`src/mailtd.js`) for the mail.td web backend — no API key, no paid account, no signup
- Authentic web flow: Argon2id key derivation and SHA-256 proof-of-work, identical to the official website
- Express REST API server (`src/server.js`) with a simple GET-based API (`/create`, `/inbox`, `/message`, `/otp`, `/wait`, `/login`, `/domains`, `/delete`) and a full REST API under `/accounts`
- OTP extraction — wait for a verification email and receive the code, ready to use
- Real-time mail delivery over WebSocket, with session restore via address + password
- Live end-to-end demo in `examples/demo.js`

[Unreleased]: https://github.com/siam38/mail.td-api/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/siam38/mail.td-api/releases/tag/v1.0.0
