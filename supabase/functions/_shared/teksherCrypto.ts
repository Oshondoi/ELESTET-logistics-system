const PREFIX = 'enc:v1:'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function credentialKey(): Promise<CryptoKey> {
  const encoded = Deno.env.get('TEKSHER_CREDENTIALS_KEY')?.trim()
  if (!encoded) throw new Error('TEKSHER_CREDENTIALS_KEY не настроен')
  let raw: Uint8Array
  try { raw = base64ToBytes(encoded) }
  catch { throw new Error('TEKSHER_CREDENTIALS_KEY имеет неверный Base64-формат') }
  if (raw.byteLength !== 32) throw new Error('TEKSHER_CREDENTIALS_KEY должен содержать 32 байта')
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export function isEncryptedTeksherSecret(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(PREFIX))
}

export async function encryptTeksherSecret(value: string): Promise<string> {
  if (isEncryptedTeksherSecret(value)) return value
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await credentialKey(),
    encoder.encode(value),
  ))
  const payload = new Uint8Array(iv.length + encrypted.length)
  payload.set(iv)
  payload.set(encrypted, iv.length)
  return `${PREFIX}${bytesToBase64(payload)}`
}

export async function decryptTeksherSecret(value: string): Promise<string> {
  if (!isEncryptedTeksherSecret(value)) return value
  const payload = base64ToBytes(value.slice(PREFIX.length))
  if (payload.byteLength <= 28) throw new Error('Повреждено зашифрованное подключение Teksher')
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: payload.subarray(0, 12) },
    await credentialKey(),
    payload.subarray(12),
  )
  return decoder.decode(decrypted)
}
