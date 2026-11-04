import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../shared/game.js';
import { newRoom, roomView, applyGameAction, saveGame } from '../server/room-core.js';
import { GameRoom } from '../server/worker.js';
import { syncHumanTimers, humanTimeoutAction } from '../server/human-timing.js';

function fixture() {
  const room = newRoom('A2C4E6', 'a', '测试', '甲');
  room.members = [
    { id: 'a', name: '甲' },
    { id: 'b', name: '乙' },
    { id: 'c', name: '丙' }
  ];
  room.game = new Game({ count: 3, demo: false, seed: 73 });
  room.status = 'playing';
  return room;
}
test('真人回合每步 30 秒，元数据更新不重置，计时仅展示给对应玩家', () => {
  const room = fixture();
  assert.equal(syncHumanTimers(room, 1000), 31000);
  const timer = room.humanTimers[0];
  syncHumanTimers(room, 5000);
  assert.deepEqual(room.humanTimers[0], timer);
  assert.equal(roomView(room, 'a').humanTimer.id, timer.id);
  assert.equal(roomView(room, 'b').humanTimer, undefined);
  room.spectators = [{ id: 'viewer', name: '观战' }];
  assert.equal(roomView(room, 'viewer').humanTimer, undefined);
  delete room.humanTimers[0];
  syncHumanTimers(room, 6000);
  assert.equal(room.humanTimers[0].deadline, 36000);
  assert.notEqual(room.humanTimers[0].id, timer.id);
});
test('广播并发回应和结算各 10 秒，逃生 10 秒，其他人操作不重置计时', () => {
  const room = fixture(),
    game = room.game;
  game.pending = { kind: 'broadcast', publicId: 'batch', caster: 0, decisions: [], responses: [] };
  syncHumanTimers(room, 1000);
  assert.equal(room.humanTimers[1].deadline, 11000);
  assert.equal(room.humanTimers[2].deadline, 11000);
  const second = room.humanTimers[2].id;
  game.pending.decisions.push(1);
  syncHumanTimers(room, 5000);
  assert.equal(room.humanTimers[2].id, second);
  assert.equal(room.humanTimers[2].deadline, 11000);
  game.pending.decisions.push(2);
  game.pending.responses = [{ actor: 1 }, { actor: 2 }];
  syncHumanTimers(room, 7000);
  assert.equal(room.humanTimers[0].deadline, 17000);
  assert.deepEqual(humanTimeoutAction(room, 0), { type: 'settle', chosen: 1 });
  game.pending = { kind: 'escape', victim: 2, strikeId: 'hit' };
  syncHumanTimers(room, 8000);
  assert.equal(room.humanTimers[2].deadline, 18000);
  assert.deepEqual(humanTimeoutAction(room, 2), { type: 'escape', use: false });
});
test('广播超时按强制规则选择合法牌，其他情况不回应', () => {
  const room = fixture(),
    game = room.game;
  game.pending = { kind: 'broadcast', publicId: 'batch', caster: 0, decisions: [], responses: [] };
  syncHumanTimers(room, 1000);
  game.isForced = () => true;
  game.responseOptions = () => [{ id: 'first' }, { id: 'second' }];
  assert.deepEqual(
    humanTimeoutAction(room, 1, () => 0),
    { type: 'respond', cardId: 'first' }
  );
  assert.deepEqual(
    humanTimeoutAction(room, 1, () => 0.99),
    { type: 'respond', cardId: 'second' }
  );
  game.isForced = () => false;
  assert.deepEqual(humanTimeoutAction(room, 1), { type: 'respond' });
});
test('服务器只允许本人为当前操作加时一次，并拒绝旧按钮', async () => {
  const jobs = [],
    storage = { async get() {}, async setAlarm() {}, async deleteAlarm() {} };
  const ctx = {
    storage,
    blockConcurrencyWhile: (fn) => {
      const p = fn();
      jobs.push(p);
      return p;
    }
  };
  const instance = new GameRoom(ctx, {});
  await jobs[0];
  instance.room = fixture();
  syncHumanTimers(instance.room);
  instance.commit = async () => syncHumanTimers(instance.room);
  const timer = instance.room.humanTimers[0],
    deadline = timer.deadline;
  const call = (user, id) =>
    instance.fetch(
      new Request('https://internal/', {
        method: 'POST',
        headers: { 'x-session': user, 'x-operation': 'extend-time' },
        body: JSON.stringify({ timerId: id })
      })
    );
  assert.equal((await call('b', timer.id)).status, 409);
  assert.equal((await call('a', 'stale')).status, 409);
  assert.equal((await call('a', timer.id)).status, 200);
  assert.equal(instance.room.humanTimers[0].deadline, deadline + 30000);
  assert.equal((await call('a', timer.id)).status, 409);
});
test('回合超时由服务器结束行动并补牌，脱离客户端也生效', async () => {
  const jobs = [],
    storage = { async get() {}, async setAlarm() {}, async deleteAlarm() {} };
  const ctx = {
    storage,
    blockConcurrencyWhile: (fn) => {
      const p = fn();
      jobs.push(p);
      return p;
    }
  };
  const instance = new GameRoom(ctx, {});
  await jobs[0];
  instance.room = fixture();
  const game = instance.room.game;
  game.players[0].hand.splice(1);
  syncHumanTimers(instance.room);
  instance.room.humanTimers[0].deadline = Date.now() - 1;
  let audit;
  instance.commit = async (entry) => {
    audit = entry;
    syncHumanTimers(instance.room);
  };
  await instance.alarm();
  assert.equal(audit.operation, 'human-timeout');
  assert.equal(audit.action.type, 'end');
  assert.equal(game.players[0].hand.length, 4);
  assert.equal(game.active, 1);
});

