import {createConnector} from './connector.mjs';

try {
  const connector = createConnector({machineId:process.env.VOXCODE_MACHINE_ID,machineKey:process.env.VOXCODE_MACHINE_KEY,relayURL:process.env.VOXCODE_RELAY_URL,bridgeURL:process.env.VOXCODE_BRIDGE_URL ?? 'http://127.0.0.1:8787',onStatus:status=>console.log(`VoxCode connector: ${status}`)});
  void connector.start().catch(()=>{console.error('Connector stopped before connecting');});
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{await connector.close();});
} catch { console.error('Connector configuration invalid; check relay URL, loopback bridge URL, machine ID and strong key'); process.exitCode = 1; }
