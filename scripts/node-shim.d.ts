// The package compiles with `types: []`; these are the only Node calls the check script makes.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function existsSync(path: string): boolean
  export function readdirSync(path: string): string[]
  export function statSync(path: string): { isDirectory(): boolean }
}
declare const process: { argv: string[], exit(code: number): never }
