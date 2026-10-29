import {CARDS,GALAXIES,distance} from '../shared/game.js';

const defense=p=>Math.max(0,...p.builds.map(c=>CARDS[c.key].defense||0));
const all=()=>GALAXIES.map(g=>g.id);
const rounded=n=>Math.round(n*1000)/1000;

// No authoritative game object enters this module. Every deduction must be
// reproducible from the bot's filtered view and observations already revealed.
export function inferPositions(view,me,history=[]) {
  const rivals=view.players.filter(p=>p.alive&&p.id!==me);
  const sets=new Map(rivals.map(p=>[p.id,new Set(all())]));
  const launches=new Map();
  const restrict=(id,test)=>{const spots=sets.get(id);if(spots)for(const g of spots)if(!test(g))spots.delete(g);};
  for(const e of history){
    if(e.type==='escaped'){
      if(sets.has(e.actor))sets.set(e.actor,new Set(all()));
      if(e.from)for(const id of sets.keys())restrict(id,g=>g!==e.from);
      for(const [key,launch] of launches)if(launch.actor===e.actor)launches.delete(key);
    } else if(e.type==='broadcast'&&CARDS[e.key])restrict(e.actor,g=>distance(g,e.target)<=CARDS[e.key].range);
    else if(e.type==='launch'){
      restrict(e.actor,g=>g!==e.target);
      if(e.strikeId)launches.set(e.strikeId,e);
    } else if(e.type==='impact'||e.type==='lock'){
      if(e.type==='impact'&&launches.has(e.strikeId)&&e.progress>0)
        restrict(e.actor,g=>distance(g,e.target)===e.progress);
      for(const id of sets.keys())restrict(id,g=>id===e.victim&&e.outcome!=='escaped'?g===e.target:g!==e.target);
    }
  }
  for(const s of view.strikes){
    // A ship can move after firing; flight progress constrains the original
    // launch site only while its launch has not been invalidated by an escape.
    if(launches.has(s.id)&&view.pending?.strikeId!==s.id)
      restrict(s.owner,g=>distance(g,s.target)>s.progress);
  }
  for(const p of rivals)restrict(p.id,g=>g!==view.players[me].galaxy&&view.markers[g]!=='gray'&&
    (!p.builds.some(c=>CARDS[c.key].star)||!view.markers[g]));
  let inconsistent=false;
  for(const p of rivals)if(!sets.get(p.id).size){
    inconsistent=true;sets.set(p.id,new Set(all().filter(g=>g!==view.players[me].galaxy&&view.markers[g]!=='gray')));
  }
  // Enumerate joint placements (at most 8P5): two civilizations cannot share a
  // system. Independent per-player guesses otherwise overvalue crowded targets.
  const ordered=[...rivals].sort((a,b)=>sets.get(a.id).size-sets.get(b.id).size);
  const counts=new Map(rivals.map(p=>[p.id,new Map()]));let total=0;
  const visit=(index,used,assignment)=>{
    if(index===ordered.length){total++;for(const [id,g] of assignment)counts.get(id).set(g,(counts.get(id).get(g)||0)+1);return;}
    const p=ordered[index];for(const g of sets.get(p.id))if(!used.has(g)){
      used.add(g);assignment.push([p.id,g]);visit(index+1,used,assignment);assignment.pop();used.delete(g);
    }
  };
  visit(0,new Set(),[]);
  if(!total)inconsistent=true;
  return {inconsistent,players:rivals.map(p=>({id:p.id,locations:[...sets.get(p.id)].map(g=>({galaxy:g,
    probability:total?(counts.get(p.id).get(g)||0)/total:1/sets.get(p.id).size})).filter(x=>x.probability>0)}))};
}

