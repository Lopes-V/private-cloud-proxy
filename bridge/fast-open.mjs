import crypto from 'node:crypto';

const AAD = Buffer.from('private-cloud-proxy/fast-open/v1', 'utf8');
const SALT = Buffer.from('pcp-tunnel-single-user-v1', 'utf8');
const CONTEXT = Buffer.from('tunnel-destination-header', 'utf8');

// Authenticated encryption keeps requested hostnames out of plaintext HTTP
// upgrade headers, which could otherwise be captured by an intermediary.
function deriveKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32)
    throw new Error('Invalid tunnel secret');
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), SALT, CONTEXT, 32));
}

export function sealFastOpen(secret, host, port) {
  if (typeof host !== 'string' || host.length < 1 || host.length > 253 ||
      !Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid destination');
  const plain = Buffer.from(JSON.stringify({ host, port }), 'utf8');
  if (plain.length > 512) throw new Error('Destination too large');
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret), nonce);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function openFastOpen(secret, value) {
  if (typeof value !== 'string' || value.length < 40 ||
      value.length > 750 || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error('Invalid fast-open header');
  const data = Buffer.from(value, 'base64url');
  if (data.length < 29 || data.length > 540) throw new Error('Invalid fast-open size');
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret), data.subarray(0, 12));
  decipher.setAAD(AAD);
  decipher.setAuthTag(data.subarray(12, 28));
  const decoded = JSON.parse(Buffer.concat([
    decipher.update(data.subarray(28)), decipher.final()
  ]).toString('utf8'));
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded) ||
      Object.keys(decoded).length !== 2 ||
      typeof decoded.host !== 'string' || decoded.host.length < 1 || decoded.host.length > 253 ||
      !Number.isSafeInteger(decoded.port) || decoded.port < 1 || decoded.port > 65535)
    throw new Error('Invalid fast-open destination');
  return { host: decoded.host, port: decoded.port };
}
