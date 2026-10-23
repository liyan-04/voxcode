import { resolve } from 'node:path';
import { createServer } from '../mac/server.mjs';
import { createVoiceHandler } from './voice.mjs';

if (!process.env.VOXCODE_PROJECT) throw new Error('Set VOXCODE_PROJECT to an authorized Git checkout');
const fields = ['LINX_TOKEN', 'LINX_DEVICE_ID', 'LINX_CLIENT_ID'];
const configured = fields.filter(key => process.env[key]);
if (configured.length && configured.length !== fields.length) throw new Error('Configure all Linx credential fields or none');
const config = configured.length ? {
  url: process.env.LINX_WS_URL ?? 'wss://xrobo-io.qiniuapi.com/v1/ws/',
  token: process.env.LINX_TOKEN, deviceId: process.env.LINX_DEVICE_ID, clientId: process.env.LINX_CLIENT_ID,
} : null;
const voiceHandler = createVoiceHandler({ config });
const app = createServer({ project: resolve(process.env.VOXCODE_PROJECT), dataDir: resolve(process.env.VOXCODE_DATA ?? '.voxcode'), ...(config ? { voiceHandler } : {}) });
app.server.listen(Number(process.env.VOXCODE_PORT ?? 8787), '127.0.0.1', () => {
  console.log(`VoxCode Mac bridge: http://127.0.0.1:${app.server.address().port}`);
  console.log(`Pairing code (5 minutes): ${app.service.pairCode}`);
  console.log(`Linx AI: ${config ? 'configured, live onboarding unverified' : 'not configured'}`);
  if (app.service.recovery?.().required) console.error('Execution quarantined after an unconfirmed previous run; see apps/mac/README.md for explicit local recovery.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  voiceHandler.close();
  app.close().then(() => process.exit(0));
});
