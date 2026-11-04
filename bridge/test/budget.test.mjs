import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('budget persists consumption and fails closed if corrupted', async () => {
  assert.ok(fs.existsSync(new URL('../budget.mjs', import.meta.url)), 'budget implementation missing');
  const { Budget } = await import('../budget.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-budget-'));
  try {
    const file = path.join(dir, 'usage.json');
    const first = new Budget({ limit: 100, file });
    first.consume(60);
    const next = new Budget({ limit: 100, file });
    assert.equal(next.used, 60);
    assert.throws(() => next.consume(41));
    fs.writeFileSync(file, 'corrupt');
    assert.throws(() => new Budget({ limit: 100, file }));
  } finally { fs.rmSync(dir, { recursive: true }); }
});
