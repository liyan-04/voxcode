import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runLinxSmoke } from './lib/linx-smoke.mjs';

const help = `Usage: node [--env-file=<private-env-file>] scripts/smoke-linx.mjs --input <synthetic.pcm> --synthetic [options]

Uses an already running authenticated local Mac bridge. Starts one real voice session only on explicit invocation.
Input must be caller-provided synthetic 16 kHz mono s16le raw PCM, 1 sample to 60 seconds (no WAV header).
No microphone capture, task submission, approval, acceptance, audio playback, or raw payload logging.

Required environment: VOXCODE_SESSION_TOKEN (existing pairing bearer).
Optional environment: VOXCODE_BRIDGE_URL (default http://127.0.0.1:8787).
Token values are never accepted as CLI arguments. Protect any env file with mode 600.

Options:
  --input <path>           Existing synthetic raw PCM file
  --synthetic              Confirm synthetic-only content and the stated PCM format
  --deadline-ms <1..120000> Overall HTTP/upload/poll deadline (default 90000)
  --request-timeout-ms <1..15000> Per HTTP request timeout (default 10000)
  --max-polls <1..600>      Event poll limit (default 180, 500 ms interval)
  --help                   Show help without reading input or making HTTP requests

Emits one fixed redacted JSON report. Exit 0 requires ready/STT/draft/audio observations and confirmed cleanup.
Tool behavior and audible playback remain manual; local HTTP observations never certify a live provider.
`;

export async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(help); return 0; }
  const options = { token: env.VOXCODE_SESSION_TOKEN, origin: env.VOXCODE_BRIDGE_URL ?? 'http://127.0.0.1:8787' };
  const keys = { '--input': 'input', '--deadline-ms': 'deadlineMs', '--request-timeout-ms': 'requestTimeoutMs', '--max-polls': 'maxPolls' };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (seen.has(arg) || (arg !== '--synthetic' && !Object.hasOwn(keys, arg))) {
      process.stdout.write('{"passed":false,"reason":"invalid_arguments"}\n'); return 1;
    }
    seen.add(arg);
    if (arg === '--synthetic') { options.synthetic = true; continue; }
    const value = args[++index];
    if (value === undefined || (arg !== '--input' && !/^\d+$/.test(value))) {
      process.stdout.write('{"passed":false,"reason":"invalid_arguments"}\n'); return 1;
    }
    options[keys[arg]] = arg === '--input' ? value : Number(value);
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try {
    const result = await runLinxSmoke({ ...options, signal: controller.signal });
    process.stdout.write(JSON.stringify(result) + '\n');
    return result.passed ? 0 : 1;
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    process.stdout.write('{"passed":false,"reason":"local_error"}\n'); process.exitCode = 1;
  });
}
