// Client de l'API locale Cashmatic (v1.x) : HTTPS sur le réseau local, JSON, jeton Bearer.
// Toutes les routes sont en POST et répondent { code, message, data? } ; code 0 = succès.
// Montants en centimes.
import { requestJson } from '../http.js';

export const CASHMATIC_CODES = {
  0: 'No error',
  2: 'Invalid parameters',
  3: 'Cannot process command',
  4: 'Other operation active',
  5: 'No operation active',
  6: 'Device error',
  7: 'User not allowed',
  8: 'No denominations',
  11: 'User not found',
  12: 'User Invalid Password',
};

export class CashmaticError extends Error {
  constructor(code, message, route) {
    super(`Cashmatic ${route} → code ${code} : ${message || CASHMATIC_CODES[code] || 'erreur'}`);
    this.name = 'CashmaticError';
    this.code = code;
    this.route = route;
  }
}

const TOKEN_LIFETIME_MS = 8 * 60_000; // le jeton expire après ~10 min : on le renouvelle avant

export class CashmaticClient {
  constructor({ config, log, now = () => Date.now() }) {
    this.cfg = config;
    this.log = log;
    this.now = now;
    this.token = null;
    this.tokenAt = 0;
    this.auth = null;
  }

  async #post(route, body = {}, { withAuth = true, retry = true } = {}) {
    const headers = {};
    if (withAuth) headers.authorization = `Bearer ${await this.#ensureToken()}`;
    const res = await requestJson(`${this.cfg.url}${route}`, { method: 'POST', headers, body, insecureTls: this.cfg.tlsInsecure, timeoutMs: 10_000 });
    if (res.status === 401 && withAuth && retry) {
      this.token = null; // jeton expiré ou révoqué : on se reconnecte une fois
      return this.#post(route, body, { withAuth, retry: false });
    }
    if (res.status >= 400) throw new CashmaticError(res.status, `HTTP ${res.status}`, route);
    const j = res.json ?? {};
    if (j.code !== 0) throw new CashmaticError(j.code, j.message, route);
    return j.data;
  }

  async #ensureToken() {
    if (this.token && this.now() - this.tokenAt < TOKEN_LIFETIME_MS) return this.token;
    if (!this.auth) {
      this.auth = (this.token ? this.renewToken() : this.login()).finally(() => { this.auth = null; });
    }
    await this.auth;
    return this.token;
  }

  async login() {
    const data = await this.#post('/api/user/Login', { username: this.cfg.username, password: this.cfg.password }, { withAuth: false });
    this.token = data.token;
    this.tokenAt = this.now();
    this.log.info('connecté à la machine Cashmatic');
    return data;
  }

  async renewToken() {
    try {
      const data = await this.#post('/api/user/RenewToken', {}, { retry: false });
      this.token = data.token;
      this.tokenAt = this.now();
    } catch (e) {
      this.log.warn('renouvellement du jeton Cashmatic refusé, nouvelle connexion', { error: e.message });
      this.token = null;
      await this.login();
    }
  }

  deviceInfo() { return this.#post('/api/device/GetDeviceInfo'); }
  allLevels() { return this.#post('/api/device/AllLevels'); }
  activeTransaction() { return this.#post('/api/device/ActiveTransaction'); }
  lastTransaction() { return this.#post('/api/device/LastTransaction'); }

  /** Démarre un encaissement. amountCents et tipsCents en centimes, timeoutS en secondes (0 = illimité). */
  startPayment({ amountCents, timeoutS, reason = '', reference = '', tipsCents = 0, queueAllowed = false }) {
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('amountCents doit être un entier positif (centimes)');
    return this.#post('/api/transaction/StartPayment', { amount: amountCents, timeout: timeoutS, queueAllowed, tipsAmount: tipsCents, reason, reference });
  }
  /** Annule le paiement en cours et rend l'argent inséré. */
  cancelPayment() { return this.#post('/api/transaction/CancelPayment'); }
  /** Clôture immédiatement le paiement, même si le montant demandé n'est pas atteint. */
  commitPayment() { return this.#post('/api/transaction/CommitPayment'); }

  /**
   * Attend la fin de l'opération en cours en interrogeant ActiveTransaction, puis renvoie LastTransaction.
   * onProgress reçoit { requested, inserted, dispensed } à chaque lecture.
   */
  async waitForIdle({ pollMs = this.cfg.pollMs, deadlineMs = 0, onProgress } = {}) {
    const start = this.now();
    for (;;) {
      const t = await this.activeTransaction();
      if (onProgress) onProgress({ requested: t.requested, inserted: t.inserted, dispensed: t.dispensed, status: t.status });
      if (t.operation === 'idle') return this.lastTransaction();
      if (deadlineMs && this.now() - start > deadlineMs) throw new Error('Cashmatic : opération toujours active après le délai maximal');
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}
