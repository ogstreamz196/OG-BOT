import { createHash, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';

export type FleetBot = { id: string; bot_id: number; name: string; username: string; role: 'trade' | 'assistant'; instructions: string; enabled: boolean; webhook_connected: boolean };
export const FLEET_COLUMNS = 'id,bot_id,name,username,role,instructions,enabled,webhook_connected';
export function fleetSecret(id: string, key: string) { return createHash('sha256').update(`worker:${id}:${key}`).digest('base64url'); }
export function equalSecret(a: string, b: string) { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x,y); }
async function encryptionKey(key: string) {
  if (!key) throw new Error('Bot credential storage is not configured');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function sealToken(token: string, key: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv}, await encryptionKey(key), new TextEncoder().encode(token));
  return `${Buffer.from(iv).toString('base64')}.${Buffer.from(encrypted).toString('base64')}`;
}
export async function openToken(value: string, key: string) {
  const [iv, ciphertext] = value.split('.');
  if (!iv || !ciphertext) throw new Error('Bot credential unavailable');
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64')},await encryptionKey(key),Buffer.from(ciphertext,'base64')));
}
export async function botApi<T = unknown>(token: string, method: string, body: Record<string, unknown>): Promise<{ok:boolean;result?:T;description?:string}> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const json = await res.json() as {ok:boolean;result?:T;description?:string};
    return {ok:res.ok && json.ok,result:json.result,description:json.description?.split(token).join('[redacted]')};
  } catch { return {ok:false,description:'Telegram could not be reached'}; }
}
export async function fleetApi<T = unknown>(id: string, method: string, body: Record<string, unknown>, key: string) {
  const {data,error} = await admin.from('telegram_worker_bots').select('token_ciphertext,enabled').eq('id',id).maybeSingle();
  if (error || !data?.enabled) return {ok:false,description:'Worker unavailable'};
  return botApi<T>(await openToken(data.token_ciphertext,key),method,body);
}
export async function chatFleet(chatId: number): Promise<FleetBot[]> {
  const {data:group} = await admin.from('telegram_managed_groups').select('og_bot_present,active_workers').eq('chat_id',chatId).maybeSingle();
  if (!group?.og_bot_present) return [];
  const ids = Array.isArray(group.active_workers) ? group.active_workers.filter((id): id is string => typeof id === 'string' && id !== 'trade') : [];
  if (!ids.length) return [];
  const {data,error} = await admin.from('telegram_worker_bots').select(FLEET_COLUMNS).in('id',ids).eq('enabled',true).order('created_at');
  if (error) throw new Error('Worker list unavailable');
  return data ?? [];
}
export async function fleetAllowed(id: string, chatId: number) { return (await chatFleet(chatId)).some(bot=>bot.id===id); }
export async function assistantReply(bot: FleetBot, text: string) {
  const {fetchAiChat} = await import('./ai-endpoint.server');
  const {buildSystemPrompt} = await import('./og-persona.server');
  const system = buildSystemPrompt({mode:'og',foulMouth:true,bossScript:null,bossVoice:null,bossDictionary:null,user:{display_name:null,email:null,coin_balance:0,is_admin:false,is_vip:false}});
  const {response} = await fetchAiChat({messages:[{role:'system',content:`${system}\nYou are the Gaffer's worker named ${bot.name}. Your job: ${bot.instructions}. Never write @handles. Never invent live prices or signal levels. Keep group replies public; no private account data.`},{role:'user',content:text}]},'default',{foulMouth:true,freeOnly:true});
  const json = await response.json() as {choices?:{message?:{content?:string}}[]};
  return (json.choices?.[0]?.message?.content ?? 'Worker is busy, try again in a moment.').replace(/@[\w]+/g,'worker').slice(0,3800);
}
