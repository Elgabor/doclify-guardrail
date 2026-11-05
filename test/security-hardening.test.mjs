import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { check } from '../src/api.mjs';
import { compileWildcard } from '../src/wildcard.mjs';
import { scanInlineLinks } from '../src/inline-links.mjs';
import { checkDeadLinksDetailed } from '../src/links.mjs';
import { buildRepositoryIndex } from '../src/repository-index.mjs';
import { createResult } from '../src/result.mjs';
import { renderResult } from '../src/result-renderers.mjs';
import { getBlockedRemoteUrlReason } from '../src/network-guard.mjs';

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-security-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function child(source, cwd) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd, encoding: 'utf8', timeout: 8000,
    env: { PATH: process.env.PATH || '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('SEC-02 filename glob treats regex operators literally within a bounded child', (t) => {
  const root = temp(t);
  fs.writeFileSync(path.join(root, `${'a'.repeat(30)}!.md`), '# Test\n');
  fs.writeFileSync(path.join(root, 'literal(a+)+.md'), '# Test\n');
  child(`
    import assert from 'node:assert/strict';
    import { miniGlob } from ${JSON.stringify(new URL('../src/glob.mjs', import.meta.url).href)};
    assert.deepEqual(miniGlob('*(a+)+.md', process.cwd()).map(p => p.split('/').pop()), ['literal(a+)+.md']);
  `, root);
});

test('SEC-02 config exclusions avoid ambiguous wildcard backtracking', (t) => {
  const root = temp(t);
  const name = `${'a'.repeat(45)}.md`;
  fs.writeFileSync(path.join(root, name), '# Test\n');
  fs.writeFileSync(path.join(root, '.doclify-guardrail.json'), JSON.stringify({ exclude: ['*a'.repeat(24) + 'b'] }));
  child(`
    import assert from 'node:assert/strict';
    import { check } from ${JSON.stringify(new URL('../src/api.mjs', import.meta.url).href)};
    const result = await check({cwd: process.cwd(), paths: ['.']});
    assert.equal(result.complete, true);
    assert.equal(result.files.length, 1);
  `, root);
});

test('SEC-02 workspace patterns avoid ambiguous wildcard backtracking', (t) => {
  const root = temp(t);
  const directory = 'a'.repeat(45);
  fs.mkdirSync(path.join(root, directory));
  fs.writeFileSync(path.join(root, directory, 'package.json'), '{"name":"app"}');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['*a'.repeat(24) + 'b'] }));
  child(`
    import assert from 'node:assert/strict';
    import { buildRepositoryIndex } from ${JSON.stringify(new URL('../src/repository-index.mjs', import.meta.url).href)};
    assert.deepEqual(buildRepositoryIndex(process.cwd()).workspacePackages, []);
  `, root);
});

