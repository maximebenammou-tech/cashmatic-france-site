import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig } from '../src/config.js';
import { silentLogger } from '../src/log.js';
import { memoryStore } from '../src/store.js';
import { LightspeedAuth } from '../src/lightspeed/auth.js';
import { LightspeedClient } from '../src/lightspeed/client.js';
import { CashmaticClient } from '../src/cashmatic/client.js';
import { PaymentFlow, STATES } from '../src/payment-flow.js';
import { createServer } from '../src/server.js';
import { mockLightspeed, mockCashmatic, until } from './mocks.js';

async function setup({ cashmatic: cmScenario = {}, lightspeed: lsOpts = {}, env = {} } = {}) {
  const cm = await mockCashmatic(cmScenario);
  // Le serveur du connecteur doit exister avant Lightspeed (il reçoit les webhooks).
  const holder = {};
  const ls = await mockLightspeed({ ...lsOpts, webhookTarget: () => holder.webhookUrl });
  // mockLightspeed attend une chaîne : on la résout au premier appel
  const config = buildConfig({
    LSK_API_BASE: ls.base, LSK_AUTH_BASE: ls.base, LSK_CLIENT_ID: 'cid', LSK_CLIENT_SECRET: 'csecret', LSK_REDIRECT_URI: 'https://localhost/cb',
    LSK_BUSINESS_LOCATION_ID: '123', LSK_PAYMENT_METHOD: 'CASHMATIC', LSK_WEBHOOK_ENDPOINT_ID: 'CASHMATIC', LSK_WEBHOOK_USER: 'hook', LSK_WEBHOOK_PASSWORD: 'pw',
    CASHMATIC_URL: cm.base, CASHMATIC_USERNAME: 'cashmatic', CASHMATIC_PASSWORD: 'secret', CASHMATIC_PAYMENT_TIMEOUT_S: '2', CASHMATIC_POLL_MS: '10',
    WEBHOOK_WAIT_MS: env.WEBHOOK_WAIT_MS ?? '1500', DATA_DIR: '/nonexistent', ...env,
  });
  const store = memoryStore();
  store.setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', accessExpiresAt: Date.now() + 10 * 60_000 });
  const auth = new LightspeedAuth({ config: config.lightspeed, store, log: silentLogger });
  const lightspeed = new LightspeedClient({ config: config.lightspeed, auth, log: silentLogger });
  const cashmatic = new CashmaticClient({ config: config.cashmatic, log: silentLogger });
  const flow = new PaymentFlow({ config, lightspeed, cashmatic, store, log: silentLogger });
  const server = createServer({ config, auth, lightspeed, cashmatic, flow, store, log: silentLogger });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  holder.webhookUrl = `http://127.0.0.1:${server.address().port}/webhooks/lightspeed`;
  // le faux Lightspeed poste le webhook avec Basic Auth
  ls.state.webhookAuth = 'Basic ' + Buffer.from('hook:pw').toString('base64');
  const close = async () => { server.close(); await ls.close(); await cm.close(); };
  return { cm, ls, config, store, auth, lightspeed, cashmatic, flow, server, close, connectorBase: `http://127.0.0.1:${server.address().port}` };
}

const settled = (store, id) => until(() => { const p = store.getPayment(id); return [STATES.COMPLETED, STATES.CANCELLED, STATES.LIGHTSPEED_FAILED, STATES.LIGHTSPEED_UNCONFIRMED, STATES.ERROR].includes(p.state) ? p : null; });

