// ============================================================
// ФАЙЛ: tests/statementSigning.ts
// ПОДПИСАНИЕ ЗАЯВЛЕНИЯ/ЗАПРОСА ЧЕРЕЗ КРИПТОПРО (переиспользуемые шаги)
//
// Логика перенесена из
// rlp-lk-applicant/src/tests/e2e/helpers/applicantWizard.ts (signStatement,
// clickFirstDropdownOption) и адаптирована под стиль этого проекта
// (хардкод-селекторы, waitForTimeout, без expect.poll).
//
// Реальная цепочка на этом стенде для ЗАЯВЛЕНИЯ (signStatement) — три клика:
//   1. "Сформировать заявление" на странице деталей → открывает панель
//      предпросмотра документа ("Формирование заявления").
//   2. "Подписать" внизу этой панели (не в модалке) → открывает модалку
//      подтверждения "Подписание документа".
//   3. "Подписать" внутри этой модалки → реально запускает подписание.
// Ждём в конце текст "Подписано". Эта функция проверена на реальном
// прогоне и не менялась.
//
// Для ЗАПРОСА (signRequest) шаг "Сформировать заявление" отсутствует —
// первый клик "Подписать" сразу открывает печатную форму, дальше похожая
// цепочка (сертификат → возможна модалка подтверждения), но итоговый текст
// успеха ДРУГОЙ: "Документ успешно подписан", а не "Подписано". Это
// отдельная, ещё не проверенная на реальном прогоне функция — написана по
// аналогии, при первом падении сверьте логи/скриншоты и поправьте селекторы.
// ============================================================

import { Locator, Page } from '@playwright/test';
import { waitForTextWithReload } from './statementCreation';

const dropdownRoot = (page: Page) => page.locator('[class*="dropdownWrapper"]').last();

const timestamp = () => new Date().toLocaleTimeString('ru-RU');
const log = (message: string) => console.log(`[${timestamp()}] ${message}`);

async function clickFirstDropdownOption(page: Page): Promise<boolean> {
  const root = dropdownRoot(page);
  const noResults = root.getByText('Нет результатов поиска', { exact: true });
  const firstOption = root.locator('div[class*="wrapper"]').first();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const noResultsVisible = await noResults.isVisible().catch(() => false);
    const optionVisible = await firstOption.isVisible().catch(() => false);

    if (optionVisible && !noResultsVisible) {
      await firstOption.click();
      return true;
    }

    await page.waitForTimeout(500);
  }

  return false;
}

// После клика по "Подписать" (и в панели предпросмотра, и в финальной
// модалке) может всплыть дропдаун выбора сертификата — если он есть, берём
// первый вариант. Если сертификат один, дропдаун может не появиться вовсе,
// это не ошибка. Возвращает true, если дропдаун реально появился и из него
// что-то выбрали — по этому флагу можно понять в логах, был ли выбор
// сертификата вообще произведён.
async function selectCertificateIfDropdownAppears(page: Page): Promise<boolean> {
  const dropdownAppeared = await dropdownRoot(page)
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (!dropdownAppeared) {
    return false;
  }

  log('📋 Появился дропдаун выбора сертификата, беру первый вариант');

  const optionClicked = await clickFirstDropdownOption(page);

  if (!optionClicked) {
    log('⚠️ Не нашёл сертификат в списке дропдауна');
    return false;
  }

  log('✅ Сертификат выбран');
  return true;
}

