// ============================================================
// ФАЙЛ: tests/approvalChain.ts
// ПОЛНАЯ ЦЕПОЧКА СОГЛАСОВАНИЯ ПОСЛЕ ПОДПИСАНИЯ ЗАЯВЛЕНИЯ ЗАЯВИТЕЛЕМ
//
// От "заявление подписано" до финального статуса "Услуга оказана" шаги
// одинаковы для всех трёх сценариев (registration_full, increase,
// defectura): Михайлов → запрос МЗ → согласование (Соколова/Федотов) →
// ответ заявителя → ФГБУ/Росздравнадзор → письмо в ФАС → Щербакова →
// запрос ФАС заявителю → запрос ФАС в Минздрав → оба решения → финальная
// проверка. Раньше это было продублировано в трёх файлах почти дословно —
// вынесено сюда один раз. Отличаются сценарии только в трёх местах,
// поэтому они вынесены в параметры:
//   - fillMzResponseFields / fillFasResponseFields — сама правка полей
//     заявления в ответ на запрос (штрихкод+цена в полной регистрации,
//     только цена в перерегистрациях); остальные шаги ("Ответ" → skip 4 →
//     ... → skip 2 → пересборка + подпись) общие, делает сама функция;
//   - document — кнопка/модалка/поля загрузки документа после письма МЗ
//     (ФГБУ НЦЭСМП по умолчанию, в дефектуре — заключение Росздравнадзора);
//   - finalDecisionText — текст итогового решения (свой для каждого
//     сценария, сверен на реальном прогоне под Михайловым для каждого).
//
// Каждый спек-файл теперь просто зовёт runFullApprovalChain(page, {...})
// с нужными параметрами — см. вызов в registration_full.spec.ts,
// increase.spec.ts, defectura.spec.ts.
// ============================================================

import { Page } from '@playwright/test';

import { findUser, switchUser, type RlpUser } from './users';
import { signStatement } from './statementSigning';
import { runMzApproval, switchUserAndOpenRequest, createMzRequest } from './mzApprovalFlow';
import {
  assignExecutor,
  addDocumentWithLetterNumber,
  selectDateInCalendarByOffset,
  generateOrderNumber,
  waitForTextWithReload,
  createStatement,
  skipIntermediateSteps,
  ensureEdoParticipant,
  typeIntoJoditEditor,
  type AddDocumentModalOptions,
} from './statementCreation';

export type RunFullApprovalChainParams = {
  applicant: RlpUser;
  statement: { url: string; number: number };
  fillMzResponseFields: (page: Page) => Promise<void>;
  fillFasResponseFields: (page: Page) => Promise<void>;
  document: { filePath: string } & AddDocumentModalOptions;
  finalDecisionText: string;
  // ------------------------------------------------------------
  // Опционально — для других стендов (например, dev01). По умолчанию —
  // прежнее прод-поведение без изменений (захардкоженные findUser-вызовы,
  // без baseUrl, без проверки маршрута ЭДО).
  // ------------------------------------------------------------
  responsibleMz?: RlpUser;
  headOfDepartment?: RlpUser;
  signer?: RlpUser;
  fasExecutor?: RlpUser;
  baseUrl?: string;
  // Текст для поиска/выбора в модалке "Назначение исполнителя" — формат
  // ФИО там ("Имя Фамилия") ОТЛИЧАЕТСЯ от блока "Согласование" ("Фамилия
  // Имя Отчество"), см. dev01Users.ts.
  assignMzName?: string;
  assignFasName?: string;
  // Включает проверку/поправку маршрута ЭДО (Исполнитель/Согласующий/
  // Подписант) перед каждой отправкой "на согласование" — нужно на
  // стендах, где дефолтные участники маршрута могут быть не теми (dev01).
  ensureEdoRoute?: boolean;
};

// Общий кусок "открыть заявление и дождаться его загрузки" (goto + wait).
async function openStatementAs(page: Page, statementUrl: string): Promise<void> {
  await page.goto(statementUrl);
  await waitForStatementPageLoaded(page);
}

// Только ожидание загрузки — для случаев, когда переход уже сделан внутри
// switchUserAndOpenRequest (ему передаётся statement.url как requestUrl),
// и повторный page.goto() был бы лишней двойной навигацией.
async function waitForStatementPageLoaded(page: Page): Promise<void> {
  await page.waitForSelector('[data-automationid="price-limit-statement-page"]', {
    state: 'visible',
    timeout: 30000,
  });
}