export function analyzeTactics(view,me,history=[]) {
  const own=view.players[me],beliefs=inferPositions(view,me,history),ownDefense=defense(own);
  const incoming=view.strikes.filter(s=>s.target===own.galaxy);
  const fatal=incoming.filter(s=>CARDS[s.card.key].level>ownDefense);
  const escapeReady=!own.escapeUsed&&own.hand.some(c=>c.key==='lightship')&&own.energy>=10&&
    GALAXIES.filter(g=>g.id!==own.galaxy&&view.markers[g.id]!=='gray').length>beliefs.players.length;
  const threat=Math.max(0,...fatal.map(s=>CARDS[s.card.key].level));
  const rescue=own.hand.filter(c=>CARDS[c.key].defense>=threat&&CARDS[c.key].cost<=own.energy&&threat>0);
  const income=1+own.builds.reduce((n,c)=>n+(CARDS[c.key].income||0),0);
  const cooperation=id=>{
    const events=history.filter(e=>e.type==='broadcast'&&e.actor===id).slice(-16);
    // Use a prior rather than treating one betrayal as perfect knowledge.
    return (2+events.filter(e=>CARDS[e.key]?.face==='合作').length)/(4+events.length);
  };
  const chance=(id,target)=>beliefs.players.find(p=>p.id===id)?.locations.find(g=>g.galaxy===target)?.probability||0;
  return {own,beliefs,ownDefense,incoming,fatal,escapeReady,threat,rescue,income,cooperation,chance};
}

