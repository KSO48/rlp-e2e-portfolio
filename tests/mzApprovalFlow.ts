// ============================================================
// ФАЙЛ: tests/mzApprovalFlow.ts
// ЦЕПОЧКА СОГЛАСОВАНИЯ И ПОДПИСАНИЯ ЗАПРОСОВ ВНУТРИ МИНЗДРАВА
//
// Для Минздрава эта цепочка (согласующий согласовывает → подписант
// подписывает) всегда одна и та же, независимо от того, что за запрос
// создал исполнитель и какой у него текст. Шаг "исполнитель" (назначение +
// создание конкретного запроса) у каждого сценария свой, поэтому он сюда
// не входит — остаётся инлайном в самом тесте.
//
// Для ФАС этот паттерн НЕ подходит (там своя цепочка) — эта функция
// специфична для Минздрава.
// ============================================================

import { Page } from '@playwright/test';
import { switchUser, type RlpUser } from './users';
import { signRequest } from './statementSigning';
import { typeIntoJoditEditor } from './statementCreation';

// Переключает пользователя и переходит по ссылке запроса, дожидаясь
// прогрузки страницы — повторяющийся паттерн при каждой смене пользователя
export async function switchUserAndOpenRequest(
  page: Page,
  fromUser: RlpUser,
  toUser: RlpUser,
  requestUrl: string,
  baseUrl?: string,
): Promise<void> {
  await switchUser(page, fromUser, toUser, baseUrl);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);

  await page.goto(requestUrl);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);
}

export type MzApprovalParams = {
  fromUser: RlpUser; // кто залогинен сейчас (обычно исполнитель, уже создавший запрос)
  approver: RlpUser; // согласующий
  signer: RlpUser; // подписант
  requestUrl: string;
  expectedStatus?: string | null; // финальный статус после подписания (по умолчанию "Отправлен"), null — пропустить проверку
  baseUrl?: string; // стенд для logout/login внутри переключений (по умолчанию прод)
};

// Проходит фиксированную для Минздрава цепочку: согласующий жмёт
// "Согласовать", затем подписант подписывает через signRequest.
// После завершения залогинен signer — если дальше нужно переключиться
// на кого-то ещё (например, обратно на заявителя), это делает вызывающий код.
export async function runMzApproval(page: Page, params: MzApprovalParams): Promise<void> {
  const { fromUser, approver, signer, requestUrl, expectedStatus, baseUrl } = params;

  // ============================================================
  // СОГЛАСОВАНИЕ ЗАПРОСА
  // ============================================================
  await switchUserAndOpenRequest(page, fromUser, approver, requestUrl, baseUrl);

  const approveButton = page.getByRole('button', { name: 'Согласовать' });
  const approveVisible = await approveButton
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);

  if (!approveVisible) {
    // Диагностика вместо голого таймаута — раньше здесь падало без единой
    // зацепки, куда реально попал согласующий. Сверяем целевой URL с
    // фактическим: если они разные, значит requestUrl захватил не ту
    // страницу (см. createMzRequest — там теперь тоже есть проверка).
    await page.screenshot({ path: 'debug-approve-button-missing.png', fullPage: true }).catch(() => {});
    const visibleButtons = await page.getByRole('button').allTextContents().catch(() => []);
    console.log(`❌ Кнопка "Согласовать" не появилась под ${approver.name}.`);
    console.log(`   Ожидали URL: ${requestUrl}`);
    console.log(`   Реальный URL: ${page.url()}`);
    console.log('   Видимые кнопки на экране:');
    console.log(visibleButtons.filter(t => t.trim()).join('\n'));
    throw new Error(
      `Кнопка "Согласовать" не появилась под ${approver.name}. Скриншот: debug-approve-button-missing.png`,
    );
  }

  await approveButton.click();
  await page.waitForTimeout(1000);
  console.log(`✅ Запрос согласован под ${approver.name}`);

  // ============================================================
  // ПОДПИСАНИЕ ЗАПРОСА
  // ============================================================
  await switchUserAndOpenRequest(page, approver, signer, requestUrl, baseUrl);
  await signRequest(page, expectedStatus);
}