// Собирает beforeConfirmSend-колбэк для createMzRequest, проверяющий/
// поправляющий маршрут ЭДО (Исполнитель/Согласующий/Подписант) перед
// отправкой "на согласование" — или undefined, если проверка выключена
// (прод-стенд, где дефолт всегда верный). Ожидаемые имена берём из
// переданных пользователей (фамилия-подстрока), а не хардкодим — так
// работает для любого стенда, не только прод/dev01.
function edoRouteCheck(
  enabled: boolean,
  responsibleMz: RlpUser,
  headOfDepartment: RlpUser,
  signer: RlpUser,
): ((page: Page) => Promise<void>) | undefined {
  if (!enabled) return undefined;

  const mzSurname = responsibleMz.name.split(' ')[0];
  const headSurname = headOfDepartment.name.split(' ')[0];
  const signerSurname = signer.name.split(' ')[0];

  return async (p: Page) => {
    await ensureEdoParticipant(p, 'Исполнитель', mzSurname);
    await ensureEdoParticipant(p, 'Согласующий', headSurname);
    await ensureEdoParticipant(p, 'Подписант', signerSurname);
  };
}

// Общий кусок "нажать Ответ → пропустить шаги → заполнить поля → пропустить
// шаги → пересобрать и подписать заявление" — повторяется дважды (ответ на
// запрос МЗ и ответ на запрос ФАС), отличается только заполнением полей.
export async function respondAndResign(page: Page, fillFields: (page: Page) => Promise<void>): Promise<void> {
  await page.getByRole('button', { name: 'Ответ' }).click();
  await page.waitForTimeout(1000);

  // Те же шаги, что и при создании заявления — здесь просто подтверждаем
  // их клик за кликом, пока не дойдём до формы с редактируемыми полями
  await skipIntermediateSteps(page, 4);

  await fillFields(page);

  await skipIntermediateSteps(page, 2);

  await createStatement(page);
  await signStatement(page);
}

