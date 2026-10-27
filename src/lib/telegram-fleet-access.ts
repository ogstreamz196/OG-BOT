export async function requireFleetBoss(context: {userId:string;supabase:{rpc:(fn:string,args:{_user_id:string;_role:string})=>PromiseLike<{data:unknown;error:unknown}>}}) {
 const {data,error}=await context.supabase.rpc('has_role',{_user_id:context.userId,_role:'admin'});
 if(error || data!==true) throw new Error('Forbidden');
}
