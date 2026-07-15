export interface BundleResult {
  bundlePath: string
  zipPath: string
}

export function bundle(): Promise<BundleResult>
