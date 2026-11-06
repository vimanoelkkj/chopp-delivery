import { expect, test } from '@playwright/test'

for (const width of [390, 1440]) {
  test(`P3: unchanged public DOM and pixels at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    // This baseline characterizes the approved fallback, independently of a CMS publication.
    await page.route('**/api/site', (route) =>
      route.fulfill({ status: 404, json: { error: { code: 'CMS_NOT_PUBLISHED' } } }),
    )
    await page.goto('/')
    await expect(page.locator('#topo')).toHaveAttribute('data-editorial-state', 'absent')
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
    // P3 PNGs reviewed on Windows / Chrome 157.0.8103.39, 390x900 and 1440x900 (e2e mode).
    // Accepted: three availability labels now read "Indisponível"; isolated rasterization
    // differences in the scaled About WebP texture, with unchanged framing/layout.
    // Repeated captures were identical; the historical rasterizer version is not recorded.
    await expect(page).toHaveScreenshot(`homepage-${width}.png`, {
      fullPage: true,
      animations: 'disabled',
      maxDiffPixels: 0,
    })
  })
}
