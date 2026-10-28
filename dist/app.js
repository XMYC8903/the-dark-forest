import {Game,CARDS,COLORS,TYPES,GALAXIES,EDGES,distance} from './game.js?v=20261025-lightship-energy';
import {cardFlight,cardInto} from './card-motion.js?v=20261025-observer-motion';
import {summarizeBuildings,broadcastEffect,broadcastPresentation,strikeFeedback,strikeNotice} from './view-model.js?v=20261025-green-loss-mark';
import {mountCardDrag} from './card-drag.js';

const $=s=>document.querySelector(s);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
let online=null,onlineRoom=null,onlineQueued=null,onlineEscapeId=null,onlineEpoch=0;
let game=new Game(),viewer=0,privacy=false,busy=false,discardMode=false,selected=new Set(),targetCard=null,responseQueue=[],broadcastStep=null,escapeTimer=null,broadcastTimer=null,toastTimer=null,dialogReturn=null,renderViewer=-1,dragControls=null,aimSequence=0,targetCardSize=null,energySnapshot=new Map(),feedbackSeen='',strikeNoticeSeen='',feedbackState=null,turnPromptKey='',eliminationPromptKey='';

const art={
 broadcast:'<path d="M35 62L65 24L95 62Z" opacity=".22"/><path d="M65 60V25M49 60H81M56 61L51 72M74 61L79 72"/><circle cx="65" cy="23" r="3" fill="currentColor"/><path d="M49 18Q39 29 49 40M40 10Q22 29 40 49M81 18Q91 29 81 40M90 10Q108 29 90 49"/><ellipse cx="65" cy="73" rx="29" ry="5" opacity=".2"/><circle cx="112" cy="14" r="1" fill="currentColor"/><circle cx="19" cy="57" r="1" fill="currentColor"/>',
 solar:'<circle cx="102" cy="18" r="9"/><path d="M102 3V0M102 32V37M88 18H83M116 18H122M92 8L88 4M112 28L116 32"/><path d="M15 41L65 24L103 47L52 65Z"/><path d="M30 36L68 60M47 30L85 53M28 49L78 32M40 57L91 40M54 65V76M43 77H69"/><path d="M65 24V35" opacity=".3"/><ellipse cx="58" cy="78" rx="27" ry="4" opacity=".2"/>',
 reactor:'<path d="M48 13L80 13L96 38L80 64L48 64L32 38Z"/><path d="M53 22L75 22L85 38L75 55L53 55L43 38Z" opacity=".4"/><circle cx="64" cy="38" r="9"/><circle cx="64" cy="38" r="3" fill="currentColor"/><path d="M64 0V13M64 64V78M18 38H32M96 38H111M34 6L47 18M82 60L94 73M33 70L47 58M82 18L96 6"/><ellipse cx="64" cy="38" rx="51" ry="12" transform="rotate(-28 64 38)" opacity=".3"/>',
 dyson:'<circle cx="65" cy="39" r="29"/><circle cx="65" cy="39" r="10" fill="currentColor" opacity=".25"/><ellipse cx="65" cy="39" rx="12" ry="29"/><ellipse cx="65" cy="39" rx="29" ry="11"/><ellipse cx="65" cy="39" rx="40" ry="13" transform="rotate(-30 65 39)" opacity=".5"/><path d="M65 0V9M65 69V79M26 39H36M94 39H105"/>',
 ring:'<ellipse cx="65" cy="40" rx="48" ry="15" transform="rotate(-25 65 40)"/><ellipse cx="65" cy="40" rx="36" ry="35" transform="rotate(23 65 40)" opacity=".35"/><circle cx="65" cy="40" r="20"/><path d="M48 30Q65 17 82 30M46 45Q63 60 82 46" opacity=".5"/><circle cx="110" cy="20" r="3" fill="currentColor"/><circle cx="28" cy="57" r="2" fill="currentColor"/>',
 ship:'<path d="M91 8L82 58L65 49L48 32Z"/><path d="M91 8L65 49M48 32L35 36L49 47L54 62L65 49M82 58L79 71L66 59L54 62M39 50L20 69M44 59L33 74M31 44L16 57"/><circle cx="72" cy="27" r="5" opacity=".5"/>',
 strike:'<path d="M13 65L92 22M29 73L100 33M21 49L83 15" opacity=".5"/><ellipse cx="95" cy="24" rx="11" ry="7" transform="rotate(-30 95 24)"/><circle cx="103" cy="20" r="4" fill="currentColor"/><path d="M106 8L111 1M115 17L127 14M109 32L119 39"/><circle cx="108" cy="23" r="22" opacity=".2"/><circle cx="23" cy="66" r="2" fill="currentColor"/>',
 dimension:'<path d="M65 8L106 32L65 57L24 32Z"/><path d="M65 8V57M24 32L65 77L106 32M65 57V77M44 20L86 45M85 20L44 45" opacity=".6"/><ellipse cx="65" cy="55" rx="50" ry="12" opacity=".3"/><path d="M8 69H43M87 69H124"/>',
 lock:'<circle cx="65" cy="40" r="27" opacity=".3"/><path d="M51 34V23Q65 4 79 23V34M46 34H84V66H46Z"/><circle cx="65" cy="46" r="4"/><path d="M65 50V57M21 16L30 24M17 48H29M100 49H114M97 14L89 23M37 74L44 68"/><ellipse cx="65" cy="40" rx="48" ry="12" transform="rotate(-25 65 40)" opacity=".3"/>'
};
function svgArt(d){return `<svg class="card-art" viewBox="0 0 130 82" fill="none" stroke="currentColor" stroke-width=".8" aria-hidden="true">${art[d.art]||art.ring}</svg>`;}
function cardState(c){
 const p=game.players[viewer],d=CARDS[c.key],unaffordable=p.energy<d.cost;
 if(broadcastStep==='respond'&&!privacy){const eligible=game.responseOptions(viewer).some(x=>x.id===c.id);return {eligible,blocked:!eligible,unaffordable,reason:eligible?'可拖入地图回应广播':unaffordable?'能量不足，无法回应':'此牌不符合回应条件'};}
 let reason=unaffordable?'能量不足':'';
 if(!reason&&viewer===game.active&&!game.pending&&!game.over)try{game.playable(c.id);}catch(e){reason=e.message;}
 return {eligible:false,blocked:Boolean(reason),unaffordable,reason};
}
function cardHTML(c,{back=false,detail=false,hand=false}={}){
 if(back)return `<div class="game-card card-back" data-card-id="${c.id}"><div><span class="back-symbol">◉</span><span class="back-title">黑暗森林</span></div></div>`;
 const d=CARDS[c.key],state=hand&&!discardMode?cardState(c):{};return `<button class="game-card${d.escape?' escape-card':''}${selected.has(c.id)?' selected':''}${state.blocked?' unavailable':''}${state.unaffordable?' unaffordable':''}${state.eligible?' response-eligible':''}" data-card-id="${c.id}" style="--card-color:${d.color||COLORS[d.type]}" aria-label="${d.name}${d.face?'，'+d.face:''}，${d.cost} 能量${detail?'':discardMode?',单击选择弃置':state.reason?'，'+state.reason+',单击查看详情':',单击查看，拖到地图出牌'}" data-playable="${hand?!state.blocked:true}" title="${esc(discardMode?'单击选择要弃置的牌':state.reason||'单击查看详情 · 拖入地图出牌')}" aria-pressed="${selected.has(c.id)}" aria-keyshortcuts="Enter Space"><span class="card-top"><span class="card-cost"><span>◇</span>${d.cost}</span><span>${TYPES[d.type]} / ${d.type==='broadcast'?'信号':d.type==='build'?'设施':'清理'}</span></span>${state.eligible?'<span class="response-badge">可回应</span>':''}${svgArt(d)}<strong class="card-name">${d.name}</strong><span class="card-face">${d.face||({build:'CIVILIZATION',strike:'DARK FOREST'}[d.type])}</span><span class="card-rule">${d.rule.split(' · ').map((s,i)=>i?`<br>${s}`:`<b>${s}</b>`).join('')}</span>${hand?`<span class="hand-card-detail">${d.type==='broadcast'?(d.face==='合作'?'合作各 +3 · 遇伪装对方 +5':'遇合作 +5 · 双伪装 +0'):d.type==='strike'?(d.instant?'建筑总费用半价返还':d.level===Infinity?'无法防御 · 毁灭星系':'等级 '+d.level+' · '+(d.level===2?'恒星建设弃置':d.level===3?'摧毁全部建设':'命中无防御文明')):d.income?(d.star?'恒星熄灭时弃置':'恒星熄灭仍可使用'):d.defense?'抵御不高于 '+d.defense+' 级打击':d.escape?'致命打击时使用':'被点名时可不回应'}</span>`:''}</button>`;
}
const uiIcons={energy:'<path d="m10 1-7 9h5l-2 7 8-10H9z"/>',sun:'<circle cx="9" cy="9" r="3"/><path d="M9 0v3m0 12v3M0 9h3m12 0h3M3 3l2 2m8 8 2 2M3 15l2-2m8-8 2-2"/>',shield:'<path d="M9 1 2 4v5c0 4 7 8 7 8s7-4 7-8V4z"/>'};
function uiIcon(name){return `<svg class="stat-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${uiIcons[name]}</svg>`;}
function buildingHTML(p){
 const a=summarizeBuildings(p.builds,{starActive:!game.markers[p.galaxy]});
 const energy=(g,star)=>`<span class="building-stat energy-stat${star?' stellar-stat':''}${star&&g.inactive?' inactive':''}" data-asset-ids="${g.ids.join(' ')}" aria-label="${star?'恒星能源':'独立能源'}建设每回合 +${g.income}${star&&g.inactive?'，恒星熄灭，已停产':''}" title="${esc((g.names.join('、')||'尚无能源建设')+'；额外产能 +'+g.income+(star&&g.inactive?'（恒星已熄灭）':''))}">${uiIcon('energy')}<b>+${g.income}</b>${star?uiIcon('sun'):''}</span>`;
 return `<span class="energy-pair">${a.independent.income?energy(a.independent,false):''}${a.stellar.income?energy(a.stellar,true):''}</span>${a.defense?`<span class="building-stat defense-stat" data-asset-ids="${a.defenseIds.join(' ')}" aria-label="最高防御等级 ${a.defense}" title="${esc(a.defenseNames.join('、'))}；最高防御等级 ${a.defense}">${uiIcon('shield')}<b>${a.defense}</b></span>`:''}${a.other.map(g=>`<span class="building-stat utility-stat" data-asset-ids="${g.ids.join(' ')}" title="${esc(CARDS[g.key].name)}">${esc(g.label)}${g.count>1?' ×'+g.count:''}</span>`).join('')}`;
}
function miniHTML(c,revealed,l=game.latest){
 const d=CARDS[c.key],isBroadcast=l?.kind==='broadcast',label=game.players[c.actor].name,projection=isBroadcast?broadcastPresentation(c,{revealed,target:l.target,actorName:label}):null;const roleStyle=isBroadcast?(c.role==='发布'?'publish':c.role==='回应'?'response':'unused'):'';
 if(!revealed)return `<div class="played-mini compact-back" data-broadcast-role="${roleStyle}" data-latest-id="${c.id}" style="--card-color:var(--broadcast)"><span class="mini-owner"><b>${esc(label)}</b><em>${c.role}</em></span><span class="mini-back-mark">◉</span><strong>${projection?.name||'广播牌'} · 待揭示</strong><span class="mini-target">星系 ${l.target}</span></div>`;
 return `<button class="played-mini compact-public${d.escape?' escape-card':''}" data-broadcast-role="${roleStyle}" data-latest-id="${c.id}" data-public-card="${c.id}" style="--card-color:${d.color||COLORS[d.type]}" aria-label="查看${esc(label)}的${d.name}${d.face?'，'+d.face:''}详情"><span class="mini-owner"><b>${esc(label)}</b><em>${esc(c.role)}</em></span><span class="mini-name"><strong>${projection?.name||d.name}</strong>${d.face?`<b>${d.face}</b>`:''}</span><small>◇ ${d.cost} · ${d.type==='broadcast'?'距离 '+(d.range===Infinity?'∞':d.range):d.type==='strike'?'等级 '+(d.level===Infinity?'∞':d.level):d.income?'产能 +'+d.income:d.defense?'防御 '+d.defense:'监听'}</small>${l.target?`<span class="mini-target">${isBroadcast?'广播':'目标'}星系 ${l.target}</span>`:''}</button>`;
}
function renderLatestCards(){
 $('#broadcast-reveal').hidden=true;$('#broadcast-reveal').replaceChildren();const l=game.latest;
 $('#latest-content').innerHTML=l?l.cards.map(c=>miniHTML(c,l.revealed,l)).join(''):'<span class="empty-signal">⌁</span><p>最新出牌<span>单击已揭示的牌查看详情</span></p>';
 $('#latest-label').textContent=l?.kind==='broadcast'?`广播星系 ${l.target} · ${l.revealed?'已结算':'等待回应'}`:l?.target?`目标星系 ${l.target}`:'最新出牌';
 $('#latest-content').querySelectorAll('[data-public-card]').forEach(el=>el.onclick=()=>showPublicCard(el.dataset.publicCard));
}
function showPublicCard(id){
 const l=game.latest;if(!l?.revealed)return;const c=l.cards.find(c=>c.id===id);if(!c)return;const d=CARDS[c.key];
 showDialog(`${modalTitle(esc(game.players[c.actor].name)+' / '+esc(c.role),d.name)}<div class="detail-card">${cardHTML(c,{detail:true})}</div>${l.target?`<div class="detail-facts"><span>${l.kind==='broadcast'?'广播':'目标'}星系</span><strong>${l.target} · ${esc(GALAXIES[l.target-1].name)}</strong></div>`:''}<p>${d.detail}</p>${d.type==='broadcast'?`<p>${broadcastEffect(c.key)}</p><p class="detail-help">牌费在结算后计算；未被选中的回应者支付牌费并获得 +1。</p>`:''}<div class="detail-facts"><span>费用</span><strong>◇ ${d.cost}</strong></div><div class="dialog-actions"><button class="primary-btn" id="public-card-close">返回牌桌</button></div>`);$('#public-card-close').onclick=closeDialog;
}
function setBusy(on){busy=on;updateActions();if(!on&&onlineQueued){const next=onlineQueued;onlineQueued=null;queueMicrotask(()=>receiveOnlineRoom(next));}}
function toast(text,tone=''){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').classList.toggle('strike-hit',tone==='strike-hit');$('#toast').classList.add('visible');$('#status-message').textContent=text;toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3400);}
function playerHTML(p){const choosing=broadcastStep==='choose'&&!privacy&&game.pending?.responses.some(r=>r.actor===p.id),current=p.alive&&!game.over&&p.id===game.active;const strikes=game.strikes.filter(s=>s.owner===p.id).map(s=>'<span class="asset-chip strike" data-strike-id="'+s.id+'" title="已前进 '+s.progress+' 回合">↗ '+CARDS[s.card.key].name+' '+s.progress+'</span>').join('');return '<button class="player'+(p.alive?'':' eliminated')+(current?' current-turn':'')+(choosing?' responder-choice':'')+'" data-player="'+p.id+'" aria-label="'+(choosing?'选择'+p.name+'结算广播':'查看'+p.name+'的公开状态')+'"><span class="player-top"><span class="avatar">'+esc(p.name[0])+'</span><span class="player-name">'+esc(p.name)+'<small class="player-sub">'+(choosing?'点击选择结算':p.alive?'坐标未知':'文明已消逝')+'</small></span><span class="player-counters"><span class="player-energy" aria-label="能量 '+p.energy+'"><span class="energy-diamond">◇</span><span class="energy-number">'+p.energy+'</span></span><span class="public-hand-count" aria-label="手牌 '+p.hand.length+' 张"><i class="hand-card-symbol" aria-hidden="true"></i>'+p.hand.length+'</span></span></span><span class="public-assets">'+buildingHTML(p)+'</span>'+(strikes?'<span class="player-strikes">'+strikes+'</span>':'')+'</button>';}
function renderMap(){const mine=game.players[viewer];const activeCard=targetCard?CARDS[game.players[game.active].hand.find(c=>c.id===targetCard)?.key]:null;const svg=$('#starmap'),viewHeight=430,layout=GALAXIES,hitRadius=Math.max(44,Math.min(62,22/Math.min((svg.clientWidth||700)/900,(svg.clientHeight||330)/430)));svg.setAttribute('viewBox',`0 0 900 ${viewHeight}`);$('#starmap').innerHTML=`<defs><radialGradient id="mapGlow"><stop stop-color="#b9cfa1" stop-opacity=".15"/><stop offset="1" stop-color="#b9cfa1" stop-opacity="0"/></radialGradient></defs><circle cx="504" cy="${viewHeight/2}" r="${viewHeight*.45}" fill="url(#mapGlow)"/>${EDGES.map(([a,b])=>{const x=layout[a-1],y=layout[b-1];return `<line x1="${x.x}" y1="${x.y}" x2="${y.x}" y2="${y.y}" class="map-route${!privacy&&mine.alive&&(a===mine.galaxy||b===mine.galaxy)?' glowing':''}"/>`;}).join('')}${layout.map(g=>{const marker=game.markers[g.id],isMine=!privacy&&mine.alive&&g.id===mine.galaxy,exists=marker!=='gray';const selectable=Boolean(activeCard&&(activeCard.type==='broadcast'||exists)&&(activeCard.type==='strike'?g.id!==game.players[game.active].galaxy:activeCard.type==='broadcast'?distance(game.players[game.active].galaxy,g.id)<=activeCard.range:false));const broadcastTarget=game.pending?.kind==='broadcast'&&game.pending.target===g.id,incoming=game.strikes.filter(s=>s.target===g.id),strikeNames=incoming.map(s=>CARDS[s.card.key].name),underAttack=strikeNames.length>0;const stateText=marker==='red'?'，恒星已熄灭（仍可建设）':marker==='gray'?'，星系已被降维删除，可发送广播': '';return `<g class="system${marker?` marker-${marker}`:''}${marker==='gray'?' destroyed':''}${isMine?' mine':''}${selectable?' selectable':''}${activeCard?.type==='strike'&&selectable?' strike-target':''}${broadcastTarget?' broadcast-target':''}${underAttack?' incoming-strike-target':''}" data-galaxy="${g.id}" transform="translate(${g.x},${g.y})" tabindex="${activeCard&&!selectable?-1:0}" aria-disabled="${Boolean(activeCard&&!selectable)}" role="button" aria-label="${g.id}号${esc(g.name)}${isMine?'，你的星系':''}${stateText}${broadcastTarget?'，当前广播星系':''}${underAttack?'，即将遭受'+strikeNames.join('、'):''}"><circle r="${hitRadius}" fill="transparent"/>${broadcastTarget?'<circle class="broadcast-ring" r="48"/>':''}${underAttack?'<circle class="incoming-strike-ring" r="36"/>':''}<circle class="outer-orbit" r="39"/><circle class="orbit" r="25"/><circle class="core" r="${isMine?6:4}"/><text class="system-id" x="34" y="4">${String(g.id).padStart(2,'0')}</text><text class="system-name" text-anchor="middle" y="49">${esc(g.name)}</text>${underAttack?`<text class="incoming-strike-name" text-anchor="middle" y="65">${esc(strikeNames.join(' · '))}</text>`:''}${isMine?`<text class="you-label" text-anchor="middle" y="${g.y>350?-44:78}">你的坐标</text>`:''}</g>`;}).join('')}`;
 $('#starmap').querySelectorAll('[data-galaxy]').forEach(el=>{el.addEventListener('click',()=>onGalaxy(Number(el.dataset.galaxy)));el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onGalaxy(Number(el.dataset.galaxy));}});});}
