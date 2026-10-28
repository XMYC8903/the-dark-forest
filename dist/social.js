const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={online:'在线',offline:'离线',playing:'对局中',spectating:'观战中'};
const statusOrder={online:0,playing:1,spectating:2,offline:3};
const presence=status=>status==='spectating'?`<svg class="presence-eye" viewBox="0 0 20 14" aria-hidden="true"><path d="M1 7s3.1-5.2 9-5.2S19 7 19 7s-3.1 5.2-9 5.2S1 7 1 7Z"/><circle cx="10" cy="7" r="2.5"/><circle class="eye-pupil" cx="10" cy="7" r="1"/></svg>`:`<i class="presence-dot ${status}" aria-hidden="true"></i>`;
export function createSocial({api,getRoom,onJoin,onAccount,onLogout,onPageUpdate}){
  let account=null,data={friends:[],requests:[],invites:[]},page='',busy=false,timer=null,searchResult=null;
  const dialog=document.createElement('dialog');dialog.id='social-dialog';document.body.append(dialog);
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
  function shell(title,content){
    dialog.innerHTML=`<header><div><small>THE DARK FOREST / ACCOUNT</small><h2>${title}</h2></div><button class="social-close" aria-label="关闭">×</button></header>${content}<p class="social-error" role="status"></p>`;
    dialog.querySelector('.social-close').onclick=()=>dialog.close();if(!dialog.open)dialog.showModal();
  }
  async function run(fn){if(busy)return;busy=true;dialog.querySelector('.social-error')?.replaceChildren();dialog.querySelectorAll('[data-submit]').forEach(b=>b.disabled=true);try{await fn();}catch(e){const el=dialog.querySelector('.social-error');if(el)el.textContent=e.message;}finally{busy=false;dialog.querySelectorAll('[data-submit]').forEach(b=>b.disabled=false);}}
  function login(register=false,afterAuth='start'){
    page=register?'register':'login';
    shell(register?'创建账号':'登录账号',`<p class="social-note">${register?'创建后将获得固定的 8 位账号 ID。':'使用账号名和密码，在不同设备登录。'}</p><form id="auth-form"><label>账号名<input name="name" minlength="2" maxlength="16" autocomplete="username" required placeholder="2–16 个字符"></label><label>密码<input name="password" type="password" minlength="8" maxlength="128" autocomplete="${register?'new-password':'current-password'}" required placeholder="至少 8 个字符"></label>${register?'<label>确认密码<input name="confirm" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label>':''}<button class="primary-btn" data-submit>${register?'创建并登录':'登录'}</button></form><button class="social-text" id="auth-switch">${register?'已有账号？去登录':'还没有账号？创建一个'}</button>`);
    dialog.querySelector('#auth-switch').onclick=()=>login(!register,afterAuth);
    dialog.querySelector('form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.currentTarget);run(async()=>{
      if(register&&f.get('password')!==f.get('confirm'))throw Error('两次输入的密码不一致');
      const result=await api('/auth/'+(register?'register':'login'),{name:f.get('name'),password:f.get('password'),legacyRoom:localStorage.getItem('df_room')});
      dialog.querySelector('form').reset();account=result.account;data={friends:[],requests:[],invites:[]};dialog.close();await onAccount(account,afterAuth);await refresh();
    });};
  }
  async function refresh(){
    if(!account)return;
    try{const next=await api('/social/state'),changed=JSON.stringify(next)!==JSON.stringify(data);data=next;if(changed&&!busy&&page==='friends-route'&&document.activeElement?.tagName!=='INPUT')onPageUpdate?.();}
    catch(e){if(e.status===401){account=null;data={friends:[],requests:[],invites:[]};onLogout?.();}}
  }
  async function profile(id){
    if(!account)return login();page='profile';
    shell('账号信息','<p class="social-note">正在读取…</p>');
    await run(async()=>{
      const p=await api('/social/profile',{id});
      shell(esc(p.account.name),`<div class="account-id">账号 ID <b>${esc(p.account.id)}</b></div>${p.status?`<p class="friend-status ${p.status}">${labels[p.status]}</p>`:''}<p class="social-note">${({self:'这是你的账号',friend:'已是好友',sent:'好友申请已发送',received:'对方向你发来了好友申请',none:'添加好友后可查看在线状态与发送房间邀请'})[p.relationship]}</p>${p.relationship==='none'?'<button class="primary-btn" id="profile-request" data-submit>发送好友申请</button>':p.relationship==='received'?'<button class="primary-btn" id="profile-accept" data-submit>同意好友申请</button>':''}`);
      dialog.querySelector('#profile-request')?.addEventListener('click',()=>run(async()=>{await api('/social/request',{id:p.account.id});await refresh();dialog.querySelector('.social-note').textContent='好友申请已发送';dialog.querySelector('#profile-request').remove();}));
      dialog.querySelector('#profile-accept')?.addEventListener('click',()=>run(async()=>{await api('/social/respond',{id:p.account.id,accept:true});await refresh();profile(p.account.id);}));
    });
  }
  const sortedFriends=()=>[...data.friends].sort((a,b)=>(statusOrder[a.status]??4)-(statusOrder[b.status]??4)||a.name.localeCompare(b.name,'zh-CN'));
  const friendRows=({invite=false}={})=>sortedFriends().map(f=>`<article class="social-row"><div class="friend-person"><b>${esc(f.name)}</b><span class="presence ${f.status}">${presence(f.status)}<span>${labels[f.status]}</span></span></div>${invite?`<button class="friend-action invite${f.status==='online'?'':' disabled'}" data-picker-invite="${f.id}" ${f.status!=='online'?'disabled':''}>邀请</button>`:`<button class="friend-action remove" data-remove-friend="${f.id}">删除好友</button>`}</article>`).join('')||'<p class="social-empty">还没有好友，搜索账号 ID 添加。</p>';
  function accountContent(){return `<section class="account-home"><div class="account-home-identity"><i>${esc(account?.name?.[0]||'◉')}</i><div><b>${esc(account?.name||'')}</b><small>账号 ID · ${esc(account?.id||'')}</small></div></div><div class="account-home-links"><button class="menu-action primary" id="account-open-friends"><span><b>好友</b><small>${data.friends.length} 位好友${data.requests.some(r=>r.incoming)?' · 有待处理申请':''}</small></span><span>→</span></button><button class="menu-action" id="account-open-replays"><span><b>对局回放</b><small>浏览、下载或导入对局</small></span><span>→</span></button></div><button class="account-logout-page" id="account-logout-page">退出登录</button></section>`;}
  function bindAccountPage({onFriends,onReplays}){page='account-route';document.querySelector('#account-open-friends').onclick=onFriends;document.querySelector('#account-open-replays').onclick=onReplays;}
  function friendsContent(){
    const requests=data.requests.filter(r=>r.incoming),sent=data.requests.filter(r=>!r.incoming);
    return `<section class="friends-page"><form id="friend-search" class="friend-search"><input aria-label="搜索账号 ID" name="id" maxlength="8" minlength="8" required placeholder="搜索 8 位账号 ID"><button type="submit">搜索</button></form>${searchResult?`<article class="friend-search-result"><div><b>${esc(searchResult.account.name)}</b><small>ID · ${esc(searchResult.account.id)}</small></div>${searchResult.relationship==='none'?`<button class="friend-action invite" id="send-friend-request">发送申请</button>`:searchResult.relationship==='received'?`<button class="friend-action invite" id="accept-search-request">同意申请</button>`:`<span class="search-result-note">${({self:'本人',friend:'已是好友',sent:'已发送申请'})[searchResult.relationship]||''}</span>`}</article>`:''}${requests.length?`<h3>好友申请</h3>${requests.map(r=>`<article class="social-row friend-request"><div class="friend-person"><b>${esc(r.name)}</b><small>ID · ${esc(r.id)}</small></div><button class="friend-action invite" data-friend-accept="${r.id}">同意</button><button class="friend-action decline" data-friend-decline="${r.id}">忽略</button></article>`).join('')}`:''}${data.invites.length?`<h3>房间邀请</h3>${data.invites.map(i=>`<article class="social-row friend-request"><div class="friend-person"><b>${esc(i.fromName)}</b><small>${esc(i.roomName)} · ${esc(i.room)}</small></div><button class="friend-action invite" data-invite-accept="${i.id}">加入</button><button class="friend-action decline" data-invite-decline="${i.id}">忽略</button></article>`).join('')}`:''}${sent.length?`<h3 class="pending-requests">已发送申请</h3>${sent.map(r=>`<article class="social-row friend-request"><div class="friend-person"><b>${esc(r.name)}</b><small>等待对方同意</small></div></article>`).join('')}`:''}<h3 class="friend-list-title">好友列表 <small>${data.friends.length}</small></h3><div class="friend-list">${friendRows()}</div></section>`;
  }
  function bindFriendsPage({onBack}){
    page='friends-route';document.querySelector('#friend-search').onsubmit=e=>{e.preventDefault();const id=new FormData(e.currentTarget).get('id').trim().toUpperCase();run(async()=>{searchResult=await api('/social/profile',{id});onPageUpdate?.();});};
    document.querySelector('#send-friend-request')?.addEventListener('click',()=>run(async()=>{await api('/social/request',{id:searchResult.account.id});searchResult={...searchResult,relationship:'sent'};onPageUpdate?.();}));
    document.querySelector('#accept-search-request')?.addEventListener('click',()=>run(async()=>{await api('/social/respond',{id:searchResult.account.id,accept:true});searchResult={...searchResult,relationship:'friend'};await refresh();onPageUpdate?.();}));
    document.querySelectorAll('[data-remove-friend]').forEach(b=>b.onclick=()=>run(async()=>{await api('/social/remove',{id:b.dataset.removeFriend});data.friends=data.friends.filter(f=>f.id!==b.dataset.removeFriend);onPageUpdate?.();}));
    for(const [selector,accept] of [['[data-friend-accept]',true],['[data-friend-decline]',false]])document.querySelectorAll(selector).forEach(b=>b.onclick=()=>run(async()=>{await api('/social/respond',{id:b.dataset[accept?'friendAccept':'friendDecline'],accept});await refresh();onPageUpdate?.();}));
    document.querySelectorAll('[data-invite-decline]').forEach(b=>b.onclick=()=>run(async()=>{await api('/social/invitation',{id:b.dataset.inviteDecline,accept:false});await refresh();onPageUpdate?.();}));
    document.querySelectorAll('[data-invite-accept]').forEach(b=>b.onclick=()=>run(async()=>{const invite=data.invites.find(i=>i.id===b.dataset.inviteAccept),old=getRoom();if(old&&old.id!==invite.room){await api('/rooms/'+old.id+'/leave',{});onLogout?.(false);}const value=await api('/social/invitation',{id:invite.id,accept:true});onJoin(value);await refresh();}));
    document.querySelector('#friends-back').onclick=onBack;
  }
  async function logout(){const old=getRoom();if(old)await api('/rooms/'+old.id+'/leave',{});await api('/auth/logout',{});account=null;data={friends:[],requests:[],invites:[]};searchResult=null;dialog.close();onLogout?.(true);}
  function invitePicker(){
    if(!account)return login();if(!getRoom()||getRoom().status!=='waiting'||getRoom().count>=6)return;
    page='invite-picker';shell('邀请好友加入',`<div class="invite-picker-list">${friendRows({invite:true})}</div>`);
    dialog.querySelectorAll('[data-picker-invite]').forEach(b=>b.onclick=()=>run(async()=>{await api('/social/invite',{id:b.dataset.pickerInvite,room:getRoom()?.id});b.textContent='已邀请';b.disabled=true;}));
  }
  timer=setInterval(refresh,8000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  return {login,profile,accountContent,bindAccountPage,friendsContent,bindFriendsPage,invitePicker,logout,get account(){return account;},get currentRoom(){return data.currentRoom;},init(a){account=a;if(a)refresh();},refresh};
}
