import {beforeEach,describe,expect,test,vi} from 'vitest';
const state=vi.hoisted(()=>({admin:false,reads:0}));
vi.mock('@tanstack/react-start',()=>({createServerFn:()=>{
 const builder={middleware:()=>builder,inputValidator:()=>builder,handler:(fn:any)=>()=>fn({context:{userId:'test-user',supabase:{rpc:async()=>({data:state.admin,error:null})}}})};return builder;
}}));
vi.mock('@/integrations/supabase/auth-middleware',()=>({requireSupabaseAuth:{}}));
vi.mock('@/integrations/supabase/client.server',()=>({supabaseAdmin:{from:()=>{state.reads++;return {select:()=>({order:async()=>({data:[{id:'bot',name:'worker',enabled:true}],error:null})})};}}}));
vi.mock('./telegram-fleet.server',()=>({FLEET_COLUMNS:'id,name,enabled'}));
import {listFleet,connectionSchema} from './telegram-fleet.functions';
beforeEach(()=>{state.admin=false;state.reads=0;});
describe('Boss-only bot management',()=>{
 test('non-admin cannot read registry',async()=>{await expect(listFleet()).rejects.toThrow('Forbidden');expect(state.reads).toBe(0);});
 test('server-verified admin can read safe worker fields',async()=>{state.admin=true;expect(await listFleet()).toEqual([{id:'bot',name:'worker',enabled:true}]);expect(state.reads).toBe(1);});
 test('rejects non-numeric chats and malformed bot credentials',()=>{
 const base={name:'Chart worker',token:'123456:abcdefghijklmnopqrstuvwxyz',chatId:'-1004356305046',role:'trade',instructions:''};
 expect(connectionSchema.safeParse(base).success).toBe(true);
 expect(connectionSchema.safeParse({...base,token:'bad'}).success).toBe(false);
 expect(connectionSchema.safeParse({...base,chatId:'https://other.example'}).success).toBe(false);
 });
});