test('SEC-02 wildcard modes preserve their previous supported grammars', () => {
  const paths = ['', 'a', 'b', 'ab', 'a.md', 'docs/a.md', 'docs/sub/a.md', 'packages/app', 'packages/deep/app'];
  const patterns = ['', '*', '**', '**/*', '*.md', '**/*.md', 'docs/*', 'docs/**', 'docs/**/*.md', '**/app', 'packages/**/app', '*a*b', 'a**b'];
  for (const mode of ['filename', 'exclusion', 'workspace']) {
    for (const pattern of patterns) {
      let expression = '';
      for (let offset = 0; offset < pattern.length; offset += 1) {
        if (mode === 'workspace' && pattern.startsWith('**/', offset)) {
          expression += '(?:.*/)?';
          offset += 2;
        } else if (mode !== 'filename' && pattern.startsWith('**', offset)) {
          expression += '.*';
          offset += 1;
        } else if (pattern[offset] === '*') {
          expression += mode === 'filename' ? '.*' : '[^/]*';
        } else expression += pattern[offset].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      const previous = new RegExp(`^${expression}$`);
      const matches = compileWildcard(pattern, mode);
      for (const candidate of paths) assert.equal(matches(candidate), previous.test(candidate), `${mode}:${pattern}:${candidate}`);
    }
    for (const literal of ['(a+)+', '[ab]', 'a?b', 'a|b', '^a$', '{a}', '\\a']) {
      const matches = compileWildcard(`*${literal}`, mode);
      assert.equal(matches(`x${literal}`), true);
      assert.equal(matches('xaaab'), false);
    }
  }
});

test('SEC-03 API handles 64 KiB delimiter runs including heading anchors', (t) => {
  const root = temp(t);
  fs.writeFileSync(path.join(root, 'README.md'), '['.repeat(65536));
  child(`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { check } from ${JSON.stringify(new URL('../src/api.mjs', import.meta.url).href)};
    import { anchorFor } from ${JSON.stringify(new URL('../src/repository-index.mjs', import.meta.url).href)};
    const result = await check({cwd: process.cwd(), paths: ['README.md']});
    assert.equal(result.complete, true);
    assert.deepEqual(result.findings, []);
    assert.equal(anchorFor('['.repeat(65536)), '');
    fs.writeFileSync('README.md', '# ' + '['.repeat(65536) + '\\n[x](README.md#missing)');
    const heading = await check({cwd: process.cwd(), paths: ['README.md']});
    assert.equal(heading.findings.length, 1);
  `, root);
});

test('SEC-03 CLI handles 64 KiB delimiter runs without skipping recognized claims', (t) => {
  const root = temp(t);
  fs.writeFileSync(path.join(root, 'README.md'), '['.repeat(65536));
  const result = spawnSync(process.execPath, [new URL('../src/index.mjs', import.meta.url).pathname, 'check', 'README.md', '--format', 'json'], {
    cwd: root, encoding: 'utf8', timeout: 8000, env: { PATH: process.env.PATH || '' }
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).complete, true);
});

test('SEC-03 scanners are differential-equivalent to the three previous link grammars', () => {
  const grammars = {
    link: /\[[^\]]*\]\(([^()\s]*(?:\([^)]*\)[^()\s]*)*)\)/g,
    claim: /\[[^\]]*\]\(([^)\s]+)\)/g,
    heading: /\[([^\]]+)\]\([^)]*\)/g
  };
  const inputs = ['[a [b](guide.md#missing)', '[](a)', '[x]()', '[x](a(b)c)', '[x](a( b)c)', '[x](a((b)c)', '[x](a b) [y](c)', '[[[](a)', '[x](#[a])', '[x](a#b#c)', '[x](a\n)'];
  let seed = 7;
  const alphabet = '[]()ab# \t';
  for (let sample = 0; sample < 4000; sample += 1) {
    let value = '';
    for (let index = 0; index < 40; index += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      value += alphabet[seed % alphabet.length];
    }
    inputs.push(value);
  }
  for (const [mode, grammar] of Object.entries(grammars)) {
    for (const input of inputs) {
      const previous = [...input.matchAll(grammar)].map((match) => ({
        index: match.index, end: match.index + match[0].length,
        value: match[1]
      }));
      const current = scanInlineLinks(input, mode).map((link) => ({
        index: link.index, end: link.end, value: mode === 'heading' ? link.label : link.url
      }));
      assert.deepEqual(current, previous, `${mode}:${JSON.stringify(input)}`);
    }
  }
});

test('SEC-05 DNS deadlines return without late requests or unbounded abandoned lookups', (t) => {
  child(`
    import assert from 'node:assert/strict';
    import { checkDeadLinksDetailed } from ${JSON.stringify(new URL('../src/links.mjs', import.meta.url).href)};
    const watchdog = setTimeout(() => { throw new Error('DNS exceeded the watchdog'); }, 2000);
    let release;
    let requests = 0;
    const scan = await checkDeadLinksDetailed('[x](https://slow.invalid)', {
      sourceFile: 'README.md', timeoutMs: 50,
      lookupFn: () => new Promise(resolve => { release = resolve; }),
      requestFn: async () => { requests++; return {status:200,headers:{get:()=>null}}; }
    });
    assert.match(scan.findings[0]?.message || '', /Timeout/);
    release([{address:'8.8.8.8',family:4}]);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(requests,0);
    let lookups = 0;
    const stalled = await checkDeadLinksDetailed(Array.from({length:20},(_,i)=>'[x](https://host'+i+'.invalid)').join('\\n'), {
      sourceFile:'README.md',timeoutMs:50,concurrency:2,
      lookupFn:()=>{lookups++;return new Promise(()=>{});},
      requestFn:async()=>{throw new Error('request after deadline');}
    });
    assert.equal(stalled.findings.length,20);
    assert.ok(stalled.findings.every(f=>f.message.includes('Timeout')));
    assert.ok(lookups<=2, 'too many abandoned DNS lookups: '+lookups);
    clearTimeout(watchdog);
  `, temp(t));
});

