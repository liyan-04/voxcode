import { randomUUID } from 'node:crypto';

const string = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
    throw new Error('Invalid voice tool arguments');
}
function conditions(value) {
  if (value === undefined) return [{ text: 'Confirm the requested result against the current evidence', required: true }];
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) throw new Error('Invalid draft criteria');
  return value.map(item => {
    object(item, ['text', 'required']);
    if (!string(item.text, 500) || (item.required !== undefined && typeof item.required !== 'boolean')) throw new Error('Invalid draft criterion');
    return { text: item.text.trim(), required: item.required ?? true };
  });
}

export function createVoiceTools({ entry, service, emit }) {
  const guard = () => {
    if (entry.closed || Date.now() >= entry.expiresAt) throw new Error('Voice session expired');
    service.authorize?.(`Bearer ${entry.owner}`);
  };
  const target = id => {
    if (!string(id, 128) || (entry.taskId !== null && id !== entry.taskId)) throw new Error('Voice target is frozen');
    const task = service.get(id);
    if (entry.taskId !== null && task.version !== entry.version) throw new Error('Voice target version changed');
    return task;
  };
  const textSchema = maxLength => ({ type: 'string', minLength: 1, maxLength });
  const criteriaSchema = { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', additionalProperties: false,
    properties: { text: textSchema(500), required: { type: 'boolean' } }, required: ['text'] } };
  const tool = (name, description, properties, required, run) => ({ name, description,
    inputSchema: { type: 'object', additionalProperties: false, properties, required },
    invoke(args) { guard(); object(args, Object.keys(properties)); return run(args); },
  });
  const propose = (args, followup) => {
    if (followup !== (entry.taskId !== null)) throw new Error('Draft must use the frozen target');
    const task = followup ? target(entry.taskId) : null;
    if (!string(args.prompt, 12000) || (!followup && !string(args.title, 120)) || (args.title !== undefined && !string(args.title, 120)))
      throw new Error('Invalid draft text');
    if (entry.drafts.size >= 16) throw new Error('Draft limit reached');
    const draft = { id: randomUUID(), taskId: entry.taskId, version: entry.version, title: args.title?.trim() ?? task.title,
      prompt: args.prompt.trim(), criteria: conditions(args.criteria), expiresAt: new Date(Math.min(entry.expiresAt, Date.now() + 90000)).toISOString() };
    entry.drafts.set(draft.id, draft);
    emit({ type: 'draft', draft });
    return structuredClone(draft);
  };
  const taskId = { taskId: textSchema(128) };
  return [
    tool('list_tasks', 'List task IDs, titles and actual execution states in the paired project.', {}, [], () => ({
      tasks: service.list().slice(0, 32).map(task => ({ id: task.id, title: task.title, status: task.status, version: task.version })),
    })),
    tool('get_task_status', 'Read actual state of the frozen task; do not infer progress percentages.', taskId, ['taskId'], args => {
      const task = target(args.taskId);
      return { id: task.id, title: task.title, status: task.status, acceptance: task.acceptance, version: task.version, summary: task.summary };
    }),
    tool('get_task_evidence', 'Read bounded current-version evidence; unverified results are not passing tests.', taskId, ['taskId'], args => {
      const task = target(args.taskId);
      return { taskId: task.id, version: task.version, evidence: task.evidence.filter(item => item.version === task.version).slice(-16) };
    }),
    tool('propose_task', 'Suggest a new task draft. Only the phone user can confirm execution.',
      { title: textSchema(120), prompt: textSchema(12000), criteria: criteriaSchema }, ['title', 'prompt'], args => propose(args, false)),
    tool('propose_followup', 'Suggest a follow-up draft for the frozen task/version. Never execute or approve it.',
      { title: textSchema(120), prompt: textSchema(12000), criteria: criteriaSchema }, ['prompt'], args => propose(args, true)),
    tool('propose_focus', 'Suggest a task to inspect. This does not change the recording target or switch the phone page.', taskId, ['taskId'], args => {
      const task = target(args.taskId);
      emit({ type: 'focus', taskId: task.id });
      return { taskId: task.id, suggested: true };
    }),
  ];
}
