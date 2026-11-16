// Serveur HTTP du connecteur : autorisation OAuth, API pour l'interface caissier, webhook Lightspeed.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeCheck } from './lightspeed/client.js';

const UI_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui', 'index.html');

export function createServer({ config, auth, lightspeed, cashmatic, flow, store, log }) {
  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => { chunks.push(c); if (chunks.reduce((n, b) => n + b.length, 0) > 1e6) req.destroy(new Error('corps trop volumineux')); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
  const webhookAuthorized = (req) => {
    if (!config.lightspeed.webhookUser) return true;
    const h = req.headers.authorization || '';
    const expected = 'Basic ' + Buffer.from(`${config.lightspeed.webhookUser}:${config.lightspeed.webhookPassword}`).toString('base64');
    return h === expected;
  };

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    const m = (method, p) => req.method === method && (typeof p === 'string' ? pathname === p : p.test(pathname));
    try {
      if (m('GET', '/') || m('GET', '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(UI_FILE));
      }
      if (m('GET', '/health')) return json(res, 200, { ok: true });

      // ---- OAuth Lightspeed ----
      if (m('GET', '/oauth/start')) {
        const { url: u } = auth.authorizeUrl();
        res.writeHead(302, { location: u });
        return res.end();
      }
      if (m('GET', '/oauth/callback')) {
        const code = url.searchParams.get('code');
        if (!code) return json(res, 400, { error: 'paramètre code manquant' });
        await auth.exchangeCode(code);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end('<meta charset="utf-8"><p>Connecteur autorisé sur Lightspeed. Vous pouvez fermer cette page.</p>');
      }

      // ---- Webhook Lightspeed (Order and Pay) ----
      if (m('POST', '/webhooks/lightspeed')) {
        if (!webhookAuthorized(req)) return json(res, 401, { error: 'non autorisé' });
        const payload = await readBody(req);
        log.info('webhook Lightspeed', { type: payload.type, status: payload.status, reference: payload.thirdPartyReference });
        return json(res, 200, flow.handleWebhook(payload));
      }

      // ---- API interface ----
      if (m('GET', '/api/status')) {
        const status = { lightspeed: { authenticated: auth.isAuthenticated(), env: config.lightspeed.env, businessLocationId: config.lightspeed.businessLocationId, paymentMethod: config.lightspeed.paymentMethod }, cashmatic: { url: config.cashmatic.url, reachable: false }, activePayment: flow.active?.id ?? null };
        try { const info = await cashmatic.deviceInfo(); status.cashmatic = { ...status.cashmatic, reachable: true, info }; } catch (e) { status.cashmatic.error = e.message; }
        return json(res, 200, status);
      }
      if (m('GET', '/api/businesses')) return json(res, 200, await lightspeed.getBusinesses());
      if (m('GET', '/api/payment-methods')) return json(res, 200, await lightspeed.getPaymentMethods(config.lightspeed.businessLocationId));
      if (m('GET', '/api/checks')) {
        const checks = await lightspeed.getOpenChecks(config.lightspeed.businessLocationId);
        return json(res, 200, (checks || []).map(summarizeCheck).filter((c) => c.dueAmount > 0));
      }
      if (m('POST', '/api/payments')) {
        const body = await readBody(req);
        return json(res, 202, await flow.start(body));
      }
      if (m('GET', '/api/payments')) return json(res, 200, store.listPayments().slice(0, 100));
      let mm;
      if ((mm = /^\/api\/payments\/([^/]+)$/.exec(pathname)) && req.method === 'GET') {
        const p = store.getPayment(mm[1]);
        return p ? json(res, 200, p) : json(res, 404, { error: 'inconnu' });
      }
      if ((mm = /^\/api\/payments\/([^/]+)\/(cancel|commit|reconcile)$/.exec(pathname)) && req.method === 'POST') {
        const p = await flow[mm[2]](mm[1]);
        return json(res, 200, p);
      }
      if (m('POST', '/api/setup/webhook')) {
        const body = await readBody(req);
        return json(res, 200, await lightspeed.upsertWebhook({ update: Boolean(body.update) }));
      }
      if (m('GET', '/api/cashmatic/levels')) return json(res, 200, await cashmatic.allLevels());
      return json(res, 404, { error: 'route inconnue' });
    } catch (e) {
      log.error('requête en erreur', { path: pathname, error: e.message });
      return json(res, e.status && e.status >= 400 && e.status < 600 ? 502 : 400, { error: e.message, upstream: e.body ?? undefined });
    }
  };
  return http.createServer(handler);
}
