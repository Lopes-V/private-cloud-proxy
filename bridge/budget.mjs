import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';

// Persist a conservative high-water mark rather than every network chunk.
// Unused reserved bytes count as spent after a restart: never undercount traffic.
const DEFAULT_RESERVATION_BYTES = 256 * 1024;

export class Budget {
  constructor({ limit = 128 * 1024 * 1024, file, month = new Date().toISOString().slice(0, 7),
    reservationBytes = DEFAULT_RESERVATION_BYTES } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid budget');
    if (!Number.isSafeInteger(reservationBytes) || reservationBytes < 1) throw new Error('Invalid reservation');
    this.limit = limit; this.file = file; this.month = month; this.reservationBytes = reservationBytes;
    this.used = 0; this.reserved = 0;
    if (file && fs.existsSync(file)) {
      const old = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!/^\d{4}-\d{2}$/.test(old.month) || !Number.isSafeInteger(old.used) ||
        old.used < 0 || old.used > limit || old.month > month) throw new Error('Invalid usage ledger');
      if (old.month === month) this.used = this.reserved = old.used;
    }
  }
  consume(bytes) {
    const next = this.used + bytes;
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(next) || next > this.limit) {
      throw new Error('Traffic limit reached');
    }
    if (this.file && next > this.reserved) {
      // Small test/user-defined limits retain exact accounting. Larger limits
      // reserve chunks up front to avoid sync filesystem I/O per network frame.
      const step = this.limit >= 2 * this.reservationBytes ? this.reservationBytes : 1;
      const watermark = Math.min(this.limit, Math.ceil(next / step) * step);
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(tmp, JSON.stringify({ month: this.month, used: watermark }), { mode: 0o600 });
        fs.renameSync(tmp, this.file);
      } catch (error) {
        try { fs.unlinkSync(tmp); } catch {}
        throw error; // Never allow unrecorded traffic if persistence fails.
      }
      this.reserved = watermark;
    }
    this.used = next;
  }
}

export function meter(consume, activity = () => {}) {
  return new Transform({ transform(chunk, encoding, done) {
    try { consume(chunk.length); activity(); done(null, chunk); } catch { done(new Error('Traffic limit reached')); }
  }});
}
