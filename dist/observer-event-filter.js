export function eventPlayerIds(event){
  const ids=new Set();
  const add=id=>{if(Number.isInteger(id)&&id>=0)ids.add(id);};
  for(const key of ['actor','player','owner','victim','selected','winner'])add(event[key]);
  for(const card of [...(event.cards||[]),...(event.removed||[])])add(card.actor);
  for(const change of event.energyChanges||[])add(change.player);
  return ids;
}

export function matchesObserverEvent(event,types,players){
  if(types.size&&!types.has(event.type))return false;
  if(!players.size)return true;
  const participants=eventPlayerIds(event);
  return [...players].some(id=>participants.has(id));
}
