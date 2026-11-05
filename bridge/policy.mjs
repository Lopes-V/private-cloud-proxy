import dns from 'node:dns/promises';
import net from 'node:net';
import ipaddr from 'ipaddr.js';
import specials from './data/iana-special.json' with {type:'json'};
const denied = specials.entries.flatMap(entry=>entry.prefixes.map(prefix=>ipaddr.parseCIDR(prefix)));

export function isPublic(address) {
  try {
    // Only native, globally routable unicast. Reject transition/mapped formats.
    const ip = ipaddr.parse(address);
    return !address.includes('%') && ip.range() === 'unicast' && !denied.some(([network,bits])=>network.kind()===ip.kind() && ip.match(network,bits));
  } catch { return false; }
}

export function target(host, port, ports = new Set([80, 443])) {
  if (typeof host !== 'string' || !host || host.length > 253 || /[\s/@?#\\\x00-\x1f]/.test(host) || !ports.has(port)) throw new Error('Destination denied');
  if (!net.isIP(host) && !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) throw new Error('Invalid hostname');
  return { host, port };
}

export async function resolvePublicAddresses(host, lookup = dns.lookup) {
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(row => !isPublic(row.address))) throw Object.assign(new Error('Destination denied'), {code:'DNS_REJECTED'});
  // Validate the entire snapshot before making any candidate available.
  return [...new Set(addresses.map(row => row.address))].sort((a,b)=>net.isIP(a)-net.isIP(b));
}

export async function resolvePublic(host, lookup = dns.lookup) {
  return (await resolvePublicAddresses(host, lookup))[0];
}
