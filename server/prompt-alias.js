// Prompt-only aliasing. Browsers, logs and the authoritative game state keep the
// real UUIDs; only the JSON text handed to a model is rewritten, so a 36-char id
// such as 8cb6d436-e1bc-4ce3-8196-6fea1b01024c becomes k7 inside that seat's
// conversation. Model actions now use card names, so aliases stay internal to
// historical state updates and never need to be parsed from a model reply.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export function aliasText(text, session) {
  if (!session || typeof text !== 'string') return text;
  const map = session.aliases || (session.aliases = {});
  let size = Object.keys(map).length;
  return text.replace(UUID, (uuid) => {
    const key = uuid.toLowerCase();
    if (!map[key]) map[key] = 'k' + ++size;
    return map[key];
  });
}
export function migrateAliases(session) {
  if (session.aliasVersion === 1) return;
  for (const message of session.messages || [])
    if (typeof message.content === 'string') message.content = aliasText(message.content, session);
  session.aliasVersion = 1;
}
