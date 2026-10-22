// A stand-in for the core for the audit tests (test/edges-service.test.ts): what the real
// one cannot be made to do on cue. SIR_SCRIPT picks the behaviour; every request it gets
// is written to stderr as `got <method>`, so a test can tell what reached the core.
import { createInterface } from 'node:readline';
import { closeSync, existsSync, writeFileSync } from 'node:fs';

const script = process.env.SIR_SCRIPT ?? 'plain';
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const ok = (id, result) => send({ id, ok: true, result, elapsedMs: 1 });
const pairOf = (params) => ({ kind: 'code', patchPath: `${params.path}.sirp`, exists: false, how: 'beside' });

const VERSIONS = {
  'old-core': { sir: '0.3.0', protocol: 3, configSchema: 1, languages: [] },
  'too-new': { sir: '9.0.0', protocol: 9, protocolMin: 6, configSchema: 3, languages: [] },
  'newer-ok': { sir: '9.0.0', protocol: 9, protocolMin: 5, configSchema: 3, languages: [], somethingNew: { a: 1 } },
};
const version = VERSIONS[script] ?? { sir: '0.5.0', protocol: 5, protocolMin: 5, configSchema: 3, languages: ['cpp'] };
// what the process was started with, for the test of the spawn itself
if (script === 'env') {
  version.env = { grammarDir: process.env.SIR_GRAMMAR_DIR ?? null, electron: process.env.ELECTRON_RUN_AS_NODE ?? null };
}
const cancelled = (id) => send({ id, ok: false, error: { kind: 'Cancelled', message: 'cancelled', exitCode: 1 } });

// stopped by the client: a while later, replies for every id it is likely to ask next — a
// child that was replaced must never be heard (process.ts). Windows has no SIGTERM handler.
if (script === 'stale-on-term') {
  process.on('SIGTERM', () =>
    setTimeout(() => {
      for (let id = 1; id <= 20; id++) ok(id, { kind: 'code', patchPath: '/from/the/stopped/core', exists: false, how: 'beside' });
      process.exit(0);
    }, 100),
  );
}

// `deaf`: lets go of its input at once and stays up — every write into it lands nowhere
if (script === 'deaf') {
  closeSync(0);
  setTimeout(() => process.exit(0), 5_000);
}

const held = [];
for await (const line of script === 'deaf' ? [] : createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  const { id, method, params } = message;
  process.stderr.write(`got ${method}\n`);
  // whether the request carried the field at all, not only what was in it
  if ('params' in message) process.stderr.write(`params with ${method}\n`);
  if (script === 'silent') continue; // answers nothing, not even the handshake

  if (method === 'version') {
    if (script === 'die-first-version' && !existsSync(process.env.SIR_MARKER)) {
      writeFileSync(process.env.SIR_MARKER, 'x');
      process.exit(3);
    }
    // stays up, but refuses the first handshake: what is remembered of it is the question
    if (script === 'refuse-first-version' && !existsSync(process.env.SIR_MARKER)) {
      writeFileSync(process.env.SIR_MARKER, 'x');
      send({ id, ok: false, error: { kind: 'Internal', message: 'not ready', exitCode: 1 } });
      continue;
    }
    ok(id, version);
    continue;
  }
  if (script === 'mute') continue; // answers the handshake, nothing else
  // these answer generate, or crash on it, and nothing else
  if ((script === 'generate-then-mute' || script === 'crash-then-mute') && method !== 'generate') continue;

  switch (method) {
    case 'generate':
      if (script === 'crash-on-generate' || script === 'crash-then-mute') process.exit(3);
      if (script === 'generate-then-mute') ok(id, { patch: '' });
      if (script === 'timed') ok(id, { patch: '' });
      break; // runs until it is cancelled
    case 'cancel':
      if (script === 'no-cancel') {
        send({ id, ok: false, error: { kind: 'BadRequest', message: "unknown method 'cancel'", exitCode: 2 } });
        break;
      }
      if (script === 'mute-cancel') break;
      // the generate stops and says so before the cancel is answered
      if (script === 'stops-at-once') cancelled(params.id);
      ok(id, { cancelled: script !== 'not-running' });
      // ... or a little after, well within the grace period
      if (script === 'stops-soon') setTimeout(() => cancelled(params.id), 10);
      break;
    case 'apply':
      // `timed`: the patch text is the time the core says it took, as for resolve
      if (script === 'timed') {
        send({ id, ok: true, result: {}, elapsedMs: params.patch === '' ? 1 : Number(params.patch) });
        break;
      }
      send({ id, ok: false, error: { kind: 'BadRequest', message: `unknown method '${method}'`, exitCode: 2 } });
      break;
    case 'resolve':
      // `timed`: the patch text is the time the core says it took ('none': it does not say)
      if (script === 'timed') {
        send({ id, ok: true, result: {}, ...(params.patch === 'none' ? {} : { elapsedMs: Number(params.patch) }) });
        break;
      }
      if (script === 'stale-on-term') break; // never answered: it is timed out
      send({ id, ok: false, error: { kind: 'BadRequest', message: `unknown method '${method}'`, exitCode: 2 } });
      break;
    case 'pair':
      if (script === 'out-of-order') {
        held.push({ id, params });
        if (held.length === 2) for (const one of held.reverse()) ok(one.id, pairOf(one.params));
        break;
      }
      if (script === 'noise') {
        process.stdout.write('this line is not JSON\n');
        send({ id: 0, ok: false, error: { kind: 'BadRequest', message: 'not a request', exitCode: 2 } });
        send({ method: 'progress', params: { id: 9999, done: 1, total: 2 } });
        send({ id: 12345, ok: true, result: {} });
        send({ id, ok: true, result: { ...pairOf(params), aFieldFromTheFuture: true }, elapsedMs: 1, alsoNew: 1 });
        break;
      }
      if (script === 'stale-on-term') {
        setTimeout(() => ok(id, pairOf(params)), 300);
        break;
      }
      ok(id, pairOf(params));
      break;
    default:
      send({ id, ok: false, error: { kind: 'BadRequest', message: `unknown method '${method}'`, exitCode: 2 } });
  }
}
