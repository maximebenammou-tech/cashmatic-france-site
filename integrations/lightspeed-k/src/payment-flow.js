// Orchestration d'un encaissement : ticket Lightspeed → paiement sur le monnayeur Cashmatic →
// enregistrement du paiement sur le ticket → confirmation par webhook.
//
// États d'un encaissement :
//   CREATED → CASHMATIC_IN_PROGRESS → LIGHTSPEED_PENDING → COMPLETED
//                     │                      ├→ LIGHTSPEED_FAILED      (la caisse a refusé : argent encaissé, action manuelle)
//                     │                      └→ LIGHTSPEED_UNCONFIRMED (pas de webhook : réconciliation à faire)
//                     ├→ CANCELLED  (rien encaissé : annulation, délai dépassé)
//                     └→ ERROR      (erreur technique avant tout encaissement)
import crypto from 'node:crypto';
import { round2, summarizeCheck } from './lightspeed/client.js';

export const STATES = Object.freeze({
  CREATED: 'CREATED',
  CASHMATIC_IN_PROGRESS: 'CASHMATIC_IN_PROGRESS',
  LIGHTSPEED_PENDING: 'LIGHTSPEED_PENDING',
  COMPLETED: 'COMPLETED',
  LIGHTSPEED_FAILED: 'LIGHTSPEED_FAILED',
  LIGHTSPEED_UNCONFIRMED: 'LIGHTSPEED_UNCONFIRMED',
  CANCELLED: 'CANCELLED',
  ERROR: 'ERROR',
});

const toCents = (n) => Math.round(Number(n) * 100);
const fromCents = (c) => round2(c / 100);

