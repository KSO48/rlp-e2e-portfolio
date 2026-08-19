import { test, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

import { launchChromiumGost } from './chromiumGost';
import { signStatement } from './statementSigning';
import { loginAs, forceLogout } from './users';
import { runFullApprovalChain } from './approvalChain';
import { openRegistrationNumberDropdown, selectPriceFromRegistry } from './statementCreation';
import {
  DEV01_BASE_URL,
  dev01Applicant as applicant,
  dev01ResponsibleMz,
  dev01HeadOfDepartment,
  dev01Signer,
  dev01FasExecutor,
  DEV01_RESPONSIBLE_MZ_ASSIGN_NAME,
  DEV01_FAS_EXECUTOR_ASSIGN_NAME,
} from './dev01Users';

// ============================================================
// ПОЛНАЯ ДЕФЕКТУРА ДЛЯ СТЕНДА DEV01 (<dev-stand-url>)
// Аналог test_regress3_defectura.spec.ts — переиспользует обобщённый
// runFullApprovalChain (approvalChain.ts) с пользователями/baseUrl/
// проверкой маршрута ЭДО dev01. Документ после письма МЗ — заключение
// Росздравнадзора (не ФГБУ НЦЭСМП).
//
// НЕ прогонялся целиком на dev01 — построен по образцу подтверждённого
// dev_smoke3_defectura.spec.ts / dev_regress1_registration.spec.ts.
// ============================================================

test('test', async () => {
  const { context, page } = await launchChromiumGost();

  try {
    // ============================================================
    // ШАГ 1: ЛОГИН И ПЕРЕХОД В ЛИЧНЫЙ КАБИНЕТ
    // ============================================================
    await page.goto(`${DEV01_BASE_URL}/`);
    await forceLogout(page, DEV01_BASE_URL);
    await loginAs(page, applicant);

    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000);

    await page.waitForSelector('button:has-text("Получить услугу")', {
      state: 'visible',
      timeout: 40000,
    });

    // ============================================================
    // ШАГ 2: ВЫБОР УСЛУГИ
    // ============================================================
    await page.getByRole('button', { name: 'Получить услугу' }).click();
    await page.waitForTimeout(1000);
    await page.getByText('Перерегистрация ПОЦ в целях дефектуры').click();
    await page.waitForTimeout(1000);

    // ============================================================
    // ШАГ 3: ВЫБОР ЛЕКАРСТВА И ЦЕНЫ
    // ============================================================
    const searchInput = await openRegistrationNumberDropdown(page);
    await searchInput.click();
    await searchInput.fill('ЛП-007476');
    await page.waitForTimeout(300);
    await page.getByText('ЛП-007476').click();
    await page.waitForTimeout(1000);

    await selectPriceFromRegistry(page, '3499.99');

    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.waitForTimeout(1000);

    // ============================================================
    // ШАГ 4: ЗАПОЛНЕНИЕ EMAIL
    // ============================================================
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.waitForTimeout(1000);

    // ============================================================
    // ШАГ 5: ПРОМЕЖУТОЧНЫЕ ШАГИ
    // ============================================================
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.waitForTimeout(1000);

    // ============================================================
    // ШАГ 6: ЗАПОЛНЕНИЕ НОВОЙ ЦЕНЫ
    // ============================================================
    let newPrice: number;
    let newPriceStr: string;
    do {
      newPrice = 2999 + Math.random() * 1000;
      newPriceStr = newPrice.toFixed(2);
    } while (newPriceStr.endsWith('0') || newPriceStr.endsWith('00'));
    console.log(`📌 Новая цена: ${newPriceStr}`);

    const priceInput = page.locator('input[name="newPriceLimitValue"]');
    await priceInput.waitFor({ state: 'visible', timeout: 10000 });
    await priceInput.click();
    await priceInput.clear();
    await priceInput.fill(newPriceStr);
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.waitForTimeout(1000);

    await page.waitForSelector('text=Стадии производства', { state: 'visible', timeout: 10000 });

    // ============================================================
    // ШАГ 7: СТАДИИ ПРОИЗВОДСТВА
    // ============================================================
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.waitForTimeout(1000);
    await page.waitForSelector('text=Документы', { state: 'visible', timeout: 30000 });

    // ============================================================
    // ШАГ 8: ЗАГРУЗКА ДОКУМЕНТОВ
    // ============================================================
    const documents = [
      {
        file: 'docs/Документ, подтверждающий полномочия представителя заявителя.pdf',
        sig: 'docs/Документ, подтверждающий полномочия представителя заявителя.sig',
        pages: '1',
      },
      {
        file: 'docs/Подтверждение фактических затрат на сырье и материалы на день принятия решения о государственной регистрации предельной отпускной цены.pdf',
        sig: 'docs/Подтверждение фактических затрат на сырье и материалы на день принятия решения о государственной регистрации предельной отпускной цены.sig',
        pages: '2',
      },
      {
        file: 'docs/Заявление о государственной регистрации предельных отпускных цен производителей на лекарственные препараты, включенные в перечень ЖНВЛП.pdf',
        sig: 'docs/Заявление о государственной регистрации предельных отпускных цен производителей на лекарственные препараты, включенные в перечень ЖНВЛП.sig',
        pages: '3',
      },
    ];

    const addButtons = page.locator('._tags_6dq72_135 button');

    for (let i = 0; i < documents.length; i++) {
      const addButton = addButtons.nth(i);
      await addButton.waitFor({ state: 'visible', timeout: 10000 });
      await addButton.click();
      await page.waitForTimeout(1000);

      await page.waitForSelector('text=Добавление документа', { state: 'visible', timeout: 10000 });

      const fileInput = page.locator('input[type="file"]').last();
      await fileInput.setInputFiles([documents[i].file, documents[i].sig]);
      await page.waitForTimeout(300);

      const spinButton = page.getByRole('spinbutton', { name: 'Введите кол-во страниц' });
      await spinButton.waitFor({ state: 'visible', timeout: 10000 });
      await spinButton.fill(documents[i].pages);
      await page.waitForTimeout(300);

      await page.waitForSelector('text=Подпись подтверждена', { state: 'visible', timeout: 10000 });
      await page.waitForTimeout(500);

      const confirmButton = page.getByRole('button', { name: 'Добавить' });
      await confirmButton.waitFor({ state: 'visible', timeout: 10000 });
      await confirmButton.click({ force: true });
      await page.waitForTimeout(1000);

      await page.waitForSelector('text=Добавление документа', { state: 'hidden', timeout: 10000 });

      const fileName = documents[i].file.split('/').pop() || documents[i].file;
      await page.waitForSelector(`text=${fileName}`, { state: 'visible', timeout: 10000 });
      await page.waitForTimeout(500);
    }

    // ============================================================
    // ШАГ 9: СОЗДАНИЕ ЗАЯВЛЕНИЯ
    // ============================================================
    await page.waitForSelector('button:has-text("Сформировать заявление"):not([disabled])', {
      state: 'visible',
      timeout: 60000,
    });
    await page.getByRole('button', { name: 'Сформировать заявление' }).click();

    await page.waitForURL(/\/price-limit\/statements\/details\/.+/, { timeout: 60000 });
    const statementUrl = page.url();
    console.log(`🔗 Ссылка на заявление: ${statementUrl}`);

    await page.waitForSelector('[data-automationid="price-limit-statement-page"]', {
      state: 'visible',
      timeout: 30000,
    });
    console.log('✅ Заявление создано');

    // ============================================================
    // ПОДПИСАНИЕ ЗАЯВЛЕНИЯ
    // ============================================================
    await signStatement(page);
    console.log('✅ Заявление подписано');

    // ============================================================
    // ПОЛНАЯ ЦЕПОЧКА СОГЛАСОВАНИЯ (МЗ → ФАС → решения → "Услуга оказана")
    // ============================================================
    const statement = { number: 1, price: newPriceStr, url: statementUrl };

    const generateReplyPrice = (): string => {
      let price: number;
      let priceStr: string;
      do {
        price = 2999 + Math.random() * 1000;
        priceStr = price.toFixed(2);
      } while (priceStr.endsWith('0') || priceStr.endsWith('00'));
      return priceStr;
    };

    const fillPriceOnlyResponse = (logPrefix: string) => async (p: Page) => {
      const priceStr = generateReplyPrice();
      console.log(`📌 Новая цена по запросу ${logPrefix}: ${priceStr}`);

      const replyPriceInput = p.locator('input[name="newPriceLimitValue"]');
      await replyPriceInput.waitFor({ state: 'visible', timeout: 10000 });
      await replyPriceInput.click();
      await replyPriceInput.clear();
      await replyPriceInput.fill(priceStr);
      await p.waitForTimeout(300);
    };

    await runFullApprovalChain(page, {
      applicant,
      statement,
      fillMzResponseFields: fillPriceOnlyResponse('МЗ'),
      fillFasResponseFields: fillPriceOnlyResponse('ФАС'),
      document: {
        filePath: 'docs/заключение Росздравнадзора.pdf',
        openButtonName: 'Загрузка заключения Росздравнадзора',
        modalHeadingText: 'Добавить заключение Росздравнадзора',
        numberFieldLabel: 'Номер заключения Росздравнадзора',
        dateFieldLabel: 'Дата заключения Росздравнадзора',
      },
      finalDecisionText: 'Решение о государственной перерегистрации предельной отпускной цены в целях дефектуры',

      // Специфика dev01
      responsibleMz: dev01ResponsibleMz,
      headOfDepartment: dev01HeadOfDepartment,
      signer: dev01Signer,
      fasExecutor: dev01FasExecutor,
      baseUrl: DEV01_BASE_URL,
      assignMzName: DEV01_RESPONSIBLE_MZ_ASSIGN_NAME,
      assignFasName: DEV01_FAS_EXECUTOR_ASSIGN_NAME,
      ensureEdoRoute: true,
    });

    // ============================================================
    // СОХРАНЕНИЕ РЕЗУЛЬТАТОВ В ФАЙЛ
    // ============================================================
    const filePath = path.join(__dirname, 'statements_report.txt');
    const fileContent =
      '========================================\n' +
      'ОТЧЕТ О СОЗДАНИИ ЗАЯВЛЕНИЯ (Дефектура, регресс, dev01)\n' +
      `Дата: ${new Date().toLocaleString()}\n` +
      '========================================\n\n' +
      `Цена: ${statement.price}\n` +
      `Ссылка: ${statement.url}\n\n` +
      '========================================\n' +
      'Конец отчета\n';
    fs.writeFileSync(filePath, fileContent, 'utf8');
    console.log(`✅ Отчет сохранен в файл: ${filePath}`);

    console.log('\n✅ Регресс-тест дефектуры на dev01 пройден!');
  } finally {
    await context.close();
  }
});
