export const EVENT_FILTER_CATEGORIES=[
  ['build','建设'],['broadcast_published','广播发布'],['broadcast_settled','广播结算'],
  ['launch','打击发射'],['impact_hit','打击命中'],['defense','防御打击'],['miss','打击落空'],
  ['lock','科技锁死'],['escaped','光速跃迁'],['eliminated','文明消逝'],['energy','能量变化']
];

const historyEventTypes=new Set(['build','broadcast_published','broadcast_settled','broadcast','launch','impact','system_hit','damage','miss','lock','escaped','eliminated','production']);
export const NO_EVENT_TARGET='no_target';

export function observerEventCategories(event){
  const categories=new Set();
  if(['build','broadcast_published','broadcast_settled','launch','lock','escaped','eliminated'].includes(event.type))categories.add(event.type);
  if(event.type==='broadcast')categories.add('broadcast_published');
  if(event.type==='impact')categories.add(event.outcome==='survived'?'defense':event.outcome==='miss'||event.outcome==='hit'&&event.victim==null?'miss':'impact_hit');
  if(event.type==='damage')categories.add('impact_hit');
  if(['miss','system_hit'].includes(event.type))categories.add('miss');
  if(event.type==='production'||event.type==='lock'||event.type==='escaped'||Number(event.cost)>0||(event.energyChanges||[]).some(change=>change.before!==change.after))categories.add('energy');
  return categories;
}

export function observerEventCategoryLabel(event){
  const category=observerEventCategories(event).values().next().value;
  return EVENT_FILTER_CATEGORIES.find(([key])=>key===category)?.[1]||null;
}

export function isPublicHistoryEvent(event){
  return historyEventTypes.has(event.type)&&observerEventCategories(event).size>0;
}

export function deduplicatePublicHistoryEvents(events){
  const result=[];
  for(const event of events){
    const prior=result.at(-1),expected=event.type==='miss'?'miss':event.type==='system_hit'?'hit':null;
    if(expected&&event.strikeId&&prior?.type==='impact'&&prior.outcome===expected&&prior.strikeId===event.strikeId&&prior.round===event.round&&prior.turnIndex===event.turnIndex)continue;
    result.push(event);
  }
  return result;
}

export function eventPlayerIds(event){
  const ids=new Set();
  const add=id=>{if(Number.isInteger(id)&&id>=0)ids.add(id);};
  for(const key of ['actor','player','owner','victim','selected','targetPlayerId','winner'])add(event[key]);
  for(const card of [...(event.cards||[]),...(event.removed||[])])add(card.actor);
  for(const change of event.energyChanges||[])add(change.player);
  return ids;
}

export function observerEventRoles(event){
  const initiators=new Set(),targets=new Set();
  const add=(set,id)=>{if(Number.isInteger(id)&&id>=0)set.add(id);};
  if(['damage','eliminated'].includes(event.type))add(targets,event.actor??event.player);
  else add(initiators,event.actor??event.player??event.owner);
  add(targets,event.victim);
  add(targets,event.targetPlayerId);
  if(event.type==='broadcast_settled'){
    // Settlement cards include the publisher and every responder, including
    // responses that were not selected. Older records may only name selected.
    for(const card of event.cards||[])if(!initiators.has(card.actor))add(targets,card.actor);
    if(!initiators.has(event.selected))add(targets,event.selected);
  }
  return {initiators,targets};
}

export function observerEventHasNoTarget(event){
  if(observerEventRoles(event).targets.size)return false;
  return ['build','production','escaped','miss','system_hit'].includes(event.type)||event.targetPlayerId===null||event.victim===null;
}

export function matchesObserverEvent(event,types,initiators,targets=new Set()){
  if(!isPublicHistoryEvent(event))return false;
  if(types.size&&![...observerEventCategories(event)].some(type=>types.has(type)))return false;
  const roles=observerEventRoles(event);
  if(initiators.size&&![...initiators].some(id=>roles.initiators.has(id)))return false;
  if(targets.size&&![...targets].some(id=>id===NO_EVENT_TARGET?observerEventHasNoTarget(event):roles.targets.has(id)))return false;
  return true;
}
