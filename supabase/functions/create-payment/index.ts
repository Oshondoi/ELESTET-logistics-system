// Payments are deliberately fail-closed until a verified Finik adapter is installed.
Deno.serve((req: Request) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return new Response(JSON.stringify({error:'Method not allowed'}), {status:405,headers})
  return new Response(JSON.stringify({error:'Внешняя оплата пока не подключена',code:'PAYMENT_PROVIDER_UNAVAILABLE'}), {status:503,headers})
})