export type CreateMzRequestParams = {
  openButtonName: string; // кнопка, открывающая диалог/меню создания запроса
  menuItemText?: string; // опционально: если кнопка открывает меню с пунктом, а не диалог напрямую
  dialogHeadingText: string; // текст, по которому ждём открытия диалога создания запроса
  createButtonText?: string; // кнопка создания внутри диалога (по умолчанию "Создать запрос")
  messageText: string; // текст, который печатаем в редактор запроса
  fillExtraFields?: (page: Page) => Promise<void>; // опционально: доп. поля конкретного сценария (даты, номера приказа и т.п.)
  fileUpload?: { files: string[] }; // опционально: прикрепление файлов (например, решение + подпись .sig)
  sendMenuItemText: string; // текст пункта меню после клика "Направить" (у разных писем разный)
  // Выполняется после клика по пункту меню отправки (sendMenuItemText),
  // когда появляется блок "Согласование" (Выбрать шаблон / Исполнитель /
  // Согласующий / Подписант) — но ДО проверки видимости финальной кнопки
  // "Направить". На некоторых стендах (dev01) эта кнопка не появляется/не
  // активна, пока не выбран правильный "Исполнитель" — она возникает как
  // следствие его выбора, поэтому нельзя ждать кнопку раньше этого шага.
  // Нужен, например, для ensureEdoParticipant.
  beforeConfirmSend?: (page: Page) => Promise<void>;
  // По умолчанию true: после отправки ждём кнопку "Отозвать" как
  // подтверждение, что заявка ушла в согласование (ЭДО-маршрут). У
  // сценариев "без согласования" (например, запрос ФАС → заявителю или
  // → Минздраву) ЭДО-маршрута нет, "Отозвать" там никогда не появляется —
  // для них выставляем false, и вместо неё проверяем, что кнопка
  // "Направить" пропала со страницы.
  verifyWithdrawButton?: boolean;
};