export async function runFullApprovalChain(page: Page, params: RunFullApprovalChainParams): Promise<void> {
  const {
    applicant,
    statement,
    fillMzResponseFields,
    fillFasResponseFields,
    document,
    finalDecisionText,
    baseUrl,
    assignMzName = 'Дмитрий Петрович Михайлов',
    assignFasName = 'Мария Ильинична Щербакова',
    ensureEdoRoute = false,
  } = params;

  // ============================================================
  // ПЕРЕКЛЮЧЕНИЕ ПОЛЬЗОВАТЕЛЯ: ЗАЯВИТЕЛЬ → МИХАЙЛОВ
  // ============================================================
  const responsibleMz = params.responsibleMz ?? findUser('Михайлов Дмитрий Петрович');
  await switchUser(page, applicant, responsibleMz, baseUrl);

  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);

  await openStatementAs(page, statement.url);
  console.log(`✅ Заявление №${statement.number} открыто под ${responsibleMz.name}`);

  // ============================================================
  // ОЖИДАНИЕ ГОТОВНОСТИ ЗАЯВЛЕНИЯ (обновление страницы каждые 5 сек)
  // ============================================================
  // Кнопка "Назначить исполнителя" появляется не сразу — обработка на
  // стороне сервера может занять 1-2 минуты. Обновляем страницу, пока
  // кнопка не появится.
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
    await page.screenshot({ path: 'assign-button-timeout.png', fullPage: true }).catch(() => {});
    throw new Error('Кнопка "Назначить исполнителя" не появилась за 3 минуты. Скриншот: assign-button-timeout.png');
  }
  console.log('✅ Кнопка "Назначить исполнителя" появилась');

  // ============================================================
  // НАЗНАЧЕНИЕ ИСПОЛНИТЕЛЯ
  // ============================================================
  await assignExecutor(page, 'Михайлов', assignMzName);

  // ============================================================
  // СОГЛАСУЮЩИЙ И ПОДПИСАНТ — нужны уже здесь: и для проверки маршрута
  // ЭДО в первом запросе, и дальше по цепочке
  // ============================================================
  const headOfDepartment = params.headOfDepartment ?? findUser('Соколова Анна Андреевна');
  const signer = params.signer ?? findUser('Федотов Григорий Степанович');

  // ============================================================
  // ЗАПРОС МИНЗДРАВА О ПРЕДОСТАВЛЕНИИ МАТЕРИАЛОВ
  // ============================================================
  const requestUrl = await createMzRequest(page, {
    openButtonName: 'Запрос',
    menuItemText: 'Запрос Минздрава России о представлении необходимых материалов (документы, сведения)',
    dialogHeadingText: 'Запрос Минздрава России о представлении необходимых материалов (документы, сведения)',
    messageText: 'Запрос Минздрава России о представлении необходимых материалов (документы, сведения)',
    sendMenuItemText: 'Направить запрос на согласование',
    beforeConfirmSend: edoRouteCheck(ensureEdoRoute, responsibleMz, headOfDepartment, signer),
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
    baseUrl,
  });

  // ============================================================
  // ПЕРЕКЛЮЧЕНИЕ ПОЛЬЗОВАТЕЛЯ: ФЕДОТОВ → ИЛЬИН
  // ============================================================
  await switchUserAndOpenRequest(page, signer, applicant, requestUrl, baseUrl);
  console.log('✅ Запрос открыт под Ильиным');

  // ============================================================
  // ОТВЕТ НА ЗАПРОС МЗ: РЕДАКТИРОВАНИЕ ЗАЯВЛЕНИЯ (см. fillMzResponseFields)
  // ============================================================
  await respondAndResign(page, fillMzResponseFields);
  console.log('✅ Отредактированное заявление подписано');

  // ============================================================
  // ПЕРЕКЛЮЧЕНИЕ ПОЛЬЗОВАТЕЛЯ: ИЛЬИН → МИХАЙЛОВ (повторно)
  // ============================================================
  await switchUser(page, applicant, responsibleMz, baseUrl);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);

  await openStatementAs(page, statement.url);
  console.log(`✅ Заявление №${statement.number} снова открыто под ${responsibleMz.name}`);

  // ============================================================
  // ДОБАВЛЕНИЕ ДОКУМЕНТА (см. параметр document)
  // ============================================================
  const { filePath: documentFilePath, ...documentOptions } = document;
  await addDocumentWithLetterNumber(page, documentFilePath, documentOptions);
  const documentFileName = documentFilePath.split('/').pop() || documentFilePath;
  console.log(`✅ Документ "${documentFileName}" добавлен`);

  // ============================================================
  // ФОРМИРОВАНИЕ ПИСЬМА ДЛЯ ФАС (под Михайловым)
  // ============================================================
  const fasRequestUrl = await createMzRequest(page, {
    openButtonName: 'Сформировать письмо для ФАС',
    dialogHeadingText: 'Запрос Минздрава России в ФАС России о согласовании',
    messageText: 'Запрос Минздрава России в ФАС России о согласовании',
    sendMenuItemText: 'Направить запрос на согласование',
    beforeConfirmSend: edoRouteCheck(ensureEdoRoute, responsibleMz, headOfDepartment, signer),
  });
  console.log('✅ Письмо для ФАС сформировано и направлено на согласование');

  // ============================================================
  // СОГЛАСОВАНИЕ + ПОДПИСАНИЕ ПИСЬМА ДЛЯ ФАС (та же цепочка МЗ)
  // ============================================================
  await runMzApproval(page, {
    fromUser: responsibleMz,
    approver: headOfDepartment,
    signer,
    requestUrl: fasRequestUrl,
    baseUrl,
  });

  // ============================================================
  // ПЕРЕКЛЮЧЕНИЕ ПОЛЬЗОВАТЕЛЯ: ФЕДОТОВ → ЩЕРБАКОВА (ФАС)
  // ============================================================
  const fasExecutor = params.fasExecutor ?? findUser('Щербакова Мария Ильинична');
  // statement.url передаётся сюда как requestUrl — переход уже происходит
  // внутри switchUserAndOpenRequest, повторный goto не нужен.
  await switchUserAndOpenRequest(page, signer, fasExecutor, statement.url, baseUrl);
  await waitForStatementPageLoaded(page);
  console.log(`✅ Заявление открыто под ${fasExecutor.name} (ФАС)`);

  // ============================================================
  // НАЗНАЧЕНИЕ ИСПОЛНИТЕЛЯ (ФАС) — Щербакова назначает себя
  // ============================================================
  await assignExecutor(page, 'Щербакова', assignFasName);

  // ============================================================
  // ЗАПРОС ФАС РОССИИ ОБ УТОЧНЕНИИ СВЕДЕНИЙ У ЗАЯВИТЕЛЯ (под Щербаковой)
  // ============================================================
  const fasClarificationRequestUrl = await createMzRequest(page, {
    openButtonName: 'Запрос',
    menuItemText: 'Запрос ФАС России об уточнении сведений у заявителя',
    dialogHeadingText: 'Запрос ФАС России об уточнении сведений у заявителя',
    messageText: 'Запрос ФАС России об уточнении сведений у заявителя',
    fileUpload: {
      files: [
        'docs/Запрос ФАС России об уточнении сведений у заявителя.pdf',
        'docs/Запрос ФАС России об уточнении сведений у заявителя.sig',
      ],
    },
    sendMenuItemText: 'Направить запрос без согласования',
    verifyWithdrawButton: false, // "без согласования" — ЭДО-маршрута нет, "Отозвать" не появится
  });
  console.log('✅ Запрос ФАС России об уточнении сведений у заявителя направлен');

  // ============================================================
  // ПЕРЕКЛЮЧЕНИЕ ПОЛЬЗОВАТЕЛЯ: ЩЕРБАКОВА → ИЛЬИН (заявитель отвечает на запрос ФАС)
  // ============================================================
  await switchUserAndOpenRequest(page, fasExecutor, applicant, fasClarificationRequestUrl, baseUrl);
  console.log('✅ Запрос ФАС открыт под заявителем');

  // ============================================================
  // ОТВЕТ НА ЗАПРОС ФАС: РЕДАКТИРОВАНИЕ ЗАЯВЛЕНИЯ (см. fillFasResponseFields)
  // ============================================================
  await respondAndResign(page, fillFasResponseFields);
  console.log('✅ Ответ на запрос ФАС подписан заявителем');

  // ============================================================
  // ПЕРЕКЛЮЧЕНИЕ ПОЛЬЗОВАТЕЛЯ: ИЛЬИН → ЩЕРБАКОВА (возвращаемся в заявление)
  // ============================================================
  await switchUser(page, applicant, fasExecutor, baseUrl);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);

  await openStatementAs(page, statement.url);
  console.log(`✅ Заявление снова открыто под ${fasExecutor.name} (ФАС)`);

  // ============================================================
  // ЗАПРОС ФАС РОССИИ ОБ УТОЧНЕНИИ СВЕДЕНИЙ У МИНЗДРАВА РОССИИ (под Щербаковой)
  // ============================================================
  const fasToMzRequestUrl = await createMzRequest(page, {
    openButtonName: 'Запрос',
    menuItemText: 'Запрос ФАС России об уточнении сведений у Минздрава России',
    dialogHeadingText: 'Запрос ФАС России об уточнении сведений у Минздрава России',
    messageText: 'Запрос ФАС России об уточнении сведений у Минздрава России',
    fileUpload: {
      files: [
        'docs/Запрос ФАС России об уточнении сведений у Минздрава России.pdf',
        'docs/Запрос ФАС России об уточнении сведений у Минздрава России.sig',
      ],
    },
    sendMenuItemText: 'Направить запрос без согласования',
    verifyWithdrawButton: false, // "без согласования" — ЭДО-маршрута нет, "Отозвать" не появится
  });
  console.log('✅ Запрос ФАС России об уточнении сведений у Минздрава России направлен');

  // ============================================================
  // ПЕРЕКЛЮЧЕНИЕ ПОЛЬЗОВАТЕЛЯ: ЩЕРБАКОВА → МИХАЙЛОВ (ответ на запрос ФАС)
  // ============================================================
  await switchUserAndOpenRequest(page, fasExecutor, responsibleMz, fasToMzRequestUrl, baseUrl);
  console.log(`✅ Запрос открыт под ${responsibleMz.name}`);

  // ============================================================
  // ОТВЕТ НА ЗАПРОС ФАС (текст + файл с подписью, без правки заявления)
  // ============================================================
  await page.getByRole('button', { name: 'Ответ' }).click();
  await page.waitForTimeout(1000);

  const mzReplyTextEditor = page.locator('div.jodit-wysiwyg[contenteditable="true"]');
  await mzReplyTextEditor.waitFor({ state: 'visible', timeout: 10000 });
  await typeIntoJoditEditor(page, mzReplyTextEditor, 'Ответ на Запрос ФАС России об уточнении сведений у Минздрава России');

  const mzReplyFileInput = page.locator('input[type="file"]').last();
  await mzReplyFileInput.setInputFiles([
    // ВНИМАНИЕ: между "на" и "Запрос" в имени файла — неразрывный пробел
    // (U+00A0), не обычный. Файлы созданы вручную с таким именем на диске.
    'docs/Ответ на Запрос ФАС России об уточнении сведений у Минздрава России.pdf',
    'docs/Ответ на Запрос ФАС России об уточнении сведений у Минздрава России.sig',
  ]);
  await page.waitForTimeout(1000);

  await page.getByRole('button', { name: 'Направить' }).click();
  await page.waitForTimeout(500);
  await page.getByText('Направить ответ без согласования').click();
  await page.waitForTimeout(1000);
  console.log('✅ Ответ на запрос ФАС направлен');

  // ============================================================
  // ПЕРЕКЛЮЧЕНИЕ ПОЛЬЗОВАТЕЛЯ: МИХАЙЛОВ → ЩЕРБАКОВА (продолжаем цепочку ФАС)
  // ============================================================
  await switchUserAndOpenRequest(page, responsibleMz, fasExecutor, statement.url, baseUrl);
  await waitForStatementPageLoaded(page);
  console.log(`✅ Заявление снова открыто под ${fasExecutor.name} (ФАС)`);

  // ============================================================
  // РЕШЕНИЕ О СОГЛАСОВАНИИ ПРЕДЕЛЬНОЙ ОТПУСКНОЙ ЦЕНЫ
  // ============================================================
  await createMzRequest(page, {
    openButtonName: 'Отправить в Минздрав России',
    menuItemText: 'Решение о согласовании предельной отпускной цены',
    dialogHeadingText: 'Решение о согласовании предельной отпускной цены',
    createButtonText: 'Создать решение',
    messageText: 'Решение о согласовании предельной отпускной цены',
    fileUpload: {
      files: [
        'docs/Решение о согласовании предельной отпускной цены.pdf',
        'docs/Решение о согласовании предельной отпускной цены.sig',
      ],
    },
    sendMenuItemText: 'Направить решение без согласования',
    verifyWithdrawButton: false, // "без согласования" — ЭДО-маршрута нет, "Отозвать" не появится
  });
  console.log('✅ Решение о согласовании предельной отпускной цены направлено');

  // ============================================================
  // ПЕРЕКЛЮЧЕНИЕ ПОЛЬЗОВАТЕЛЯ: ЩЕРБАКОВА → МИХАЙЛОВ
  // ============================================================
  await switchUserAndOpenRequest(page, fasExecutor, responsibleMz, statement.url, baseUrl);
  await waitForStatementPageLoaded(page);
  console.log(`✅ Заявление снова открыто под ${responsibleMz.name}`);

  // ============================================================
  // ИТОГОВОЕ РЕШЕНИЕ (текст — см. параметр finalDecisionText, свой для
  // каждого сценария: регистрация / увеличение / дефектура)
  // ============================================================
  const registrationDecisionUrl = await createMzRequest(page, {
    openButtonName: 'Отправить решение заявителю',
    menuItemText: finalDecisionText,
    dialogHeadingText: finalDecisionText,
    createButtonText: 'Создать решение',
    messageText: finalDecisionText,
    fillExtraFields: async p => {
      // Дата приказа — сегодня (та же схема триггер-div, что и "Дата письма")
      const orderDateTrigger = p.locator('label', { hasText: 'Дата приказа' }).locator('xpath=following-sibling::div[1]');
      await selectDateInCalendarByOffset(p, orderDateTrigger, 0);

      // Номер приказа
      const orderNumberInput = p
        .locator('label', { hasText: 'Номер приказа' })
        .locator('xpath=following-sibling::input[1]');
      await orderNumberInput.waitFor({ state: 'visible', timeout: 10000 });
      await orderNumberInput.fill(generateOrderNumber());
      await p.waitForTimeout(300);

      // Дата вступления в силу приказа — завтра
      const effectiveDateTrigger = p
        .locator('label', { hasText: 'Дата вступления в силу приказа' })
        .locator('xpath=following-sibling::div[1]');
      await selectDateInCalendarByOffset(p, effectiveDateTrigger, 1);
    },
    sendMenuItemText: 'Направить решение на согласование',
    beforeConfirmSend: edoRouteCheck(ensureEdoRoute, responsibleMz, headOfDepartment, signer),
  });
  console.log('✅ Решение направлено на согласование');

  // ============================================================
  // СОГЛАСОВАНИЕ + ПОДПИСАНИЕ (та же цепочка МЗ: Соколова, Федотов)
  // ============================================================
  await runMzApproval(page, {
    fromUser: responsibleMz,
    approver: headOfDepartment,
    signer,
    requestUrl: registrationDecisionUrl,
    baseUrl,
    expectedStatus: null, // статус "Подписано" визуально есть, но локатор его не ловит — полагаемся на проверку "Услуга оказана" ниже
  });

  // ============================================================
  // ФИНАЛЬНАЯ ПРОВЕРКА: СТАТУС ЗАЯВЛЕНИЯ "УСЛУГА ОКАЗАНА"
  // ============================================================
  await page.goto(statement.url);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);
  await waitForTextWithReload(page, 'Услуга оказана');
  console.log('✅ Заявление в финальном статусе: Услуга оказана');
}

