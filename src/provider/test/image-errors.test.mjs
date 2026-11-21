// SP007 T2：图片不支持错误识别（MM-08 错误驱动降级）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isImageUnsupportedError } from '../../tui/dist/provider/image-errors.js'

test('匹配：image＋不支持特征', () => {
  const positives = [
    'This model does not support image input',
    'image_url is not supported by this endpoint',
    'Unsupported content type: image',
    'The model does not support vision inputs',
    'multimodal content is not supported',
    'Invalid schema for image_url field',
    'This modality is not supported by the model',
    'images are unsupported on this deployment',
    'Model does not support images'
  ]
  for (const message of positives) {
    assert.equal(isImageUnsupportedError(message), true, message)
  }
})

test('排除：普通错误不误判为图片问题', () => {
  const negatives = [
    'rate limit exceeded',
    'context length exceeded',
    'invalid api key',
    'image processing failed',
    'Internal server error',
    'prompt is too long',
    'tool calls are not supported'
  ]
  for (const message of negatives) {
    assert.equal(isImageUnsupportedError(message), false, message)
  }
})

test('空/非字符串输入安全返回 false', () => {
  assert.equal(isImageUnsupportedError(''), false)
  assert.equal(isImageUnsupportedError(undefined), false)
  assert.equal(isImageUnsupportedError(null), false)
})
