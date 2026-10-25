import {readFile, lstat, chmod} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join, resolve, isAbsolute, relative, sep} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createLaunchPolicy} from './launch-policy.mjs';
import {createLinxDispatcher} from './linx-tools.mjs';

const within = (parent, file) => {const part = relative(parent, file); return !part || part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);};
export async function readConfiguration(file) {
  if (!isAbsolute(file ?? '') || resolve(file) !== file) throw Error('Absolute configuration path required');
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) || info.size > 65536) throw Error('Private owned configuration required');
  const config = JSON.parse(await readFile(file, 'utf8'));
  for (const key of ['runtimeRoot', 'connectionFile', 'command', 'codexHome', 'dataDir', 'socketPath']) {
    if (!isAbsolute(config[key] ?? '') || resolve(config[key]) !== config[key]) throw Error('Absolute runtime paths required');
  }
  if (!Number.isInteger(config.statusPort) || config.statusPort < 1024 || config.statusPort > 65535) throw Error('Invalid loopback port');
  createLaunchPolicy(config);
  if (!config.projects.some(p => p.id === 'voice' && p.sandbox === 'read-only' && p.enabled)) throw Error('Read-only voice fixture required');
  for (const project of config.projects) for (const protectedPath of [file, config.connectionFile, config.codexHome, config.runtimeRoot, config.dataDir, fileURLToPath(import.meta.url)]) {
    if (within(project.root, protectedPath)) throw Error('Credentials, state and runtime must stay outside projects');
  }
  return config;
}

export async function startBridge(config) {
  process.umask(0o077);
  const load = name => import(pathToFileURL(join(config.runtimeRoot, name)).href);
  const [{createCodexCliAdapter}, {createProjectService}, {createMcpProxyBridge}, {createMcpDispatcher}, {createTaskRpcServer}] = await Promise.all([
    load('codex-cli-adapter.mjs'), load('project-service.mjs'), load('mcp-proxy-bridge.mjs'), load('mcp-server.mjs'), load('task-rpc.mjs'),
  ]);
  const launch = createLaunchPolicy(config);
  const service = await createProjectService({projects: config.projects.map(({sandbox, ...project}) => project), dataDir: config.dataDir, command: config.command,
    adapterFactory: options => createCodexCliAdapter({...options, timeoutMs: 180000, spawnImpl: (binary, args, options) => {
      const allowed = launch(args, options); return spawn(binary, allowed.args, allowed.options);
    }}),
  });
  const connection = JSON.parse(await readFile(config.connectionFile, 'utf8'));
  const endpoint = new URL(connection.endpoint);
  if (endpoint.protocol !== 'wss:' || endpoint.hostname !== 'xrobo.qiniu.com' || endpoint.pathname !== '/v1/mcpproxy/connect' || !endpoint.searchParams.get('token')) throw Error('Official production MCP endpoint required');
  let connectionStatus = 'starting', calls = 0, lastCall = null;
  const startedAt = new Date().toISOString();
  const {dispatch, tools} = createLinxDispatcher({service, createMcpDispatcher, onCall: tool => {
    calls++; lastCall = {tool: tools.some(item => item.name === tool) ? tool : 'unknown', at: new Date().toISOString()};
  }});
  const rpc = await createTaskRpcServer({socketPath: config.socketPath, adapter: service});
  await chmod(config.socketPath, 0o600);
  const bridge = createMcpProxyBridge({endpoint: endpoint.href, dispatch, onStatus: state => {
    connectionStatus = state; console.log(JSON.stringify({event: 'connection', state, at: new Date().toISOString()}));
  }});
  const status = async () => ({name: 'Local Mac Codex acceptance', connectionStatus, startedAt, pid: process.pid,
    cli: await service.status(), calls, lastCall, tools: tools.map(tool => tool.name),
    projects: config.projects.map(({id, sandbox}) => ({id, sandbox})), writeConfirmation: 'private local Unix socket',
  });
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' || request.url !== '/status') {response.writeHead(404); return response.end();}
    try {response.writeHead(200, {'content-type': 'application/json', 'cache-control': 'no-store'}); response.end(JSON.stringify(await status()));}
    catch {response.writeHead(503); response.end('{"error":"Status unavailable"}');}
  });
  try {await new Promise((ready, reject) => {server.once('error', reject); server.listen(config.statusPort, '127.0.0.1', ready);});}
  catch (error) {await rpc.close(); throw error;}
  bridge.start();
  let stopping = false;
  return {service, status, async close() {
    if (stopping) return;
    stopping = true;
    await bridge.close(); await rpc.close();
    for (const project of config.projects) for (const task of await service.listTasks({projectId: project.id})) {
      if (['running', 'cancelling'].includes(task.status)) await service.cancelTask(task.id);
    }
    await new Promise(done => server.close(done));
  }};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const runtime = await startBridge(await readConfiguration(process.argv[2]));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      const deadline = setTimeout(() => process.exit(1), 14000);
      runtime.close().then(() => {clearTimeout(deadline); process.exit(0);}, () => process.exit(1));
    });
  } catch {console.error('Mac acceptance bridge startup failed; inspect private configuration and owned endpoints.'); process.exitCode = 1;}
}
