import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IndexStore } from '../src/navigation/index-store.ts';

interface State {
  readonly v: string;
  readonly failed?: boolean;
  readonly transient?: boolean;
  readonly deps?: readonly string[];
}

interface Harness {
  readonly store: IndexStore<State>;
  /** every build asked for, in order: resolve one to finish it */
  readonly builds: Array<{ readonly key: string; readonly resolve: (state: State) => void }>;
  readonly changes: Array<[string, string | undefined]>;
  /** how many times the store asked to watch the disk */
  watches: number;
  shown: boolean;
}

function harness(options: { capacity?: number; auto?: (key: string, n: number) => State } = {}): Harness {
  const h: Harness = {
    builds: [],
    changes: [],
    watches: 0,
    shown: true,
    store: undefined as unknown as IndexStore<State>,
  };
  const store = new IndexStore<State>(
    {
      build: (key) =>
        new Promise<State>((resolve) => {
          h.builds.push({ key, resolve });
          if (options.auto !== undefined) resolve(options.auto(key, h.builds.length));
        }),
      dependenciesOf: (state) => state.deps ?? [],
      isFailure: (state) => state.failed === true,
      isTransient: (state) => state.transient === true,
      isShown: () => h.shown,
      changed: (key, state) => h.changes.push([key, state?.v]),
      watch: () => {
        h.watches += 1;
      },
    },
    { capacity: options.capacity ?? 8, delayMs: 0 },
  );
  (h as { store: IndexStore<State> }).store = store;
  return h;
}

const settle = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test('a build that an invalidation overtakes is not kept: the caller gets one built after it', async () => {
  const h = harness();
  const asked = h.store.get('a.md');
  await settle(0);
  h.store.invalidateAll(); // HEAD moved while the first build was reading the old config
  h.builds[0]!.resolve({ v: 'old config' });
  await settle(0);
  assert.equal(h.builds.length, 2, 'a fresh build replaces the overtaken one');
  h.builds[1]!.resolve({ v: 'new config' });

  assert.equal((await asked).v, 'new config');
  assert.equal((await h.store.view('a.md')).v, 'new config', 'the stale answer never became the known one');
  h.store.dispose();
});

test('a change while building leaves the result stale, and a shown one is rebuilt after the pause', async () => {
  const h = harness();
  const first = h.store.get('a.md');
  await settle(0);
  h.store.touch('a.md'); // typed into while the build ran
  h.builds[0]!.resolve({ v: 'v1' });
  assert.equal((await first).v, 'v1');

  await settle();
  assert.equal(h.builds.length, 2);
  h.builds[1]!.resolve({ v: 'v2' });
  await settle();
  assert.deepEqual(h.changes.at(-1), ['a.md', 'v2']);
  h.store.dispose();
});

test('a dependency that moved while the first build ran makes it stale, though it was named only at the end', async () => {
  const h = harness();
  const first = h.store.get('a.sirp');
  await settle(0);
  h.store.touch('a.cc'); // the code was edited after the build had read it
  h.builds[0]!.resolve({ v: 'read before the edit', deps: ['a.cc'] });
  await first;

  await settle();
  assert.equal(h.builds.length, 2, 'built again');
  h.builds[1]!.resolve({ v: 'after the edit', deps: ['a.cc'] });
  await settle();
  assert.deepEqual(h.changes.at(-1), ['a.sirp', 'after the edit']);
  h.store.dispose();
});

test('a failure is shown to views but never replayed to a command', async () => {
  const h = harness({ auto: (_, n) => (n === 1 ? { v: 'down', failed: true } : { v: 'up' }) });
  assert.equal((await h.store.get('a.md')).v, 'down');
  assert.equal((await h.store.view('a.md')).v, 'down', 'the view keeps what it has');
  assert.equal((await h.store.get('a.md')).v, 'up', 'a command asks again');
  h.store.dispose();
});

test('a transient failure is built again once on its own, not over and over', async () => {
  const h = harness({ auto: () => ({ v: 'service restarting', failed: true, transient: true }) });
  await h.store.get('a.md');
  await settle(50);
  assert.equal(h.builds.length, 2);
  h.store.dispose();
});

test('a stale state nobody looks at is forgotten, not rebuilt', async () => {
  const h = harness({ auto: () => ({ v: 'v1', deps: ['a.cc'] }) });
  h.shown = false;
  await h.store.get('a.md');
  h.store.touch('a.cc');
  await settle();
  assert.equal(h.builds.length, 1);
  assert.deepEqual(h.changes.at(-1), ['a.md', undefined]);
  assert.equal(h.store.isTracked('a.md'), false);
  h.store.dispose();
});

