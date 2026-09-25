import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/mockApi';

test.describe('Auth Journey E2E Suite', () => {
  test('redirects unauthenticated user from protected routes to /auth', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false });

    // Attempt to access protected /app/home
    await page.goto('/app/home');

    // Should be redirected to /auth with next query param
    await expect(page).toHaveURL(/\/auth\?next=%2Fapp%2Fhome/);
    await expect(page.getByRole('heading', { name: '登录并继续学习', level: 2 })).toBeVisible();
  });

  test('allows toggling between login and register modes', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false });
    await page.goto('/auth');

    // Default is login
    await expect(page.getByRole('heading', { name: '登录并继续学习', level: 2 })).toBeVisible();
    await expect(page.getByRole('button', { name: '用邮箱登录' })).toBeVisible();

    // Click register tab
    await page.getByRole('tab', { name: '注册' }).click();

    // Verify register fields visible
    await expect(page.getByRole('heading', { name: '创建 Lumina 账号', level: 2 })).toBeVisible();
    await expect(page.getByPlaceholder('例如：Alex Chen')).toBeVisible();
    await expect(page.getByRole('button', { name: '创建账号' })).toBeVisible();

    // Switch back to login
    await page.getByRole('tab', { name: '登录' }).click();
    await expect(page.getByRole('heading', { name: '登录并继续学习', level: 2 })).toBeVisible();
  });

  test('successfully logs in and navigates to the home dashboard', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false });
    await page.goto('/auth?next=%2Fapp%2Fhome');

    // Fill in email and password
    await page.getByPlaceholder('you@example.com').fill('tester@lumina.io');
    await page.getByPlaceholder('输入一个至少 8 位的密码').fill('SecretPassword123');

    // Submit login form
    await page.getByRole('button', { name: '用邮箱登录' }).click();

    // Should successfully navigate to /app/home
    await expect(page).toHaveURL(/\/app\/home/);
    await expect(page.getByRole('heading', { name: '今日学习' })).toBeVisible();
    await expect(page.getByRole('button', { name: '开始学习' })).toBeVisible();
  });

  test('navigates to user profile and logs out successfully', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true });
    await page.goto('/app/home');

    // Verify authenticated home view is shown
    await expect(page.getByRole('heading', { name: '今日学习' })).toBeVisible();

    // Click on Profile in sidebar
    await page.getByRole('button', { name: '账号' }).click();
    await expect(page).toHaveURL(/\/app\/profile/);
    await expect(page.getByText('tester@lumina.io')).toBeVisible();

    // Click Sign Out button
    await page.getByRole('button', { name: '退出当前账号' }).click();

    // Should redirect to landing page
    await expect(page).toHaveURL('/');
  });
});
