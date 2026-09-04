import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = new Set(['https://portal.ltbstc.com', 'https://ltbstc.com', 'https://www.ltbstc.com']);
const attempts = new Map<string, { count: number; resetAt: number }>();

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

const baseHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function response(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(request), ...baseHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function readPlatformKey(dictionaryName: string, legacyName: string) {
  try {
    return Deno.env.get(legacyName) || Object.values(JSON.parse(Deno.env.get(dictionaryName) || '{}'))[0] || null;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return response(request, { error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = readPlatformKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
  const serviceRoleKey = readPlatformKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) return response(request, { error: 'Student sign-in is not configured.' }, 500);

  let input: { registrationNumber?: unknown; password?: unknown };
  try { input = await request.json(); } catch { return response(request, { error: 'Invalid request body.' }, 400); }
  const registrationNumber = typeof input.registrationNumber === 'string' ? input.registrationNumber.trim().toUpperCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!registrationNumber || !password) return response(request, { error: 'Enter your registration number and password.' }, 400);

  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const key = `${forwarded}:${registrationNumber}`;
  const now = Date.now();
  const current = attempts.get(key);
  if (current && current.resetAt > now && current.count >= 8) {
    return response(request, { error: 'Too many sign-in attempts. Please try again in a few minutes.' }, 429);
  }
  if (!current || current.resetAt <= now) attempts.set(key, { count: 0, resetAt: now + 10 * 60 * 1000 });

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: student } = await admin.from('students')
    .select('profile_id, status')
    .eq('registration_number', registrationNumber)
    .maybeSingle();
  if (!student?.profile_id || ['withdrawn', 'archived'].includes(student.status)) {
    const entry = attempts.get(key)!; entry.count += 1; return response(request, { error: 'Invalid registration number or password.' }, 401);
  }
  const { data: profile } = await admin.from('profiles')
    .select('email, role')
    .eq('id', student.profile_id)
    .maybeSingle();
  if (!profile?.email || profile.role !== 'student') { const entry = attempts.get(key)!; entry.count += 1; return response(request, { error: 'Invalid registration number or password.' }, 401); }

  const auth = createClient(supabaseUrl, publishableKey);
  const { data, error } = await auth.auth.signInWithPassword({ email: profile.email, password });
  if (error || !data.session) { const entry = attempts.get(key)!; entry.count += 1; return response(request, { error: 'Invalid registration number or password.' }, 401); }
  attempts.delete(key);
  return response(request, { session: data.session });
});
