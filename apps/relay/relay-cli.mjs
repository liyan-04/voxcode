import {createRelay} from './relay.mjs';

try {
  const relay = createRelay({machineId:process.env.VOXCODE_MACHINE_ID,machineKey:process.env.VOXCODE_MACHINE_KEY});
  const port = Number(process.env.VOXCODE_RELAY_PORT ?? 8788);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid relay port');
  relay.server.once('error',() => { console.error('Relay failed to listen'); process.exitCode = 1; void relay.close(); });
  relay.server.listen(port,process.env.VOXCODE_RELAY_HOST ?? '127.0.0.1',() => { console.log(`VoxCode relay listening on port ${port}; TLS reverse proxy required for remote access`); });
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{await relay.close();});
} catch { console.error('Relay configuration invalid; check machine ID, strong key and port'); process.exitCode = 1; }
