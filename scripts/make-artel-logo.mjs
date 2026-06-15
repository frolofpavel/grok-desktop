/**
 * Сборка логотипа АРТЕЛЬ v2 — чистое извлечение, потёртость, жирная подпись.
 * node scripts/make-artel-logo.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'

const INPUT = path.join(os.homedir(), 'Desktop', 'ЛОГО.jpg')
const OUTPUT = path.join(os.homedir(), 'Desktop', 'АРТЕЛЬ-logo.png')
const SIZE = 1024
const RED = { r: 200, g: 16, b: 46 }
const RED_HEX = '#C8102E'

/** Детерминированный псевдо-random для потёртости. */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function isCoreRed(r, g, b) {
  const maxOther = Math.max(g, b)
  const redExcess = r - maxOther
  const sat = r > 0 ? (r - Math.min(g, b)) / r : 0
  if (r < 115) return false
  if (redExcess < 62) return false
  if (sat < 0.45) return false
  // Водяной знак розовитый/бежевый — низкая доминанта красного
  if (g > 85 && redExcess < 85) return false
  if (b > 85 && redExcess < 85) return false
  return true
}

function keepLargestComponent(mask, width, height) {
  const visited = new Uint8Array(mask.length)
  const out = new Uint8Array(mask.length)
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  let best = []

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (!mask[idx] || visited[idx]) continue
      const comp = []
      const stack = [idx]
      visited[idx] = 1
      while (stack.length) {
        const cur = stack.pop()
        comp.push(cur)
        const cx = cur % width
        const cy = (cur / width) | 0
        for (const [dx, dy] of dirs) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const ni = ny * width + nx
          if (!mask[ni] || visited[ni]) continue
          visited[ni] = 1
          stack.push(ni)
        }
      }
      if (comp.length > best.length) best = comp
    }
  }
  for (const i of best) out[i] = 1
  return out
}

function morphClose(mask, width, height, radius = 1) {
  // dilation then erosion — заделывает мелкие дыры от водяных знаков
  const dil = dilate(mask, width, height, radius)
  return erode(dil, width, height, radius)
}

function dilate(mask, width, height, radius) {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 0
      for (let dy = -radius; dy <= radius && !on; dy++) {
        for (let dx = -radius; dx <= radius && !on; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          if (mask[ny * width + nx]) on = 1
        }
      }
      out[y * width + x] = on
    }
  }
  return out
}

function erode(mask, width, height, radius) {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 1
      for (let dy = -radius; dy <= radius && on; dy++) {
        for (let dx = -radius; dx <= radius && on; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) { on = 0; break }
          if (!mask[ny * width + nx]) on = 0
        }
      }
      out[y * width + x] = on
    }
  }
  return out
}

function distanceToEdge(mask, width, height) {
  const dist = new Int32Array(mask.length)
  dist.fill(9999)
  const q = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!mask[i]) {
        dist[i] = 0
        q.push(i)
      }
    }
  }
  let head = 0
  while (head < q.length) {
    const i = q[head++]
    const x = i % width
    const y = (i / width) | 0
    const nd = dist[i] + 1
    const nbs = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
    for (const [nx, ny] of nbs) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const ni = ny * width + nx
      if (nd < dist[ni]) {
        dist[ni] = nd
        q.push(ni)
      }
    }
  }
  return dist
}

