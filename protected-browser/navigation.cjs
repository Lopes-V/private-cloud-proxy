'use strict';

// Only HTTP(S) navigation is allowed. This does not grant a direct-network
// fallback: the web session itself is configured with a fixed local proxy.
function normalizeAddress(value) {
  if (typeof value !== 'string') throw new Error('Invalid address');
  const raw = value.trim();
  if (!raw || raw.length > 2048 || /[\x00-\x1f\x7f]/.test(raw))
    throw new Error('Invalid address');
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw;
  const parsed = new URL(candidate);
  if (!['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname || parsed.username || parsed.password)
    throw new Error('Only public HTTP(S) pages are supported');
  return parsed.href;
}

function proxyPort(raw) {
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
    throw new Error('Invalid local proxy port');
  return port;
}

module.exports = { normalizeAddress, proxyPort };
