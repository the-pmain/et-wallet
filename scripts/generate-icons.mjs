import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

/**
 * Подготовка значков приложения из исходного логотипа.
 *
 * ЗАЧЕМ. Исходный файл — 1024×1024 и около 1.4 МБ. Это правильный размер
 * для полиграфии и витрины магазина расширений, но недопустимый для
 * значка вкладки и тем более для элемента интерфейса: браузер скачал бы
 * полтора мегабайта, чтобы нарисовать квадрат в 56 пикселей.
 *
 * ВТОРАЯ ПРИЧИНА — расширение. Manifest v3 требует значки размеров
 * 16, 32, 48 и 128 пикселей отдельными файлами. Готовить их вручную
 * означает рано или поздно забыть обновить один из них при смене
 * логотипа.
 *
 * ЛИШНЕЕ ПОЛЕ ОБРЕЗАЕТСЯ. В исходнике знак занимает около половины
 * холста, остальное — прозрачные поля. При уменьшении до 16 пикселей
 * от знака осталась бы неразличимая точка в центре. `trim` убирает
 * прозрачные края, после чего знак заполняет кадр целиком.
 *
 * Запуск: `npm run icons`. Результат попадает в `public/` и в систему
 * контроля версий: сборка не должна зависеть от наличия `sharp`.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Исходный знак без надписей.
 *
 * Лежит в `brand/`, а не в `public/`: содержимое `public/` копируется
 * в сборку целиком, и полуторамегабайтный исходник попадал бы
 * в дистрибутив, хотя никем не запрашивается. В `brand/` рядом с ним
 * хранится и полный блок логотипа с надписью — для витрины магазина
 * и документов, где светлый фон уместен.
 */
const SOURCE = resolve(ROOT, 'brand/icon.png')

/**
 * Требуемые размеры.
 *
 * 16, 32, 48, 128 — набор manifest v3. 192 и 512 — для установки
 * веб-приложения на домашний экран.
 */
const SIZES = [16, 32, 48, 128, 192, 512]

/**
 * Отступ вокруг знака в долях стороны.
 *
 * Без поля знак упирается в края и на круглых масках операционных
 * систем обрезается по углам.
 */
const PADDING_RATIO = 0.08

async function main() {
  const source = await readFile(SOURCE)

  /* Обрезка прозрачных полей выполняется один раз: повторять её для
     каждого размера значило бы шесть раз декодировать исходник. */
  const trimmed = await sharp(source).trim({ threshold: 10 }).png().toBuffer()
  const outputDirectory = resolve(ROOT, 'public/icons')

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

    console.log(`icon-${String(size)}.png — ${String(Math.round(icon.byteLength / 102.4) / 10)} КБ`)
  }
}

await main()
