import { expect, test } from '@playwright/test'

for (const width of [390, 1440]) {
  test(`P3: unchanged public DOM and pixels at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await expect(page.locator('#chopes table')).toBeVisible()
    await page.evaluate(async () => {
      await document.fonts.ready
      const images = [...document.images]
      const previous = images.map((image) => image.getAttribute('loading'))
      images.forEach((image) => {
        image.loading = 'eager'
      })
      await Promise.all(images.map((image) => image.decode()))
      images.forEach((image, index) => {
        const value = previous[index]
        if (value === null) image.removeAttribute('loading')
        else image.setAttribute('loading', value)
      })
      window.scrollTo({ top: 0, behavior: 'instant' })
    })
    const structure = await page.evaluate(() => ({
      text: document.body.innerText,
      ids: [...document.querySelectorAll('[id]')].map((element) => element.id),
      anchors: [...document.querySelectorAll('a')].map((element) => ({
        text: element.textContent,
        href: element.getAttribute('href'),
      })),
      landmarks: [...document.querySelectorAll('header,nav,main,section,footer')].map(
        (element) => ({
          tag: element.tagName,
          id: element.id,
          label: element.getAttribute('aria-labelledby'),
        }),
      ),
    }))
    expect(`${JSON.stringify(structure, null, 2)}\n`).toMatchSnapshot(`homepage-${width}-dom.json`)
    await expect(page).toHaveScreenshot(`homepage-${width}.png`, {
      fullPage: true,
      animations: 'disabled',
      maxDiffPixels: 0,
    })
  })
}
