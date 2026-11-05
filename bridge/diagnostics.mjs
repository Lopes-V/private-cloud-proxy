// Fixed vocabulary only: never serialize external Error messages or destinations.
export const failures = new Set(['DNS_FAILED','DNS_REJECTED','TCP_CONNECT_TIMEOUT','TCP_CONNECTION_REFUSED','NETWORK_UNREACHABLE','SESSION_LIMIT','SESSION_QUOTA','QUEUE_FULL','QUEUE_TIMEOUT','QUEUE_CANCELLED','IDLE_EVICTED','TRAFFIC_LIMIT','WSS_CONNECTION_FAILED','AUTH_FAILED','REMOTE_SOCKET_CLOSED','INTERNAL_ERROR']);
export function classify(stage, error) {
  if (failures.has(error?.failure)) return error.failure;
  if (stage === 'wss' || stage === 'opening_timeout') return 'WSS_CONNECTION_FAILED';
  if (stage === 'policy' || error?.code === 'DNS_REJECTED') return 'DNS_REJECTED';
  if (stage.startsWith('dns')) return 'DNS_FAILED';
  if (stage === 'tcp_timeout' || error?.code === 'ETIMEDOUT') return 'TCP_CONNECT_TIMEOUT';
  if (error?.code === 'ECONNREFUSED') return 'TCP_CONNECTION_REFUSED';
  if (['ENETUNREACH','EHOSTUNREACH'].includes(error?.code)) return 'NETWORK_UNREACHABLE';
  if (stage === 'connected' || error?.code === 'ECONNRESET') return 'REMOTE_SOCKET_CLOSED';
  return 'INTERNAL_ERROR';
}
export function report(diagnostic, stage, error, id, started) {
  const allowed = new Set(['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','ECONNRESET']);
  const event={stage,code:allowed.has(error?.code)?error.code:'OTHER',failure:classify(stage,error),id,durationMs:Math.max(0,Math.round(performance.now()-started))};
  try {diagnostic(event);} catch {}
  return event;
}
