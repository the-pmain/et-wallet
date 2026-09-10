import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'
import { loadEnv } from 'vite'

/**
 * Prepare app icons from the source logo.
 *
 * WHY. The source is 1024×1024 and about 1.4 MB. That size is right for
 * print and an extension-store listing, but not for a tab icon or a UI
 * element: the browser would download a megabyte and a half to paint a
 * 56-pixel square.
 *
 * SECOND REASON — the extension. Manifest v3 wants 16, 32, 48 and 128
 * pixel icons as separate files. Preparing them by hand means one of
 * them will eventually be forgotten when the logo changes.
 *
 * EXTRA MARGIN IS TRIMMED. In the source the mark fills about half the
 * canvas; the rest is transparent padding. At 16 pixels the mark would
 * become an unreadable dot in the centre. `trim` drops the transparent
 * edges so the mark fills the frame.
 *
 * Run: `npm run icons`. Output lands in `public/` and in version
 * control: the build must not depend on `sharp` being present.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const environment = loadEnv(process.env.NODE_ENV ?? 'development', ROOT, '')
const themeDefinitions = JSON.parse(
  await readFile(resolve(ROOT, 'build/themes.json'), { encoding: 'utf8' }),
)
const theme = environment.THEME

if (typeof theme !== 'string' || !Object.hasOwn(themeDefinitions, theme)) {
  throw new Error(
    `THEME must be one of: ${Object.keys(themeDefinitions).join(', ')}. Received: ${JSON.stringify(theme ?? '')}.`,
  )
}

const CLIENT_ROOT = resolve(ROOT, themeDefinitions[theme].root)

/**
 * Source mark without lettering.
 *
 * Lives in `brand/`, not `public/`: `public/` is copied into the build
 * wholesale, and the 1.4 MB source would ship even though nobody
 * requests it. `brand/` also holds the full wordmark for store listings
 * and documents where a light background is appropriate.
 */
const SOURCE = resolve(CLIENT_ROOT, 'brand/icon.png')

/**
 * Required sizes.
 *
 * 16, 32, 48, 128 — the Manifest v3 set. 192 and 512 — for installing
 * the web app on a home screen.
 */
const SIZES = [16, 32, 48, 128, 192, 512]

/**
 * Padding around the mark as a fraction of the side.
 *
 * Without it the mark hits the edges and is clipped at the corners on
 * the OS round masks.
 */
const PADDING_RATIO = 0.08

/**
 * Keeps the mark's shape and paints every visible pixel white.
 *
 * The source is the old purple ribbon. Tab icons and the in-app
 * mark must be white; hue-rotate on a purple file left a violet
 * leftover in the favicon, which CSS cannot recolor.
 */
async function toWhite(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  })

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) {
      continue
    }

    data[index] = 255
    data[index + 1] = 255
    data[index + 2] = 255
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer()
}

async function main() {
  const source = await readFile(SOURCE)

  /* Transparent margins are trimmed once: doing it per size would
     decode the source six times. */
  const trimmed = await toWhite(await sharp(source).trim({ threshold: 10 }).png().toBuffer())
  const outputDirectory = resolve(CLIENT_ROOT, 'public/icons')

  await mkdir(outputDirectory, { recursive: true })

  for (const size of SIZES) {
    const inner = Math.round(size * (1 - PADDING_RATIO * 2))

    const icon = await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: await sharp(trimmed)
            .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .toBuffer(),
          gravity: 'center',
        },
      ])
      .png({ compressionLevel: 9, palette: size <= 48 })
      .toBuffer()

    const target = resolve(outputDirectory, `icon-${String(size)}.png`)

    await writeFile(target, icon)

    console.log(`icon-${String(size)}.png — ${String(Math.round(icon.byteLength / 102.4) / 10)} KB`)
  }
}

await main()
