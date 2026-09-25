import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/mockApi';
import { createMockHomeStats, MOCK_WORDS } from './fixtures/mockData';

test.describe('Daily Review E2E Suite', () => {
  test('launches daily review from Home, answers review prompt, and views results', async ({ page }) => {
    const reviewWords = [
      {
        ...MOCK_WORDS[0],
        memoryState: 'fuzzy' as const,
        nextReviewAt: new Date().toISOString(),
        lastResult: null,
      },
    ];
    await setupApiMocks(page, {
      authenticated: true,
      homeStats: createMockHomeStats('start_review'),
      reviewWords,
    });

    await page.goto('/app/home');

    // Verify Review CTA is visible
    const reviewButton = page.getByRole('button', { name: '开始复习' });
    await expect(reviewButton).toBeVisible();

    // Launch review
    await reviewButton.click();

    // Verify session route
    await expect(page).toHaveURL(/\/app\/session/);

    // Verify Review prompt displays the Chinese definition
    await expect(page.getByText('有弹性的；能迅速恢复的')).toBeVisible();

    // Type the answer into the spelling input
    const spellingInput = page.getByLabel('拼写输入');
    await expect(spellingInput).toBeVisible();
    await spellingInput.fill('resilient');
    await spellingInput.press('Enter');

    // After completing the review queue, should transition to review-results
    await expect(page).toHaveURL(/\/app\/review-results/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: '本轮已完成' })).toBeVisible();
    await expect(page.getByText('resilient').first()).toBeVisible();

    // Click button to return home
    const backHomeButton = page.getByRole('button', { name: /返回今日学习|回首页/i });
    await expect(backHomeButton).toBeVisible();
    await backHomeButton.click();

    // Successfully returns to home
    await expect(page).toHaveURL(/\/app\/home/);
    await expect(page.getByRole('heading', { name: '今日学习' })).toBeVisible();
  });
});
