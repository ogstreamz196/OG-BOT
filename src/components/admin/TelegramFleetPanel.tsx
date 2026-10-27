import { useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Bot,Plug,RefreshCw,Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { listFleet,saveFleetBot,fleetAction,connectionSchema } from '@/lib/telegram-fleet.functions';
import { listTelegramGroups } from '@/lib/telegram-groups.functions';
import { AdminSection } from './AdminSection';
const KEY=['telegram-worker-fleet'];
export function TelegramFleetPanel(){
 const list=useServerFn(listFleet),save=useServerFn(saveFleetBot),action=useServerFn(fleetAction),groups=useServerFn(listTelegramGroups),qc=useQueryClient();
 const q=useQuery({queryKey:KEY,queryFn:()=>list()});
 const g=useQuery({queryKey:['telegram-managed-groups'],queryFn:()=>groups()});
 const [form,setForm]=useState({id:undefined as string|undefined,name:'',token:'',chatId:'',role:'assistant' as 'assistant'|'trade',instructions:''});
 const [busy,setBusy]=useState(false);
 async function run(job:()=>Promise<void>){setBusy(true);try{await job();await qc.invalidateQueries({queryKey:KEY});await qc.invalidateQueries({queryKey:['telegram-managed-groups']});}catch{toast.error('Could not complete that connection. Check the bot token, chat membership and try again.');}finally{setBusy(false);}}
 return <AdminSection icon={<Bot className="h-5 w-5 text-primary"/>} title="Connect a worker bot" subtitle="Secure bot credentials · Boss only">
 <form className="grid gap-4 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();const parsed=connectionSchema.safeParse(form);if(!parsed.success){toast.error('Enter a nickname, valid bot token and negative Telegram chat ID.');return;}void run(async()=>{const result=await save({data:parsed.data});setForm({id:undefined,name:'',token:'',chatId:'',role:'assistant',instructions:''});result.connected?toast.success('Worker connected'):toast.warning(result.problem);});}}>
 <label className="space-y-2 text-sm">Worker nickname<Input aria-label="Worker nickname" maxLength={60} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
 <label className="space-y-2 text-sm">Chat ID<Input aria-label="Worker chat ID" placeholder="-100…" value={form.chatId} onChange={e=>setForm({...form,chatId:e.target.value})}/></label>
 <label className="space-y-2 text-sm sm:col-span-2">Secret bot API token<Input aria-label="Secret bot API token" type="password" autoComplete="new-password" value={form.token} onChange={e=>setForm({...form,token:e.target.value})}/></label>
 <div className="space-y-2 text-sm"><label>Worker job</label><Select value={form.role} onValueChange={v=>setForm({...form,role:v==='trade'?'trade':'assistant'})}><SelectTrigger aria-label="Worker job"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="trade">Trade signals</SelectItem><SelectItem value="assistant">Custom assistant</SelectItem></SelectContent></Select></div>
 <label className="space-y-2 text-sm sm:col-span-2">Job instructions<Textarea aria-label="Job instructions" maxLength={2000} value={form.instructions} onChange={e=>setForm({...form,instructions:e.target.value})}/></label>
 <div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={busy}><Plug className="mr-2 h-4 w-4"/>{form.id?'Replace token & reconnect':'Connect worker'}</Button>{form.id&&<Button variant="outline" type="button" onClick={()=>setForm({...form,id:undefined,token:''})}>Cancel</Button>}</div>
 </form>
 {q.isError?<p className="mt-4 text-sm text-destructive">Worker list could not load.</p>:<ul className="mt-6 divide-y divide-border">{q.data?.map(bot=><li key={bot.id} className="space-y-3 py-4"><div className="flex items-center justify-between gap-3"><div><p className="font-semibold">{bot.name}</p><p className="text-xs text-muted-foreground">{bot.role==='trade'?'Trade signals':'Custom assistant'} · Token set · {bot.webhook_connected?'Webhook connected':'Webhook needs registration'}</p></div><Switch aria-label={`Enable ${bot.name}`} checked={bot.enabled} disabled={busy} onCheckedChange={on=>void run(async()=>{await action({data:{id:bot.id,action:on?'enable':'disable'}});})}/></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy||!bot.enabled} onClick={()=>void run(async()=>{await action({data:{id:bot.id,action:'connect'}});toast.success('Webhook connected');})}><RefreshCw className="mr-2 h-4 w-4"/>Register webhook</Button><Button size="sm" variant="outline" onClick={()=>setForm({id:bot.id,name:bot.name,token:'',role:bot.role,instructions:bot.instructions,chatId:g.data?.groups.find(group=>group.workers.includes(bot.id))?.chatId ?? ''})}>Replace token</Button>{g.data?.groups.filter(group=>group.workers.includes(bot.id)).map(group=><Button key={group.chatId} size="sm" variant="outline" disabled={busy||!bot.enabled||!group.gafferPresent} onClick={()=>void run(async()=>{await action({data:{id:bot.id,action:'ping',chatId:group.chatId}});toast.success('Worker ping sent');})}><Send className="mr-2 h-4 w-4"/>{group.title ?? group.chatId}</Button>)}</div></li>)}</ul>}
 </AdminSection>;
}
