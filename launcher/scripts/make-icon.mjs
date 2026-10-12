// Renders build/icon.svg (the logo mark, as in components/ui/Logo.tsx) into build/icon.png
// (512 px) and build/icon.ico (16-256 px) with Electron's own Chromium, so no image tools are
// needed. Run from launcher/: npx electron scripts/make-icon.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { BrowserWindow, app } from 'electron'

const dir = join(import.meta.dirname, '..', 'build')
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

/** Draws the SVG onto a canvas at each size, in one hidden page, and returns the PNGs. */
async function render(svg, sizes) {
  const window = new BrowserWindow({ show: false })
  await window.loadURL('data:text/html,<html></html>')
  const urls = await window.webContents.executeJavaScript(`(async () => {
    const image = new Image()
    image.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}'
    await image.decode()
    return ${JSON.stringify(sizes)}.map((size) => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const context = canvas.getContext('2d')
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, size, size)
      return canvas.toDataURL('image/png')
    })
  })()`)
  window.destroy()
  return urls.map((url) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))
}

/** An .ico holding PNG images (supported since Windows Vista). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length

  images.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index
    header.writeUInt8(size >= 256 ? 0 : size, entry)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })

  return Buffer.concat([header, ...images.map((image) => image.png)])
}

// Closing the render window mustn't quit before the files are written.
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const svg = await readFile(join(dir, 'icon.svg'), 'utf8')
  const pngs = await render(svg, [...ICO_SIZES, 512])
  await writeFile(join(dir, 'icon.ico'), ico(ICO_SIZES.map((size, index) => ({ size, png: pngs[index] }))))
  await writeFile(join(dir, 'icon.png'), pngs.at(-1))
  console.log(`Wrote icon.ico (${ICO_SIZES.join(', ')} px) and icon.png (512 px)`)
  app.quit()
})
