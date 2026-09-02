import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const allowedRoles = new Set(['administrator', 'trainer']);
const allowedStatuses = new Set(['active', 'on_leave', 'inactive']);

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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization) return response({ error: 'Authentication is required.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = readPlatformKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
  const serviceRoleKey = readPlatformKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return response({ error: 'Worker provisioning is not configured.' }, 500);
  }

  const callerClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData.user) return response({ error: 'Your session is no longer valid.' }, 401);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', callerData.user.id)
    .maybeSingle();
  if (profileError || callerProfile?.role !== 'administrator') {
    return response({ error: 'Only administrators can provision workers.' }, 403);
  }

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return response({ error: 'Invalid request body.' }, 400);
  }

  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const role = typeof input.role === 'string' ? input.role : '';
  const employeeNumber = typeof input.employeeNumber === 'string' ? input.employeeNumber.trim() : '';
  const jobTitle = typeof input.jobTitle === 'string' ? input.jobTitle.trim() : '';
  const phone = typeof input.phone === 'string' ? input.phone.trim() || null : null;
  const departmentId = typeof input.departmentId === 'string' && input.departmentId ? input.departmentId : null;
  const employmentStatus = typeof input.employmentStatus === 'string' ? input.employmentStatus : 'active';

  if (!fullName || !email || !employeeNumber || !jobTitle) {
    return response({ error: 'Name, email, employee number and job title are required.' }, 400);
  }
  if (!/^\S+@\S+\.\S+$/.test(email) || !/^[A-Za-z0-9/_-]{3,64}$/.test(employeeNumber)) {
    return response({ error: 'Enter a valid email and employee number.' }, 400);
  }
  if (!allowedRoles.has(role) || !allowedStatuses.has(employmentStatus)) {
    return response({ error: 'The selected role or employment status is not allowed.' }, 400);
  }

  const { data: invitation, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
  });
  if (inviteError || !invitation.user) {
    return response({ error: 'Could not create the worker account. The email may already be in use.' }, 409);
  }

  try {
    const workerId = invitation.user.id;
    const { error: insertProfileError } = await adminClient.from('profiles').insert({
      id: workerId, full_name: fullName, email, role,
    });
    if (insertProfileError) throw insertProfileError;

    const { data: staffMember, error: staffError } = await adminClient.from('staff_members').insert({
      profile_id: workerId,
      employee_number: employeeNumber,
      job_title: jobTitle,
      department_id: departmentId,
      phone,
      employment_status: employmentStatus,
    }).select('id, employee_number, job_title, employment_status').single();
    if (staffError) throw staffError;

    return response({ worker: staffMember }, 201);
  } catch (error) {
    await adminClient.auth.admin.deleteUser(invitation.user.id);
    return response({ error: 'Worker account could not be finalised. No account was kept.' }, 500);
  }
});