test('the least recently used state goes first, and says it went', async () => {
  const h = harness({ capacity: 2, auto: (key) => ({ v: key }) });
  await h.store.get('a.md');
  await h.store.get('b.md');
  await h.store.get('a.md'); // used again: b is now the oldest
  await h.store.get('c.md');
  assert.ok(h.changes.some(([key, state]) => key === 'b.md' && state === undefined));
  assert.equal(h.store.isTracked('a.md'), true);
  h.store.dispose();
});

test('a command asking after an edit of the key itself does not get the build that began before it', async () => {
  const h = harness();
  void h.store.get('a.sirp'); // opening the patch starts a build
  await settle(0);
  h.store.touch('a.sirp'); // typed in it while that build reads the old text
  const asked = h.store.get('a.sirp'); // and a command right after
  await settle(0);
  assert.equal(h.builds.length, 2, 'a fresh build, not the one from before the edit');
  h.builds[0]!.resolve({ v: 'before the edit' });
  h.builds[1]!.resolve({ v: 'after the edit' });
  assert.equal((await asked).v, 'after the edit');
});

// ---- what forgetting leaves behind (mutation testing, 2026-10-20) ----

const where = (h: Harness, key: string): Record<string, boolean> => JSON.parse(h.store.describe(key)) as Record<string, boolean>;

test('describe says where a key stands, and dispose leaves nothing standing', async () => {
  const h = harness({ auto: () => ({ v: 'v1', deps: ['a.cc'] }) });
  await h.store.get('a.md');
  assert.deepEqual(where(h, 'a.md'), { tracked: true, entry: true, stale: false, building: false, shown: true, timer: false });
  h.store.touch('a.cc');
  assert.equal(where(h, 'a.md').stale, true);
  h.store.dispose();
  const { tracked, entry, stale, building } = where(h, 'a.md');
  assert.deepEqual({ tracked, entry, stale, building }, { tracked: false, entry: false, stale: false, building: false });
});

test('a build that ends with nothing moved schedules no rebuild', async () => {
  const h = harness({ auto: () => ({ v: 'v1' }) });
  await h.store.get('a.md');
  assert.equal(where(h, 'a.md').timer, false);
  h.store.dispose();
});

test('a key nobody knows is not forgotten aloud', () => {
  const h = harness();
  h.store.forget('never.md');
  h.store.closed('never.md');
  assert.deepEqual(h.changes, []);
  h.store.dispose();
});

test('a forgotten key is built afresh, and its stale mark goes with it', async () => {
  const h = harness({ auto: (_, n) => ({ v: `v${n}`, deps: ['a.cc'] }) });
  await h.store.get('a.md');
  h.store.touch('a.cc'); // stale, a rebuild scheduled …
  h.store.forget('a.md'); // … and forgotten before it runs
  await settle();
  assert.equal(h.builds.length, 1, 'nothing rebuilds a key that was forgotten');
  assert.equal((await h.store.view('a.md')).v, 'v2', 'the old state is not kept for views either');
  h.store.dispose();
});

test('a superseded build that fails does not take the build that replaced it down with it', async () => {
  const builds: Array<{ resolve: (s: State) => void; reject: (e: Error) => void }> = [];
  const store = new IndexStore<State>(
    {
      build: () => new Promise<State>((resolve, reject) => builds.push({ resolve, reject })),
      dependenciesOf: () => [],
      isFailure: () => false,
      isTransient: () => false,
      isShown: () => true,
      changed: () => {},
      watch: () => {},
    },
    { capacity: 8, delayMs: 0 },
  );
  const first = store.get('a.md');
  await settle(0);
  store.invalidateAll();
  const second = store.get('a.md');
  await settle(0);
  builds[0]!.reject(new Error('the old build broke'));
  await assert.rejects(first, /the old build broke/);
  assert.equal(JSON.parse(store.describe('a.md')).building, true, 'the new build is still the one under way');
  const third = store.get('a.md'); // joins it rather than starting another
  await settle(0);
  assert.equal(builds.length, 2);
  builds[1]!.resolve({ v: 'new' });
  assert.equal((await second).v, 'new');
  assert.equal((await third).v, 'new');
  store.dispose();
});

