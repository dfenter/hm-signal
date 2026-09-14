import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8787;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_ROOMS = 200;
const MAX_MSG_BYTES = 64 * 1024;
const ROOM_TTL_MS = 10 * 60 * 1000;
const PING_INTERVAL_MS = 25 * 1000;

const ALLOWED_ORIGINS = [
  'https://new.greenguard-usa.com',
  'https://greenguard-usa.com',
  'https://www.greenguard-usa.com',
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return true;
  if (/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return true;
  return false;
}

const rooms = new Map(); // code -> { host, guest, createdAt, timer }

function genCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function destroyRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  clearTimeout(room.timer);
  rooms.delete(code);
}

function otherPeer(room, ws) {
  return room.host === ws ? room.guest : room.host;
}

function handleLeave(ws) {
  const code = ws.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  const peer = otherPeer(room, ws);
  if (peer) {
    send(peer, { t: 'peer-left' });
    peer.roomCode = null;
  }
  destroyRoom(code);
  ws.roomCode = null;
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false }));
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws') {
    socket.destroy();
    return;
  }
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.roomCode = null;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    if (raw.length > MAX_MSG_BYTES) {
      send(ws, { t: 'err', reason: 'too-large' });
      return;
    }
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;

    switch (msg.t) {
      case 'host': {
        if (rooms.size >= MAX_ROOMS) {
          send(ws, { t: 'err', reason: 'busy' });
          return;
        }
        const code = genCode();
        const timer = setTimeout(() => {
          const room = rooms.get(code);
          if (room) {
            if (room.host) { room.host.roomCode = null; }
            if (room.guest) { send(room.guest, { t: 'peer-left' }); room.guest.roomCode = null; }
            destroyRoom(code);
          }
        }, ROOM_TTL_MS);
        timer.unref();
        rooms.set(code, { host: ws, guest: null, createdAt: Date.now(), timer });
        ws.roomCode = code;
        send(ws, { t: 'room', code });
        break;
      }
      case 'join': {
        const code = msg.code;
        const room = rooms.get(code);
        if (!room) {
          send(ws, { t: 'err', reason: 'no-room' });
          return;
        }
        if (room.guest) {
          send(ws, { t: 'err', reason: 'full' });
          return;
        }
        room.guest = ws;
        ws.roomCode = code;
        send(ws, { t: 'joined', code });
        send(room.host, { t: 'peer', role: 'guest' });
        break;
      }
      case 'signal': {
        const code = ws.roomCode;
        if (!code) return;
        const room = rooms.get(code);
        if (!room) return;
        const peer = otherPeer(room, ws);
        if (peer) {
          send(peer, { t: 'signal', data: msg.data });
        }
        break;
      }
      case 'leave': {
        handleLeave(ws);
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    handleLeave(ws);
  });
});

const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      handleLeave(ws);
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, PING_INTERVAL_MS);
pingInterval.unref();

wss.on('close', () => {
  clearInterval(pingInterval);
});

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  server.listen(PORT, () => {
    console.log(`hm-signal listening on ${PORT}`);
  });
}

export { server, wss, rooms };
