import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function writeJsonAtomic(targetPath: string, payload: unknown): void {
  mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 })
  const temp = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    renameSync(temp, targetPath)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

function listJsonFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export interface ReadRecordsResult<T> {
  records: Array<{ fileName: string; record: T }>
  corruptFiles: string[]
}

export function readValidatedRecords<T>(
  dir: string,
  isValid: (value: unknown) => value is T,
): ReadRecordsResult<T> {
  const records: Array<{ fileName: string; record: T }> = []
  const corruptFiles: string[] = []
  for (const fileName of listJsonFiles(dir)) {
    const fullPath = join(dir, fileName)
    try {
      const parsed: unknown = JSON.parse(readFileSync(fullPath, 'utf8'))
      if (isValid(parsed)) {
        records.push({ fileName, record: parsed })
      } else {
        corruptFiles.push(fullPath)
      }
    } catch {
      corruptFiles.push(fullPath)
    }
  }
  return { records, corruptFiles }
}