// Общий кусок "дождаться кнопки 'Назначить исполнителя' с периодическим
// обновлением страницы" — повторяется во всех цепочках (полных и смоук).
async function waitForAssignExecutorButton(page: Page): Promise<void> {
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
    await page.screenshot({ path: 'assign-button-timeout.png', fullPage: true }).catch(() => {});
    throw new Error('Кнопка "Назначить исполнителя" не появилась за 3 минуты. Скриншот: assign-button-timeout.png');
  }
  console.log('✅ Кнопка "Назначить исполнителя" появилась');
}

// ============================================================
// КОРОТКИЕ ЦЕПОЧКИ ДЛЯ СМОУК-ТЕСТОВ
//
// По просьбе пользователя: для услуг с ФАС (регистрация/увеличение/
// дефектура) убираем "запрос заявителю + ответ на него" (запрос Минздрава
// о представлении материалов) И "запросы ФАС заявителю и Минздраву + ответы
// на них". Всё остальное — назначение исполнителя, документ, письмо в ФАС,
// решение Щербаковой о согласовании, итоговое решение, финальная проверка —
// остаётся как в полной цепочке.
//
// Для услуг без ФАС (снижение/изменение/исключение) смоук-версия убирает
// тот же "запрос заявителю + ответ на него" (запрос Минздрава), оставляя:
// подпись заявления → назначение исполнителя → сразу решение →
// согласование/подпись → финальная проверка.
// ============================================================

