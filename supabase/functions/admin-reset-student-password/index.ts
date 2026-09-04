import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
function response(body: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
function readPlatformKey(dictionaryName: string, legacyName: string) { try { return Deno.env.get(legacyName) || Object.values(JSON.parse(Deno.env.get(dictionaryName) || '{}'))[0] || null; } catch { return null; } }
function temporaryPassword() { const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'; const bytes = crypto.getRandomValues(new Uint8Array(18)); return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join(''); }

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
  if (callerProfile?.role !== 'administrator') return response({ error: 'Only administrators can reset student passwords.' }, 403);
  let input: { studentId?: unknown }; try { input = await request.json(); } catch { return response({ error: 'Invalid request body.' }, 400); }
  const studentId = typeof input.studentId === 'string' ? input.studentId : '';
  const { data: student } = await admin.from('students').select('profile_id, registration_number, first_name, last_name').eq('id', studentId).maybeSingle();
  if (!student?.profile_id || !student.registration_number) return response({ error: 'This student does not have an active login.' }, 404);
  const newPassword = temporaryPassword();
  const { error } = await admin.auth.admin.updateUserById(student.profile_id, { password: newPassword, user_metadata: { temporary_password: true } });
  if (error) return response({ error: 'Unable to reset the student password.' }, 500);
  return response({ account: { fullName: `${student.first_name} ${student.last_name}`, username: student.registration_number, temporaryPassword: newPassword } });
});
