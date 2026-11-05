import {
  newRoom,
  roomView,
  roomSummary,
  mutateRoom,
  roomSpectators,
  saveGame,
  restoreGame,
  gameView,
  spectatorGameView,
  observerIntelView,
  gatherIntel,
  applyGameAction,
  requireThat,
  normalizeBotNames,
  appendDeepSeekUpdates
} from './room-core.js';
import { decideAI } from './ai.js';
import { decideDeepSeek } from './deepseek.js';
import { nextAIActionAt } from './ai-timing.js';
import { syncHumanTimers, humanTimeoutAction } from './human-timing.js';
import { AccountHub, accountPrincipal, randomCode } from './accounts.js';
import { logParts, readLog, putRecords } from './private-logs.js';
import { packSession, readSession, dropSession } from './session-store.js';
export { AccountHub };

const DEEPSEEK_THINKING_TIMEOUT_MS = 35000;

const json = (data, status = 200, extra = {}) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
const fail = (error) => json({ error: error.message || '服务器暂时不可用' }, error.status || 400);
const stub = (binding, id) => binding.get(binding.idFromName(id));
const serialized = (room) => ({ ...room, game: saveGame(room.game) });
const revived = (data) => {
  if (!data) return null;
  const room = normalizeBotNames({ ...data, game: restoreGame(data.game) });
  roomSpectators(room);
  return room;
};
const hub = (env, path, body, headers = {}) =>
  stub(env.ACCOUNTS, 'accounts').fetch(
    new Request('https://internal' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body || {})
    })
  );
const sessionCookie = (token, secure) =>
  'df_session=' +
  token +
  '; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000' +
  (secure ? '; Secure' : '');
