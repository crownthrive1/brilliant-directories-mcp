const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const root = path.resolve(__dirname, '..');
const guard = path.join(__dirname, 'fixtures/no-network.cjs');
const entry = path.join(root, 'index.js');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'openapi/bd-api.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
// Never inherit a developer's BD credentials, NODE_OPTIONS or proxy settings.
const emptyEnv = { PATH: process.env.PATH || '', BD_API_KEY: '', BD_SITE_URL: '', BD_API_URL: '' };
const offlineEnv = { ...emptyEnv, BD_API_KEY: 'offline-test-not-a-secret', BD_SITE_URL: 'https://offline.invalid' };
function cli(args, env = emptyEnv, script = entry) {
  const result = spawnSync(process.execPath, ['--require', guard, script, ...args], {
    env, encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(result.error);
  return result;
}

test('help works without provider credentials', () => {
  const result = cli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--verify/);
});

test('live verification remains explicit and requires credentials', () => {
  const result = cli(['--verify']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /API key required/);
  assert.doesNotMatch(result.stderr, /OFFLINE_TEST_NETWORK_ATTEMPT/);
  assert.equal(pkg.scripts['test:integration'], 'node index.js --verify');
});

test('network guard fails closed rather than contacting a provider', () => {
  const result = spawnSync(process.execPath, ['--require', guard, '-e', "require('node:https').get('https://offline.invalid')"], {
    env: emptyEnv, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 97);
  assert.match(result.stderr, /OFFLINE_TEST_NETWORK_ATTEMPT/);
});

test('actual stdio server initializes, exposes the spec catalog and rejects unknown tools offline', { timeout: 15000 }, async () => {
  const client = new Client({ name: 'offline-regression', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath, args: ['--require', guard, entry], env: offlineEnv, stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr.on('data', chunk => { stderr += chunk; });
  try {
    await client.connect(transport, { timeout: 10000 });
    assert.equal(client.getServerVersion().name, pkg.name);
    assert.equal(client.getServerVersion().version, pkg.version);
    assert.ok(client.getServerCapabilities().tools);
    const { tools } = await client.listTools();
    const names = new Set(tools.map(tool => tool.name));
    assert.equal(names.size, tools.length, 'tool names must be unique');
    const expected = Object.values(spec.paths).flatMap(methods => Object.values(methods)
      .map(op => op.operationId).filter(id => id && id !== 'createUserMeta'));
    assert.ok(expected.length > 0, 'empty catalog is not a successful test');
    for (const name of expected) assert.ok(names.has(name), `missing spec operation ${name}`);
    assert.equal(names.has('createUserMeta'), false, 'intentionally hidden unsafe-slot tool stays hidden');
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, 'object', tool.name);
      assert.ok(tool.description && tool.description.trim(), tool.name);
      for (const required of tool.inputSchema.required || []) {
        assert.ok(Object.hasOwn(tool.inputSchema.properties || {}, required), `${tool.name}.${required}`);
      }
    }
    const result = await client.callTool({ name: '__offline_unknown_tool__', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Unknown tool/);
    assert.doesNotMatch(stderr, /OFFLINE_TEST_NETWORK_ATTEMPT/);
  } finally {
    await client.close();
  }
});

for (const corruption of ['invalid JSON', 'duplicate operationId']) {
  test(`malformed spec fails startup: ${corruption}`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-offline-test-'));
    try {
      fs.copyFileSync(entry, path.join(dir, 'index.js'));
      fs.copyFileSync(path.join(root, 'package.json'), path.join(dir, 'package.json'));
      fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
      fs.mkdirSync(path.join(dir, 'openapi'));
      const broken = structuredClone(spec);
      const operations = Object.values(broken.paths).flatMap(methods => Object.values(methods)).filter(op => op.operationId);
      operations[1].operationId = operations[0].operationId;
      fs.writeFileSync(path.join(dir, 'openapi/bd-api.json'), corruption === 'invalid JSON' ? '{broken' : JSON.stringify(broken));
      const result = cli([], offlineEnv, path.join(dir, 'index.js'));
      assert.equal(result.status, 1);
      assert.match(result.stderr, corruption === 'invalid JSON' ? /JSON|SyntaxError/ : /duplicate operationId/);
      assert.doesNotMatch(result.stderr, /OFFLINE_TEST_NETWORK_ATTEMPT/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
