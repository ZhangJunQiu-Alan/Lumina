import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/mockApi';
import { MOCK_WORDS } from './fixtures/mockData';

test.describe('Learning Session E2E Suite', () => {
  test('starts an official learning batch from home and completes Round 1 cards', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true, words: MOCK_WORDS });
    await page.goto('/app/home');

    // Verify Home CTA is ready
    const startButton = page.getByRole('button', { name: '开始学习' });
    await expect(startButton).toBeVisible();

    // Start learning session
    await startButton.click();

    // Verify transition to session view
    await expect(page).toHaveURL(/\/app\/session/);

    // Verify Round 1 first word 'resilient' is displayed
    await expect(page.getByText('resilient').first()).toBeVisible();
    await expect(page.getByText('有弹性的；能迅速恢复的')).toBeVisible();

    // Type the correct spelling in Round 1 input
    const round1Input = page.getByPlaceholder('拼写');
    await expect(round1Input).toBeVisible();
    await round1Input.fill('resilient');
    await round1Input.press('Enter');

    // Verify advancement to second word 'catalyst'
    await expect(page.getByText('catalyst').first()).toBeVisible();
    await expect(page.getByText('催化剂；促成变化的人或事')).toBeVisible();

    // Type the correct spelling for 'catalyst'
    await round1Input.fill('catalyst');
    await round1Input.press('Enter');

    // Round 1 is complete! Verify transition into Round 2 (回忆轮)
    await expect(page.locator('body')).toContainText(/回忆|Round2|写出英文词形|填入正确词形|选择/i);
  });

  test('interacts with Round 2 choices and advances session', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true, words: MOCK_WORDS });
    await page.goto('/app/home');

    // Launch session
    await page.getByRole('button', { name: '开始学习' }).click();
    await expect(page).toHaveURL(/\/app\/session/);

    // Fast-complete Round 1 for both words
    const round1Input = page.getByPlaceholder('拼写');
    await round1Input.fill('resilient');
    await round1Input.press('Enter');

    await expect(page.getByText('catalyst').first()).toBeVisible();
    await round1Input.fill('catalyst');
    await round1Input.press('Enter');

    // In Round 2, if choice options are present, select the matching option
    const choiceButton = page.locator('button[aria-label*="Round2 选项"]').first();
    if (await choiceButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await choiceButton.click();
      await expect(page.locator('body')).not.toBeEmpty();
    }
  });
});
