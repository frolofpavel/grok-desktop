import sharp from 'sharp'
import { readFile, writeFile } from 'fs/promises'
import { createHash } from 'crypto'

// Verify what's actually in the PNG by re-rendering a 256px thumbnail.
const data = await readFile('resources/icon.png')
console.log('icon.png md5:', createHash('md5').update(data).digest('hex'))
const meta = await sharp(data).metadata()
console.log('icon.png meta:', { width: meta.width, height: meta.height, format: meta.format, hasAlpha: meta.hasAlpha })
await sharp(data).resize(256, 256, { fit: 'contain' }).png().toFile('/tmp/render-of-icon.png')
console.log('Rendered to /tmp/render-of-icon.png')
