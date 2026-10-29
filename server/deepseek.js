import {CARDS,GALAXIES,distance} from '../shared/game.js';
import {gameView,deepSeekRulebook} from './room-core.js';

const cardInfo=key=>{const c=CARDS[key];return c?{name:c.name,type:c.type,cost:c.cost,range:c.range===Infinity?'无限':c.range,level:c.level===Infinity?'无限':c.level,face:c.face,income:c.income,defense:c.defense,star:c.star,escape:c.escape,instant:c.instant}:null;};

function candidateActions(game,me) {
  const p=game.players[me],pending=game.pending;
  if(!p?.alive||game.over)return [];
  if(pending?.kind==='escape')return pending.victim===me?[{type:'escape',use:true},{type:'escape',use:false}]:[];
  if(pending?.kind==='broadcast'){
    if(me===pending.caster){
      if(game.players.some(q=>q.alive&&q.id!==me&&!pending.decisions.includes(q.id)))return [];
      return pending.responses.length?pending.responses.map(r=>({type:'settle',chosen:r.actor})):[{type:'settle',chosen:null}];
    }
    if(pending.decisions.includes(me))return [];
    const options=game.responseOptions(me).map(c=>({type:'respond',cardId:c.id}));
    if(!game.isForced(me))options.push({type:'respond'});
    return options;
  }
  if(game.active!==me)return [];
  const actions=[];
  for(const card of p.hand){
    const d=CARDS[card.key];
    if(!d||p.energy<d.cost||d.escape||d.star&&game.markers[p.galaxy]||card.key==='dyson'&&p.builds.some(c=>c.key==='dyson'))continue;
    if(d.type==='build')actions.push({type:'play',cardId:card.id});
    else for(const g of GALAXIES){
      if(d.type==='broadcast'&&distance(p.galaxy,g.id)<=d.range)actions.push({type:'play',cardId:card.id,target:g.id});
      else if(d.type==='strike'&&g.id!==p.galaxy&&game.markers[g.id]!=='gray')actions.push({type:'play',cardId:card.id,target:g.id});
    }
  }
  if(!game.played)for(let mask=1;mask<(1<<p.hand.length);mask++){
    const ids=p.hand.filter((_,i)=>mask&(1<<i)).map(c=>c.id);
    actions.push({type:'discard',ids});
  }
  for(const s of game.strikes)if(s.owner===me)actions.push({type:'withdraw',strikeId:s.id});
  actions.push({type:'end'});
  // Keep list position from implying a preference for any particular action.
  for(let i=actions.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[actions[i],actions[j]]=[actions[j],actions[i]];}
  return actions;
}

function publicState(view,me) {
  return {
    round:view.round,active:view.active,played:view.played,markers:view.markers,ownBroadcastKey:view.ownBroadcastKey,
    players:view.players.map(p=>({id:p.id,name:p.name,alive:p.alive,energy:p.energy,escapeUsed:p.escapeUsed,builds:p.builds.map(c=>cardInfo(c.key)),handCount:p.handCount,
      ...(p.id===me?{galaxy:p.galaxy,hand:p.hand.map(c=>({id:c.id,...cardInfo(c.key)}))}:{})})),
    strikes:view.strikes.map(s=>({owner:s.owner,target:s.target,progress:s.progress,...(s.required===undefined?{}:{required:s.required}),card:cardInfo(s.card.key)})),
    latest:view.latest?{kind:view.latest.kind,target:view.latest.target,revealed:view.latest.revealed,outcome:view.latest.outcome,victimId:view.latest.victimId,cards:view.latest.cards.map(c=>({actor:c.actor,role:c.role,...(c.key?cardInfo(c.key):{})}))}:null,
    pending:view.pending?.kind==='broadcast'?{kind:'broadcast',caster:view.pending.caster,target:view.pending.target,decisions:view.pending.decisions,responses:view.pending.responses.map(r=>({actor:r.actor}))}:
      view.pending?{kind:view.pending.kind,victim:view.pending.victim,strikeId:view.pending.strikeId}:null
  };
}

