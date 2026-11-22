import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const marker = path.join(root, 'UPDATE_BLOCK');
const action = process.argv[2];

if (action === 'block') {
  fs.writeFileSync(marker, '');
  console.log('UPDATE_BLOCK created');
} else if (action === 'unblock') {
  try {
    fs.unlinkSync(marker);
    console.log('UPDATE_BLOCK removed');
  } catch {
    console.log('UPDATE_BLOCK is not present');
  }
} else {
  console.error('Usage: node scripts/update-block.mjs <block|unblock>');
  process.exitCode = 1;
}
