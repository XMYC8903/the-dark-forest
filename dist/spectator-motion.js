import {CARDS,GALAXIES,COLORS} from './game.js';
import {cardFlight,cardInto,pause,reducedMotion} from './card-motion.js?v=20261025-observer-motion';
import {strikeFeedback} from './view-model.js?v=20261025-green-loss-mark';

// Never coalesce successive snapshots: response + automatic settlement can arrive together,
// and fast human actions must remain visible in the same server order as AI actions.
export class OrderedStatePlayback {
  constructor({render,play,onError=console.error}){this.render=render;this.play=play;this.onError=onError;this.pending=[];this.epoch=0;this.latestRevision=-1;}
  reset(view){this.stop();this.current=view;this.latestRevision=view.revision;this.sequence=view.game?.motionBatches?.at(-1)?.sequence||0;this.render(view);}
  stop(){this.epoch++;this.controller?.abort();this.pending=[];this.running=false;this.latestRevision=-1;}
  enqueue(view){
    if(!this.current||this.current.id!==view.id)return this.reset(view);
    if(view.revision<=this.latestRevision)return;
    this.latestRevision=view.revision;this.pending.push(view);void this.drain();
  }
  async drain(){
    if(this.running)return;this.running=true;const epoch=this.epoch;this.controller=new AbortController();
    let failedView=null;
    try{while(this.pending.length&&epoch===this.epoch){
      const next=this.pending.shift(),previous=this.current;
      failedView=next;
      if(previous.game&&next.game&&JSON.stringify(previous.game)!==JSON.stringify(next.game))await this.play(previous,next,this.controller.signal,this.sequence);
      if(epoch!==this.epoch)break;
      this.sequence=next.game?.motionBatches?.at(-1)?.sequence||0;
      if(JSON.stringify(previous.game)!==JSON.stringify(next.game)||!next.game)this.render(next);
      this.current=next;
    }}catch(error){if(epoch===this.epoch){this.onError(error);const latest=this.pending.pop()||failedView;this.pending=[];if(latest){this.current=latest;this.sequence=latest.game?.motionBatches?.at(-1)?.sequence||0;this.render(latest);}}}
    finally{if(epoch===this.epoch){this.running=false;if(this.pending.length)void this.drain();}}
  }
}
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rect=element=>{const r=element?.getBoundingClientRect();return r&&r.width&&r.height&&r.bottom>0&&r.top<innerHeight?r:null;};
const galaxy=id=>GALAXIES.find(g=>g.id===id)?.name||`星系 ${id}`;
const definition=card=>CARDS[card?.key]||card||{};

