import {CARDS, GALAXIES} from './game.js';

// Group physical buildings only for display; their cards remain in the engine.
export function summarizeBuildings(builds, {starActive=true}={}) {
  const independent={income:0,ids:[],names:[]};
  const stellar={income:0,ids:[],names:[],inactive:!starActive};
  const defenses=[];
  const other=new Map();
  for(const c of builds){
    const d=CARDS[c.key];
    if(d.income){const group=d.star?stellar:independent;group.income+=d.star&&!starActive?0:d.income;group.ids.push(c.id);group.names.push(d.name);}
    else if(d.defense)defenses.push({id:c.id,level:d.defense,name:d.name});
    else {const group=other.get(c.key)||{key:c.key,label:c.key==='listener'?'监听':d.name.replace(/基地|设施|引擎|星环/g,''),count:0,ids:[]};group.count++;group.ids.push(c.id);other.set(c.key,group);}
  }
  return {independent,stellar,defense:Math.max(0,...defenses.map(x=>x.level)),defenseIds:defenses.map(x=>x.id),defenseNames:defenses.map(x=>x.name),other:[...other.values()]};
}

export function strikeFeedback(outcome,victimId,cards=[]) {
  if(outcome==='locked'||outcome==='escaped')return outcome;
  if(outcome==='eliminated')return Number.isInteger(victimId)?'eliminated':null;
  if(outcome==='survived'&&Number.isInteger(victimId)&&cards.some(c=>c.actor===victimId&&(c.role==='恒星熄灭弃置'||c.role==='打击摧毁')))return 'survived';
  return null;
}

export function strikeNotice(latest,viewer){
  if(latest?.kind!=='strike')return null;
  const strike=latest.cards?.find(c=>c.role==='结算'||c.role==='已生效');
  if(!strike||strike.actor!==viewer)return null;
  return {text:`${CARDS[strike.key].name} · 目标已抵达`,cardKey:strike.key};
}

export function broadcastEffect(key){
  const d=CARDS[key];
  return d.face==='合作'?'双方合作：各 +3；对方伪装：你 +0、对方 +5。':'遇合作：你 +5、对方 +0；双方伪装：各 +0。';
}

// No hidden face or description is included in the unrevealed presentation.
export function broadcastPresentation(card,{revealed=false,target,actorName}={}){
  const d=CARDS[card.key];
  const common={id:card.id,actorName,role:card.role,target,targetName:GALAXIES.find(g=>g.id===target)?.name};
  if(!revealed)return {...common,name:'广播牌',revealed:false};
  return {...common,revealed:true,name:d.name,face:d.face,cost:d.cost,range:d.range===Infinity?'∞':String(d.range),detail:d.detail,effect:broadcastEffect(card.key)};
}