async function roomAccess(env, id, room = null) {
  const r = await hub(env, '/internal/room-access', { id, room });
  if (!r.ok) {
    const d = await r.json();
    requireThat(false, d.error, r.status);
  }
}
async function bodyOf(request) {
  const raw = await request.text();
  requireThat(raw.length <= 16384, '请求内容过大', 413);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error('请求格式无效');
  }
}
function originAllowed(request) {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      const asset = await env.ASSETS.fetch(request);
      if (url.pathname === '/' || /\.(?:html|js|css)$/i.test(url.pathname)) {
        const headers = new Headers(asset.headers);
        headers.set('Cache-Control', 'no-store, max-age=0');
        return new Response(asset.body, {
          status: asset.status,
          statusText: asset.statusText,
          headers
        });
      }
      return asset;
    }
    try {
      requireThat(originAllowed(request), '请求来源不匹配', 403);
      const found = request.headers
        .get('Cookie')
        ?.match(/(?:^|;\s*)df_session=([a-f0-9-]{36})(?:;|$)/i)?.[1];
      const session = found || crypto.randomUUID();
      const cookie = sessionCookie(session, url.protocol === 'https:');
      if (url.pathname.startsWith('/api/admin/logs')) {
        requireThat(
          env.ADMIN_LOG_TOKEN &&
            request.headers.get('Authorization') === 'Bearer ' + env.ADMIN_LOG_TOKEN,
          '管理员认证失败',
          403
        );
        requireThat(request.method === 'GET', '方法不支持', 405);
        const code = url.pathname.match(/^\/api\/admin\/logs\/([A-Za-z0-9]{6,8})$/)?.[1];
        if (!code) {
          requireThat(url.pathname === '/api/admin/logs', '接口不存在', 404);
          return stub(env.LOBBY, 'directory').fetch(
            new Request('https://internal/internal/log-index')
          );
        }
        return stub(env.ROOMS, code.length === 6 ? code.toUpperCase() : code.toLowerCase()).fetch(
          new Request('https://internal/internal/logs' + url.search)
        );
      }
      if (/^\/api\/auth\/(register|login|logout)$/.test(url.pathname)) {
        requireThat(request.method === 'POST', '方法不支持', 405);
        const authBody = await bodyOf(request);
        const response = await hub(env, url.pathname.slice(4), authBody, {
          'x-auth-token': found || '',
          'x-client-ip': request.headers.get('CF-Connecting-IP') || 'local'
        });
        const result = await response.json();
        if (!response.ok) return json(result, response.status);
        if (
          result.account &&
          found &&
          /^(?:[A-Z0-9]{6}|[a-f0-9]{8})$/.test(authBody.legacyRoom || '')
        ) {
          await stub(env.ROOMS, authBody.legacyRoom).fetch(
            new Request('https://internal/internal/claim-legacy', {
              method: 'POST',
              body: JSON.stringify({ session: found, account: result.account })
            })
          );
        }
        const token = result.token || crypto.randomUUID();
        delete result.token;
        return json(result, response.status, {
          'Set-Cookie': sessionCookie(token, url.protocol === 'https:')
        });
      }
      const resolved = await (
        await hub(env, '/internal/resolve', {
          token: found || '',
          touch: url.pathname === '/api/session'
        })
      ).json();
      if (url.pathname === '/api/session')
        return json({ ok: true, account: resolved.account }, 200, { 'Set-Cookie': cookie });
      requireThat(resolved.account, '请先注册或登录账号', 401);
      const account = resolved.account,
        principal = accountPrincipal(account.id);
      const headers = new Headers(request.headers);
      headers.set('x-session', principal);
      headers.set('x-account', encodeURIComponent(JSON.stringify(account)));
      headers.set('x-auth-token', found);
      headers.delete('cookie');
      const replayMatch = url.pathname.match(/^\/api\/replays\/([a-f0-9-]{36})$/);
      const replaySaveMatch = url.pathname.match(
        /^\/api\/rooms\/([A-Za-z0-9]{6}|[a-f0-9]{8})\/replay-save$/
      );
      if (url.pathname === '/api/replays') {
        requireThat(request.method === 'GET', '方法不支持', 405);
        return hub(env, '/replays/list', {}, { 'x-auth-token': found });
      }
      if (replayMatch) {
        requireThat(request.method === 'GET', '方法不支持', 405);
        const response = await hub(
          env,
          '/replays/get',
          { matchId: replayMatch[1] },
          { 'x-auth-token': found }
        );
        if (!response.ok) return response;
        const result = await response.json();
        if (!result.reference) return json(result);
        return stub(env.ROOMS, result.reference.roomId).fetch(
          new Request('https://internal/internal/replay-from-log', {
            method: 'POST',
            body: JSON.stringify(result.reference)
          })
        );
      }
      if (replaySaveMatch) {
        requireThat(request.method === 'POST', '方法不支持', 405);
        const code =
          replaySaveMatch[1].length === 6 ? replaySaveMatch[1].toUpperCase() : replaySaveMatch[1];
        return stub(env.ROOMS, code).fetch(
          new Request('https://internal/internal/replay-save', {
            method: 'POST',
            headers: { 'x-session': principal, 'x-account': headers.get('x-account') || '' }
          })
        );
      }
      if (url.pathname.startsWith('/api/social/')) {
        const op = url.pathname.slice(4),
          body = request.method === 'POST' ? await bodyOf(request) : {};
        requireThat(request.method === 'POST' || op === '/social/state', '方法不支持', 405);
        requireThat(!body.consume, '操作不允许', 403);
        if (op === '/social/invite') {
          const code = String(body.room || '').toUpperCase();
          requireThat(/^[A-Z0-9]{6}$/.test(code), '房间码无效');
          const viewResponse = await stub(env.ROOMS, code).fetch(
            new Request('https://internal/', {
              headers: { 'x-session': principal, 'x-operation': 'state' }
            })
          );
          const view = await viewResponse.json();
          requireThat(viewResponse.ok, view.error || '你不在该房间', 403);
          requireThat(view.isHost, '只有房主可以邀请好友', 403);
          requireThat(
            view.status === 'waiting' && view.count < 6,
            '只能邀请好友加入有空位的等待房间'
          );
          body.room = code;
          body.roomName = view.name;
        }
        const response = await hub(env, op, body, { 'x-auth-token': found });
        if (op === '/social/watch-friend' && response.ok) {
          const target = await response.json(),
            code = target.room;
          await roomAccess(env, account.id, code);
          return await stub(env.ROOMS, code).fetch(
            new Request('https://internal/', {
              method: 'POST',
              headers: {
                'x-session': principal,
                'x-account': encodeURIComponent(JSON.stringify(account)),
                'x-operation': 'watch-friend'
              },
              body: JSON.stringify({ friendId: target.friendId, requestId: body.requestId })
            })
          );
        }
        if (op !== '/social/invitation' || !response.ok || body.accept !== true) return response;
        const data = await response.json(),
          code = data.invite.room;
        await roomAccess(env, account.id, code);
        const joined = await stub(env.ROOMS, code).fetch(
          new Request('https://internal/', {
            method: 'POST',
            headers: {
              'x-session': principal,
              'x-account': encodeURIComponent(JSON.stringify(account)),
              'x-operation': 'join'
            },
            body: JSON.stringify({
              username: account.name,
              accountId: account.id,
              requestId: body.requestId
            })
          })
        );
        if (joined.ok) await hub(env, op, { ...body, consume: true }, { 'x-auth-token': found });
        return joined;
      }
      const match = url.pathname.match(
        /^\/api\/rooms\/([A-Za-z0-9]{6}|[a-f0-9]{8})(?:\/(join|leave|watch|bot|remove|start|rematch|action|extend-time|rename|recording|ws))?$/
      );
      if (match) {
        headers.set('x-operation', match[2] || 'state');
        const code = match[1].length === 6 ? match[1].toUpperCase() : match[1];
        if (request.method === 'POST' && ['join', 'watch'].includes(match[2]))
          await roomAccess(env, account.id, code);
        return await stub(env.ROOMS, code).fetch(new Request(request, { headers }));
      }
      requireThat(url.pathname === '/api/rooms', '接口不存在', 404);
      requireThat(request.method === 'POST', '请输入房间码加入，房间列表已关闭', 405);
      await roomAccess(env, account.id);
      return await stub(env.LOBBY, 'directory').fetch(new Request(request, { headers }));
    } catch (error) {
      return fail(error);
    }
  }
};

export class RoomDirectory {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/internal/log-index') {
        const logs = [...(await this.ctx.storage.list({ prefix: 'log:' })).values()].sort(
          (a, b) => b.at - a.at
        );
        return json({ matches: logs.slice(0, 100) });
      }
      if (url.pathname === '/internal/update') {
        const summary = await request.json();
        if (summary.matchId)
          await this.ctx.storage.put('log:' + summary.matchId, {
            room: summary.id,
            matchId: summary.matchId,
            name: summary.name,
            status: summary.status,
            at: summary.updatedAt
          });
        if (summary.status === 'closed') await this.ctx.storage.delete(summary.id);
        else await this.ctx.storage.put(summary.id, summary);
        return json({ ok: true });
      }
      const entries = await this.ctx.storage.list();
      const fresh = [...entries.entries()]
        .filter(
          ([key, r]) =>
            !key.startsWith('log:') && r.updatedAt > Date.now() - 86400000 && r.status !== 'closed'
        )
        .map(([, r]) => r);
      const session = request.headers.get('x-session'),
        body = await bodyOf(request);
      requireThat(
        fresh.filter((r) => r.owner === session && r.status !== 'finished').length < 3,
        '你已有 3 个房间，请继续已有房间'
      );
      let id;
      do {
        id = randomCode(6);
      } while (entries.has(id) || (await this.ctx.storage.get('reserved:' + id)));
      await this.ctx.storage.put('reserved:' + id, true);
      const account = JSON.parse(decodeURIComponent(request.headers.get('x-account')));
      const response = await stub(this.env.ROOMS, id).fetch(
        new Request('https://internal/init', {
          method: 'POST',
          body: JSON.stringify({
            ...body,
            id,
            session,
            username: account.name,
            accountId: account.id
          })
        })
      );
      const result = await response.json();
      if (!response.ok) return json(result, response.status);
      await this.ctx.storage.put(id, { ...result.summary, owner: session });
      return json(result.view, 201);
    } catch (error) {
      return fail(error);
    }
  }
}