test('encaissement complet : reste dû 12,50 €, client insère 20 €, monnaie rendue, paiement confirmé', async () => {
  const t = await setup({ cashmatic: { insertCents: 2000 } });
  try {
    const p = await t.flow.start({ accountIdentifier: 'A100.7' });
    assert.equal(p.requestedAmount, 12.5);
    assert.match(p.reference, /^CM-[A-Z0-9]+-[A-F0-9]{6}$/);
    const done = await settled(t.store, p.id);
    assert.equal(done.state, STATES.COMPLETED);
    assert.deepEqual(t.cm.state.startRequests[0], { amount: 1250, timeout: 2, queueAllowed: false, tipsAmount: 0, reason: 'TABLE 12 A100.7', reference: p.reference });
    assert.equal(done.cashmatic.inserted, 2000);
    assert.equal(done.cashmatic.dispensed, 750);
    assert.equal(done.cashmatic.collected, 1250);
    const pay = t.ls.state.payRequests[0];
    assert.equal(pay.paymentAmount, 12.5);
    assert.equal(pay.paymentMethod, 'CASHMATIC');
    assert.equal(pay.iKaccountIdentifier, 'A100.7');
    assert.equal(pay.endpointId, 'CASHMATIC');
    assert.equal(pay.thirdPartyPaymentReference, p.reference);
    assert.equal(pay.businessLocationId, 123);
    assert.equal(pay.taskTtlInMs, 60000);
    assert.equal(done.anomalies.length, 0);
    assert.equal(t.ls.state.check.paidAmount, 42.5);
  } finally { await t.close(); }
});

test('annulation par le client : rien encaissé, aucun paiement envoyé à Lightspeed', async () => {
  const t = await setup({ cashmatic: { cancel: true } });
  try {
    const p = await t.flow.start({ accountIdentifier: 'A100.7', amount: 10 });
    const done = await settled(t.store, p.id);
    assert.equal(done.state, STATES.CANCELLED);
    assert.equal(done.cashmatic.end, 'canceled');
    assert.equal(t.ls.state.payRequests.length, 0);
  } finally { await t.close(); }
});

test('monnaie non rendue : seul le montant demandé est enregistré, anomalie signalée', async () => {
  const t = await setup({ cashmatic: { insertCents: 2000, notDispensedCents: 300 } });
  try {
    const p = await t.flow.start({ accountIdentifier: 'A100.7' });
    const done = await settled(t.store, p.id);
    assert.equal(done.state, STATES.COMPLETED);
    assert.equal(done.cashmatic.collected, 1550);
    assert.equal(t.ls.state.payRequests[0].paymentAmount, 12.5);
    assert.ok(done.anomalies.some((a) => /Monnaie non rendue : 3 €/.test(a)));
    assert.ok(done.anomalies.some((a) => /Encaissé 15.5 €/.test(a)));
  } finally { await t.close(); }
});

test('paiement partiel accepté par le caissier (Commit) : montant inséré enregistré', async () => {
  const t = await setup({ cashmatic: { insertCents: 500 } });
  try {
    const p = await t.flow.start({ accountIdentifier: 'A100.7' });
    await until(() => t.store.getPayment(p.id).progress.inserted === 500);
    await t.flow.commit(p.id);
    const done = await settled(t.store, p.id);
    assert.equal(done.state, STATES.COMPLETED);
    assert.equal(t.ls.state.payRequests[0].paymentAmount, 5);
    assert.ok(done.anomalies.some((a) => /Paiement partiel/.test(a)));
  } finally { await t.close(); }
});

test('la caisse refuse le paiement (webhook FAILURE) : état LIGHTSPEED_FAILED avec le motif', async () => {
  const t = await setup({ cashmatic: { insertCents: 1250 }, lightspeed: { webhookStatus: 'FAILURE', webhookReason: 'Account not found' } });
  try {
    const p = await t.flow.start({ accountIdentifier: 'A100.7' });
    const done = await settled(t.store, p.id);
    assert.equal(done.state, STATES.LIGHTSPEED_FAILED);
    assert.equal(done.lightspeed.reason, 'Account not found');
  } finally { await t.close(); }
});

test('sans webhook : réconciliation sur le ticket par la référence externe', async () => {
  const t = await setup({ cashmatic: { insertCents: 1250 }, lightspeed: { webhookStatus: 'NONE' }, env: { WEBHOOK_WAIT_MS: '200' } });
  try {
    // Le faux Lightspeed n'envoie aucun webhook, mais enregistre le paiement sur le ticket.
    t.ls.state.check.paymentEntries = [];
    const p = await t.flow.start({ accountIdentifier: 'A100.7' });
    // on simule l'écriture côté caisse une fois le paiement reçu
    await until(() => t.ls.state.payRequests.length === 1);
    t.ls.state.check.paymentEntries.push({ externalReference: p.reference, amountPaid: 12.5, active: true });
    const done = await settled(t.store, p.id);
    assert.equal(done.state, STATES.COMPLETED);
    assert.equal(done.lightspeed.reconciled, true);
  } finally { await t.close(); }
});

