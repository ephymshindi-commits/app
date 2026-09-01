import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function readPlatformKey(dictionaryName: string, legacyName: string) { try { return Deno.env.get(legacyName) || Object.values(JSON.parse(Deno.env.get(dictionaryName) || '{}'))[0] || null; } catch { return null; } }
function receiptNumber() { const now = new Date(); return `RCT-MPESA-${now.toISOString().replace(/\D/g, '').slice(0, 12)}-${crypto.randomUUID().slice(0, 5).toUpperCase()}`; }

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const url = Deno.env.get('SUPABASE_URL'); const serviceKey = readPlatformKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return new Response('Configuration error', { status: 500 });
  let payload: any; try { payload = await request.json(); } catch { return new Response('Invalid request', { status: 400 }); }
  const callback = payload?.Body?.stkCallback; const checkoutRequestId = callback?.CheckoutRequestID;
  if (!checkoutRequestId) return new Response('Invalid callback', { status: 400 });
  const admin = createClient(url, serviceKey);
  const { data: pending, error: findError } = await admin.from('mpesa_stk_requests').select('*').eq('checkout_request_id', checkoutRequestId).eq('status', 'requested').maybeSingle();
  if (findError) return new Response('Unable to reconcile callback', { status: 500 });
  if (!pending) return new Response('OK', { status: 200 });
  const resultCode = Number(callback.ResultCode); const resultDescription = callback.ResultDesc || null;
  const items = callback.CallbackMetadata?.Item || []; const item = (name: string) => items.find((entry: any) => entry.Name === name)?.Value;
  if (resultCode !== 0) {
    await admin.from('mpesa_stk_requests').update({ status: resultCode === 1032 ? 'cancelled' : 'failed', result_code: resultCode, result_description: resultDescription }).eq('id', pending.id);
    return new Response('OK', { status: 200 });
  }
  const mpesaReceipt = String(item('MpesaReceiptNumber') || ''); const amount = Number(item('Amount') || pending.amount);
  if (!mpesaReceipt || amount !== Number(pending.amount)) {
    await admin.from('mpesa_stk_requests').update({ status: 'failed', result_code: resultCode, result_description: 'Callback amount or M-Pesa reference did not match the request.' }).eq('id', pending.id);
    return new Response('OK', { status: 200 });
  }
  const localReceipt = receiptNumber();
  const { error: paymentError } = await admin.from('payments').insert({ student_id: pending.student_id, invoice_id: pending.invoice_id, receipt_number: localReceipt, amount, method: 'M-PESA STK', reference: mpesaReceipt });
  if (paymentError) return new Response('Unable to record payment', { status: 500 });
  await admin.from('mpesa_stk_requests').update({ status: 'paid', result_code: resultCode, result_description: resultDescription, mpesa_receipt_number: mpesaReceipt }).eq('id', pending.id);
  return new Response('OK', { status: 200 });
});
