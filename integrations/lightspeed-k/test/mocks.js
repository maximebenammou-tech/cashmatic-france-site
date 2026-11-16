// Serveurs factices : un Lightspeed K-Series (OAuth + Order and Pay) et un monnayeur Cashmatic.
import http from 'node:http';

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));
const body = (req) => new Promise((resolve) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); });
const send = (res, status, j) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };

/** Lightspeed factice : jetons, un ticket, l'endpoint /o/op/1/pay, et envoi du webhook vers le connecteur. */
export async function mockLightspeed({ check, webhookTarget, webhookDelayMs = 20, webhookStatus = 'SUCCESS', webhookReason } = {}) {
  const state = {
    calls: [], tokenRequests: [], payRequests: [], usedReferences: new Set(),
    check: check ?? { ikaccountId: 'A100.7', uuid: 'u-1', name: 'TABLE 12', tableNumber: 12, currentAmount: 42.5, paidAmount: 30.0, paymentEntries: [] },
    accessToken: 'access-1', tokenCounter: 1, failPayWith: null,
  };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    state.calls.push(`${req.method} ${u.pathname}`);
    if (u.pathname === '/token') {
      const form = Object.fromEntries(new URLSearchParams(await body(req)));
      state.tokenRequests.push({ ...form, authorization: req.headers.authorization });
      state.tokenCounter += 1;
      state.accessToken = `access-${state.tokenCounter}`;
      return send(res, 200, { access_token: state.accessToken, refresh_token: `refresh-${state.tokenCounter}`, expires_in: 1500, refresh_expires_in: 3456000, token_type: 'Bearer', scope: 'orders-api' });
    }
    if (req.headers.authorization !== `Bearer ${state.accessToken}`) return send(res, 401, { message: 'unauthorized' });
    if (u.pathname === '/o/op/data/businesses') return send(res, 200, [{ id: 1, name: 'Demo', businessLocations: [{ id: 123, name: 'Demo - Paris' }] }]);
    if (u.pathname === '/o/op/1/order/table/getCheck') return send(res, 200, [state.check]);
    if (u.pathname.startsWith('/o/op/1/order/accounts/')) {
      const id = decodeURIComponent(u.pathname.split('/').pop());
      return id === state.check.ikaccountId ? send(res, 200, state.check) : send(res, 404, { status: 404, message: `account not found for BL ${u.searchParams.get('businessLocationId')}` });
    }
    if (u.pathname === '/o/op/1/pay') {
      const p = JSON.parse(await body(req));
      state.payRequests.push(p);
      if (state.failPayWith) return send(res, 400, { status: 400, error: 'Bad Request', message: state.failPayWith, path: '/o/op/1/pay' });
      if (state.usedReferences.has(p.thirdPartyPaymentReference)) return send(res, 400, { status: 400, message: `reference has already been used ${p.thirdPartyPaymentReference}` });
      state.usedReferences.add(p.thirdPartyPaymentReference);
      const due = state.check.currentAmount - state.check.paidAmount;
      const status = p.paymentAmount > due + 1e-9 ? 'FAILURE' : webhookStatus;
      const payload = { thirdPartyReference: p.thirdPartyPaymentReference, businessLocationId: p.businessLocationId, status, ikentooAccountIdentifier: p.iKaccountIdentifier, type: 'PAYMENT' };
      if (status === 'FAILURE') payload.reason = webhookReason || 'the payment amount is greater than the amount due';
      if (status === 'SUCCESS') {
        state.check.paidAmount += p.paymentAmount;
        state.check.paymentEntries.push({ paymentMethodCode: p.paymentMethod, externalReference: p.thirdPartyPaymentReference, amountPaid: p.paymentAmount, active: true });
      }
      if (webhookTarget && webhookStatus !== 'NONE') {
        const target = typeof webhookTarget === 'function' ? webhookTarget() : webhookTarget;
        const headers = { 'content-type': 'application/json' };
        if (state.webhookAuth) headers.authorization = state.webhookAuth;
        setTimeout(() => fetch(target, { method: 'POST', headers, body: JSON.stringify(payload) }).catch(() => {}), webhookDelayMs);
      }
      return send(res, 200, { status: 'ok' });
    }
    if (u.pathname === '/o/wh/1/webhook') return send(res, 200, JSON.parse(await body(req)));
    if (u.pathname.startsWith('/f/finance/') && u.pathname.endsWith('/paymentMethods')) return send(res, 200, { _embedded: { paymentMethodList: [{ name: 'Cash', code: 'CASH', pmId: 1 }, { name: 'Cashmatic', code: 'CASHMATIC', pmId: 2 }] } });
    send(res, 404, { message: 'not found' });
  });
  const base = await listen(server);
  return { base, state, close: () => new Promise((r) => server.close(r)) };
}

