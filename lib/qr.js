/**
 * QR rendering for the login flow. `vendor/qrcode.cjs` is Kazuhiko Arase's
 * MIT-licensed QR Code Generator (1.4.4), vendored so the plugin needs no
 * install script and no Python at runtime.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const qrcode = require('../vendor/qrcode.cjs')

export function qrSvg(text, { cellSize = 8, margin = 3 } = {}) {
  const value = String(text || '')
  if (!value) throw new Error('二维码内容为空')
  const code = qrcode(0, 'M')
  code.addData(value)
  code.make()
  return code.createSvgTag({ cellSize, margin, scalable: true })
}

export function qrDataUrl(text, options) {
  const svg = qrSvg(text, options)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
