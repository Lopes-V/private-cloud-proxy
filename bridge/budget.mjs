import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';

export class Budget {
  constructor({ limit = 128 * 1024 * 1024, file, month = new Date().toISOString().slice(0, 7) } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid budget');
    this.limit = limit; this.file = file; this.month = month; this.used = 0;
    if (file && fs.existsSync(file)) {
      const old = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!/^\d{4}-\d{2}$/.test(old.month) || !Number.isSafeInteger(old.used) || old.used < 0 || old.month > month) throw new Error('Invalid usage ledger');
      if (old.month === month) this.used = old.used;
    }
  }
  consume(bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.used + bytes > this.limit) throw new Error('Traffic limit reached');
    this.used += bytes;
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ month: this.month, used: this.used }), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    }
  }
}

export function meter(consume, activity = () => {}) {
  return new Transform({ transform(chunk, encoding, done) {
    try { consume(chunk.length); activity(); done(null, chunk); } catch { done(new Error('Traffic limit reached')); }
  }});
}
