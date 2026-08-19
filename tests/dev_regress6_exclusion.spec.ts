import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

import { launchChromiumGost } from './chromiumGost';
import { signStatement } from './statementSigning';
import { loginAs, forceLogout, switchUser } from './users';
import { runMzApproval, switchUserAndOpenRequest, createMzRequest } from './mzApprovalFlow';
import {
  assignExecutor,
  skipIntermediateSteps,
  createStatement,
  waitForTextWithReload,
  openRegistrationNumberDropdown,
  generateRandomTestEmail,
  ensureEdoParticipant,
  selectPriceFromRegistry,
} from './statementCreation';
import {
  DEV01_BASE_URL,
  dev01Applicant as applicant,
  dev01ResponsibleMz as responsibleMz,
  dev01HeadOfDepartment as headOfDepartment,
  dev01Signer as signer,
  DEV01_RESPONSIBLE_MZ_ASSIGN_NAME,
} from './dev01Users';

// ============================================================
// ПОЛНОЕ ИСКЛЮЧЕНИЕ ПОЦ ДЛЯ СТЕНДА DEV01 (<dev-stand-url>)
// Аналог test_regress6_exclusion.spec.ts (без ФАС), не переиспользует
// approvalChain.ts. Пользователи/baseUrl/проверка маршрута ЭДО — dev01.
//
// НЕ прогонялся целиком на dev01 — построен по образцу подтверждённого
// dev_smoke6_exclusion.spec.ts / dev_regress4_decrease.spec.ts.
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
    await page.getByText('Исключение ПОЦ').click();
    await page.waitForTimeout(1000);

    // ============================================================
    // ШАГ 3: ВЫБОР РУ, ПОЦ И ПРИЧИНЫ ИСКЛЮЧЕНИЯ
    // ============================================================
    const searchInput = await openRegistrationNumberDropdown(page);
    await searchInput.click();
    await searchInput.fill('ЛП-007476');
    await page.waitForTimeout(300);
    await page.getByText('ЛП-007476').click();
    await page.waitForTimeout(1000);

    await selectPriceFromRegistry(page, '3499.99');
    await page.waitForTimeout(1000);

    const reasonDropdown = page.getByText('Выберите причину исключения');
    await reasonDropdown.click();
    await page.waitForTimeout(500);

    const reasonSearchInput = page.getByRole('textbox', { name: 'Поиск' }).last();
    await reasonSearchInput.click();
    await reasonSearchInput.fill('Истечение срока годности');
    await page.waitForTimeout(300);
    await page.getByText('Истечение срока годности').first().click();
    await page.waitForTimeout(500);

    // ============================================================
    // ШАГ 4: 6 РАЗ "ПРОДОЛЖИТЬ" ДО ЭКРАНА "ДОКУМЕНТЫ"
    // ============================================================
    await skipIntermediateSteps(page, 6);

    // ============================================================
    // ШАГ 5: ЗАГРУЗКА ДОКУМЕНТОВ
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
    // ШАГ 6: СОЗДАНИЕ ЗАЯВЛЕНИЯ
    // ============================================================
    const statementUrl = await createStatement(page);
    console.log(`🔗 Ссылка на заявление: ${statementUrl}`);
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
    // ОТВЕТ НА ЗАПРОС: СМЕНА EMAIL
    // ============================================================
    await page.getByRole('button', { name: 'Ответ' }).click();
    await page.waitForTimeout(1000);

    await skipIntermediateSteps(page, 1);

    const newEmail = generateRandomTestEmail();
    const emailField = page.getByRole('textbox', {
      name: 'Введите адрес электронной почты в формате example@example.ru',
    });
    await emailField.waitFor({ state: 'visible', timeout: 10000 });
    await emailField.click();
    await emailField.fill(newEmail);
    await page.waitForTimeout(300);
    console.log(`📌 Новый email в ответе на запрос МЗ: ${newEmail}`);

    await skipIntermediateSteps(page, 4);

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
    // ВЫНЕСЕНИЕ РЕШЕНИЯ ОБ ИСКЛЮЧЕНИИ ПОЦ ИЗ РЕЕСТРА
    // ============================================================
    const decisionUrl = await createMzRequest(page, {
      openButtonName: 'Вынести решение',
      menuItemText: 'Решение об исключении предельной отпускной цены из реестра предельных отпускных цен',
      dialogHeadingText: 'Решение об исключении цены',
      createButtonText: 'Создать решение',
      messageText: 'Решение об исключении предельной отпускной цены из реестра предельных отпускных цен',
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
      'ОТЧЕТ О СОЗДАНИИ ЗАЯВЛЕНИЯ (Исключение ПОЦ, регресс, dev01)\n' +
      `Дата: ${new Date().toLocaleString()}\n` +
      '========================================\n\n' +
      `Ссылка: ${statementUrl}\n\n` +
      '========================================\n' +
      'Конец отчета\n';
    fs.writeFileSync(filePath, fileContent, 'utf8');
    console.log(`✅ Отчет сохранен в файл: ${filePath}`);

    console.log('\n✅ Регресс-тест исключения ПОЦ на dev01 пройден!');
  } finally {
    await context.close();
  }
});
