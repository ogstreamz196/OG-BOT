// Verifies the caller is an authenticated admin.
// Returns { user, userClient, admin } on success, or a 401/403 Response on failure.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { adminClient, userClient } from "./clients.ts";
import { jsonResponse } from "./cors.ts";

export type AdminGuardOk = {
  user: { id: string };
  userClient: SupabaseClient;
  admin: SupabaseClient;
  error: null;
};
export type AdminGuardErr = { error: Response };

export async function requireAdmin(req: Request): Promise<AdminGuardOk | AdminGuardErr> {
  const uc = userClient(req);
  if (!uc) return { error: jsonResponse({ error: "Missing auth" }, 401) };
  const {
    data: { user },
  } = await uc.auth.getUser();
  if (!user) return { error: jsonResponse({ error: "Unauthorized" }, 401) };
  const admin = adminClient();
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (!isAdmin) return { error: jsonResponse({ error: "Forbidden" }, 403) };
  return { user, userClient: uc, admin, error: null };
}
