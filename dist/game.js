export const COLORS = { broadcast:'#e7837f', build:'#75b2f7', strike:'#9cce8c' };
export const TYPES = { broadcast:'广播', build:'建设', strike:'打击' };
export const GALAXIES = [
  {id:1,name:'187J3X1',x:112,y:126},{id:2,name:'DX3906',x:290,y:55},
  {id:3,name:'波江座 ε',x:196,y:329},{id:4,name:'巴纳德星',x:322,y:222},
  {id:5,name:'太阳系',x:504,y:230},{id:6,name:'半人马座 α',x:458,y:91},
  {id:7,name:'参宿四',x:623,y:365},{id:8,name:'天狼星',x:689,y:116},
  {id:9,name:'天鹅座 α',x:796,y:302}
];
export const EDGES = [[1,2],[1,3],[1,4],[2,4],[2,6],[3,4],[3,7],[4,5],[5,6],[5,7],[5,8],[6,8],[7,9],[8,9]];
const def = (name,type,cost,count,extra={}) => ({name,type,cost,count,...extra});
export const CARDS = {
  stellar_c:def('恒星广播','broadcast',0,9,{range:1,face:'合作',art:'broadcast',rule:'距离 1 · 合作共生',detail:'向距离不超过 1 的星系广播。双方合作各得 3 能量，伪装方遇合作方可得 5。结算后统一计算能量。'}),
  stellar_d:def('恒星广播','broadcast',0,5,{range:1,face:'伪装',art:'broadcast',rule:'距离 1 · 隐藏意图',detail:'向距离不超过 1 的星系广播。选择与响应期间，其他人不知道你使用的是合作还是伪装。'}),
  cosmic_c:def('宇宙广播','broadcast',1,6,{range:2,face:'合作',art:'broadcast',rule:'距离 2 · 合作共生',detail:'向距离不超过 2 的星系广播。结算后支付 1 能量，再统一更新收益。'}),
  cosmic_d:def('宇宙广播','broadcast',1,4,{range:2,face:'伪装',art:'broadcast',rule:'距离 2 · 隐藏意图',detail:'向距离不超过 2 的星系广播。合作/伪装直到结算才同时揭晓。'}),
  hyper_c:def('超距广播','broadcast',2,2,{range:Infinity,face:'合作',art:'broadcast',rule:'距离 ∞ · 合作共生',detail:'可广播到任何星系。无限距离的广播不构成位置约束。结算后支付 2 能量。'}),
  hyper_d:def('超距广播','broadcast',2,2,{range:Infinity,face:'伪装',art:'broadcast',rule:'距离 ∞ · 隐藏意图',detail:'可广播到任何星系，不受距离限制。结算后支付 2 能量。'}),
  solar:def('太阳能阵列','build',2,4,{income:1,star:true,art:'solar',rule:'产能 +1 · 依赖恒星',detail:'每次自己的回合生产时，额外获得 1 能量。恒星熄灭时此牌弃置，也不能再建造新的太阳能阵列。'}),
  fusion:def('聚变反应堆','build',3,4,{income:1,star:false,art:'reactor',rule:'产能 +1 · 独立能源',detail:'每次自己的回合生产时额外获得 1 能量。不依赖恒星，恒星熄灭后仍可工作。'}),
  antimatter:def('反物质引擎','build',6,2,{income:2,star:false,art:'reactor',rule:'产能 +2 · 独立能源',detail:'每次自己的回合生产时额外获得 2 能量，不依赖恒星。'}),
  dyson:def('戴森球','build',6,2,{income:3,star:true,art:'dyson',rule:'产能 +3 · 依赖恒星',detail:'额外获得 3 能量，每位玩家最多拥有一个。恒星熄灭时此牌弃置，也不能再建造。'}),
  bunker:def('掩体星环','build',6,4,{defense:2,art:'ring',rule:'防御 ≤2 · 文明庇护',detail:'文明可抵御等级 2 及以下打击，但光粒打击仍会毁灭恒星。'}),
  ghost:def('量子幽灵','build',8,2,{defense:3,art:'ring',rule:'防御 ≤3 · 量子庇护',detail:'文明可抵御等级 3 及以下打击。抵御湮灭后文明存活，但恒星与全部已建建筑仍被摧毁。'}),
  lightship:def('光速飞船','build',10,2,{escape:true,art:'ship',color:'#ba8cf2',rule:'致命打击时 · 一次逃生',detail:'留在手牌中，不能建造。致命打击时可使用，清空建筑并将能量设为 3，随机跃迁到其他合法空星系。每局只能用一次。'}),
  listener:def('监听基地','build',2,2,{art:'broadcast',rule:'隐匿监听 · 可免回应',detail:'即使广播点名你的星系，也可以选择不回应。建设牌公开，但文明坐标仍然保密。'}),
  lock:def('科技锁死','strike',4,2,{level:Infinity,art:'lock',instant:true,rule:'拆除全部建筑 · 返还半价',detail:'立即拆除目标星系玩家的全部已建建筑，向被拆者返还原始总费用的一半，向下取整。手牌不变，不淘汰玩家。'}),
  nuclear:def('热核打击','strike',4,4,{level:1,art:'strike',rule:'等级 1 · 延时命中',detail:'对指定星系发动等级 1 的延时打击。没有对应防御的文明会被淘汰。'}),
  photon:def('光粒打击','strike',6,4,{level:2,art:'strike',rule:'等级 2 · 熄灭恒星',detail:'延时打击。即使文明防御成功，目标恒星仍被熄灭，全部依赖恒星的建设牌移至弃牌堆。'}),
  annihilation:def('湮灭打击','strike',8,2,{level:3,art:'strike',rule:'等级 3 · 摧毁恒星与建设',detail:'延时打击。摧毁恒星及全部建筑，量子幽灵可保住文明，但不能保住建筑与恒星。'}),
  dimension:def('降维打击','strike',10,2,{level:Infinity,art:'dimension',rule:'等级 ∞ · 毁灭星系',detail:'摧毁星系，任何建筑都无法抵御。目标星系变为灰色并从地图消失；满足条件时可用光速飞船逃生。'})
};
export function distance(a,b){if(a===b)return 0;const seen=new Set([a]);let layer=[a],d=0;while(layer.length){d++;const next=[];for(const x of layer)for(const [u,v] of EDGES){const y=u===x?v:v===x?u:null;if(y!==null&&!seen.has(y)){if(y===b)return d;seen.add(y);next.push(y);}}layer=next;}return Infinity;}
export function seeded(seed){const rng=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};rng.state=()=>seed;return rng;}
const NAMES=['观测者','执剑人','面壁者','守夜人','归零者','追光者'];
export class Game {
  constructor({count=4,demo=true,seed=10723,random=null}={}){
    if(!Number.isInteger(count)||count<3||count>6)throw Error('支持 3–6 人');
    this.rng=random||seeded(seed);this.deck=[];this.discard=[];this.strikes=[];this.markers={};this.markerSchemaVersion=3;this.latest=null;this.pending=null;this.active=0;this.turnIndex=demo?8:0;this.round=demo?3:1;this.demo=demo;this.played=false;this.over=false;this.winner=null;this.events=[];this.entering=false;
    let serial=1;for(const [key,d] of Object.entries(CARDS))for(let i=0;i<d.count;i++)this.deck.push({id:'c'+serial++,key});this.shuffle(this.deck);
    const coords=demo?[5,1,8,3,9,6]:this.shuffle([1,2,3,4,5,6,7,8,9]);
    this.players=Array.from({length:count},(_,i)=>({id:i,name:NAMES[i],galaxy:coords[i],energy:demo?[12,8,7,5,9,6][i]:3,hand:[],builds:[],alive:true,escapeUsed:false}));
    if(demo){this.players[0].hand=['stellar_c','solar','photon','lock'].map(k=>this.take(k));this.players[0].builds.push(this.take('fusion'));this.players[1].builds.push(this.take('solar'));this.players[2].builds.push(this.take('bunker'));this.players[1].hand.push(this.take('stellar_d'));}
    for(const p of this.players)this.refill(p);
    if(!demo)this.players[0].energy+=1;
    this.events=[];
  }
  shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(this.rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  take(key){const i=this.deck.findIndex(c=>c.key===key);if(i<0)throw Error('卡牌不足');return this.deck.splice(i,1)[0];}
  emit(type,data={}){this.events.push({type,...data});}
  setLatest(latest){this.latest=latest;}
  flush(){return this.events.splice(0);}
  draw(p){if(!this.deck.length&&this.discard.length){this.deck=this.shuffle(this.discard.splice(0));this.emit('shuffle',{count:this.deck.length});}if(this.deck.length){const c=this.deck.pop();p.hand.push(c);this.emit('draw',{player:p.id,card:c});return c;}return null;}
  refill(p){while(p.hand.length<4){if(!this.draw(p))break;}}
  income(p){return 1+p.builds.reduce((n,c)=>n+((!CARDS[c.key].star||!this.markers[p.galaxy])?(CARDS[c.key].income||0):0),0);}
  assertAction(){if(this.over)throw Error('对局已结束');if(this.pending)throw Error('请先完成当前交互');if(!this.players[this.active].alive)throw Error('该文明已出局');}
  playable(cardId){const p=this.players[this.active],c=p.hand.find(c=>c.id===cardId);if(!c)throw Error('手牌不存在');const d=CARDS[c.key];if(p.energy<d.cost)throw Error('能量不足');if(d.escape)throw Error('光速飞船只能在致命打击时使用');if(d.star&&this.markers[p.galaxy])throw Error('恒星已熄灭，不能建造依赖恒星的建筑');if(c.key==='dyson'&&p.builds.some(c=>c.key==='dyson'))throw Error('每个文明只能拥有一个戴森球');return c;}
  play(cardId,target){this.assertAction();const p=this.players[this.active],card=this.playable(cardId),d=CARDS[card.key];if(d.type!=='build'&&!GALAXIES.some(g=>g.id===target))throw Error('请选择目标星系');if(d.type==='strike'&&this.markers[target]==='gray')throw Error('灰色星系已不存在');if(d.type==='strike'&&target===p.galaxy)throw Error('不能打击自己的星系');if(d.type==='broadcast'&&distance(p.galaxy,target)>d.range)throw Error('目标超出广播范围');p.hand.splice(p.hand.findIndex(c=>c.id===cardId),1);this.played=true;
    if(d.type==='build'){p.energy-=d.cost;p.builds.push(card);this.setLatest({kind:'build',revealed:true,cards:[{...card,actor:p.id,role:'建设'}]});this.emit('build',{player:p.id,card});}
    else if(d.type==='broadcast'){this.pending={kind:'broadcast',caster:p.id,card,target,responses:[],decisions:[]};this.setLatest({kind:'broadcast',target,revealed:false,cards:[{...card,actor:p.id,role:'发布'}]});this.emit('broadcast',{player:p.id,card,target});}
    else{p.energy-=d.cost;if(d.instant){const victim=this.players.find(x=>x.alive&&x.galaxy===target);let refund=0;if(victim){refund=Math.floor(victim.builds.reduce((n,c)=>n+CARDS[c.key].cost,0)/2);this.discard.push(...victim.builds.splice(0));victim.energy+=refund;}this.discard.push(card);this.setLatest({kind:'strike',target,revealed:true,outcome:victim?'locked':null,victimId:victim?.id,cards:[{...card,actor:p.id,role:'已生效'}]});this.emit('lock',{player:p.id,target,victim:victim?.id,refund,card});}else{this.strikes.push({id:card.id,card,owner:p.id,target,required:distance(p.galaxy,target),progress:0});this.setLatest({kind:'strike',target,revealed:true,cards:[{...card,actor:p.id,role:'发射'}]});this.emit('launch',{player:p.id,card,target});this.resolveDue();}}
    this.checkEnd();return card;
  }
  responseOptions(id){const b=this.pending;if(!b||b.kind!=='broadcast')return [];const p=this.players[id];if(!p?.alive||id===b.caster)return [];return p.hand.filter(c=>{const d=CARDS[c.key];return d.type==='broadcast'&&p.energy>=d.cost&&distance(p.galaxy,b.target)<=d.range;});}
  isForced(id){return this.pending?.kind==='broadcast'&&this.players[id].galaxy===this.pending.target&&!this.players[id].builds.some(c=>c.key==='listener')&&this.responseOptions(id).length>0;}
  respond(id,cardId=null){const b=this.pending;if(!b||b.kind!=='broadcast')throw Error('没有待回应的广播');if(id===b.caster||!this.players[id]?.alive||b.decisions.includes(id))throw Error('无法重复回应');const opts=this.responseOptions(id);if(!cardId&&this.isForced(id))throw Error('广播点名你的星系，必须回应');if(cardId){const c=opts.find(c=>c.id===cardId);if(!c)throw Error('这张牌无法回应');this.players[id].hand.splice(this.players[id].hand.findIndex(c=>c.id===cardId),1);b.responses.push({actor:id,card:c});this.latest.cards.push({...c,actor:id,role:'回应'});this.emit('response',{player:id,card:c});}b.decisions.push(id);}
  settleBroadcast(chosenId=null){const b=this.pending;if(!b||b.kind!=='broadcast')throw Error('没有待结算广播');if(this.players.some(p=>p.alive&&p.id!==b.caster&&!b.decisions.includes(p.id)))throw Error('还有玩家尚未表态');const selected=b.responses.find(r=>r.actor===chosenId);if(b.responses.length&&!selected)throw Error('请选择一名回应者');const caster=this.players[b.caster];let gain=1,otherGain=0;if(selected){const a=CARDS[b.card.key].face,c=CARDS[selected.card.key].face;gain=a==='合作'&&c==='合作'?3:a==='伪装'&&c==='合作'?5:0;otherGain=a==='合作'&&c==='合作'?3:a==='合作'&&c==='伪装'?5:0;}
    caster.energy+=gain-CARDS[b.card.key].cost;
    for(const r of b.responses){const p=this.players[r.actor];p.energy+=(r===selected?otherGain:1)-CARDS[r.card.key].cost;this.discard.push(r.card);}
    this.discard.push(b.card);this.setLatest({kind:'broadcast',target:b.target,revealed:true,cards:[{...b.card,actor:b.caster,role:'发布'},...b.responses.map(r=>({...r.card,actor:r.actor,role:r===selected?'回应':'未采纳'}))]});this.pending=null;this.emit('broadcast_resolved',{caster:caster.id,selected:selected?.actor,gain:gain-CARDS[b.card.key].cost,target:b.target,cards:this.latest.cards.map(c=>({id:c.id,actor:c.actor,key:c.key,role:c.role}))});this.checkEnd();
  }
  discardCards(ids){this.assertAction();if(this.played)throw Error('出过牌后不能主动弃牌');const unique=new Set(ids),p=this.players[this.active];if(!unique.size)throw Error('请先选择要弃的牌');if(unique.size!==ids.length||ids.some(id=>!p.hand.some(c=>c.id===id)))throw Error('弃牌选择无效');const cards=p.hand.filter(c=>unique.has(c.id));p.hand=p.hand.filter(c=>!unique.has(c.id));this.discard.push(...cards);this.setLatest({kind:'discard',revealed:true,cards:cards.map(c=>({...c,actor:p.id,role:'弃置'}))});this.emit('discard',{player:p.id,cards});this.endTurn();return cards;}
  endTurn(){this.assertAction();const p=this.players[this.active];if(p.alive)this.refill(p);this.nextSeat();}
  nextSeat(){if(this.pending||this.over)return;let guard=0;do{if(guard++>this.players.length*8)throw Error('打击推进状态异常');this.active=(this.active+1)%this.players.length;this.turnIndex++;if(this.active===0)this.round++;this.played=false;this.entering=true;for(const s of this.strikes)if(s.owner===this.active)s.progress++;this.resolveDue();if(this.pending||this.over)return;this.finishEntry();if(this.players[this.active].alive)return;}while(!this.over);}
  finishEntry(){if(!this.entering||this.pending||this.over)return;this.entering=false;const p=this.players[this.active];if(p.alive){const gain=this.income(p);p.energy+=gain;this.emit('production',{player:p.id,gain});}}
  resolveDue(){while(!this.pending){const s=this.strikes.find(s=>s.progress>=s.required);if(!s)break;this.impact(s);}this.checkEnd();}
  extinguishStar(target,marker){
    this.markers[target]=marker;const lost=[];
    for(const p of this.players.filter(p=>p.galaxy===target)){
      const cards=p.builds.filter(c=>CARDS[c.key].star);
      p.builds=p.builds.filter(c=>!CARDS[c.key].star);this.discard.push(...cards);
      if(cards.length){lost.push(...cards.map(c=>({...c,actor:p.id,role:'恒星熄灭弃置'})));this.emit('star_discard',{player:p.id,target,cards});}
    }
    return lost;
  }
  impact(s){const d=CARDS[s.card.key],victim=this.players.find(p=>p.alive&&p.galaxy===s.target);
    this.emit('strike_arriving',{owner:s.owner,card:s.card,target:s.target,strikeId:s.id});
    if(['photon','annihilation','dimension'].includes(s.card.key))s.starLosses=this.extinguishStar(s.target,s.card.key==='dimension'?'gray':'red');
    if(!victim){const environmentalHit=['photon','annihilation','dimension'].includes(s.card.key);this.removeStrike(s,environmentalHit?'hit':'miss');this.emit(environmentalHit?'system_hit':'miss',{target:s.target});return;}
    const defended=victim.builds.some(c=>(CARDS[c.key].defense||0)>=d.level);
    if(s.card.key==='annihilation'){const cards=victim.builds.splice(0);this.discard.push(...cards);s.starLosses.push(...cards.map(c=>({...c,actor:victim.id,role:'打击摧毁'})));if(cards.length)this.emit('builds_destroyed',{player:victim.id,target:s.target,cards});}
    if(!defended&&this.canEscape(victim)){this.pending={kind:'escape',victim:victim.id,strikeId:s.id};this.emit('escape_pending',{player:victim.id});return;}
    if(!defended)this.eliminate(victim,s.owner);else this.emit('defended',{player:victim.id,target:s.target});this.removeStrike(s,defended?'survived':'eliminated',victim.id);
  }
  emptyGalaxies(p){return GALAXIES.filter(g=>g.id!==p.galaxy&&this.markers[g.id]!=='gray'&&!this.players.some(q=>q.alive&&q.galaxy===g.id));}
  canEscape(p){return !p.escapeUsed&&p.energy>=10&&p.hand.some(c=>c.key==='lightship')&&this.emptyGalaxies(p).length>0;}
  resolveEscape(use){const b=this.pending;if(!b||b.kind!=='escape')throw Error('没有待决逃生');const p=this.players[b.victim],s=this.strikes.find(s=>s.id===b.strikeId);if(use){if(!this.canEscape(p))throw Error('无法启动飞船');const options=this.emptyGalaxies(p),from=p.galaxy,card=p.hand.splice(p.hand.findIndex(c=>c.key==='lightship'),1)[0];this.discard.push(card,...p.builds.splice(0));p.energy=3;p.escapeUsed=true;p.galaxy=options[Math.floor(this.rng()*options.length)].id;this.emit('escaped',{player:p.id,from});}else this.eliminate(p,s.owner);this.removeStrike(s,use?'escaped':'eliminated',p.id);this.pending=null;this.resolveDue();if(this.entering&&!this.pending&&!this.over){this.finishEntry();if(!this.players[this.active].alive)this.nextSeat();}}
  eliminate(p,owner){p.alive=false;this.discard.push(...p.hand.splice(0),...p.builds.splice(0));this.players[owner].energy+=this.players.filter(p=>p.alive).length*3;this.emit('eliminated',{player:p.id});}
  removeStrike(s,outcome=null,victimId=null){this.strikes.splice(this.strikes.findIndex(x=>x.id===s.id),1);this.discard.push(s.card);this.setLatest({kind:'strike',target:s.target,revealed:true,outcome,victimId,cards:[{...s.card,actor:s.owner,role:'结算'},...(s.starLosses||[])]});if(outcome)this.emit('strike_resolved',{owner:s.owner,target:s.target,key:s.card.key,strikeId:s.id,progress:s.progress,outcome,victimId});}
  withdraw(id){if(this.over||this.pending)throw Error('当前不能撤回');const s=this.strikes.find(s=>s.id===id&&s.owner===this.active);if(!s||!this.players[this.active].alive)throw Error('只能撤回自己的未结算打击');this.removeStrike(s);this.emit('withdraw',{player:s.owner});this.checkEnd();}
  checkEnd(){if(this.pending)return;const live=this.players.filter(p=>p.alive);if(live.length<=1&&!this.strikes.length){this.over=true;this.winner=live[0]?.id??null;this.emit('gameover',{winner:this.winner});}}
  allPhysicalCards(){const pending=this.pending?.kind==='broadcast'?[this.pending.card,...this.pending.responses.map(r=>r.card)]:[];return [...this.deck,...this.discard,...this.players.flatMap(p=>[...p.hand,...p.builds]),...this.strikes.map(s=>s.card),...pending];}
}