/**
 * Cashmatic factice. Le « client » est simulé par un scénario : après `delayMs`, il insère `insertCents`
 * et la machine rend la monnaie (`dispenseCents`, par défaut l'excédent) sauf `notDispensedCents`.
 * scenario.cancel = true : le client annule sans rien insérer.
 */
export async function mockCashmatic(scenario = {}) {
  const state = { calls: [], token: null, logins: 0, active: idle(), last: null, startRequests: [] };
  function idle() { return { id: 0, operation: 'idle', requested: 0, inserted: 0, dispensed: 0, notDispensed: 0, status: 'running', queuePosition: 0 }; }
  function finish(end) {
    const t = state.active;
    state.last = { ...t, end, module: 'cash', denominationsInserted: [], denominationsDispensed: [], denominationsTransfered: [] };
    state.active = idle();
  }
  const server = http.createServer(async (req, res) => {
    const route = req.url;
    state.calls.push(route);
    const data = JSON.parse((await body(req)) || '{}');
    if (route === '/api/user/Login') {
      state.logins += 1;
      if (data.password !== 'secret') return send(res, 200, { code: 12, message: 'User Invalid Password' });
      state.token = `cm-token-${state.logins}`;
      return send(res, 200, { code: 0, message: 'No error', data: { token: state.token, refreshToken: '', type: 0 } });
    }
    if (req.headers.authorization !== `Bearer ${state.token}`) { res.writeHead(401); return res.end(); }
    if (route === '/api/user/RenewToken') { state.token = `${state.token}-r`; return send(res, 200, { code: 0, message: 'No error', data: { token: state.token } }); }
    if (route === '/api/device/GetDeviceInfo') return send(res, 200, { code: 0, message: 'No error', data: { model: 'SelfPay 460', serial: 'SIM', version: '1.0.0.6' } });
    if (route === '/api/device/ActiveTransaction') return send(res, 200, { code: 0, message: 'No error', data: state.active });
    if (route === '/api/device/LastTransaction') return send(res, 200, { code: 0, message: 'No error', data: state.last ?? idle() });
    if (route === '/api/transaction/StartPayment') {
      state.startRequests.push(data);
      if (state.active.operation !== 'idle') return send(res, 200, { code: 4, message: 'Other operation active' });
      const requested = data.amount + (data.tipsAmount || 0);
      state.active = { id: 1 + state.startRequests.length, operation: 'payment', requested, inserted: 0, dispensed: 0, notDispensed: 0, status: 'running', queuePosition: 0 };
      setTimeout(() => {
        if (state.active.operation !== 'payment') return;
        if (scenario.cancel) return finish('canceled');
        const ins = scenario.insertCents ?? requested;
        state.active.inserted = ins;
        if (ins >= requested || scenario.commitAtInsert) {
          const change = Math.max(0, ins - requested);
          const nd = scenario.notDispensedCents ?? 0;
          state.active.dispensed = scenario.dispenseCents ?? Math.max(0, change - nd);
          state.active.notDispensed = nd;
          finish(ins >= requested ? 'normal' : 'stopped');
        }
        // sinon : montant insuffisant, la transaction reste ouverte jusqu'à Commit/Cancel
      }, scenario.delayMs ?? 30);
      return send(res, 200, { code: 0, message: 'No error' });
    }
    if (route === '/api/transaction/CancelPayment') {
      if (state.active.operation !== 'payment') return send(res, 200, { code: 5, message: 'No operation active' });
      state.active.dispensed = state.active.inserted; finish('canceled');
      return send(res, 200, { code: 0, message: 'No error' });
    }
    if (route === '/api/transaction/CommitPayment') {
      if (state.active.operation !== 'payment') return send(res, 200, { code: 5, message: 'No operation active' });
      if (state.active.inserted === 0) return send(res, 200, { code: 3, message: 'Cannot process command' });
      finish('stopped');
      return send(res, 200, { code: 0, message: 'No error' });
    }
    res.writeHead(404); res.end();
  });
  const base = await listen(server);
  return { base, state, close: () => new Promise((r) => server.close(r)) };
}

export const until = async (fn, { timeoutMs = 5000, stepMs = 20 } = {}) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('condition non atteinte dans le délai');
    await new Promise((r) => setTimeout(r, stepMs));
  }
};
