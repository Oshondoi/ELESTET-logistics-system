const DEVICE_KEY = 'elestet_fbs_scanner_device_v1'
const DEVICE_PROFILE_KEY = 'elestet_fbs_scanner_profile_v1'

export interface ScannerDeviceIdentity {
  deviceId: string
  deviceName: string
  scannerModel: string | null
}

export function getScannerDeviceIdentity(): ScannerDeviceIdentity {
  let savedDeviceId = localStorage.getItem(DEVICE_KEY)
  if (!savedDeviceId || savedDeviceId.length < 8) {
    savedDeviceId = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, savedDeviceId)
  }

  let deviceName = ''
  let scannerModel: string | null = null
  try {
    const profile = JSON.parse(localStorage.getItem(DEVICE_PROFILE_KEY) ?? '{}') as Record<string, unknown>
    if (typeof profile.deviceName === 'string') deviceName = profile.deviceName.trim().slice(0, 80)
    if (typeof profile.scannerModel === 'string') scannerModel = profile.scannerModel.trim().slice(0, 200) || null
  } catch {
    // Повреждённый локальный профиль не должен блокировать сканирование.
  }

  return {
    deviceId: savedDeviceId,
    deviceName: deviceName || 'Устройство без имени',
    scannerModel,
  }
}

export function setScannerDeviceName(deviceName: string): ScannerDeviceIdentity {
  const current = getScannerDeviceIdentity()
  const normalizedName = deviceName.trim().slice(0, 80)
  let profile: Record<string, unknown> = {}
  try {
    profile = JSON.parse(localStorage.getItem(DEVICE_PROFILE_KEY) ?? '{}') as Record<string, unknown>
  } catch {
    profile = {}
  }
  localStorage.setItem(DEVICE_PROFILE_KEY, JSON.stringify({ ...profile, deviceName: normalizedName }))
  return { ...current, deviceName: normalizedName || 'Устройство без имени' }
}
