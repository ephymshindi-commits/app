import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': 'https://ltbstc.com', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
function response(body: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
function readPlatformKey(dictionaryName: string, legacyName: string) { try { return Deno.env.get(legacyName) || Object.values(JSON.parse(Deno.env.get(dictionaryName) || '{}'))[0] || null; } catch { return null; } }
function temporaryPassword() { const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'; const bytes = crypto.getRandomValues(new Uint8Array(18)); return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join(''); }
function loginEmail() { return `student.${crypto.randomUUID()}@login.ltbstc.com`; }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405);
  const authorization = request.headers.get('Authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL'); const publishableKey = readPlatformKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'); const serviceRoleKey = readPlatformKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!authorization || !supabaseUrl || !publishableKey || !serviceRoleKey) return response({ error: 'Authentication is required.' }, 401);
  const caller = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authorization } } });
  const { data: identity } = await caller.auth.getUser();
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: callerProfile } = identity.user ? await admin.from('profiles').select('role').eq('id', identity.user.id).maybeSingle() : { data: null };
  if (callerProfile?.role !== 'administrator') return response({ error: 'Only administrators can provision student accounts.' }, 403);
  const { data: students, error: studentsError } = await admin.from('students').select('id, first_name, last_name').eq('status', 'active').is('profile_id', null).order('created_at');
  if (studentsError) return response({ error: 'Unable to read the student register.' }, 500);
  const accounts: Array<Record<string, string>> = [];
  for (const student of students || []) {
    const fullName = `${student.first_name} ${student.last_name}`;
    const email = loginEmail(); const password = temporaryPassword();
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName, temporary_password: true } });
    if (createError || !created.user) continue;
    try {
      const { error: profileError } = await admin.from('profiles').insert({ id: created.user.id, full_name: fullName, email, role: 'student' });
      if (profileError) throw profileError;
      const { data: username, error: issueError } = await admin.rpc('issue_student_registration_number', { target_student_id: student.id, target_profile_id: created.user.id });
      if (issueError || !username) throw issueError || new Error('Registration number could not be issued.');
      accounts.push({ fullName, username, temporaryPassword: password });
    } catch {
      await admin.auth.admin.deleteUser(created.user.id);
    }
  }
  return response({ accounts });
});