test('refus : montant supérieur au reste dû, ticket inconnu, encaissement déjà en cours', async () => {
  const t = await setup({ cashmatic: { insertCents: 1250, delayMs: 300 } });
  try {
    await assert.rejects(t.flow.start({ accountIdentifier: 'A100.7', amount: 99 }), /supérieur au reste dû/);
    await assert.rejects(t.flow.start({ accountIdentifier: 'A999.1' }), /404/);
    const p = await t.flow.start({ accountIdentifier: 'A100.7' });
    await assert.rejects(t.flow.start({ accountIdentifier: 'A100.7' }), /déjà en cours/);
    await settled(t.store, p.id);
  } finally { await t.close(); }
});

test('jeton Lightspeed expiré : rafraîchi une seule fois avec le refresh token, puis réutilisé', async () => {
  const t = await setup({ cashmatic: { insertCents: 1250 } });
  try {
    t.store.setTokens({ accessToken: 'stale', refreshToken: 'refresh-1', accessExpiresAt: Date.now() - 1000 });
    await Promise.all([t.lightspeed.getBusinesses(), t.lightspeed.getBusinesses()]);
    assert.equal(t.ls.state.tokenRequests.length, 1);
    assert.equal(t.ls.state.tokenRequests[0].grant_type, 'refresh_token');
    assert.equal(t.ls.state.tokenRequests[0].refresh_token, 'refresh-1');
    assert.equal(t.ls.state.tokenRequests[0].authorization, 'Basic ' + Buffer.from('cid:csecret').toString('base64'));
    assert.equal(t.store.getTokens().refreshToken, 'refresh-2');
  } finally { await t.close(); }
});

test('OAuth : URL d’autorisation et échange du code', async () => {
  const t = await setup();
  try {
    const { url, state } = t.auth.authorizeUrl('abc');
    const u = new URL(url);
    assert.equal(u.pathname, '/auth');
    assert.equal(u.searchParams.get('response_type'), 'code');
    assert.equal(u.searchParams.get('scope'), 'orders-api financial-api offline_access');
    assert.equal(state, 'abc');
    await t.auth.exchangeCode('the-code');
    const req = t.ls.state.tokenRequests.at(-1);
    assert.equal(req.grant_type, 'authorization_code');
    assert.equal(req.code, 'the-code');
    assert.equal(req.redirect_uri, 'https://localhost/cb');
  } finally { await t.close(); }
});

test('Cashmatic : connexion automatique, reconnexion après 401, erreurs par code', async () => {
  const t = await setup();
  try {
    await t.cashmatic.activeTransaction();
    assert.equal(t.cm.state.logins, 1);
    t.cm.state.token = 'revoked'; // la machine a invalidé le jeton
    await t.cashmatic.activeTransaction();
    assert.equal(t.cm.state.logins, 2);
    await assert.rejects(t.cashmatic.cancelPayment(), (e) => e.name === 'CashmaticError' && e.code === 5);
  } finally { await t.close(); }
});

test('API HTTP : tickets ouverts, démarrage par POST, webhook protégé par Basic Auth', async () => {
  const t = await setup({ cashmatic: { insertCents: 1250 } });
  try {
    const checks = await (await fetch(`${t.connectorBase}/api/checks`)).json();
    assert.deepEqual(checks.map((c) => [c.accountIdentifier, c.dueAmount]), [['A100.7', 12.5]]);
    const r = await fetch(`${t.connectorBase}/api/payments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountIdentifier: 'A100.7' }) });
    assert.equal(r.status, 202);
    const p = await r.json();
    const done = await settled(t.store, p.id);
    assert.equal(done.state, STATES.COMPLETED);
    const bad = await fetch(`${t.connectorBase}/webhooks/lightspeed`, { method: 'POST', body: '{}' });
    assert.equal(bad.status, 401);
    const list = await (await fetch(`${t.connectorBase}/api/payments`)).json();
    assert.equal(list[0].id, p.id);
  } finally { await t.close(); }
});
