import { test, expect, type Page } from '@playwright/test';
import { setupApiMocks } from './fixtures/mockApi';

async function expectContentToFit(page: Page, selector: string) {
  await expect
    .poll(() =>
      page.locator(selector).evaluateAll((elements) =>
        elements
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => ({
            element: element.className,
            overflow: element.scrollWidth - element.clientWidth,
            overflowingChildren: Array.from(element.querySelectorAll('*'))
              .filter((child) => child.getBoundingClientRect().right > element.getBoundingClientRect().right + 2)
              .slice(0, 8)
              .map((child) => child.getAttribute('class')),
          }))
          .filter(({ overflow }) => overflow > 2),
      ),
    )
    .toEqual([]);
}

for (const width of [320, 390, 600, 800, 1024, 1280, 1440]) {
  test.describe(`Responsive layout at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });

    test('application pages and settings fit their available width', async ({ page }) => {
      test.setTimeout(90000);
      await setupApiMocks(page);
      await page.route('**/rest/v1/user_settings*', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        return route.fulfill({ status: 200, json: route.request().postDataJSON() });
      });

      for (const [route, heading] of [
        ['/app/home', '今日学习'],
        ['/app/library', '词库'],
        ['/app/ielts', '剑桥雅思真题训练'],
        ['/app/ielts-reading', '雅思阅读真题训练'],
        ['/app/notebook', '生词本'],
        ['/app/profile', '暂无学习记录'],
        ['/app/settings', '学习设置'],
      ]) {
        await page.goto(route);
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 20000 });
        if (route === '/app/home' && width < 1024) {
          const start = await page.getByRole('button', { name: '开始学习', exact: true }).boundingBox();
          expect(start).not.toBeNull();
          expect(start!.y + start!.height).toBeLessThan(828);
        }
        if (route === '/app/library') {
          await page.getByRole('button', { name: '官方词库', exact: true }).click();
          await expect(page.locator('.library-card-grid')).toBeVisible();
        }
        await expectContentToFit(page, '.lumina-app-main, .fluid-grid, .home-orbit-grid, .setting-row');
      }

      const options = page.locator('.setting-options').first();
      await expect(options).toBeVisible();
      await expectContentToFit(page, '.setting-options');
      const usOption = options.getByRole('button', { name: 'US', exact: true });
      await usOption.click();
      await expect(usOption).toHaveAttribute('aria-pressed', 'true');
    });

    test('public pages fit the viewport', async ({ page }) => {
      await setupApiMocks(page, { authenticated: false });

      for (const route of ['/', '/auth', '/privacy', '/terms']) {
        await page.goto(route);
        await expect(page.getByRole('heading').first()).toBeVisible();
        await expectContentToFit(page, 'body, .auth-shell, .legal-document, .landing-longform');
      }
    });
  });
}

test('learning cards and the settings drawer fit a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await setupApiMocks(page);
  await page.goto('/app/home');
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/session/);
  await expect(page.getByPlaceholder('拼写')).toBeVisible();
  await expectContentToFit(page, '.lumina-app-main, .fluid-grid, .home-orbit-grid');
  await page.locator('[data-session-settings-toggle]').click();
  await expect(page.getByRole('dialog', { name: '学习设置' })).toBeVisible();
  await expectContentToFit(page, '[data-session-settings-panel], .setting-row, .setting-options');
});

test('home and preferences reflow with enlarged text', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = '200%';
    });
  });
  await setupApiMocks(page);

  for (const [route, heading] of [
    ['/app/home', '今日学习'],
    ['/app/settings', '学习设置'],
  ]) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expectContentToFit(page, '.lumina-app-main, .fluid-grid, .home-orbit-grid, .setting-row, .setting-options');
  }
});

test('mobile reading tools expand without blocking passage and question navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupApiMocks(page);
  await page.route('**/rest/v1/ielts_reading_tests*', (route) =>
    route.fulfill({
      status: 200,
      json: {
        id: 'responsive-reading',
        test_number: 1,
        ielts_reading_books: { id: 'book', book_number: 4, title: 'Cambridge IELTS 4' },
        ielts_reading_passages: [
          {
            id: 'passage',
            passage_number: 1,
            title: 'A resilient city',
            body: 'A resilient city adapts to changing conditions.',
            ielts_reading_question_groups: [
              {
                id: 'questions',
                question_type: 'multiple_choice_single',
                prompt: 'Choose the correct letter.',
                ielts_reading_questions: [
                  {
                    id: 'question',
                    question_number: 1,
                    prompt: 'What does the city do?',
                    options_json: ['It adapts.', 'It stops.'],
                    answer_json: ['A'],
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  );
  await page.goto('/app/ielts-reading/test/responsive-reading');
  const tools = page.locator('details').filter({ hasText: '阅读工具 · 字号、高亮、笔记' });
  await expect(tools).not.toHaveAttribute('open');
  await tools.locator('summary').click();
  await page.getByRole('button', { name: '增大原文字号', exact: true }).click();
  await expect(tools.getByText('18', { exact: true })).toBeVisible();
  await tools.locator('summary').click();
  await page.getByRole('button', { name: '题目', exact: true }).click();
  await expect(page.getByText('What does the city do?', { exact: true })).toBeVisible();
  await expectContentToFit(page, '.lumina-app-main');
});
