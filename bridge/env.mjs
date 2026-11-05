import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));

export function loadProjectEnv() {
  if (!fs.existsSync(envFile)) return;
  const inherited = new Map(Object.entries(process.env));
  process.loadEnvFile(envFile);
  for (const [name, value] of inherited) process.env[name] = value;
}
