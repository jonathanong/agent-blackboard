/** Writes `text` followed by a newline to the given output stream. */
export function writeLine(stream: { write: (chunk: string) => void }, text: string): void {
  stream.write(`${text}\n`)
}