export type RunSmokeApprovalChainWithFasParams = {
  applicant: RlpUser;
  statement: { url: string; number: number };
  document: { filePath: string } & AddDocumentModalOptions;
  finalDecisionText: string;
};

export async function runSmokeApprovalChainWithFas(
  page: Page,
  params: RunSmokeApprovalChainWithFasParams,
): Promise<void> {
  const { applicant, statement, document, finalDecisionText } = params;

  // ============================================================
  // ПЕРЕКЛЮЧЕНИЕ ПОЛЬЗОВАТЕЛЯ: ЗАЯВИТЕЛЬ → МИХАЙЛОВ
  // ============================================================
  const responsibleMz = findUser('Михайлов Дмитрий Петрович');
  await switchUser(page, applicant, responsibleMz);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);

  await openStatementAs(page, statement.url);
  console.log(`✅ Заявление №${statement.number} открыто под ${responsibleMz.name}`);

  await waitForAssignExecutorButton(page);

  // ============================================================
  // НАЗНАЧЕНИЕ ИСПОЛНИТЕЛЯ
  // ============================================================
  await assignExecutor(page, 'Михайлов', 'Дмитрий Петрович Михайлов');

  // ============================================================
  // ДОБАВЛЕНИЕ ДОКУМЕНТА (см. параметр document) — запрос МЗ заявителю и
  // ответ на него убраны, документ добавляется сразу после назначения исполнителя
  // ============================================================
  const { filePath: documentFilePath, ...documentOptions } = document;
  await addDocumentWithLetterNumber(page, documentFilePath, documentOptions);
  const documentFileName = documentFilePath.split('/').pop() || documentFilePath;
  console.log(`✅ Документ "${documentFileName}" добавлен`);

  // ============================================================
  // ФОРМИРОВАНИЕ ПИСЬМА ДЛЯ ФАС
  // ============================================================
  const headOfDepartment = findUser('Соколова Анна Андреевна');
  const signer = findUser('Федотов Григорий Степанович');

  const fasRequestUrl = await createMzRequest(page, {
    openButtonName: 'Сформировать письмо для ФАС',
    dialogHeadingText: 'Запрос Минздрава России в ФАС России о согласовании',
    messageText: 'Запрос Минздрава России в ФАС России о согласовании',
    sendMenuItemText: 'Направить запрос на согласование',
  });
  console.log('✅ Письмо для ФАС сформировано и направлено на согласование');

  // ============================================================
  // СОГЛАСОВАНИЕ + ПОДПИСАНИЕ ПИСЬМА ДЛЯ ФАС (та же цепочка МЗ)
  // ============================================================
  await runMzApproval(page, {
    fromUser: responsibleMz,
    approver: headOfDepartment,
    signer,
    requestUrl: fasRequestUrl,
  });

  // ============================================================
  // ПЕРЕКЛЮЧЕНИЕ ПОЛЬЗОВАТЕЛЯ: ФЕДОТОВ → ЩЕРБАКОВА (ФАС)
  // ============================================================
  const fasExecutor = findUser('Щербакова Мария Ильинична');
  await switchUserAndOpenRequest(page, signer, fasExecutor, statement.url);
  await waitForStatementPageLoaded(page);
  console.log(`✅ Заявление открыто под ${fasExecutor.name} (ФАС)`);

  // ============================================================
  // НАЗНАЧЕНИЕ ИСПОЛНИТЕЛЯ (ФАС) — Щербакова назначает себя
  // ============================================================
  await assignExecutor(page, 'Щербакова', 'Мария Ильинична Щербакова');

  // ============================================================
  // РЕШЕНИЕ О СОГЛАСОВАНИИ ПРЕДЕЛЬНОЙ ОТПУСКНОЙ ЦЕНЫ — запросы ФАС
  // заявителю/Минздраву и ответы на них убраны, решение выносится сразу
  // после назначения исполнителя (ФАС)
  // ============================================================
  await createMzRequest(page, {
    openButtonName: 'Отправить в Минздрав России',
    menuItemText: 'Решение о согласовании предельной отпускной цены',
    dialogHeadingText: 'Решение о согласовании предельной отпускной цены',
    createButtonText: 'Создать решение',
    messageText: 'Решение о согласовании предельной отпускной цены',
    fileUpload: {
      files: [
        'docs/Решение о согласовании предельной отпускной цены.pdf',
        'docs/Решение о согласовании предельной отпускной цены.sig',
      ],
    },
    sendMenuItemText: 'Направить решение без согласования',
    verifyWithdrawButton: false, // "без согласования" — ЭДО-маршрута нет, "Отозвать" не появится
  });
  console.log('✅ Решение о согласовании предельной отпускной цены направлено');

  // ============================================================
  // ПЕРЕКЛЮЧЕНИЕ ПОЛЬЗОВАТЕЛЯ: ЩЕРБАКОВА → МИХАЙЛОВ
  // ============================================================
  await switchUserAndOpenRequest(page, fasExecutor, responsibleMz, statement.url);
  await waitForStatementPageLoaded(page);
  console.log(`✅ Заявление снова открыто под ${responsibleMz.name}`);

  // ============================================================
  // ИТОГОВОЕ РЕШЕНИЕ (текст — см. параметр finalDecisionText)
  // ============================================================
  const finalDecisionUrl = await createMzRequest(page, {
    openButtonName: 'Отправить решение заявителю',
    menuItemText: finalDecisionText,
    dialogHeadingText: finalDecisionText,
    createButtonText: 'Создать решение',
    messageText: finalDecisionText,
    fillExtraFields: async p => {
      // Дата приказа — сегодня (та же схема триггер-div, что и "Дата письма")
      const orderDateTrigger = p.locator('label', { hasText: 'Дата приказа' }).locator('xpath=following-sibling::div[1]');
      await selectDateInCalendarByOffset(p, orderDateTrigger, 0);

      // Номер приказа
      const orderNumberInput = p
        .locator('label', { hasText: 'Номер приказа' })
        .locator('xpath=following-sibling::input[1]');
      await orderNumberInput.waitFor({ state: 'visible', timeout: 10000 });
      await orderNumberInput.fill(generateOrderNumber());
      await p.waitForTimeout(300);

      // Дата вступления в силу приказа — завтра
      const effectiveDateTrigger = p
        .locator('label', { hasText: 'Дата вступления в силу приказа' })
        .locator('xpath=following-sibling::div[1]');
      await selectDateInCalendarByOffset(p, effectiveDateTrigger, 1);
    },
    sendMenuItemText: 'Направить решение на согласование',
  });
  console.log('✅ Решение направлено на согласование');

  // ============================================================
  // СОГЛАСОВАНИЕ + ПОДПИСАНИЕ (та же цепочка МЗ: Соколова, Федотов)
  // ============================================================
  await runMzApproval(page, {
    fromUser: responsibleMz,
    approver: headOfDepartment,
    signer,
    requestUrl: finalDecisionUrl,
    expectedStatus: null,
  });

  // ============================================================
  // ФИНАЛЬНАЯ ПРОВЕРКА: СТАТУС ЗАЯВЛЕНИЯ "УСЛУГА ОКАЗАНА"
  // ============================================================
  await page.goto(statement.url);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);
  await waitForTextWithReload(page, 'Услуга оказана');
  console.log('✅ Заявление в финальном статусе: Услуга оказана');
}