// Заходит в уже сформированное заявление (страница деталей) и подписывает его.
// НЕ ИЗМЕНЕНА — проверенная на реальном прогоне логика, текст успеха "Подписано".
export async function signStatement(page: Page): Promise<void> {
  log('✍️ Подписание заявления...');

  const formStatementButton = page.getByRole('button', { name: 'Сформировать заявление', exact: true });

  await formStatementButton.waitFor({ state: 'visible', timeout: 60000 });
  await formStatementButton.click();
  log(`🖱️ Клик "Сформировать заявление" (url: ${page.url()})`);

  const previewSignButton = page.getByRole('button', { name: 'Подписать', exact: true });
  const previewVisible = await previewSignButton
    .waitFor({ state: 'visible', timeout: 30000 })
    .then(() => true)
    .catch(() => false);

  if (!previewVisible) {
    log('⚠️ Кнопка "Подписать" в предпросмотре документа не появилась.');
    await page.screenshot({ path: 'no-sign-button.png' });
    return;
  }

  await previewSignButton.click();
  log(`🖱️ Клик "Подписать" в предпросмотре документа (url: ${page.url()})`);

  await selectCertificateIfDropdownAppears(page);

  const signModal = page.locator('[class*="modalWrapper"]').filter({ hasText: 'Подписание документа' });
  const modalVisible = await signModal
    .waitFor({ state: 'visible', timeout: 30000 })
    .then(() => true)
    .catch(() => false);

  if (!modalVisible) {
    log('⚠️ Модалка подписания не появилась.');
    await page.screenshot({ path: 'no-sign-button.png' });
    return;
  }

  log('✅ Модалка "Подписание документа" открылась');

  const signButton: Locator = signModal.getByRole('button', { name: 'Подписать', exact: true });
  const isSignVisible = await signButton.isVisible({ timeout: 60000 }).catch(() => false);

  if (!isSignVisible) {
    log('⚠️ Кнопка "Подписать" в модалке не появилась. Проверьте сертификат в КриптоПро CSP.');
    await page.screenshot({ path: 'no-sign-button.png' });
    return;
  }

  log('⏸️ Пауза 1 сек перед кликом "Подписать" в модалке...');
  await page.waitForTimeout(1000);
  await signButton.click();
  log(`🖱️ Клик "Подписать" в модалке сделан (url: ${page.url()})`);

  await selectCertificateIfDropdownAppears(page);

  log('⏳ Жду закрытия модалки подписания (если КриптоПро спросит подтверждение — подтверди в нативном окне)...');
  await signModal.waitFor({ state: 'hidden', timeout: 10 * 60 * 1000 });
  log(`✅ Модалка подписания закрылась (url: ${page.url()})`);
  await page.screenshot({ path: 'after-sign-modal-closed.png' });

  log('⏳ Жду текст "Подписано"...');
  await page.waitForSelector('text=Подписано', { state: 'visible', timeout: 10 * 60 * 1000 });
  log('✅ Текст "Подписано" найден');

  await page.screenshot({ path: 'sign-complete.png' });
  await page.waitForTimeout(5000);

  log('✅ Подписание завершено');
}

