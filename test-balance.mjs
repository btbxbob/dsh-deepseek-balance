// Standalone check of the balance flow: resolve the stored key, call the
// DeepSeek /user/balance endpoint, print the balance. Never prints the key.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const home = homedir();
const credPath = join(home, '.dsh', '.credentials.yaml');
let key = process.env.DEEPSEEK_API_KEY ?? '';
if (!key) {
  try {
    const raw = readFileSync(credPath, 'utf8');
    const m = raw.match(/^DEEPSEEK_API_KEY:\s*(\S+)\s*$/m);
    if (m) key = m[1].replace(/^["']|["']$/g, '');
  } catch {
    console.error('credentials file not readable:', credPath);
  }
}
if (!key) {
  console.error('NO KEY: set DEEPSEEK_API_KEY env or add it to ' + credPath);
  process.exit(2);
}
const res = await fetch('https://api.deepseek.com/user/balance', {
  headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
  signal: AbortSignal.timeout(15000),
});
console.log('HTTP', res.status);
const body = await res.json();
if (res.ok && body) {
  console.log('is_available:', body.is_available);
  for (const info of body.balance_infos ?? []) {
    console.log('currency:', info.currency);
    console.log('total_balance:', info.total_balance);
    console.log('granted_balance:', info.granted_balance);
    console.log('topped_up_balance:', info.topped_up_balance);
  }
} else {
  console.log(JSON.stringify(body));
}
