import sharp from 'sharp'
import { readFile } from 'fs/promises'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'

// Verify what's actually in the PNG by re-rendering a 256px thumbnail.
const data = await readFile('resources/icon.png')
console.log('icon.png md5:', createHash('md5').update(data).digest('hex'))
const meta = await sharp(data).metadata()
console.log('icon.png meta:', { width: meta.width, height: meta.height, format: meta.format, hasAlpha: meta.hasAlpha })
const out = join(tmpdir(), 'render-of-icon.png')
await sharp(data).resize(256, 256, { fit: 'contain' }).png().toFile(out)
console.log(`Rendered to ${out}`)
