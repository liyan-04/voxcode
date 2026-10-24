import { preflight, checkedRuntimePaths, relayOptions, voiceOptions, bridgePort, readCA } from './preflight.mjs';

const [mode, ...extra] = process.argv.slice(2);
const showPairingCode = mode === 'start' && extra.length === 1 && extra[0] === '--show-pairing-code';
if (!['preflight', 'start'].includes(mode) || (extra.length && !showPairingCode)) {
  console.error('Usage: node apps/server/cli.mjs preflight|start [--show-pairing-code] (private environment file)');
  process.exitCode = 2;
} else if (showPairingCode && !process.stderr.isTTY) {
  console.error('Pairing code requires an explicit private terminal (stderr TTY)');
  process.exitCode = 1;
} else {
  try {
    const report = await preflight();
    if (mode === 'preflight') {
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
    } else if (!report.ok) {
      console.error('Server preflight blocked; run the preflight command for redacted checks');
      process.exitCode = 1;
    } else {
      // Deliberately load the existing runtime only after the read-only checks.
      const { startRuntime } = await import('../integration/runtime.mjs');
      const runtime = await startRuntime({ ...checkedRuntimePaths(report),
        ...relayOptions(process.env), ca: await readCA(process.env), port: bridgePort(process.env), voiceConfig: voiceOptions(process.env),
        onStatus: status => { if (['connecting', 'connected', 'offline', 'closed', 'connection_error', 'connection_timeout'].includes(status)) console.log(`Server connector: ${status}`); },
      });
      console.log(`Server bridge listening on 127.0.0.1:${runtime.app.server.address().port}; Relay runs separately`);
      console.log('Configured providers remain live-unverified; private terminal pairing is opt-in');
      if (showPairingCode) process.stderr.write(`Pairing code (5 minutes): ${runtime.app.service.pairCode}\n`);
      if (runtime.app.service.recovery?.().required) console.error('Execution quarantined; see apps/mac/README.md for explicit local recovery');
      let closing = false;
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
        if (closing) return;
        closing = true;
        const timeout = setTimeout(() => { console.error('Server shutdown timed out; verify owned executions before recovery'); process.exit(1); }, 15000);
        runtime.close().then(() => { clearTimeout(timeout); process.exit(0); }, () => {
          console.error('Server shutdown failed; verify owned executions before recovery'); process.exit(1);
        });
      });
    }
  } catch {
    console.error('Server startup failed; check dependencies, private configuration, port and recovery state');
    process.exitCode = 1;
  }
}