// Создаёт и отправляет на согласование запрос/решение от лица Минздрава
// или ФАС — общий паттерн для разных писем, отличаются только название
// кнопки, текст диалога, необходимость прикрепления файла и текст самого
// письма/итогового пункта отправки. Возвращает URL созданного запроса.
export async function createMzRequest(page: Page, params: CreateMzRequestParams): Promise<string> {
  const {
    openButtonName,
    menuItemText,
    dialogHeadingText,
    createButtonText = 'Создать запрос',
    messageText,
    fillExtraFields,
    fileUpload,
    sendMenuItemText,
    beforeConfirmSend,
    verifyWithdrawButton = true,
  } = params;

  // Кнопка, открывающая диалог/меню, может не появиться сразу после
  // логина/перехода по ссылке — та же ситуация, что уже была решена для
  // "Назначить исполнителя" (обработка на сервере, страница открылась
  // "неправильно" и её нужно перезагрузить). Тот же паттерн: poll + reload,
  // а не голый waitFor.
  const openButton = page.getByRole('button', { name: openButtonName });
  let openButtonVisible = await openButton.isVisible({ timeout: 5000 }).catch(() => false);
  const openButtonPollStartedAt = Date.now();
  const openButtonMaxPollDurationMs = 60 * 1000;

  while (!openButtonVisible && Date.now() - openButtonPollStartedAt < openButtonMaxPollDurationMs) {
    console.log(`⏳ Кнопка "${openButtonName}" не появилась — обновляю страницу...`);
    await page.reload();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);
    openButtonVisible = await openButton.isVisible({ timeout: 5000 }).catch(() => false);
  }

  if (!openButtonVisible) {
    await page.screenshot({ path: 'debug-open-button-not-found.png', fullPage: true }).catch(() => {});
    throw new Error(
      `Кнопка "${openButtonName}" не появилась за ${openButtonMaxPollDurationMs / 1000}с (после перезагрузки). ` +
        'Скриншот: debug-open-button-not-found.png',
    );
  }

  await openButton.click();
  await page.waitForTimeout(500);

  if (menuItemText) {
    // Кнопка открывает меню, а не диалог напрямую — тот же паттерн
    // "клик → проверка эффекта → force-повтор", что уже отработан раньше
    const menuItem = page.getByText(menuItemText);
    let menuOpened = await menuItem.isVisible({ timeout: 3000 }).catch(() => false);
    if (!menuOpened) {
      await openButton.click({ force: true });
      await page.waitForTimeout(500);
      menuOpened = await menuItem.isVisible({ timeout: 3000 }).catch(() => false);
    }

    if (!menuOpened) {
      await page.screenshot({ path: 'debug-request-menu.png', fullPage: true }).catch(() => {});
      const visibleMenuTexts = await page.locator('[role="menuitem"], li, button').allTextContents().catch(() => []);
      console.log(`❌ Пункт меню "${menuItemText}" не найден. Видимые тексты на экране:`);
      console.log(visibleMenuTexts.filter(t => t.trim()).join('\n'));
      throw new Error(
        `Меню "${openButtonName}" не открылось или пункт назван иначе. Скриншот: debug-request-menu.png`,
      );
    }

    await menuItem.click();
    await page.waitForTimeout(500);
  }

  await page.waitForSelector(`text=${dialogHeadingText}`, { state: 'visible', timeout: 10000 });

  // Запоминаем URL ДО клика "Создать запрос" — раньше просто ждали 1с и
  // хватали page.url(), что при задержке навигации молча захватывало
  // старую страницу (заявления, а не запроса) без единого сигнала об ошибке.
  const urlBeforeCreate = page.url();
  await page.getByRole('button', { name: createButtonText }).click();
  await page.waitForTimeout(1000);

  const urlChanged = await page
    .waitForFunction((prevUrl) => window.location.href !== prevUrl, urlBeforeCreate, { timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  if (!urlChanged) {
    console.log(
      `⚠️ URL не изменился после "${createButtonText}" (остался ${urlBeforeCreate}) — ` +
        `похоже, страница не перешла на конкретный запрос/решение. Дальнейшие шаги ` +
        `под другими пользователями, скорее всего, не найдут нужную кнопку на этой странице.`,
    );
  }

  // URL уже сменился на страницу конкретного запроса/решения
  const requestUrl = page.url();
  console.log(`🔗 Ссылка на запрос: ${requestUrl}`);

  // Текстовое поле — редактор Jodit (contenteditable div), обычный .fill()
  // на нём не работает надёжно (см. typeIntoJoditEditor в statementCreation.ts
  // — там же объяснение, почему проверяем текст целиком, а не просто "не пусто").
  const requestTextEditor = page.locator('div.jodit-wysiwyg[contenteditable="true"]');
  await requestTextEditor.waitFor({ state: 'visible', timeout: 10000 });
  await typeIntoJoditEditor(page, requestTextEditor, messageText);

  if (fillExtraFields) {
    await fillExtraFields(page);
  }

  if (fileUpload) {
    // ВАЖНО: не кликаем по видимой кнопке fileUpload.buttonText — такой клик
    // может открыть настоящее системное окно выбора файла Windows, которое
    // Playwright не видит и не может закрыть (зависает). Обращаемся сразу
    // к скрытому input[type="file"] через setInputFiles — тот же паттерн,
    // что уже отработан в addDocumentWithLetterNumber.
    const fileInput = page.locator('input[type="file"]').last();
    await fileInput.setInputFiles(fileUpload.files);
    // Странице нужно время не просто принять файл, а обработать его
    // (валидация подписи и т.п.), прежде чем форма сочтёт себя готовой к
    // отправке — было 1с, добавил ещё секунду сверху.
    await page.waitForTimeout(2000);
  }

  // Отправка запроса/решения
  const sendButton = page.getByRole('button', { name: 'Направить' });
  await sendButton.waitFor({ state: 'visible', timeout: 10000 });

  // Кнопка может быть визуально на месте, но disabled, пока форма не
  // сочтёт себя валидной (например, текст ещё не долетел до состояния
  // компонента) — клик по disabled-кнопке либо ничего не делает, либо
  // Playwright сам будет вечно ждать actionability. Ждём enabled явно.
  const sendButtonEnabled = await sendButton
    .isEnabled()
    .then(async enabled => {
      if (enabled) return true;
      // Даём странице немного времени среагировать на введённый текст
      for (let i = 0; i < 10 && !enabled; i++) {
        await page.waitForTimeout(500);
        enabled = await sendButton.isEnabled().catch(() => false);
      }
      return enabled;
    })
    .catch(() => false);

  if (!sendButtonEnabled) {
    await page.screenshot({ path: 'debug-send-button-disabled.png', fullPage: true }).catch(() => {});
    throw new Error(
      'Кнопка "Направить" осталась неактивной (disabled) — форма запроса, похоже, не считает себя ' +
        'заполненной. Скриншот: debug-send-button-disabled.png',
    );
  }

  await sendButton.click();
  await page.waitForTimeout(500);
  await page.getByText(sendMenuItemText).click();

  // Небольшая пауза сразу после клика по пункту меню (например, "Направить
  // запрос без согласования") — странице нужно время отреагировать, прежде
  // чем проверять результат.
  await page.waitForTimeout(1000);

  // После клика по пункту меню странице нужно время отрисовать блок
  // "Согласование" (Выбрать шаблон / Исполнитель / Согласующий /
  // Подписант) — по наблюдению на реальном прогоне 500мс не хватало.
  // Даём 2.5с на разметку.
  await page.waitForTimeout(2500);

  // beforeConfirmSend — ДО проверки видимости кнопки подтверждения, а не
  // после: на некоторых стендах (dev01) сама кнопка "Направить" не
  // появляется/не активна, пока не выбран правильный "Исполнитель" — она
  // возникает уже КАК СЛЕДСТВИЕ его выбора. Согласующего и подписанта
  // нужно поправить до клика по этой кнопке.
  if (beforeConfirmSend) {
    await beforeConfirmSend(page);
  }

  // Некоторые сценарии требуют ещё одного подтверждающего клика "Направить"
  // (как в запросе заявителю), другие — нет. Раньше ждали появления кнопки
  // подтверждения всего 3с — если модалка рисовалась чуть дольше, клик
  // молча пропускался и запрос оставался черновиком без единого сигнала об
  // ошибке (это и произошло под Михайловым — "Запрос направлен" в логе, а
  // по факту черновик). Увеличил запас ожидания.
  const confirmSendButton = page.getByRole('button', { name: 'Направить' });
  const confirmVisible = await confirmSendButton.isVisible({ timeout: 8000 }).catch(() => false);
  if (confirmVisible) {
    await confirmSendButton.click();
    await page.waitForTimeout(1000);
    console.log('✅ Подтверждающий клик "Направить" выполнен');
  } else {
    console.log('ℹ️ Подтверждающая кнопка "Направить" не появилась — считаем, что этот сценарий обходится без неё');
  }

  if (verifyWithdrawButton) {
    // Проверка по факту: у запроса/решения, отправленного НА согласование,
    // появляется кнопка "Отозвать" — надёжный сигнал, что заявка ушла в
    // ЭДО-маршрут, а не осталась черновиком. Ждём её вместо того, чтобы
    // молча писать "направлено" и узнавать о проблеме на шаге у следующего
    // пользователя, как было с Соколовой.
    const withdrawButton = page.getByRole('button', { name: 'Отозвать' });
    const withdrawVisible = await withdrawButton
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);

    if (!withdrawVisible) {
      await page.screenshot({ path: 'debug-send-not-confirmed.png', fullPage: true }).catch(() => {});
      const visibleButtons = await page.getByRole('button').allTextContents().catch(() => []);
      console.log('❌ Кнопка "Отозвать" не появилась после отправки — запрос, похоже, остался черновиком.');
      console.log(`   URL: ${page.url()}`);
      console.log('   Видимые кнопки на экране:');
      console.log(visibleButtons.filter(t => t.trim()).join('\n'));
      throw new Error(
        'Кнопка "Отозвать" не появилась после отправки — запрос/решение, похоже, остался черновиком. ' +
          'Скриншот: debug-send-not-confirmed.png',
      );
    }

    console.log('✅ Запрос/решение направлено (кнопка "Отозвать" подтверждает отправку)');
  } else {
    // "Без согласования" — ЭДО-маршрута нет, "Отозвать" не появится
    // никогда. Вместо этого проверяем, что кнопка "Направить" (та самая,
    // что открывает меню отправки) пропала со страницы — это и есть
    // признак того, что заявка ушла, а не осталась в режиме редактирования.
    const stillEditable = await sendButton.isVisible({ timeout: 5000 }).catch(() => false);

    if (stillEditable) {
      await page.screenshot({ path: 'debug-send-not-confirmed.png', fullPage: true }).catch(() => {});
      const visibleButtons = await page.getByRole('button').allTextContents().catch(() => []);
      console.log('❌ Кнопка "Направить" всё ещё видна после отправки "без согласования" — похоже, не ушло.');
      console.log(`   URL: ${page.url()}`);
      console.log('   Видимые кнопки на экране:');
      console.log(visibleButtons.filter(t => t.trim()).join('\n'));
      throw new Error(
        'Кнопка "Направить" всё ещё видна после отправки "без согласования" — запрос/решение, похоже, ' +
          'не ушёл. Скриншот: debug-send-not-confirmed.png',
      );
    }

    console.log('✅ Запрос/решение направлено (кнопка "Направить" больше не отображается)');
  }

  return requestUrl;
}
