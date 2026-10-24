import {createRelay} from './relay.mjs';
import {readFileSync} from 'node:fs';

try {
  const certPath=process.env.VOXCODE_TLS_CERT,keyPath=process.env.VOXCODE_TLS_KEY;
  if(Boolean(certPath)!==Boolean(keyPath))throw new Error('Both certificate and key are required');
  const tls=certPath?{cert:readFileSync(certPath),key:readFileSync(keyPath)}:undefined;
  const host=process.env.VOXCODE_RELAY_HOST??'127.0.0.1';
  if(!tls&&!['localhost','127.0.0.1','::1'].includes(host))throw new Error('Remote listeners require TLS');
  const port = Number(process.env.VOXCODE_RELAY_PORT ?? 8788);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid relay port');
  const relay = createRelay({machineId:process.env.VOXCODE_MACHINE_ID,machineKey:process.env.VOXCODE_MACHINE_KEY,tls});
  relay.server.once('error',() => { console.error('Relay failed to listen'); process.exitCode = 1; void relay.close(); });
  relay.server.listen(port,host,() => { console.log(`VoxCode relay ${tls?'HTTPS':'HTTP loopback development'} listening on port ${port}`); });
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{await relay.close();});
} catch { console.error('Relay configuration invalid; check machine ID, strong key, listener and TLS file paths'); process.exitCode = 1; }
