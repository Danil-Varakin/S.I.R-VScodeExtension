import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { CancellationToken } from 'vscode';

// Audit, 2026-10-06: the client against a scripted core (test/fixtures/scripted-service.mjs)
// for what the real core cannot be made to do on cue. Expectations from PROTOCOL.md
// ("Transport", "Versions: a range on each side", "cancel") and ARCHITECTURE ("The service").

import { SirService } from '../src/service/client.ts';
import { ProtocolMismatchError, RequestCancelledError, RequestTimeoutError, ServiceGoneError } from '../src/errors.ts';
import { LineFramer, ServiceProcess } from '../src/service/process.ts';
import type { Log } from '../src/ui/log.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPTED = join(ROOT, 'test', 'fixtures', 'scripted-service.mjs');
const CODE = join(tmpdir(), 'a.cc');

function recordingLog(): Log & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (m) => lines.push(`info ${m}`),
    warn: (m) => lines.push(`warn ${m}`),
    error: (m) => lines.push(`error ${m}`),
    debug: (m) => lines.push(`debug ${m}`),
    protocol: () => {},
    stderr: (c) => lines.push(...c.split('\n').filter((l) => l !== '').map((l) => `stderr ${l}`)),
    show: () => {},
    dispose: () => {},
  };
}

const spawns = (log: { lines: string[] }): number => log.lines.filter((l) => l.startsWith('info spawning service')).length;
const reached = (log: { lines: string[] }, method: string): number => log.lines.filter((l) => l === `stderr got ${method}`).length;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const restarts = (log: { lines: string[] }): string[] => log.lines.filter((l) => l.startsWith('info restarting service'));
const withinSecond = <T>(p: Promise<T>): Promise<T | Error> =>
  Promise.race([outcome(p), sleep(1_000).then(() => new Error('still waiting after a second'))]);
const outcome = <T>(p: Promise<T>): Promise<T | Error> => p.then((v) => v, (e: unknown) => e as Error);

