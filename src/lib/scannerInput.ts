export const GS_SEPARATOR = '\u001d'

const US_PRINTABLE_BY_CODE: Record<string, readonly [string, string]> = {
  Backquote: ['`', '~'], Digit1: ['1', '!'], Digit2: ['2', '@'], Digit3: ['3', '#'],
  Digit4: ['4', '$'], Digit5: ['5', '%'], Digit6: ['6', '^'], Digit7: ['7', '&'],
  Digit8: ['8', '*'], Digit9: ['9', '('], Digit0: ['0', ')'], Minus: ['-', '_'], Equal: ['=', '+'],
  BracketLeft: ['[', '{'], BracketRight: [']', '}'], Backslash: ['\\', '|'],
  Semicolon: [';', ':'], Quote: ["'", '"'], Comma: [',', '<'], Period: ['.', '>'], Slash: ['/', '?'],
  Numpad0: ['0', '0'], Numpad1: ['1', '1'], Numpad2: ['2', '2'], Numpad3: ['3', '3'],
  Numpad4: ['4', '4'], Numpad5: ['5', '5'], Numpad6: ['6', '6'], Numpad7: ['7', '7'],
  Numpad8: ['8', '8'], Numpad9: ['9', '9'], NumpadDecimal: ['.', '.'], NumpadDivide: ['/', '/'],
  NumpadMultiply: ['*', '*'], NumpadSubtract: ['-', '-'], NumpadAdd: ['+', '+'],
}

/**
 * Reconstructs the scanner character from the physical key, not from the
 * active Windows keyboard layout. This keeps HID scanner data stable while
 * the operator uses a Russian layout.
 */
export function scannerCharacterFromKeyboardCode(code: string, shiftKey: boolean): string | null {
  if (/^Key[A-Z]$/.test(code)) {
    const letter = code.slice(3).toLowerCase()
    return shiftKey ? letter.toUpperCase() : letter
  }
  const pair = US_PRINTABLE_BY_CODE[code]
  return pair ? pair[shiftKey ? 1 : 0] : null
}

export function scannerBytesToString(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
}

export type SerialPacketTerminator = 'cr_lf' | 'cr' | 'lf' | 'tab' | 'etx'

export function serialPacketTerminator(value: unknown): SerialPacketTerminator {
  return value === 'cr' || value === 'lf' || value === 'tab' || value === 'etx' ? value : 'cr_lf'
}

export function endsSerialPacket(character: string, terminator: SerialPacketTerminator): boolean {
  if (terminator === 'tab') return character === '\t'
  if (terminator === 'etx') return character === '\u0003'
  if (terminator === 'cr') return character === '\r'
  if (terminator === 'lf') return character === '\n'
  return character === '\r' || character === '\n'
}
