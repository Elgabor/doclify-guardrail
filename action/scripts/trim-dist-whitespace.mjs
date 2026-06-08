import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const targets = ['index.mjs', 'licenses.txt'];

for (const target of targets) {
  const filePath = path.join(distDir, target);
  if (!fs.existsSync(filePath)) continue;
  const original = fs.readFileSync(filePath, 'utf8');
  const trimmed = original.replace(/[ \t]+$/gm, '');
  if (trimmed !== original) {
    fs.writeFileSync(filePath, trimmed, 'utf8');
  }
}
