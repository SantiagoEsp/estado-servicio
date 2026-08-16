import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../.github/workflows/codeql.yml', import.meta.url), 'utf8');

test('CodeQL analiza main y PR, pero nunca la rama de datos', () => {
  assert.match(source, /push:\s*\n\s+branches:\s*\n\s+- main\s*\n(?:\s*#.*\n)*\s+- ['"]!status-data['"]/);
  assert.match(source, /pull_request:\s*\n\s+branches:\s*\n\s+- main/);
  assert.match(source, /language:\s*\n\s+- actions\s*\n\s+- javascript-typescript/);
});

test('los checks conservan los contextos exigidos por main', () => {
  assert.match(source, /name: Analyze \(\$\{\{ matrix\.language \}\}\)/);
  assert.match(source, /category: \/language:\$\{\{ matrix\.language \}\}/);
});

test('todas las acciones están fijadas por SHA', () => {
  const uses = [...source.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
  assert.ok(uses.length >= 3);
  for (const action of uses) assert.match(action, /^[^@]+@[a-f0-9]{40}$/);
});
