import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { appendFileSync } from 'node:fs';

const envPath = process.argv[2];
const names = process.argv.slice(3);

let out = '\n';
for (const name of names) {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  out += `${name}_ADDRESS=${account.address}\n${name}_PRIVATE_KEY=${pk}\n`;
  console.log(`${name}_ADDRESS=${account.address}`);
}
appendFileSync(envPath, out);
