import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
function response(body: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
function readPlatformKey(dictionaryName: string, legacyName: string) { try { return Deno.env.get(legacyName) || Object.values(JSON.parse(Deno.env.get(dictionaryName) || '{}'))[0] || null; } catch { return null; } }
function phoneNumber(value: string) { const digits = value.replace(/\D/g, ''); if (/^0\d{9}$/.test(digits)) return `254${digits.slice(1)}`; if (/^254\d{9}$/.test(digits)) return digits; return null; }
function timestamp() { return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().replace(/[-:TZ.]/g, '').slice(0, 14); }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405);
  const authorization = request.headers.get('Authorization');
  const url = Deno.env.get('SUPABASE_URL'); const publishable = readPlatformKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
  const serviceKey = readPlatformKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!authorization || !url || !publishable || !serviceKey) return response({ error: 'Authentication is required.' }, 401);
  const caller = createClient(url, publishable, { global: { headers: { Authorization: authorization } } });
  const { data: identity } = await caller.auth.getUser(); if (!identity.user) return response({ error: 'Your session is no longer valid.' }, 401);
  const { data: profile } = await caller.from('profiles').select('role').eq('id', identity.user.id).maybeSingle();
  if (profile?.role !== 'administrator') return response({ error: 'Only administrators can request an M-Pesa payment prompt.' }, 403);
  const key = Deno.env.get('MPESA_CONSUMER_KEY'); const secret = Deno.env.get('MPESA_CONSUMER_SECRET'); const shortcode = Deno.env.get('MPESA_SHORTCODE'); const passkey = Deno.env.get('MPESA_PASSKEY'); const callbackUrl = Deno.env.get('MPESA_CALLBACK_URL');
  if (!key || !secret || !shortcode || !passkey || !callbackUrl) return response({ error: 'M-Pesa is not configured yet. Add the school Daraja credentials in the secure function settings.' }, 503);
  let input: { invoiceId?: unknown; amount?: unknown; phone?: unknown }; try { input = await request.json(); } catch { return response({ error: 'Invalid request body.' }, 400); }
  const invoiceId = typeof input.invoiceId === 'string' ? input.invoiceId : ''; const amount = Number(input.amount); const phone = typeof input.phone === 'string' ? phoneNumber(input.phone) : null;
  if (!invoiceId || !phone || !Number.isFinite(amount) || amount <= 0) return response({ error: 'Choose a fee charge, amount and valid Kenyan mobile number.' }, 400);
  const { data: invoice, error: invoiceError } = await caller.from('invoices').select('id, student_id, invoice_number, amount, status').eq('id', invoiceId).in('status', ['issued', 'part_paid']).maybeSingle();
  if (invoiceError || !invoice) return response({ error: 'The selected fee charge is not available for this request.' }, 422);
  const { data: priorPayments, error: paymentError } = await caller.from('payments').select('amount').eq('invoice_id', invoice.id);
  if (paymentError) return response({ error: 'Unable to confirm the remaining balance.' }, 500);
  const balance = Number(invoice.amount) - (priorPayments || []).reduce((total, payment) => total + Number(payment.amount || 0), 0);
  if (amount > balance) return response({ error: `The amount exceeds the remaining balance of ${balance.toFixed(2)}.` }, 422);
  const environment = Deno.env.get('MPESA_ENV') === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
  const auth = btoa(`${key}:${secret}`); const tokenResponse = await fetch(`${environment}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` } });
  const tokenPayload = await tokenResponse.json(); if (!tokenResponse.ok || !tokenPayload.access_token) return response({ error: 'M-Pesa authentication failed. Check the Daraja configuration.' }, 502);
  const requestTimestamp = timestamp(); const password = btoa(`${shortcode}${passkey}${requestTimestamp}`);
  const stkResponse = await fetch(`${environment}/mpesa/stkpush/v1/processrequest`, { method: 'POST', headers: { Authorization: `Bearer ${tokenPayload.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ BusinessShortCode: shortcode, Password: password, Timestamp: requestTimestamp, TransactionType: 'CustomerPayBillOnline', Amount: Math.ceil(amount), PartyA: phone, PartyB: shortcode, PhoneNumber: phone, CallBackURL: callbackUrl, AccountReference: invoice.invoice_number, TransactionDesc: `School fees ${invoice.invoice_number}` }) });
  const stkPayload = await stkResponse.json(); if (!stkResponse.ok || !stkPayload.CheckoutRequestID) return response({ error: stkPayload.errorMessage || stkPayload.ResponseDescription || 'M-Pesa could not start the payment prompt.' }, 502);
  const admin = createClient(url, serviceKey); const { error: saveError } = await admin.from('mpesa_stk_requests').insert({ invoice_id: invoice.id, student_id: invoice.student_id, amount, phone, checkout_request_id: stkPayload.CheckoutRequestID, merchant_request_id: stkPayload.MerchantRequestID, created_by: identity.user.id });
  if (saveError) return response({ error: 'The M-Pesa prompt was sent, but the request could not be recorded. Reconcile it before retrying.' }, 500);
  return response({ message: 'M-Pesa prompt sent to the payer.', checkoutRequestId: stkPayload.CheckoutRequestID }, 201);
});