export function createSpectatorPlayback({render,renderPlayer,onError}){
  let tray=null,root=null,signal=null,display=null;
  const queue=new OrderedStatePlayback({render,play,onError});
  const player=id=>root?.querySelector(`[data-observer-player="${id}"]`);
  const hand=id=>root?.querySelector(`[data-observer-hand="${id}"]`);
  const named=id=>display?.game?.players.find(p=>p.id===id)?.name||'文明';
  const sourceElement=(card)=>card?.id?root?.querySelector(`[data-observer-card="${card.id}"], [data-observer-strike="${card.id}"], [data-observer-assets~="${card.id}"]`):null;
  const source=(card,id)=>rect(sourceElement(card))||rect(player(id))||rect(tray?.querySelector('.observer-play-actor'));
  const label=(text,id)=>{if(!tray)return;tray.querySelector('.observer-play-status').textContent=text;const actor=tray.querySelector('.observer-play-actor');actor.textContent=Number.isInteger(id)?named(id):'星海观测';actor.style.setProperty('--observer-color',display?.game?.players.findIndex(p=>p.id===id)>=0?['#78b8f2','#e49a75','#91c995','#b6a0ef','#e3c66e','#e88dac'][display.game.players.findIndex(p=>p.id===id)]:'#a9bd93');player(id)?.animate([{boxShadow:'0 0 0 2px var(--observer-color)'},{boxShadow:'0 0 18px var(--observer-color)'},{boxShadow:'none'}],{duration:1000});};
  function cardElement(card,id,role,back=false,target){
    const d=definition(card),el=document.createElement('article');el.className=`played-mini ${back?'compact-back':'compact-public'} observer-play-card${back?' is-back':''}`;el.dataset.playCard=card.id||`${id}-${role}`;el.style.setProperty('--card-color',d.color||COLORS[d.type]||'#a9bd93');
    if(d.type==='broadcast')el.dataset.broadcastRole=role==='发布'?'publish':['回应','采纳回应','已采纳回应'].includes(role)?'response':'unused';
    const metric=d.escape?'逃生':d.type==='strike'?`等级 ${d.level===Infinity?'∞':d.level??'—'}`:d.type==='broadcast'?`距离 ${d.range===Infinity?'∞':d.range}`:d.income?`产能 +${d.income}`:d.defense?`防御 ${d.defense}`:'设施';
    const targetLabel=target?`${d.type==='broadcast'?'广播':'目标'}星系 ${String(target).padStart(2,'0')} · ${escape(galaxy(target))}`:'';
    el.innerHTML=back?`<span class="mini-owner"><b>${escape(named(id))}</b><em>${escape(role||'回应')}</em></span><span class="mini-back-mark">◉</span><strong>广播牌 · 待揭示</strong>${targetLabel?`<span class="mini-target">${targetLabel}</span>`:''}`:`<span class="mini-owner"><b>${escape(named(id))}</b><em>${escape(role||'')}</em></span><span class="mini-name"><strong>${escape(d.name||'卡牌')}</strong>${d.type==='broadcast'&&d.face?`<b>${escape(d.face)}</b>`:''}</span><small>◇ ${d.cost??0} · ${metric}</small>${targetLabel?`<span class="mini-target">${targetLabel}</span>`:''}`;
    return el;
  }
  function clearCards(immediate=false){
    const host=tray?.querySelector('.observer-play-cards');if(!host)return;
    for(const el of [...host.children]){
      if(immediate||reducedMotion()){el.remove();continue;}
      const bounds=el.getBoundingClientRect(),ghost=el.cloneNode(true);
      Object.assign(ghost.style,{position:'fixed',left:`${bounds.left}px`,top:`${bounds.top}px`,width:`${bounds.width}px`,height:`${bounds.height}px`,margin:'0',flex:'none',transform:'none',pointerEvents:'none',zIndex:'122'});
      el.remove();makeLayer().append(ghost);
      const animation=ghost.animate([{opacity:1,filter:'blur(0)',transform:'translateY(0) scale(1)'},{opacity:0,filter:'blur(5px)',transform:'translateY(-4px) scale(.96)'}],{duration:180,easing:'ease-in',fill:'forwards'});
      animation.finished.catch(()=>{}).finally(()=>ghost.remove());
    }
    host.scrollLeft=0;
  }
  function rotatePhase(element,from,to,duration,abort){
    return new Promise(resolve=>{
      if(abort?.aborted){resolve(false);return;}
      let settled=false;
      const animation=element.animate([{transform:from},{transform:to}],{duration,easing:'cubic-bezier(.42,0,.58,1)',fill:'forwards'});
      const timer=setTimeout(()=>finish(true),duration+240);
      const onAbort=()=>finish(false);
      function finish(completed){
        if(settled)return;settled=true;clearTimeout(timer);abort?.removeEventListener('abort',onAbort);
        const success=completed&&!abort?.aborted;
        if(success)element.style.transform=to;
        animation.cancel();resolve(success);
      }
      animation.onfinish=()=>finish(true);animation.oncancel=()=>finish(false);
      abort?.addEventListener('abort',onAbort,{once:true});
    });
  }
  function replaceCardFace(old,front){
    old.className=front.className;old.style.cssText=front.style.cssText;old.dataset.playCard=front.dataset.playCard;old.dataset.broadcastRole=front.dataset.broadcastRole||'';old.innerHTML=front.innerHTML;
  }
  async function flipBroadcastCard(old,front,abort){
    if(reducedMotion()){replaceCardFace(old,front);return;}
    const perspective='perspective(720px) rotateY(';
    old.style.transformStyle='preserve-3d';old.style.transformOrigin='center';old.style.backfaceVisibility='hidden';old.style.webkitBackfaceVisibility='hidden';
    try{
      if(!await rotatePhase(old,`${perspective}0deg)`,`${perspective}90deg)`,210,abort))return;
      replaceCardFace(old,front);
      old.style.transformStyle='preserve-3d';old.style.transformOrigin='center';old.style.backfaceVisibility='hidden';old.style.webkitBackfaceVisibility='hidden';old.style.transform=`${perspective}-90deg)`;
      await rotatePhase(old,`${perspective}-90deg)`,`${perspective}0deg)`,260,abort);
    }finally{
      old.style.transform='';old.style.transformStyle='';old.style.transformOrigin='';old.style.backfaceVisibility='';old.style.webkitBackfaceVisibility='';
    }
  }
  function seatPreview(card,id,next){
    const seat=player(id),p=next.game.players.find(x=>x.id===id);
    if(!seat||!p)return null;
    const strikesFor=playerId=>next.game.strikes.filter(s=>s.owner===playerId);
    const markup=renderPlayer?.(p,next.game,strikesFor);
    if(!markup)return null;
    const template=document.createElement('template');template.innerHTML=markup.trim();const preview=template.content.firstElementChild;if(!preview)return null;
    const s=seat.getBoundingClientRect();
    Object.assign(preview.style,{position:'fixed',left:`${s.left}px`,top:`${s.top}px`,width:`${s.width}px`,height:`${s.height}px`,minHeight:0,margin:'0',zIndex:'80',pointerEvents:'none',visibility:'visible',animation:'none'});
    preview.classList.add('observer-flight-preview');
    preview.id='observer-flight-preview';
    document.body.append(preview);
    const target=[...preview.querySelectorAll('[data-observer-assets],[data-observer-strike]')].find(node=>(node.dataset.observerAssets||node.dataset.observerStrike||'').split(/\s+/).includes(String(card.id)));
    if(target)target.style.visibility='visible';
    return {preview,target:target||preview};
  }
  async function sendToSeat(card,id,kind,next,abort){
    const origin=sourceElement(card),from=rect(origin)||source(card,id),preview=seatPreview(card,id,next),to=preview?.target?.getBoundingClientRect()||player(id)?.getBoundingClientRect();
    if(origin)origin.style.visibility='hidden';
    try{
      const arriving=cardElement(card,id,kind==='build'?'建设':'发射');
      if(preview?.target)await cardInto(arriving,from,preview.target,{signal:abort,cardSize:{width:102,height:86}});
      else await cardFlight(arriving,from,to,{signal:abort,cardSize:{width:102,height:86}});
    }
    finally{preview?.preview.remove();}
  }
  function syncLatest(view){
    const latest=view.game.latest,host=tray?.querySelector('.observer-play-cards');if(!host||!latest)return;
    clearCards(true);host.scrollLeft=0;
    for(const c of latest.cards||[]){const el=cardElement(c,c.actor,c.role,!latest.revealed,latest.target);host.append(el);if(!reducedMotion())el.animate([{opacity:0,filter:'blur(4px)',transform:'translateY(4px) scale(.96)'},{opacity:1,filter:'blur(0)',transform:'translateY(0) scale(1)'}],{duration:260,easing:'cubic-bezier(.2,.72,.25,1)'});}
    tray.dataset.latestId=String(latest.cards?.[0]?.id||'');
    const first=latest.cards?.[0];if(first)label(`${named(first.actor)} · ${first.role||'出牌'}${latest.target?' → '+galaxy(latest.target):''}`,first.actor);
  }
  async function showCard(card,id,role,{back=false,append=false,target,from}={}){
    if(!tray||signal?.aborted)return null;
    const runSignal=signal;
    const origin=sourceElement(card),start=from||rect(origin)||source(card,id);
    const host=tray.querySelector('.observer-play-cards');if(!append){clearCards();host.scrollLeft=0;}const el=cardElement(card,id,role,back,target);host.append(el);
    label(`${named(id)} ${role} ${back?'广播牌':definition(card).name||'卡牌'}${target?' → '+galaxy(target):''}`,id);
    if(back&&target){const system=root.querySelector(`[data-observer-galaxy="${target}"]`);system?.classList.add('broadcast-target');if(system&&!system.querySelector('.broadcast-ring')){const ring=document.createElementNS('http://www.w3.org/2000/svg','circle');ring.setAttribute('class','broadcast-ring');ring.setAttribute('r','48');system.prepend(ring);}}
    if(origin)origin.style.visibility='hidden';
    const copy=el.cloneNode(true);await cardInto(copy,start,el,{signal:runSignal,cardSize:{width:102,height:86}});
    if(runSignal?.aborted)return null;
    return el;
  }
  function makeLayer(){let layer=document.querySelector('#observer-fx-layer');if(!layer){layer=document.createElement('div');layer.id='observer-fx-layer';layer.setAttribute('aria-hidden','true');document.body.append(layer);}return layer;}
  function transient(element,ms,onRemove){makeLayer().append(element);const abort=signal;let removed=false;const remove=()=>{if(removed)return;removed=true;element.remove();onRemove?.();abort?.removeEventListener('abort',remove);};setTimeout(remove,ms);abort?.addEventListener('abort',remove,{once:true});}
  function positionFx(el,target){const r=target?.getBoundingClientRect();if(r)Object.assign(el.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});}
  function feedback(id,kind){
    const el=document.createElement('div');el.className='observer-result-fx';el.dataset.observerFxPlayer=id;positionFx(el,player(id));
    if(kind==='eliminated'||kind==='survived')el.innerHTML=`<svg class="observer-cross ${kind}" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M1 1 99 99M99 1 1 99"/></svg>`;
    else el.innerHTML=`<span class="player-feedback ${kind==='locked'?'feedback-lock':'feedback-escape'}">${kind==='locked'?'<svg viewBox="0 0 48 48"><path d="M15 21v-6a9 9 0 0 1 18 0v6M11 21h26v21H11zM24 29v6"/><circle cx="24" cy="28" r="1"/></svg>':'<svg viewBox="0 0 130 82"><path d="m15 54 39-16 31-21 29 24-31 25-29-17-39 5Zm39-16 29 28m2-49-2 49m-68-12 28 14m-9-29L7 35M9 62l22-3"/><circle cx="86" cy="40" r="7"/></svg>'}</span>`;
    transient(el,kind==='locked'?1800:2400);
  }
  function energy(change){
    const delta=change.after-change.before;if(!delta)return;
    const el=document.createElement('span');el.className='energy-delta '+(delta>0?'gain':'loss');el.textContent=(delta>0?'+':'')+delta;
    let frame=0;
    const followEnergy=()=>{
      if(!el.isConnected)return;
      const target=player(change.player)?.querySelector('.energy-number'),r=target?.getBoundingClientRect();
      if(r?.width&&r.height){el.style.left=r.left+r.width/2+'px';el.style.top=r.top-5+'px';}
      frame=requestAnimationFrame(followEnergy);
    };
    const target=player(change.player)?.querySelector('.energy-number');if(target)target.textContent=change.after;
    transient(el,4100,()=>cancelAnimationFrame(frame));frame=requestAnimationFrame(followEnergy);
  }
  async function moveTo(card,from,to,actor=card.actor){if(!to||signal?.aborted)return;const el=cardElement(card,actor,'',false);await cardFlight(el,from,to,{signal,cardSize:{width:102,height:86}});}
  async function play(previous,next,abort,lastSequence){
    signal=abort;display=next;
    const batches=(next.game.motionBatches||[]).filter(b=>b.sequence>lastSequence).sort((a,b)=>a.sequence-b.sequence);
    let refreshLatest=false;
    for(const batch of batches){
      const losses=[];let arriving=null;
      for(let eventIndex=0;eventIndex<batch.events.length;eventIndex++){
        const e=batch.events[eventIndex];
        if(abort.aborted)return;
        if(['build','broadcast','response','launch','lock'].includes(e.type)){
          const role={build:'建设',broadcast:'发布',response:'回应',launch:'发射',lock:'使用'}[e.type];
          if(e.type==='build'||e.type==='launch'){
            clearCards();label(`${named(e.player)} ${role} · ${definition(e.card).name||'卡牌'}`,e.player);
            await sendToSeat(e.card,e.player,e.type==='build'?'build':'strike',next,abort);refreshLatest=true;
          }else{await showCard(e.card,e.player,role,{back:['broadcast','response'].includes(e.type),append:e.type==='response',target:e.target});refreshLatest=false;}
          if(abort.aborted)return;
          if(e.type==='lock'&&Number.isInteger(e.victim)){await Promise.all((e.removedCards||[]).map(c=>moveTo(c,source(c,e.victim),rect(tray.querySelector('.observer-deck-anchor')),e.victim)));if(abort.aborted)return;feedback(e.victim,'locked');label(`${named(e.player)} 的科技锁死生效 · ${named(e.victim)} 建设被拆除`,e.player);}
        }else if(e.type==='discard'){
          refreshLatest=false;clearCards();await Promise.all(e.cards.map((c,i)=>pause(i*75,signal).then(()=>showCard(c,e.player,'弃置',{append:true}))));await pause(reducedMotion()?0:250,signal);
        }else if(e.type==='draw'){
          label(`${named(e.player)} 补牌`,e.player);const target=rect(hand(e.player))||rect(player(e.player))||rect(tray);
          const draws=[e];while(batch.events[eventIndex+1]?.type==='draw')draws.push(batch.events[++eventIndex]);
          await Promise.all(draws.map((draw,i)=>cardFlight(cardElement(draw.card,draw.player,'摸牌',true),rect(tray.querySelector('.observer-deck-anchor')),rect(hand(draw.player))||rect(player(draw.player))||target,{signal,delay:i*95,cardSize:{width:110,height:80}})));
        }else if(e.type==='broadcast_resolved'){
          refreshLatest=false;
          const host=tray.querySelector('.observer-play-cards'),existing=[...host.children],matched=new Set();
          await Promise.all(e.cards.map(async c=>{
            const old=existing.find(el=>el.dataset.playCard===String(c.id)&&!matched.has(el));
            const front=cardElement(c,c.actor,c.role,false,e.target);
            if(!old){host.append(front);if(!reducedMotion())front.animate([{opacity:0,filter:'blur(3px)',transform:'scale(.96)'},{opacity:1,filter:'blur(0)',transform:'scale(1)'}],{duration:260,easing:'ease-out'});return;}
            matched.add(old);
            await flipBroadcastCard(old,front,abort);
          }));
          existing.filter(el=>!matched.has(el)&&!e.cards.some(c=>el.dataset.playCard===String(c.id))).forEach(el=>el.remove());
          label(`广播结算 · ${galaxy(e.target)} · ${named(e.caster)}${e.selected!==undefined?' ↔ '+named(e.selected):' · 无回应'}`,e.caster);await pause(reducedMotion()?0:1000,signal);
        }else if(e.type==='strike_arriving'){
          refreshLatest=false;
          losses.length=0;arriving=e;
          label(`${named(e.owner)} 的 ${definition(e.card).name} 抵达 ${galaxy(e.target)}`,e.owner);
          const target=root.querySelector(`[data-observer-galaxy="${e.target}"]`);
          if(['photon','annihilation','dimension'].includes(e.card.key)){target?.classList.remove('marker-red','marker-gray');target?.classList.add(e.card.key==='dimension'?'marker-gray':'marker-red');}
          target?.animate([{filter:'brightness(2.5)',opacity:.4},{filter:'brightness(1)',opacity:1}],{duration:800});
        }else if(['star_discard','builds_destroyed'].includes(e.type)){
          losses.push(...e.cards.map(c=>({...c,actor:e.player,role:e.type==='star_discard'?'恒星熄灭弃置':'打击摧毁'})));
          label(`${named(e.player)} 的${e.type==='star_discard'?'恒星依赖建设':'建设'}被摧毁`,e.player);
          await Promise.all(e.cards.map(c=>moveTo(c,source(c,e.player),rect(tray.querySelector('.observer-deck-anchor')),e.player)));
        }else if(e.type==='eliminated'){
          player(e.player)?.classList.add('eliminated');feedback(e.player,'eliminated');label(`${named(e.player)} · 文明消逝`,e.player);await pause(reducedMotion()?0:850,signal);
        }else if(e.type==='defended'){
          const survived=strikeFeedback('survived',e.player,losses);if(survived)feedback(e.player,survived);label(`${named(e.player)} 防御成功${survived?' · 建设受损':''}`,e.player);await pause(reducedMotion()?0:750,signal);
        }else if(e.type==='escaped'){
          feedback(e.player,'escaped');label(`${named(e.player)} 使用光速飞船 · ${galaxy(e.from)} → ${galaxy(next.game.players[e.player].galaxy)}`,e.player);await pause(reducedMotion()?0:850,signal);
        }else if(e.type==='escape_pending'){
          label(`${named(e.player)} 遭遇致命打击 · 等待逃生决定`,e.player);
        }else if(e.type==='system_hit'||e.type==='miss'){
          label(`${galaxy(e.target)} · ${e.type==='miss'?'没有文明受击':arriving?.card.key==='dimension'?'星系已被降维':'恒星已熄灭'}`,arriving?.owner);
        }else if(e.type==='production'){
          label(`${named(e.player)} 回合开始 · 产能 +${e.gain}`,e.player);
        }else if(e.type==='gameover'){
          label(e.winner===null?'对局结束 · 无文明幸存':`对局结束 · ${named(e.winner)} 获胜`,e.winner);
        }
      }
      if(abort.aborted)return;
      for(const change of batch.energyChanges||[])energy(change);
      if(batch.energyChanges?.length)tray.querySelector('.observer-play-status').textContent+=' · '+batch.energyChanges.map(c=>`${named(c.player)} ${c.after-c.before>0?'+':''}${c.after-c.before}`).join(' / ');
    }
    if(refreshLatest)syncLatest(next);
  }
  function mount(container,view){
    root=container;display=view;if(!view.game)return;
    if(!tray){tray=document.createElement('section');tray.id='observer-playback';tray.className='observer-playback';tray.setAttribute('aria-label','实时出牌与结算动画');tray.innerHTML='<div class="observer-play-heading latest-heading"><span class="eyebrow">LATEST TRANSMISSION</span><b class="observer-play-actor">星海观测</b><span class="observer-play-status" role="status" aria-live="polite">等待文明行动</span><span class="observer-deck-anchor">▱ 抽牌 / 弃牌</span></div><div class="observer-play-cards latest-content"></div>';
      const current=view.game.pending?.kind==='broadcast'?{cards:[{...view.game.pending.card,actor:view.game.pending.caster,role:'发布'},...view.game.pending.responses.map(r=>({...r.card,actor:r.actor,role:'回应'}))],revealed:false}:view.game.latest;
      for(const c of current?.cards||[])tray.querySelector('.observer-play-cards').append(cardElement(c,c.actor,c.role,!current.revealed,current.target));
      if(current?.cards?.length)tray.dataset.latestId=String(current.cards[0].id||'');
      const first=current?.cards?.[0];if(first)label(`${named(first.actor)} · ${first.role||'出牌'}${current.target?' → '+galaxy(current.target):''}`,first.actor);
    }
    container.querySelector('.observer-playback-anchor')?.replaceWith(tray);
    if(view.game.latest&&(view.game.latest.kind==='build'||view.game.latest.kind==='strike'&&view.game.latest.cards.some(c=>c.role==='发射'))&&queue.sequence===view.game.motionBatches?.at(-1)?.sequence&&tray.dataset.latestId!==String(view.game.latest.cards?.[0]?.id||'')){
      tray.dataset.latestId=String(view.game.latest.cards?.[0]?.id||'');syncLatest(view);
    }
    document.querySelectorAll('[data-observer-fx-player]').forEach(el=>positionFx(el,player(Number(el.dataset.observerFxPlayer))));
  }
  function stop(){queue.stop();tray=null;document.querySelector('#observer-fx-layer')?.remove();document.querySelectorAll('#flight-layer .observer-play-card').forEach(el=>el.remove());}
  return {mount,enqueue:view=>queue.enqueue(view),reset(view){stop();display=view;queue.reset(view);},stop,get busy(){return queue.running||queue.pending.length>0;}};
}
