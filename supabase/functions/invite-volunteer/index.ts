import { createClient } from "npm:@supabase/supabase-js@2.58.0";

// Never expose the service role key in browser code.
// This function is intended only for authenticated, active PAL super administrators.
const headers = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, x-client-info, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json",
};
function respond(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return respond({ error: "Not authenticated" }, 401);
    const url = Deno.env.get("SUPABASE_URL");
    const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !secret) return respond({ error: "Service is not configured" }, 503);
    const admin = createClient(url, secret, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return respond({ error: "Not authenticated" }, 401);
    const { data: actor, error: roleError } = await admin.from("profiles")
      .select("role,active").eq("id", user.id).single();
    if (roleError || !actor?.active || actor.role !== "super_admin") {
      return respond({ error: "Super administrator access required" }, 403);
    }
    const input = await req.json();
    const email = String(input.email || "").trim().toLowerCase();
    const fullName = String(input.full_name || "").trim();
    const cohortId = input.cohort_id || null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || fullName.length < 2 || fullName.length > 100) {
      return respond({ error: "A valid email and name are required" }, 400);
    }
    if (cohortId) {
      const { data: cohort } = await admin.from("cohorts")
        .select("id").eq("id", cohortId).maybeSingle();
      if (!cohort) return respond({ error: "Invalid cohort" }, 400);
    }
    const site = Deno.env.get("PAL_SITE_URL");
    const options: { data: { name: string }; redirectTo?: string } = {
      data: { name: fullName },
    };
    if (site) options.redirectTo = site;
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, options);
    if (inviteError) return respond({ error: inviteError.message }, 400);
    const id = invited?.user?.id;
    if (!id) return respond({ error: "Invitation did not return a user ID" }, 502);
    const { error: profileError } = await admin.from("profiles").upsert({
      id, email, full_name: fullName, role: "volunteer", active: true,
    }, { onConflict: "id" });
    if (profileError) return respond({ error: "Invitation sent; activation failed. Review the user record." }, 500);
    if (cohortId) {
      const { error: memberError } = await admin.from("cohort_members").upsert({
        cohort_id: cohortId, user_id: id,
      }, { onConflict: "cohort_id,user_id" });
      if (memberError) return respond({ error: "Invitation sent; cohort assignment failed." }, 500);
    }
    return respond({ ok: true });
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