// Заходит в уже созданный запрос (страница деталей запроса) и подписывает
// его. В отличие от signStatement, здесь нет отдельного шага "Сформировать" —
// первый клик "Подписать" сразу открывает печатную форму. После второго
// клика "Подписать" (внутри печатной формы) может, как и в signStatement,
// всплыть модалка подтверждения "Подписание документа" — если появляется,
// доводим её до конца тем же способом; если нет — считаем, что подписание
// запускается сразу после выбора сертификата.
// ВНИМАНИЕ: структура печатной формы не проверена на реальном прогоне,
// код написан по аналогии с signStatement — при первом падении сверьте
// логи/скриншоты (no-sign-button-request*.png) и поправьте селекторы.
export async function signRequest(page: Page, expectedStatus: string | null = 'Отправлен'): Promise<void> {
  log('✍️ Подписание запроса...');

  const firstSignButton = page.getByRole('button', { name: 'Подписать', exact: true }).first();
  const firstVisible = await firstSignButton
    .waitFor({ state: 'visible', timeout: 30000 })
    .then(() => true)
    .catch(() => false);

  if (!firstVisible) {
    log('⚠️ Кнопка "Подписать" не появилась.');
    await page.screenshot({ path: 'no-sign-button-request.png' });
    return;
  }

  await firstSignButton.click();
  log(`🖱️ Клик "Подписать" — открываю печатную форму (url: ${page.url()})`);

  // Печатная форма открывается в модалке (просмотр документа/PDF). Внутри
  // неё тоже есть кнопка "Подписать" — важно искать именно её, а не
  // page-wide, иначе локатор может зацепить старую внешнюю кнопку "Подписать"
  // (ту, что рядом с "ВРИО/Отказать"), которая остаётся в DOM, но визуально
  // перекрыта модалкой — клик по ней выглядит как "перехвачен оверлеем".
  const printFormModal = page.locator('[class*="modalWrapper"]').last();
  await printFormModal.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);

  const printFormSignButton = printFormModal.getByRole('button', { name: 'Подписать', exact: true });
  const printFormVisible = await printFormSignButton
    .waitFor({ state: 'visible', timeout: 30000 })
    .then(() => true)
    .catch(() => false);

  if (!printFormVisible) {
    log('⚠️ Кнопка "Подписать" в печатной форме не появилась.');
    await page.screenshot({ path: 'no-sign-button-request-print.png' });
    return;
  }

  // На всякий случай оставляем force-фолбэк, если что-то внутри самой
  // модалки (например, ещё не догрузившийся PDF) всё же перехватит клик.
  // Плюс наводим курсор перед кликом и, если обычный/force клик не дают
  // эффекта, пробуем "физический" клик мышью по координатам центра
  // кнопки — иногда это надёжнее синтетического Locator.click() для
  // виджетов, завязанных на настоящие события указателя.
  await printFormSignButton.hover().catch(() => {});
  await page.waitForTimeout(300);

  try {
    await printFormSignButton.click({ timeout: 15000 });
  } catch {
    log('⚠️ Обычный клик по "Подписать" в печатной форме не прошёл — пробую force-клик');
    await page.waitForTimeout(1000);
    await printFormSignButton.click({ force: true });
  }
  log(`🖱️ Клик "Подписать" в печатной форме (url: ${page.url()})`);

  const certSelected = await selectCertificateIfDropdownAppears(page);
  log(`ℹ️ Дропдаун сертификата ${certSelected ? 'появился, сертификат выбран' : 'не появился (возможно, сертификат один и выбор не требовался)'}`);

  // Диагностика сразу после клика — не ждём молча 10 минут, а сразу
  // фиксируем, что реально на экране, независимо от исхода
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'after-print-form-sign-click.png', fullPage: true }).catch(() => {});
  const postClickTexts = await page.locator('button, [role="alert"], [class*="error"], [class*="toast"]')
    .allTextContents()
    .catch(() => []);
  log('📋 Видимые кнопки/уведомления сразу после клика в печатной форме:');
  log(postClickTexts.filter(t => t.trim()).join(' | '));

  const signModal = page.locator('[class*="modalWrapper"]').filter({ hasText: 'Подписание документа' });
  const modalAppeared = await signModal
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (modalAppeared) {
    log('✅ Модалка "Подписание документа" открылась');

    const modalSignButton = signModal.getByRole('button', { name: 'Подписать', exact: true });
    const isModalSignVisible = await modalSignButton.isVisible({ timeout: 60000 }).catch(() => false);

    if (!isModalSignVisible) {
      log('⚠️ Кнопка "Подписать" в модалке не появилась. Проверьте сертификат в КриптоПро CSP.');
      await page.screenshot({ path: 'no-sign-button-request.png' });
      return;
    }

    log('⏸️ Пауза 1 сек перед кликом "Подписать" в модалке...');
    await page.waitForTimeout(1000);
    await modalSignButton.click();
    log(`🖱️ Клик "Подписать" в модалке сделан (url: ${page.url()})`);

    await selectCertificateIfDropdownAppears(page);

    log('⏳ Жду закрытия модалки подписания (если КриптоПро спросит подтверждение — подтверди в нативном окне)...');
    await signModal.waitFor({ state: 'hidden', timeout: 10 * 60 * 1000 });
    log(`✅ Модалка подписания закрылась (url: ${page.url()})`);
  }

  if (expectedStatus === null) {
    // Проверка статуса на этой странице отключена явно (текст либо не
    // детектируется локатором, либо не нужен в этом сценарии — дальнейшую
    // проверку делает вызывающий код в другом месте, например статус
    // "Услуга оказана" на странице самого заявления)
    log('ℹ️ Проверка статуса пропущена (expectedStatus = null)');
    await page.screenshot({ path: 'sign-request-complete.png' });
    await page.waitForTimeout(3000);
    log('✅ Подписание запроса завершено (без проверки статуса)');
    return;
  }

  // Текст "Документ успешно подписан" — это временный тост, который может
  // исчезнуть до того, как мы его проверим. Надёжнее дождаться финального
  // статуса на странице — он уже не тост, а постоянное состояние. У разных
  // документов финальный статус разный (например, "Отправлен" у запроса,
  // "Подписано" у решения) — поэтому это параметр, а не константа.
  //
  // Статус может не обновляться реактивно без перезагрузки страницы —
  // waitForTextWithReload периодически обновляет страницу, пока текст
  // не появится, а не просто ждёт разово.
  log(`⏳ Жду статус "${expectedStatus}"...`);
  await waitForTextWithReload(page, expectedStatus, { maxDurationMs: 3 * 60 * 1000, pollIntervalMs: 5000 });
  log(`✅ Статус "${expectedStatus}" подтверждён`);

  await page.screenshot({ path: 'sign-request-complete.png' });
  await page.waitForTimeout(5000);

  log('✅ Подписание запроса завершено');
}