test('被点名的广播超时自动打出合法回应牌并完成结算', async () => {
  const jobs = [],
    storage = { async get() {}, async setAlarm() {}, async deleteAlarm() {} };
  const ctx = {
    storage,
    blockConcurrencyWhile: (fn) => {
      const p = fn();
      jobs.push(p);
      return p;
    }
  };
  const instance = new GameRoom(ctx, {});
  await jobs[0];
  instance.room = fixture();
  const room = instance.room,
    game = room.game;
  game.players[0].hand = [{ id: 'broadcast', key: 'hyper_c' }];
  game.players[0].energy = 10;
  game.players[1].hand = [{ id: 'response', key: 'stellar_c' }];
  game.players[1].builds = [];
  game.players[1].energy = 10;
  game.players[2].hand = [{ id: 'building', key: 'solar' }];
  applyGameAction(room, 0, { type: 'play', cardId: 'broadcast', target: game.players[1].galaxy });
  assert.equal(game.isForced(1), true);
  syncHumanTimers(room);
  room.humanTimers[1].deadline = Date.now() - 1;
  let audit;
  instance.commit = async (entry) => {
    audit = entry;
    syncHumanTimers(room);
  };
  await instance.alarm();
  assert.deepEqual(audit.action, { type: 'respond', cardId: 'response' });
  assert.equal(game.pending, null);
  assert.equal(
    game.players[1].hand.some((card) => card.id === 'response'),
    false
  );
});

test('逃生选择超时由服务器放弃，文明出局', async () => {
  const jobs = [],
    storage = { async get() {}, async setAlarm() {}, async deleteAlarm() {} };
  const ctx = {
    storage,
    blockConcurrencyWhile: (fn) => {
      const p = fn();
      jobs.push(p);
      return p;
    }
  };
  const instance = new GameRoom(ctx, {});
  await jobs[0];
  instance.room = fixture();
  const room = instance.room,
    game = room.game,
    victim = game.players[0];
  victim.energy = 10;
  victim.builds = [];
  victim.hand = [{ id: 'escape', key: 'lightship' }];
  const strike = {
    id: 'strike',
    card: { id: 'strike', key: 'nuclear' },
    owner: 1,
    target: victim.galaxy,
    progress: 1,
    required: 1
  };
  game.strikes.push(strike);
  game.impact(strike);
  game.flush();
  assert.equal(game.pending.kind, 'escape');
  syncHumanTimers(room);
  room.humanTimers[0].deadline = Date.now() - 1;
  let audit;
  instance.commit = async (entry) => {
    audit = entry;
    syncHumanTimers(room);
  };
  await instance.alarm();
  assert.deepEqual(audit.action, { type: 'escape', use: false });
  assert.equal(victim.alive, false);
});

test('旧的进行中房间恢复后启动计时，再次休眠恢复保留原截止时间', async () => {
  const entries = new Map(),
    jobs = [];
  let alarm = null;
  const storage = {
    async get(key) {
      return Array.isArray(key)
        ? new Map(
            key.filter((k) => entries.has(k)).map((k) => [k, structuredClone(entries.get(k))])
          )
        : structuredClone(entries.get(key));
    },
    async put(key, value) {
      for (const [k, v] of typeof key === 'object' ? Object.entries(key) : [[key, value]])
        entries.set(k, structuredClone(v));
    },
    async delete(key) {
      entries.delete(key);
    },
    async getAlarm() {
      return alarm;
    },
    async setAlarm(at) {
      alarm = at;
    },
    async deleteAlarm() {
      alarm = null;
    }
  };
  const ctx = {
    storage,
    blockConcurrencyWhile: (fn) => {
      const p = fn();
      jobs.push(p);
      return p;
    }
  };
  const old = fixture();
  old.game = saveGame(old.game);
  await storage.put('room', old);
  const first = new GameRoom(ctx, {});
  await jobs.at(-1);
  const timer = structuredClone(first.room.humanTimers[0]);
  assert.ok(timer.id);
  assert.equal(alarm, timer.deadline);
  const second = new GameRoom(ctx, {});
  await jobs.at(-1);
  assert.deepEqual(second.room.humanTimers[0], timer);
  assert.equal(alarm, timer.deadline);
});