test('an edit during the build that replaced a superseded one still makes it stale', async () => {
  const h = harness();
  void h.store.get('a.sirp');
  await settle(0);
  h.store.invalidateAll();
  const second = h.store.get('a.sirp');
  await settle(0);
  h.builds[0]!.resolve({ v: 'superseded', deps: ['a.cc'] }); // ends while the second still runs
  await settle(0);
  h.store.touch('a.cc'); // the code moves under the second build
  h.builds[1]!.resolve({ v: 'read before the edit', deps: ['a.cc'] });
  await second;
  await settle();
  assert.equal(h.builds.length, 3, 'built once more, after the edit');
  h.store.dispose();
});

// ---- what mutation testing found unchecked (docs/15-test-plan.md, stage 3) ----

test('a fresh state is handed out again, not built again', async () => {
  const h = harness({ auto: () => ({ v: 'v1' }) });
  await h.store.get('a.md');
  await h.store.get('a.md');
  assert.equal(h.builds.length, 1);
  h.store.dispose();
});

test('a change nothing depends on schedules nothing', async () => {
  const h = harness({ auto: () => ({ v: 'v1', deps: ['a.cc'] }) });
  await h.store.get('a.md');
  h.store.touch('other.cc');
  assert.equal(where(h, 'a.md').timer, false);
  h.store.dispose();
});

test('a closed key that is known is forgotten; one only depended on makes its dependants stale', async () => {
  const h = harness({ auto: (_, n) => ({ v: `v${n}`, deps: ['a.cc'] }) });
  await h.store.get('a.md');
  h.store.closed('a.cc'); // the code, closed with unsaved edits
  assert.equal(where(h, 'a.md').stale, true);
  await settle();
  assert.equal(h.builds.length, 2, 'the shown patch is built again');
  h.store.closed('a.md'); // the patch itself
  assert.deepEqual(h.changes.at(-1), ['a.md', undefined]);
  assert.equal(h.store.isTracked('a.md'), false);
  h.store.dispose();
});

test('dropping everything from an empty store watches nothing new; from a full one, once', async () => {
  const h = harness({ auto: () => ({ v: 'v1' }) });
  h.store.invalidateAll();
  assert.equal(h.watches, 0);
  await h.store.get('a.md');
  await h.store.get('b.md');
  const before = h.watches;
  h.store.invalidateAll();
  assert.equal(h.watches, before + 1);
  h.store.dispose();
});

test('after dispose a pending rebuild never runs', async () => {
  const h = harness({ auto: () => ({ v: 'v1', deps: ['a.cc'] }) });
  await h.store.get('a.md');
  h.store.touch('a.cc'); // a rebuild scheduled …
  h.store.dispose(); // … and the store gone before it runs
  h.store.touch('a.cc');
  await settle();
  assert.equal(h.builds.length, 1);
});

test('a rebuild keeps the dependencies known so far: a change of one during it still counts', async () => {
  const h = harness();
  void h.store.get('a.md');
  await settle(0);
  h.builds[0]!.resolve({ v: 'v1', deps: ['a.cc'] });
  await settle(0);
  h.store.touch('a.cc');
  const second = h.store.get('a.md');
  await settle(0);
  h.store.touch('a.cc'); // moves again while the rebuild runs
  h.builds[1]!.resolve({ v: 'v2' }); // and this build names no dependencies at all
  await second;
  await settle();
  assert.equal(h.builds.length, 3);
  h.store.dispose();
});

test('a key nobody shows is built without a word to the views', async () => {
  const h = harness({ auto: () => ({ v: 'v1' }) });
  h.shown = false;
  await h.store.get('a.md');
  assert.deepEqual(h.changes, []);
  h.store.dispose();
});

test('a forgotten key that fails transiently again gets its one retry again', async () => {
  const h = harness({ auto: () => ({ v: 'service restarting', failed: true, transient: true }) });
  await h.store.get('a.md');
  await settle();
  assert.equal(h.builds.length, 2);
  h.store.forget('a.md');
  await h.store.get('a.md');
  await settle();
  assert.equal(h.builds.length, 4);
  h.store.dispose();
});

test('a key that went stale while building is built once more when it ends, not twice', async () => {
  const h = harness();
  void h.store.get('a.md');
  await settle(0);
  h.store.touch('a.md'); // the pause ends while the build still runs
  await settle();
  assert.equal(h.builds.length, 1, 'nothing starts beside the build under way');
  h.builds[0]!.resolve({ v: 'v1' });
  await settle();
  assert.equal(h.builds.length, 2);
  h.builds[1]!.resolve({ v: 'v2' });
  await settle();
  assert.equal(h.builds.length, 2);
  h.store.dispose();
});
