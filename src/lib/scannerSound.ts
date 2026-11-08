let sharedContext: AudioContext | undefined

// Additive approximation of the supplied reference, not embedded audio samples.
// Measured bands: ~240, 360, 840, 960, 2040, 2890 Hz; two attacks, ~0.4 s active.
export function synthesizeErrorSound(sampleRate: number): Float32Array {
  const samples = new Float32Array(Math.ceil(sampleRate * 0.4))
  const partials = [[240, 1], [360, .36], [840, .29], [960, .43], [2040, .27], [2890, .31]]
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate
    const second = t >= .22
    const age = second ? t - .22 : t
    const length = second ? .18 : .22
    const envelope = Math.min(1, age / .008) * Math.exp(-age * 3) * Math.min(1, (length - age) / .025)
    let value = 0
    for (const [frequency, weight] of partials) {
      value += weight * Math.sin(2 * Math.PI * frequency * t)
    }
    samples[i] = value * envelope * (second ? .86 : 1)
    peak = Math.max(peak, Math.abs(samples[i]))
  }
  // Gentle soft saturation raises average level without hard clipping.
  // Keep the rhythm, pitch components and 0.4 s duration; leave peak headroom.
  const drive = 1.4
  const ceiling = .95
  const scale = ceiling / Math.tanh(drive)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = scale * Math.tanh(drive * samples[i] / peak)
  }
  return samples
}

/** Single bell strike, available only as an opt-in preview until approved. */
export function synthesizeDingSound(sampleRate: number): Float32Array {
  const duration = .32
  const samples = new Float32Array(Math.ceil(sampleRate * duration))
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate
    const fade = Math.min(1, t / .003) * Math.min(1, (duration - t) / .025)
    const value = Math.sin(2 * Math.PI * 1568 * t) * Math.exp(-12 * t)
      + .32 * Math.sin(2 * Math.PI * 3136 * t) * Math.exp(-22 * t)
      + .12 * Math.sin(2 * Math.PI * 4234 * t) * Math.exp(-32 * t)
    samples[i] = value * fade
    peak = Math.max(peak, Math.abs(samples[i]))
  }
  for (let i = 0; i < samples.length; i++) samples[i] *= .9 / peak
  return samples
}

export type SuccessSoundVariant = 'current' | 'ding' | 'beep' | 'knock' | 'plop'

/** Short percussive previews; no random noise or external audio assets. */
export function synthesizePercussiveSound(sampleRate: number, variant: 'knock' | 'plop'): Float32Array {
  const knock = variant === 'knock'
  const duration = knock ? .08 : .16
  const samples = new Float32Array(Math.ceil(sampleRate * duration))
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate
    const fade = Math.min(1, t / .002) * Math.min(1, (duration - t) / .012)
    // Integrated frequency curve gives the plop a smooth, falling pitch.
    const phase = 2 * Math.PI * (380 * t + 650 * .025 * (1 - Math.exp(-t / .025)))
    const value = knock
      ? (Math.sin(2 * Math.PI * 750 * t) + .45 * Math.sin(2 * Math.PI * 1830 * t)) * Math.exp(-65 * t)
      : (Math.sin(phase) + .15 * Math.sin(2 * phase)) * Math.exp(-25 * t)
    samples[i] = value * fade
    peak = Math.max(peak, Math.abs(samples[i]))
  }
  for (let i = 0; i < samples.length; i++) samples[i] *= .9 / peak
  return samples
}

/** The scanner keeps its existing success sound unless explicitly overridden. */
export async function playScannerSound(success: boolean, successVariant: SuccessSoundVariant = 'current'): Promise<boolean> {
  let context: AudioContext | undefined
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!sharedContext || sharedContext.state === 'closed') {
      sharedContext = new AudioContextClass()
    }
    context = sharedContext
    if (context.state === 'suspended') await context.resume()
    if (context.state !== 'running') throw new Error('Audio unavailable')
    if (!success || successVariant === 'ding' || successVariant === 'knock' || successVariant === 'plop') {
      const samples = !success ? synthesizeErrorSound(context.sampleRate)
        : successVariant === 'knock' || successVariant === 'plop'
          ? synthesizePercussiveSound(context.sampleRate, successVariant)
          : synthesizeDingSound(context.sampleRate)
      const buffer = context.createBuffer(1, samples.length, context.sampleRate)
      buffer.getChannelData(0).set(samples)
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      source.onended = () => source.disconnect()
      source.start(context.currentTime + 0.03)
      return true
    }
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const start = context.currentTime + 0.03
    const duration = successVariant === 'beep' ? 0.09 : 0.07
    oscillator.type = successVariant === 'beep' ? 'sine' : 'triangle'
    oscillator.frequency.value = successVariant === 'beep' ? 2400 : 1200
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.9, start + 0.008)
    gain.gain.setValueAtTime(0.9, start + duration - 0.02)
    gain.gain.linearRampToValueAtTime(0, start + duration)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
      // Keep the output alive: closing here can cut off a short tone before
      // the audio device has played its buffered samples.
    }
    oscillator.start(start)
    oscillator.stop(start + duration)
    return true
  } catch {
    if (context) {
      if (sharedContext === context) sharedContext = undefined
      void context.close().catch(() => undefined)
    }
    return false
  }
}