/** Référence externe unique, ≤ 50 caractères, renvoyée telle quelle par le webhook Lightspeed. */
export function newReference(now = Date.now()) {
  return `CM-${now.toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export class PaymentFlow {
  constructor({ config, lightspeed, cashmatic, store, log, now = () => Date.now() }) {
    this.cfg = config;
    this.ls = lightspeed;
    this.cm = cashmatic;
    this.store = store;
    this.log = log;
    this.now = now;
    this.waiters = new Map(); // référence → { resolve }
    this.active = null; // encaissement en cours sur la machine (un seul à la fois)
  }

  #save(p, patch) {
    Object.assign(p, patch, { updatedAt: new Date(this.now()).toISOString() });
    this.store.putPayment(p);
    return p;
  }

  /**
   * Lance un encaissement et renvoie immédiatement l'enregistrement ; le traitement continue en tâche de fond.
   * amount facultatif (défaut : reste dû du ticket) ; tip facultatif.
   */
  async start({ businessLocationId = this.cfg.lightspeed.businessLocationId, accountIdentifier, amount, tip = 0 }) {
    if (!accountIdentifier) throw new Error('accountIdentifier requis');
    if (this.active) throw new Error(`un encaissement est déjà en cours sur le monnayeur (${this.active.id})`);

    const check = summarizeCheck(await this.ls.getCheck(businessLocationId, accountIdentifier));
    const amountCents = amount === undefined || amount === null || amount === '' ? toCents(check.dueAmount) : toCents(amount);
    const tipCents = toCents(tip || 0);
    if (amountCents <= 0) throw new Error('aucun montant à encaisser sur ce ticket');
    if (amountCents > toCents(check.dueAmount)) throw new Error(`montant ${fromCents(amountCents)} supérieur au reste dû ${check.dueAmount}`);
    if (tipCents < 0) throw new Error('pourboire négatif');

    const now = this.now();
    const p = {
      id: crypto.randomUUID(),
      reference: newReference(now),
      state: STATES.CREATED,
      businessLocationId,
      accountIdentifier,
      checkName: check.name,
      tableNumber: check.tableNumber,
      requestedAmount: fromCents(amountCents),
      tipAmount: fromCents(tipCents),
      dueBefore: check.dueAmount,
      progress: { requested: amountCents + tipCents, inserted: 0, dispensed: 0 },
      cashmatic: null,
      lightspeed: null,
      anomalies: [],
      error: null,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };
    this.store.putPayment(p);
    this.active = p;
    this.running = this.#run(p, { amountCents, tipCents }).catch((e) => {
      this.log.error('erreur inattendue dans le flux', { id: p.id, error: e.message });
      this.#save(p, { state: STATES.ERROR, error: e.message });
    }).finally(() => { if (this.active === p) this.active = null; });
    return p;
  }

  async #run(p, { amountCents, tipCents }) {
    const log = this.log.child('flux');
    // 1. Paiement sur le monnayeur
    try {
      await this.cm.startPayment({
        amountCents,
        tipsCents: tipCents,
        timeoutS: this.cfg.cashmatic.paymentTimeoutS,
        reason: `${p.checkName || ''} ${p.accountIdentifier}`.trim().slice(0, 100),
        reference: p.reference,
      });
    } catch (e) {
      log.error('StartPayment refusé', { id: p.id, error: e.message });
      return this.#save(p, { state: STATES.ERROR, error: e.message });
    }
    this.#save(p, { state: STATES.CASHMATIC_IN_PROGRESS });

    let last;
    try {
      last = await this.cm.waitForIdle({
        deadlineMs: (this.cfg.cashmatic.paymentTimeoutS + 60) * 1000,
        onProgress: (pr) => this.#save(p, { progress: pr }),
      });
    } catch (e) {
      log.error('suivi du paiement Cashmatic impossible', { id: p.id, error: e.message });
      return this.#save(p, { state: STATES.ERROR, error: e.message, anomalies: [...p.anomalies, 'Résultat Cashmatic inconnu : vérifier la machine avant toute nouvelle tentative.'] });
    }

    const inserted = Number(last.inserted ?? 0);
    const dispensed = Number(last.dispensed ?? 0);
    const notDispensed = Number(last.notDispensed ?? 0);
    const collectedCents = inserted - dispensed; // ce que la machine a réellement gardé
    const cashmatic = { transactionId: last.id, end: last.end, requested: last.requested, inserted, dispensed, notDispensed, collected: collectedCents };
    this.#save(p, { cashmatic, progress: { requested: last.requested, inserted, dispensed } });

    if (notDispensed > 0) p.anomalies.push(`Monnaie non rendue : ${fromCents(notDispensed)} € (à rendre manuellement au client).`);

    if (collectedCents <= 0) {
      log.info('encaissement annulé, rien conservé', { id: p.id, end: last.end });
      return this.#save(p, { state: STATES.CANCELLED });
    }

    // 2. Enregistrement sur Lightspeed : jamais plus que ce que la caisse attend
    let payCents = collectedCents - tipCents;
    if (payCents > amountCents) {
      p.anomalies.push(`Encaissé ${fromCents(collectedCents)} € pour ${fromCents(amountCents + tipCents)} € demandés : seul le montant demandé est enregistré sur la caisse.`);
      payCents = amountCents;
    }
    if (payCents < amountCents) p.anomalies.push(`Paiement partiel : ${fromCents(payCents)} € sur ${fromCents(amountCents)} €.`);
    if (payCents <= 0) {
      p.anomalies.push('Montant encaissé inférieur au pourboire demandé : rien enregistré sur la caisse.');
      return this.#save(p, { state: STATES.CANCELLED });
    }

    const waiter = this.#waitForWebhook(p.reference, this.cfg.webhookWaitMs);
    try {
      await this.ls.applyPayment({
        businessLocationId: p.businessLocationId,
        accountIdentifier: p.accountIdentifier,
        amount: fromCents(payCents),
        tip: tipCents && collectedCents >= amountCents + tipCents ? fromCents(tipCents) : 0,
        reference: p.reference,
      });
    } catch (e) {
      const alreadyUsed = e.status === 400 && /already been used/i.test(String(e.body?.message ?? e.message));
      if (!alreadyUsed) {
        waiter.cancel();
        log.error('Lightspeed a refusé le paiement', { id: p.id, error: e.message });
        return this.#save(p, { state: STATES.LIGHTSPEED_FAILED, error: e.message, lightspeed: { sentAmount: fromCents(payCents), status: 'REJECTED', reason: e.message } });
      }
    }
    this.#save(p, { state: STATES.LIGHTSPEED_PENDING, lightspeed: { sentAmount: fromCents(payCents), status: 'PENDING' } });

    // 3. Confirmation par webhook, sinon réconciliation sur le ticket
    const evt = await waiter.promise;
    if (evt?.status === 'SUCCESS') {
      log.info('paiement confirmé par Lightspeed', { id: p.id, reference: p.reference });
      return this.#save(p, { state: STATES.COMPLETED, lightspeed: { ...p.lightspeed, status: 'SUCCESS', accountIdentifier: evt.ikentooAccountIdentifier } });
    }
    if (evt?.status === 'FAILURE') {
      log.error('Lightspeed a signalé un échec', { id: p.id, reason: evt.reason });
      return this.#save(p, { state: STATES.LIGHTSPEED_FAILED, lightspeed: { ...p.lightspeed, status: 'FAILURE', reason: evt.reason, errors: evt.errors } });
    }
    return this.reconcile(p.id);
  }

  /** Vérifie sur le ticket si le paiement porte bien notre référence externe. */
  async reconcile(id) {
    const p = this.store.getPayment(id);
    if (!p) throw new Error('encaissement inconnu');
    try {
      const check = summarizeCheck(await this.ls.getCheck(p.businessLocationId, p.accountIdentifier));
      const line = check.paymentEntries.find((e) => e.externalReference === p.reference && e.active !== false);
      if (line) return this.#save(p, { state: STATES.COMPLETED, lightspeed: { ...p.lightspeed, status: 'SUCCESS', reconciled: true } });
      return this.#save(p, { state: STATES.LIGHTSPEED_UNCONFIRMED, lightspeed: { ...p.lightspeed, status: 'UNCONFIRMED' } });
    } catch (e) {
      return this.#save(p, { state: STATES.LIGHTSPEED_UNCONFIRMED, lightspeed: { ...p.lightspeed, status: 'UNCONFIRMED', reason: e.message } });
    }
  }

  #waitForWebhook(reference, timeoutMs) {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    const timer = setTimeout(() => { this.waiters.delete(reference); resolve(null); }, timeoutMs);
    this.waiters.set(reference, { resolve: (evt) => { clearTimeout(timer); this.waiters.delete(reference); resolve(evt); } });
    return { promise, cancel: () => { clearTimeout(timer); this.waiters.delete(reference); } };
  }

  /** Notification « Order and Pay » reçue de Lightspeed. */
  handleWebhook(payload) {
    this.store.addWebhookEvent(payload);
    if (payload?.type !== 'PAYMENT') return { matched: false };
    const w = this.waiters.get(payload.thirdPartyReference);
    if (w) { w.resolve(payload); return { matched: true }; }
    this.log.warn('webhook paiement sans encaissement en attente', { reference: payload.thirdPartyReference, status: payload.status });
    return { matched: false };
  }

  /** Annule le paiement en cours sur le monnayeur (l'argent inséré est rendu). */
  async cancel(id) {
    const p = this.store.getPayment(id);
    if (!p) throw new Error('encaissement inconnu');
    if (p.state !== STATES.CASHMATIC_IN_PROGRESS) throw new Error(`impossible d'annuler dans l'état ${p.state}`);
    await this.cm.cancelPayment();
    return p;
  }

  /** Clôture le paiement avec ce qui a été inséré (paiement partiel accepté par le caissier). */
  async commit(id) {
    const p = this.store.getPayment(id);
    if (!p) throw new Error('encaissement inconnu');
    if (p.state !== STATES.CASHMATIC_IN_PROGRESS) throw new Error(`impossible de clôturer dans l'état ${p.state}`);
    await this.cm.commitPayment();
    return p;
  }
}
