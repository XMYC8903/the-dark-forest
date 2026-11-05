import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../shared/game.js';
import { newRoom, appendDeepSeekUpdates } from '../server/room-core.js';
import { decideDeepSeek, candidateActions, publicCommand } from '../server/deepseek.js';

const UUID_GLOBAL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function uuidRoom() {
  const room = newRoom('A2C4E6', 'host', '测试', 'host');
  room.members = Array.from({ length: 3 }, (_, i) => ({
    id: 'bot' + i,
    name: 'AI' + i,
    bot: 'deepseek'
  }));
  room.game = new Game({ count: 3, demo: false, seed: 31 });
  // Online rooms replace every physical card id with a UUID.
  room.game.allPhysicalCards().forEach((c) => (c.id = crypto.randomUUID()));
  room.status = 'playing';
  appendDeepSeekUpdates(room);
  return room;
}

test('提示词里的长 UUID 折叠成会话内短别名，且同一 id 始终同一别名', () => {
  const room = uuidRoom(),
    session = room.deepseekSessions.bot0;
  const text = session.messages.map((m) => m.content).join('\n');
  assert.equal(text.match(UUID_GLOBAL), null, '提示词不应残留 36 字符 UUID');
  const aliases = Object.values(session.aliases);
  assert.ok(aliases.length > 0);
  for (const alias of aliases) assert.match(alias, /^k\d+$/);
  const firstUuid = Object.keys(session.aliases)[0],
    alias = session.aliases[firstUuid];
  assert.equal(session.aliases[firstUuid], alias, '同一 UUID 的别名必须稳定');
});

test('别名只作用于提示词，动作仍能按真实 id 结算', async () => {
  const room = uuidRoom();
  const seat = room.deepseekSessions.bot0;
  const before = room.game.allPhysicalCards().length;
  const action = await decideDeepSeek(
    room.game,
    0,
    room.intel,
    'fake',
    async (_url, init) => {
      const body = JSON.parse(init.body);
      const payload = JSON.parse(body.messages.at(-1).content.split('当前局面：')[1]);
      assert.equal(body.messages.at(-1).content.match(UUID_GLOBAL), null);
      assert.equal(payload.legalActions, undefined);
      const play = candidateActions(room.game, 0).find((x) => x.type === 'play') || { type: 'end' };
      return Response.json({
        choices: [{ message: { content: JSON.stringify(publicCommand(room.game, 0, play)) } }]
      });
    },
    seat,
    null,
    null
  );
  assert.ok(action);
  assert.equal(room.game.allPhysicalCards().length, before, '模型回复不应改变牌堆总数');
});

test('进行中的旧会话同时迁移历史与当前提示词，动作仍使用真实编号', async () => {
  const room = uuidRoom(),
    game = room.game,
    session = room.deepseekSessions.bot0;
  game.players[0].energy = 100;
  const card = game.players[0].hand.find((c) => c.key !== 'lightship'),
    uuid = card.id,
    alias = session.aliases[uuid];
  for (const message of session.messages) message.content = message.content.replaceAll(alias, uuid);
  delete session.aliases;
  delete session.aliasVersion;
  let emitted;
  const action = await decideDeepSeek(
    game,
    0,
    room.intel,
    'fake',
    async (_url, init) => {
      const body = JSON.parse(init.body),
        last = JSON.parse(body.messages.at(-1).content.split('当前局面：')[1]);
      const candidate = candidateActions(game, 0).find((c) => c.cardId === uuid);
      assert.ok(candidate);
      const command = publicCommand(game, 0, candidate);
      emitted = command.card;
      assert.ok(last.state.players[0].hand.includes(emitted));
      assert.ok(body.messages[1].content.includes(session.aliases[uuid]));
      assert.equal(body.messages[1].content.includes(uuid), false);
      return Response.json({ choices: [{ message: { content: JSON.stringify(command) } }] });
    },
    session
  );
  assert.equal(action.cardId, uuid);
  assert.ok(emitted);
});
