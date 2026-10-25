const question = {
  name: 'codex_ask_readonly',
  description: 'Ask Mac Codex a read-only question in the voice fixture. Returns a taskId; poll codex_task_status for output. Cannot modify files or control desktop chats.',
  inputSchema: {type: 'object', properties: {
    prompt: {type: 'string', minLength: 1, maxLength: 12000}, requestId: {type: 'string', minLength: 1, maxLength: 96},
  }, required: ['prompt', 'requestId'], additionalProperties: false},
};

export function createLinxDispatcher({service, createMcpDispatcher, onCall = () => {}}) {
  const adapter = Object.fromEntries(['status', 'listTasks', 'getTask', 'startTask', 'getLogs', 'cancelTask'].map(key => [key, (...args) => service[key](...args)]));
  const base = createMcpDispatcher({adapter, projectRegistry: service,
    serverInfo: {name: 'Local Mac Codex acceptance', version: '1.1.0'},
    authorizeWrite: ({tool}) => ['codex_start_task', 'codex_cancel_task'].includes(tool),
  });
  const tools = [...base.tools, question];
  tools.find(tool => tool.name === 'codex_start_task').description = 'Create a draft in a registered fixture project. Write execution requires a separate local owner confirmation through the private Unix socket.';
  async function dispatch(message, context) {
    if (message?.method === 'tools/call') onCall(message.params?.name);
    if (message?.jsonrpc === '2.0' && message.id !== undefined && message.method === 'tools/list') return {jsonrpc: '2.0', id: message.id, result: {tools}};
    if (message?.method !== 'tools/call' || message.params?.name !== question.name) return base.dispatch(message, context);
    const fail = (code, text) => ({jsonrpc: '2.0', id: message.id ?? null, error: {code, message: text}});
    if (message.jsonrpc !== '2.0' || !['string', 'number'].includes(typeof message.id)) return fail(-32600, 'Invalid Request');
    const args = message.params.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !['prompt', 'requestId'].includes(key)) ||
      typeof args.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 12000 ||
      typeof args.requestId !== 'string' || !args.requestId.trim() || args.requestId.length > 96) return fail(-32602, 'Invalid arguments');
    try {
      const {taskId} = await service.startTask({projectId: 'voice', title: 'Linx read-only question',
        prompt: `This is a read-only voice request. Answer without modifying files.\n\n${args.prompt}`, requestId: `ask:${args.requestId}`});
      let task = await service.getTask(taskId);
      if (task.status === 'draft') task = await service.confirmTask(taskId, {revision: task.revision, requestId: `run:${args.requestId}`});
      return {jsonrpc: '2.0', id: message.id, result: {content: [{type: 'text', text: JSON.stringify({taskId, status: task.status, output: task.output ?? '', mode: 'read-only'})}], isError: false}};
    } catch (error) {
      return fail(-32000, error.code === 'busy' ? 'A task is running; retry later with the same requestId.' : 'Read-only question failed; check task status.');
    }
  }
  return {tools, dispatch};
}
