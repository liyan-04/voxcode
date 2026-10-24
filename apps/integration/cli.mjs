import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { startRuntime } from './runtime.mjs';

if (!process.env.VOXCODE_PROJECT) throw new Error('Set VOXCODE_PROJECT to an authorized Git checkout');
const fields = ['LINX_TOKEN', 'LINX_DEVICE_ID', 'LINX_CLIENT_ID'];
const configured = fields.filter(key => process.env[key]);
if (configured.length && configured.length !== fields.length) throw new Error('Configure all Linx credential fields or none');
const config = configured.length ? {
  url: process.env.LINX_WS_URL ?? 'wss://xrobo-io.qiniuapi.com/v1/ws/',
  token: process.env.LINX_TOKEN, deviceId: process.env.LINX_DEVICE_ID, clientId: process.env.LINX_CLIENT_ID,
} : null;
const runtime = await startRuntime({ project: resolve(process.env.VOXCODE_PROJECT), dataDir: resolve(process.env.VOXCODE_DATA ?? '.voxcode'), voiceConfig: config,
  port: Number(process.env.VOXCODE_PORT ?? 8787), relayURL: process.env.VOXCODE_RELAY_URL,
  machineId: process.env.VOXCODE_MACHINE_ID, machineKey: process.env.VOXCODE_MACHINE_KEY,
  ca: process.env.VOXCODE_TLS_CA ? readFileSync(process.env.VOXCODE_TLS_CA) : undefined,
  onStatus: status => console.log(`VoxCode connector: ${status}`),
});
  console.log(`VoxCode Mac bridge: http://127.0.0.1:${runtime.app.server.address().port}`);
  console.log(`Pairing code (5 minutes): ${runtime.app.service.pairCode}`);
  console.log(`Linx AI: ${config ? 'configured, live onboarding unverified' : 'not configured'}`);
  if (runtime.app.service.recovery?.().required) console.error('Execution quarantined after an unconfirmed previous run; see apps/mac/README.md for explicit local recovery.');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  runtime.close().then(() => process.exit(0));
});
