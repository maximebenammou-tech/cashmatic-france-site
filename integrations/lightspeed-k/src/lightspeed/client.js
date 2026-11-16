// Client de l'API Lightspeed Restaurant K-Series (groupes « Order and Pay », « Financial », webhooks).
// Spécification : https://api-docs.lsk.lightspeed.app/source.json
import { requestJson, HttpError } from '../http.js';

export class LightspeedClient {
  constructor({ config, auth, log }) {
    this.cfg = config;
    this.auth = auth;
    this.log = log;
  }

  async #call(method, path, { body, query } = {}) {
    const u = new URL(this.cfg.apiBase + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    const token = await this.auth.getAccessToken();
    const res = await requestJson(u.toString(), { method, headers: { authorization: `Bearer ${token}` }, body });
    if (res.status >= 400) {
      const msg = res.json?.message || res.text || `HTTP ${res.status}`;
      throw new HttpError(`Lightspeed ${method} ${path} → ${res.status} : ${msg}`, { status: res.status, body: res.json ?? res.text, url: u.toString() });
    }
    return res.json;
  }

  /** Entreprises et établissements accessibles avec le jeton courant. */
  getBusinesses() { return this.#call('GET', '/o/op/data/businesses'); }

  /** Moyens de paiement configurés pour l'établissement (il faut y trouver le code CASHMATIC). */
  async getPaymentMethods(businessLocationId) {
    const j = await this.#call('GET', `/f/finance/${businessLocationId}/paymentMethods`);
    return j?._embedded?.paymentMethodList ?? [];
  }

  /** Tous les tickets ouverts de la journée. */
  getOpenChecks(businessLocationId) {
    return this.#call('GET', '/o/op/1/order/table/getCheck', { query: { businessLocationId } });
  }

  /** Un ticket par identifiant de compte (ex. A78094.48). */
  getCheck(businessLocationId, accountIdentifier) {
    return this.#call('GET', `/o/op/1/order/accounts/${encodeURIComponent(accountIdentifier)}`, { query: { businessLocationId } });
  }

  /**
   * Enregistre un paiement sur un ticket. La réponse 200 signifie seulement « accepté pour livraison
   * à la caisse » ; le résultat réel arrive par webhook (type PAYMENT, status SUCCESS | FAILURE).
   */
  applyPayment({ businessLocationId, accountIdentifier, amount, tip = 0, reference, paymentMethod, staffId, deviceId, taskTtlInMs }) {
    if (!reference || reference.length > 50) throw new Error('thirdPartyPaymentReference : 1 à 50 caractères');
    const body = {
      businessLocationId,
      endpointId: this.cfg.webhookEndpointId,
      iKaccountIdentifier: accountIdentifier,
      thirdPartyPaymentReference: reference,
      paymentMethod: paymentMethod ?? this.cfg.paymentMethod,
      paymentAmount: round2(amount),
      taskTtlInMs: taskTtlInMs ?? this.cfg.taskTtlMs,
    };
    if (tip) body.tipAmount = round2(tip);
    if (staffId ?? this.cfg.staffId) body.staffId = staffId ?? this.cfg.staffId;
    if (deviceId ?? this.cfg.deviceId) body.deviceId = deviceId ?? this.cfg.deviceId;
    return this.#call('POST', '/o/op/1/pay', { body });
  }

  /** Crée (PUT) ou met à jour (POST) le webhook « Order and Pay » qui recevra les confirmations de paiement. */
  async upsertWebhook({ update = false } = {}) {
    const body = {
      endpointId: this.cfg.webhookEndpointId,
      url: this.cfg.webhookUrl,
      withBasicAuth: Boolean(this.cfg.webhookUser),
      username: this.cfg.webhookUser || undefined,
      password: this.cfg.webhookPassword || undefined,
      provideAccount: true,
      expandPayments: true,
    };
    return this.#call(update ? 'POST' : 'PUT', '/o/wh/1/webhook', { body });
  }

  getWebhook(endpointId = this.cfg.webhookEndpointId) {
    return this.#call('GET', `/o/wh/1/webhook/${encodeURIComponent(endpointId)}`);
  }

  /** Reçu par référence externe (réconciliation après coup). */
  getReceiptByExternalReference(businessLocationId, externalReferenceId) {
    return this.#call('GET', `/f/finance/${businessLocationId}/saleByExternalReference`, { query: { externalReferenceId } });
  }
}

export const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** Résumé d'un ticket Lightspeed pour l'interface et le flux d'encaissement. */
export function summarizeCheck(c) {
  const current = Number(c.currentAmount ?? 0);
  const paid = Number(c.paidAmount ?? 0);
  return {
    accountIdentifier: c.ikaccountId || c.identifier || c.id,
    uuid: c.uuid,
    name: c.name,
    tableNumber: c.tableNumber ?? null,
    clientCount: c.clientCount ?? null,
    staffName: c.staffName ?? null,
    openDate: c.openDate,
    currentAmount: round2(current),
    paidAmount: round2(paid),
    dueAmount: round2(Math.max(0, current - paid)),
    paymentEntries: c.paymentEntries ?? [],
  };
}
