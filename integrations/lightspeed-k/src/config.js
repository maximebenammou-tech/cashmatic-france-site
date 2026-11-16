// Lecture de la configuration depuis les variables d'environnement (et un fichier .env facultatif).
import fs from 'node:fs';
import path from 'node:path';

const LSK_HOSTS = {
  trial: { api: 'https://api.trial.lsk.lightspeed.app', auth: 'https://auth.lsk-demo.app/realms/k-series/protocol/openid-connect' },
  prod: { api: 'https://api.lsk.lightspeed.app', auth: 'https://auth.lsk-prod.app/realms/k-series/protocol/openid-connect' },
};

export function loadDotEnv(file = '.env') {
  const p = path.resolve(file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|oui)$/i.test(v));
const str = (v, d = '') => (v === undefined ? d : v);

export function buildConfig(env = process.env) {
  const lskEnv = str(env.LSK_ENV, 'trial');
  const hosts = LSK_HOSTS[lskEnv] || LSK_HOSTS.trial;
  return {
    lightspeed: {
      env: lskEnv,
      apiBase: str(env.LSK_API_BASE, hosts.api),
      authBase: str(env.LSK_AUTH_BASE, hosts.auth),
      clientId: str(env.LSK_CLIENT_ID),
      clientSecret: str(env.LSK_CLIENT_SECRET),
      redirectUri: str(env.LSK_REDIRECT_URI),
      scopes: str(env.LSK_SCOPES, 'orders-api financial-api offline_access'),
      businessLocationId: num(env.LSK_BUSINESS_LOCATION_ID, 0),
      paymentMethod: str(env.LSK_PAYMENT_METHOD, 'CASHMATIC'),
      webhookEndpointId: str(env.LSK_WEBHOOK_ENDPOINT_ID, 'CASHMATIC'),
      webhookUrl: str(env.LSK_WEBHOOK_URL),
      webhookUser: str(env.LSK_WEBHOOK_USER),
      webhookPassword: str(env.LSK_WEBHOOK_PASSWORD),
      staffId: num(env.LSK_STAFF_ID, 0) || undefined,
      deviceId: num(env.LSK_DEVICE_ID, 0) || undefined,
      taskTtlMs: Math.max(60000, num(env.LSK_TASK_TTL_MS, 60000)),
    },
    cashmatic: {
      url: str(env.CASHMATIC_URL, 'https://127.0.0.1:50301').replace(/\/$/, ''),
      username: str(env.CASHMATIC_USERNAME),
      password: str(env.CASHMATIC_PASSWORD),
      tlsInsecure: bool(env.CASHMATIC_TLS_INSECURE, true),
      paymentTimeoutS: num(env.CASHMATIC_PAYMENT_TIMEOUT_S, 120),
      pollMs: num(env.CASHMATIC_POLL_MS, 300),
    },
    port: num(env.PORT, 8080),
    dataDir: str(env.DATA_DIR, './data'),
    webhookWaitMs: num(env.WEBHOOK_WAIT_MS, 90000),
  };
}
