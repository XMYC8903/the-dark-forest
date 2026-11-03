// Local payload experiment only. No API key, network request, or model inference.
import assert from 'node:assert/strict';
import {Game,seeded} from '../shared/game.js';
import {newRoom,appendDeepSeekUpdates,applyGameAction,gameView} from '../server/room-core.js';
import {decideDeepSeek} from '../server/deepseek.js';
import {decideAI} from '../server/ai.js';

const seed=Number(process.argv[2]||73),windows=[24,3,0],sessions=windows.map(()=>({})),stats=windows.map(observationWindow=>({observationWindow,apiCalls:0,totalBytes:0,maxBytes:0}));
const room=newRoom('A2C4E6','bot0','本地比较','bot0');
room.members=Array.from({length:4},(_,id)=>({id:'bot'+id,name:'bot'+id,bot:'deepseek'}));room.game=new Game({count:4,demo:false,seed});room.status='playing';
const originalRandom=Math.random;let steps=0;
const canonical=action=>JSON.stringify(Object.fromEntries(Object.entries(action).sort(([a],[b])=>a.localeCompare(b))));
try{
  while(!room.game.over&&steps<3000){
    const game=room.game,p=game.pending;
    if(p?.autoSettleAt)p.autoSettleAt=Date.now()-1;
    const me=p?.kind==='escape'?p.victim:p?.kind==='broadcast'?(game.players.find(q=>q.alive&&q.id!==p.caster&&!p.decisions.includes(q.id))?.id??p.caster):game.active;
    const preferred=decideAI(gameView(game,me),me,'hard',room.intel,seeded(seed+steps));
    const actions=[];
    for(let i=0;i<windows.length;i++){
      room.deepseekSessions=sessions[i];appendDeepSeekUpdates(room);Math.random=seeded(seed+steps);
      actions.push(await decideDeepSeek(game,me,room.intel,'local-only',async(_url,request)=>{
        const bytes=Buffer.byteLength(request.body);stats[i].apiCalls++;stats[i].totalBytes+=bytes;stats[i].maxBytes=Math.max(stats[i].maxBytes,bytes);
        const payload=JSON.parse(JSON.parse(request.body).messages.at(-1).content.split('当前局面：')[1]);
        const chosen=payload.legalActions.find(c=>preferred&&canonical(c.action)===canonical(preferred))||payload.legalActions[0];
        return Response.json({choices:[{message:{content:JSON.stringify({choice:chosen.choice})}}]});
      },sessions[i]['bot'+me],null,null,{observationWindow:windows[i]}));
    }
    assert.deepEqual(actions[1],actions[0]);assert.deepEqual(actions[2],actions[0]);
    applyGameAction(room,me,actions[0]);steps++;
  }
}finally{Math.random=originalRandom;}
assert.ok(room.game.over,'本地策略未在 3000 步内完成，不能视为完整对局比较');
console.log(JSON.stringify({seed,players:4,steps,rounds:room.game.round,completed:room.game.over,note:'真实请求字节；假 API 固定相同动作，不证明真实 token、缓存、费用或棋力',variants:stats.map(s=>({...s,byteReduction:1-s.totalBytes/stats[0].totalBytes}))},null,2));
