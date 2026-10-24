import { createServer } from '../mac/server.mjs';
import { createConnector } from '../relay/connector.mjs';
import { createVoiceHandler } from './voice.mjs';

export async function startRuntime(options) {
  const port = options.port ?? 8787;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid Mac bridge port');
  const relayFields = [options.relayURL, options.machineId, options.machineKey];
  const remote = relayFields.some(value => value !== undefined);
  if (remote && relayFields.some(value => typeof value !== 'string' || !value)) throw new Error('Incomplete relay configuration');
  const voiceHandler = options.voiceConfig ? createVoiceHandler({ config: options.voiceConfig }) : null;
  const app = createServer({ project: options.project, dataDir: options.dataDir, ...(voiceHandler ? { voiceHandler } : {}) });
  let connector, closing;
  const close = () => {
    if (!closing) closing = (async () => { await connector?.close(); voiceHandler?.close(); await app.close(); })();
    return closing;
  };
  try {
    await new Promise((resolve, reject) => {
      const error = reason => reject(reason);
      app.server.once('error', error);
      app.server.listen(port, '127.0.0.1', () => { app.server.removeListener('error', error); resolve(); });
    });
    if (remote) {
      connector = createConnector({ relayURL: options.relayURL, machineId: options.machineId, machineKey: options.machineKey,
        ca: options.ca, bridgeURL: `http://127.0.0.1:${app.server.address().port}`, onStatus: options.onStatus });
      void connector.start().catch(() => options.onStatus?.('offline'));
    }
    return { app, connector, close };
  } catch (error) { await close(); throw error; }
}
