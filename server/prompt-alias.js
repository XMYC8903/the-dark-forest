// Prompt-only aliasing. Browsers, logs and the authoritative game state keep the
// real UUIDs; only the JSON text handed to a model is rewritten, so a 36-char id
// such as 8cb6d436-e1bc-4ce3-8196-6fea1b01024c becomes k7 inside that seat's
// conversation. The server never parses ids back out of a model reply — it only
// reads the candidate index — so aliases stay internal to the prompt.
const UUID=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export function aliasText(text,session){
  if(!session||typeof text!=='string')return text;
  const map=session.aliases||(session.aliases={});
  let size=Object.keys(map).length;
  return text.replace(UUID,uuid=>{
    const key=uuid.toLowerCase();
    if(!map[key])map[key]='k'+(++size);
    return map[key];
  });
}