test('SEC-05 public API bounds pending DNS per scan and concurrency policy across documents', (t) => {
  child(`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import dns from 'node:dns/promises';
    import http from 'node:http';
    import https from 'node:https';
    import { syncBuiltinESMExports } from 'node:module';
    import { check } from ${JSON.stringify(new URL('../src/api.mjs', import.meta.url).href)};
    const timers = new Set();
    Object.defineProperty(performance, 'now', { value: () => 0 });
    globalThis.setTimeout = (callback) => {
      const timer = { callback };
      timers.add(timer);
      return timer;
    };
    globalThis.clearTimeout = timer => { timers.delete(timer); };
    let currentRun;
    let requests = 0;
    const releases = [];
    dns.lookup = () => {
      const run = currentRun;
      run.calls++;
      run.active++;
      run.peak = Math.max(run.peak, run.active);
      return new Promise(resolve => releases.push(() => {
        run.active--;
        resolve([{ address: '127.0.0.1', family: 4 }]);
      }));
    };
    http.request = https.request = () => { requests++; throw new Error('request after deadline'); };
    syncBuiltinESMExports();
    function fixture(name, files, hierarchical = false) {
      const root = process.cwd() + '/' + name;
      fs.mkdirSync(root);
      fs.writeFileSync(root + '/.doclify-guardrail.json', JSON.stringify({ linkConcurrency: 2 }));
      for (let file = 0; file < files; file++) {
        const directory = hierarchical && file >= files / 2 ? root + '/nested' : root;
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(directory + '/doc' + file + '.md', '[x](https://one' + file + '.invalid/a)\\n[x](https://two' + file + '.invalid/b)');
      }
      if (hierarchical) fs.writeFileSync(root + '/nested/.doclify-guardrail.json', JSON.stringify({ linkConcurrency: 3 }));
      return root;
    }
    async function run(root, files, limit) {
      const metrics = { calls: 0, active: 0, peak: 0 };
      currentRun = metrics;
      let settled = false;
      let result;
      let failure;
      check({ cwd: root, paths: ['.'], externalLinks: true, links: { timeoutMs: 1000 } }).then(
        value => { result = value; settled = true; },
        error => { failure = error; settled = true; }
      );
      while (!settled) {
        // Drain promise continuations so DNS acquires its slots before expiring the file's URLs.
        await new Promise(resolve => setImmediate(resolve));
        for (const timer of [...timers]) {
          if (timers.delete(timer)) timer.callback();
        }
      }
      if (failure) throw failure;
      assert.equal(result.summary.filesScanned, files);
      assert.equal(result.findings.length, files * 2);
      assert.ok(result.findings.every(finding => finding.message.includes('Timeout (1s)')));
      assert.equal(metrics.calls, limit, JSON.stringify({ files, limit, ...metrics }));
      assert.ok(metrics.peak <= limit);
      assert.equal(metrics.active, limit);
      assert.equal(requests, 0);
      return { result, metrics };
    }
    const single = await run(fixture('single', 1), 1, 2);
    const multiRoot = fixture('multiple', 8);
    const multiple = await run(multiRoot, 8, 2);
    // A second run gets its own limiter even while the first run's OS lookups remain pending.
    const repeated = await run(multiRoot, 8, 2);
    assert.deepEqual(repeated.result, multiple.result);
    const hierarchy = await run(fixture('hierarchical', 8, true), 8, 2 + 3);
    for (const release of releases) release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests, 0);
    for (const run of [single, multiple, repeated, hierarchy]) assert.equal(run.metrics.active, 0);
    assert.equal(timers.size, 0);
  `, temp(t));
});

