export const EVENT_FILTER_CATEGORIES=[
  ['build','建设'],['broadcast_published','广播发布'],['broadcast_settled','广播结算'],
  ['launch','打击发射'],['impact_hit','打击命中'],['defense','防御打击'],['miss','打击落空'],
  ['lock','科技锁死'],['escaped','光速跃迁'],['eliminated','文明消逝'],['energy','能量变化']
];

const historyEventTypes=new Set(['build','broadcast_published','broadcast_settled','broadcast','launch','impact','system_hit','damage','miss','lock','escaped','eliminated','production']);

export function observerEventCategories(event){
  const categories=new Set();
  if(['build','broadcast_published','broadcast_settled','launch','lock','escaped','eliminated'].includes(event.type))categories.add(event.type);
  if(event.type==='broadcast')categories.add('broadcast_published');
  if(event.type==='impact')categories.add(event.outcome==='survived'?'defense':['miss','escaped'].includes(event.outcome)?'miss':'impact_hit');
  if(['system_hit','damage'].includes(event.type))categories.add('impact_hit');
  if(event.type==='miss')categories.add('miss');
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
  for(const key of ['actor','player','owner','victim','selected','winner'])add(event[key]);
  for(const card of [...(event.cards||[]),...(event.removed||[])])add(card.actor);
  for(const change of event.energyChanges||[])add(change.player);
  return ids;
}

export function matchesObserverEvent(event,types,players){
  if(!isPublicHistoryEvent(event))return false;
  if(types.size&&![...observerEventCategories(event)].some(type=>types.has(type)))return false;
  if(!players.size)return true;
  const participants=eventPlayerIds(event);
  return [...players].some(id=>participants.has(id));
}
