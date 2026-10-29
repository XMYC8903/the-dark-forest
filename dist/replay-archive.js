import {CARDS} from './game.js';

export function validateReplayArchive(archive){
  if(!archive||archive.format!=='dark-forest-replay'||archive.version!==1||!Array.isArray(archive.frames)||!archive.frames.length||archive.frames.length>12000||!Array.isArray(archive.events))throw Error('文件不是有效的黑暗森林回放');
  if(archive.events.length>100000)throw Error('回放事件数量超出限制');
  for(const frame of archive.frames)if(!frame?.game||!Array.isArray(frame.game.players)||frame.game.players.length<3||frame.game.players.length>6||!Number.isInteger(frame.eventCount)||frame.eventCount<0||frame.eventCount>archive.events.length)throw Error('回放中包含无效的牌局状态');
}
export function sanitizeReplayArchive(source){
  const safeText=(value,max=80)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,max),safeIndex=value=>Number.isInteger(value)&&value>=0&&value<6?value:null,safeGalaxy=value=>Number.isInteger(value)&&value>=1&&value<=9?value:null;
  const safeCard=(raw,seed='card')=>{
    if(!raw||typeof raw!=='object')return null;
    let key=Object.hasOwn(CARDS,raw.key)?raw.key:null;
    if(!key){const match=Object.entries(CARDS).find(([,d])=>d.name===raw.name&&d.type===raw.type&&(!raw.face||d.face===raw.face));key=match?.[0]||null;}
    if(!key)return null;
    const d=CARDS[key],id=/^[A-Za-z0-9_-]{1,80}$/.test(String(raw.id||''))?String(raw.id):seed;
    return{id,key,name:d.name,cost:d.cost,type:d.type,...(d.face?{face:d.face}:{}),...(d.level!==undefined?{level:d.level}:{}),...(d.range!==undefined?{range:d.range}:{}),...(d.income?{income:d.income}:{}),...(d.defense?{defense:d.defense}:{}),...(Number.isInteger(raw.actor)?{actor:safeIndex(raw.actor)}:{}),...(typeof raw.role==='string'?{role:safeText(raw.role,24)}:{})};
  };
  const safeEvent=(raw,frameIndex=0,eventIndex=0)=>{
    if(!raw||typeof raw!=='object')return null;
    const allowed=['build','broadcast_published','broadcast_settled','broadcast','launch','impact','lock','discard','damage','escaped','eliminated','production','system_hit','miss','withdraw','gameover'];
    if(!allowed.includes(raw.type))return null;
    const out={type:raw.type};
    for(const key of ['round','turnIndex','cost','progress','refund','gain'])if(Number.isFinite(raw[key]))out[key]=Math.max(0,Math.min(100000,raw[key]));
    for(const key of ['actor','player','owner','target','victim','selected','from','to','winner'])if(raw[key]===null&&['victim','selected','winner'].includes(key))out[key]=null;else if(Number.isInteger(raw[key]))out[key]=['target','from','to'].includes(key)?safeGalaxy(raw[key]):safeIndex(raw[key]);
    if(Object.hasOwn(CARDS,raw.key))out.key=raw.key;
    if(raw.cardName||out.key)out.cardName=safeText(raw.cardName||CARDS[out.key]?.name,80);
    for(const key of ['outcome','effect','role'])if(typeof raw[key]==='string')out[key]=safeText(raw[key],32);
    if(raw.strikeId)out.strikeId=/^[A-Za-z0-9_-]{1,80}$/.test(String(raw.strikeId))?String(raw.strikeId):'';
    for(const key of ['cards','removed'])if(Array.isArray(raw[key]))out[key]=raw[key].map((card,i)=>{const clean=safeCard(card,`replay-${frameIndex}-${eventIndex}-${i}`);return clean?{...clean,cardName:clean.name,cost:clean.cost,face:clean.face||null}:null;}).filter(Boolean);
    if(Array.isArray(raw.energyChanges))out.energyChanges=raw.energyChanges.slice(0,6).map(change=>({player:safeIndex(change.player),before:Math.max(0,Number(change.before)||0),after:Math.max(0,Number(change.after)||0)})).filter(change=>change.player!==null);
    return out;
  };
  const safeMotion=(batch,frameIndex)=>{
    if(!batch||!Number.isInteger(batch.sequence))return [];
    const events=(batch.events||[]).map((event,i)=>{
      const allowed=['build','broadcast','response','launch','lock','discard','draw','broadcast_resolved','strike_arriving','star_discard','builds_destroyed','eliminated','defended','escaped','escape_pending','system_hit','miss','production','gameover'];
      if(!allowed.includes(event.type))return null;
      const out={type:event.type};
      for(const key of ['player','owner','victim','caster','selected','target','from','winner'])if(event[key]===null&&['victim','selected','winner'].includes(key))out[key]=null;else if(Number.isInteger(event[key]))out[key]=['target','from'].includes(key)?safeGalaxy(event[key]):safeIndex(event[key]);
      for(const key of ['card','removedCards'])if(key==='card'&&event[key])out.card=safeCard(event.card,`replay-motion-${frameIndex}-${i}`);else if(key==='removedCards'&&Array.isArray(event[key]))out.removedCards=event[key].map((card,j)=>safeCard(card,`replay-removed-${frameIndex}-${i}-${j}`)).filter(Boolean);
      if(Array.isArray(event.cards))out.cards=event.cards.map((card,j)=>safeCard(card,`replay-batch-${frameIndex}-${i}-${j}`)).filter(Boolean);
      if(event.strikeId)out.strikeId=/^[A-Za-z0-9_-]{1,80}$/.test(String(event.strikeId))?String(event.strikeId):'';
      if(['photon','annihilation','dimension'].includes(event.key))out.key=event.key;
      if(event.type==='defended'&&Array.isArray(event.cards))out.cards=event.cards.map((card,j)=>safeCard(card,`replay-defense-${frameIndex}-${i}-${j}`)).filter(Boolean);
      return out;
    }).filter(Boolean);
    return[{sequence:batch.sequence,events,energyChanges:Array.isArray(batch.energyChanges)?batch.energyChanges.map(c=>({player:safeIndex(c.player),before:Number(c.before)||0,after:Number(c.after)||0})).filter(c=>c.player!==null):[]}];
  };
  const events=source.events.map((event,i)=>safeEvent(event,0,i)).filter(Boolean);
  const frames=source.frames.map((frame,i)=>{
    const raw=frame.game,players=raw.players.map((p,index)=>({id:index,name:safeText(p.name,32)||`文明 ${index+1}`,alive:Boolean(p.alive),energy:Math.max(0,Math.min(100000,Number(p.energy)||0)),galaxy:safeGalaxy(p.galaxy),escapeUsed:Boolean(p.escapeUsed),hand:(p.hand||[]).map((c,j)=>safeCard(c,`replay-hand-${i}-${index}-${j}`)).filter(Boolean),builds:(p.builds||[]).map((c,j)=>safeCard(c,`replay-build-${i}-${index}-${j}`)).filter(Boolean)}));
    const markers={};for(const [id,value] of Object.entries(raw.markers||{}))if(/^[1-9]$/.test(id)&&['red','purple','gray'].includes(value))markers[id]=value;
    const strikes=(raw.strikes||[]).map((strike,j)=>{const card=safeCard(strike.card,`replay-strike-${i}-${j}`);return card?{id:/^[A-Za-z0-9_-]{1,80}$/.test(String(strike.id||''))?String(strike.id):`replay-strike-${i}-${j}`,card,owner:safeIndex(strike.owner),target:safeGalaxy(strike.target),progress:Math.max(0,Number(strike.progress)||0),required:Math.max(0,Number(strike.required)||0)}:null;}).filter(strike=>strike&&strike.owner!==null&&strike.target!==null);
    let latest=null;if(raw.latest&&['build','broadcast','strike','discard'].includes(raw.latest.kind))latest={kind:raw.latest.kind,target:safeGalaxy(raw.latest.target),revealed:Boolean(raw.latest.revealed),outcome:safeText(raw.latest.outcome,32),victimId:safeIndex(raw.latest.victimId),cards:(raw.latest.cards||[]).map((c,j)=>safeCard(c,`replay-latest-${i}-${j}`)).filter(Boolean)};
    let pending=null;if(raw.pending?.kind==='broadcast')pending={kind:'broadcast',caster:safeIndex(raw.pending.caster),target:safeGalaxy(raw.pending.target),card:safeCard(raw.pending.card,`replay-pending-${i}`),decisions:(raw.pending.decisions||[]).map(safeIndex).filter(v=>v!==null),responses:(raw.pending.responses||[]).map((r,j)=>({actor:safeIndex(r.actor),card:safeCard(r.card,`replay-response-${i}-${j}`)})).filter(r=>r.actor!==null&&r.card)};else if(raw.pending?.kind==='escape')pending={kind:'escape',victim:safeIndex(raw.pending.victim)};
    const game={active:safeIndex(raw.active)??0,round:Math.max(1,Number(raw.round)||1),turnIndex:Math.max(0,Number(raw.turnIndex)||0),played:Boolean(raw.played),over:Boolean(raw.over),winner:safeIndex(raw.winner),markers,deckCount:Math.max(0,Number(raw.deckCount)||0),discardCount:Math.max(0,Number(raw.discardCount)||0),pending,players,strikes,latest,publicEvents:[],motionBatches:safeMotion(raw.motionBatches?.[0],i)};
    return{revision:i+1,round:game.round,turnIndex:game.turnIndex,eventCount:Math.min(events.length,frame.eventCount),game};
  });
  const matchId=/^[a-f0-9-]{36}$/.test(String(source.matchId||''))?source.matchId:crypto.randomUUID();
  return{format:'dark-forest-replay',version:1,matchId,name:safeText(source.name||'黑暗森林回放',80),startedAt:Number(source.startedAt)||Date.now(),finishedAt:Number(source.finishedAt)||Date.now(),rounds:Math.max(1,Number(source.rounds)||1),winner:safeIndex(source.winner),players:(source.players||[]).slice(0,6).map((p,i)=>({name:safeText(p.name||`文明 ${i+1}`,32),bot:Boolean(p.bot)})),events,frames};
}
