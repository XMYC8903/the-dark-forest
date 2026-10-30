import {Game, CARDS, GALAXIES, EDGES, seeded} from '../shared/game.js';
import {AI_NAMES} from '../dist/ai-labels.js';

export const LEVELS = {easy:'简单', normal:'普通', hard:'困难', deepseek:'云端'};
function secureRandom(){const rng=()=>crypto.getRandomValues(new Uint32Array(1))[0]/4294967296;rng.state=()=>null;return rng;}
export function normalizeBotNames(room){
  const used=new Set(room.members.filter(p=>!p.bot).map(p=>p.name));
  room.members.forEach((p,i)=>{
    if(p.bot&&/^(简单|普通|困难) AI \d+$/.test(p.name)){
      let n=1,name=AI_NAMES[p.bot];while(used.has(name))name=AI_NAMES[p.bot]+' '+(++n);
      p.name=name;if(room.game)room.game.players[i].name=name;
    }
    used.add(p.name);
  });return room;
}
export function cleanName(value, fallback='观测者') {
  return typeof value==='string' ? value.replace(/[\p{Cc}\p{Cf}]/gu,'').trim().slice(0,16)||fallback : fallback;
}
export function requireThat(condition, message, status=400) {
  if (!condition) throw Object.assign(new Error(message), {status});
}
export function saveGame(game) {
  if (!game) return null;
  const {rng, events, ...rest}=game;
  return {...structuredClone(rest), rngState:rng.state()};
}
export function restoreGame(data) {
  if (!data) return null;
  const {rngState, ...rest}=structuredClone(data);
  const game=Object.assign(Object.create(Game.prototype),rest,{rng:rngState===null?secureRandom():seeded(rngState),events:[]});
  // Migrate legacy marker colors: old black/red meant extinction/dimension;
  // the v2 purple annihilation marker is now unified with red extinction.
  if(!game.markerSchemaVersion){for(const [id,marker] of Object.entries(game.markers||{}))if(marker==='black')game.markers[id]='red';else if(marker==='red')game.markers[id]='gray';else if(marker==='purple')game.markers[id]='red';}
  else if(game.markerSchemaVersion<3){for(const [id,marker] of Object.entries(game.markers||{}))if(marker==='purple')game.markers[id]='red';}
  game.markerSchemaVersion=3;
  delete game.previousLatest;
  if(game.pending?.kind==='broadcast'&&!game.pending.publicId){game.pending.publicId=crypto.randomUUID();if(game.latest)game.latest.batchId=game.pending.publicId;}
  return game;
}
export function roomSpectators(room) {
  if(!Array.isArray(room.spectators)) room.spectators=room.spectator?[room.spectator]:[];
  else if(room.spectators.length===0&&room.spectator) room.spectators=[room.spectator];
  room.spectator=room.spectators[0]||null;
  return room.spectators;
}
function setRoomSpectators(room,spectators) {
  room.spectators=spectators;
  room.spectator=spectators[0]||null;
}
function nextRoomHost(room,exceptId) {
  return room.members.find(p=>p.id!==exceptId&&!p.bot&&!p.exited)?.id
    ||roomSpectators(room).find(p=>p.id!==exceptId)?.id
    ||null;
}
export function newRoom(id,sessionId,name,username,now=Date.now()) {
  return {id,name:cleanName(name,'未命名的森林'),createdAt:now,updatedAt:now,revision:1,status:'waiting',host:sessionId,
    members:[{id:sessionId,name:cleanName(username),bot:null}],spectators:[],spectator:null,game:null,intel:[],receipts:[],saveReplay:true,replayAccountIds:[]};
}
export function roomSummary(room) {
  const spectators=roomSpectators(room);
  return {id:room.id,name:room.name,count:room.members.length,max:6,status:room.status,
    hostName:room.members.find(p=>p.id===room.host)?.name||(spectators.some(p=>p.id===room.host)?'观战席房主':'房主'),spectatorOccupied:spectators.length>0,spectatorCount:spectators.length,saveReplay:room.saveReplay!==false,updatedAt:room.updatedAt};
}
export function roomView(room,sessionId) {
  const spectators=roomSpectators(room);
  const me=room.members.findIndex(p=>p.id===sessionId);
  const isSpectator=spectators.some(p=>p.id===sessionId);
  requireThat(isSpectator||me>=0&&!room.members[me].exited,'你已退出这个房间',403);
  return {...roomSummary(room),revision:room.revision,me:isSpectator?null:me,role:isSpectator?'spectator':'player',isHost:room.host===sessionId,spectatorOccupied:spectators.length>0,
    members:room.members.map((p,index)=>({index,name:p.name,accountId:p.accountId||null,bot:p.bot,exited:Boolean(p.exited),host:p.id===room.host})),
    ...(isSpectator?{spectators:spectators.map(p=>({name:p.name,me:p.id===sessionId}))}:{}),
    game:room.game?(isSpectator?{...spectatorGameView(room.game,room.intel),motionBatches:structuredClone(room.motionBatches||[])}:gameView(room.game,me)):null};
}
function spectatorCard(card,{full=false}={}) {
  const d=CARDS[card.key];
  if(!d)return {id:card.id,name:'未知卡牌',cost:0,type:'unknown'};
  return {id:card.id,name:d.name,cost:d.cost,type:d.type,
    ...(d.level!==undefined?{level:d.level===Infinity?'∞':d.level}:{}),
    ...(d.range!==undefined?{range:d.range===Infinity?'∞':d.range}:{}),
    ...(d.income?{income:d.income}:{}),...(d.defense?{defense:d.defense}:{}),
    ...(full?{key:card.key,face:d.face||null,rule:d.rule,detail:d.detail}:{} )};
}
export function spectatorGameView(game,intel=[]) {
  const publicCard=(card,extra={})=>({...spectatorCard(card,{full:true}),...extra});
  let pending=null;
  if(game.pending?.kind==='broadcast'){
    const b=game.pending;pending={kind:'broadcast',id:b.publicId,caster:b.caster,target:b.target,decisions:[...b.decisions],
      card:spectatorCard(b.card,{full:true}),responses:b.responses.map(r=>({actor:r.actor,card:spectatorCard(r.card,{full:true})})),
      ...(b.autoSettleAt?{autoSettleAt:b.autoSettleAt}:{})};
  }else if(game.pending)pending={...game.pending};
  return {active:game.active,round:game.round,turnIndex:game.turnIndex,played:game.played,over:game.over,winner:game.winner,
    markers:{...game.markers},deckCount:game.deck.length,discardCount:game.discard.length,pending,
    players:game.players.map(p=>({id:p.id,name:p.name,alive:p.alive,energy:p.energy,galaxy:p.galaxy,escapeUsed:p.escapeUsed,
      hand:p.hand.map(card=>({...spectatorCard(card),face:CARDS[card.key]?.face||null})),builds:p.builds.map(card=>spectatorCard(card,{full:true}))})),
    strikes:game.strikes.map(s=>({id:s.id,card:spectatorCard(s.card,{full:true}),owner:s.owner,target:s.target,progress:s.progress,required:s.required})),
    publicEvents:intel.slice(-100).map(event=>({...event,...(event.key?{cardName:CARDS[event.key]?.name||'未知卡牌'}:{})})),
    latest:game.latest?{kind:game.latest.kind,target:game.latest.target,revealed:game.latest.revealed,outcome:game.latest.outcome,victimId:game.latest.victimId,
      cards:game.latest.cards.map(c=>publicCard(c,{actor:c.actor,role:c.role}))}:null};
}
// This is the only game data boundary sent to browsers and AI policies.
export function gameView(game,me) {
  const copyCard=c=>({id:c.id,key:c.key});
  const batch=game.latest?.batchId||game.pending?.publicId||'current';
  const publicId=(id,actor)=>actor===me?id:'hidden-'+batch+'-'+actor;
  const hidden=c=>({id:publicId(c.id,c.actor),actor:c.actor,role:c.role});
  let pending=null;
  if (game.pending?.kind==='broadcast') {
    const b=game.pending;
    pending={kind:b.kind,id:b.publicId,caster:b.caster,target:b.target,decisions:[...b.decisions],
      responses:b.responses.map(r=>({actor:r.actor,card:{id:publicId(r.card.id,r.actor)}})),...(b.autoSettleAt?{autoSettleAt:b.autoSettleAt}:{})};
  } else if(game.pending) pending={...game.pending};
  return {active:game.active,round:game.round,turnIndex:game.turnIndex,demo:false,played:game.played,
    over:game.over,winner:game.winner,markers:{...game.markers},deckCount:game.deck.length,
    players:game.players.map(p=>({id:p.id,name:p.name,alive:p.alive,energy:p.energy,escapeUsed:p.escapeUsed,
      builds:p.builds.map(copyCard),handCount:p.hand.length,
      ...(p.id===me?{galaxy:p.galaxy,hand:p.hand.map(copyCard)}:{})})),
    strikes:game.strikes.map(s=>({id:s.id,card:copyCard(s.card),owner:s.owner,target:s.target,progress:s.progress,
      ...(s.owner===me?{required:s.required}:{})})),
    latest:game.latest?{kind:game.latest.kind,target:game.latest.target,revealed:game.latest.revealed,batchId:game.latest.batchId,outcome:game.latest.outcome,victimId:game.latest.victimId,
      cards:game.latest.cards.map(c=>game.latest.revealed?{...copyCard(c),actor:c.actor,role:c.role}:hidden(c))}:null,
    pending};
}
export function deepSeekRulebook() {
  const cards=Object.entries(CARDS).map(([key,c])=>({key,name:c.name,type:c.type,cost:c.cost,count:c.count,range:c.range===Infinity?'无限':c.range,face:c.face,level:c.level===Infinity?'无限':c.level,income:c.income,defense:c.defense,starDependent:Boolean(c.star),escape:Boolean(c.escape),rule:c.rule,detail:c.detail}));
  return `你是《三体·黑暗森林》网页卡牌桌游中的一名文明玩家。你的目标是活下来并争取最后胜利。你只能依据本局对话中收到的规则、当前状态和公开信息行动；其他文明的手牌和真实坐标是隐藏信息，不得假装知道。每个座位的 AI 都有独立对话。

星图：星系与坐标如下：${JSON.stringify(GALAXIES.map(({id,name})=>({id,name})))}。双向航线如下（每项是相连的两个星系编号）：${JSON.stringify(EDGES)}。航线最短路径距离决定广播射程和打击飞行需要的回合数。星系状态：正常、红色（恒星熄灭但仍可建设）、灰色（降维，不存在且不能建设/攻击）；恒星依赖建设在其恒星熄灭后移入弃牌堆。

完整规则：${JSON.stringify({players:'3–6 位玩家。每位开局 3 能量、4 张手牌；首位玩家额外 1 能量。',turn:'新回合开始先获得 1 点基础能量及有效建设的产能。玩家可逐张打出任意张手牌，也可保留手牌；一旦出过牌，该回合不可主动弃牌。若本回合未出牌，可选择弃置任意张手牌并补牌至 4 张，弃牌结束回合。结束回合时补牌至 4 张；回合开始不摸牌。',build:'建设支付费用并留在玩家面前；产能从以后自己的回合开始生效。恒星熄灭后不能建设依赖恒星的牌。戴森球每位玩家最多一个。光速飞船留在手牌，不能主动打出。',broadcast:'广播目标可以是任意星系，包括空星系。目标范围按最短路径计算。广播发布后进入回应阶段：有可回应牌且被点名时必须回应，监听基地允许被点名时不回应。发布者在回应结束后选一名回应者；无人回应则等待 3 秒自动结算。牌面在结算前保密，结算后公开。双方收益与费用按广播牌规则同时计算。',strike:'延时打击对自己星系无效。发射后按拥有者的座位计时，每次轮到该座位推进 1 回合；飞行时间为发射者与目标星系最短路径距离。命中时应用卡牌效果和防御。科技锁死立即拆除目标玩家全部建设，按其原始总费用的一半向下取整返还给该玩家，手牌不变。',escape:'遭遇无法防御的致命打击时，若未用过飞船、能量至少 10、有光速飞船且存在空的非灰星系，可选择逃生。逃生弃掉飞船和全部建设，能量变为 3，随机跃迁到一个空星系，打击落空。',elimination:'淘汰时手牌与建设弃置，但该玩家已发出的打击继续飞行。光粒熄灭恒星并弃置依赖恒星建设；湮灭熄灭恒星并摧毁全部建设；降维将星系变灰。对局在场上只剩一人且所有打击均已结算后结束。',deck:'抽牌堆为空时，把累计弃牌堆洗成新抽牌堆；手牌、场上建设和在飞打击不回收。'}).toString()}

卡牌完整数据（费用、射程、产能、防御和文本）：${JSON.stringify(cards)}

收到牌局更新时，仅把它作为新信息记入判断，不要输出普通聊天内容。只有当你收到“现在请决策”时，才从给定的合法候选中选择一个，并严格只输出 JSON：{"choice":候选编号}。不能创造候选之外的动作。`;
}
function stateDelta(previous,current) {
  if(!previous)return current;
  const delta={};
  for(const key of ['round','active','turnIndex','played','over','winner','deckCount','pending','latest','strikes','markers'])
    if(JSON.stringify(previous[key])!==JSON.stringify(current[key]))delta[key]=current[key];
  const players=[];
  for(let i=0;i<current.players.length;i++){
    const before=previous.players?.[i],after=current.players[i],changed={};
    for(const key of Object.keys(after))if(JSON.stringify(before?.[key])!==JSON.stringify(after[key]))changed[key]=after[key];
    if(Object.keys(changed).length)players.push({id:after.id,changes:changed});
  }
  if(players.length)delta.players=players;
  return delta;
}
export function appendDeepSeekUpdates(room) {
  if(room.status!=='playing'||!room.game)return;
  room.deepseekSessions||={};
  for(let me=0;me<room.members.length;me++){
    const member=room.members[me];if(member.bot!=='deepseek')continue;
    const state=gameView(room.game,me),stored=room.deepseekSessions[member.id];
    if(!stored){
      room.deepseekSessions[member.id]={messages:[
        {role:'system',content:deepSeekRulebook()},
        {role:'user',content:'本局开始。以下是我的初始视角状态。请记住规则、星图与此状态，等待后续牌局更新；现在不需要输出行动。\n'+JSON.stringify(state)}
      ],lastState:state,intelCursor:room.intel.length};
      continue;
    }
    const delta=stateDelta(stored.lastState,state);
    const evidence=room.intel.slice(stored.intelCursor||0);
    if(evidence.length)delta.publicEvidence=evidence;
    if(Object.keys(delta).length){
      stored.messages.push({role:'user',content:'牌局出现新信息。以下是自上次更新以来改变的公开状态，以及只对我可见的私有变化；请纳入本局记忆，不要输出行动。\n'+JSON.stringify(delta)});
      stored.lastState=state;
    }
    stored.intelCursor=room.intel.length;
  }
}
export function gatherIntel(room,events,batch={}) {
  const game=room.game,energyChanges=batch.energyChanges||[],round=game.round,turnIndex=game.turnIndex;
  const cardName=key=>CARDS[key]?.name||'未知卡牌';
  const publicCards=(cards,defaultActor=null,defaultRole=null)=>(cards||[]).map(c=>({actor:c.actor??defaultActor,key:c.key,cardName:cardName(c.key),role:c.role||defaultRole,face:CARDS[c.key]?.face||null,cost:CARDS[c.key]?.cost||0}));
  let arriving=null;
  // Public history records only information that has already been revealed.
  for(const e of events) {
    if(e.type==='build')room.intel.push({type:'build',actor:e.player,key:e.card.key,cardName:cardName(e.card.key),target:game.players[e.player]?.galaxy,cost:CARDS[e.card.key]?.cost||0,round,turnIndex});
    else if(e.type==='broadcast')room.intel.push({type:'broadcast_published',actor:e.player,cardName:cardName(e.card.key),target:e.target,round,turnIndex});
    else if(e.type==='broadcast_resolved')room.intel.push({type:'broadcast_settled',actor:e.caster,cardName:cardName(e.cards?.[0]?.key),target:e.target,selected:e.selected??null,cards:publicCards(e.cards||room.game.latest.cards),energyChanges:structuredClone(energyChanges),round,turnIndex});
    else if(e.type==='escaped')room.intel.push({type:'escaped',actor:e.player,from:e.from,to:game.players[e.player]?.galaxy,round,turnIndex});
    else if(e.type==='launch')room.intel.push({type:'launch',actor:e.player,target:e.target,key:e.card.key,cardName:cardName(e.card.key),cost:CARDS[e.card.key]?.cost||0,strikeId:e.card.id,round,turnIndex});
    else if(e.type==='strike_arriving')arriving={actor:e.owner,target:e.target,key:e.card.key,cardName:cardName(e.card.key),strikeId:e.strikeId};
    else if(e.type==='strike_resolved')room.intel.push({type:'impact',actor:e.owner,target:e.target,key:e.key,cardName:cardName(e.key),strikeId:e.strikeId,progress:e.progress,outcome:e.outcome,victim:e.victimId,round,turnIndex});
    else if(e.type==='lock')room.intel.push({type:'lock',actor:e.player,target:e.target,key:e.card.key,cardName:cardName(e.card.key),victim:e.victim??null,refund:e.refund||0,removed:publicCards(e.removedCards,e.victim,'被拆除'),energyChanges:structuredClone(energyChanges),round,turnIndex});
    else if(e.type==='discard')room.intel.push({type:'discard',actor:e.player,cards:publicCards(e.cards,e.player,'弃置'),round,turnIndex});
    else if(e.type==='star_discard'||e.type==='builds_destroyed')room.intel.push({type:'damage',actor:e.player,target:e.target,effect:e.type,cards:publicCards(e.cards),round,turnIndex});
    else if(e.type==='eliminated')room.intel.push({type:'eliminated',actor:e.player,round,turnIndex});
    else if(e.type==='system_hit'||e.type==='miss')room.intel.push({type:e.type,actor:arriving?.actor,key:arriving?.key,cardName:arriving?.cardName,target:e.target,strikeId:arriving?.strikeId,round,turnIndex});
    else if(e.type==='production')room.intel.push({type:'production',actor:e.player,gain:e.gain,round,turnIndex});
    else if(e.type==='gameover')room.intel.push({type:'gameover',winner:e.winner,round,turnIndex});
    else if(e.type==='withdraw')room.intel.push({type:'withdraw',actor:e.player,strikeId:e.strikeId,round,turnIndex});
  }
  // A broadcast response's face is withheld until broadcast_resolved.
}
export function applyGameAction(room,actor,action) {
  const game=room.game;
  const energyBefore=game?.players.map(p=>p.energy)||[];
  const buildingsBefore=game?.players.map(p=>structuredClone(p.builds))||[];
  const broadcastTarget=game?.pending?.kind==='broadcast'?game.pending.target:null;
  const previousBatch=game.pending?.publicId;
  requireThat(game&&!game.over,'对局尚未开始或已经结束');
  requireThat(Number.isInteger(actor)&&game.players[actor]?.alive,'出局玩家不能行动',403);
  requireThat(action&&typeof action.type==='string','动作格式无效');
  if(action.type==='respond') {
    requireThat(game.pending?.kind==='broadcast'&&actor!==game.pending.caster,'当前不能回应');
    game.respond(actor,action.cardId||null);
  } else if(action.type==='settle') {
    requireThat(game.pending?.kind==='broadcast'&&actor===game.pending.caster,'只能由发布者选择回应者',403);
    requireThat(!game.pending.autoSettleAt||Date.now()>=game.pending.autoSettleAt,'无人可回应，广播将在 3 秒后自动结算');
    game.settleBroadcast(action.chosen??null);
  } else if(action.type==='escape') {
    requireThat(game.pending?.kind==='escape'&&actor===game.pending.victim,'当前无需你决定逃生',403);
    requireThat(typeof action.use==='boolean','请选择是否逃生');
    game.resolveEscape(action.use);
  } else {
    requireThat(actor===game.active,'还没轮到你的回合',403);
    requireThat(!game.pending,'请先完成广播或逃生交互');
    if(action.type==='play') game.play(action.cardId,action.target);
    else if(action.type==='end') game.endTurn();
    else if(action.type==='discard') {
      requireThat(Array.isArray(action.ids)&&action.ids.length<=4,'弃牌选择无效');
      game.discardCards(action.ids);
    } else if(action.type==='withdraw') game.withdraw(action.strikeId);
    else throw new Error('未知动作');
  }
  if(game.pending?.kind==='broadcast')for(const player of game.players){
    if(player.alive&&player.id!==game.pending.caster&&!game.pending.decisions.includes(player.id)&&game.responseOptions(player.id).length===0)
      game.respond(player.id,null);
  }
  // Zero/one response needs no additional choice UI.
  const b=game.pending;
  if(b?.kind==='broadcast'&&!b.publicId){b.publicId=crypto.randomUUID();game.latest.batchId=b.publicId;}
  const allResponded=b?.kind==='broadcast'&&game.players.every(p=>!p.alive||p.id===b.caster||b.decisions.includes(p.id));
  if(allResponded&&b.responses.length===0&&!b.autoSettleAt)b.autoSettleAt=Date.now()+3000;
  if(allResponded&&b.responses.length<=1&&!b.autoSettleAt)game.settleBroadcast(b.responses[0]?.actor??null);
  if(previousBatch&&game.latest?.kind==='broadcast'&&game.latest.revealed)game.latest.batchId=previousBatch;
  const events=game.flush();
  room.motionSequence=(room.motionSequence||0)+1;
  const batch={sequence:room.motionSequence,events:structuredClone(events).map(e=>e.type==='response'?{...e,target:broadcastTarget}:e.type==='lock'?{...e,removedCards:buildingsBefore[e.victim]||[]}:e),
    energyChanges:game.players.filter(p=>p.energy!==energyBefore[p.id]).map(p=>({player:p.id,before:energyBefore[p.id],after:p.energy})),
    active:game.active,round:game.round,over:game.over};
  room.motionBatches=[...(room.motionBatches||[]),batch].slice(-32);
  gatherIntel(room,batch.events,batch);
  if(game.over) room.status='finished';
}
export function mutateRoom(room,sessionId,operation,body={}) {
  const spectators=roomSpectators(room),member=room.members.findIndex(p=>p.id===sessionId),spectatorIndex=spectators.findIndex(p=>p.id===sessionId),isSpectator=spectatorIndex>=0;
  const host=room.host===sessionId&&(isSpectator||!room.members[member]?.exited);
  if(operation==='watch') {
    if(isSpectator){
      const [previous]=spectators.splice(spectatorIndex,1);setRoomSpectators(room,spectators);
      if(previous.returnMember&&room.status==='waiting'&&room.members.length<6){
        const index=Math.max(0,Math.min(previous.returnMember.index,room.members.length));room.members.splice(index,0,previous.returnMember.member);
      }else if(room.host===sessionId){
        room.host=nextRoomHost(room,sessionId);
        if(room.status==='waiting'&&!room.host)room.status='closed';
      }
      if(['playing','finished'].includes(room.status)&&!room.members.some(p=>!p.bot&&!p.exited)&&!roomSpectators(room).length)room.status='closed';
    }else{
      let name=cleanName(body.username),returnMember=null;
      if(member>=0){
        const player=room.members[member];requireThat(!player.exited&&!player.bot,'当前座位不能进入观战席');name=player.name;
        if(room.status==='waiting'){
          returnMember={member:structuredClone(player),index:member};room.members.splice(member,1);
        }else if(room.status==='playing'||room.status==='finished'){
          player.exited=true;player.bot='easy';returnMember=null;
          if(host)room.host=nextRoomHost(room,sessionId);
        }
      }
      const accountId=body.accountId||returnMember?.member.accountId||null;
      setRoomSpectators(room,[...roomSpectators(room),{id:sessionId,name,accountId,returnMember}]);
      if(['playing','finished'].includes(room.status)&&room.saveReplay!==false&&accountId)room.replayAccountIds=[...new Set([...(room.replayAccountIds||[]),accountId])];
    }
  }else if(operation==='join') {
    requireThat(!isSpectator,'请先退出观战席，再加入玩家席');
    if(member>=0)return;
    requireThat(room.status==='waiting','对局已经开始');
    requireThat(room.members.length<6,'房间已满，最多 6 人');
    room.members.push({id:sessionId,name:cleanName(body.username),accountId:body.accountId||null,bot:null});
  } else {
    const activeMember=member>=0&&!room.members[member].exited;
    requireThat(activeMember||host&&isSpectator||operation==='leave'&&isSpectator,'你已退出这个房间',403);
    if(operation==='action') {
      requireThat(activeMember&&!isSpectator,'观战者不能执行游戏操作',403);
      requireThat(room.status==='playing','对局未在进行');
      if(body.action?.type==='respond')requireThat(body.action.phase&&body.action.phase===room.game.pending?.publicId,'这次广播已经结束，请重试',409);
      else requireThat(body.revision===room.revision,'牌桌已更新，请重试',409);
      applyGameAction(room,member,body.action);
    } else if(operation==='rename') {
      requireThat(activeMember,'观战者不能修改玩家席位名称');
      room.members[member].name=cleanName(body.username);
      if(room.game)room.game.players[member].name=room.members[member].name;
    } else if(operation==='leave') {
      if(isSpectator){
        spectators.splice(spectatorIndex,1);setRoomSpectators(room,spectators);
        if(room.host===sessionId){room.host=nextRoomHost(room,sessionId);if(room.status==='waiting'&&!room.host)room.status='closed';}
        if(['playing','finished'].includes(room.status)&&!room.members.some(p=>!p.bot&&!p.exited)&&!roomSpectators(room).length)room.status='closed';
      }else if(room.status==='playing'){
        const leaver=room.members[member];leaver.exited=true;leaver.bot='easy';
        const remainingHumans=room.members.filter(p=>!p.bot&&!p.exited);
        if(!remainingHumans.length&&!roomSpectators(room).length)room.status='closed';
        if(host)room.host=remainingHumans[0]?.id||null;
      }else{
        room.members.splice(member,1);
        if(host)room.host=nextRoomHost(room,sessionId);
        if(!room.host||!room.members.some(p=>!p.bot&&!p.exited)&&!roomSpectators(room).length)room.status='closed';
      }
    } else {
      requireThat(host,'只有房主可以操作',403);
      if(operation==='recording') {
        requireThat(room.status==='waiting','对局开始后不能修改录像设置');
        requireThat(typeof body.enabled==='boolean','请选择是否保存录像');
        room.saveReplay=body.enabled;
      } else if(operation==='bot') {
        requireThat(room.status==='waiting','开始后不能添加 AI');
        requireThat(room.members.length<6,'房间已满，最多 6 人');
        requireThat(Object.hasOwn(LEVELS,body.level),'请选择有效的 AI 难度');
        let number=1,name=AI_NAMES[body.level];while(room.members.some(p=>p.name===name))name=AI_NAMES[body.level]+' '+(++number);
        room.members.push({id:'bot-'+crypto.randomUUID(),name,bot:body.level});
      } else if(operation==='remove') {
        requireThat(room.status==='waiting','开始后不能移除玩家');
        requireThat(Number.isInteger(body.index)&&body.index>=0&&body.index<room.members.length&&body.index!==member,'无法移除这个座位');
        room.members.splice(body.index,1);
      } else if(operation==='start') {
        requireThat(room.status==='waiting','对局已经开始');
        requireThat(room.members.length>=3&&room.members.length<=6,'需要 3–6 位玩家（含 AI）才能开始');
        room.matchId=crypto.randomUUID();
        room.game=new Game({count:room.members.length,demo:false,random:secureRandom()});
        room.game.allPhysicalCards().forEach(c=>c.id=crypto.randomUUID());
        room.game.players.forEach((p,i)=>p.name=room.members[i].name);
        room.saveReplay=room.saveReplay!==false;
        room.replayAccountIds=room.saveReplay?[...new Set([
          ...room.members.filter(p=>!p.bot&&p.accountId).map(p=>p.accountId),
          ...roomSpectators(room).map(p=>p.accountId).filter(Boolean)
        ])]:[];
        room.intel=[];room.motionBatches=[];room.motionSequence=0;room.auditIntelCursor=0;room.deepseekSessions={};room.status='playing';
      } else if(operation==='rematch') {
        requireThat(room.status==='finished','本局尚未结束');
        room.game=null;room.matchId=null;room.status='waiting';room.intel=[];room.motionBatches=[];room.motionSequence=0;room.auditIntelCursor=0;room.deepseekSessions={};room.replayAccountIds=[];
      } else throw new Error('未知房间操作');
    }
  }
  room.revision++;room.updatedAt=Date.now();
}