function showEnergyDelta(id,delta){if(!delta)return;const target=id===viewer?$('#energy-value'):document.querySelector(`.player[data-player="${id}"] .energy-number`),layer=$('#energy-fx-layer');if(!target||!layer)return;const r=target.getBoundingClientRect(),el=document.createElement('span');el.className=`energy-delta ${delta>0?'gain':'loss'}`;el.textContent=`${delta>0?'+':''}${delta}`;el.style.left=`${r.left+r.width/2}px`;el.style.top=`${r.top-5}px`;layer.append(el);el.addEventListener('animationend',()=>el.remove(),{once:true});setTimeout(()=>el.remove(),4300);}
function updateEnergyDeltas(){for(const p of game.players){const previous=energySnapshot.get(p.id);if(previous!==undefined&&previous!==p.energy)showEnergyDelta(p.id,p.energy-previous);energySnapshot.set(p.id,p.energy);}}
function updateStrikeNotice(){const l=game.latest,notice=strikeNotice(l,viewer);if(!notice)return;const signature=`${l.batchId||l.cards.map(c=>c.id).join(',')}:${l.outcome}:${l.victimId??'empty'}:${notice.cardKey}`;if(signature===strikeNoticeSeen)return;strikeNoticeSeen=signature;toast(notice.text,'strike-hit');}
function updateTurnFeedback(){
 const self=$('.self-panel');self?.classList.remove('current-turn');
 const l=game.latest;
 if(l?.kind==='strike'&&l.outcome&&Number.isInteger(l.victimId)){
  const feedback=strikeFeedback(l.outcome,l.victimId,l.cards),signature=(l.batchId||l.cards.map(c=>c.id).join(','))+':'+l.outcome+':'+l.victimId;
  if(feedback&&signature!==feedbackSeen){
   feedbackSeen=signature;document.querySelectorAll('.transient-feedback').forEach(el=>el.remove());document.querySelectorAll('.survived-entering,.death-entering').forEach(el=>el.classList.remove('survived-entering','death-entering'));
   const duration=feedback==='locked'?1800:2400;
   feedbackState={signature,feedback,victimId:l.victimId,expiresAt:Date.now()+duration};
   setTimeout(()=>{if(feedbackState?.signature!==signature)return;document.querySelectorAll('.transient-feedback').forEach(el=>el.remove());document.querySelectorAll('.survived-entering,.death-entering').forEach(el=>el.classList.remove('survived-entering','death-entering'));feedbackState=null;},duration);
  }
 }
 const state=feedbackState;if(!state)return;
 if(Date.now()>=state.expiresAt){document.querySelectorAll('.transient-feedback').forEach(el=>el.remove());document.querySelectorAll('.survived-entering,.death-entering').forEach(el=>el.classList.remove('survived-entering','death-entering'));feedbackState=null;return;}
 const target=state.victimId===viewer?self:document.querySelector('.player[data-player="'+state.victimId+'"]');if(!target)return;
 if([...target.querySelectorAll('.transient-feedback')].some(el=>el.dataset.feedbackSignature===state.signature))return;
 let effect;if(state.feedback==='eliminated'||state.feedback==='survived'){
  const survived=state.feedback==='survived';target.classList.add(survived?'survived-entering':'death-entering');
  effect=document.createElement('span');effect.className='death-cross transient-feedback'+(survived?' survived-cross':'');
 }else{
  const locked=state.feedback==='locked';effect=document.createElement('span');effect.className='player-feedback transient-feedback '+(locked?'feedback-lock':'feedback-escape');
  effect.innerHTML=locked?'<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M15 21v-6a9 9 0 0 1 18 0v6M11 21h26v21H11zM24 29v6"/><circle cx="24" cy="28" r="1"/></svg>':'<svg viewBox="0 0 130 82" aria-hidden="true">'+art.ship+'</svg>';
 }
 effect.dataset.feedbackSignature=state.signature;effect.setAttribute('aria-hidden','true');target.append(effect);
}
function render(){for(const region of ['.self-panel','.hand-center','.actions-panel'])$(region).inert=privacy;const oldRects=busy&&!privacy&&renderViewer===viewer&&!discardMode&&!targetCard?new Map([...document.querySelectorAll('#hand [data-card-id]')].map(el=>[el.dataset.cardId,el.getBoundingClientRect()])):new Map();const p=game.players[viewer],others=game.players.filter(q=>q.id!==viewer),split=Math.ceil(others.length/2);$('#left-players').innerHTML=others.slice(0,split).map(playerHTML).join('');$('#right-players').innerHTML=others.slice(split).map(playerHTML).join('');document.querySelectorAll('[data-player]').forEach(el=>el.onclick=e=>{const id=Number(el.dataset.player);if(broadcastStep==='choose'&&!busy&&!privacy&&game.pending.responses.some(r=>r.actor===id))attempt(()=>settleBroadcast(id));else showPlayer(id);});
 $('#round-label').textContent=`第 ${String(game.round).padStart(2,'0')} 轮`;$('#turn-label').textContent=game.over?'对局结束':viewer===game.active?'你的回合':`${game.players[game.active].name}的回合`;$('#scene-tag').textContent=game.demo?'演示局面':'本地接力';$('#deck-count').textContent=game.deck.length;
 $('.self-panel').classList.toggle('eliminated',!p.alive);$('#self-avatar').textContent=p.name[0];$('#self-name').innerHTML=`${esc(p.name)} <em>你</em>`;$('#self-galaxy').textContent=privacy?'坐标暂时隐藏':p.alive?`坐标 ${p.galaxy} · ${GALAXIES[p.galaxy-1].name}`:'文明已消逝';$('#energy-value').textContent=p.energy;$('#self-hand-number').textContent=p.hand.length;$('#income-value').textContent=`+${game.income(p)} / 回合`;$('#self-assets').innerHTML=buildingHTML(p)+game.strikes.filter(s=>s.owner===p.id).map(s=>`<button class="asset-chip strike" data-strike-id="${s.id}" title="点击查看打击">↗ ${CARDS[s.card.key].name} · ${s.progress}/${s.required}</button>`).join('');$('#self-assets').querySelectorAll('[data-strike-id]').forEach(el=>el.onclick=()=>showStrike(el.dataset.strikeId));const incoming=p.alive&&!privacy?game.strikes.filter(s=>s.target===p.galaxy):[],warning=$('#incoming-warning');warning.hidden=!incoming.length;warning.innerHTML=incoming.length?`<strong>⚠ 打击来袭</strong>${incoming.map(s=>`<span>${esc(CARDS[s.card.key].name)} · 已飞 ${s.progress} 回合</span>`).join('')}`:'';
 $('#hand-count').textContent=p.hand.length;$('#hand').innerHTML=p.hand.map(c=>cardHTML(c,{back:privacy,hand:true})).join('');if(!privacy)$('#hand').querySelectorAll('[data-card-id]').forEach(el=>el.onclick=()=>onHandCard(el.dataset.cardId));
 renderLatestCards();$('#map-drop-zone').classList.toggle('targeting',Boolean(targetCard));renderMap();renderBroadcastBar();updateActions();updateEnergyDeltas();updateTurnFeedback();updateStrikeNotice();renderViewer=viewer;if(online)renderOnlineChrome();if(!reduceMotion())for(const el of document.querySelectorAll('#hand [data-card-id]')){const old=oldRects.get(el.dataset.cardId);if(!old)continue;const now=el.getBoundingClientRect(),dx=old.left-now.left,dy=old.top-now.top;if(Math.abs(dx)+Math.abs(dy)>1)el.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'}],{duration:350,easing:'cubic-bezier(.2,.7,.3,1)'});}}
function renderBroadcastBar(){
 const bar=$('#broadcast-bar'),b=game.pending;
 if(!b||b.kind!=='broadcast'||!broadcastStep||privacy||broadcastStep==='wait'){bar.hidden=true;return;}
 bar.hidden=false;
 bar.innerHTML=broadcastStep==='respond'?`<span>⌁</span><p>回应星系 ${b.target} 的广播<small>${game.isForced(viewer)?'点名你的星系，须拖出一张高亮广播牌':game.responseOptions(viewer).length?'将高亮手牌拖入地图，松手即回应':'没有可用广播牌，自动跳过'}</small></p>`:`<span>⌁</span><p>点选一位亮起的回应者<small>直接点击对手席位结算 · 牌面仍然保密</small></p>`;
}
function updateActions(){const mine=game.players[viewer],normal=!busy&&!privacy&&!game.pending&&!game.over&&viewer===game.active&&mine.alive&&!targetCard;
 const responding=broadcastStep==='respond'&&!privacy,choosing=broadcastStep==='choose'&&!privacy,waiting=broadcastStep==='wait'&&!privacy,noResponse=responding&&!game.responseOptions(viewer).length;
 $('#discard-btn').disabled=!normal||game.played;$('#discard-btn').hidden=responding||choosing;
 $('#end-btn').hidden=noResponse;$('#end-btn').disabled=waiting||(responding?busy||game.isForced(viewer):!normal||(discardMode&&!selected.size));
 $('#discard-btn').innerHTML=discardMode?'取消选择 <span>×</span>':'弃牌 <span>⇄</span>';
 $('#end-btn').innerHTML=waiting?'等待结算…':responding?(game.responseOptions(viewer).length?'不回应 <span>→</span>':'继续 <span>→</span>'):choosing?'点选回应者':discardMode?'确认弃置 '+selected.size+' 张 <span>→</span>':'结束行动 <span>→</span>';
 $('#action-status').textContent=game.over?'对局结束':privacy?'等待接手':busy?'卡牌移动中':responding?(noResponse?'无可回应牌，自动跳过':'拖牌回应'):choosing?'选择回应者':game.pending?.kind==='broadcast'?'广播进行中':game.pending?.kind==='escape'?'逃生抉择':targetCard?'选择目标星系':discardMode?'选择要弃的牌':viewer!==game.active?'等待其他玩家':'行动阶段';
 $('#action-hint').innerHTML=responding?(noResponse?'没有符合条件的广播牌。<br>系统将自动跳过回应。':game.isForced(viewer)?'此次广播点名你的星系。<br>拖出高亮牌回应。':'高亮广播牌可直接拖出。<br>可选择不回应。'):choosing?'点击亮起的对手席位。<br>选择一位共同结算。':game.played?'本回合已经出牌。<br>结束后补牌，可以留牌。':discardMode?'点击手牌进行多选。<br>确认后补牌并结束行动。':'逐张出牌，也可以留牌。<br>灰色牌暂时无法打出。';
 $('.hand-heading small').textContent=responding?(noResponse?'没有可回应的广播牌':'高亮牌可拖入地图回应'):'单击查看 · 拖入地图出牌';
 $('#new-btn').disabled=busy;$('#reset-demo-btn').disabled=busy;
}
function hideDialog(){$('#overlay').hidden=true;$('.app').inert=false;$('#target-bar').inert=false;}
function showDialog(html,{closable=true}={}){clearTimeout(escapeTimer);if($('#overlay').hidden)dialogReturn=document.activeElement;$('.app').inert=true;$('#target-bar').inert=true;$('#dialog').innerHTML=`${closable?'<button class="close-dialog" aria-label="关闭">×</button>':''}${html}`;$('#overlay').hidden=false;const close=$('.close-dialog');if(close)close.onclick=closeDialog;setTimeout(()=>$('#dialog').querySelector('button:not(.close-dialog):not(.game-card):not(:disabled)')?.focus({preventScroll:true}),20);}
function closeDialog(){hideDialog();dialogReturn?.focus?.({preventScroll:true});dialogReturn=null;}
function modalTitle(kicker,title){return `<span class="eyebrow">${kicker}</span><h2 id="dialog-title">${title}</h2>`;}
function attempt(fn){try{const p=fn();if(p?.catch)p.catch(error=>{setBusy(false);toast(error.message);});}catch(error){setBusy(false);toast(error.message);}}
function onHandCard(id){if(busy||privacy)return;if(discardMode){selected.has(id)?selected.delete(id):selected.add(id);render();return;}openCard(id);}
function openCard(id){
 const c=game.players[viewer].hand.find(c=>c.id===id);if(!c)return;const d=CARDS[c.key];let error='';
 if(broadcastStep==='respond')error=cardState(c).reason;else if(viewer!==game.active)error='当前不是你的行动回合';else if(game.pending)error='请先完成当前交互';else if(game.over)error='对局已结束';else try{game.playable(id);}catch(e){error=e.message;}
 showDialog(`${modalTitle(TYPES[d.type]+' / CARD DETAILS',d.name)}<div class="detail-card">${cardHTML(c,{detail:true})}</div><p>${d.detail}</p><div class="detail-facts"><span>使用费用</span><strong>◇ ${d.cost} 能量${d.type==='broadcast'?' · 结算后计算':''}</strong></div><div class="detail-facts"><span>${d.type==='broadcast'?'广播距离':d.type==='build'?'恒星依赖':'打击等级'}</span><strong>${d.type==='broadcast'?(d.range===Infinity?'无限':d.range+' 跳'):d.type==='build'?(d.star?'需要恒星':'不依赖恒星'):(d.level===Infinity?'∞':d.level)}</strong></div><p class="detail-help">${error||'关闭详情后，将手牌拖进星系地图即可出牌。'}</p><div class="dialog-actions"><button class="primary-btn" id="card-close">知道了</button></div>`);
 $('#card-close').onclick=closeDialog;
}
function canDrag(id){
 if(busy||privacy||discardMode||targetCard||game.over||!$('#overlay').hidden||!game.players[viewer].alive)return false;
 const card=game.players[viewer].hand.find(c=>c.id===id);if(!card||cardState(card).blocked)return false;
 return broadcastStep==='respond'||(!game.pending&&viewer===game.active);
}
function validateDrag(id){if(broadcastStep==='respond'){const c=game.responseOptions(viewer).find(c=>c.id===id);if(!c)throw Error('这张牌无法回应');return c;}return game.playable(id);}
function submitCard(id,originRect){
 if(!canDrag(id))return;
 if(broadcastStep==='respond')return respond(viewer,id,originRect);
 const card=game.playable(id),d=CARDS[card.key];
 if(d.type==='build')return performPlay(id,undefined,originRect);
 return startTarget(id,originRect);
}
async function startTarget(id,originRect){
 const card=game.playable(id),d=CARDS[card.key],sequence=++aimSequence;
 targetCard=id;const source=originRect||rect($(`#hand [data-card-id=\"${id}\"]`));targetCardSize=source?{width:source.width,height:source.height}:null;selected.clear();selected.add(id);render();
 $('#target-bar').hidden=false;
 $('#target-bar').innerHTML=`<span class="aim-card" id="aim-card" style="--card-color:${COLORS[d.type]}"><span>${d.type==='broadcast'?'⌁':'↗'}</span><b>${d.name}</b></span><p>点选目标星系<small>${d.type==='broadcast'?`距离 ${d.range===Infinity?'∞':d.range} 内的亮起星系可选`:'点击星系即发射，无需再次确认'}</small></p><button id="cancel-target" aria-label="取消出牌">取消</button>`;
 $('#cancel-target').onclick=cancelTarget;
 if(originRect){setBusy(true);try{await fly(card,originRect,centerRect($('#aim-card')));}finally{if(sequence===aimSequence)setBusy(false);}}
 else $('#map-drop-zone').scrollIntoView({behavior:'instant',block:'center'});
 if(targetCard===id)$('#status-message').textContent=`已放入${d.name}，点选星系即可${d.type==='broadcast'?'广播':'发射'}。`;
}
function cancelTarget(){
 ++aimSequence;targetCard=null;targetCardSize=null;selected.clear();$('#target-bar').hidden=true;
 document.querySelectorAll('#flight-layer .flying-card').forEach(el=>el.getAnimations().forEach(a=>a.finish()));
 setBusy(false);render();$('#status-message').textContent='已取消，卡牌与能量未消耗。';
}
function onGalaxy(id){if(busy||privacy)return;const g=GALAXIES[id-1];if(targetCard){
 const chosen=targetCard,card=game.players[game.active].hand.find(c=>c.id===chosen),d=CARDS[card.key];
 if(d.type==='strike'&&id===game.players[game.active].galaxy){toast('不能打击自己的星系');return;}
 if(d.type==='broadcast'&&distance(game.players[game.active].galaxy,id)>d.range){toast('该星系超出广播范围，请选择亮起的星系');return;}
 const origin=centerRect($('#aim-card')),cardSize=targetCardSize;++aimSequence;targetCard=null;targetCardSize=null;selected.clear();$('#target-bar').hidden=true;
 attempt(()=>performPlay(chosen,id,origin,cardSize));return;}
 toast(`${id} · ${g.name} ｜ ${game.markers[id]==='gray'?'星系已被降维删除，可发送广播':game.markers[id]==='red'?'恒星已熄灭（仍可建设）':'恒星正常'} ｜ ${game.players[viewer].alive&&game.players[viewer].galaxy===id?'你的星系':distance(game.players[viewer].galaxy,id)+' 跳 · 文明坐标未知'}`);}

function rect(el){return el?.getBoundingClientRect();}
function centerRect(el){const r=rect(el);return r||{left:innerWidth/2-40,top:innerHeight/2-50,width:80,height:100};}
async function fly(c,from,to,options={}){const holder=document.createElement('div');holder.innerHTML=cardHTML(c,{back:options.back});return cardFlight(holder.firstElementChild,from,to,options);}
async function flyTo(c,from,toEl,options={}){if(!toEl)return fly(c,from,centerRect($('#latest-content')),options);const holder=document.createElement('div');holder.innerHTML=cardHTML(c,{back:options.back});return cardInto(holder.firstElementChild,from,toEl,options);}
async function animateDraws(events){const draws=events.filter(e=>e.type==='draw'&&e.player===viewer),anchor=centerRect($('.deck-stack'));await Promise.all(draws.map((e,i)=>{const el=$(`#hand [data-card-id="${e.card.id}"]`);return flyTo(e.card,anchor,el,{back:true,delay:i*95}).then(()=>{if(el&&!reduceMotion())el.animate([{transform:'rotateY(75deg)',opacity:.5},{transform:'rotateY(0deg)',opacity:1}],{duration:250,easing:'ease-out'});});}));}
async function performPlay(id,target,originRect,cardSize=null){if(online)return onlineAction({type:'play',cardId:id,target},{originRect,cardSize});setBusy(true);const from=originRect||centerRect($(`#hand [data-card-id="${id}"]`));const card=game.play(id,target),d=CARDS[card.key];game.flush();render();let dest=d.type==='build'?$(`#self-assets [data-asset-ids~="${id}"]`):d.type==='broadcast'?$(`#latest-content [data-latest-id="${id}"]`):$(`[data-strike-id="${id}"]`)||$(`#latest-content [data-latest-id="${id}"]`);await flyTo(card,from,dest,{back:d.type==='broadcast',cardSize});setBusy(false);
 if(d.type==='build')toast(`${d.name}已进入建设区`);else if(d.type==='strike'&&!d.instant)toast(`${d.name}已发射，等待抵达目标`);
 if(game.pending?.kind==='broadcast'){responseQueue=game.players.filter(p=>p.alive&&p.id!==game.pending.caster).map(p=>p.id);nextResponse();}else handlePending();}
function handoff(id,reason,after){
 broadcastStep=null;privacy=true;hideDialog();render();clearTimeout(toastTimer);$('#toast').classList.remove('visible');$('#status-message').textContent='请交给'+game.players[id].name+'，手牌与坐标已隐藏。';
 const cover=$('#handoff-cover');cover.hidden=false;cover.innerHTML=`<span class="handoff-icon">◉</span><div><b>请交给${esc(game.players[id].name)}</b><p>${reason}</p><small>手牌与坐标已隐藏 · 同一设备接力</small></div><button class="primary-btn" id="handoff-confirm">我是${esc(game.players[id].name)}，接手 →</button>`;
 $('#handoff-confirm').onclick=()=>{cover.hidden=true;viewer=id;privacy=false;render();after?.();};
 $('#handoff-confirm').focus({preventScroll:true});
}
function waitForEmptyBroadcast(){const pending=game.pending,caster=pending.caster,begin=()=>{broadcastStep='wait';render();$('#status-message').textContent='广播进行中。';clearTimeout(broadcastTimer);broadcastTimer=setTimeout(()=>{if(game.pending===pending)settleBroadcast(null);},3000);};if(viewer!==caster)handoff(caster,'请广播发布者接手。',begin);else begin();}
function nextResponse(){while(responseQueue.length){const id=responseQueue.shift();if(!game.responseOptions(id).length){game.respond(id,null);game.flush();continue;}handoff(id,'接手后，直接拖出高亮广播牌回应。',()=>showResponse(id));return;}if(!game.pending)return;if(!game.pending.responses.length){waitForEmptyBroadcast();return;}const id=game.pending.caster;handoff(id,'所有可回应的玩家已表态，接手后选择回应者结算。',showResponderChoice);}
function showResponse(id){broadcastStep='respond';render();$('#status-message').textContent=game.isForced(id)?'广播点名你的星系，拖出高亮牌回应。':'将高亮广播牌拖入地图回应。';}
async function respond(id,cardId,originRect){
 if(online)return onlineAction({type:'respond',cardId},{originRect});
 setBusy(true);const from=cardId?(originRect||centerRect($(`#hand [data-card-id="${cardId}"]`))):null;
 const c=cardId?game.players[id].hand.find(c=>c.id===cardId):null;
 game.respond(id,cardId);game.flush();broadcastStep=null;render();
 if(c)await flyTo(c,from,$(`#latest-content [data-latest-id="${c.id}"]`),{back:true});
 setBusy(false);nextResponse();
}
function showResponderChoice(){const b=game.pending;if(!b?.responses)return;
 if(b.responses.length<2){settleBroadcast(b.responses[0]?.actor??null);return;}
 broadcastStep='choose';render();toast('点击亮起的对手席位，选择一位回应者结算。');
}
function settleBroadcast(id){if(online)return onlineAction({type:'settle',chosen:id});clearTimeout(broadcastTimer);broadcastTimer=null;game.settleBroadcast(id);broadcastStep=null;const event=game.flush().find(e=>e.type==='broadcast_resolved');render();$('#latest-content').querySelectorAll('.played-mini').forEach(el=>el.classList.add('batch-flip'));$('#energy-value').classList.add('energy-flash');setTimeout(()=>$('#energy-value').classList.remove('energy-flash'),650);toast(event.gain?`广播结算完成，你的能量 ${event.gain>=0?'+':''}${event.gain}`:'广播结算完成');handlePending();}
function handlePending(){if(game.over){showWinner();return;}if(game.pending?.kind==='escape'){const id=game.pending.victim;handoff(id,'你的文明遭遇致命打击，请决定是否启动光速飞船。',showEscape);return;}if(!game.players[game.active].alive){game.nextSeat();game.flush();render();if(game.over||game.pending){handlePending();return;}handoff(game.active,'你的回合即将开始。');return;}render();}
function showEscape(){if(online)return showOnlineEscape();showDialog(`${modalTitle('LAST CHANCE / ESCAPE','最后一次跃迁')}<p>这次打击无法被你的建筑抵御。你可以使用光速飞船，放弃所有建设与能量，随机逃往一个合法空星系。</p><p>新坐标仅你可见。30 秒内未选择，将视为放弃。</p><div class="dialog-actions"><button class="secondary-btn" id="escape-no">放弃逃生</button><button class="primary-btn" id="escape-yes">启动光速飞船 →</button></div>`,{closable:false});const resolve=use=>{clearTimeout(escapeTimer);hideDialog();attempt(()=>{game.resolveEscape(use);game.flush();render();toast(use?'跃迁成功，新坐标已更新':'文明消逝，已发出的打击继续飞行');if(!game.players[viewer].alive&&!game.over){showDialog(`${modalTitle('CIVILIZATION LOST','你的文明已消逝')}<p>你已被打击淘汰。已发出的打击仍会继续飞行。</p><div class="dialog-actions"><button class="primary-btn" id="local-elimination-continue">继续 →</button></div>`,{closable:false});$('#local-elimination-continue').onclick=()=>{hideDialog();handlePending();};}else if(game.over||game.pending)handlePending();else if(game.active!==viewer)handoff(game.active,'回到当前行动玩家。');});};$('#escape-no').onclick=()=>resolve(false);$('#escape-yes').onclick=()=>resolve(true);escapeTimer=setTimeout(()=>resolve(false),30000);}

async function finishAction(){if(online)return onlineAction(discardMode?{type:'discard',ids:[...selected]}:{type:'end'});const buildingOrigins=new Map([...document.querySelectorAll("[data-asset-ids]")].flatMap(el=>el.dataset.assetIds.split(" ").filter(Boolean).map(id=>[id,centerRect(el)])));if(busy||privacy||targetCard)return;setBusy(true);const oldViewer=viewer;const toDiscard=discardMode?game.players[viewer].hand.filter(c=>selected.has(c.id)):[];const origins=toDiscard.map(c=>({card:c,from:centerRect($(`#hand [data-card-id="${c.id}"]`))}));if(discardMode)game.discardCards([...selected]);else game.endTurn();const events=game.flush();selected.clear();discardMode=false;render();if(origins.length)await Promise.all(origins.map((x,i)=>flyTo(x.card,x.from,$(`#latest-content [data-latest-id="${x.card.id}"]`)||$('#latest-content'),{delay:i*75})));for(const event of events.filter(e=>e.type==='star_discard'))await Promise.all(event.cards.map(c=>fly(c,buildingOrigins.get(c.id),centerRect($(`#latest-content [data-latest-id="${c.id}"]`)||$('#latest-content')))));await animateDraws(events);setBusy(false);if(events.some(e=>e.type==='shuffle'))toast('抽牌堆已空，累计弃置牌重新洗入');else toast('补牌完成，交给下一位玩家');if(game.over||game.pending){handlePending();return;}handoff(game.active,'你的回合开始：基础能量与有效建筑产能已到账。');}
function showPlayer(id){if(privacy)return;if(online&&onlineRoom.members[id]?.accountId){online.openProfile(onlineRoom.members[id]);return;}const p=game.players[id],builds=p.builds.map(c=>CARDS[c.key].name).join('、')||'无',strikes=game.strikes.filter(x=>x.owner===id).map(x=>`${CARDS[x.card.key].name} → 星系 ${x.target}（已飞 ${x.progress}）`).join('、')||'无';toast(`${p.name} ｜ ${p.alive?'文明存续':'已出局'} · 能量 ${p.energy} · 手牌 ${p.hand.length} ｜ 建筑：${builds} ｜ 在飞打击：${strikes}`);}
function showStrike(id){const s=game.strikes.find(s=>s.id===id);if(!s)return;const can=viewer===game.active&&s.owner===viewer&&!game.pending&&!game.over&&!busy;showDialog(`${modalTitle('STRIKE / IN FLIGHT',CARDS[s.card.key].name)}<div class="detail-facts"><span>目标星系</span><strong>${s.target} · ${GALAXIES[s.target-1].name}</strong></div><div class="detail-facts"><span>飞行进度 · 仅你可见</span><strong>${s.progress} / ${s.required}</strong></div><p>发起者出局后，这张打击牌仍按原座位计时继续飞行。撤回会弃置这张牌，已支付的能量不返还。</p><div class="dialog-actions"><button class="secondary-btn" id="strike-close">继续飞行</button><button class="primary-btn" id="withdraw-strike" ${can?'':'disabled'}>撤回打击</button></div>`);$('#strike-close').onclick=closeDialog;$('#withdraw-strike').onclick=()=>attempt(()=>{if(online){closeDialog();return onlineAction({type:'withdraw',strikeId:id});}game.withdraw(id);game.flush();closeDialog();render();toast('打击已撤回，能量不退');if(game.over)showWinner();});}
function showRules(){showDialog(`${modalTitle('FIELD MANUAL','森林生存指南')}<div class="rules-tags"><span class="asset-chip" style="--card-color:var(--broadcast);color:var(--broadcast);border-color:#e7837f66">广播 · 红</span><span class="asset-chip">建设 · 蓝</span><span class="asset-chip strike">打击 · 绿</span></div><ul class="rule-list"><li><b>每回合</b> 固定基础 +1 能量，加有效建筑产能。开始时不摸牌。</li><li><b>行动</b> 单击卡牌只查看详情；将卡牌拖进星系地图出牌，广播和打击随后直接点选星系。可以留牌。出过牌后弃牌按钮禁用；结束行动后补至 4 张。</li><li><b>弃牌</b> 在未出牌时选择任意张弃置，补至 4 张后结束行动。</li><li><b>广播</b> 合作或伪装直到结算才翻面，结算后统一计算能量。被点名且持有可用牌时必须回应，监听基地可免回应。</li><li><b>恒星</b> 熄灭时全部依赖恒星的建设牌移至弃牌堆，也不能再建造这类建筑。</li><li><b>科技锁死</b> 拆掉全部已建建筑，返还被拆者总费用的一半，向下取整，手牌不变。</li><li><b>牌库</b> 只展示最近一次弃置，广播同批展示。抽牌堆摸空时才回收全部已弃置牌。</li><li><b>终局</b> 出局者的打击继续飞。只剩一人也要等待所有打击清空，才能确认胜负。</li></ul><p style="font-size:10px">在线房间支持 3–6 位真人或 AI 玩家，服务器统一处理规则和隐藏信息。Demo 为同设备接力试玩；演示局面预置能量与建筑，便于体验动画。</p><div class="dialog-actions"><button class="primary-btn" id="rules-close">进入森林 →</button></div>`);$('#rules-close').onclick=closeDialog;}
function newGameDialog(){if(online){online.home();return;}let count=game.players.length;showDialog(`${modalTitle('LOCAL TABLE / NEW GAME','开启一片新的森林')}<p>选择同一设备接力试玩的人数。所有决定都由玩家手动操作，没有 AI 自动行动。</p><div class="count-choices">${[3,4,5,6].map(n=>`<button class="count-choice${n===count?' active':''}" data-count="${n}">${n} 人</button>`).join('')}</div><label class="radio-line"><span>标准开局：3 能量 / 4 手牌</span><input type="radio" name="new-scene" value="standard" checked></label><label class="radio-line"><span>演示局面：预置能量与设施</span><input type="radio" name="new-scene" value="demo"></label><p class="new-info">开始后会重置当前本地牌桌。手机竖屏、横屏与电脑使用同一套规则。</p><div class="dialog-actions"><button class="secondary-btn" id="new-cancel">继续当前对局</button><button class="primary-btn" id="start-game">开始试玩 →</button></div>`);document.querySelectorAll('[data-count]').forEach(el=>el.onclick=()=>{count=Number(el.dataset.count);document.querySelectorAll('[data-count]').forEach(x=>x.classList.toggle('active',x===el));});$('#new-cancel').onclick=closeDialog;$('#start-game').onclick=()=>{const demo=$('input[name="new-scene"]:checked').value==='demo';resetGame({count,demo});};}
function resetGame({count=4,demo=true}={}){dragControls?.cancel();++aimSequence;clearTimeout(escapeTimer);clearTimeout(broadcastTimer);broadcastTimer=null;game=new Game({count,demo,seed:10723});energySnapshot.clear();feedbackSeen='';strikeNoticeSeen='';feedbackState=null;viewer=0;privacy=false;busy=false;discardMode=false;selected.clear();targetCard=null;targetCardSize=null;responseQueue=[];broadcastStep=null;$('#handoff-cover').hidden=true;hideDialog();$('#target-bar').hidden=true;$('#flight-layer').replaceChildren();render();toast(demo?'演示局面已重置：拖牌到地图即可出牌':'标准对局已开始：观测者先手');}
function showWinner(){if(online)return showOnlineWinner();privacy=false;render();const name=game.winner===null?'永恒黑暗':game.players[game.winner].name+'成为终极文明';showDialog(`${modalTitle('THE FOREST FALLS SILENT','宇宙重归寂静')}<div class="winner-mark">◉</div><p style="text-align:center;font-size:18px;color:#d1ddb7">${name}</p><p style="text-align:center">所有在飞打击已经结算。${game.winner===null?'没有文明幸存，本局没有赢家。':'森林只留下最后一个文明。'}</p><div class="dialog-actions"><button class="primary-btn" id="play-again">再开一局 →</button></div>`);$('#play-again').onclick=newGameDialog;}

$('#discard-btn').onclick=()=>{if(busy||game.played||game.pending||viewer!==game.active)return;discardMode=!discardMode;selected.clear();render();if(discardMode)toast('选择要弃置的手牌，可多选');};
$('#end-btn').onclick=()=>attempt(()=>broadcastStep==='respond'&&!busy&&!privacy?respond(viewer,null):finishAction());$('#rules-btn').onclick=showRules;$('#new-btn').onclick=newGameDialog;$('#reset-demo-btn').onclick=()=>resetGame({count:game.players.length,demo:true});$('#map-info-btn').onclick=()=>onGalaxy(!privacy?game.players[viewer].galaxy:5);
$('#overlay').addEventListener('click',e=>{if(e.target===$('#overlay')&&$('.close-dialog'))closeDialog();});document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('#overlay').hidden&&$('.close-dialog'))closeDialog();else if(targetCard)cancelTarget();}});
dragControls=mountCardDrag({
 hand:$('#hand'),map:$('#map-drop-zone'),canStart:canDrag,
 validate:validateDrag,
 onStart:id=>{const c=game.players[viewer].hand.find(c=>c.id===id),d=CARDS[c.key];setBusy(true);$('#map-drop-zone').style.setProperty('--drop-color',COLORS[d.type]);$('#map-drop-zone').classList.add('drag-ready');$('#drop-label').textContent=broadcastStep==='respond'?'松手即可回应':d.type==='build'?'松手即可建造':'松手后点选星系';},
 onHover:over=>$('#map-drop-zone').classList.toggle('drag-over',over),
 onDrop:(id,origin)=>attempt(()=>submitCard(id,origin)),
 onStop:()=>{$('#map-drop-zone').classList.remove('drag-ready','drag-over');$('#drop-label').textContent='拖牌到此出牌 ↗';setBusy(false);},
 onError:message=>toast(message)
});
$('#hand').addEventListener('keydown',event=>{
 const card=event.target.closest('button[data-card-id]');if(!card||event.code!=='Space'||discardMode)return;
 event.preventDefault();if(canDrag(card.dataset.cardId))attempt(()=>submitCard(card.dataset.cardId));
});
let resizeFrame;window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{document.querySelectorAll('.flying-card,#hand .game-card').forEach(el=>el.getAnimations().forEach(a=>{try{a.finish();}catch{a.cancel();}}));renderMap();});});
$('#menu-btn').onclick=()=>document.dispatchEvent(new CustomEvent('portal:home'));
$('#exit-btn').onclick=()=>document.dispatchEvent(new CustomEvent('portal:exit'));
render();document.documentElement.dataset.ready='true';

