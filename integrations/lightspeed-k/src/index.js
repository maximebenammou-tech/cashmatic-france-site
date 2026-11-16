// Point d'entrée : assemble la configuration, les clients et le serveur HTTP.
import path from 'node:path';
import { buildConfig, loadDotEnv } from './config.js';
import { createLogger } from './log.js';
import { JsonStore } from './store.js';
import { LightspeedAuth } from './lightspeed/auth.js';
import { LightspeedClient } from './lightspeed/client.js';
import { CashmaticClient } from './cashmatic/client.js';
import { PaymentFlow } from './payment-flow.js';
import { createServer } from './server.js';

loadDotEnv();
const config = buildConfig();
const log = createLogger('connecteur');
const store = new JsonStore(path.join(config.dataDir, 'state.json'));
const auth = new LightspeedAuth({ config: config.lightspeed, store, log: log.child('oauth') });
const lightspeed = new LightspeedClient({ config: config.lightspeed, auth, log: log.child('lightspeed') });
const cashmatic = new CashmaticClient({ config: config.cashmatic, log: log.child('cashmatic') });
const flow = new PaymentFlow({ config, lightspeed, cashmatic, store, log });

const server = createServer({ config, auth, lightspeed, cashmatic, flow, store, log });
server.listen(config.port, () => {
  log.info('connecteur démarré', { port: config.port, lightspeedEnv: config.lightspeed.env, authenticated: auth.isAuthenticated(), cashmatic: config.cashmatic.url });
  if (!auth.isAuthenticated()) log.warn(`Lightspeed non autorisé : ouvrez http://localhost:${config.port}/oauth/start`);
});
