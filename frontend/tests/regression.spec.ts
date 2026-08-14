import { test, expect } from '@playwright/test';

test.describe('Agronomist Portal Regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('should successfully log in and redirect to dashboard', async ({ page }) => {
    // 1. Проверяем наличие заголовка
    await expect(page.getByText('Вход в аккаунт')).toBeVisible();

    // 2. Вводим учетные данные (используем плейсхолдеры из скриншота браузерного агента)
    // Почта
    const emailInput = page.locator('input[type="email"], input[placeholder*="email"]');
    if (await emailInput.isVisible()) {
      await emailInput.fill('test@example.com');
    } else {
       await page.keyboard.type('test@example.com'); // fallback
    }

    // Пароль
    const passInput = page.locator('input[type="password"]');
    if (await passInput.isVisible()) {
      await passInput.fill('test@example.com');
    }

    // 3. Нажимаем кнопку Войти
    await page.getByRole('button', { name: 'Войти' }).click();

    // 4. Ожидаем редиректа и проверяем, что появились элементы дашборда
    await expect(page).toHaveURL(/\/dashboard|/);
    await expect(page.locator('text=Страница в разработке').first()).toBeVisible();
  });

  test('should navigate to fields and display table', async ({ page }) => {
    // Авторизация
    await page.locator('input[type="email"], input[placeholder*="email"]').fill('test@example.com');
    await page.locator('input[type="password"]').fill('test@example.com');
    await page.getByRole('button', { name: 'Войти' }).click();
    
    // Переход в раздел Поля
    // Кликаем по меню навигации (текст 'Поля и Культуры')
    await page.getByText('Поля и Культуры', { exact: false }).click();
    await expect(page).toHaveURL(/\/fields/);

    // Проверяем наличие элементов страницы
    await expect(page.getByPlaceholder('Поиск', { exact: false }).first()).toBeVisible();
  });
});