export function rankActions(view,me,history,actions) {
  const t=analyzeTactics(view,me,history),{own:p}=t;
  const rivals=view.players.filter(q=>q.alive&&q.id!==me);
  const starThreat=t.incoming.some(s=>['photon','annihilation','dimension'].includes(s.card.key));
  const goal=p.hand.filter(c=>{const d=CARDS[c.key];return d.income&&!d.escape&&!(d.star&&view.markers[p.galaxy])&&
    !(c.key==='dyson'&&p.builds.some(b=>b.key==='dyson'))&&d.cost>p.energy&&d.cost<=p.energy+t.income;})
    .sort((a,b)=>CARDS[b.key].income-CARDS[a.key].income)[0];
  const loseReserve=(cost,newDefense=t.ownDefense)=>t.fatal.some(s=>CARDS[s.card.key].level>newDefense)&&
    t.escapeReady&&p.energy-cost<10;
  const loseDefense=(cost,newDefense=t.ownDefense)=>t.rescue.length&&newDefense<t.threat&&
    !t.rescue.some(c=>CARDS[c.key].cost<=p.energy-cost);
  const scoreAction=action=>{
    let score=0,reason='',details={};
    if(action.type==='play'){
      const card=p.hand.find(c=>c.id===action.cardId),d=CARDS[card.key];
      if(d.type==='build'){
        if(d.income){score=3+d.income*4-d.cost*.5;reason=`投资产能 +${d.income}，约 ${Math.ceil(d.cost/d.income)} 个自身回合回本`;
          if(starThreat&&d.star){score=-15;reason='来袭打击会摧毁这项恒星产能';}}
        else if(d.defense){score=d.defense>t.ownDefense?3+d.defense: -6;reason=d.defense>t.ownDefense?'提高防御等级':'防御不叠加，重复建设收益低';
          if(t.fatal.length&&d.defense>=t.threat){score=200;reason='优先挡住所有当前可防御的致命来袭';}
        } else {score=p.builds.some(c=>c.key===card.key)?-6:1.5;reason='监听可减少被迫回应和位置暴露';}
      } else if(d.type==='strike'){
        const flights=view.strikes.filter(s=>s.owner===me&&s.target===action.target),travel=d.instant?0:distance(p.galaxy,action.target);
        let value=0,occupancy=0;
        for(const q of rivals){
          const probability=t.chance(q.id,action.target),qd=defense(q);occupancy+=probability;
          const starValue=q.builds.filter(c=>CARDS[c.key].star).reduce((n,c)=>n+CARDS[c.key].cost,0);
          const buildValue=q.builds.reduce((n,c)=>n+CARDS[c.key].cost,0);
          let impact=0;
          if(d.instant){impact=buildValue*.55+q.builds.reduce((n,c)=>n+(CARDS[c.key].income||0)*2,0);
            if(qd)impact+=5;}
          else {
            const alreadyLethal=flights.some(s=>CARDS[s.card.key].level>qd&&s.required-s.progress<=travel);
            if(d.level>qd&&!alreadyLethal)impact=19+(rivals.length===1?8:0);
            if(card.key==='photon')impact+=starValue*.65;
            if(card.key==='annihilation')impact+=buildValue*.65;
            if(alreadyLethal)impact*=.08;
            // Energy/escapeUsed are public; possession of a ship is unknown.
            if(!q.escapeUsed&&q.energy>=10)impact*=.75;
          }
          value+=probability*impact;
        }
        const surplus=p.energy>=Math.max(16,t.income*3);
        score=value-d.cost*(surplus ? .12 : .85)-travel*.45;
        if(occupancy<.4&&!surplus)score-=3;
        if(flights.length)score-=3;
        reason=`占位概率约 ${Math.round(occupancy*100)}%；${travel?`飞行 ${travel} 个自身回合`:'立即结算'}，按防御及建设评估收益`;
        details={occupancy:rounded(occupancy),travel};
      } else if(d.type==='broadcast'){
        let expected=0,anyResponse=0;
        for(const q of rivals){
          const reachable=t.beliefs.players.find(x=>x.id===q.id).locations.reduce((n,g)=>n+g.probability*(distance(g.galaxy,action.target)<=1?1:.65),0);
          const probability=reachable*Math.min(.85,q.handCount*.18),coop=t.cooperation(q.id);
          anyResponse=1-(1-anyResponse)*(1-probability);
          expected=Math.max(expected,d.face==='合作'?3*coop:5*coop);
        }
        const net=anyResponse*expected+(1-anyResponse)-d.cost;
        score=net*2+.5;
        const ownPositions=GALAXIES.filter(g=>distance(g.id,action.target)<=d.range).length;
        const leakage=(9-ownPositions)/9;
        score-=leakage*(t.ownDefense?1:2);
        reason=`预期净能量约 ${net.toFixed(1)}；兼顾对手合作历史及位置暴露`;
        details={expectedNetEnergy:rounded(net),revealsPosition:ownPositions===1};
      }
      const afterDefense=Math.max(t.ownDefense,d.defense||0);
      if(loseReserve(d.cost,afterDefense)||loseDefense(d.cost,afterDefense)){
        score-=1000;reason+='；会耗尽逃生或紧急防御预算';
      } else if(goal&&d.type!=='build'&&p.energy-d.cost+t.income<CARDS[goal.key].cost){score-=4;reason+=`；会推迟下回合建设${CARDS[goal.key].name}`;}
    } else if(action.type==='respond'){
      if(!action.cardId){score=0;reason='保留手牌与能量，避免额外暴露位置';}
      else {
        const c=p.hand.find(c=>c.id===action.cardId),d=CARDS[c.key],b=view.pending,coop=t.cooperation(b.caster);
        const selectedGain=d.face==='合作'?3*coop:5*coop;
        const selection=1/(1+b.responses.length);
        const net=selection*selectedGain+(1-selection)-d.cost;
        score=net*2+.5;reason=`预计被选中净收益 ${selectedGain-d.cost}，未选中净收益 ${1-d.cost}`;
        if(loseReserve(d.cost))score-=1000;
      }
    } else if(action.type==='settle'){
      // During the pending phase the player's own face is present in the
      // private session, never in an opponent's hidden response card.
      const ownKey=view.ownBroadcastKey;
      const coop=t.cooperation(action.chosen),gain=ownKey&&CARDS[ownKey].face==='伪装'?5:3;
      score=coop*gain;reason='依据该回应者历史合作率挑选，不读取未揭示牌面';
    } else if(action.type==='escape'){score=action.use?1000:-1000;reason=action.use?'逃生优先于确定被淘汰':'放弃逃生会被淘汰';}
    else if(action.type==='discard'){
      score=-.5;const discarded=action.ids.map(id=>p.hand.find(c=>c.id===id));
      for(const c of discarded){const d=CARDS[c.key];
        if(d.escape){score+=p.escapeUsed?3:-5;continue;}
        const useless=d.star&&view.markers[p.galaxy]||c.key==='dyson'&&p.builds.some(b=>b.key==='dyson')||d.defense&&d.defense<=t.ownDefense;
        const expensive=d.cost>p.energy+t.income*2;
        score+=useless?3:expensive?1.5:-2;
        if(c.id===goal?.id)score-=8;
        if(t.rescue.some(r=>r.id===c.id))score-=1000;
        if(d.type==='strike'&&!useless&&!expensive){const best=Math.max(...actions.filter(a=>a.cardId===c.id&&a.type==='play').map(a=>scoreAction(a).score),-10);if(best<0)score+=3;}
      }
      reason='换掉失效、重复或近期用不上的牌，保留逃生及近期建设目标';
    } else if(action.type==='withdraw'){
      score=-5;reason='撤回不返还能量，通常保留在飞打击';
    } else if(action.type==='end'){
      score=goal?5:0;reason=goal?`存能，下回合可建设${CARDS[goal.key].name}`:'保留能量并补至四张手牌';
      if(t.rescue.length){score=-1000;reason='应先建造可用防御再结束回合';}
    }
    return {action,score,reason,...details};
  };
  const ranked=actions.map(scoreAction).sort((a,b)=>b.score-a.score);
  // Remove strictly dangerous spending only when a safe legal alternative
  // exists. All retained options are still validated by the game engine.
  const safe=ranked.some(x=>x.score>-500)?ranked.filter(x=>x.score>-500):ranked;
  const selected=[],seen=new Set();
  const add=x=>{if(x&&!seen.has(x)){seen.add(x);selected.push(x);}};
  for(const x of safe.slice(0,6))add(x);
  // Preserve the best option for every card/action family: one card with many
  // possible targets must not crowd all construction/response/discard out.
  const families=new Set();
  for(const x of safe){const family=x.action.cardId||x.action.type;if(!families.has(family)){families.add(family);add(x);}}
  for(const x of safe.slice(6,12))if(selected.length<16)add(x);
  selected.sort((a,b)=>b.score-a.score);
  const endIndex=selected.findIndex(x=>x.action.type==='end');if(endIndex>=0)selected.push(...selected.splice(endIndex,1));
  return {ranked:selected,tactics:{
    locations:t.beliefs.players.map(p=>({id:p.id,locations:p.locations.map(x=>({...x,probability:rounded(x.probability)}))})),
    uncertainEvidence:t.beliefs.inconsistent,income:t.income,defense:t.ownDefense,
    opponentCooperation:rivals.map(p=>({id:p.id,estimatedCooperation:rounded(t.cooperation(p.id))})),
    incoming:t.incoming.map(s=>({card:CARDS[s.card.key].name,progress:s.progress,canDefend:CARDS[s.card.key].level<=t.ownDefense})),
    escapeEnergyReserved:t.escapeReady&&t.fatal.length>0,savingFor:goal?CARDS[goal.key].name:null,
    candidateScoresAreHeuristics:true
  }};
}

