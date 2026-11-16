// Persistance très simple dans un fichier JSON : jetons OAuth et historique des encaissements.
// Écriture atomique (fichier temporaire puis renommage) pour ne jamais laisser un fichier tronqué.
import fs from 'node:fs';
import path from 'node:path';

export class JsonStore {
  constructor(file) {
    this.file = file;
    this.data = { tokens: null, payments: {}, webhookEvents: [] };
    if (file && fs.existsSync(file)) {
      try { this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* fichier illisible : on repart à vide */ }
    }
  }
  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
  getTokens() { return this.data.tokens; }
  setTokens(t) { this.data.tokens = t; this.save(); }
  getPayment(id) { return this.data.payments[id]; }
  listPayments() { return Object.values(this.data.payments).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); }
  putPayment(p) { this.data.payments[p.id] = p; this.save(); return p; }
  addWebhookEvent(e) {
    this.data.webhookEvents.push({ receivedAt: new Date().toISOString(), ...e });
    if (this.data.webhookEvents.length > 500) this.data.webhookEvents.splice(0, this.data.webhookEvents.length - 500);
    this.save();
  }
}
export const memoryStore = () => new JsonStore(null);
