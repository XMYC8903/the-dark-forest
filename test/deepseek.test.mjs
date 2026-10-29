import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../dist/game.js';
import {decideDeepSeek} from '../server/deepseek.js';
import {gameView,applyGameAction,newRoom} from '../server/room-core.js';
import {inferPositions,rankActions} from '../server/deepseek-tactics.js';

test('DeepSeek 使用 Flash 深入思考并只收到玩家可见局面与合法候选',async()=>{
  const game=new Game({count:3,demo:false,seed:73});let requestBody;
  const session={messages:[{role:'system',content:'完整规则和星图'},{role:'user',content:'开局状态'}]};
  const action=await decideDeepSeek(game,0,[], 'test-secret',async(url,init)=>{
    assert.equal(url,'https://api.deepseek.com/chat/completions');
    assert.equal(init.headers.Authorization,'Bearer test-secret');
    requestBody=JSON.parse(init.body);
    return Response.json({choices:[{message:{content:'{"choice":0}'}}]});
  },session);
  assert.equal(requestBody.model,'deepseek-flash');assert.deepEqual(requestBody.thinking,{type:'enabled'});assert.equal(requestBody.reasoning_effort,'high');
  assert.equal(requestBody.max_tokens,4096);assert.deepEqual(requestBody.response_format,{type:'json_object'});
  const prompt=JSON.parse(requestBody.messages.at(-1).content.split('当前局面：')[1]);
  assert.ok(requestBody.messages[0].content.startsWith('完整规则和星图'));
  assert.equal(requestBody.messages[1].content,'开局状态');
  assert.equal(session.messages.at(-1).role,'assistant');
  let nextBody;
  await decideDeepSeek(game,0,[], 'test-secret',async(_url,init)=>{
    nextBody=JSON.parse(init.body);
    return Response.json({choices:[{message:{content:'{"choice":0}'}}]});
  },session);
  assert.ok(nextBody.messages.some((message,index)=>message.role==='assistant'&&index>1));
  assert.ok(nextBody.messages.length>requestBody.messages.length,'next decision replays earlier turns and updates');
  assert.equal(prompt.state.players[0].hand.length,4);
  assert.equal(prompt.state.players[0].galaxy,game.players[0].galaxy);
  for(const player of prompt.state.players.slice(1)){
    assert.equal(player.hand,undefined);assert.equal(player.galaxy,undefined);
  }
  assert.ok(prompt.legalActions.length>1);assert.ok(prompt.legalActions.every(x=>Number.isInteger(x.choice)&&x.action&&!('score' in x)&&!('reason' in x)));
  assert.deepEqual(action,prompt.legalActions[0].action);
});

const state=()=>({active:0,round:3,played:false,markers:{},strikes:[],pending:null,
  players:[{id:0,alive:true,galaxy:9,energy:12,escapeUsed:false,builds:[],hand:[],handCount:0},
    ...[1,2].map(id=>({id,alive:true,energy:5,escapeUsed:false,builds:[],handCount:4}))]});
const card=(id,key)=>({id,key});

test('位置推断结合公开命中与一星系一文明约束，逃生后清除旧坐标',()=>{
  const view=state(),evidence=[{type:'lock',actor:0,target:1,victim:1}];
  const beliefs=inferPositions(view,0,evidence);
  assert.deepEqual(beliefs.players[0].locations,[{galaxy:1,probability:1}]);
  assert.ok(beliefs.players[1].locations.every(x=>x.galaxy!==1));
  const escaped=inferPositions(view,0,[...evidence,{type:'escaped',actor:1,from:1}]);
  assert.ok(escaped.players[0].locations.length>1);assert.ok(escaped.players[0].locations.every(x=>x.galaxy!==1));
});

test('飞行进度约束发射位置，发射者跃迁后不再用于当前坐标',()=>{
  const view=state(),launch={type:'launch',actor:1,target:1,strikeId:'s'};
  view.strikes=[{id:'s',owner:1,target:1,progress:2,card:card('s','nuclear')}];
  assert.deepEqual(inferPositions(view,0,[launch]).players[0].locations,[{galaxy:8,probability:1}]);
  assert.ok(inferPositions(view,0,[launch,{type:'escaped',actor:1,from:8}]).players[0].locations.length>1);
});

test('逃生打击结算不会把逃生后的玩家重新定位到旧目标',()=>{
  const view=state();
  const beliefs=inferPositions(view,0,[{type:'escaped',actor:1,from:1},{type:'impact',actor:2,target:1,victim:1,outcome:'escaped'}]);
  assert.ok(beliefs.players[0].locations.length>1);assert.ok(beliefs.players[0].locations.every(x=>x.galaxy!==1));
});

test('致命来袭时优先有效防御，禁止消耗紧急防御预算',()=>{
  const view=state();view.players[0].energy=8;view.players[0].hand=[card('g','ghost'),card('f','fusion')];
  view.strikes=[{id:'s',owner:1,target:9,progress:1,card:card('s','annihilation')}];
  const {ranked}=rankActions(view,0,[],[{type:'play',cardId:'f'},{type:'play',cardId:'g'},{type:'end'}]);
  assert.deepEqual(ranked[0].action,{type:'play',cardId:'g'});
  assert.ok(!ranked.some(x=>x.action.cardId==='f'||x.action.type==='end'));
});

test('无法防御的来袭保留飞船所需10点能量',()=>{
  const view=state();view.players[0].hand=[card('l','lightship'),card('f','fusion')];
  view.strikes=[{id:'s',owner:1,target:9,progress:0,card:card('s','dimension')}];
  const {ranked,tactics}=rankActions(view,0,[],[{type:'play',cardId:'f'},{type:'end'}]);
  assert.equal(tactics.escapeEnergyReserved,true);assert.equal(ranked.length,1);assert.equal(ranked[0].action.type,'end');
});

