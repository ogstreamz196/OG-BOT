import {beforeEach,describe,expect,test,vi} from 'vitest';
const state=vi.hoisted(()=>({admin:false,reads:0}));
import {connectionSchema} from './telegram-fleet.functions';
import {requireFleetBoss} from './telegram-fleet-access';
const context=()=>({userId:'test-user',supabase:{rpc:async()=>({data:state.admin,error:null})}});
beforeEach(()=>{state.admin=false;state.reads=0;});
describe('Boss-only bot management',()=>{
 test('non-admin cannot read registry',async()=>{await expect(requireFleetBoss(context())).rejects.toThrow('Forbidden');});
 test('server-verified admin can read safe worker fields',async()=>{state.admin=true;await expect(requireFleetBoss(context())).resolves.toBeUndefined();});
 test('rejects non-numeric chats and malformed bot credentials',()=>{
 const base={name:'Chart worker',token:'123456:abcdefghijklmnopqrstuvwxyz',chatId:'-1004356305046',role:'trade',instructions:''};
 expect(connectionSchema.safeParse(base).success).toBe(true);
 expect(connectionSchema.safeParse({...base,token:'bad'}).success).toBe(false);
 expect(connectionSchema.safeParse({...base,chatId:'https://other.example'}).success).toBe(false);
 });
});