function applyWear(rgba, mask, width, height, channels) {
  const rand = mulberry32(42)
  const edgeDist = distanceToEdge(mask, width, height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!mask[i]) continue
      const p = i * channels
      const edge = edgeDist[i]

      // Сколы по краям и лёгкая «стирка» внутри
      const edgeWear = edge <= 6 ? 0.22 : edge <= 14 ? 0.09 : 0.035
      if (rand() < edgeWear) {
        rgba[p + 3] = 0
        continue
      }

      // Микро-дырочки / зерно
      if (rand() < 0.028) {
        rgba[p + 3] = 0
        continue
      }

      // Неравномерность краски
      const tone = 0.82 + rand() * 0.28
      rgba[p] = Math.min(255, Math.round(RED.r * tone))
      rgba[p + 1] = Math.min(255, Math.round(RED.g * tone * 0.9 + rand() * 8))
      rgba[p + 2] = Math.min(255, Math.round(RED.b * tone * 0.85 + rand() * 6))

      // Тонкие царапины
      if (rand() < 0.012 && x > 2 && x < width - 2) {
        for (let s = -2; s <= 2; s++) {
          const si = (y * width + (x + s)) * channels
          if (mask[y * width + (x + s)] && rand() < 0.65) rgba[si + 3] = 0
        }
      }
    }
  }

  // Второй проход — крупнее потёртости на внешнем контуре
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      if (!mask[i] || rgba[i * channels + 3] === 0) continue
      if (edgeDist[i] > 10) continue
      if (rand() < 0.06) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ni = (y + dy) * width + (x + dx)
            if (mask[ni] && rand() < 0.45) rgba[ni * channels + 3] = 0
          }
        }
      }
    }
  }
}

async function extractRedSymbol(inputPath) {
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width, height, channels } = info
  const mask = new Uint8Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels
      const r = data[i], g = data[i + 1], b = data[i + 2]
      mask[y * width + x] = isCoreRed(r, g, b) ? 1 : 0
    }
  }

  let cleaned = morphClose(mask, width, height, 1)
  cleaned = keepLargestComponent(cleaned, width, height)
  cleaned = morphClose(cleaned, width, height, 2)

  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const mi = y * width + x
      const p = mi * 4
      if (cleaned[mi]) {
        rgba[p] = RED.r
        rgba[p + 1] = RED.g
        rgba[p + 2] = RED.b
        rgba[p + 3] = 255
      } else {
        rgba[p + 3] = 0
      }
    }
  }

  applyWear(rgba, cleaned, width, height, 4)

  let minX = width, minY = height, maxX = 0, maxY = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4 + 3
      if (rgba[p] > 20) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }

  const pad = 12
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(width - 1, maxX + pad)
  maxY = Math.min(height - 1, maxY + pad)

  return sharp(rgba, { raw: { width, height, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toBuffer()
}

const TEXT_W = SIZE
const TEXT_H = 150
const TEXT_TMP = path.join(os.tmpdir(), 'artel-logo-text.png')

function renderTextPng() {
  if (process.platform === 'win32') {
    const ps = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(${TEXT_W}, ${TEXT_H})
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$g.Clear([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font('Arial Black', 78, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 16, 46))
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF(0, 0, ${TEXT_W}, ${TEXT_H})
$g.DrawString('АРТЕЛЬ', $font, $brush, $rect, $sf)
$g.Dispose()
$bmp.Save('${TEXT_TMP.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
`
    execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'pipe' })
    return fs.readFileSync(TEXT_TMP)
  }
  const svg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${TEXT_W}" height="${TEXT_H}" viewBox="0 0 ${TEXT_W} ${TEXT_H}">
  <rect width="100%" height="100%" fill="white"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
        font-family="Arial Black, Impact, sans-serif" font-size="96" font-weight="900"
        letter-spacing="4" fill="${RED_HEX}">АРТЕЛЬ</text>
</svg>`, 'utf8')
  return sharp(svg).png().toBuffer()
}

async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error('Не найден файл:', INPUT)
    process.exit(1)
  }

  const symbolPng = await extractRedSymbol(INPUT)
  const symbolMaxW = Math.round(SIZE * 0.54)
  const symbolMaxH = Math.round(SIZE * 0.5)
  const symbolResized = await sharp(symbolPng)
    .resize(symbolMaxW, symbolMaxH, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer()
  const sym = await sharp(symbolResized).metadata()

  const textPng = await renderTextPng()
  const textH = TEXT_H
  const gap = 32
  const totalH = (sym.height ?? 0) + gap + textH
  const symbolTop = Math.round((SIZE - totalH) / 2)
  const symbolLeft = Math.round((SIZE - (sym.width ?? 0)) / 2)
  const textTop = symbolTop + (sym.height ?? 0) + gap

  await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })
    .composite([
      { input: symbolResized, left: symbolLeft, top: symbolTop },
      { input: textPng, left: 0, top: textTop }
    ])
    .png()
    .toFile(OUTPUT)

  console.log('Saved:', OUTPUT)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})