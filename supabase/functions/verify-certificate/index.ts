import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function platformKey(dictionaryName: string, legacyName: string) {
  try { return Deno.env.get(legacyName) || Object.values(JSON.parse(Deno.env.get(dictionaryName) || '{}'))[0] || null; }
  catch { return null; }
}

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'GET') return response({ valid: false, error: 'Method not allowed.' }, 405);
  const hash = new URL(request.url).pathname.split('/').filter(Boolean).pop() || new URL(request.url).searchParams.get('hash') || '';
  if (!/^[a-f0-9]{64}$/i.test(hash)) return response({ valid: false, status: 'NOT_FOUND' }, 404);
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = platformKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return response({ valid: false, error: 'Verification service is not configured.' }, 503);
  const admin = createClient(url, serviceKey);
  const { data, error } = await admin.rpc('public_verify_certificate', { target_hash: hash });
  if (error || !data || data.valid !== true) return response({ valid: false, status: 'NOT_FOUND' }, 404);
  return response(data, 200);
});
