import { readFileSync } from 'node:fs'
import { expect, type Page, type Route, test } from '@playwright/test'
import { projectPublicCmsV2 } from '../shared/cms/validation-v2'
import { previewFixture } from '../tests/e2e-real/preview-fixture'

const HERO_ID = 'media_12345678-1234-4123-8123-123456789012'
const ABOUT_ID = 'media_12345678-4321-4123-8123-123456789012'
const OTHER_ID = 'media_87654321-1234-4123-8123-123456789012'
const image = readFileSync('src/shared/assets/kegs/keg-hero-50l.webp')

function site(heroId = HERO_ID, aboutId = ABOUT_ID) {
  const doc = previewFixture()
  doc.commercial.whatsappNumber = '5531999999999'
  for (const module of doc.modules) {
    if (module.template === 'hero')
      module.content = {
        ...module.content,
        heading: 'Hero público',
        media: { id: heroId, alt: 'Imagem editorial do hero' },
      }
    if (module.template === 'about')
      module.content = { ...module.content, media: { id: aboutId, alt: 'Imagem editorial sobre' } }
  }
  return projectPublicCmsV2(doc)
}

type MediaHandler = (route: Route) => Promise<void> | void
const ok: MediaHandler = (route) =>
  route.fulfill({ status: 200, contentType: 'image/webp', body: image })
const notFound: MediaHandler = (route) =>
  route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: '{"error":{"code":"NOT_FOUND"}}',
  })

async function open(page: Page, width: number, media: MediaHandler, payload = site()) {
  const requested: string[] = []
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/site', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', json: payload }),
  )
  await page.route('**/api/site/media/**', (route) => {
    requested.push(new URL(route.request().url()).pathname)
    return media(route)
  })
  await page.goto('/')
  await expect(page.locator('#chopes table')).toBeVisible()
  return requested
}

const geometry = (page: Page) =>
  page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect()
      return rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null
    }
    return { hero: box('section[aria-labelledby="hero-title"]'), about: box('#sobre') }
  })
const brokenImages = (page: Page) =>
  page.evaluate(() =>
    [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src),
  )

