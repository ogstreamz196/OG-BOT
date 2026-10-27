import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/api/public/worker-bots/$id')({server:{handlers:{POST:async({request,params})=>{
  const key=process.env['TELEGRAM_CREDENTIAL_KEY'];
  if(!key) return new Response('Not configured',{status:503});
  const f=await import('@/lib/telegram-fleet.server');
  if(!f.equalSecret(request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '',f.fleetSecret(params.id,key))) return new Response('Unauthorized',{status:401});
  const {supabaseAdmin:admin}=await import('@/integrations/supabase/client.server');
  const {data:bot}=await admin.from('telegram_worker_bots').select(`${f.FLEET_COLUMNS},created_by`).eq('id',params.id).eq('enabled',true).maybeSingle();
  if(!bot) return Response.json({ok:true});
  const update=await request.json().catch(()=>null) as {update_id?:number;message?:{message_id:number;text?:string;chat:{id:number;type:string};from?:{is_bot?:boolean};reply_to_message?:{from?:{id?:number}};message_thread_id?:number};my_chat_member?:{chat:{id:number;type:string};new_chat_member?:{status?:string}}}|null;
  if(!Number.isSafeInteger(update?.update_id)) return new Response('Invalid update',{status:400});
  const joined=update?.my_chat_member;
  if(joined && joined.chat.type!=='private') {
    const {managedGroup,WORKER_REFUSAL}=await import('@/lib/telegram-worker.server');
    if(['member','administrator'].includes(joined.new_chat_member?.status ?? '') && !(await managedGroup(admin,joined.chat.id))?.og_bot_present) {
      await f.fleetApi(bot.id,'sendMessage',{chat_id:joined.chat.id,text:WORKER_REFUSAL},key);
      await f.fleetApi(bot.id,'leaveChat',{chat_id:joined.chat.id},key);
    }
    return Response.json({ok:true});
  }
  const msg=update?.message;
  if(!msg?.text || msg.from?.is_bot) return Response.json({ok:true});
  const group=msg.chat.type!=='private';
  if(group && !await f.fleetAllowed(bot.id,msg.chat.id)) return Response.json({ok:true});
  // In groups only the Gaffer dispatches tasks, preventing duplicate replies.
  if(group) return Response.json({ok:true});
  const {error:claim}=await admin.from('telegram_worker_updates').insert({worker_id:bot.id,update_id:update?.update_id as number});
  if(claim) return Response.json({ok:true});
  let reply='';
  if(bot.role==='trade') {
    const {buildTradeSignal,plainForTelegram}=await import('@/lib/trade-signal-context.server');
    const signal=await buildTradeSignal(msg.text.slice(0,2000));
    reply=signal.reply ? plainForTelegram(signal.reply) : await f.assistantReply(bot,msg.text.slice(0,2000));
    const sent=await f.fleetApi<{message_id:number}>(bot.id,'sendMessage',{chat_id:msg.chat.id,text:reply},key);
    if(signal.plan && sent.ok && sent.result) {
      const {recordSignal}=await import('@/lib/trade-signal-tracker.server');
      await recordSignal({userId:bot.created_by,chatId:msg.chat.id,messageId:sent.result.message_id,card:reply,plan:signal.plan,senderWorker:bot.id});
    }
  } else {
    reply=await f.assistantReply(bot,msg.text.slice(0,2000));
    await f.fleetApi(bot.id,'sendMessage',{chat_id:msg.chat.id,text:reply},key);
  }
  return Response.json({ok:true});
}}}});
