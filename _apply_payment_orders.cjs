const fs = require('fs')
const https = require('https')

const PAT = 'sbp_v0_0c0c5fba48d5f089e856cd372058071e46d51dda'
const PROJECT = 'jzucxqakvgzpgtvagsnq'
const SQL = fs.readFileSync(__dirname + '/supabase/patch_payment_orders.sql', 'utf-8')

const body = JSON.stringify({ query: SQL })
const options = {
  hostname: 'api.supabase.com',
  path: `/v1/projects/${PROJECT}/database/query`,
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${PAT}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
}

const req = https.request(options, (res) => {
  let data = ''
  res.on('data', (chunk) => { data += chunk })
  res.on('end', () => {
    console.log('Status:', res.statusCode)
    console.log('Response:', data.slice(0, 2000))
  })
})
req.on('error', (e) => { console.error('Error:', e.message) })
req.write(body)
req.end()
