// OAuth2 Lightspeed K-Series (authorization code + refresh token).
// Référence : https://api-portal.lsk.lightspeed.app/quick-start/authentication/authorization-overview
// - jeton d'accès : 25 min ; refresh token : 40 jours avec offline_access, à usage unique.
import crypto from 'node:crypto';
import { requestJson, HttpError } from '../http.js';

const REFRESH_MARGIN_MS = 60_000;

export class LightspeedAuth {
  constructor({ config, store, log, now = () => Date.now() }) {
    this.cfg = config;
    this.store = store;
    this.log = log;
    this.now = now;
    this.refreshing = null;
  }

  authorizeUrl(state = crypto.randomUUID()) {
    const u = new URL(`${this.cfg.authBase}/auth`);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', this.cfg.clientId);
    u.searchParams.set('redirect_uri', this.cfg.redirectUri);
    u.searchParams.set('scope', this.cfg.scopes);
    u.searchParams.set('state', state);
    return { url: u.toString(), state };
  }

  isAuthenticated() {
    const t = this.store.getTokens();
    return Boolean(t && t.refreshToken);
  }

  async exchangeCode(code) {
    const tokens = await this.#tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.cfg.redirectUri });
    this.store.setTokens(tokens);
    this.log.info('jetons Lightspeed obtenus', { scope: tokens.scope });
    return tokens;
  }

  async getAccessToken() {
    const t = this.store.getTokens();
    if (!t) throw new Error('Lightspeed : connecteur non autorisé. Ouvrez /oauth/start pour autoriser l’accès.');
    if (t.accessExpiresAt - REFRESH_MARGIN_MS > this.now()) return t.accessToken;
    if (!this.refreshing) {
      this.refreshing = this.#refresh(t.refreshToken).finally(() => { this.refreshing = null; });
    }
    return (await this.refreshing).accessToken;
  }

  async #refresh(refreshToken) {
    const tokens = await this.#tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
    this.store.setTokens(tokens);
    this.log.info('jeton Lightspeed rafraîchi');
    return tokens;
  }

  async #tokenRequest(fields) {
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    const body = new URLSearchParams(fields).toString();
    const res = await requestJson(`${this.cfg.authBase}/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (res.status !== 200 || !res.json?.access_token) {
      throw new HttpError(`échec OAuth Lightspeed (${res.status}) : ${res.text}`, { status: res.status, body: res.json ?? res.text, url: 'token' });
    }
    const j = res.json;
    const now = this.now();
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      accessExpiresAt: now + (j.expires_in ?? 1500) * 1000,
      refreshExpiresAt: j.refresh_expires_in ? now + j.refresh_expires_in * 1000 : null,
      scope: j.scope,
      obtainedAt: new Date(now).toISOString(),
    };
  }
}