test('明确目标且可击穿防御时选择打击，避免重复在飞致命打击',()=>{
  const view=state();view.players[0].hand=[card('n','nuclear')];
  const actions=[1,2].map(target=>({type:'play',cardId:'n',target}));actions.push({type:'end'});
  const history=[{type:'lock',actor:0,target:1,victim:1}];
  const first=rankActions(view,0,history,actions);assert.equal(first.ranked[0].action.target,1);
  view.strikes=[{id:'s',owner:0,target:1,progress:0,required:1,card:card('s','nuclear')}];
  const again=rankActions(view,0,history,actions);
  assert.ok(again.ranked.find(x=>x.action.target===1).score<first.ranked[0].score-10);
});

test('同一张牌的多个目标不会挤掉紧急防御、存能或其他卡牌候选',()=>{
  const view=state();view.players[0].hand=[card('s','stellar_d'),card('f','fusion')];
  const actions=Array.from({length:9},(_,i)=>({type:'play',cardId:'s',target:i+1}));
  actions.push({type:'play',cardId:'f'},{type:'end'});
  const {ranked}=rankActions(view,0,[],actions);
  assert.ok(ranked.some(x=>x.action.cardId==='f'));assert.ok(ranked.some(x=>x.action.type==='end'));
});

test('存能即可在下回合建戴森球时，保留关键建设而不随意弃掉',()=>{
  const view=state();view.players[0].energy=5;view.players[0].hand=[card('d','dyson')];
  const {ranked,tactics}=rankActions(view,0,[],[{type:'discard',ids:['d']},{type:'end'}]);
  assert.equal(tactics.savingFor,'戴森球');assert.equal(ranked.find(x=>x.action.type==='end').score>ranked.find(x=>x.action.type==='discard').score,true);
});

test('模型请求与战术分析不会随对手隐藏手牌和坐标改变',async()=>{
  const game=new Game({count:3,demo:false,seed:73}),requests=[];
  const fake=async(_url,init)=>{requests.push(JSON.parse(init.body));return Response.json({choices:[{message:{content:'{"choice":0,"plan":"优先发展经济，保留有效防御"}'}}]});};
  await decideDeepSeek(game,0,[],'secret',fake);
  [game.players[1].galaxy,game.players[2].galaxy]=[game.players[2].galaxy,game.players[1].galaxy];
  game.players[1].hand=game.players[1].hand.map(c=>({...c,key:'dimension'}));
  await decideDeepSeek(game,0,[],'secret',fake);
  const normalize=request=>{const copy=structuredClone(request),message=copy.messages.at(-1),prefix='当前局面：';const data=JSON.parse(message.content.split(prefix)[1]);data.legalActions=data.legalActions.map(({choice,...x})=>x).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));message.content=prefix+JSON.stringify(data);return copy;};
  assert.deepEqual(normalize(requests[0]),normalize(requests[1]));
});

test('公开打击事实持久记录且只在广播揭示后记录牌面',()=>{
  const room=newRoom('12345678','host','测试','测试');room.game=new Game({count:3});room.status='playing';
  const g=room.game,lock=g.players[0].hand.find(c=>c.key==='lock');
  applyGameAction(room,0,{type:'play',cardId:lock.id,target:1});
  const event=room.intel.find(e=>e.type==='lock');assert.deepEqual([event.type,event.actor,event.target,event.key,event.victim],['lock',0,1,'lock',1]);assert.equal(typeof event.refund,'number');assert.ok(Array.isArray(event.removed));
  const broadcast=g.players[0].hand.find(c=>c.key==='stellar_c');
  applyGameAction(room,0,{type:'play',cardId:broadcast.id,target:5});
  assert.equal(room.intel.some(e=>e.type==='broadcast'),false);
});

test('DeepSeek 无密钥、接口错误或越界选择时安全回退',async()=>{
  const game=new Game({count:3,demo:false,seed:73});let called=false;
  assert.equal(await decideDeepSeek(game,0,[],null,async()=>{called=true;}),null);assert.equal(called,false);
  assert.equal(await decideDeepSeek(game,0,[],'key',async()=>new Response('error',{status:503})),null);
  assert.equal(await decideDeepSeek(game,0,[],'key',async()=>Response.json({choices:[{message:{content:'{"choice":999}'}}]})),null);
});

test('DeepSeek候选在3/4/6人局面中合法推进且卡牌守恒',async()=>{
  for(const count of [3,4,6]){
    const room=newRoom('12345678','host','模拟','模拟');room.game=new Game({count,demo:false,seed:100+count});room.status='playing';
    const fake=async(_url,init)=>{
      const body=JSON.parse(init.body),data=JSON.parse(body.messages.at(-1).content.split('当前局面：')[1]);
      const best=data.legalActions.find(x=>x.action.type==='play')||data.legalActions[0];
      return Response.json({choices:[{message:{content:JSON.stringify({choice:best.choice,plan:'按公开证据推进'})}}]});
    };
    let steps=0;
    while(!room.game.over&&steps++<80){
      if(room.game.pending?.autoSettleAt){const now=Date.now;Date.now=()=>room.game.pending.autoSettleAt;
        try{applyGameAction(room,room.game.pending.caster,{type:'settle',chosen:null});}finally{Date.now=now;}continue;}
      let moved=false;
      for(let me=0;me<count;me++){
        const action=await decideDeepSeek(room.game,me,room.intel,'fake',fake);
        if(!action)continue;
        applyGameAction(room,me,action);moved=true;
        assert.equal(room.game.allPhysicalCards().length,64);break;
      }
      assert.ok(moved,'候选策略不可停滞');
    }
  }
});