/** Ask DeepSeek to choose one server-generated legal action. Returns null on any API/format failure. */
function cleanLegacySession(session) {
  if(!session?.messages)return;
  const messages=session.messages;
  if(messages[0]?.role==='system'){
    const marker=messages[0].content.indexOf('\n\n决策纪律：');
    if(marker>=0)messages[0].content=messages[0].content.slice(0,marker);
  }
  for(let i=messages.length-1;i>=0;i--){
    if(messages[i]?.role==='user'&&messages[i].content.includes('本次候选及局势补充如下：')){
      messages.splice(i,1);
      if(messages[i]?.role==='assistant')messages.splice(i,1);
    }
  }
}

/** Ask DeepSeek to choose one server-generated legal action. Returns null on any API/format failure. */
export async function decideDeepSeek(game,me,history,apiKey,fetchImpl=fetch,session=null,onDecision=null,onAudit=null) {
  if(!apiKey)return null;
  cleanLegacySession(session);
  const actions=candidateActions(game,me);
  if(!actions.length)return null;
  if(actions.length===1){onDecision?.({actionType:actions[0].type,source:'forced',choice:null,candidates:1});await onAudit?.({source:'forced',request:null,response:null,action:actions[0]});return actions[0];}
  const view=gameView(game,me);
  // The bot knows the face it played; no other pending card face is exposed.
  if(game.pending?.kind==='broadcast')view.ownBroadcastKey=game.pending.caster===me?game.pending.card.key:game.pending.responses.find(r=>r.actor===me)?.card.key;
  const legalActions=actions.map((action,choice)=>({choice,action,
    ...(action.target!==undefined?{targetGalaxy:GALAXIES.find(g=>g.id===action.target)?.name||'未知星系'}:{}),
    ...(action.cardId?{card:cardInfo(pCardKey(game,me,action.cardId))}:{}),
    ...(action.ids?{cards:action.ids.map(id=>cardInfo(pCardKey(game,me,id)))}:{})}));
  const observations=history.slice(-24).map(e=>({type:e.type,actor:e.actor,target:e.target,...(e.key?{card:cardInfo(e.key)}:{})}));
  const decisionMessage={role:'user',content:'现在请决策。只输出 JSON：{"choice":候选编号}。当前局面：'+JSON.stringify({me,state:publicState(view,me),observations,legalActions})};
  const conversation=session?.messages||[
    {role:'system',content:deepSeekRulebook()},
    {role:'user',content:'当前局面：'+JSON.stringify(publicState(view,me))}
  ];
  const messages=session?.messages||conversation;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  const requestBody={model:'deepseek-flash',thinking:{type:'enabled'},reasoning_effort:'high',max_tokens:4096,response_format:{type:'json_object'},messages:[...messages,decisionMessage]};
  const audit={source:'model',request:structuredClone(requestBody),response:null,status:null,action:null,error:null,startedAt:Date.now()};
  try {
    await onAudit?.({...audit,stage:'request'});
    const response=await fetchImpl('https://api.deepseek.com/chat/completions',{
      method:'POST',headers:{'Authorization':'Bearer '+apiKey,'Content-Type':'application/json'},signal:controller.signal,
      body:JSON.stringify(requestBody)
    });
    audit.status=response.status;const raw=await response.text();audit.response=raw;
    if(!response.ok){audit.error='http-error';console.warn('DeepSeek API returned status',response.status);return null;}
    const data=JSON.parse(raw);audit.response=data;const content=data?.choices?.[0]?.message?.content;
    if(typeof content!=='string'){console.warn('DeepSeek API returned no message content');return null;}
    if(data?.choices?.[0]?.finish_reason==='length'){console.warn('DeepSeek API output was truncated');return null;}
    const result=JSON.parse(content),choice=result.choice;
    if(!Number.isInteger(choice)||choice<0||choice>=actions.length){console.warn('DeepSeek API returned an invalid action choice');return null;}
    const saved=JSON.stringify({choice});
    if(session?.messages)session.messages.push(decisionMessage,{role:'assistant',content:saved});
    onDecision?.({actionType:actions[choice].type,source:'model',choice,candidates:actions.length});
    audit.action=actions[choice];return actions[choice];
  } catch(error){audit.error=error?.message||'request-failed';console.warn('DeepSeek API request failed',error?.name||'unknown error');return null;} finally{clearTimeout(timer);audit.durationMs=Date.now()-audit.startedAt;await onAudit?.({...audit,stage:'response'});}
}

function pCardKey(game,me,id){return game.players[me].hand.find(c=>c.id===id)?.key;}

