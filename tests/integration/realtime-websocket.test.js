import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';

import { createRealtimeHttpServer } from '../../server/index.js';

test('WebSocket proxy forwards one contextual turn in order and relays the grouped response', async (t) => {
  const upstreamEvents = [];
  const serverLogs = [];
  let upstreamAuthorization;
  let upstreamBetaHeader;
  const mockOpenAI = new WebSocketServer({ port: 0 });
  await once(mockOpenAI, 'listening');
  t.after(() => mockOpenAI.close());

  mockOpenAI.on('connection', (socket, request) => {
    upstreamAuthorization = request.headers.authorization;
    upstreamBetaHeader = request.headers['openai-beta'];
    socket.send(JSON.stringify({ type: 'session.created', session: { id: 'mock-session' } }));
    socket.on('message', (raw) => {
      const event = JSON.parse(raw.toString());
      upstreamEvents.push(event);
      if (event.type === 'response.create') {
        socket.send(JSON.stringify({
          type: 'response.output_audio_transcript.done',
          transcript: 'Grouped response for turn-1',
        }));
      }
    });
  });

  const upstreamAddress = mockOpenAI.address();
  const server = createRealtimeHttpServer({
    appMode: 'live',
    openAIKey: 'test-websocket-proxy-token',
    upstreamWebSocketUrl: `ws://127.0.0.1:${upstreamAddress.port}/v1/realtime`,
    verbose: false,
    logger: { log(message) { serverLogs.push(message); }, error() {} },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const address = server.address();
  const client = new WebSocket(`ws://127.0.0.1:${address.port}/api/realtime/ws?model=gpt-realtime-2.1-mini`);
  await once(client, 'open');
  t.after(() => client.close());

  const received = [];
  client.on('message', (raw) => received.push(JSON.parse(raw.toString())));
  client.send(JSON.stringify({
    type: 'app.turn',
    turn_id: 'turn-1',
    context: { screen_summary: 'A red square in the canvas center.' },
    events: [
      {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'turn_id=turn-1\nscreen_summary: A red square in the canvas center.' }],
        },
      },
      { type: 'input_audio_buffer.append', audio: 'AQIDBA==' },
      { type: 'input_audio_buffer.commit' },
      { type: 'response.create' },
    ],
  }));

  await assertEventually(() => upstreamEvents.length === 4);
  assert.equal(upstreamAuthorization, 'Bearer test-websocket-proxy-token');
  assert.equal(upstreamBetaHeader, undefined);
  assert.deepEqual(upstreamEvents.map((event) => event.type), [
    'conversation.item.create',
    'input_audio_buffer.append',
    'input_audio_buffer.commit',
    'response.create',
  ]);
  assert.ok(upstreamEvents.every((event) => event.event_id.startsWith('turn-1:')));
  assert.match(upstreamEvents[0].item.content[0].text, /screen_summary: A red square/);
  await assertEventually(() => received.some((event) => event.type === 'app.turn.forwarded'));
  await assertEventually(() => received.some((event) => event.transcript === 'Grouped response for turn-1'));
  assert.deepEqual(serverLogs, []);
});

async function assertEventually(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('condition was not met before timeout');
}
