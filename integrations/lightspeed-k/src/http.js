// Petit client HTTP(S) JSON sur node:http / node:https.
// On n'utilise pas fetch() : la machine Cashmatic présente un certificat auto-signé
// et il faut pouvoir désactiver la vérification TLS pour elle seule, pas pour Lightspeed.
import http from 'node:http';
import https from 'node:https';

export class HttpError extends Error {
  constructor(message, { status, body, url }) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

export function requestJson(url, { method = 'GET', headers = {}, body, insecureTls = false, timeoutMs = 15000 } = {}) {
  const u = new URL(url);
  const lib = u.protocol === 'https:' ? https : http;
  let payload;
  const h = { accept: 'application/json', ...headers };
  if (body !== undefined) {
    if (typeof body === 'string') payload = body;
    else { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    h['content-length'] = Buffer.byteLength(payload);
  }
  const opts = { method, headers: h, timeout: timeoutMs };
  if (u.protocol === 'https:' && insecureTls) opts.rejectUnauthorized = false;
  return new Promise((resolve, reject) => {
    const req = lib.request(u, opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout après ${timeoutMs} ms : ${method} ${url}`)));
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}