test('SEC-05 early deadline timers prevent late requests even before the clock deadline', (t) => {
  child(`
    import assert from 'node:assert/strict';
    import { checkDeadLinksDetailed } from ${JSON.stringify(new URL('../src/links.mjs', import.meta.url).href)};
    const nativeSetTimeout = globalThis.setTimeout;
    const nativeClearTimeout = globalThis.clearTimeout;
    const watchdog = nativeSetTimeout(() => { throw new Error('deadline regression stalled'); }, 2000);
    const timers = [];
    Object.defineProperty(performance, 'now', { value: () => 0 });
    globalThis.setTimeout = (callback) => {
      const timer = { callback, cleared: false };
      timers.push(timer);
      return timer;
    };
    globalThis.clearTimeout = (timer) => { timer.cleared = true; };
    try {
      let release;
      let requests = 0;
      let lookups = 0;
      const pending = checkDeadLinksDetailed('[x](https://slow.invalid)', {
        sourceFile: 'README.md', timeoutMs: 50,
        lookupFn: () => { lookups++; return new Promise(resolve => { release = resolve; }); },
        requestFn: async () => { requests++; return { status: 200, headers: { get: () => null } }; }
      });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(lookups, 1);
      // Fire the lookup deadline first while the outer preflight timer is pending.
      timers.at(-1).callback();
      const result = await pending;
      assert.equal(requests, 0, 'request started after a deadline timer fired');
      assert.equal(result.findings.length, 1);
      assert.match(result.findings[0].message, /Timeout \\(0\\.05s\\)/);
      release([{ address: '8.8.8.8', family: 4 }]);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(requests, 0);
      assert.equal(lookups, 1);
      assert.ok(timers.every(timer => timer.cleared));
    } finally {
      globalThis.setTimeout = nativeSetTimeout;
      globalThis.clearTimeout = nativeClearTimeout;
      nativeClearTimeout(watchdog);
    }
  `, temp(t));
});

test('SEC-05 DNS preflight propagates aborts without poisoning the host cache', async () => {
  const dnsCache = new Map();
  const abort = new Error('Timeout (0.05s)');
  abort.name = 'AbortError';
  let lookups = 0;
  const lookupFn = async () => {
    lookups += 1;
    if (lookups === 1) throw abort;
    return [{ address: '127.0.0.1', family: 4 }];
  };
  await assert.rejects(
    getBlockedRemoteUrlReason('https://same.invalid/first', { dnsCache, lookupFn }),
    (error) => error === abort
  );
  assert.equal(dnsCache.has('same.invalid'), false);
  const reason = await getBlockedRemoteUrlReason('https://same.invalid/second', { dnsCache, lookupFn });
  assert.match(reason, /Blocked private host\/IP/);
  assert.equal(lookups, 2);
  assert.equal(await getBlockedRemoteUrlReason('https://same.invalid/third', { dnsCache, lookupFn }), reason);
  assert.equal(lookups, 2);
});

test('SEC-05 a fired deadline prevents lookup work that has not started yet', (t) => {
  child(`
    import assert from 'node:assert/strict';
    import { checkDeadLinksDetailed } from ${JSON.stringify(new URL('../src/links.mjs', import.meta.url).href)};
    const timers = [];
    Object.defineProperty(performance, 'now', { value: () => 0 });
    globalThis.setTimeout = (callback) => {
      const timer = { callback, cleared: false };
      timers.push(timer);
      return timer;
    };
    globalThis.clearTimeout = timer => { timer.cleared = true; };
    let lookups = 0;
    let requests = 0;
    const pending = checkDeadLinksDetailed('[x](https://slow.invalid)', {
      sourceFile: 'README.md', timeoutMs: 50,
      lookupFn: () => { lookups++; return new Promise(() => {}); },
      requestFn: async () => { requests++; throw new Error('request after deadline'); }
    });
    // Expire the preflight before its queued promise continuation can start DNS.
    timers.at(-1).callback();
    const result = await pending;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(lookups, 0, 'lookup started after a deadline timer fired');
    assert.equal(requests, 0);
    assert.equal(result.findings.length, 1);
    assert.match(result.findings[0].message, /Timeout \\(0\\.05s\\)/);
    assert.ok(timers.every(timer => timer.cleared));
  `, temp(t));
});

