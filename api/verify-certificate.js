export default async function handler(request, response) {
  const { hash } = request.query;
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) {
    return response.status(404).json({ valid: false, status: 'NOT_FOUND' });
  }
  const baseUrl = process.env.SUPABASE_URL || 'https://xagmipuvbvzyqpzxkqbl.supabase.co';
  try {
    const verified = await fetch(`${baseUrl}/functions/v1/verify-certificate/${encodeURIComponent(hash)}`);
    const payload = await verified.json();
    response.setHeader('Cache-Control', 'no-store');
    return response.status(verified.status).json(payload);
  } catch {
    return response.status(503).json({ valid: false, error: 'Certificate verification is temporarily unavailable.' });
  }
}
