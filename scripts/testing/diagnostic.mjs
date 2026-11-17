// Redact before truncation so an output limit cannot leave a partial secret.
export function diagnosticText(text, secret, limit = 2000) {
  const safe = secret ? String(text).split(secret).join('[REDACTED]') : String(text)
  return safe.slice(0, limit)
}