export type RunSmokeApprovalChainNoFasParams = {
  applicant: RlpUser;
  statementUrl: string;
  decision: {
    menuItemText: string;
    dialogHeadingText: string;
    messageText: string;
    fillExtraFields?: (page: Page) => Promise<void>;
  };
};

export async function runSmokeApprovalChainNoFas(
  page: Page,
  params: RunSmokeApprovalChainNoFasParams,
): Promise<void> {
  const { applicant, statementUrl, decision } = params;

  // ============================================================
  // ПЕРЕКЛЮЧЕНИЕ ПОЛЬЗОВАТЕЛЯ: ЗАЯВИТЕЛЬ → МИХАЙЛОВ
  // ============================================================
  const responsibleMz = findUser('Михайлов Дмитрий Петрович');
  await switchUser(page, applicant, responsibleMz);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);

  await openStatementAs(page, statementUrl);
  console.log(`✅ Заявление открыто под ${responsibleMz.name}`);

  await waitForAssignExecutorButton(page);

  // ============================================================
  // НАЗНАЧЕНИЕ ИСПОЛНИТЕЛЯ
  // ============================================================
  await assignExecutor(page, 'Михайлов', 'Дмитрий Петрович Михайлов');

  // ============================================================
  // ВЫНЕСЕНИЕ РЕШЕНИЯ — запрос МЗ заявителю и ответ на него убраны,
  // решение выносится сразу после назначения исполнителя
  // ============================================================
  const headOfDepartment = findUser('Соколова Анна Андреевна');
  const signer = findUser('Федотов Григорий Степанович');

  const decisionUrl = await createMzRequest(page, {
    openButtonName: 'Вынести решение',
    menuItemText: decision.menuItemText,
    dialogHeadingText: decision.dialogHeadingText,
    createButtonText: 'Создать решение',
    messageText: decision.messageText,
    fillExtraFields: decision.fillExtraFields,
    sendMenuItemText: 'Направить решение на согласование',
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
  });

  // ============================================================
  // ФИНАЛЬНАЯ ПРОВЕРКА: СТАТУС ЗАЯВЛЕНИЯ "УСЛУГА ОКАЗАНА"
  // ============================================================
  await page.goto(statementUrl);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);
  await waitForTextWithReload(page, 'Услуга оказана');
  console.log('✅ Заявление в финальном статусе: Услуга оказана');
}
