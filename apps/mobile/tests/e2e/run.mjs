#!/usr/bin/env node
// Run a step file against the installed Baton app in a booted simulator (or device id).
// Usage: node tests/e2e/run.mjs <steps.json> <out-dir> [destination-id | android[:serial]]
// iOS builds the UI-test bundle on first use (tests/e2e/build, git-ignored), then runs
// test-without-building with the steps passed through TEST_RUNNER_ environment variables.
// "android" drives a USB device or emulator through adb instead (tests/e2e/android.mjs).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [stepsArg, outArg, idArg] = process.argv.slice(2);
if (!stepsArg || !outArg) {
  console.error('usage: node tests/e2e/run.mjs <steps.json> <out-dir> [destination-id | android[:serial]]');
  process.exit(2);
}
const steps = resolve(stepsArg), out = resolve(outArg);
mkdirSync(out, { recursive: true });
if (idArg === 'android' || idArg?.startsWith('android:')) {
  const { runAndroid } = await import('./android.mjs');
  process.exit(await runAndroid(steps, out, idArg.slice('android:'.length) || undefined));
}
const booted = spawnSync('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], { encoding: 'utf8' });
const device = idArg || Object.values(JSON.parse(booted.stdout).devices).flat().find((item) => item.state === 'Booted')?.udid;
if (!device) { console.error('No booted simulator; boot one or pass a destination id.'); process.exit(2); }
const derived = join(here, 'build');
const common = ['-project', join(here, 'BatonE2E.xcodeproj'), '-scheme', 'BatonE2E', '-destination', 'id=' + device, '-derivedDataPath', derived];
const products = join(derived, 'Build', 'Products');
if (!existsSync(products) || !readdirSync(products).some((name) => name.endsWith('.xctestrun'))) {
  console.log(new Date().toISOString().slice(11, 19), 'building UI-test bundle for', device);
  const build = spawnSync('xcodebuild', ['build-for-testing', ...common], { encoding: 'utf8' });
  if (build.status !== 0) { console.error(build.stdout.slice(-4000), build.stderr.slice(-2000)); process.exit(1); }
}
console.log(new Date().toISOString().slice(11, 19), 'running', steps);
// Stream the run so each step is visible; a hard deadline stops a hung UI wait.
const child = spawn('xcodebuild', ['test-without-building', ...common], {
  env: { ...process.env, TEST_RUNNER_BATON_E2E_STEPS: steps, TEST_RUNNER_BATON_E2E_OUT: out },
});
const deadline = setTimeout(() => { console.log('E2E deadline reached; stopping'); child.kill('SIGTERM'); }, Number(process.env.BATON_E2E_DEADLINE_MS || 300000));
let buffer = '';
const relevant = /E2E (step|optional)|error:|Test Case .* (passed|failed)|StepError|not found|timed out|Wait for|Failed to/i;
for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) if (relevant.test(line)) console.log(new Date().toISOString().slice(11, 19), line.trim().slice(0, 300));
});
child.on('close', (status) => {
  clearTimeout(deadline);
  console.log(new Date().toISOString().slice(11, 19), status === 0 ? 'PASS' : 'FAIL', '→', out);
  process.exit(status === 0 ? 0 : 1);
});
