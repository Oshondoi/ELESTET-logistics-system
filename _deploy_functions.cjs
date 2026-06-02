const fs = require('fs')
const https = require('https')

const PAT = 'sbp_v0_0c0c5fba48d5f089e856cd372058071e46d51dda'
const PROJECT = 'jzucxqakvgzpgtvagsnq'

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body)
    const options = {
      hostname: 'api.supabase.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${PAT}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', reject)
    req.write(bodyStr)
    req.end()
  })
}

async function deployFunction(slug) {
  const src = fs.readFileSync(`supabase/functions/${slug}/index.ts`, 'utf-8')

  // Попробуем PATCH (обновить если существует), потом POST (создать)
  let res = await request('PATCH', `/v1/projects/${PROJECT}/functions/${slug}`, {
    body: src,
    verify_jwt: true,
  })
  console.log(`PATCH ${slug}: ${res.status}`)

  if (res.status === 404) {
    res = await request('POST', `/v1/projects/${PROJECT}/functions`, {
      slug,
      name: slug,
      body: src,
      verify_jwt: true,
    })
    console.log(`POST ${slug}: ${res.status}`)
  }

  if (res.status >= 200 && res.status < 300) {
    console.log(`✓ ${slug} deployed`)
  } else {
    console.log(`✗ ${slug} error: ${res.body.slice(0, 300)}`)
  }
}

;(async () => {
  await deployFunction('create-payment')
  await deployFunction('payment-webhook')
})()
