import { readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

export interface OverdareConfig {
  host?: string
  port?: number
}

function stripJsonComments(text: string): string {
  return text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
}

let cached: OverdareConfig | undefined

export function loadOverdareConfig(): OverdareConfig {
  if (cached) return cached
  const configPath = join(homedir(), ".diligent", "@overdare.jsonc")
  try {
    const raw = readFileSync(configPath, "utf-8")
    cached = JSON.parse(stripJsonComments(raw)) as OverdareConfig
    return cached
  } catch {
    cached = {}
    return cached
  }
}
