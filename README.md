# hm-signal

Tiny WebRTC signaling relay for Horde Meridian 2-player co-op.

Protocol (JSON over `/ws`): `{t:'host'}` -> `{t:'room',code}`. `{t:'join',code}` -> `{t:'joined',code}` to guest, `{t:'peer',role:'guest'}` to host, or `{t:'err',reason}`. `{t:'signal',data}` relayed verbatim to the other peer. `{t:'leave'}` or disconnect -> other peer gets `{t:'peer-left'}`.

Rooms use a 4-char code (no confusable chars), expire after 10 minutes, max 200 concurrent. `GET /health` returns `{ok:true,rooms:N}`.

Local run: `npm install && npm start` (PORT env var, default 8787).

Deploy: Render web service, `npm ci --omit=dev` build, `npm start` start, health check `/health`.

Test: `npm test`.
