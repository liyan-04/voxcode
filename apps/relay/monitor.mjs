import {performance} from 'node:perf_hooks';

const countKeys=['queued','running','waiting_approval','waiting_input','stopping','interrupted','failed','completed','accepted'];
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const integer=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const duration=value=>Number.isFinite(value)&&value>=0;

// Project the documented aggregate fields; never forward arbitrary bridge JSON.
export function monitorSnapshot(body,contentType) {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType)) throw new Error('Invalid monitor');
  const value=JSON.parse(body.toString('utf8'));
  if (!record(value)||typeof value.generatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.generatedAt)||!Number.isFinite(Date.parse(value.generatedAt))||!duration(value.uptimeSeconds)||!integer(value.executionLimit,1,8)||!integer(value.maxTasks,1)||!integer(value.activeExecutions,0,8)||typeof value.recoveryRequired!=='boolean'||!record(value.counts)||!record(value.memory)) throw new Error('Invalid monitor');
  const counts={};
  for (const key of countKeys) {
    if (!integer(value.counts[key],0,value.maxTasks)) throw new Error('Invalid monitor');
    counts[key]=value.counts[key];
  }
  if (!integer(value.memory.rssBytes)||!integer(value.memory.heapUsedBytes)) throw new Error('Invalid monitor');
  const result={generatedAt:value.generatedAt,uptimeSeconds:value.uptimeSeconds,executionLimit:value.executionLimit,maxTasks:value.maxTasks,activeExecutions:value.activeExecutions,recoveryRequired:value.recoveryRequired,counts,memory:{rssBytes:value.memory.rssBytes,heapUsedBytes:value.memory.heapUsedBytes}};
  if (value.readiness!==undefined) {
    if (!record(value.readiness)||typeof value.readiness.codexAvailable!=='boolean'||typeof value.readiness.voiceConfigured!=='boolean') throw new Error('Invalid monitor');
    result.readiness={codexAvailable:value.readiness.codexAvailable,voiceConfigured:value.readiness.voiceConfigured};
  }
  return result;
}

export function createMonitorMetrics() {
  const started=performance.now(),samples=[];
  let requestsTotal=0,responsesTotal=0,errorsTotal=0,timeoutsTotal=0;
  return {
    track(res) {
      const ingress=performance.now();
      res.once('finish',()=>{
        requestsTotal++;
        if (res.statusCode>=400) errorsTotal++; else responsesTotal++;
        if (res.statusCode===504) timeoutsTotal++;
        samples.push(Math.max(0,performance.now()-ingress));
        if (samples.length>128) samples.shift();
      });
    },
    snapshot(connected,inFlight) {
      const sorted=[...samples].sort((a,b)=>a-b);
      const percentile=percent=>sorted.length?sorted[Math.ceil(sorted.length*percent)-1]:null;
      return {connected,uptimeSeconds:Math.max(0,(performance.now()-started)/1000),inFlight,requestsTotal,responsesTotal,errorsTotal,timeoutsTotal,latencySamples:sorted.length,latencyP50Ms:percentile(0.5),latencyP95Ms:percentile(0.95)};
    },
  };
}
