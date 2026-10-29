import {CARDS,GALAXIES,distance} from '../dist/game.js';

const pick=(items,rng)=>items[Math.floor(rng()*items.length)];
const defense=p=>Math.max(0,...p.builds.map(c=>CARDS[c.key].defense||0));
function evidence(view,me,history,level) {
  const own=view.players[me],recent=history.slice(level==='hard'?-160:-24),result=new Map();
  for(const p of view.players.filter(p=>p.alive&&p.id!==me)) {
    let possible=GALAXIES.filter(g=>g.id!==own.galaxy&&view.markers[g.id]!=='gray').map(g=>g.id);
    if(level!=='easy')for(const e of recent.filter(e=>e.actor===p.id)) {
      if(e.type==='escaped')possible=GALAXIES.filter(g=>g.id!==own.galaxy&&view.markers[g.id]!=='gray').map(g=>g.id);
      if(e.type==='broadcast') {
        const constrained=possible.filter(g=>distance(g,e.target)<=CARDS[e.key].range);
        if(constrained.length)possible=constrained;
      }
    }
    result.set(p.id,possible);
  }
  return result;
}
export function decideAI(view,me,level='normal',history=[],rng=Math.random) {
  const p=view.players[me],b=view.pending,hard=level==='hard',easy=level==='easy',known=evidence(view,me,history,level);
  if(view.over||!p?.alive)return null;
  if(b?.kind==='escape')return b.victim===me?{type:'escape',use:easy?rng()>.25:true}:null;
  const cooperative=id=>{
    const faces=history.filter(e=>e.type==='broadcast'&&e.actor===id).slice(hard?-12:-3);
    return (faces.filter(e=>CARDS[e.key].face==='合作').length+1)/(faces.length+2);
  };
  if(b?.kind==='broadcast') {
    if(me!==b.caster&&!b.decisions.includes(me)) {
      const options=p.hand.filter(c=>CARDS[c.key].type==='broadcast'&&p.energy>=CARDS[c.key].cost&&distance(p.galaxy,b.target)<=CARDS[c.key].range);
      const forced=p.galaxy===b.target&&!p.builds.some(c=>c.key==='listener');
      if(!options.length||(!forced&&(easy?rng()<.35:cooperative(b.caster)<.3&&rng()<.35)))return {type:'respond'};
      const scored=options.map(c=>({c,score:(CARDS[c.key].face==='合作'?3*cooperative(b.caster):5*cooperative(b.caster))-CARDS[c.key].cost+(easy?rng()*5:0)}));
      scored.sort((a,b)=>b.score-a.score);
      return {type:'respond',cardId:scored[0].c.id};
    }
    if(me===b.caster&&view.players.every(q=>!q.alive||q.id===me||b.decisions.includes(q.id))) {
      const choices=b.responses.map(r=>r.actor);
      if(!choices.length)return {type:'settle',chosen:null};
      choices.sort((a,b)=>cooperative(b)-cooperative(a));
      return {type:'settle',chosen:easy?pick(choices,rng):choices[0]};
    }
    return null;
  }
  if(view.active!==me)return null;
  const targets=GALAXIES.filter(g=>g.id!==p.galaxy&&view.markers[g.id]!=='gray'),ownDefense=defense(p);
  const incoming=view.strikes.filter(s=>s.target===p.galaxy),threat=Math.max(0,...incoming.map(s=>CARDS[s.card.key].level));
  const positionChance=(id,g)=>{const candidates=known.get(id)||[];return candidates.includes(g)?1/candidates.length:0;};
  const legal=p.hand.filter(c=>{const d=CARDS[c.key];return d.cost<=p.energy&&!d.escape&&!(d.star&&view.markers[p.galaxy])&&!(c.key==='dyson'&&p.builds.some(x=>x.key==='dyson'));});
  const moves=[];
  for(const c of legal) {
    const d=CARDS[c.key];
    if(d.type==='build') {
      let score=d.income?8+d.income*3-d.cost*.6:d.defense?3+(d.defense>ownDefense?4:0):p.builds.some(x=>x.key===c.key)?-2:3;
      if(d.defense&&d.defense<=ownDefense)score=-2;
      if(!easy&&threat>ownDefense&&d.defense>=threat)score+=35;
      if(hard&&d.income&&view.round>18)score-=5;
      if(hard&&p.hand.some(x=>x.key==='lightship')&&incoming.length&&p.energy-d.cost<10&&d.defense<threat)score-=20;
      moves.push({score:easy?rng()*12:score,action:{type:'play',cardId:c.id}});
    } else if(d.type==='broadcast') {
      const possible=GALAXIES.filter(g=>g.id!==p.galaxy&&distance(p.galaxy,g.id)<=d.range);
      if(!possible.length)continue;
      const best=possible.map(g=>({g,score:[...known.keys()].reduce((sum,id)=>sum+positionChance(id,g.id),0)})).sort((a,b)=>b.score-a.score);
      const target=easy?pick(possible,rng).id:best[0].g.id;
      moves.push({score:easy?rng()*12:5-d.cost+(d.face==='伪装'?1:0)+(hard?best[0].score*2:0),action:{type:'play',cardId:c.id,target}});
    } else if(targets.length) {
      const attempts=history.filter(e=>e.type==='launch'&&e.actor===me).slice(-8);
      const ratings=targets.map(g=>({g,score:[...known.keys()].reduce((sum,id)=>{
        const other=view.players[id],chance=positionChance(id,g.id);
        const value=d.instant?other.builds.reduce((n,c)=>n+CARDS[c.key].cost,0)/4:defense(other)<d.level?16:0;
        return sum+chance*(value+(d.level>=2?2:0));
      },0)-attempts.filter(e=>e.target===g.id).length*(hard?2:3)+rng()*.15})).sort((a,b)=>b.score-a.score);
      const target=easy?pick(targets,rng).id:ratings[0].g.id;
      let score=easy?rng()*12:ratings[0].score-d.cost*.2+(view.round>12?2:0);
      if(view.strikes.some(s=>s.owner===me&&s.target===target))score-=hard?7:2;
      if(hard&&p.energy-d.cost<10&&incoming.length&&p.hand.some(c=>c.key==='lightship'))score-=15;
      moves.push({score,action:{type:'play',cardId:c.id,target}});
    }
  }
  moves.sort((a,b)=>b.score-a.score);
  // In prolonged games, use affordable strikes even when uncertainty depresses
  // their score; avoid repeatedly targeting a strike already in flight.
  if(hard&&view.round>=30&&!incoming.length){
    const attack=moves.find(m=>{const card=CARDS[p.hand.find(c=>c.id===m.action.cardId)?.key];return m.action.target!==undefined&&card?.type==='strike'&&!card.instant&&!view.strikes.some(s=>s.owner===me&&s.target===m.action.target);});
    if(attack)return attack.action;
  }
  if(moves.length&&(easy?(!view.played||rng()>.35):moves[0].score>1))return moves[0].action;
  if(!view.played&&p.hand.length) {
    const discard=p.hand.filter(c=>{
      const d=CARDS[c.key];
      if(d.escape)return easy||p.escapeUsed;
      return easy?rng()<.55:d.cost>p.energy+3||d.defense&&d.defense<=ownDefense||d.star&&view.markers[p.galaxy]||d.type==='broadcast'&&d.face==='合作'&&hard;
    });
    if(discard.length)return {type:'discard',ids:discard.map(c=>c.id)};
    if(!moves.length)return {type:'discard',ids:[p.hand.reduce((a,b)=>CARDS[a.key].cost>CARDS[b.key].cost?a:b).id]};
  }
  return {type:'end'};
}