test('SEC-05 ordinary DNS errors retain the previous empty cached result', async () => {
  const dnsCache = new Map();
  let lookups = 0;
  const lookupFn = async () => {
    lookups += 1;
    throw new Error('EAI_AGAIN');
  };
  for (const suffix of ['first', 'second']) {
    assert.equal(await getBlockedRemoteUrlReason(`https://same.invalid/${suffix}`, { dnsCache, lookupFn }), null);
  }
  assert.equal(dnsCache.has('same.invalid'), true);
  assert.equal(lookups, 1);
});

test('SEC-05 one URL budget covers redirects and HEAD to GET fallback', (t) => {
  child(`
    import assert from 'node:assert/strict';
    import { checkDeadLinksDetailed } from ${JSON.stringify(new URL('../src/links.mjs', import.meta.url).href)};
    const reply = (status, location=null) => ({status,headers:{get:()=>location}});
    for (const scenario of ['redirect','fallback']) {
      let requests=0;
      const content='[a](http://127.0.0.1/a)';
      const result=await checkDeadLinksDetailed(content,{
        sourceFile:'README.md',timeoutMs:100,concurrency:1,allowPrivateLinks:true,
        requestFn:async(url,opts)=>{
          requests++;
          await new Promise(resolve=>setTimeout(resolve,70));
          if(scenario==='redirect') return reply(302,'/next');
          if(scenario==='fallback') return reply(opts.method==='HEAD'?405:200);
          return reply(200);
        }
      });
      assert.match(result.findings.at(-1)?.message || '',/Timeout/,scenario);
      assert.equal(requests,2);
    }
  `, temp(t));
});

test('SEC-05 queued URLs each receive a full timeout after leaving the queue', (t) => {
  child(`
    import assert from 'node:assert/strict';
    import { checkDeadLinksDetailed } from ${JSON.stringify(new URL('../src/links.mjs', import.meta.url).href)};
    const reply = {status:200,headers:{get:()=>null}};
    const urls = Array.from({length:6},(_,index)=>'[x](https://host'+index+'.invalid)').join('\\n');
    let requests = 0;
    const result = await checkDeadLinksDetailed(urls, {
      sourceFile:'README.md',timeoutMs:200,concurrency:2,
      lookupFn:async()=>[{address:'8.8.8.8',family:4}],
      requestFn:async()=>{
        requests++;
        await new Promise(resolve=>setTimeout(resolve,120));
        return reply;
      }
    });
    assert.deepEqual(result.findings,[]);
    assert.equal(requests,6);
    const slow = await checkDeadLinksDetailed('[x](https://slow.invalid)', {
      sourceFile:'README.md',timeoutMs:200,
      lookupFn:async()=>[{address:'8.8.8.8',family:4}],
      requestFn:async()=>{await new Promise(resolve=>setTimeout(resolve,260));return reply;}
    });
    assert.match(slow.findings[0]?.message || '',/Timeout/);
  `, temp(t));
});

test('SEC-05 private URLs retain a finding per distinct line before allow-list and cache', async () => {
  const url = 'http://127.0.0.1/private';
  const result = await checkDeadLinksDetailed(`[x](${url}) [duplicate](${url})\n[y](${url})`, {
    sourceFile: 'README.md',
    linkAllowList: [url],
    remoteCache: new Map([[url, null]]),
    requestFn: async () => { throw new Error('private request started'); }
  });
  assert.deepEqual(result.findings.map(finding => finding.line), [1, 2]);
  assert.ok(result.findings.every(finding => finding.message.includes('Blocked private host/IP')));
  assert.equal(result.stats.remoteLinksChecked, 0);
});

