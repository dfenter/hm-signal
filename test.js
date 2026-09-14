import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { server } from './server.js';

function waitMsg(ws) {
  return new Promise((resolve) => {
    ws.once('message', (raw) => resolve(JSON.parse(raw.toString())));
  });
}

function startServer() {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = server.address().port;
      resolve(port);
    });
  });
}

test('host, join, signal relay, peer-left', async (t) => {
  const port = await startServer();
  const base = `ws://127.0.0.1:${port}/ws`;
  const origin = 'https://new.greenguard-usa.com';

  const host = new WebSocket(base, { origin });
  await new Promise((r) => host.once('open', r));

  host.send(JSON.stringify({ t: 'host' }));
  const roomMsg = await waitMsg(host);
  assert.equal(roomMsg.t, 'room');
  assert.equal(roomMsg.code.length, 4);

  const guest = new WebSocket(base, { origin });
  await new Promise((r) => guest.once('open', r));

  const hostPeerPromise = waitMsg(host);
  guest.send(JSON.stringify({ t: 'join', code: roomMsg.code }));
  const joinedMsg = await waitMsg(guest);
  assert.equal(joinedMsg.t, 'joined');
  assert.equal(joinedMsg.code, roomMsg.code);

  const peerMsg = await hostPeerPromise;
  assert.equal(peerMsg.t, 'peer');
  assert.equal(peerMsg.role, 'guest');

  const guestSignalPromise = waitMsg(guest);
  host.send(JSON.stringify({ t: 'signal', data: { sdp: 'offer-data' } }));
  const relayed = await guestSignalPromise;
  assert.equal(relayed.t, 'signal');
  assert.equal(relayed.data.sdp, 'offer-data');

  const hostLeftPromise = waitMsg(host);
  guest.close();
  const leftMsg = await hostLeftPromise;
  assert.equal(leftMsg.t, 'peer-left');

  host.close();
  await new Promise((r) => server.close(r));
});

test('rejects disallowed origin', async () => {
  const port = await startServer();
  const base = `ws://127.0.0.1:${port}/ws`;

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(base, { origin: 'https://evil.example.com' });
    ws.once('open', () => {
      reject(new Error('should not connect'));
    });
    ws.once('unexpected-response', (req, res) => {
      assert.equal(res.statusCode, 403);
      resolve();
    });
    ws.once('error', () => {
      // some environments surface as error instead of unexpected-response
      resolve();
    });
  });

  await new Promise((r) => server.close(r));
});
