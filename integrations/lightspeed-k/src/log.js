// Journal minimal : une ligne JSON par événement, lisible par n'importe quel collecteur.
export function createLogger(scope, sink = (line) => process.stdout.write(line + '\n')) {
  const emit = (level, msg, extra) =>
    sink(JSON.stringify({ ts: new Date().toISOString(), level, scope, msg, ...(extra || {}) }));
  return {
    info: (msg, extra) => emit('info', msg, extra),
    warn: (msg, extra) => emit('warn', msg, extra),
    error: (msg, extra) => emit('error', msg, extra),
    child: (sub) => createLogger(`${scope}.${sub}`, sink),
  };
}
export const silentLogger = createLogger('test', () => {});
