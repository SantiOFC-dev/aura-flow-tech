const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

test('index.js exists and passes syntax check', () => {
  const p = path.join(root, 'index.js');
  assert.ok(fs.existsSync(p));
  execFileSync('node', ['--check', p]);
});

test('live /health endpoint responds 200', async () => {
  const res = await fetch('http://127.0.0.1:8001/health');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
});

test('bot commands: -numeros, -qr, -uuid, -hash, -base64, -json and typo suggestion', async () => {
  const { handleBotCommand } = require('../commands');

  const nums = await handleBotCommand('-numeros', { isOwner: true });
  assert.ok(nums.reply.includes('+506 6458 6614'));

  const qr = await handleBotCommand('-qr https://auraflowtech.lat', { isOwner: true });
  assert.ok(qr.qrDataUrl.startsWith('data:image/png;base64,'));

  const uuid = await handleBotCommand('-uuid', { isOwner: true });
  assert.match(uuid.reply, /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}/i);

  const hash = await handleBotCommand('-hash AuraFlow', { isOwner: true });
  assert.ok(hash.reply.includes('SHA-256'));

  const b64 = await handleBotCommand('-base64 enc AuraFlow', { isOwner: true });
  assert.ok(b64.reply.includes('QXVyYUZsb3c='));

  const jsonRes = await handleBotCommand('-json {"ok":true}', { isOwner: true });
  assert.ok(jsonRes.reply.includes('JSON Válido'));

  const typo = await handleBotCommand('-numeors', { isOwner: true });
  assert.ok(typo.reply.includes('-numeros'));

  const vcard = await handleBotCommand('-vcard Test User | +506 8888 8888', { isOwner: true });
  assert.ok(vcard.qrDataUrl.startsWith('data:image/png;base64,'));

  const { inferCommandIntent } = require('../commands');
  assert.equal(inferCommandIntent('dame los números guardados', true), '-numeros');
  assert.equal(inferCommandIntent('genera un qr de https://auraflowtech.lat', true), '-qr https://auraflowtech.lat');
  assert.equal(inferCommandIntent('Dame el menú.', true), '-menu');
});
