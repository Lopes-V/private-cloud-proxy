import net from 'node:net';

// All candidates have already passed the DNS policy. This lookup is a pinned
// snapshot: Node's family/address selection must never resolve the name again.
export function connectPinned(addresses, port) {
  if (!Array.isArray(addresses) || !addresses.length || addresses.some(address=>!net.isIP(address))) throw new Error('Invalid resolved addresses');
  return net.createConnection({
    host: 'validated.invalid', port, autoSelectFamily: true,
    lookup(_host, options, callback) {
      const rows=addresses.map(address=>({address,family:net.isIP(address)}));
      if (options.all) callback(null, rows);
      else callback(null, rows[0].address, rows[0].family);
    }
  });
}