async function withScript(
  script: string,
  body: (client: SirService, log: ReturnType<typeof recordingLog>) => Promise<void>,
  env: Record<string, string> = {},
): Promise<void> {
  const saved = { ...process.env };
  Object.assign(process.env, { SIR_SCRIPT: script, ...env });
  const log = recordingLog();
  const client = new SirService(SCRIPTED, undefined, log, { cancelGraceMs: 50 });
  try {
    await body(client, log);
  } finally {
    client.dispose();
    for (const key of ['SIR_SCRIPT', ...Object.keys(env)]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function token(): { token: CancellationToken; cancel: () => void } {
  const listeners: Array<() => void> = [];
  return {
    token: { isCancellationRequested: false, onCancellationRequested: (l: () => void) => (listeners.push(l), { dispose: () => {} }) } as unknown as CancellationToken,
    cancel: () => listeners.forEach((l) => l()),
  };
}

test('replies that come in another order still reach their own callers (PROTOCOL: match by id)', async () => {
  await withScript('out-of-order', async (client) => {
    const [first, second] = await Promise.all([
      client.request('pair', { path: join(tmpdir(), 'first.cc') }),
      client.request('pair', { path: join(tmpdir(), 'second.cc') }),
    ]);
    assert.equal(first.kind === 'code' && first.patchPath, join(tmpdir(), 'first.cc.sirp'));
    assert.equal(second.kind === 'code' && second.patchPath, join(tmpdir(), 'second.cc.sirp'));
  });
});

test('a core that dies under a request fails it with ServiceGoneError, and the next one starts a new core', async () => {
  await withScript('crash-on-generate', async (client, log) => {
    const died = await outcome(client.request('generate', { baseText: 'a\n', newText: 'b\n', path: CODE }));
    assert.ok(died instanceof ServiceGoneError, `got ${String(died)}`);
    const next = await client.request('pair', { path: CODE });
    assert.equal(next.kind, 'code');
    assert.equal(spawns(log), 2);
    assert.equal(reached(log, 'version'), 2, 'the new core is asked its version again');
  });
});

test('lines that are not replies to anyone do not disturb the reply that is (PROTOCOL: id 0, unknown fields)', async () => {
  await withScript('noise', async (client) => {
    const answer = await client.request('pair', { path: CODE });
    assert.equal(answer.kind, 'code');
    assert.equal(answer.kind === 'code' && answer.patchPath, `${CODE}.sirp`);
  });
});

test('a core of protocol 3 is refused at the handshake, and nothing else is sent to it (CHANGELOG, R8)', async () => {
  await withScript('old-core', async (client, log) => {
    await assert.rejects(client.ensureCompatible(), (e: unknown) => e instanceof ProtocolMismatchError && /update sir/.test(e.message));
    await assert.rejects(client.request('pair', { path: CODE }), ProtocolMismatchError);
    await sleep(50);
    assert.equal(reached(log, 'pair'), 0, 'a request never reaches a core of another protocol');
  });
});

test('a core that no longer serves protocol 5 asks to update the extension', async () => {
  await withScript('too-new', async (client) => {
    await assert.rejects(client.ensureCompatible(), (e: unknown) => e instanceof ProtocolMismatchError && /update the extension/.test(e.message));
  });
});

test('a newer core that still serves 5 is spoken to in 5, its new fields ignored (PROTOCOL: R9, "ignore fields it does not know")', async () => {
  await withScript('newer-ok', async (client) => {
    const { protocol } = await client.ensureCompatible();
    assert.equal(protocol, 5);
    assert.equal((await client.request('pair', { path: CODE })).kind, 'code');
  });
});

test('requests that arrive together before the handshake share one core and one version', async () => {
  await withScript('plain', async (client, log) => {
    const answers = await Promise.all(Array.from({ length: 6 }, (_, i) => client.request('pair', { path: join(tmpdir(), `${i}.cc`) })));
    assert.equal(answers.length, 6);
    assert.equal(spawns(log), 1);
    await sleep(20);
    assert.equal(reached(log, 'version'), 1);
  });
});

test('a handshake that failed is asked again, not remembered', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sir-audit-'));
  await withScript('die-first-version', async (client) => {
    await assert.rejects(client.version(), ServiceGoneError);
    assert.equal((await client.version()).protocol, 5);
  }, { SIR_MARKER: join(dir, 'died-once') });
});

test('a handshake the core refused, staying up, is asked again too', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sir-audit-'));
  await withScript('refuse-first-version', async (client, log) => {
    await assert.rejects(client.version(), /not ready/);
    assert.equal((await client.version()).protocol, 5);
    assert.equal(reached(log, 'version'), 2);
    assert.equal(spawns(log), 1, 'the same core, asked twice');
  }, { SIR_MARKER: join(dir, 'refused-once') });
});

test('a cancel the core says came too late is no reason to restart it (PROTOCOL: cancelled false is no error)', async () => {
  await withScript('not-running', async (client, log) => {
    const { token: t, cancel } = token();
    const generating = client.request('generate', { baseText: 'a\n', newText: 'b\n', path: CODE }, { token: t });
    await client.ensureCompatible();
    cancel();
    await assert.rejects(generating, RequestCancelledError);
    await sleep(150);
    assert.equal((await client.request('pair', { path: CODE })).kind, 'code');
    assert.equal(spawns(log), 1);
  });
});

test('a timeout restarts the core, and whoever else waited is told, not left hanging (ARCHITECTURE: Timeouts)', async () => {
  await withScript('mute', async (client, log) => {
    await client.ensureCompatible();
    const bystander = outcome(client.request('pair', { path: CODE }, { timeoutMs: 5_000 }));
    await assert.rejects(client.request('resolve', { patch: '', baseText: '' }, { timeoutMs: 30 }), RequestTimeoutError);
    const other = await Promise.race([bystander, sleep(1_000).then(() => 'still hanging')]);
    assert.ok(other instanceof ServiceGoneError, `the bystander got ${String(other)}`);
    await assert.rejects(client.request('pair', { path: CODE }, { timeoutMs: 30 }), RequestTimeoutError);
    assert.equal(spawns(log), 2, 'the next request ran on a new core');
  });
});

test('dispose fails what is in flight and refuses what comes after', async () => {
  const saved = process.env['SIR_SCRIPT'];
  process.env['SIR_SCRIPT'] = 'mute';
  const client = new SirService(SCRIPTED, undefined, recordingLog());
  try {
    await client.ensureCompatible();
    const inFlight = outcome(client.request('pair', { path: CODE }));
    client.dispose();
    assert.ok((await inFlight) instanceof ServiceGoneError);
    await assert.rejects(client.request('pair', { path: CODE }), ServiceGoneError);
  } finally {
    client.dispose();
    if (saved === undefined) delete process.env['SIR_SCRIPT'];
    else process.env['SIR_SCRIPT'] = saved;
  }
});

test('a frame of megabytes, in many pieces, comes out whole and once (PROTOCOL: a patch body never breaks a line)', () => {
  const big = JSON.stringify({ id: 1, ok: true, result: { patch: 'x\n'.repeat(1_000_000) } });
  const lines: string[] = [];
  const framer = new LineFramer((line) => lines.push(line));
  const started = performance.now();
  for (let i = 0; i < big.length; i += 16_384) framer.push(big.slice(i, i + 16_384));
  framer.push('\n');
  assert.equal(lines.length, 1);
  assert.equal(lines[0], big);
  // the clock only under SIR_PERF (CI, `npm run test:perf`): a loaded machine is no measure
  if (process.env['SIR_PERF'] === '1') {
    assert.ok(performance.now() - started < 2_000, 'framing is not quadratic in the frame');
  }
});

test('a reply ended by CRLF is still one frame', () => {
  const lines: string[] = [];
  const framer = new LineFramer((line) => lines.push(line));
  framer.push('{"id":1}\r\n{"id":2}\r\n');
  assert.deepEqual(lines.map((l) => JSON.parse(l).id), [1, 2]);
});

// ---- after the answer: what a request leaves behind (mutation testing, 2026-10-20) ----

test('an answered request leaves no clock behind: nothing restarts the core later', async () => {
  await withScript('plain', async (client, log) => {
    assert.equal((await client.request('pair', { path: CODE }, { timeoutMs: 50 })).kind, 'code');
    await sleep(150);
    assert.deepEqual(restarts(log), []);
    assert.equal(client.spawns, 1);
  });
});

test('an answered generate no longer holds back the clocks of the others', async () => {
  await withScript('generate-then-mute', async (client) => {
    await client.request('generate', { baseText: 'a\n', newText: 'b\n', path: CODE });
    // a generate still taken for running would keep this one waiting for ever
    const late = await withinSecond(client.request('pair', { path: CODE }, { timeoutMs: 50 }));
    assert.ok(late instanceof RequestTimeoutError, `got ${String(late)}`);
  });
});

test('a core that dies lets go of everything it held: no old clock fires, no old generate holds the next', async () => {
  await withScript('crash-then-mute', async (client, log) => {
    await client.ensureCompatible();
    const bystander = outcome(client.request('pair', { path: CODE }, { timeoutMs: 200 }));
    const died = await outcome(client.request('generate', { baseText: 'a\n', newText: 'b\n', path: CODE }));
    assert.ok(died instanceof ServiceGoneError, `got ${String(died)}`);
    assert.match(died.message, /service exited \(code 3, signal none\)/);
    assert.ok((await bystander) instanceof ServiceGoneError);

    await sleep(300); // past the bystander's own timeout
    assert.deepEqual(restarts(log), [], 'the clock of a dropped request is gone with it');

    const next = await withinSecond(client.request('pair', { path: CODE }, { timeoutMs: 50 }));
    assert.ok(next instanceof RequestTimeoutError, `got ${String(next)}`);
  });
});

// ---- the log of what the core answered (README: "The log") ----

test('a resolve past a second is a warning; a quick one, a debug line; a core that does not measure, nothing', async () => {
  await withScript('timed', async (client, log) => {
    await client.ensureCompatible();
    const from = log.lines.length;
    await client.request('resolve', { patch: '1500', baseText: '' });
    await client.request('resolve', { patch: '20', baseText: '' });
    await client.request('resolve', { patch: 'none', baseText: '' });
    await client.request('generate', { baseText: 'a\n', newText: 'b\n', path: CODE });
    const said = log.lines.slice(from).filter((l) => !l.startsWith('stderr'));
    assert.deepEqual(said, [
      'warn slow: resolve answered in 1.5 s',
      'debug resolve answered in 20 ms',
      'info generate answered in 1 ms',
    ]);
  });
});

test('what nobody waits for is logged by what it is: a refusal is an error, a stray answer is not', async () => {
  await withScript('noise', async (client, log) => {
    await client.request('pair', { path: CODE });
    assert.ok(log.lines.includes('error malformed frame from the service, not JSON (21 chars)'), log.lines.join('\n'));
    assert.ok(log.lines.includes('error service refused request 0: not a request'));
    assert.ok(log.lines.includes('info dropped response for request 12345: no pending caller'));
  });
});

// ---- cancel: when the core is restarted and when it is not (PROTOCOL: "cancel") ----

test('a core without cancel is restarted, and the next request runs on a new one', async () => {
  await withScript('no-cancel', async (client, log) => {
    const { token: t, cancel } = token();
    const generating = client.request('generate', { baseText: 'a\n', newText: 'b\n', path: CODE }, { token: t });
    await client.ensureCompatible();
    cancel();
    await assert.rejects(generating, RequestCancelledError);
    await sleep(100);
    assert.equal(restarts(log).length, 1);
    assert.match(restarts(log)[0]!, /'generate' was cancelled and the core could not stop it/);
    assert.equal((await client.request('pair', { path: CODE })).kind, 'code');
    assert.equal(spawns(log), 2);
  });
});

test('a cancel nobody answers restarts the core once, not twice', async () => {
  await withScript('mute-cancel', async (client, log) => {
    const { token: t, cancel } = token();
    const generating = client.request('generate', { baseText: 'a\n', newText: 'b\n', path: CODE }, { token: t });
    await client.ensureCompatible();
    cancel();
    await assert.rejects(generating, RequestCancelledError);
    await sleep(200);
    assert.equal(restarts(log).length, 1, restarts(log).join('\n'));
  });
});

test('a generate that stops before its cancel is answered needs no restart', async () => {
  await withScript('stops-at-once', async (client, log) => {
    const { token: t, cancel } = token();
    const generating = client.request('generate', { baseText: 'a\n', newText: 'b\n', path: CODE }, { token: t });
    await client.ensureCompatible();
    cancel();
    await assert.rejects(generating, RequestCancelledError);
    await sleep(200); // past the grace period
    assert.deepEqual(restarts(log), []);
    assert.equal(spawns(log), 1);
  });
});

test('a generate that stops within the grace period needs no restart; one that does not stop gets one', async () => {
  await withScript('stops-soon', async (client, log) => {
    const { token: t, cancel } = token();
    const generating = client.request('generate', { baseText: 'a\n', newText: 'b\n', path: CODE }, { token: t });
    await client.ensureCompatible();
    cancel();
    await assert.rejects(generating, RequestCancelledError);
    await sleep(200);
    assert.deepEqual(restarts(log), []);
  });
  await withScript('plain', async (client, log) => {
    const { token: t, cancel } = token();
    const generating = client.request('generate', { baseText: 'a\n', newText: 'b\n', path: CODE }, { token: t });
    await client.ensureCompatible();
    cancel();
    await assert.rejects(generating, RequestCancelledError);
    await sleep(200);
    assert.equal(restarts(log).length, 1);
    assert.match(restarts(log)[0]!, /'generate' did not stop within 50 ms of being cancelled/);
    assert.equal((await client.request('pair', { path: CODE })).kind, 'code');
    assert.equal(spawns(log), 2);
  });
});

// ---- the process ----

test('the core is started as Node, with the grammars where the extension says, and nowhere else', async () => {
  const saved = { script: process.env['SIR_SCRIPT'], grammars: process.env['SIR_GRAMMAR_DIR'] };
  process.env['SIR_SCRIPT'] = 'env';
  delete process.env['SIR_GRAMMAR_DIR'];
  const envOf = async (grammarDir: string | undefined): Promise<unknown> => {
    const client = new SirService(SCRIPTED, grammarDir, recordingLog());
    try {
      return ((await client.version()) as unknown as { env: unknown }).env;
    } finally {
      client.dispose();
    }
  };
  try {
    assert.deepEqual(await envOf(join(tmpdir(), 'grammars')), { grammarDir: join(tmpdir(), 'grammars'), electron: '1' });
    assert.deepEqual(await envOf(undefined), { grammarDir: null, electron: '1' });
  } finally {
    for (const [key, value] of [['SIR_SCRIPT', saved.script], ['SIR_GRAMMAR_DIR', saved.grammars]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('a core that was stopped is never heard again, even when it still writes', async () => {
  // Windows kills without a signal handler: the stopped core writes nothing, and this holds trivially
  await withScript('stale-on-term', async (client) => {
    await client.ensureCompatible();
    await assert.rejects(client.request('resolve', { patch: '', baseText: '' }, { timeoutMs: 30 }), RequestTimeoutError);
    // the new core answers after 300 ms; the stopped one writes for these ids at 100 ms
    const answer = await client.request('pair', { path: CODE });
    assert.equal(answer.kind === 'code' && answer.patchPath, `${CODE}.sirp`);
  });
});

test('a line sent before the core is started is refused, not lost', () => {
  const process = new ServiceProcess(SCRIPTED, undefined, recordingLog(), { onLine: () => {}, onGone: () => {} });
  assert.throws(() => process.send('{"id":1,"method":"version"}'), /sir service is not running/);
});

// ---- what mutation testing found unchecked (docs/15-test-plan.md, stage 4) ----

const turn = (): Promise<void> => new Promise((r) => setImmediate(r));

test('a handshake nobody answers fails by its own clock, fifteen seconds', async () => {
  // the clock is mocked: the table is what is checked, not fifteen seconds of waiting
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await withScript('silent', async (client) => {
      const asked = outcome(client.version());
      let settled = false;
      void asked.then(() => (settled = true));
      mock.timers.tick(14_999);
      await turn();
      assert.equal(settled, false, 'still waiting just before the clock runs out');
      mock.timers.tick(1);
      const late = await asked;
      assert.ok(late instanceof RequestTimeoutError && late.timeoutMs === 15_000, `got ${String(late)}`);
    });
  } finally {
    mock.timers.reset();
  }
});

test('a request without params sends no params field; one with them does', async () => {
  await withScript('plain', async (client, log) => {
    await client.request('pair', { path: CODE });
    // stderr and stdout are two pipes: the line of stderr may come after the reply
    const said = (): string[] => log.lines.filter((l) => l.startsWith('stderr params with'));
    for (let i = 0; i < 50 && said().length === 0; i++) await sleep(20);
    assert.deepEqual(said(), ['stderr params with pair']);
  });
});

test('a line the core cannot be sent fails its request at once, and leaves no clock behind', async () => {
  await withScript('plain', async (client, log) => {
    await client.ensureCompatible();
    const transport = (client as unknown as { process: ServiceProcess }).process;
    transport.send = () => {
      throw new Error('the pipe broke');
    };
    await assert.rejects(client.request('pair', { path: CODE }, { timeoutMs: 30 }), /the pipe broke/);
    await sleep(100);
    assert.deepEqual(restarts(log), [], 'no clock of the dead request fired');
  });
});

test('a resolve of exactly a second is no warning yet; an apply is said as info, however long', async () => {
  await withScript('timed', async (client, log) => {
    await client.ensureCompatible();
    const from = log.lines.length;
    await client.request('resolve', { patch: '1000', baseText: '' });
    await client.request('apply', { patch: '', baseText: '', path: CODE });
    await client.request('apply', { patch: '1500', baseText: '', path: CODE });
    const said = log.lines.slice(from).filter((l) => !l.startsWith('stderr'));
    assert.deepEqual(said, [
      'debug resolve answered in 1.0 s',
      'info apply answered in 1 ms',
      'info apply answered in 1.5 s', // slow is said of resolve only
    ]);
  });
});

test('a core that cannot be started is gone, and says why', async () => {
  const saved = process.execPath;
  const gone: string[] = [];
  const core = new ServiceProcess(SCRIPTED, undefined, recordingLog(), { onLine: () => {}, onGone: (r) => gone.push(r) });
  try {
    process.execPath = join(tmpdir(), 'no-such-node');
    core.start();
  } finally {
    process.execPath = saved;
  }
  await sleep(100);
  assert.equal(gone.length, 1);
  assert.match(gone[0]!, /^service failed to spawn: /);
});

test('a write into a core that stopped reading is logged, not thrown at the extension host', async () => {
  const saved = process.env['SIR_SCRIPT'];
  process.env['SIR_SCRIPT'] = 'deaf';
  const log = recordingLog();
  const core = new ServiceProcess(SCRIPTED, undefined, log, { onLine: () => {}, onGone: () => {} });
  try {
    core.start();
    // its input closes once the process is up — later on a slow machine: write until it is
    const refused = (): boolean => log.lines.some((l) => l.startsWith('error service stdin: '));
    for (let i = 0; i < 50 && !refused(); i++) {
      await sleep(100);
      core.send('{"id":1,"method":"version"}');
    }
    await sleep(100);
    assert.ok(refused(), log.lines.join('\n'));
  } finally {
    core.stop();
    if (saved === undefined) delete process.env['SIR_SCRIPT'];
    else process.env['SIR_SCRIPT'] = saved;
  }
});
