import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
function response(body: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
function readPlatformKey(dictionaryName: string, legacyName: string) { try { return Deno.env.get(legacyName) || Object.values(JSON.parse(Deno.env.get(dictionaryName) || '{}'))[0] || null; } catch { return null; } }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405);
  const authorization = request.headers.get('Authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL'); const publishableKey = readPlatformKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'); const serviceRoleKey = readPlatformKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!authorization || !supabaseUrl || !publishableKey || !serviceRoleKey) return response({ error: 'Authentication is required.' }, 401);
  const caller = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authorization } } });
  const { data: callerData } = await caller.auth.getUser(); if (!callerData.user) return response({ error: 'Your session is no longer valid.' }, 401);
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', callerData.user.id).maybeSingle();
  if (callerProfile?.role !== 'administrator') return response({ error: 'Only administrators can create student accounts.' }, 403);
  let input: { studentId?: unknown; email?: unknown; temporaryPassword?: unknown }; try { input = await request.json(); } catch { return response({ error: 'Invalid request body.' }, 400); }
  const studentId = typeof input.studentId === 'string' ? input.studentId : ''; const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''; const temporaryPassword = typeof input.temporaryPassword === 'string' ? input.temporaryPassword : '';
  if (!studentId || !/^\S+@\S+\.\S+$/.test(email) || temporaryPassword.length < 12) return response({ error: 'Use a valid email and a temporary password of at least 12 characters.' }, 400);
  const { data: student, error: studentError } = await admin.from('students').select('id, first_name, last_name, registration_number, profile_id').eq('id', studentId).maybeSingle();
  if (studentError || !student) return response({ error: 'Student record was not found.' }, 404);
  if (student.profile_id) return response({ error: 'This student already has a login account.' }, 409);
  const fullName = `${student.first_name} ${student.last_name}`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: temporaryPassword, email_confirm: true, user_metadata: { full_name: fullName, registration_number: student.registration_number, temporary_password: true } });
  if (createError || !created.user) return response({ error: 'Could not create the student login. The email may already be in use.' }, 409);
  try {
    const { error: profileError } = await admin.from('profiles').insert({ id: created.user.id, full_name: fullName, email, role: 'student' });
    if (profileError) throw profileError;
    const { error: linkError } = await admin.from('students').update({ profile_id: created.user.id, personal_email: email }).eq('id', student.id).is('profile_id', null);
    if (linkError) throw linkError;
    return response({ account: { email, registrationNumber: student.registration_number, fullName } }, 201);
  } catch (error) {
    await admin.auth.admin.deleteUser(created.user.id);
    return response({ error: 'Student login could not be finalised. No account was kept.' }, 500);
  }
});
