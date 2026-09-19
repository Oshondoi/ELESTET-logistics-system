const DEVICE_KEY = 'elestet_fbs_scanner_device_v1'
const DEVICE_PROFILE_KEY = 'elestet_fbs_scanner_profile_v1'
const SERIAL_PORT_IDENTITY_KEY = 'elestet_scanner_serial_port_v1'

export interface ScannerDeviceIdentity {
  deviceId: string
  deviceName: string
  scannerModel: string | null
}

export interface ScannerSerialPortIdentity {
  deviceId: string
  profileKey: string
  usbVendorId: number | null
  usbProductId: number | null
  savedAt: string
}

type ScannerSerialPortLike = {
  getInfo?(): { usbVendorId?: number; usbProductId?: number }
}

function readSerialPortIdentity(): ScannerSerialPortIdentity | null {
  try {
    const value = JSON.parse(localStorage.getItem(SERIAL_PORT_IDENTITY_KEY) ?? 'null') as Partial<ScannerSerialPortIdentity> | null
    if (!value || typeof value.deviceId !== 'string' || typeof value.profileKey !== 'string') return null
    return {
      deviceId: value.deviceId,
      profileKey: value.profileKey,
      usbVendorId: typeof value.usbVendorId === 'number' ? value.usbVendorId : null,
      usbProductId: typeof value.usbProductId === 'number' ? value.usbProductId : null,
      savedAt: typeof value.savedAt === 'string' ? value.savedAt : '',
    }
  } catch {
    return null
  }
}

export function rememberScannerSerialPort(
  deviceId: string,
  profileKey: string,
  port: ScannerSerialPortLike,
): ScannerSerialPortIdentity {
  const info = port.getInfo?.() ?? {}
  const identity: ScannerSerialPortIdentity = {
    deviceId,
    profileKey,
    usbVendorId: typeof info.usbVendorId === 'number' ? info.usbVendorId : null,
    usbProductId: typeof info.usbProductId === 'number' ? info.usbProductId : null,
    savedAt: new Date().toISOString(),
  }
  localStorage.setItem(SERIAL_PORT_IDENTITY_KEY, JSON.stringify(identity))
  return identity
}

export function findRememberedScannerSerialPort<T extends ScannerSerialPortLike>(
  ports: T[],
  deviceId: string,
  profileKey: string,
): { port: T | null; ambiguous: boolean } {
  const saved = readSerialPortIdentity()
  if (saved?.deviceId === deviceId && saved.profileKey === profileKey) {
    const matches = ports.filter((port) => {
      const info = port.getInfo?.() ?? {}
      return saved.usbVendorId === (typeof info.usbVendorId === 'number' ? info.usbVendorId : null)
        && saved.usbProductId === (typeof info.usbProductId === 'number' ? info.usbProductId : null)
    })
    if (matches.length === 1) return { port: matches[0], ambiguous: false }
    if (matches.length > 1) return { port: null, ambiguous: true }
  }
  if (ports.length === 1) return { port: ports[0], ambiguous: false }
  return { port: null, ambiguous: ports.length > 1 }
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