// Online rooms reuse the card table; all state changes are confirmed by the Worker.
function hydrateOnline(data){
 const state=structuredClone(data);state.events=[];state.deck=Array.from({length:state.deckCount},()=>({}));
 state.players.forEach(p=>{if(!p.hand)p.hand=Array.from({length:p.handCount},()=>({}));});
 return Object.assign(Object.create(Game.prototype),state);
}
function prepareTable(){
 ++onlineEpoch;onlineQueued=null;
 finishTableAnimations();
 dragControls?.cancel();++aimSequence;clearTimeout(escapeTimer);clearTimeout(broadcastTimer);broadcastTimer=null;strikeNoticeSeen='';selected.clear();discardMode=false;targetCard=null;targetCardSize=null;
 privacy=false;busy=false;broadcastStep=null;responseQueue=[];onlineQueued=null;onlineEscapeId=null;energySnapshot.clear();turnPromptKey='';eliminationPromptKey='';feedbackSeen='';feedbackState=null;
 $('#handoff-cover').hidden=true;hideDialog();$('#target-bar').hidden=true;$('#flight-layer').replaceChildren();$('#energy-fx-layer').replaceChildren();
 $('.app').hidden=false;
}
export function suspendTable(){
 ++onlineEpoch;finishTableAnimations();onlineQueued=null;busy=false;
 dragControls?.cancel();clearTimeout(escapeTimer);hideDialog();targetCard=null;targetCardSize=null;selected.clear();discardMode=false;
 $('#target-bar').hidden=true;$('#handoff-cover').hidden=true;$('#flight-layer').replaceChildren();
}
function finishTableAnimations(){for(const el of document.querySelectorAll('#flight-layer .flying-card,.played-mini,#hand .game-card'))for(const animation of el.getAnimations())try{animation.finish();}catch{animation.cancel();}}
export function launchDemo(){
 online=null;onlineRoom=null;prepareTable();$('.app').classList.remove('online-mode');
 $('.top-status').innerHTML='<span class="live-dot"></span>Demo 试玩<span class="status-separator"></span><span class="muted">同设备接力</span>';
 $('.room-title h1').textContent='星海试验场';$('.bottom-bar>span:first-child').textContent='本地 Demo · 同设备接力';
 $('#exit-btn').hidden=true;$('#new-btn').hidden=false;$('#reset-demo-btn').hidden=false;resetGame({count:4,demo:true});
}
export function launchOnline(room,transport){
 online=transport;prepareTable();$('.app').classList.add('online-mode');applyOnlineRoom(room);
 maybeOnlinePrompt();
}
function renderOnlineChrome(){
 $('.self-ident').onclick=()=>online.openProfile(onlineRoom.members[viewer]);$('.self-ident').style.cursor='pointer';
 $('#scene-tag').textContent='在线房间';$('.room-title h1').textContent=onlineRoom.name;
 $('.bottom-bar>span:first-child').textContent='在线对战 · '+game.players.length+' 位文明';
 $('.top-status').innerHTML='<span class="live-dot"></span>在线房间 · 实时同步';
 $('#exit-btn').hidden=false;$('#new-btn').hidden=true;$('#reset-demo-btn').hidden=true;
 document.querySelectorAll('[data-player]').forEach(el=>{
   const member=onlineRoom.members[Number(el.dataset.player)];
   if(member?.bot){
     const label=el.querySelector('.player-sub');
     if(label&&!el.classList.contains('responder-choice')){label.textContent=member.exited?'真人已退出 · AI 接管':({easy:'简单',normal:'普通',hard:'困难',deepseek:'智能'}[member.bot]||'智能')+' AI · 坐标未知';}
     const avatar=el.querySelector('.avatar');
     if(avatar){
       const isDeepSeek=member.bot==='deepseek';
       avatar.classList.toggle('deepseek-avatar',isDeepSeek);
       avatar.innerHTML=isDeepSeek?'<img src="/deepseek-mark.svg" alt="DeepSeek" draggable="false">':'D';
     }
   }
 });
 if(!game.players[viewer].alive&&!game.over)$('#action-hint').innerHTML='你的文明已消逝。<br>可以继续观战，已发打击仍在飞行。';
}
function applyOnlineRoom(room){
 onlineRoom=room;game=hydrateOnline(room.game);viewer=room.me;privacy=false;
 const b=game.pending;
 broadcastStep=b?.kind==='broadcast'?(b.autoSettleAt?'wait':viewer!==b.caster&&game.players[viewer].alive&&!b.decisions.includes(viewer)?'respond':viewer===b.caster&&game.players.every(p=>!p.alive||p.id===b.caster||b.decisions.includes(p.id))?'choose':null):null;
 if(targetCard&&(!game.players[viewer].hand.some(c=>c.id===targetCard)||game.pending||viewer!==game.active)){
   targetCard=null;targetCardSize=null;selected.clear();$('#target-bar').hidden=true;
 }
 render();
}
function onlineOrigins(){
 const origins=new Map();
 for(const el of document.querySelectorAll('#hand [data-card-id]'))origins.set(el.dataset.cardId,centerRect(el));
 for(const el of document.querySelectorAll('[data-asset-ids]'))for(const id of el.dataset.assetIds.split(' '))if(id)origins.set(id,centerRect(el));
 for(const el of document.querySelectorAll('[data-strike-id]'))origins.set(el.dataset.strikeId,centerRect(el));
 return origins;
}
async function animateOnlineChange(previous,origins,{action=null,originRect=null,cardSize=null}={}){
 const before=previous.players[viewer],after=game.players[viewer],oldIds=new Set(before.hand.map(c=>c.id));
 const flights=[];
 const oldPhysical=new Set([...previous.players.flatMap(p=>p.builds),...previous.strikes.map(s=>s.card)].map(c=>c.id));
 for(const p of game.players)for(const card of p.builds)if(!oldPhysical.has(card.id)){
   const source=p.id===viewer?(originRect||origins.get(card.id)||centerRect($('#hand'))):centerRect($(`[data-player="${p.id}"] .avatar`));
   flights.push(flyTo(card,source,$(`[data-asset-ids~="${card.id}"]`),{cardSize}));
 }
 for(const strike of game.strikes)if(!oldPhysical.has(strike.card.id)){
   const source=strike.owner===viewer?(originRect||origins.get(strike.id)||centerRect($('#hand'))):centerRect($(`[data-player="${strike.owner}"] .avatar`));
   flights.push(flyTo(strike.card,source,$(`[data-strike-id="${strike.id}"]`),{cardSize}));
 }
 const sameBroadcast=game.latest?.kind==='broadcast'&&game.latest.batchId&&game.latest.batchId===previous.latest?.batchId;
 const skipLatestAnimation=new Set(sameBroadcast&&game.latest.revealed&&!previous.latest.revealed?game.latest.cards.map(c=>c.id):previous.latest?.cards.map(c=>c.id)||[]);
 const latestCardAlreadyHasAFlight=game.latest?.kind==='build'||game.latest?.kind==='strike'&&game.latest.cards.some(c=>c.role==='发射');
 for(const c of game.latest?.cards||[])if(!skipLatestAnimation.has(c.id)){
   const mine=c.actor===viewer,original=before.hand.find(x=>x.id===c.id),isRemoved=origins.has(c.id);
   const source=mine?(originRect||origins.get(c.id)||(original?centerRect($('#hand')):null)):isRemoved?origins.get(c.id):centerRect($(`[data-player="${c.actor}"] .avatar`));
   if(!latestCardAlreadyHasAFlight)flights.push(flyTo(game.latest.revealed?c:{id:c.id},source,$(`#latest-content [data-latest-id="${c.id}"]`),{back:!game.latest.revealed,cardSize}));
 }
 if(game.latest?.revealed&&!previous.latest?.revealed)$('#latest-content').querySelectorAll('.played-mini').forEach(el=>el.classList.add('batch-flip'));
 for(const card of after.hand)if(!oldIds.has(card.id))flights.push(flyTo(card,centerRect($('.deck-stack')),$(`#hand [data-card-id="${card.id}"]`),{back:true}));
 await Promise.all(flights);
}
export async function receiveOnlineRoom(room){
 if(!online||$('.app').hidden||!room.game||room.id!==onlineRoom.id||room.revision<=onlineRoom.revision)return;
 if(busy){if(!onlineQueued||onlineQueued.revision<room.revision)onlineQueued=room;return;}
 const previous=game,origins=onlineOrigins(),epoch=onlineEpoch;setBusy(true);
 try{applyOnlineRoom(room);await animateOnlineChange(previous,origins);}finally{if(epoch===onlineEpoch){setBusy(false);maybeOnlinePrompt();}}
}
async function onlineAction(action,{originRect=null,cardSize=null}={}){
 if(busy||privacy)return;
 const previous=game,origins=onlineOrigins(),epoch=onlineEpoch,bridge=online;
 if(action.cardId&&!originRect)originRect=centerRect($(`#hand [data-card-id="${action.cardId}"]`));
 setBusy(true);
 try {
   const room=await bridge.send({...action,phase:game.pending?.id},onlineRoom.revision);
   if(epoch!==onlineEpoch)return;
   if(['end','discard','play'].includes(action.type)){selected.clear();discardMode=false;}
   applyOnlineRoom(room);await animateOnlineChange(previous,origins,{action,originRect,cardSize});
   if(action.type==='settle')toast('广播结算完成');
   else if(action.type==='discard'||action.type==='end')toast('补牌完成，等待下一位文明行动');
 }catch(error){if(epoch===onlineEpoch){toast(error.message);bridge.reconnect();throw error;}}
 finally{if(epoch===onlineEpoch){setBusy(false);maybeOnlinePrompt();}}
}
function maybeOnlinePrompt(){
 if(!online||$('.app').hidden)return;
 if(game.over){showOnlineWinner();return;}
 if(!game.players[viewer]?.alive){const l=game.latest;if(l?.outcome==='eliminated'&&l.victimId===viewer){const key=`${onlineRoom.id}:${l.batchId||l.cards.map(c=>c.id).join(',')}:${viewer}`;if(eliminationPromptKey!==key){eliminationPromptKey=key;showDialog(`${modalTitle('CIVILIZATION LOST','你的文明已消逝')}<p>你已被打击淘汰。已发出的打击仍会继续飞行，你可以留在牌桌观战。</p><div class="dialog-actions"><button class="primary-btn" id="elimination-continue">继续观战 →</button></div>`,{closable:false});$('#elimination-continue').onclick=closeDialog;}}return;}
 if(game.pending?.kind==='escape'&&game.pending.victim===viewer&&onlineEscapeId!==game.pending.strikeId)showOnlineEscape();
 if(game.players[viewer]?.alive&&game.active===viewer&&!game.pending){const key=`${onlineRoom.id}:${game.round}:${game.turnIndex}:${viewer}`;if(turnPromptKey!==key){turnPromptKey=key;showDialog(`${modalTitle('YOUR TURN','你的回合开始')}<p>现在由你行动。可以逐张出牌，结束行动后再补牌。</p><div class="dialog-actions"><button class="primary-btn" id="turn-ready">开始行动 →</button></div>`);$('#turn-ready').onclick=closeDialog;}}
}
function showOnlineEscape(){
 onlineEscapeId=game.pending.strikeId;
 showDialog(`${modalTitle('LAST CHANCE / ESCAPE','最后一次跃迁')}<p>这次打击将摧毁你的文明。是否使用光速飞船，清空能量与建设，随机跃迁到其他合法空星系？新坐标仅你可见。</p><div class="dialog-actions"><button class="secondary-btn" id="escape-no">放弃逃生</button><button class="primary-btn" id="escape-yes">启动光速飞船</button></div>`,{closable:false});
 const decide=use=>{hideDialog();attempt(()=>onlineAction({type:'escape',use}));};
 $('#escape-no').onclick=()=>decide(false);$('#escape-yes').onclick=()=>decide(true);
}
function showOnlineWinner(){
 const title=game.winner===null?'没有文明幸存':game.players[game.winner].name+'成为终极文明';
 const viewerLost=!game.players[viewer]?.alive;
 showDialog(`${modalTitle('THE FOREST FALLS SILENT','宇宙重归寂静')}<div class="winner-mark">◉</div><p style="text-align:center">${esc(title)}</p><p>${viewerLost?'你的文明已消逝。':''}所有在飞打击已经结算。${onlineRoom.isHost?'你可以回到房间，再开一局。':'等待房主开启下一局。'}</p><div class="dialog-actions"><button class="secondary-btn" id="winner-home">主菜单</button>${onlineRoom.isHost?'<button class="primary-btn" id="winner-rematch">返回房间</button>':''}</div>`,{closable:false});
 $('#winner-home').onclick=()=>{hideDialog();online.home();};
 if($('#winner-rematch'))$('#winner-rematch').onclick=()=>attempt(()=>{hideDialog();return online.rematch();});
}