export class GameRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.room = null;
    this.rates = new Map();
    this.pendingDeepseekMetrics = new Map();
    ctx.blockConcurrencyWhile(async () => {
      const envelope = await ctx.storage.get('room');
      this.roomBlob = envelope?.chunked ? envelope : null;
      const saved = this.roomBlob
        ? await readLog(ctx.storage, this.roomBlob.key, this.roomBlob)
        : envelope;
      this.room = revived(saved);
      this.sessionRefs = saved?.deepseekSessionRefs || {};
      this.sessionTexts = {};
      if (this.room && saved?.deepseekSessionRefs) {
        this.room.deepseekSessions = {};
        for (const [id, ref] of Object.entries(this.sessionRefs)) {
          const session = await readSession(ctx.storage, ref);
          this.room.deepseekSessions[id] = session;
          this.sessionTexts[id] = JSON.stringify(session);
        }
        delete this.room.deepseekSessionRefs;
      }
      if (this.room?.status === 'playing' && !this.room.humanTimers) {
        const humanAt = syncHumanTimers(this.room);
        await this.persistRoom();
        if (Number.isFinite(humanAt)) {
          const current = await ctx.storage.getAlarm();
          if (!current || humanAt < current) await ctx.storage.setAlarm(humanAt);
        }
      }
      // Persist schema upgrades before hibernation, so broadcast batch IDs stay stable on reconnect.
      if (
        saved &&
        (!Array.isArray(saved.spectators) ||
          (saved.game?.pending?.kind === 'broadcast' && !saved.game.pending.publicId) ||
          saved.members.some((p) => p.bot && /^(简单|普通|困难) AI \d+$/.test(p.name)))
      ) {
        this.room.revision++;
        await this.persistRoom();
      }
    });
  }
  async fetch(request) {
    try {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/internal/replay-from-log') {
        requireThat(request.method === 'POST', '方法不支持', 405);
        const reference = await request.json();
        requireThat(/^[a-f0-9-]{36}$/i.test(reference.matchId || ''), '回放编号无效');
        return json({ replay: await this.replayFromLog(reference) });
      }
      if (pathname === '/internal/replay-save') {
        requireThat(request.method === 'POST', '方法不支持', 405);
        requireThat(
          this.room && this.room.game?.over && ['finished', 'closed'].includes(this.room.status),
          '本局尚未结束'
        );
        const session = request.headers.get('x-session');
        requireThat(
          this.room.members.some((p) => p.id === session && !p.exited && !p.bot) ||
            roomSpectators(this.room).some((p) => p.id === session),
          '你已退出这个房间',
          403
        );
        requireThat(this.room.saveReplay !== false, '房主关闭了本局录像保存');
        const accountHeader = request.headers.get('x-account');
        if (accountHeader)
          try {
            const account = JSON.parse(decodeURIComponent(accountHeader));
            if (/^[A-Z0-9]{8}$/.test(account?.id || '')) {
              this.room.replayAccountIds = [
                ...new Set([...(this.room.replayAccountIds || []), account.id])
              ];
              await this.persistRoom();
            }
          } catch {}
        const result = await this.saveReplayArchiveWithRetry();
        requireThat(result?.saved > 0, '没有可保存回放的登录账号');
        return json({ ok: true, ...result });
      }
      if (pathname === '/internal/claim-legacy') {
        const { session, account } = await request.json();
        requireThat(this.room && this.room.status !== 'closed', '旧房间已关闭', 404);
        const p = this.room.members.find(
            (p) => p.id === session && !p.accountId && !p.exited && !p.bot
          ),
          s = roomSpectators(this.room).find((p) => p.id === session && !p.accountId) || null;
        requireThat(p || s, '没有可继承的旧浏览器座位', 403);
        requireThat(
          !this.room.members.some((p) => p.id === accountPrincipal(account.id)) &&
            !roomSpectators(this.room).some((p) => p.id === accountPrincipal(account.id)),
          '账号已有座位',
          409
        );
        for (const m of [p, s, s?.returnMember?.member].filter(Boolean)) {
          m.id = accountPrincipal(account.id);
          m.accountId = account.id;
          m.name = account.name;
        }
        if (this.room.host === session) this.room.host = accountPrincipal(account.id);
        if (p && this.room.game)
          this.room.game.players[this.room.members.indexOf(p)].name = account.name;
        this.room.revision++;
        this.room.updatedAt = Date.now();
        await this.commit({ operation: 'claim-legacy', actor: account.id });
        return json({ ok: true });
      }
      if (pathname === '/internal/logs') {
        const url = new URL(request.url),
          matchId = url.searchParams.get('match') || this.room?.matchId;
        requireThat(matchId && /^[a-f0-9-]{36}$/.test(matchId), '请指定有效的 match ID');
        const kind = url.searchParams.get('kind') === 'deepseek' ? 'deepseek' : 'game',
          cursor = url.searchParams.get('cursor') || '';
        const records = await this.ctx.storage.list({
          prefix: `audit:${matchId}:${kind}:`,
          ...(cursor ? { startAfter: cursor } : {}),
          limit: 1000
        });
        const metadata = [...records]
          .filter(
            ([key, value]) => !key.includes(':part:') && (value.parts || value.schemaVersion === 1)
          )
          .slice(0, 20);
        return json({
          room: this.room?.id,
          matchId,
          kind,
          entries: await Promise.all(
            metadata.map(([key, value]) =>
              value.parts ? readLog(this.ctx.storage, key, value) : value
            )
          ),
          nextCursor:
            metadata.length === 20
              ? metadata.at(-1)[1].parts
                ? metadata.at(-1)[0] + ':part:zzzz'
                : metadata.at(-1)[0]
              : null
        });
      }
      if (pathname === '/init') {
        return await this.ctx.blockConcurrencyWhile(async () => {
          requireThat(!this.room, '房间已存在');
          const { id, session, name, username, accountId } = await request.json();
          this.room = newRoom(id, session, name, username);
          this.room.members[0].accountId = accountId;
          await this.commit({ operation: 'create', actor: session });
          return json({ summary: roomSummary(this.room), view: roomView(this.room, session) });
        });
      }
      requireThat(this.room && this.room.status !== 'closed', '房间不存在或已关闭', 404);
      const session = request.headers.get('x-session'),
        operation = request.headers.get('x-operation');
      if (operation === 'ws') {
        requireThat(
          request.headers.get('Upgrade')?.toLowerCase() === 'websocket',
          '需要 WebSocket 连接',
          426
        );
        roomView(this.room, session);
        const [client, server] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ session, token: request.headers.get('x-auth-token') });
        server.send(JSON.stringify({ type: 'state', room: roomView(this.room, session) }));
        return new Response(null, { status: 101, webSocket: client });
      }
      if (operation === 'state') {
        requireThat(request.method === 'GET', '方法不支持', 405);
        return json(roomView(this.room, session));
      }
      requireThat(request.method === 'POST', '方法不支持', 405);
      const body = await bodyOf(request);
      const accountHeader = request.headers.get('x-account');
      if (accountHeader) {
        const account = JSON.parse(decodeURIComponent(accountHeader));
        body.username = account.name;
        body.accountId = account.id;
      }
      return await this.ctx.blockConcurrencyWhile(async () => {
        const now = Date.now(),
          rate = this.rates.get(session) || { at: now, count: 0 };
        if (now - rate.at > 60000) {
          rate.at = now;
          rate.count = 0;
        }
        requireThat(++rate.count <= 100, '操作过快，请稍后再试', 429);
        this.rates.set(session, rate);
        if (
          body.requestId &&
          this.room.receipts.some((r) => r.id === body.requestId && r.session === session)
        ) {
          try {
            return json(roomView(this.room, session));
          } catch {
            return json({ left: true });
          }
        }
        const backup =
          operation === 'extend-time'
            ? structuredClone(serialized(this.room))
            : serialized(this.room);
        try {
          if (operation === 'watch-friend') {
            requireThat(this.room.status === 'playing', '好友的对局已结束', 409);
            const friendPresent =
              this.room.members.some((p) => p.accountId === body.friendId && !p.exited && !p.bot) ||
              roomSpectators(this.room).some((p) => p.accountId === body.friendId);
            requireThat(friendPresent, '好友已离开该对局', 409);
            if (roomSpectators(this.room).some((p) => p.id === session))
              return json(roomView(this.room, session));
            requireThat(
              !this.room.members.some((p) => p.id === session && !p.exited),
              '你已在该对局中',
              409
            );
          }
          if (operation === 'bot' && body.level === 'deepseek')
            requireThat(
              Boolean(this.env.DEEPSEEK_API_KEY),
              '房间服务器尚未配置 DeepSeek API Key。请管理员先设置 DEEPSEEK_API_KEY。',
              503
            );
          if (operation === 'extend-time') {
            const seat = this.room.members.findIndex(
              (member) => member.id === session && !member.exited && !member.bot
            );
            const timer = this.room.humanTimers?.[seat];
            requireThat(
              seat >= 0 && timer && timer.id === body.timerId,
              '当前没有可加时的操作',
              409
            );
            requireThat(now < timer.deadline, '操作时间已结束', 409);
            requireThat(!timer.extended, '本次操作已经加时', 409);
            timer.deadline += 30000;
            timer.extended = true;
            this.room.revision++;
            this.room.updatedAt = now;
          } else {
            const seat = this.room.members.findIndex((member) => member.id === session);
            if (operation === 'action') {
              syncHumanTimers(this.room, now);
              const timer = this.room.humanTimers?.[seat];
              if (timer) requireThat(now < timer.deadline, '操作时间已结束', 409);
            }
            mutateRoom(
              this.room,
              session,
              operation === 'watch-friend' ? 'watch' : operation,
              body
            );
            if (operation === 'action' && this.room.humanTimers) delete this.room.humanTimers[seat];
          }
          if (body.requestId)
            this.room.receipts.push({ id: String(body.requestId).slice(0, 80), session });
          this.room.receipts = this.room.receipts.slice(-100);
          await this.commit({
            operation,
            actor: session,
            action: operation === 'action' ? body.action : null
          });
          if (
            operation === 'leave' ||
            (operation === 'watch' &&
              !this.room.members.some((p) => p.id === session && !p.exited) &&
              !roomSpectators(this.room).some((p) => p.id === session))
          )
            return json({ left: true });
          return json(roomView(this.room, session));
        } catch (error) {
          this.room = revived(backup);
          throw error;
        }
      });
    } catch (error) {
      return fail(error);
    }
  }
  nextBot() {
    if (this.room?.status !== 'playing' || this.room.aiThinking) return null;
    const game = this.room.game,
      b = game.pending;
    if (b?.autoSettleAt) return null;
    let indexes = [];
    if (b?.kind === 'escape') indexes = [b.victim];
    else if (b?.kind === 'broadcast') {
      indexes = game.players
        .filter((p) => p.alive && p.id !== b.caster && !b.decisions.includes(p.id))
        .map((p) => p.id);
      if (!indexes.length) indexes = [b.caster];
    } else indexes = [game.active];
    for (const me of indexes) {
      const level = this.room.members[me]?.bot;
      if (!level) continue;
      if (level === 'deepseek') return { me, level, action: null };
      const action = decideAI(gameView(game, me), me, level, this.room.intel);
      if (action) return { me, level, action };
    }
    return null;
  }
  async persistRoom(writes = {}) {
    const snapshot = serialized(this.room),
      sessions = snapshot.deepseekSessions || {};
    delete snapshot.deepseekSessions;
    const previousRefs = this.sessionRefs || {},
      previousTexts = this.sessionTexts || {};
    const nextRefs = {},
      nextTexts = {},
      abandoned = [];
    for (const [id, session] of Object.entries(sessions)) {
      const text = JSON.stringify(session);
      nextTexts[id] = text;
      if (previousRefs[id] && previousTexts[id] === text) nextRefs[id] = previousRefs[id];
      else {
        const packed = await packSession(text);
        Object.assign(writes, packed.writes);
        nextRefs[id] = packed.ref;
      }
    }
    for (const [id, ref] of Object.entries(previousRefs))
      if (nextRefs[id]?.key !== ref.key) abandoned.push(ref);
    snapshot.deepseekSessionRefs = nextRefs;
    const key = 'room-state:' + this.room.revision + ':' + crypto.randomUUID(),
      parts = logParts(key, snapshot),
      old = this.roomBlob;
    await putRecords(this.ctx.storage, { ...writes, ...parts });
    const newRoomBlob = { chunked: true, key, parts: parts[key].parts };
    await this.ctx.storage.put('room', newRoomBlob);
    this.roomBlob = newRoomBlob;
    this.sessionRefs = nextRefs;
    this.sessionTexts = nextTexts;
    // Cleanup happens only after the new root is durable. Failure may leave
    // orphaned chunks but must not roll back a successfully saved room.
    try {
      if (old) {
        const keys = Array.from({ length: old.parts }, (_, i) => old.key + ':part:' + i);
        keys.push(old.key);
        for (const k of keys) await this.ctx.storage.delete(k);
      }
      for (const ref of abandoned) await dropSession(this.ctx.storage, ref);
    } catch {
      console.warn('Old room or DeepSeek session chunks could not be removed');
    }
  }
  async recordDeepseekMetric(key, record) {
    const storage = this.ctx.storage,
      indexKey = 'deepseek-metric-retention',
      matchId = record.matchId;
    let matches = await storage.get(indexKey);
    const bootstrap = !Array.isArray(matches);
    if (!Array.isArray(matches)) {
      // Bootstrap once from existing compact metrics; never delete other logs.
      const found = new Map();
      let cursor = '';
      do {
        const page = await storage.list({
          prefix: 'audit:',
          ...(cursor ? { startAfter: cursor } : {}),
          limit: 1000
        });
        for (const [entry, value] of page) {
          const match = entry.match(/^audit:([a-f0-9-]{36}):deepseek:/i);
          if (match && value?.kind === 'deepseek' && (value.schemaVersion === 1 || value.parts))
            found.set(match[1], Math.max(found.get(match[1]) || 0, Number(value.at) || 0));
        }
        const keys = [...page.keys()];
        cursor = keys.length === 1000 ? keys.at(-1) : '';
      } while (cursor);
      matches = [...found].map(([id, at]) => ({ id, at }));
    }
    if (new TextEncoder().encode(JSON.stringify(record)).length > 100000) {
      const parts = logParts(key, record);
      parts[key].schemaVersion = 1;
      await putRecords(storage, parts);
    } else await storage.put(key, record);
    if (matches.some((m) => m.id === matchId)) {
      if (!bootstrap) return;
    } else matches.push({ id: matchId, at: record.at });
    matches.sort((a, b) => b.at - a.at);
    for (const stale of matches.slice(10)) {
      const prefix = `audit:${stale.id}:deepseek:`;
      let cursor = '';
      do {
        const page = await storage.list({
          prefix,
          ...(cursor ? { startAfter: cursor } : {}),
          limit: 1000
        });
        const keys = [...page.keys()];
        cursor = keys.length === 1000 ? keys.at(-1) : '';
        for (let i = 0; i < keys.length; i += 100) await storage.delete(keys.slice(i, i + 100));
      } while (cursor);
    }
    await storage.put(indexKey, matches.slice(0, 10));
  }
  async commit(audit = null) {
    if (this.room.game && !this.room.matchId) this.room.matchId = crypto.randomUUID();
    if (this.room.game && this.room.saveReplay !== false)
      this.room.replayAccountIds = [
        ...new Set([
          ...(this.room.replayAccountIds || []),
          ...this.room.members.filter((p) => !p.bot && p.accountId).map((p) => p.accountId),
          ...roomSpectators(this.room)
            .map((p) => p.accountId)
            .filter(Boolean)
        ])
      ];
    const humanAt = syncHumanTimers(this.room);
    appendDeepSeekUpdates(this.room);
    const botAt = nextAIActionAt(this.room, this.nextBot());
    const writes = {};
    let completedRecord = false;
    if (this.room.game && this.room.matchId) {
      const hasIntelCursor = Number.isInteger(this.room.auditIntelCursor),
        intelCursor = hasIntelCursor ? this.room.auditIntelCursor : 0;
      const intelDelta =
        hasIntelCursor || audit?.operation === 'start'
          ? structuredClone(
              observerIntelView(
                this.room.intel || [],
                this.room.observerIntelTargets || {},
                intelCursor
              )
            )
          : undefined;
      const motion =
        this.room.auditMotionSequence !== this.room.motionSequence
          ? structuredClone(this.room.motionBatches?.at(-1) || null)
          : null;
      const record = {
        kind: 'game',
        matchId: this.room.matchId,
        at: Date.now(),
        revision: this.room.revision,
        operation: audit?.operation || 'engine',
        actor: audit?.actor ?? null,
        action: audit?.action ?? null,
        status: this.room.status,
        members: this.room.members.map((p) => ({
          name: p.name,
          accountId: p.accountId || null,
          bot: p.bot
        })),
        events: motion?.events || [],
        motion,
        ...(intelDelta !== undefined ? { intelDelta } : {}),
        initial: audit?.operation === 'start',
        state: saveGame(this.room.game)
      };
      this.room.auditMotionSequence = this.room.motionSequence;
      if (intelDelta !== undefined) this.room.auditIntelCursor = (this.room.intel || []).length;
      completedRecord = this.room.status === 'finished' && this.room.game.over;
      Object.assign(
        writes,
        logParts(
          `audit:${this.room.matchId}:game:${String(this.room.revision).padStart(12, '0')}`,
          record
        )
      );
    }
    await this.persistRoom(writes);
    if (completedRecord)
      this.ctx.waitUntil(
        this.saveReplayArchiveWithRetry().catch((error) =>
          console.error('Replay archive failed after retries', error.message)
        )
      );
    this.ctx.waitUntil(this.broadcast());
    // Keep directory updates outside the transaction; a room remains usable if listing is briefly stale.
    this.ctx.waitUntil(
      stub(this.env.LOBBY, 'directory')
        .fetch(
          new Request('https://internal/internal/update', {
            method: 'POST',
            body: JSON.stringify({
              ...roomSummary(this.room),
              owner: this.room.host,
              matchId: this.room.matchId
            })
          })
        )
        .catch(() => {})
    );
    if (this.env.ACCOUNTS)
      await hub(this.env, '/internal/presence', {
        room: {
          id: this.room.id,
          revision: this.room.revision,
          status: this.room.status,
          members: this.room.members,
          spectators: roomSpectators(this.room)
        }
      });
    const autoSettleAt =
      this.room.status === 'playing' ? this.room.game?.pending?.autoSettleAt : null;
    const thinkingTimeout =
      this.room.status === 'playing' && this.room.aiThinking
        ? this.room.aiThinking.startedAt + DEEPSEEK_THINKING_TIMEOUT_MS
        : Infinity;
    const alarmAt = Math.min(botAt, autoSettleAt || Infinity, thinkingTimeout, humanAt);
    if (Number.isFinite(alarmAt)) await this.ctx.storage.setAlarm(alarmAt);
    else await this.ctx.storage.deleteAlarm();
  }
  async saveReplayArchive() {
    // GameRoom keeps its RNG as a function. Serialize the game without the RNG first,
    // then clone the plain snapshot so replay saves work in Durable Object runtimes.
    const completedRoom = structuredClone(serialized(this.room)),
      matchId = completedRoom?.matchId;
    if (
      !matchId ||
      !completedRoom?.game?.over ||
      completedRoom.saveReplay === false ||
      !this.env.ACCOUNTS
    )
      return { saved: 0, recipients: 0 };
    const final = restoreGame(completedRoom.game),
      accountIds = [
        ...new Set([
          ...(completedRoom.replayAccountIds || []),
          ...completedRoom.members.filter((p) => !p.bot && p.accountId).map((p) => p.accountId),
          ...roomSpectators(completedRoom)
            .map((p) => p.accountId)
            .filter(Boolean)
        ])
      ];
    if (!accountIds.length) return { saved: 0, recipients: 0 };
    const reference = {
      matchId,
      name: completedRoom.name,
      roomId: completedRoom.id,
      startedAt: completedRoom.createdAt,
      finishedAt: Date.now(),
      rounds: final.round,
      winner: final.winner,
      players: completedRoom.members.map((p) => ({
        name: p.name,
        bot: Boolean(p.bot),
        botType: p.bot || null
      }))
    };
    const response = await hub(this.env, '/internal/replay-reference', { accountIds, reference });
    if (!response.ok) throw new Error((await response.text()).slice(0, 200));
    const result = await response.json();
    if (result.saved < 1) throw new Error('No account received the replay archive');
    return { saved: result.saved, recipients: accountIds.length };
  }
  async replayFromLog(reference) {
    const matchId = reference.matchId,
      prefix = `audit:${matchId}:game:`,
      records = new Map();
    let cursor = '';
    do {
      const page = await this.ctx.storage.list({
        prefix,
        ...(cursor ? { startAfter: cursor } : {}),
        limit: 1000
      });
      for (const [key, meta] of page)
        if (!key.includes(':part:') && meta?.parts) records.set(key, meta);
      const keys = [...page.keys()];
      cursor = keys.length === 1000 ? keys.at(-1) : '';
    } while (cursor);
    const ordered = [...records.entries()].sort(([a], [b]) => a.localeCompare(b)),
      events = [],
      frames = [];
    let lastMotion = null,
      firstAt = 0,
      previousEnergy = null,
      loggedMembers = null;
    for (const [key, meta] of ordered) {
      const record = await readLog(this.ctx.storage, key, meta);
      if (!record.state) continue;
      if (!loggedMembers && Array.isArray(record.members)) loggedMembers = record.members;
      if (!firstAt) firstAt = record.at;
      const state = restoreGame(record.state),
        energyChanges = state.players
          .map((p, i) => ({ player: i, before: previousEnergy?.[i] ?? p.energy, after: p.energy }))
          .filter((change) => change.before !== change.after);
      if (Array.isArray(record.intelDelta)) events.push(...record.intelDelta);
      else if (record.events?.length) {
        const reconstructed = { game: state, intel: [] };
        gatherIntel(reconstructed, record.events, { energyChanges });
        events.push(...reconstructed.intel);
      }
      previousEnergy = state.players.map((p) => p.energy);
      const motion =
        record.motion ||
        (record.events?.length
          ? { sequence: (lastMotion?.sequence || 0) + 1, events: record.events, energyChanges }
          : null);
      if (motion) lastMotion = motion;
      if (!record.initial && record.operation !== 'start' && !motion) continue;
      const game = spectatorGameView(state, events);
      game.publicEvents = [];
      game.motionBatches = lastMotion ? [lastMotion] : [];
      frames.push({
        revision: record.revision,
        at: record.at,
        round: state.round,
        turnIndex: state.turnIndex,
        eventCount: events.length,
        game
      });
    }
    requireThat(frames.length, '对局日志不完整，无法生成回放', 404);
    const final = restoreGame(
      (await readLog(this.ctx.storage, ordered.at(-1)[0], ordered.at(-1)[1])).state
    );
    requireThat(final.over, '对局日志尚未结束，无法生成回放', 409);
    await Promise.all(
      [...this.pendingDeepseekMetrics.values()]
        .filter((entry) => entry.matchId === matchId)
        .map((entry) => entry.promise)
    );
    if (this.metricQueue) await this.metricQueue.catch(() => {});
    const thoughts = [];
    let metricCursor = '';
    const metricPrefix = `audit:${matchId}:deepseek:`;
    do {
      const page = await this.ctx.storage.list({
        prefix: metricPrefix,
        ...(metricCursor ? { startAfter: metricCursor } : {}),
        limit: 1000
      });
      for (const [key, meta] of page) {
        if (key.includes(':part:') || (!meta?.parts && meta?.schemaVersion !== 1)) continue;
        let record;
        try {
          record = meta.parts ? await readLog(this.ctx.storage, key, meta) : meta;
        } catch {
          console.warn('DeepSeek reasoning record could not be read');
          continue;
        }
        if (
          !record ||
          !Number.isInteger(record.revision) ||
          typeof record.reasoningContent !== 'string' ||
          !record.reasoningContent
        )
          continue;
        const targetRevision = record.revision + (record.applied ? 1 : 0);
        let low = 0,
          high = frames.length;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          if (frames[middle].revision < targetRevision) low = middle + 1;
          else high = middle;
        }
        const frameIndex = record.applied
          ? low
          : low < frames.length && frames[low].revision === targetRevision
            ? low
            : low - 1;
        if (frameIndex < 0 || frameIndex >= frames.length) continue;
        thoughts.push({
          frameIndex,
          player: record.player,
          round: record.round,
          phase: record.phase,
          applied: Boolean(record.applied),
          fallback: Boolean(record.fallback),
          text: record.reasoningContent
        });
      }
      const keys = [...page.keys()];
      metricCursor = keys.length === 1000 ? keys.at(-1) : '';
    } while (metricCursor);
    return {
      format: 'dark-forest-replay',
      version: 1,
      matchId,
      name: reference.name,
      roomId: reference.roomId,
      startedAt: firstAt || reference.startedAt,
      finishedAt: reference.finishedAt,
      rounds: final.round,
      winner: final.winner,
      players: (reference.players || []).map((player, index) => ({
        ...player,
        botType: player.botType || loggedMembers?.[index]?.bot || null
      })),
      thoughts,
      events,
      frames
    };
  }
  async saveReplayArchiveWithRetry() {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++)
      try {
        return await this.saveReplayArchive();
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      }
    throw lastError;
  }
  async broadcast() {
    await Promise.all(
      this.ctx.getWebSockets().map(async (ws) => {
        try {
          const { session, token } = ws.deserializeAttachment();
          if (this.env.ACCOUNTS) {
            const auth = await (await hub(this.env, '/internal/resolve', { token })).json();
            if (!auth.account || accountPrincipal(auth.account.id) !== session) {
              ws.send(JSON.stringify({ type: 'removed' }));
              ws.close(1008, '登录已失效');
              return;
            }
          }
          const member = this.room.members.find((p) => p.id === session),
            spectator = roomSpectators(this.room).some((p) => p.id === session);
          if ((!member || member.exited) && !spectator) {
            ws.send(JSON.stringify({ type: 'removed' }));
            ws.close(1000, '座位已退出或移除');
            return;
          }
          ws.send(JSON.stringify({ type: 'state', room: roomView(this.room, session) }));
        } catch {
          try {
            ws.close(1011, '同步失败，请重连');
          } catch {}
        }
      })
    );
  }
  async alarm() {
    let deepseekTask = null;
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.room?.status !== 'playing') {
        await this.ctx.storage.deleteAlarm();
        return;
      }
      const humanAt = syncHumanTimers(this.room);
      const expired = Object.entries(this.room.humanTimers || {}).find(
        ([, timer]) => timer.deadline <= Date.now()
      );
      if (expired) {
        const seat = Number(expired[0]),
          action = humanTimeoutAction(this.room, seat);
        const backup = structuredClone(serialized(this.room));
        try {
          requireThat(action, '超时操作无效');
          applyGameAction(this.room, seat, action);
          delete this.room.humanTimers[seat];
          this.room.humanTimeouts ||= {};
          this.room.humanTimeouts[seat] = {
            id: expired[1].id,
            phase: expired[1].phase,
            responded: Boolean(action.cardId),
            memberId: this.room.members[seat].id,
            matchId: this.room.matchId
          };
          this.room.revision++;
          this.room.updatedAt = Date.now();
          await this.commit({ operation: 'human-timeout', actor: seat, action });
        } catch (error) {
          this.room = revived(backup);
          console.error('Human timeout failed', error.message);
          await this.ctx.storage.setAlarm(Date.now() + 1000);
        }
        return;
      }
      const pending = this.room?.game?.pending;
      if (pending?.autoSettleAt) {
        if (Date.now() < pending.autoSettleAt) {
          await this.ctx.storage.setAlarm(pending.autoSettleAt);
          return;
        }
        const backup = serialized(this.room);
        try {
          applyGameAction(this.room, pending.caster, { type: 'settle', chosen: null });
          this.room.revision++;
          this.room.updatedAt = Date.now();
          await this.commit({
            operation: 'auto-settle',
            actor: pending.caster,
            action: { type: 'settle', chosen: null }
          });
        } catch (error) {
          this.room = revived(backup);
          console.error('Broadcast auto-settlement failed', error.message);
          await this.ctx.storage.setAlarm(Date.now() + 1000);
        }
        return;
      }
      if (this.room?.aiThinking) {
        const retryAt = this.room.aiThinking.startedAt + DEEPSEEK_THINKING_TIMEOUT_MS;
        if (Date.now() < retryAt) {
          await this.ctx.storage.setAlarm(Math.min(retryAt, humanAt));
          return;
        }
        this.room.aiThinking = null;
        this.room.revision++;
        this.room.updatedAt = Date.now();
        await this.commit();
        return;
      }
      const next = this.nextBot();
      if (!next) {
        if (Number.isFinite(humanAt)) await this.ctx.storage.setAlarm(humanAt);
        return;
      }
      const due = nextAIActionAt(this.room, next);
      if (Date.now() < due) {
        await this.ctx.storage.setAlarm(Math.min(due, humanAt));
        return;
      }
      const backup = serialized(this.room);
      try {
        if (next.level === 'deepseek') {
          appendDeepSeekUpdates(this.room);
          const token = crypto.randomUUID(),
            sessionId = this.room.members[next.me].id;
          const phase =
            pending?.kind === 'broadcast'
              ? next.me === pending.caster
                ? 'settle'
                : 'respond'
              : pending?.kind === 'escape'
                ? 'escape'
                : 'turn';
          this.room.aiThinking = { token, player: next.me, phase, startedAt: Date.now() };
          this.room.revision++;
          this.room.updatedAt = Date.now();
          const revision = this.room.revision;
          const game = restoreGame(saveGame(this.room.game)),
            intel = structuredClone(this.room.intel);
          const session = structuredClone(this.room.deepseekSessions?.[sessionId] || null);
          await this.commit();
          deepseekTask = {
            token,
            revision,
            player: next.me,
            sessionId,
            game,
            intel,
            session,
            matchId: this.room.matchId
          };
          return;
        }
        let action = next.action;
        if (!action) throw new Error('AI 没有生成有效行动');
        applyGameAction(this.room, next.me, action);
        this.room.revision++;
        this.room.updatedAt = Date.now();
        await this.commit({ operation: 'ai-action', actor: next.me, action });
      } catch (error) {
        this.room = revived(backup);
        console.error('AI action failed', error.message);
        await this.ctx.storage.setAlarm(Date.now() + 3000);
      }
    });
    if (!deepseekTask) return;

    let finishPendingMetric;
    const pendingMetric = new Promise((resolve) => {
      finishPendingMetric = resolve;
    });
    this.pendingDeepseekMetrics.set(deepseekTask.token, {
      matchId: deepseekTask.matchId,
      promise: pendingMetric
    });
    let action = null,
      metric = null,
      reasoningContent = null,
      applied = false,
      fallback = false;
    try {
      action = await decideDeepSeek(
        deepseekTask.game,
        deepseekTask.player,
        deepseekTask.intel,
        this.env.DEEPSEEK_API_KEY,
        fetch,
        deepseekTask.session,
        null,
        (value) => {
          metric = value;
        },
        {
          onReasoning: (value) => {
            reasoningContent = reasoningContent
              ? reasoningContent + '\n\n【重新决策】\n' + value
              : value;
          }
        }
      );
    } catch (error) {
      console.warn('DeepSeek decision failed', error?.message || 'unknown error');
    }

    try {
      await this.ctx.blockConcurrencyWhile(async () => {
        if (this.room?.aiThinking?.token !== deepseekTask.token) return;
        if (this.room.revision !== deepseekTask.revision) {
          this.room.aiThinking = null;
          this.room.revision++;
          this.room.updatedAt = Date.now();
          await this.commit();
          return;
        }
        const backup = serialized(this.room);
        try {
          if (deepseekTask.session?.messages)
            this.room.deepseekSessions[deepseekTask.sessionId] = deepseekTask.session;
          if (!action) {
            fallback = true;
            console.warn('DeepSeek unavailable; using local Zhizi policy');
            action = decideAI(
              gameView(this.room.game, deepseekTask.player),
              deepseekTask.player,
              'hard',
              this.room.intel
            );
          }
          if (!action) throw new Error('AI 没有生成有效行动');
          this.room.aiThinking = null;
          applyGameAction(this.room, deepseekTask.player, action);
          this.room.revision++;
          this.room.updatedAt = Date.now();
          await this.commit({ operation: 'deepseek-action', actor: deepseekTask.player, action });
          applied = true;
        } catch (error) {
          this.room = revived(backup);
          this.room.aiThinking = null;
          this.room.revision++;
          this.room.updatedAt = Date.now();
          console.error('AI action failed', error.message);
          await this.commit();
        }
      });
    } finally {
      if (metric) {
        const at = Date.now(),
          key = `audit:${deepseekTask.matchId}:deepseek:${String(at).padStart(13, '0')}:${deepseekTask.token}`;
        const record = {
          ...metric,
          kind: 'deepseek',
          matchId: deepseekTask.matchId,
          at,
          player: deepseekTask.player,
          revision: deepseekTask.revision,
          round: deepseekTask.game.round,
          applied,
          fallback,
          appliedActionType: applied ? action.type : null,
          ...(reasoningContent ? { reasoningContent } : {})
        };
        this.metricQueue = (this.metricQueue || Promise.resolve())
          .catch(() => {})
          .then(() => this.recordDeepseekMetric(key, record));
        this.ctx.waitUntil(
          this.metricQueue.catch(() => console.warn('DeepSeek metrics could not be saved'))
        );
      }
      const finished = this.metricQueue || Promise.resolve();
      finished
        .catch(() => {})
        .finally(() => {
          this.pendingDeepseekMetrics.delete(deepseekTask.token);
          finishPendingMetric();
        });
    }
  }
  webSocketMessage(ws, message) {
    if (message === 'ping') ws.send('pong');
  }
  webSocketClose(ws, code, reason) {
    try {
      ws.close(code, reason);
    } catch {}
  }
  webSocketError(ws) {
    try {
      ws.close(1011, '连接中断');
    } catch {}
  }
}
