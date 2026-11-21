// Image-unsupported error detection (SP007 MM-08, design §4.4).
// Error-driven downgrade: no static vision table; the provider's rejection
// message is the signal. Matches the reference's feature set independently.

/**
 * True when a provider error message indicates the endpoint/model rejects
 * image input (so the session can strip images and retry once). Ordinary
 * errors (rate limit, auth, context length, tool support) never match.
 */
export function isImageUnsupportedError(message: unknown): boolean {
  if (typeof message !== 'string' || !message) return false
  const m = message.toLowerCase()
  const hasMedia = /image|vision|multimodal|modality/.test(m)
  if (!hasMedia) return false
  // image_url schema rejection (OpenAI-compatible gateways)
  if (/image_url/.test(m) && /(schema|invalid|not supported|unsupported)/.test(m)) return true
  return /not support|unsupported|does not support|doesn't support|no support|not available|invalid schema/.test(m)
}
