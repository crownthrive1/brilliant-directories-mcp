// Preload only in offline tests. An attempted network call is a hard failure,
// even when application code would catch an ordinary thrown exception.
const deny = () => {
  process.stderr.write('OFFLINE_TEST_NETWORK_ATTEMPT\n');
  process.exit(97);
};
for (const name of ['http', 'https']) {
  const mod = require(`node:${name}`);
  mod.request = deny;
  mod.get = deny;
}
const net = require('node:net');
net.connect = deny;
net.createConnection = deny;
net.Socket.prototype.connect = deny;
require('node:tls').connect = deny;
globalThis.fetch = deny;
