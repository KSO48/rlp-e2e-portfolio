import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

import { launchChromiumGost } from './chromiumGost';
import { signStatement } from './statementSigning';
import { loginAs, forceLogout, switchUser } from './users';
import { runMzApproval, switchUserAndOpenRequest, createMzRequest } from './mzApprovalFlow';
import { assignExecutor, skipIntermediateSteps, createStatement, waitForTextWithReload, ensureEdoParticipant, selectPriceFromRegistry } from './statementCreation';
import {
  DEV01_BASE_URL,
  dev01Applicant as applicant,
  dev01ResponsibleMz as responsibleMz,
  dev01HeadOfDepartment as headOfDepartment,
  dev01Signer as signer,
  DEV01_RESPONSIBLE_MZ_ASSIGN_NAME,
} from './dev01Users';

// ============================================================
// ПОЛНОЕ СНИЖЕНИЕ ЦЕНЫ ДЛЯ СТЕНДА DEV01 (<dev-stand-url>)
// Аналог test_regress4_decrease.spec.ts (без ФАС — в снижении ФАС не
// участвует), не переиспользует approvalChain.ts. Пользователи/baseUrl/
// проверка маршрута ЭДО — dev01.
//
// НЕ прогонялся целиком на dev01 — построен по образцу подтверждённого
// dev_smoke4_decrease.spec.ts.
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
    await page.getByText('Перерегистрация ПОЦ в целях снижения цены').click();
    await page.waitForTimeout(1000);

    // ============================================================
    // ШАГ 3: ВЫБОР ЛЕКАРСТВА И ЦЕНЫ
    // ============================================================
    await page.locator('[data-field-name="registrationNumber"] ._selectValue_njmme_55').click();
    await page.waitForTimeout(3000);

    const searchInput = page.getByRole('textbox', { name: 'Поиск' });
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
      newPrice = 2999 + Math.random() * 500;
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
    // ЦЕПОЧКА СОГЛАСОВАНИЯ — БЕЗ ФАС
    // ============================================================

    // ============================================================
    // ПЕРЕКЛЮЧЕНИЕ: ЗАЯВИТЕЛЬ → ОТВЕТСТВЕННЫЙ МЗ
    // ============================================================
    await switchUser(page, applicant, responsibleMz, DEV01_BASE_URL);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000);

    await page.goto(statementUrl);
    await page.waitForSelector('[data-automationid="price-limit-statement-page"]', {
      state: 'visible',
      timeout: 30000,
    });
    console.log(`✅ Заявление открыто под ${responsibleMz.name}`);

    // ============================================================
    // ОЖИДАНИЕ "НАЗНАЧИТЬ ИСПОЛНИТЕЛЯ"
    // ============================================================
    const assignButtonLocator = page.getByRole('button', { name: 'Назначить исполнителя' });
    let assignButtonVisible = await assignButtonLocator.isVisible().catch(() => false);
    const pollStartedAt = Date.now();
    const maxPollDurationMs = 3 * 60 * 1000;

    while (!assignButtonVisible && Date.now() - pollStartedAt < maxPollDurationMs) {
      console.log('⏳ Кнопка "Назначить исполнителя" ещё не появилась — обновляю страницу...');
      await page.reload();
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(5000);
      assignButtonVisible = await assignButtonLocator.isVisible().catch(() => false);
    }

    if (!assignButtonVisible) {
      await page.screenshot({ path: 'dev01-assign-button-timeout.png', fullPage: true }).catch(() => {});
      throw new Error(
        'Кнопка "Назначить исполнителя" не появилась за 3 минуты. Скриншот: dev01-assign-button-timeout.png',
      );
    }
    console.log('✅ Кнопка "Назначить исполнителя" появилась');

    await assignExecutor(page, 'Михайлов', DEV01_RESPONSIBLE_MZ_ASSIGN_NAME);

    // ============================================================
    // ЗАПРОС МИНЗДРАВА О ПРЕДОСТАВЛЕНИИ МАТЕРИАЛОВ
    // ============================================================
    const requestUrl = await createMzRequest(page, {
      openButtonName: 'Запрос',
      menuItemText: 'Запрос Минздрава России о представлении необходимых материалов (документы, сведения)',
      dialogHeadingText: 'Запрос Минздрава России о представлении необходимых материалов (документы, сведения)',
      messageText: 'Запрос Минздрава России о представлении необходимых материалов (документы, сведения)',
      sendMenuItemText: 'Направить запрос на согласование',
      beforeConfirmSend: async p => {
        await ensureEdoParticipant(p, 'Исполнитель', 'Михайлов');
        await ensureEdoParticipant(p, 'Согласующий', 'Соколова');
        await ensureEdoParticipant(p, 'Подписант', 'Федотов');
      },
    });
    console.log('✅ Запрос Минздрава направлен на согласование');

    // ============================================================
    // СОГЛАСОВАНИЕ + ПОДПИСАНИЕ ЗАПРОСА (стандартная цепочка МЗ)
    // ============================================================
    await runMzApproval(page, {
      fromUser: responsibleMz,
      approver: headOfDepartment,
      signer,
      requestUrl,
      baseUrl: DEV01_BASE_URL,
    });

    // ============================================================
    // ПЕРЕКЛЮЧЕНИЕ: ФЕДОТОВ → ИЛЬИН
    // ============================================================
    await switchUserAndOpenRequest(page, signer, applicant, requestUrl, DEV01_BASE_URL);
    console.log(`✅ Запрос открыт под ${applicant.name}`);

    // ============================================================
    // ОТВЕТ НА ЗАПРОС: РЕДАКТИРОВАНИЕ ЦЕНЫ
    // ============================================================
    await page.getByRole('button', { name: 'Ответ' }).click();
    await page.waitForTimeout(1000);

    await skipIntermediateSteps(page, 4);

    let mzReplyPrice: number;
    let mzReplyPriceStr: string;
    do {
      mzReplyPrice = 2999 + Math.random() * 500;
      mzReplyPriceStr = mzReplyPrice.toFixed(2);
    } while (mzReplyPriceStr.endsWith('0') || mzReplyPriceStr.endsWith('00'));
    console.log(`📌 Новая цена по запросу МЗ: ${mzReplyPriceStr}`);

    const mzReplyPriceInput = page.locator('input[name="newPriceLimitValue"]');
    await mzReplyPriceInput.waitFor({ state: 'visible', timeout: 10000 });
    await mzReplyPriceInput.click();
    await mzReplyPriceInput.clear();
    await mzReplyPriceInput.fill(mzReplyPriceStr);
    await page.waitForTimeout(300);

    await skipIntermediateSteps(page, 2);

    // ============================================================
    // ПОВТОРНОЕ ФОРМИРОВАНИЕ И ПОДПИСАНИЕ ОТРЕДАКТИРОВАННОГО ЗАЯВЛЕНИЯ
    // ============================================================
    await createStatement(page);
    await signStatement(page);
    console.log('✅ Отредактированное заявление подписано');

    // ============================================================
    // ПЕРЕКЛЮЧЕНИЕ: ИЛЬИН → МИХАЙЛОВ (повторно)
    // ============================================================
    await switchUser(page, applicant, responsibleMz, DEV01_BASE_URL);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000);

    await page.goto(statementUrl);
    await page.waitForSelector('[data-automationid="price-limit-statement-page"]', {
      state: 'visible',
      timeout: 30000,
    });
    console.log(`✅ Заявление снова открыто под ${responsibleMz.name}`);

    // ============================================================
    // ВЫНЕСЕНИЕ ПОЛОЖИТЕЛЬНОГО РЕШЕНИЯ (без письма в ФАС)
    // ============================================================
    const decisionUrl = await createMzRequest(page, {
      openButtonName: 'Вынести решение',
      menuItemText: 'Решение о государственной перерегистрации предельной отпускной цены в целях снижения',
      dialogHeadingText: 'Решение о государственной перерегистрации предельной отпускной цены в целях снижения',
      createButtonText: 'Создать решение',
      messageText: 'Решение о государственной перерегистрации предельной отпускной цены в целях снижения',
      sendMenuItemText: 'Направить решение на согласование',
      beforeConfirmSend: async p => {
        await ensureEdoParticipant(p, 'Исполнитель', 'Михайлов');
        await ensureEdoParticipant(p, 'Согласующий', 'Соколова');
        await ensureEdoParticipant(p, 'Подписант', 'Федотов');
      },
    });
    console.log('✅ Решение направлено на согласование');

    // ============================================================
    // СОГЛАСОВАНИЕ + ПОДПИСАНИЕ РЕШЕНИЯ (та же цепочка МЗ)
    // ============================================================
    await runMzApproval(page, {
      fromUser: responsibleMz,
      approver: headOfDepartment,
      signer,
      requestUrl: decisionUrl,
      expectedStatus: null,
      baseUrl: DEV01_BASE_URL,
    });

    // ============================================================
    // ФИНАЛЬНАЯ ПРОВЕРКА: СТАТУС ЗАЯВЛЕНИЯ "УСЛУГА ОКАЗАНА"
    // ============================================================
    await page.goto(statementUrl);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000);
    await waitForTextWithReload(page, 'Услуга оказана');
    console.log('✅ Заявление в финальном статусе: Услуга оказана');

    // ============================================================
    // СОХРАНЕНИЕ РЕЗУЛЬТАТОВ В ФАЙЛ
    // ============================================================
    const filePath = path.join(__dirname, 'statements_report.txt');
    const fileContent =
      '========================================\n' +
      'ОТЧЕТ О СОЗДАНИИ ЗАЯВЛЕНИЯ (Снижение цены, регресс, dev01)\n' +
      `Дата: ${new Date().toLocaleString()}\n` +
      '========================================\n\n' +
      `Цена: ${newPriceStr}\n` +
      `Ссылка: ${statementUrl}\n\n` +
      '========================================\n' +
      'Конец отчета\n';
    fs.writeFileSync(filePath, fileContent, 'utf8');
    console.log(`✅ Отчет сохранен в файл: ${filePath}`);

    console.log('\n✅ Регресс-тест снижения цены на dev01 пройден!');
  } finally {
    await context.close();
  }
});