export const STRATEGY_PROMPT=`决策纪律：先检查会淘汰自己的在飞打击，优先建设有效防御，必要时保留飞船和 10 点能量；防御只保护文明，无法保护恒星，湮灭会移除防御本身。不能依据他人真实隐藏坐标、手牌或未翻面广播作决策。
广播收益明确为：合作/合作各得3，合作/伪装分别得0和5，伪装/伪装各得0，无人回应发布者得1，未被选中的回应者得1；以上均再减各自牌费。当前合作/伪装面在结算前保密，历史合作率不是对当前牌面的保证。只选一个回应者，不能把多位回应者收益相加。
位置推断来自已揭示广播射程、公开命中、飞行进度和一星系一文明约束；给出的概率只是基于这些证据的估计，不是真实坐标。对方跃迁后旧位置证据失效，沉默不证明某星系无人。
先形成跨回合计划：早期建设经济，已有充足产能后转防御与消灭明确目标；必要时本回合存能以在下回合建关键设施，不为了出牌而花光能量。不要囤积确定失效的牌。不要在高概率空星系、已被足够强打击覆盖的目标或完全防得住的目标重复浪费打击。科技锁死的收益取决于目标实际公开建设；锁死会给对手半价返能，配合后续致命打击才有额外价值。
广播根据历史合作率、净收益、回应概率与坐标暴露选择，未知的当前牌面只能估计。当前候选分数只是启发式建议，不是精确收益，也不要求盲选最高分。回顾自己上一次简短计划，若新信息改变局势则调整。输出 JSON：{"choice":候选编号,"plan":"不超过60字的后续计划及依据"}。plan 只描述可公开推断的事实，不输出长篇推理。`;
