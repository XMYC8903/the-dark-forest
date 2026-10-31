import {validateReplayArchive,sanitizeReplayArchive} from './replay-archive.js';
import {launchDemo,launchOnline,receiveOnlineRoom,suspendTable} from './app.js?v=20261028-no-deepseek-dialog1';
import {AI_NAMES} from './ai-labels.js';
import {requestId} from './request-id.js';
import {CARDS,GALAXIES,EDGES} from './game.js';
import {summarizeBuildings} from './view-model.js?v=20261025-green-loss-mark';
import {createSpectatorPlayback} from './spectator-motion.js?v=20261028-energy-anchor1';
import {createSocial} from './social.js?v=20261026-account-layout3';

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const levels={easy:'简单',normal:'普通',hard:'困难',deepseek:'DeepSeek'};
let username=localStorage.getItem('df_name')||'观测者'+String(Math.floor(Math.random()*9000)+1000);
localStorage.setItem('df_name',username);
let screen='home',room=null,rooms=[],socket=null,retry=null,heartbeat=null,listTimer=null,entryTimer=null,entryExitTimer=null,connected=false,requesting=false,leaving=false,roomRevision=0,replayArchive=null,replayIndex=0,replayPlaying=false,replayTimer=null,observerEndPromptDismissed=false,observerReplaySaving=false,observerReplaySaveError='',observerReplayRetryDestination='room',observerSaveToastTimer=null,spectatorRoomView=false,roomDOMState=null;
const sessionReady=fetch('/api/session',{credentials:'same-origin'}).then(async r=>{if(!r.ok)throw Error('联机服务器尚未启动，Demo 仍可试玩');return r.json();});
sessionReady.catch(()=>{});
async function api(path,body) {
  await sessionReady;
  const response=await fetch('/api'+path,{method:body?'POST':'GET',credentials:'same-origin',
    headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});
  let data;try{data=await response.json();}catch{throw Error('联机服务暂时不可用，请稍后重试');}
  if(!response.ok){const error=Object.assign(new Error(data.error||'请求未成功'),{status:response.status});throw error;}
  return data;
}
function observerSaveToast(message){const node=$('#toast');if(!node)return;clearTimeout(observerSaveToastTimer);node.textContent=message;node.classList.add('visible');observerSaveToastTimer=setTimeout(()=>node.classList.remove('visible'),3800);}
function errorMessage(error){const el=screen==='spectator'?$('#observer-error'):$('#portal-error');if(el)el.textContent=error.message;}
async function task(fn) {
  if(requesting)return;requesting=true;
  $('#portal-error')?.replaceChildren();
  document.querySelectorAll('#portal button[data-busy]').forEach(b=>b.disabled=true);
  try{await fn();}catch(error){errorMessage(error);}finally{requesting=false;document.querySelectorAll('#portal button[data-busy]').forEach(b=>b.disabled=false);}
}
function shell(content,{wide=false,title='藏好自己，\n做好清理。',subtitle='在九个星系之间，建设文明，交换信号。\n当坐标暴露，黑暗森林便不再寂静。'}={}) {
  $('#portal').innerHTML=`<header class="portal-header"><div class="portal-brand"><i>◉</i><span><b>黑暗森林</b><small>THE DARK FOREST</small></span></div><button id="identity-shortcut" class="identity-tag" title="账号主页">${esc(social.account?.name||"未登录")}</button></header><main class="portal-layout${wide?' wide':' compact'}"><div class="portal-scene"><div class="portal-orbit"></div><span class="eyebrow">DARK FOREST / CARD GAME</span><h1>${esc(title).replace(/\n/g,'<br>')}</h1><p>${esc(subtitle).replace(/\n/g,'<br>')}</p></div><section class="portal-panel">${content}<div id="portal-error" class="portal-error" role="status"></div></section></main><footer class="portal-footer"><span>3–6 人 · 真人与 AI 同桌<br>支持电脑与手机</span><b>宇宙很大，生活更大。</b></footer>`;
  $('#portal').scrollTop=0;
  $('#identity-shortcut').onclick=()=>social.account?show('account'):social.login(false,'account');
}
function setScreen(next) {
  screen=next;clearTimeout(listTimer);
  const app=$('.app'),entry=$('#table-entry'),observer=$('#spectator-app'),inTable=next==='table',inSpectator=next==='spectator',arriving=inTable?app:inSpectator?observer:null;
  $('#portal').hidden=inTable||inSpectator;app.hidden=!inTable;observer.hidden=!inSpectator;
  clearTimeout(entryTimer);clearTimeout(entryExitTimer);
  app.classList.remove('table-arriving');observer.classList.remove('table-arriving');
  if(arriving){
    entry.querySelector('strong').textContent=inSpectator?'观战者正在进入星海':'文明正在进入星海';
    entry.querySelector('small').textContent=inSpectator?'正在同步全场信息与文明席位':'正在排列星系与文明席位';
    entry.hidden=false;entry.classList.remove('leaving');void arriving.offsetWidth;arriving.classList.add('table-arriving');
    entryTimer=setTimeout(()=>{entry.classList.add('leaving');arriving.classList.remove('table-arriving');entryExitTimer=setTimeout(()=>{entry.hidden=true;entry.classList.remove('leaving');},360);},820);
  }else{entry.hidden=true;entry.classList.remove('leaving');}
  if(next!=='table')suspendTable();
  if(next!=='spectator')observerPlayback.stop();
  if(next!=='spectator'&&replayArchive){clearReplayTimer();replayPlaying=false;replayArchive=null;replayIndex=0;}
  window.scrollTo(0,0);
}
function renderFriendsRoute(){
  shell(`<div class="panel-topline"><span class="eyebrow">ACCOUNT / FRIENDS</span><button class="portal-link" id="friends-back">← 账号主页</button></div><h2>好友</h2>${social.friendsContent()}`,{wide:true,title:'联系人，\n在此相遇。',subtitle:'按账号 ID 搜索好友，管理申请与房间邀请。'});
  social.bindFriendsPage({onBack:()=>show('account')});
}
function replayDate(value){try{return new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}catch{return '时间未知';}}
function renderReplayList(items=[]){
  if(screen!=='replays')return;
  const host=$('#replay-list');if(!host)return;
  host.innerHTML=items.length?items.map(item=>`<article class="replay-list-item"><div class="replay-list-info"><b>${esc(item.name)}</b><small>${replayDate(item.finishedAt)} · ${esc(item.rounds)} 轮 · ${esc(item.players?.map(p=>p.name).join('、')||'文明未知')}</small></div><div class="replay-list-actions"><button class="secondary-btn" data-download-replay="${esc(item.matchId)}">下载</button><button class="primary-btn" data-open-replay="${esc(item.matchId)}">观看</button></div></article>`).join(''):'<p class="replay-empty">还没有已完成的对局回放。参与或观战的在线对局结束后，系统会自动保存最近 5 局。</p>';
  host.querySelectorAll('[data-open-replay]').forEach(button=>button.onclick=()=>task(async()=>{const data=await api('/replays/'+button.dataset.openReplay);startReplay(data.replay);}));
  host.querySelectorAll('[data-download-replay]').forEach(button=>button.onclick=()=>task(async()=>{const data=await api('/replays/'+button.dataset.downloadReplay);downloadReplay(data.replay);}));
}
async function loadReplayList(){
  try{const data=await api('/replays');renderReplayList(data.replays||[]);}
  catch(error){if(screen==='replays'){$('#replay-list').innerHTML=`<p class="replay-empty">${esc(error.message)}</p>`;}}
}
function downloadReplay(replay){
  const blob=new Blob([JSON.stringify(replay,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  const finished=new Date(Number(replay.finishedAt||replay.startedAt)||Date.now()),date=[finished.getFullYear(),String(finished.getMonth()+1).padStart(2,'0'),String(finished.getDate()).padStart(2,'0')].join('-');
  const accountName=String(social.account?.name||'观测者').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').trim().replace(/[. ]+$/,'')||'观测者';
  link.href=url;link.download=`黑暗森林-${date}-${accountName}-回放.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function renderReplaysRoute(){
  shell(`<div class="panel-topline"><span class="eyebrow">ACCOUNT / REPLAYS</span><button class="portal-link" id="replays-back">← 账号主页</button></div><h2>对局回放</h2><p>最近完成的 5 局会自动保存。回放可播放、逐步查看，也可下载后留存。</p><section class="replay-page"><div class="replay-page-heading"><b>已保存回放</b><small>本人参与或观战的在线对局</small></div><div id="replay-list" class="replay-list"><p class="replay-empty">正在读取回放…</p></div><div class="replay-import"><div><b>打开本地回放</b><small>选择之前下载的 JSON 回放文件</small></div><label class="secondary-btn" for="replay-file">选择文件</label><input id="replay-file" type="file" accept="application/json,.json" hidden></div><div id="replay-error" class="portal-error" role="status"></div></section>`,{wide:true,title:'重看每一步，\n记下星海回声。',subtitle:'所有公开行动、结算与星系变化，都按牌局顺序收录。'});
  $('#replays-back').onclick=()=>show('account');
  $('#replay-file').onchange=async event=>{const file=event.target.files?.[0];if(!file)return;try{if(file.size>20*1024*1024)throw Error('回放文件超过 20 MB');const archive=JSON.parse(await file.text());validateReplayArchive(archive);startReplay(archive);}catch(error){$('#replay-error').textContent=error.message||'回放文件无法读取';}finally{event.target.value='';}};
  void loadReplayList();
}
function replayView(index){
  const frame=replayArchive.frames[index],game=structuredClone(frame.game);game.publicEvents=replayArchive.events.slice(0,frame.eventCount);game.motionBatches=frame.game.motionBatches||[];
  return{id:'replay:'+replayArchive.matchId,name:replayArchive.name||'黑暗森林回放',role:'spectator',isReplay:true,revision:index+1,game};
}
function clearReplayTimer(){clearTimeout(replayTimer);replayTimer=null;}
function scheduleReplay(){
  clearReplayTimer();if(!replayPlaying||screen!=='spectator'||!replayArchive)return;
  const waitForAnimation=()=>{if(!replayPlaying||screen!=='spectator'||!replayArchive)return;if(observerPlayback.busy){replayTimer=setTimeout(waitForAnimation,100);return;}replayTimer=setTimeout(advance,3000);};
  const advance=()=>{if(!replayPlaying||screen!=='spectator'||!replayArchive)return;if(observerPlayback.busy){waitForAnimation();return;}if(replayIndex>=replayArchive.frames.length-1){replayPlaying=false;renderSpectator(replayView(replayIndex));return;}replayIndex++;observerPlayback.enqueue(replayView(replayIndex));waitForAnimation();};
  waitForAnimation();
}
function setReplayIndex(index,{animate=false}={}){
  replayIndex=Math.max(0,Math.min(replayArchive.frames.length-1,index));
  const view=replayView(replayIndex);if(animate)observerPlayback.enqueue(view);else observerPlayback.reset(view);
  if(replayPlaying)scheduleReplay();else clearReplayTimer();
}
const replayToggleIcon=playing=>playing
  ?'<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5 4h4v12H5zM11 4h4v12h-4z"/></svg>'
  :'<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M6 3.5 16 10 6 16.5z"/></svg>';
function startReplay(archive){
  validateReplayArchive(archive);clearReplayTimer();observerPlayback.stop();replayArchive=sanitizeReplayArchive(archive);replayIndex=0;replayPlaying=true;setScreen('spectator');observerPlayback.reset(replayView(0));scheduleReplay();
}
function leaveReplay(){clearReplayTimer();replayPlaying=false;replayArchive=null;replayIndex=0;observerPlayback.stop();show('replays');}
function bindReplayControls(){
  if(!replayArchive)return;
  const root=$('#spectator-app'),play=root.querySelector('#replay-toggle'),back=root.querySelector('#replay-back-step'),forward=root.querySelector('#replay-forward-step'),input=root.querySelector('#replay-round'),jump=root.querySelector('#replay-jump');
  if(!play)return;
  play.innerHTML=replayToggleIcon(replayPlaying);play.setAttribute('aria-label',replayPlaying?'暂停回放':'继续播放回放');play.setAttribute('aria-pressed',String(replayPlaying));
  if(input)input.value=String(replayArchive.frames[replayIndex].round||1);
  if(back)back.disabled=replayPlaying||replayIndex===0;if(forward)forward.disabled=replayPlaying||replayIndex>=replayArchive.frames.length-1;
  play.onclick=()=>{replayPlaying=!replayPlaying;if(replayPlaying)scheduleReplay();else clearReplayTimer();renderSpectator(replayView(replayIndex));};
  back.onclick=()=>setReplayIndex(replayIndex-1);forward.onclick=()=>setReplayIndex(replayIndex+1,{animate:true});
  const goToRound=()=>{const round=Math.max(1,Number(input.value)||1);let index=0;for(let i=0;i<replayArchive.frames.length;i++){if((replayArchive.frames[i].round||1)<=round)index=i;else break;}setReplayIndex(index);};
  jump.onclick=goToRound;input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();goToRound();}};
}
function show(next='home') {
  setScreen(next);
  if(next==='home') {
    shell(`<span class="eyebrow">WELCOME, OBSERVER</span><h2>进入黑暗森林</h2><p>每一个文明，都在等待你的下一步。</p><div class="menu-stack"><button class="menu-action primary" id="start-menu"><span><b>开始游戏</b><small>创建房间，或加入其他文明</small></span><span>↗</span></button><button class="menu-action" id="settings-menu"><span><b>游戏设置</b><small>Demo 试玩</small></span><span>⌘</span></button>${room?`<button class="portal-link" id="resume-room">返回 ${esc(room.name)} →</button>`:''}</div>`);
    $('#start-menu').onclick=()=>social.account?show('start'):social.login();$('#settings-menu').onclick=()=>show('settings');
    if($('#resume-room'))$('#resume-room').onclick=()=>openRoom(room);
  } else if(next==='account') {
    shell(`<div class="panel-topline"><span class="eyebrow">ACCOUNT / PROFILE</span><button class="portal-link" id="back">← 主菜单</button></div><h2>账号主页</h2>${social.accountContent()}`);
    $('#back').onclick=()=>show('home');social.bindAccountPage({onFriends:()=>show('friends'),onReplays:()=>show('replays')});
    $('#account-logout-page').onclick=()=>task(async()=>social.logout());
  } else if(next==='friends') {
    renderFriendsRoute();
  } else if(next==='replays') {
    renderReplaysRoute();
  } else if(next==='settings') {
    shell(`<div class="panel-topline"><span class="eyebrow">GAME SETTINGS</span><button class="portal-link" id="back">← 主菜单</button></div><h2>游戏设置</h2><section class="settings-demo"><h3>Demo 试玩</h3><p>同一设备接力操作，熟悉拖牌、广播、建设与打击。</p><button class="menu-action" id="try-demo"><span><b>进入 Demo</b><small>直接开始试玩</small></span><span>↗</span></button></section>`);
    $('#back').onclick=()=>show('home');
    $('#try-demo').onclick=()=>{setScreen('table');launchDemo();};
  } else if(next==='start') {
  shell(`<div class="panel-topline"><span class="eyebrow">PLAY ONLINE</span><button class="portal-link" id="back">← 主菜单</button></div><h2>选择一片森林</h2><p>与朋友联机，或让 AI 文明加入你的房间。</p><div class="menu-stack"><button class="menu-action primary" id="create-menu"><span><b>创建房间</b><small>成为房主，邀请朋友与 AI</small></span><span>＋</span></button><button class="menu-action" id="join-menu"><span><b>加入房间</b><small>输入 6 位房间码</small></span><span>↗</span></button></div>`);
    $('#back').onclick=()=>show('home');$('#create-menu').onclick=()=>show('create');$('#join-menu').onclick=()=>show('join');
  } else if(next==='create') {
    shell(`<div class="panel-topline"><span class="eyebrow">CREATE A ROOM</span><button class="portal-link" id="back">← 开始游戏</button></div><h2>创建房间</h2><p>最多 6 位文明。3 位玩家（含 AI）就能启程。</p><label class="portal-field"><span>房间名称</span><input id="room-name" maxlength="16" value="${esc(username)}的森林"></label><div class="portal-form-actions"><button class="primary-btn" id="create-room" data-busy>创建并进入 →</button></div>`);
    $('#back').onclick=()=>show('start');$('#create-room').onclick=()=>task(async()=>{const name=$('#room-name').value;if(room){await api('/rooms/'+room.id+'/leave',{});disconnect();room=null;}openRoom(await api('/rooms',{name,username}));});
  } else if(next==='join') {
    shell(`<div class="panel-topline"><span class="eyebrow">JOIN A ROOM</span><button class="portal-link" id="back">← 开始游戏</button></div><h2>加入房间</h2><p>向房主索取 6 位字母数字房间码。</p><form id="join-form"><label class="portal-field"><span>房间码</span><input id="join-code" maxlength="6" minlength="6" pattern="[A-Za-z0-9]{6}" placeholder="例如 A7K2P9" autocomplete="off" required style="text-transform:uppercase;letter-spacing:5px"></label><div class="portal-form-actions"><button class="primary-btn" data-busy>加入房间 →</button><button type="button" class="secondary-btn" id="watch-code" data-busy>进入观战席</button></div></form>`);
    $('#back').onclick=()=>show('start');$('#join-form').onsubmit=e=>{e.preventDefault();task(()=>joinByCode(false));};$('#watch-code').onclick=()=>task(()=>joinByCode(true));
  } else if(next==='room')renderRoom();
}
async function joinByCode(watch=false){
  if(!social.account)return social.login();
  const id=$('#join-code').value.trim().toUpperCase();if(!/^[A-Z0-9]{6}$/.test(id))throw Error('请输入 6 位字母数字房间码');
  if(room?.id===id&&room.role===(watch?'spectator':'player'))return openRoom(room);
  if(room){await api('/rooms/'+room.id+'/leave',{});disconnect();room=null;localStorage.removeItem('df_room');}
  openRoom(await api('/rooms/'+id+'/'+(watch?'watch':'join'),{username,requestId:requestId()}));
}
function renderRoom() {
  if(!room)return show('home');
  const watching=room.role==='spectator',spectators=room.spectators||[],spectatorCount=room.spectatorCount||0,finished=room.status==='finished';
  const seats=Array.from({length:6},(_,i)=>{
    const p=room.members[i];
    if(!p)return room.isHost
      ?`<button class="room-seat empty seat-add" data-add-friends aria-label="邀请好友加入空座位 ${i+1}"><span class="seat-mark">＋</span><div><strong>邀请好友</strong><small>空座位 ${i+1}</small></div></button>`
      :`<div class="room-seat empty"><span class="seat-mark">＋</span><div><strong>等待文明加入</strong><small>空座位 ${i+1}</small></div></div>`;
    return `<div class="room-seat"><span class="seat-mark">${p.bot?'AI':esc(p.name[0])}</span><div><strong>${esc(p.name)}</strong><small>${p.host?'房主 · ':''}${p.bot?(p.bot==='deepseek'?'DeepSeek Flash':'AI · '+levels[p.bot]+'难度'):i===room.me?'你':'真人玩家'}</small></div>${room.isHost&&i!==room.me?`<button data-remove="${i}" title="移除玩家" aria-label="移除${esc(p.name)}">×</button>`:''}</div>`;
  }).join('');
  const watcherList=spectators.length?`<div class="room-spectator-list" aria-label="当前观战玩家"><span class="room-spectator-list-title">正在观战 <small>${spectators.length}</small></span><div>${spectators.map(p=>`<span class="room-spectator-chip"><i></i>${esc(p.name)}${p.me?'<small>你</small>':''}</span>`).join('')}</div></div>`:'';
  const replaySetting=room.isHost?`<label class="room-record-setting"><input id="room-recording" type="checkbox" ${room.saveReplay!==false?'checked':''}><span><b>保存本局录像</b><small>完局后，参赛者和观战账号都可在账号主页查看，最近保留 5 局</small></span></label>`:`<div class="room-record-status"><b>本局录像</b><small id="room-record-status-text">${room.saveReplay===false?'房主已关闭保存':'本局将保存，观战账号也会收到回放'}</small></div>`;
  const aiPicker=Object.entries(levels).map(([key])=>`<button data-level="${key}" ${room.count>=6?'disabled':''}>＋ ${key==='deepseek'?'DeepSeek':'AI · '+AI_NAMES[key]}<small>${key==='easy'?'随机探索':key==='normal'?'发展与防御':key==='hard'?'推测坐标与规划':'DeepSeek Flash · 云端策略'}</small></button>`).join('');
  const hostTools=room.isHost?(finished?`${replaySetting}<button class="primary-btn room-start" id="rematch-room">再开一局 →</button>`:`<p>添加 AI 玩家</p><div class="ai-picker">${aiPicker}</div>${replaySetting}<button class="primary-btn room-start" id="start-room" ${room.count<3?'disabled':''}>${room.count<3?'还需要 '+(3-room.count)+' 位玩家':'开始游戏 →'}</button>`):`${replaySetting}<p class="portal-note">${finished?'对局已结束，等待房主开启下一局。':'等待房主添加玩家并开始游戏。'}</p>`;
  const seatKey=JSON.stringify({members:room.members,isHost:room.isHost,me:room.me});
  const hostStructureKey=JSON.stringify([room.isHost,finished]);
  const watcherKey=JSON.stringify({spectators,spectatorCount});
  if(!$('#room-page')){
    roomDOMState={};
    const page=`<div id="room-page"><div class="panel-topline"><span class="eyebrow" id="room-phase">${finished?'ROOM / FINISHED':'ROOM / WAITING'}</span><button class="portal-link" id="room-home">← 主菜单</button></div><h2 id="room-title">${esc(room.name)}</h2><div class="room-code">房间号 <b id="room-code">${room.id.toUpperCase()}</b></div><p class="portal-note" id="room-status"><i class="network-dot${connected?'':' offline'}"></i>${connected?'实时连接已建立':'正在连接…'} · ${room.count} / 6 人</p><div class="room-seats" id="room-seats"></div><div id="room-host-tools"></div><section class="watch-seat" id="room-watch-seat"><div><b>观战席</b><small id="room-watch-description">${watching?'你正在观战，不占玩家席位':spectatorCount?`${spectatorCount} 位观战者 · 不占玩家席位`:'观看全场信息，不占玩家席位'}</small></div><button class="room-watch" id="toggle-watch">${watching?'退出观战':'进入观战 →'}</button></section><div id="room-spectators"></div><button class="portal-link" id="leave-room">离开房间</button></div>`;
    shell(page,{wide:true,title:'等待，\n也是策略。',subtitle:'房主可加入汪淼、章北海、智子或 DeepSeek。\n达到 3 人即可开始，最多 6 人。'});
  }
  $('#room-phase').textContent=finished?'ROOM / FINISHED':'ROOM / WAITING';
  $('#room-title').textContent=room.name;
  $('#room-code').textContent=room.id.toUpperCase();
  $('#room-status').innerHTML=`<i class="network-dot${connected?'':' offline'}"></i>${connected?'实时连接已建立':'正在连接…'} · ${room.count} / 6 人`;
  if(roomDOMState.seatKey!==seatKey){$('#room-seats').innerHTML=seats;roomDOMState.seatKey=seatKey;}
  if(roomDOMState.hostStructureKey!==hostStructureKey){$('#room-host-tools').innerHTML=hostTools;roomDOMState.hostStructureKey=hostStructureKey;}
  else{
    $('#room-host-tools').querySelectorAll('[data-level]').forEach(button=>button.disabled=room.count>=6);
    const start=$('#start-room');if(start){start.disabled=room.count<3;start.textContent=room.count<3?'还需要 '+(3-room.count)+' 位玩家':'开始游戏 →';}
    const recording=$('#room-recording');if(recording)recording.checked=room.saveReplay!==false;
    const recordStatus=$('#room-record-status-text');if(recordStatus)recordStatus.textContent=room.saveReplay===false?'房主已关闭保存':'本局将保存，观战账号也会收到回放';
  }
  $('#room-watch-description').textContent=watching?'你正在观战，不占玩家席位':spectatorCount?`${spectatorCount} 位观战者 · 不占玩家席位`:'观看全场信息，不占玩家席位';
  $('#toggle-watch').textContent=watching?'退出观战':'进入观战 →';
  if(roomDOMState.watcherKey!==watcherKey){$('#room-spectators').innerHTML=watcherList;roomDOMState.watcherKey=watcherKey;}
  roomDOMState.seatKey=seatKey;roomDOMState.hostStructureKey=hostStructureKey;roomDOMState.watcherKey=watcherKey;
  $('#room-home').onclick=()=>show('home');
  $('#room-page').querySelectorAll('[data-add-friends]').forEach(button=>button.onclick=()=>social.invitePicker());
  $('#room-page').querySelectorAll('[data-level]').forEach(button=>button.onclick=()=>task(async()=>{room=await mutate('bot',{level:button.dataset.level});renderRoom();}));
  $('#room-page').querySelectorAll('[data-remove]').forEach(button=>button.onclick=()=>task(async()=>{room=await mutate('remove',{index:Number(button.dataset.remove)});renderRoom();}));
  if($('#room-recording'))$('#room-recording').onchange=()=>task(async()=>{const input=$('#room-recording'),before=room.saveReplay!==false;try{room=await mutate('recording',{enabled:input.checked});renderRoom();}catch(error){input.checked=before;throw error;}});
  if($('#start-room'))$('#start-room').onclick=()=>task(async()=>openRoom(await mutate('start')));
  if($('#rematch-room'))$('#rematch-room').onclick=()=>task(async()=>openRoom(await mutate('rematch')));
  $('#toggle-watch').onclick=()=>task(async()=>{if(room.role==='spectator')await leaveObserver();else openRoom(await mutate('watch',{username}));});
  $('#leave-room').onclick=()=>task(async()=>{await api('/rooms/'+room.id+'/leave',{});disconnect();room=null;localStorage.removeItem('df_room');show('start');});
}
async function mutate(op,body={}) {return api('/rooms/'+room.id+'/'+op,{...body,requestId:requestId()});}
const transport={
  connected:()=>connected,
  async send(action,revision) {
    const value=await mutate('action',{action,revision});room=value;roomRevision=Math.max(roomRevision,value.revision);return value;
  },
  home:()=>show('home'),
  async rematch(){const value=await mutate('rematch');openRoom(value);},
  openProfile:member=>member?.accountId?social.profile(member.accountId):null,
  reconnect:()=>connect()
};
function openRoom(value) {
  const changed=room?.id!==value.id;room=value;roomRevision=value.revision;
  localStorage.setItem('df_room',room.id);
  if(changed||!socket||socket.readyState>1)connect();
  spectatorRoomView=false;
  if(room.game&&room.role==='spectator') {setScreen('spectator');observerPlayback.reset(room);}
  else if(room.game) {setScreen('table');launchOnline(room,transport);}
  else {setScreen('room');renderRoom();}
}
function handleState(value) {
  if(replayArchive){if(room&&value.id!==room.id||value.revision<roomRevision)return;room=value;roomRevision=value.revision;return;}
  if(room&&value.id!==room.id||value.revision<roomRevision)return;
  room=value;roomRevision=value.revision;
  if(value.role==='spectator'){
    if(spectatorRoomView){if(screen==='room')renderRoom();}
    else if(value.game){
      if(screen==='spectator')observerPlayback.enqueue(value);
      else{setScreen('spectator');observerPlayback.reset(value);}
    }else{
      if(screen!=='room')setScreen('room');
      renderRoom();
    }
  } else if(screen==='spectator'){
    if(value.game){setScreen('table');launchOnline(value,transport);}else{setScreen('room');renderRoom();}
  } else if(screen==='room') {
    if(value.game){setScreen('table');launchOnline(value,transport);}else renderRoom();
  } else if(screen==='table') {
    if(!value.game){setScreen('room');renderRoom();}else receiveOnlineRoom(value);
  }
}
function disconnect(){clearTimeout(retry);clearInterval(heartbeat);if(socket){socket.onclose=null;socket.close();socket=null;}connected=false;}
function connect() {
  disconnect();if(!room)return;
  const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/api/rooms/'+room.id+'/ws');socket=ws;
  ws.onopen=()=>{connected=true;if(screen==='room')renderRoom();else if(screen==='spectator')observerPlayback.enqueue(room);updateConnection();heartbeat=setInterval(()=>{if(ws.readyState===1)ws.send('ping');},25000);};
  ws.onmessage=e=>{if(e.data==='pong')return;try{const message=JSON.parse(e.data);if(message.type==='state')handleState(message.room);else if(message.type==='removed'){disconnect();if(leaving)return;room=null;localStorage.removeItem('df_room');show('home');errorMessage(Error('你的座位已退出或被移除'));}}catch(error){console.error('同步失败',error.message);}};
  ws.onclose=()=>{connected=false;clearInterval(heartbeat);updateConnection();if(room)retry=setTimeout(connect,2500);};
  ws.onerror=()=>ws.close();
}
function updateConnection(){if(screen==='table'){const el=$('.top-status');el.innerHTML=`<span class="live-dot"></span>${connected?'在线房间 · 实时同步':'连接中断 · 正在重连'}`;}else if(screen==='spectator'&&!replayArchive){const el=$('.spectator-connect');if(el)el.textContent=connected?'实时同步':'连接中断 · 正在重连';}}

const observerColors=['#78b8f2','#e49a75','#91c995','#b6a0ef','#e3c66e','#e88dac'];
const observerPlayback=createSpectatorPlayback({render:renderSpectator,renderPlayer:observerPlayerForFlight,onError:error=>errorMessage(error)});
const social=createSocial({api,getRoom:()=>room,onJoin:openRoom,
  onPageUpdate:()=>{if(screen==='friends')renderFriendsRoute();},
  onAccount:async (account,afterAuth='start')=>{username=account.name;localStorage.setItem('df_name',username);localStorage.removeItem('df_room');room=null;disconnect();show(afterAuth);const state=await api('/social/state');if(state.currentRoom)try{openRoom(await api('/rooms/'+state.currentRoom));}catch{}},
  onLogout:clearAccount=>{disconnect();room=null;localStorage.removeItem('df_room');if(clearAccount!==false)show('home');}
});
document.addEventListener('click',e=>{
  if(replayArchive)return;
  const frame=e.target.closest('#spectator-app .observer-player');
  if(frame){const frames=[...document.querySelectorAll('#spectator-app .observer-player')],index=frames.indexOf(frame),member=room?.members[index];if(member?.accountId)social.profile(member.accountId);}
});

const galaxyName=id=>GALAXIES.find(g=>g.id===id)?.name||'未知星系';
const observerIcons={energy:'<path d="m10 1-7 9h5l-2 7 8-10H9z"/>',sun:'<circle cx="9" cy="9" r="3"/><path d="M9 0v3m0 12v3M0 9h3m12 0h3M3 3l2 2m8 8 2 2M3 15l2-2m8-8 2-2"/>',shield:'<path d="M9 1 2 4v5c0 4 7 8 7 8s7-4 7-8V4z"/>'};
function observerIcon(name){return `<svg class="stat-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${observerIcons[name]}</svg>`;}
function observerBuildingHTML(p,game){
  const a=summarizeBuildings(p.builds,{starActive:!game.markers[p.galaxy]});
  const energy=(g,star)=>`<span class="building-stat energy-stat${star?' stellar-stat':''}${star&&g.inactive?' inactive':''}" data-observer-assets="${g.ids.join(' ')}" aria-label="${star?'恒星能源':'独立能源'}建设每回合 +${g.income}" title="${esc((g.names.join('、')||'尚无能源建设')+'；额外产能 +'+g.income+(star&&g.inactive?'（恒星已熄灭）':''))}">${observerIcon('energy')}<b>+${g.income}</b>${star?observerIcon('sun'):''}</span>`;
  return `<span class="public-assets"><span class="energy-pair">${a.independent.income?energy(a.independent,false):''}${a.stellar.income?energy(a.stellar,true):''}</span>${a.defense?`<span class="building-stat defense-stat" data-observer-assets="${a.defenseIds.join(' ')}" title="${esc(a.defenseNames.join('、'))}；最高防御等级 ${a.defense}">${observerIcon('shield')}<b>${a.defense}</b></span>`:''}${a.other.map(g=>`<span class="building-stat utility-stat" data-observer-assets="${g.ids.join(' ')}" title="${esc(CARDS[g.key].name)}">${esc(g.label)}${g.count>1?' ×'+g.count:''}</span>`).join('')}</span>`;
}
function observerColor(id,game){const index=game.players.findIndex(p=>p.id===id);return observerColors[Math.max(0,index)%observerColors.length];}
function observerPlayerHTML(p,game,strikesFor){
  const name=esc(p.name),color=observerColor(p.id,game),location=`${String(p.galaxy).padStart(2,'0')} · ${esc(galaxyName(p.galaxy))}`;
  const strikes=observerStrikesHTML(strikesFor(p.id),game,p.id);
  const hand=p.hand.map(c=>`<span class="observer-hand-card ${esc(c.type)}" data-observer-card="${esc(c.id)}" style="--hand-card-color:${c.color||({build:'#75b2f7',broadcast:'#e7837f',strike:'#9cce8c'}[c.type]||'#9eafb5')}" title="${name} · ${esc(c.name)} · ◇ ${c.cost}${c.face?' · '+esc(c.face):''}"><b>${esc(c.name)}</b><small>◇ ${c.cost}${c.face?' · '+esc(c.face):''}${c.level!==undefined?' · 等级 '+(c.level===Infinity?'∞':esc(c.level)):c.range!==undefined?' · 距离 '+(c.range===Infinity?'∞':esc(c.range)) : ''}</small></span>`).join('');
  return `<article class="player observer-player${p.alive?'':' eliminated'}${p.id===game.active&&!game.over?' current-turn':''}" style="--observer-color:${color}" data-observer-player="${p.id}"><span class="player-top"><span class="avatar">${esc(p.name[0])}</span><span class="player-name" title="${name}">${name}<small class="player-sub" title="${location}">${p.alive?'存续文明':'文明已消逝'} · ${location}</small></span><span class="player-counters"><span class="player-energy" aria-label="能量 ${p.energy}"><span class="energy-diamond">◇</span><span class="energy-number">${p.energy}</span></span><span class="public-hand-count" aria-label="手牌 ${p.hand.length} 张"><i class="hand-card-symbol" aria-hidden="true"></i>${p.hand.length}</span></span></span>${observerBuildingHTML(p,game)}<span class="player-strikes">${strikes}</span><span class="observer-hand-row" data-observer-hand="${p.id}" aria-label="${name}的全部手牌">${hand||'<small>没有手牌</small>'}</span></article>`;
}
function observerStrikesHTML(strikes,game,playerId){return strikes.map(s=>{const mine=s.owner===playerId,target=`${String(s.target).padStart(2,'0')} · ${esc(galaxyName(s.target))}`;return `<span class="asset-chip strike observer-strike-chip${mine?' outgoing':' incoming'}" data-observer-strike="${esc(s.id)}" title="${mine?'发出打击':'来袭打击'} · 目标 ${target}">${mine?'↗':'←'} ${esc(s.card.name)} ${s.progress}/${s.required} · ${target}</span>`;}).join('');}
function observerPlayerForFlight(p,game,strikesFor){return observerPlayerHTML(p,game,strikesFor);}
function observerLatestCaption(latest){
  if(latest.kind==='build')return '建设完成';
  if(latest.kind==='discard')return '主动弃置完成';
  const title=latest.kind==='broadcast'?'广播':'打击',target=galaxyName(latest.target);
  const result=latest.cards.some(c=>c.role==='发射')?'飞行中':({locked:'科技锁死已生效',eliminated:'目标文明已消逝',survived:'目标文明防御成功',escaped:'目标文明已跃迁',miss:'已抵达目标星系',hit:'星系状态已改变'})[latest.outcome]||(latest.revealed?'已结算':'等待回应');
  return `${title} · ${target} · ${result}`;
}
function renderSpectator(view=room){
  const room=view;
  const root=$('#spectator-app');if(!root||!room||(room.role!=='spectator'&&!room.isReplay))return;
  if(!room.game){if(!room.isReplay){setScreen('room');renderRoom();}return;}
  const game=room.game,byId=id=>game.players.find(p=>p.id===id),strikesFor=id=>game.strikes.filter(s=>s.owner===id);
  if(!game.over){observerEndPromptDismissed=false;observerReplaySaveError='';}
  const observerEndActions=observerReplaySaveError
    ?'<button class="primary-btn" id="observer-end-retry">重试</button>'
    :'<button class="secondary-btn" id="observer-end-exit">退出</button><button class="primary-btn" id="observer-end-room">返回房间</button>';
  const observerEndPrompt=game.over&&!room.isReplay&&!observerEndPromptDismissed?`<div class="observer-end-overlay"><section class="observer-end-dialog" role="dialog" aria-modal="true" aria-labelledby="observer-end-title"><span class="eyebrow">THE FOREST FALLS SILENT</span><h2 id="observer-end-title">对局结束</h2><b class="observer-end-winner">${game.winner===null?'没有文明幸存':`${esc(byId(game.winner)?.name||'文明')} 成为终极文明`}</b><p>所有在飞打击已经结算。${room.saveReplay===false?'房主关闭了本局回放保存。':'退出会离开观战并返回主菜单；返回房间会保留观战席。'}</p><small class="observer-replay-save-error" id="observer-replay-save-error" role="alert" ${observerReplaySaveError?'':'hidden'}>${esc(observerReplaySaveError)}</small><div class="observer-replay-save-status" id="observer-replay-save-status" role="status" ${observerReplaySaving?'':'hidden'}><i></i><span>正在保存回放…</span></div><div class="observer-end-actions" id="observer-end-actions" ${observerReplaySaving?'hidden':''}>${observerEndActions}</div></section></div>`:'';
  const active=game.players[game.active];
  const actorName=id=>byId(id)?.name||'文明',eventNames={build:'建设',broadcast_published:'广播发布',broadcast_settled:'广播结算',broadcast:'广播',launch:'打击发射',impact:'打击抵达',lock:'科技锁死',discard:'弃牌',damage:'建筑损失',escaped:'光速跃迁',eliminated:'文明消逝',production:'能量生产',system_hit:'星系受损',miss:'打击落空',withdraw:'撤回打击',gameover:'对局结束'};
  const eventColors={build:'#75b2f7',broadcast_published:'#e7837f',broadcast_settled:'#c995d9',broadcast:'#e7837f',launch:'#9cce8c',impact:'#9cce8c',lock:'#c995d9',discard:'#aab5c3',damage:'#e48b7d',escaped:'#ba8cf2',eliminated:'#aab0b8',production:'#c7d9a1',system_hit:'#e48b7d',miss:'#aab5c3',withdraw:'#aab5c3',gameover:'#d1dfad'};
  const eventLine=e=>{
    const actor=byId(e.actor??e.player??e.owner),target=galaxyName(e.target),who=actor?.name||'文明';
    if(e.type==='build')return `${who} 建设「${e.cardName||'建设牌'}」→ ${target} · 费用 ${e.cost} · ${CARDS[e.key]?.rule||''}`;
    if(e.type==='broadcast_published')return `${who} 发布「${e.cardName||'广播'}」→ ${target} · 等待回应`;
    if(e.type==='broadcast_settled')return `${who} 的广播完成结算 → ${target}`;
    if(e.type==='broadcast')return `${who} · ${e.cardName||'广播'}${e.role?' · '+e.role:''} → ${target}`;
    if(e.type==='launch')return `${who} 发射「${e.cardName||'打击'}」→ ${target} · 费用 ${e.cost} · 飞行中`;
    if(e.type==='impact')return `${who} 的「${e.cardName||'打击'}」抵达 ${target} · ${({survived:'防御成功',eliminated:'文明消逝',escaped:'目标跃迁',hit:'星系受损',miss:'未命中'})[e.outcome]||'已结算'}${e.victim!==undefined&&e.victim!==null?' · 目标 '+actorName(e.victim):''} · 已飞 ${e.progress} 回合`;
    if(e.type==='lock')return `${who} 使用「${e.cardName||'科技锁死'}」→ ${target}${e.victim!==null&&e.victim!==undefined?' · '+actorName(e.victim)+' 建设被拆除':''}${e.removed?.length?' · 拆除 '+e.removed.map(c=>c.cardName).join('、'):''} · 返还 ${e.refund||0} 能量`;
    if(e.type==='discard')return `${who} 弃置 ${e.cards?.map(c=>c.cardName).join('、')||'手牌'}并补牌`;
    if(e.type==='damage')return `${who} 在 ${target} 损失建设：${e.cards?.map(c=>c.cardName).join('、')||'无'} · ${e.effect==='star_discard'?'恒星熄灭':'打击摧毁'}`;
    if(e.type==='escaped')return `${who} 使用光速飞船，从 ${galaxyName(e.from)} 跃迁至 ${galaxyName(e.to??actor?.galaxy)}`;
    if(e.type==='eliminated')return `${who} 的文明已消逝`;
    if(e.type==='production')return `${who} 回合生产 +${e.gain} 能量`;
    if(e.type==='system_hit')return `${who} 的「${e.cardName||'打击'}」抵达 ${target} · ${e.key==='dimension'?'星系被降维':'恒星熄灭'}`;
    if(e.type==='miss')return `${who} 的「${e.cardName||'打击'}」抵达 ${target} · 没有文明受击`;
    if(e.type==='withdraw')return `${who} 撤回了一枚尚未抵达的打击`;
    if(e.type==='gameover')return e.winner===null?'对局结束 · 无文明幸存':`${actorName(e.winner)} 获胜`;
    return `${who} · ${e.type}`;
  };
  const eventDetails=e=>{
    if(e.type!=='broadcast_settled')return '';
    const cards=(e.cards||[]).map(c=>{
      const role=c.role==='发布'?'发布':c.role==='未采纳'?'未采纳回应':'采纳回应';
      return `<div class="broadcast-card-row"><b class="broadcast-role">${role}</b><span class="broadcast-player" style="--participant-color:${observerColor(c.actor,game)}">${esc(actorName(c.actor))}</span><span class="broadcast-card-name">${esc(c.cardName||'广播牌')}</span><small>${esc(c.face||'牌面未知')} · 能量费用 ◇${esc(c.cost??0)}</small></div>`;
    }).join('');
    const energy=(e.energyChanges||[]).map(c=>({name:actorName(c.player),delta:c.after-c.before})).filter(c=>c.delta!==0);
    const result=e.selected===null||e.selected===undefined?'无人回应':`采纳 ${actorName(e.selected)} 的回应`;
    const energyLine=energy.length?energy.map(c=>`${c.name} ${c.delta>0?'+':''}${c.delta}`).join('　·　'):'本次能量无变化';
    return `<div class="broadcast-settlement-details"><div class="broadcast-card-list">${cards||'<div class="broadcast-card-row">没有回应牌</div>'}</div><div class="broadcast-settlement-result"><b>${esc(result)}</b><span>能量结算：${esc(energyLine)}</span></div></div>`;
  };
  const rosterScroll=root.querySelector('.observer-roster')?.scrollLeft||0;
  const seatScroll=new Map([...root.querySelectorAll('[data-observer-player]')].map(seat=>[seat.dataset.observerPlayer,{assets:seat.querySelector('.public-assets')?.scrollLeft||0,strikes:seat.querySelector('.player-strikes')?.scrollLeft||0,hand:seat.querySelector('.observer-hand-row')?.scrollTop||0}]));
  const priorLog=root.querySelector('.observer-history-list');
  let historyAnchor=null;
  if(priorLog&&priorLog.scrollTop>1){
    const listRect=priorLog.getBoundingClientRect(),visible=[...priorLog.querySelectorAll('[data-event-key]')].find(row=>row.getBoundingClientRect().bottom>listRect.top+1);
    historyAnchor=visible?{key:visible.dataset.eventKey,offset:visible.getBoundingClientRect().top-listRect.top}:{scrollTop:priorLog.scrollTop};
  }
  const hashEvent=text=>{let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(36);};
  const occurrences=new Map();
  const eventList=room.isReplay?(game.publicEvents||[]):(game.publicEvents||[]).slice(-60);
  const events=eventList.map(event=>{const signature=JSON.stringify(event),index=occurrences.get(signature)||0;occurrences.set(signature,index+1);return{event,key:`${hashEvent(signature)}-${index}`};}).reverse();
  const split=Math.ceil(game.players.length/2),left=game.players.slice(0,split),right=game.players.slice(split);
  const playerColumn=(players,side)=>`<aside class="observer-player-column ${side}">${players.map(p=>observerPlayerHTML(p,game,strikesFor)).join('')}</aside>`;
  const replayControls=room.isReplay?`<div class="observer-replay-controls" aria-label="回放控制"><button id="replay-back-step" type="button" aria-label="回溯一步">←</button><button id="replay-toggle" type="button" aria-label="${replayPlaying?'暂停回放':'继续播放回放'}" aria-pressed="${replayPlaying}">${replayToggleIcon(replayPlaying)}</button><button id="replay-forward-step" type="button" aria-label="前进一步">→</button><label>第 <input id="replay-round" type="number" min="1" max="${Math.max(1,replayArchive?.rounds||game.round)}" value="${game.round}"> 轮</label><button id="replay-jump" type="button">跳转</button><small>${replayIndex+1} / ${replayArchive?.frames.length||1}</small></div>`:'';
  root.innerHTML=`<header class="observer-header"><div class="brand" aria-label="黑暗森林"><span class="brand-mark">◉</span><span><b>黑暗森林</b><small>THE DARK FOREST</small></span></div><div class="top-status"><span class="live-dot"></span>${room.isReplay?'对局回放':'在线房间'}<span class="status-separator"></span><span class="spectator-connect">${room.isReplay?'本地播放':connected?'实时同步':'连接中…'}</span></div><nav><button class="quiet-btn observer-exit" id="observer-exit">${room.isReplay?'退出回放':'退出观战'}</button></nav></header><div class="observer-room-toolbar${room.isReplay?' is-replay':''}"><div class="room-title"><span class="section-index">01 /</span><h1>${esc(room.name)}</h1><span class="pill">${room.isReplay?'回放':'在线房间'}</span></div>${replayControls}<div class="round-info"><span>第 ${String(game.round).padStart(2,'0')} 轮</span><span class="toolbar-divider"></span><b>${game.over?'对局结束':active?esc(active.name)+' 的回合':'状态同步中'}</b><span class="tiny-dot"></span>${game.pending?.kind==='broadcast'?`<small>广播回应中 · ${esc(galaxyName(game.pending.target))}</small>`:game.pending?.kind==='escape'?'<small>光速飞船逃生决策中</small>':''}</div></div>
    <main class="observer-table-layout"><div class="observer-roster" aria-label="玩家列表，可横向滑动">${playerColumn(left,'left')}${playerColumn(right,'right')}</div><section class="observer-center-column"><section class="observer-map-panel"><div class="observer-section-heading"><span>星图</span><small>公开坐标与星系状态</small></div><svg id="observer-map" viewBox="0 0 900 430" role="img" aria-label="显示全场玩家位置和打击目标的星图"></svg></section><div class="observer-playback-anchor"></div><section class="observer-history"><div class="observer-section-heading"><span>公开时间记录</span><small>${room.isReplay?'完整记录':'最近 '+events.length+' / '+(game.publicEvents?.length||0)+' 条'} · 抽牌堆 ${game.deckCount} · 弃牌堆 ${game.discardCount}</small></div>${events.length?`<div class="observer-history-list">${events.map(({event:e,key})=>`<div class="event-row event-${esc(e.type)}" data-event-key="${key}" style="--event-color:${eventColors[e.type]||'#aab5c3'}"><i></i><b class="event-tag">${e.round?`第 ${esc(e.round)} 轮 · `:''}${esc(eventNames[e.type]||'事件')}</b><div class="event-content"><span class="event-summary">${esc(eventLine(e))}</span>${eventDetails(e)}</div></div>`).join('')}</div>`:'<p>尚无公开事件。</p>'}</section></section></main>`;
  const roster=root.querySelector('.observer-roster');if(roster)roster.scrollLeft=rosterScroll;
  for(const seat of root.querySelectorAll('[data-observer-player]')){const saved=seatScroll.get(seat.dataset.observerPlayer);if(!saved)continue;const assets=seat.querySelector('.public-assets'),strikes=seat.querySelector('.player-strikes'),hand=seat.querySelector('.observer-hand-row');if(assets)assets.scrollLeft=saved.assets;if(strikes)strikes.scrollLeft=saved.strikes;if(hand)hand.scrollTop=saved.hand;}
  if(observerEndPrompt)root.insertAdjacentHTML('beforeend',observerEndPrompt);
  root.insertAdjacentHTML('afterbegin','<div id="observer-error" class="observer-error" role="status"></div>');
  root.querySelector('.observer-map-panel .observer-section-heading small').textContent=`全员位置 · 抽牌堆 ${game.deckCount} · 弃牌堆 ${game.discardCount}`;
  const updatedLog=root.querySelector('.observer-history-list');
  if(updatedLog&&historyAnchor){
    const anchor=historyAnchor.key&&[...updatedLog.querySelectorAll('[data-event-key]')].find(row=>row.dataset.eventKey===historyAnchor.key);
    if(anchor){const newOffset=anchor.getBoundingClientRect().top-updatedLog.getBoundingClientRect().top;updatedLog.scrollTop+=newOffset-historyAnchor.offset;}
    else if(historyAnchor.scrollTop!==undefined)updatedLog.scrollTop=historyAnchor.scrollTop;
  }
  drawObserverMap(game);
  observerPlayback.mount(root,room);
  root.querySelector('#observer-exit').onclick=()=>room.isReplay?leaveReplay():task(async()=>leaveObserver());
  if(root.querySelector('#observer-end-exit'))root.querySelector('#observer-end-exit').onclick=()=>task(()=>finishObserverGame('exit',root));
  if(root.querySelector('#observer-end-room'))root.querySelector('#observer-end-room').onclick=()=>task(()=>finishObserverGame('room',root));
  if(root.querySelector('#observer-end-retry'))root.querySelector('#observer-end-retry').onclick=()=>task(()=>finishObserverGame(observerReplayRetryDestination,root));
  if(room.isReplay)bindReplayControls();
}
async function finishObserverGame(destination,root){
  if(observerReplaySaving)return;
  observerReplayRetryDestination=destination;
  const updateButtons=()=>{
    const exit=root.querySelector('#observer-end-exit'),back=root.querySelector('#observer-end-room'),retry=root.querySelector('#observer-end-retry'),error=root.querySelector('#observer-replay-save-error'),status=root.querySelector('#observer-replay-save-status'),actions=root.querySelector('#observer-end-actions');
    if(error){error.textContent=observerReplaySaveError;error.hidden=!observerReplaySaveError;}
    if(status)status.hidden=!observerReplaySaving;
    if(actions)actions.hidden=observerReplaySaving;
    if(exit){exit.hidden=Boolean(observerReplaySaveError);exit.disabled=observerReplaySaving;}
    if(back){back.hidden=Boolean(observerReplaySaveError);back.disabled=observerReplaySaving;}
    if(retry){retry.hidden=!observerReplaySaveError;retry.disabled=observerReplaySaving;}
  };
  if(room.saveReplay!==false){
    observerReplaySaving=true;observerReplaySaveError='';updateButtons();
    try{
      const saved=await api(`/rooms/${encodeURIComponent(room.id)}/replay-save`,{});
      observerSaveToast(saved.saved>1?`回放已保存到 ${saved.saved} 个账号`:'回放已保存到账号主页');
    }catch(error){observerReplaySaveError=`回放保存失败：${error.message}。点击“重试”继续。`;return;}
    finally{observerReplaySaving=false;updateButtons();}
  }else observerSaveToast('房主已关闭本局回放保存');
  observerEndPromptDismissed=true;root.querySelector('.observer-end-overlay')?.remove();
  if(destination==='exit')await leaveObserver();
  else{spectatorRoomView=true;setScreen('room');renderRoom();}
}
function drawObserverMap(game){
  const svg=$('#observer-map');if(!svg)return;
  const byGalaxy=new Map();for(const [i,p] of game.players.entries()){if(!p.alive||!p.galaxy)continue;if(!byGalaxy.has(p.galaxy))byGalaxy.set(p.galaxy,[]);byGalaxy.get(p.galaxy).push({p,i});}
  svg.innerHTML=`<defs><radialGradient id="observerGlow"><stop stop-color="#9ebc97" stop-opacity=".16"/><stop offset="1" stop-color="#9ebc97" stop-opacity="0"/></radialGradient></defs><circle cx="504" cy="215" r="190" fill="url(#observerGlow)"/>${EDGES.map(([a,b])=>{const x=GALAXIES[a-1],y=GALAXIES[b-1];return `<line class="map-route" x1="${x.x}" y1="${x.y}" x2="${y.x}" y2="${y.y}"/>`}).join('')}${GALAXIES.map(g=>{const marker=game.markers[g.id],players=byGalaxy.get(g.id)||[],broadcast=game.pending?.kind==='broadcast'&&game.pending.target===g.id,incoming=game.strikes.filter(s=>s.target===g.id);return `<g class="system${marker?` marker-${marker}`:''}${marker==='gray'?' destroyed':''}${broadcast?' broadcast-target':''}${incoming.length?' incoming-strike-target':''}" data-observer-galaxy="${g.id}" transform="translate(${g.x},${g.y})">${broadcast?'<circle class="broadcast-ring" r="48"/>':''}${incoming.length?'<circle class="incoming-strike-ring" r="36"/>':''}<circle class="outer-orbit" r="39"/><circle class="orbit" r="25"/><circle class="core" r="4"/><text class="system-id" x="34" y="4">${String(g.id).padStart(2,'0')}</text><text class="system-name" text-anchor="middle" y="49">${esc(g.name)}</text>${incoming.length?`<text class="incoming-strike-name" text-anchor="middle" y="66">${esc(incoming.map(s=>s.card.name).join(' · '))}</text>`:''}${players.map(({p},j)=>`<circle class="observer-location-ring" cx="0" cy="0" r="${32+j*8}" style="--observer-color:${observerColor(p.id,game)}"/>`).join('')}</g>`}).join('')}`;
}
async function leaveObserver(){
  spectatorRoomView=false;const id=room.id;leaving=true;
  try{
    try{await api('/rooms/'+id+'/leave',{requestId:requestId()});}
    catch(error){
      if(error.status!==403&&error.status!==404)throw error;
      try{await api('/rooms/'+id);}catch(check){if(check.status===403||check.status===404){disconnect();room=null;localStorage.removeItem('df_room');show('home');return;}throw check;}
      throw error;
    }
    disconnect();room=null;localStorage.removeItem('df_room');show('home');
  }
  finally{leaving=false;}
}
document.addEventListener('portal:home',()=>show('home'));
document.addEventListener('portal:exit',()=>task(async()=>{if(!room){show('home');return;}const id=room.id;leaving=true;try{await api('/rooms/'+id+'/leave',{requestId:requestId()});disconnect();room=null;localStorage.removeItem('df_room');show('home');}catch(error){leaving=false;throw error;}finally{leaving=false;}}));
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&room&&!replayArchive)api('/rooms/'+room.id).then(handleState).catch(()=>{});});
show('home');
sessionReady.then(async result=>{
  social.init(result.account);if(result.account){username=result.account.name;localStorage.setItem('df_name',username);if(screen==='home'||screen==='settings'||screen==='account'||screen==='friends')show(screen);}
  let saved=localStorage.getItem('df_room');
  if(result.account&&!saved){const state=await api('/social/state');saved=state.currentRoom;}
  if(result.account&&saved&&/^(?:[A-Z0-9]{6}|[a-f0-9]{8})$/.test(saved))try{openRoom(await api('/rooms/'+saved));}catch{localStorage.removeItem('df_room');}
}).catch(()=>{});
