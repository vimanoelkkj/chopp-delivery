export function containsControls(value: string, multiline = false): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return (code < 32 || code === 127) && !(multiline && [9, 10, 13].includes(code))
  })
}

export function malformedUnicode(value: string): boolean {
  return [...value].some(
    (character) =>
      character.length === 1 &&
      character.charCodeAt(0) >= 0xd800 &&
      character.charCodeAt(0) <= 0xdfff,
  )
}

export function unsafeUnicode(value: string): boolean {
  return malformedUnicode(value) || /\p{Bidi_Control}/u.test(value)
}
