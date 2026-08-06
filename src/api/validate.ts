/*
 * A tiny runtime validator for API responses.
 *
 * The mock server can be edited live through /db, so a payload really can turn
 * up the wrong shape. Without a check, a missing array surfaces as
 * "Cannot read properties of undefined (reading 'map')" somewhere deep in a
 * render. These validators fail at the boundary instead, naming the exact path.
 */

/**
 * Raised when a response does not match its expected shape.
 *
 * The message is read by whoever is *using* the app, so it leads with what
 * failed and what to do about it — "use_case.personas should be an array, got
 * undefined" tells a user nothing they can act on. The field paths still follow,
 * because they are what makes the cause findable, and `issues` keeps the full
 * list when only the first few are shown.
 */
export class ValidationError extends Error {
  issues: string[]

  constructor(what: string, issues: string[]) {
    super(
      `${what} could not be read — the data did not look the way this app ` +
        'expects. Restarting the mock server (npm run mock) usually fixes it. ' +
        `Details: ${issues.slice(0, 4).join('; ')}` +
        (issues.length > 4 ? ` (+${issues.length - 4} more)` : ''),
    )
    this.name = 'ValidationError'
    this.issues = issues
  }
}

/** A check pushes human-readable problems onto `issues`; it never throws. */
export type Check = (value: unknown, path: string, issues: string[]) => void

const typeName = (v: unknown) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v

export const str: Check = (v, path, issues) => {
  if (typeof v !== 'string') issues.push(`${path} should be a string, got ${typeName(v)}`)
}

export const num: Check = (v, path, issues) => {
  if (typeof v !== 'number' || Number.isNaN(v))
    issues.push(`${path} should be a number, got ${typeName(v)}`)
}

export const bool: Check = (v, path, issues) => {
  if (typeof v !== 'boolean')
    issues.push(`${path} should be a boolean, got ${typeName(v)}`)
}

export const any: Check = () => {}

/** Allows null or undefined, otherwise applies `check`. */
export const nullable =
  (check: Check): Check =>
  (v, path, issues) => {
    if (v === null || v === undefined) return
    check(v, path, issues)
  }

export const arrayOf =
  (check: Check): Check =>
  (v, path, issues) => {
    if (!Array.isArray(v)) {
      issues.push(`${path} should be an array, got ${typeName(v)}`)
      return
    }
    v.forEach((item, i) => check(item, `${path}[${i}]`, issues))
  }

export const shape =
  (fields: Record<string, Check>): Check =>
  (v, path, issues) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      issues.push(`${path} should be an object, got ${typeName(v)}`)
      return
    }
    const record = v as Record<string, unknown>
    for (const [key, check] of Object.entries(fields)) {
      check(record[key], path ? `${path}.${key}` : key, issues)
    }
  }

export const oneOf =
  (allowed: readonly string[]): Check =>
  (v, path, issues) => {
    if (typeof v !== 'string' || !allowed.includes(v))
      issues.push(`${path} should be one of ${allowed.join(' | ')}, got ${JSON.stringify(v)}`)
  }

/**
 * Runs `check` and returns `value` typed as T, or throws ValidationError.
 * `what` names the payload so the message says which request went wrong.
 */
export function validate<T>(what: string, value: unknown, check: Check): T {
  const issues: string[] = []
  check(value, '', issues)
  if (issues.length > 0) throw new ValidationError(what, issues)
  return value as T
}
