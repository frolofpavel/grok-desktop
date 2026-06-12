/**
 * Build the multi-resolution Windows .ico from resources/icon.png.
 * Resizes the source to 16/32/48/64/128/256 PNG buffers, then packs them with png-to-ico.
 * Run with: node scripts/build-icon.mjs
 */
import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const SOURCE = resolve('resources/icon.png')
const OUT_ICO = resolve('resources/icon.ico')
const SIZES = [16, 24, 32, 48, 64, 128, 256]

async function main() {
  const src = await readFile(SOURCE)
  const buffers = await Promise.all(
    SIZES.map(size => sharp(src).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer())
  )
  const ico = await pngToIco(buffers)
  await writeFile(OUT_ICO, ico)
  console.log(`built ${OUT_ICO} (${ico.length} bytes, ${SIZES.length} sizes)`)
}

main().catch(err => { console.error(err); process.exit(1) })
