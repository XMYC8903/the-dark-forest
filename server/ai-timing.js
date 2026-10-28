export const AI_ACTION_DELAY_MS=5000;
// Metadata updates (including spectators joining) must not restart an AI's countdown.
export function nextAIActionAt(room,bot,now=Date.now()){
  if(!bot){room.aiSchedule=null;return Infinity;}
  const game=room.game,key=[game.turnIndex,room.motionSequence||0,bot.me,game.pending?.kind||'turn',game.pending?.publicId||''].join(':');
  if(room.aiSchedule?.key!==key)room.aiSchedule={key,at:now+(bot.level==='deepseek'?0:AI_ACTION_DELAY_MS)};
  return room.aiSchedule.at;
}