for (const width of [390, 768, 1440]) {
  test.describe(`published media at ${width}px`, () => {
    test('shows published hero/about images and removes the local fallback after they load', async ({
      page,
    }) => {
      const requested = await open(page, width, ok)
      const hero = page.getByRole('img', { name: 'Imagem editorial do hero' })
      await expect(hero).toBeVisible()
      await expect(hero).toHaveAttribute('src', `/api/site/media/${HERO_ID}/hero`)
      await expect(page.getByRole('img', { name: /Barril de chopp .* 50 litros/ })).toHaveCount(0)
      await page.locator('#sobre').scrollIntoViewIfNeeded()
      const about = page.getByRole('img', { name: 'Imagem editorial sobre' })
      await expect(about).toBeVisible()
      await expect(about).toHaveAttribute('src', `/api/site/media/${ABOUT_ID}/section`)
      expect(requested.sort()).toEqual(
        [`/api/site/media/${ABOUT_ID}/section`, `/api/site/media/${HERO_ID}/hero`].sort(),
      )
      expect(await brokenImages(page)).toEqual([])
      // No animation under prefers-reduced-motion.
      expect(await hero.evaluate((e) => getComputedStyle(e).transitionDuration)).toBe('0s')
    })

    test('keeps layout identical while loading, after failure and after load', async ({ page }) => {
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      await open(page, width, async (route) => {
        await gate
        await ok(route)
      })
      // Loading: local fallback visible, published image invisible and not announced.
      await expect(page.getByRole('img', { name: /Barril de chopp .* 50 litros/ })).toBeVisible()
      await expect(page.getByRole('img', { name: 'Imagem editorial do hero' })).toHaveCount(0)
      await page.locator('#sobre').scrollIntoViewIfNeeded()
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
      const loading = await geometry(page)
      release()
      await expect(page.getByRole('img', { name: 'Imagem editorial do hero' })).toBeVisible()
      expect(await geometry(page)).toEqual(loading)
    })

    for (const [name, handler] of [
      ['404', notFound],
      [
        '500',
        (route: Route) => route.fulfill({ status: 500, contentType: 'text/plain', body: 'x' }),
      ],
      [
        'corrupt 200 body',
        (route: Route) =>
          route.fulfill({ status: 200, contentType: 'image/webp', body: 'not an image' }),
      ],
      ['network failure', (route: Route) => route.abort('failed')],
    ] as const) {
      test(`falls back to the approved local assets on ${name}`, async ({ page }) => {
        await open(page, width, handler)
        await expect(page.getByRole('img', { name: /Barril de chopp .* 50 litros/ })).toBeVisible()
        await expect(page.getByRole('img', { name: 'Imagem editorial do hero' })).toHaveCount(0)
        await page.locator('#sobre').scrollIntoViewIfNeeded()
        await expect(
          page.getByRole('img', { name: 'Barril de chopp em aço inox escovado', exact: true }),
        ).toBeVisible()
        await expect.poll(() => page.locator('img[src^="/api/site/media/"]').count()).toBe(0)
        expect(await brokenImages(page)).toEqual([])
      })
    }

    test('fallback images keep the same source, size and styling as the default presentation', async ({
      browser,
    }) => {
      const measure = async (published: boolean) => {
        const context = await browser.newContext()
        const page = await context.newPage()
        if (published) await open(page, width, notFound)
        else {
          await page.setViewportSize({ width, height: 900 })
          await page.emulateMedia({ reducedMotion: 'reduce' })
          await page.route('**/api/site', (route) =>
            route.fulfill({
              status: 404,
              contentType: 'application/json',
              json: { error: { code: 'CMS_NOT_PUBLISHED', message: 'x' } },
            }),
          )
          await page.goto('/')
          await expect(page.locator('#chopes table')).toBeVisible()
        }
        const hero = page.getByRole('img', { name: /Barril de chopp .* 50 litros/ })
        await expect(hero).toBeVisible()
        await page.locator('#sobre').scrollIntoViewIfNeeded()
        const about = page.locator('#sobre img').first()
        await expect(about).toBeVisible()
        const describe = (e: HTMLImageElement) => {
          const style = getComputedStyle(e)
          const rect = e.getBoundingClientRect()
          return {
            src: e.getAttribute('src'),
            alt: e.alt,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            fit: style.objectFit,
            maxWidth: style.maxWidth,
            filter: style.filter,
            position: style.position,
          }
        }
        const result = [await hero.evaluate(describe), await about.evaluate(describe)]
        await context.close()
        return result
      }
      expect(await measure(true)).toEqual(await measure(false))
    })

    test('requests only the new media after the publication changes', async ({ page }) => {
      const first = await open(page, width, ok)
      await expect(page.getByRole('img', { name: 'Imagem editorial do hero' })).toBeVisible()
      expect(first.some((p) => p.includes(HERO_ID))).toBe(true)
      const next: string[] = []
      await page.unroute('**/api/site')
      await page.unroute('**/api/site/media/**')
      await page.route('**/api/site', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          json: site(OTHER_ID, ABOUT_ID),
        }),
      )
      await page.route('**/api/site/media/**', (route) => {
        next.push(new URL(route.request().url()).pathname)
        // The replaced media is revoked by the endpoint.
        return route.request().url().includes(HERO_ID) ? notFound(route) : ok(route)
      })
      await page.reload()
      await expect(page.getByRole('img', { name: 'Imagem editorial do hero' })).toHaveAttribute(
        'src',
        `/api/site/media/${OTHER_ID}/hero`,
      )
      expect(next.some((p) => p.includes(HERO_ID))).toBe(false)
    })
  })
}

test('default presentation (no publication) never requests media', async ({ page }) => {
  const requested: string[] = []
  await page.route('**/api/site/media/**', (route) => {
    requested.push(route.request().url())
    return notFound(route)
  })
  await page.route('**/api/site', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      json: { error: { code: 'CMS_NOT_PUBLISHED', message: 'x' } },
    }),
  )
  await page.goto('/')
  await expect(page.locator('#chopes table')).toBeVisible()
  expect(requested).toEqual([])
  await expect(page.getByRole('img', { name: /Barril de chopp .* 50 litros/ })).toBeVisible()
})
