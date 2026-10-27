import {describe,test,expect,vi} from 'vitest';
vi.mock('@/integrations/supabase/client.server',()=>({supabaseAdmin:{}}));
import {sealToken,openToken,equalSecret,fleetSecret} from './telegram-fleet.server';
describe('worker credential boundary',()=>{
 test('encrypted credentials round trip and wrong keys fail',async()=>{
   const sealed=await sealToken('123:testing-credential','test-only-encryption-key');
   expect(sealed).not.toContain('testing-credential');
   expect(await openToken(sealed,'test-only-encryption-key')).toBe('123:testing-credential');
   await expect(openToken(sealed,'different-key')).rejects.toThrow();
 });
 test('each worker webhook authenticates its own secret',()=>{
   expect(equalSecret(fleetSecret('one','key'),fleetSecret('one','key'))).toBe(true);
   expect(equalSecret(fleetSecret('one','key'),fleetSecret('two','key'))).toBe(false);
 });
});