test('SEC-06 contained file aliases and chains verify anchors', { skip: process.platform === 'win32' }, async (t) => {
  const root = temp(t);
  fs.writeFileSync(path.join(root, 'target.md'), '# Existing\n');
  fs.symlinkSync('target.md', path.join(root, 'alias.md'));
  fs.symlinkSync('alias.md', path.join(root, 'chain.md'));
  for (const alias of ['alias.md', 'chain.md']) {
    for (const fragment of ['existing', 'missing']) {
      fs.writeFileSync(path.join(root, 'README.md'), `[ref](${alias}#${fragment})`);
      const result = await check({ cwd: root, paths: ['README.md'] });
      assert.equal(result.complete, true);
      assert.deepEqual(result.findings.map(f=>f.ruleId), fragment === 'existing' ? [] : ['local-link']);
    }
  }
});

test('SEC-06 unavailable alias evidence is incomplete only when referenced', { skip: process.platform === 'win32' }, async (t) => {
  const parent = temp(t);
  const root = path.join(parent, 'repo');
  fs.mkdirSync(root);
  fs.mkdirSync(path.join(root, 'private'));
  fs.mkdirSync(path.join(root, 'directory'));
  fs.writeFileSync(path.join(root, 'private/target.md'), '# Existing\n');
  fs.writeFileSync(path.join(root, 'directory/target.md'), '# Existing\n');
  fs.writeFileSync(path.join(parent, 'outside.md'), '# Outside\n');
  fs.symlinkSync('../outside.md', path.join(root, 'external.md'));
  fs.symlinkSync('missing.md', path.join(root, 'broken.md'));
  fs.symlinkSync('directory', path.join(root, 'directory-alias'));
  fs.symlinkSync('private/target.md', path.join(root, 'excluded.md'));
  fs.symlinkSync('cycle-b.md', path.join(root, 'cycle-a.md'));
  fs.symlinkSync('cycle-a.md', path.join(root, 'cycle-b.md'));
  fs.writeFileSync(path.join(root, '.doclify-guardrail.json'), JSON.stringify({exclude:['private/**']}));
  fs.writeFileSync(path.join(root, 'README.md'), '# Safe\n');
  assert.equal((await check({cwd:root,paths:['README.md']})).complete, true);
  for (const alias of ['external.md', 'broken.md', 'directory-alias/target.md', 'excluded.md', 'cycle-a.md']) {
    fs.writeFileSync(path.join(root, 'README.md'), `[ref](${alias}#existing)`);
    const result = await check({cwd:root,paths:['README.md']});
    assert.equal(result.complete, false, alias);
    assert.ok(result.diagnostics.length > 0, alias);
  }
});

test('SEC-06 aliases do not add support for manifest or Makefile symlinks', { skip: process.platform === 'win32' }, (t) => {
  const root = temp(t);
  fs.writeFileSync(path.join(root, 'manifest.txt'), '{"name":"root","scripts":{"test":"true"}}');
  fs.writeFileSync(path.join(root, 'make.txt'), 'check:\n');
  fs.symlinkSync('manifest.txt', path.join(root, 'package.json'));
  fs.symlinkSync('make.txt', path.join(root, 'Makefile'));
  const index = buildRepositoryIndex(root);
  assert.equal(index.rootPackage, null);
  assert.equal(index.makefiles.size, 0);
});

test('SEC-07 JUnit emits only XML 1.0 characters while retaining markup escaping', () => {
  const invalid = '\u0000\u0001\u0008\u000b\u000c\u001f\ufffe\uffff\ud800X\udfff';
  const valid = '\t\n\r café 😀 𐐀';
  const value = `&<>"'${invalid}${valid}`;
  const result = createResult({
    toolVersion: '2.0.1',
    files: [{path:value,scanned:true,suppressions:[]}],
    findings: [{path:value,ruleId:'local-link',severity:'blocking',message:value}],
    diagnostics: [{path:'orphan',code:'unavailable',message:value}]
  });
  const xml = renderResult(result, {format:'junit'});
  assert.doesNotMatch(xml, /[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u);
  assert.ok(xml.includes('&amp;&lt;&gt;&quot;&apos;X'+valid));
  assert.equal(xml.includes('\ufffe'), false);
});
