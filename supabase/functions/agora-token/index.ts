import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { RtcRole, RtcTokenBuilder } from 'npm:agora-access-token@2.0.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://ltbstc.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function readPlatformKey(dictionaryName: string, legacyName: string) {
  const legacyKey = Deno.env.get(legacyName);
  if (legacyKey) return legacyKey;
  try {
    const keys = JSON.parse(Deno.env.get(dictionaryName) ?? '{}') as Record<string, string>;
    return Object.values(keys)[0] ?? null;
  } catch {
    return null;
  }
}

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function channelFromMeetingUrl(value: string) {
  const match = /^agora:\/\/([A-Za-z0-9_-]{3,64})$/.exec(value);
  return match?.[1] ?? null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405);

  const authorization = request.headers.get('Authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = readPlatformKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
  if (!authorization || !supabaseUrl || !publishableKey) return response({ error: 'Authentication is required.' }, 401);

  const appId = Deno.env.get('AGORA_APP_ID');
  const appCertificate = Deno.env.get('AGORA_APP_CERTIFICATE');
  if (!appId || !appCertificate) return response({ error: 'Live classes are not configured.' }, 503);

  let input: { sessionId?: unknown };
  try { input = await request.json(); } catch { return response({ error: 'Invalid request body.' }, 400); }
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId : '';
  if (!sessionId) return response({ error: 'Choose a live class first.' }, 400);

  const caller = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authorization } } });
  const { data: identity, error: identityError } = await caller.auth.getUser();
  if (identityError || !identity.user) return response({ error: 'Your session is no longer valid.' }, 401);

  const { data: session, error: sessionError } = await caller
    .from('virtual_sessions')
    .select('id, title, meeting_url, starts_at, ends_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionError || !session) return response({ error: 'You do not have access to this live class.' }, 403);

  const now = Date.now();
  const opensAt = new Date(session.starts_at).getTime() - (30 * 60 * 1000);
  const closesAt = new Date(session.ends_at).getTime() + (30 * 60 * 1000);
  if (now < opensAt || now > closesAt) return response({ error: 'This live class is not open yet.' }, 409);

  const channelName = channelFromMeetingUrl(session.meeting_url);
  if (!channelName) return response({ error: 'This live class has an invalid room configuration.' }, 422);

  const { data: profile } = await caller.from('profiles').select('role').eq('id', identity.user.id).maybeSingle();
  const isPresenter = profile?.role === 'administrator' || profile?.role === 'trainer';
  const uid = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    expiresAt,
  );
  return response({ appId, token, uid, channelName, title: session.title, isPresenter, expiresAt });
});
