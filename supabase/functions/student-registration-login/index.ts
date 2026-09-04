import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function readPlatformKey(dictionaryName: string, legacyName: string) {
  try {
    return Deno.env.get(legacyName) || Object.values(JSON.parse(Deno.env.get(dictionaryName) || '{}'))[0] || null;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = readPlatformKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
  const serviceRoleKey = readPlatformKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) return response({ error: 'Student sign-in is not configured.' }, 500);

  let input: { registrationNumber?: unknown; password?: unknown };
  try { input = await request.json(); } catch { return response({ error: 'Invalid request body.' }, 400); }
  const registrationNumber = typeof input.registrationNumber === 'string' ? input.registrationNumber.trim().toUpperCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!registrationNumber || !password) return response({ error: 'Enter your registration number and password.' }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: student } = await admin.from('students')
    .select('profile_id, status')
    .eq('registration_number', registrationNumber)
    .maybeSingle();
  if (!student?.profile_id || ['withdrawn', 'archived'].includes(student.status)) {
    return response({ error: 'Invalid registration number or password.' }, 401);
  }
  const { data: profile } = await admin.from('profiles')
    .select('email, role')
    .eq('id', student.profile_id)
    .maybeSingle();
  if (!profile?.email || profile.role !== 'student') return response({ error: 'Invalid registration number or password.' }, 401);

  const auth = createClient(supabaseUrl, publishableKey);
  const { data, error } = await auth.auth.signInWithPassword({ email: profile.email, password });
  if (error || !data.session) return response({ error: 'Invalid registration number or password.' }, 401);
  return response({ session: data.session });
});
