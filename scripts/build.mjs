import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';

try {
  await rm(resolve(process.cwd(), 'dist'), { recursive: true, force: true });
  await build();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
