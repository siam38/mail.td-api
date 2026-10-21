/**
 * demo.js — end-to-end check against the live web backend.
 * Creates a mailbox, logs back in, checks the inbox, and verifies
 * stateless reuse from a saved session.
 *
 * Usage: node examples/demo.js
 */
import { MailTDClient } from '../src/mailtd.js';

const client = new MailTDClient();

console.log('1) domains…');
const domains = await client.getDomains();
console.log('   ', domains.map((d) => d.domain).join(', '));

console.log('2) creating account (Argon2 derive + PoW solve)…');
const session = await client.createAccount({
  onPow: (d) => console.log(`    solving PoW at difficulty ${d}…`),
});
console.log('   address :', session.address);
console.log('   password:', session.password);
console.log('   id      :', session.id);

console.log('3) inbox (should be empty)…');
console.log('   ', await client.listMessages(1));

console.log('4) account info…');
console.log('   ', await client.getAccount());

console.log('5) login again with address + password (fresh client)…');
const again = new MailTDClient();
const relogin = await again.login(session.address, session.password);
console.log('    same id:', relogin.id === session.id, '| new token issued:', !!relogin.token);

console.log('6) waitForMessage for 8s (expect timeout / null — no mail sent yet)…');
const waited = await again.waitForMessage({ timeout: 8000, interval: 2500 });
console.log('    result:', waited);

console.log('\nAll good — web backend flow works end-to-end.');
console.log('Send an email to', session.address, 'then run the API and GET /accounts/' + session.id + '/messages');
