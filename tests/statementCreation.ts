// ============================================================
// ФАЙЛ: tests/statementCreation.ts
// ПЕРЕИСПОЛЬЗУЕМЫЕ ШАГИ СОЗДАНИЯ ЗАЯВЛЕНИЯ
// ============================================================

import { Page, Locator } from '@playwright/test';

// ------------------------------------------------------------
// ВВОД ТЕКСТА В РЕДАКТОР JODIT (contenteditable div) С ПРОВЕРКОЙ ПОЛНОТЫ
// Обычный .fill() на нём не работает надёжно, поэтому кликаем и печатаем
// через клавиатуру. Раньше после ввода проверяли только "текст не пустой" —
// этого хватало, чтобы пройти проверку даже с ОБРЕЗАННЫМ текстом (часть
// символов иногда теряется при вводе — подтверждено на реальном прогоне:
// вместо полной фразы в редакторе оставалось только "Запрос Минздрава").
// Теперь сверяем текст целиком и, если не совпал, чистим редактор
// (Ctrl+A, Delete) и вводим заново — до 3 попыток.
// ------------------------------------------------------------
export async function typeIntoJoditEditor(page: Page, editor: Locator, text: string): Promise<void> {
  let filled = false;
  for (let attempt = 0; attempt < 3 && !filled; attempt++) {
    if (attempt > 0) {
      await editor.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await page.waitForTimeout(200);
    }

    await editor.click();
    await page.keyboard.type(text);
    await page.waitForTimeout(300);

    const editorText = ((await editor.textContent().catch(() => '')) ?? '').trim();
    filled = editorText.includes(text.trim());

    if (!filled) {
      console.log(
        `⏳ Текст в редакторе неполный (попытка ${attempt + 1}/3): получили "${editorText}", ожидали "${text}". Пробую ещё раз...`,
      );
    }
  }

  if (!filled) {
    await page.screenshot({ path: 'debug-jodit-text-incomplete.png', fullPage: true }).catch(() => {});
    throw new Error(
      `Текст "${text}" не появился в редакторе полностью после 3 попыток. Скриншот: debug-jodit-text-incomplete.png`,
    );
  }
}

// ------------------------------------------------------------
// УНИВЕРСАЛЬНЫЙ ВЫБОР ЗНАЧЕНИЯ В КАСТОМНОМ ДРОПДАУНЕ
// (повторяющийся паттерн: клик → ждать опцию → если не появилась,
// кликнуть ещё раз force → снова ждать)
// ------------------------------------------------------------
export async function selectDropdownOption(
  page: Page,
  dropdown: Locator,
  option: Locator,
) {
  await dropdown.click();
  // Раньше тут была слепая пауза 1000мс перед option.waitFor() ниже — но
  // waitFor() и так поллит DOM до 5с сам, ждать перед ним смысла нет,
  // только теряем время на каждом из множества вызовов этой функции.
  // 200мс — не пауза "на прогрузку", а просто отсрочка перед первой
  // проверкой, чтобы не долбить DOM в первую же миллисекунду после клика.
  await page.waitForTimeout(200);
  await option.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
    dropdown.click({ force: true });
    return option.waitFor({ state: 'visible', timeout: 5000 });
  });
  await option.click();
  await page.waitForTimeout(200);
}

// ------------------------------------------------------------
// ПРОВЕРКА/ВЫБОР УЧАСТНИКА МАРШРУТА ЭДО (блок "Согласование" на форме
// запроса/решения: "Исполнитель" / "Согласующий" / "Подписант"). На
// некоторых стендах (например, dev01) эти поля по умолчанию заполняются
// не тем человеком — несколько людей делят похожую роль, и дефолт может
// быть неверным (подтверждено на dev01: "Исполнитель" по умолчанию
// "Ковалёва Елена Ивановна" вместо нужного "Михайлов"). На тест-стенде
// пока дефолт всегда верный, но функция безопасна и там: если текущее
// значение уже совпадает — просто ничего не делает.
// Подпись поля — НЕ <label> (в отличие от "Дата приказа"/"Номер приказа"),
// а обычный <div style="width:40%;">Исполнитель</div>, идущий соседом перед
// <div class="_long_njmme_30"><div class="_selectInput_njmme_3">...</div></div>
// — подтверждено реальным деревом DOM. Матчим по ТОЧНОМУ тексту (exact),
// иначе getByText зацепит любой родительский div, где эта подпись —
// просто часть текста.
// ------------------------------------------------------------
export async function ensureEdoParticipant(
  page: Page,
  fieldLabel: string,
  expectedNameSubstring: string,
): Promise<void> {
  const fieldTrigger = page
    .getByText(fieldLabel, { exact: true })
    .locator('xpath=following-sibling::div[1]');

  await fieldTrigger.waitFor({ state: 'visible', timeout: 10000 });

  const currentValue = ((await fieldTrigger.textContent()) ?? '').trim();
  if (currentValue.includes(expectedNameSubstring)) {
    console.log(`✅ Поле "${fieldLabel}" уже содержит нужного пользователя: ${currentValue}`);
    return;
  }

  console.log(`⚠️ Поле "${fieldLabel}" содержит "${currentValue}", ожидали "${expectedNameSubstring}" — меняю`);

  await fieldTrigger.click();
  await page.waitForTimeout(500);

  // Дропдаун может быть с поиском (как РУ/ПОЦ) или без — пробуем оба варианта
  const searchInput = page.getByRole('textbox', { name: 'Поиск' }).last();
  const searchVisible = await searchInput.isVisible({ timeout: 3000 }).catch(() => false);
  if (searchVisible) {
    await searchInput.fill(expectedNameSubstring);
    await page.waitForTimeout(300);
  }

  // Опции живут в отдельном контейнере списка (см. дамп реального DOM:
  // div._listContainerRlp_...) — матчим текст ВНУТРИ него, а не по всей
  // странице: без этого можно случайно попасть в чужое совпадение того же
  // текста (например, в шапке — там как раз может быть залогинен
  // "Михайлов Дмитрий", если это его и ищем).
  const optionsContainer = page.locator('[class*="_listContainerRlp_"]').last();
  const option = optionsContainer.getByText(expectedNameSubstring).first();
  const optionVisible = await option.isVisible({ timeout: 5000 }).catch(() => false);
  if (!optionVisible) {
    await page.screenshot({ path: 'debug-edo-participant-not-found.png', fullPage: true }).catch(() => {});
    throw new Error(
      `Не нашёл "${expectedNameSubstring}" в списке для поля "${fieldLabel}". ` +
        `Скриншот: debug-edo-participant-not-found.png`,
    );
  }

  await option.click();
  await page.waitForTimeout(500);

  // Проверяем, что значение реально изменилось в поле — раньше клик мог
  // "попасть" не в то совпадение и тест продолжал бы работать вслепую,
  // как уже было с этим полем.
  const valueAfterClick = ((await fieldTrigger.textContent()) ?? '').trim();
  if (!valueAfterClick.includes(expectedNameSubstring)) {
    await page.screenshot({ path: 'debug-edo-participant-not-selected.png', fullPage: true }).catch(() => {});
    throw new Error(
      `После клика поле "${fieldLabel}" всё ещё показывает "${valueAfterClick}", а не "${expectedNameSubstring}". ` +
        `Скриншот: debug-edo-participant-not-selected.png`,
    );
  }

  console.log(`✅ Поле "${fieldLabel}" установлено на "${expectedNameSubstring}"`);
}

// ------------------------------------------------------------
// ОТКРЫТИЕ ДРОПБОКСА ВЫБОРА РУ (сценарии перерегистрации: increase/defectura)
// Дропдаун иногда не открывается с первого клика (та же гонка гидратации,
// что и везде в коде) — клик "проходит", поле поиска внутри не появляется,
// и без проверки тест просто зависал бы на следующем шаге, требуя ручного
// клика. Проверяем эффект и повторяем клик, прежде чем идти дальше.
// ------------------------------------------------------------
export async function openRegistrationNumberDropdown(page: Page): Promise<Locator> {
  const dropdownTrigger = page.locator('[data-field-name="registrationNumber"] ._selectValue_njmme_55');
  await dropdownTrigger.click();
  await page.waitForTimeout(1000);

  const searchInput = page.getByRole('textbox', { name: 'Поиск' });
  let opened = await searchInput.isVisible({ timeout: 3000 }).catch(() => false);

  if (!opened) {
    console.log('⏳ Дропдаун выбора РУ не открылся с первого клика — пробую ещё раз...');
    await dropdownTrigger.click({ force: true });
    await page.waitForTimeout(1000);
    opened = await searchInput.isVisible({ timeout: 3000 }).catch(() => false);
  }

  if (!opened) {
    await page.screenshot({ path: 'debug-ru-dropdown-not-opened.png', fullPage: true }).catch(() => {});
    throw new Error(
      'Дропдаун выбора РУ не открылся (поле поиска не появилось). Скриншот: debug-ru-dropdown-not-opened.png',
    );
  }

  return searchInput;
}

// ------------------------------------------------------------
// ВЫБОР ЦЕНЫ ИЗ РЕЕСТРА (дропдаун "registry" — появляется после выбора РУ
// во всех услугах, КРОМЕ регистрации: там цена не выбирается из реестра,
// а вводится заново).
//
// ОБЯЗАТЕЛЬНО проверяем, что после клика по найденной в поиске опции в
// дропдауне реально осталась выбранной именно ожидаемая цена — по
// наблюдению, поиск по подстроке иногда матчит/кликает не ту строку (та же
// гонка гидратации списка, что и в других дропдаунах), и тогда вся
// дальнейшая цепочка идёт по неверной записи реестра и рушится без внятной
// ошибки на этом шаге.
// ------------------------------------------------------------
export async function selectPriceFromRegistry(page: Page, priceValue: string): Promise<void> {
  const priceDropdown = page.locator('[data-field-name="registry"] ._selectValue_njmme_55');

  const selectOnce = async () => {
    await priceDropdown.click();
    await page.waitForTimeout(500);

    const priceSearchInput = page.getByRole('textbox', { name: 'Поиск' }).last();
    await priceSearchInput.click();
    await priceSearchInput.fill(priceValue);
    await page.waitForTimeout(300);
    await page.getByText(priceValue).first().click();
    await page.waitForTimeout(300);
  };

  await selectOnce();

  let selectedText = ((await priceDropdown.textContent()) ?? '').trim();
  if (!selectedText.includes(priceValue)) {
    console.log(
      `⚠️ После выбора цены в реестре дропдаун показывает "${selectedText}", ожидали "${priceValue}" — пробую ещё раз`,
    );
    await selectOnce();
    selectedText = ((await priceDropdown.textContent()) ?? '').trim();
  }

  if (!selectedText.includes(priceValue)) {
    await page.screenshot({ path: 'debug-registry-price-mismatch.png', fullPage: true }).catch(() => {});
    throw new Error(
      `В дропдауне реестра выбрана не та цена: показывает "${selectedText}", ожидали "${priceValue}". ` +
        'Скриншот: debug-registry-price-mismatch.png',
    );
  }

  console.log(`✅ В реестре выбрана цена: ${selectedText}`);
}

// ------------------------------------------------------------
// ШАГ 2-3: ВЫБОР УСЛУГИ И ЛЕКАРСТВА
// ------------------------------------------------------------
export async function selectMedicine(
  page: Page,
  serviceName: string,
  searchText: string,
  ruNumber: string,
) {
  // Сразу после логина/переключения пользователя страница может ещё
  // не навесить обработчики на кнопку — клик "проходит", но эффекта
  // не даёт. Даём странице чуть осесть и проверяем, реально ли открылось меню.
  const getServiceButton = page.getByRole('button', { name: 'Получить услугу' });
  await getServiceButton.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(500);
  await getServiceButton.click();
  await page.waitForTimeout(1000);

  const serviceOption = page.getByText(serviceName);
  const menuOpened = await serviceOption.isVisible({ timeout: 3000 }).catch(() => false);
  if (!menuOpened) {
    // Первый клик не сработал — пробуем ещё раз принудительно
    await getServiceButton.click({ force: true });
    await page.waitForTimeout(1000);
  }

  await serviceOption.click();
  await page.waitForTimeout(1000);

  await page.locator('[data-field-name="registrationNumber"] ._selectValue_njmme_55').click();
  await page.waitForTimeout(3000);

  const searchInput = page.getByRole('textbox', { name: 'Поиск' });
  const isVisible = await searchInput.isVisible({ timeout: 2000 }).catch(() => false);

  if (!isVisible) {
    await page.locator('[data-field-name="registrationNumber"]').click();
    await page.waitForTimeout(3000);
  }

  await searchInput.click();
  await searchInput.fill(searchText);
  await page.waitForTimeout(300);
  await page.getByText(ruNumber).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.waitForTimeout(1000);
}

// ------------------------------------------------------------
// ШАГ 4: EMAIL + НОМЕР АККРЕДИТАЦИИ
// (на сайте это поле встречается на двух последовательных шагах)
// ------------------------------------------------------------
export async function fillContactInfo(
  page: Page,
  email: string,
  accreditationNumber: string,
) {
  const emailField = page.getByRole('textbox', {
    name: 'Введите адрес электронной почты в формате example@example.ru',
  });

  await emailField.click();
  await emailField.fill(email);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.waitForTimeout(1000);

  await emailField.click();
  await emailField.fill(email);
  await emailField.press('Tab');
  await page.getByRole('textbox', { name: 'Введите номер записи об аккредитации' }).fill(accreditationNumber);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.waitForTimeout(1000);
}

// ------------------------------------------------------------
// ШАГ 5: ПРОМЕЖУТОЧНЫЕ ШАГИ БЕЗ ВВОДА ДАННЫХ
// ------------------------------------------------------------
export async function skipIntermediateSteps(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    await page.getByRole('button', { name: 'Продолжить' }).click();
    // Было 1000мс на каждый клик — эта функция вызывается с count 2-6 почти
    // в каждом сценарии, так что раньше тут набегало по несколько секунд
    // чистого ожидания без проверки эффекта. 500мс достаточно, чтобы
    // страница успела отрисовать следующий шаг перед следующим кликом.
    await page.waitForTimeout(500);
  }
}

// ------------------------------------------------------------
// ШАГ 6: ФОРМА ВЫПУСКА
// ------------------------------------------------------------
export type ReleaseFormOptions = {
  releaseForm: string;
  dosageForm: string;
  dosage: string;
  secondaryPackage: string; // regex-совместимая строка для точного совпадения
  primaryPackage: string;
};

export async function selectReleaseForm(page: Page, opts: ReleaseFormOptions) {
  await selectDropdownOption(
    page,
    page.locator('._selectInput_njmme_3').first(),
    page.getByText(opts.releaseForm),
  );

  await selectDropdownOption(
    page,
    page.locator('div:nth-child(4) > div > ._long_njmme_30 > ._selectInput_njmme_3'),
    page.getByText(opts.dosageForm, { exact: true }),
  );

  await selectDropdownOption(
    page,
    page.locator('div:nth-child(6) > div > ._long_njmme_30 > ._selectInput_njmme_3'),
    page.getByText(opts.dosage, { exact: true }),
  );

  await selectDropdownOption(
    page,
    page.locator('div:nth-child(7) > div > ._long_njmme_30 > ._selectInput_njmme_3'),
    page.locator('div').filter({ hasText: new RegExp(`^${opts.secondaryPackage}$`) }),
  );

  await selectDropdownOption(
    page,
    page.locator('div:nth-child(9) > div > ._long_njmme_30 > ._selectInput_njmme_3'),
    page.getByText(opts.primaryPackage),
  );
}

// ------------------------------------------------------------
// ГЕНЕРАЦИЯ ШТРИХ-КОДА И ЦЕНЫ ДЛЯ ЗАЯВЛЕНИЯ
// ------------------------------------------------------------
export function generateStatementData(statementNumber: number) {
  const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  const barcode = `460700836${randomSuffix}`;

  let priceStr: string;

  // Нечётные заявления — фиксированная цена, чётные — случайная
  if (statementNumber % 2 !== 0) {
    priceStr = '3499.99';
  } else {
    let price: number;
    do {
      price = 2999.99 + Math.random() * 1000;
      priceStr = price.toFixed(2);
    } while (priceStr.endsWith('0') || priceStr.endsWith('00'));
  }

  return { barcode, priceStr };
}

// Меняет последние 4 символа СУЩЕСТВУЮЩЕГО значения на случайные цифры,
// остальное (префикс) не трогает — используется в сценарии "Внесение
// изменений", где штрих-код/ТН ВЭД редактируются у уже зарегистрированного
// препарата, а не генерируются с нуля (в отличие от regenerateBarcode ниже,
// у которого префикс фиксированный и известный заранее).
export function withRandomLastFourDigits(current: string): string {
  const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return current.slice(0, -4) + randomSuffix;
}

// Читает текущее значение поля, меняет последние 4 цифры на случайные,
// вписывает обратно. Возвращает новое значение — пригодится для логов.
export async function regenerateLastFourDigits(page: Page, input: Locator): Promise<string> {
  await input.waitFor({ state: 'visible', timeout: 10000 });
  const current = (await input.inputValue()) || '';
  const updated = withRandomLastFourDigits(current);
  await input.fill(updated);
  await page.waitForTimeout(300);
  return updated;
}

// Новый штрих-код с тем же префиксом, что и при создании заявления —
// используется при редактировании (ответ на запрос), где нужно поменять
// только последние 4 цифры существующего штрих-кода на случайные
export function regenerateBarcode(): string {
  const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `460700836${randomSuffix}`;
}

// Случайная цена в заданном диапазоне (кратно копейкам), без выхода на
// "круглые" значения — используется при редактировании заявления
export function generatePriceInRange(min: number, max: number): string {
  let price: number;
  let priceStr: string;
  do {
    price = min + Math.random() * (max - min);
    priceStr = price.toFixed(2);
  } while (priceStr.endsWith('0') || priceStr.endsWith('00'));
  return priceStr;
}

// ------------------------------------------------------------
// КЛИК "ПРОДОЛЖИТЬ" С ПРОВЕРКОЙ ЭФФЕКТА
//
// По наблюдению (скриншот от пользователя: кнопка видна, реагирует на
// ручной клик, но автотест "не идёт дальше"), клик иногда "проходит" —
// Playwright видит кнопку и кликает — но эффекта не даёт: React ещё не
// навесил обработчик или не обработал предыдущий .fill() к моменту клика
// (та же гонка гидратации, что и в других дропдаунах/кнопках по всему
// проекту). Проверяем, что после клика реально появился текст следующего
// шага, и если нет — кликаем ещё раз (force), прежде чем сдаваться.
// ------------------------------------------------------------
export async function clickContinueAndWaitFor(
  page: Page,
  expectedText: string,
  timeoutMs: number = 10000,
): Promise<void> {
  const continueButton = page.getByRole('button', { name: 'Продолжить' });
  await continueButton.click();

  let advanced = await page
    .waitForSelector(`text=${expectedText}`, { state: 'visible', timeout: Math.min(timeoutMs, 6000) })
    .then(() => true)
    .catch(() => false);

  if (!advanced) {
    console.log(
      `⚠️ Клик "Продолжить" не сработал с первого раза (ждали "${expectedText}") — пробую ещё раз...`,
    );
    await continueButton.click({ force: true });
    advanced = await page
      .waitForSelector(`text=${expectedText}`, { state: 'visible', timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
  }

  if (!advanced) {
    await page.screenshot({ path: 'debug-continue-not-advanced.png', fullPage: true }).catch(() => {});
    throw new Error(
      `Кнопка "Продолжить" не сработала — не дождались "${expectedText}". Скриншот: debug-continue-not-advanced.png`,
    );
  }
}

// ------------------------------------------------------------
// ЗАПОЛНЕНИЕ ОСНОВНЫХ ПОЛЕЙ ЛЕКАРСТВА (штрих-код, ТН ВЭД, цена)
// ------------------------------------------------------------
export async function fillMedicineInfo(
  page: Page,
  barcode: string,
  tnVedCode: string,
  priceStr: string,
) {
  await page.locator('input[name="medicineInformation.barcode"]').fill(barcode);
  await page.waitForTimeout(300);
  await page.locator('input[name="medicineInformation.tnVedEaecCode"]').fill(tnVedCode);
  await page.waitForTimeout(300);
  await page.locator('input[name="medicineInformation.priceLimitValue"]').fill(priceStr);
  await page.waitForTimeout(300);

  await clickContinueAndWaitFor(page, 'Стадии производства');
}

// ------------------------------------------------------------
// ЗАПОЛНЕНИЕ НОВОЙ ЦЕНЫ ПРИ СОЗДАНИИ ЗАЯВЛЕНИЯ (увеличение/дефектура/
// снижение — там уже выбрана исходная цена из реестра через
// selectPriceFromRegistry, здесь вводится НОВАЯ целевая цена)
// + клик "Продолжить" с проверкой эффекта (см. clickContinueAndWaitFor).
// ------------------------------------------------------------
export async function fillNewPriceAndContinue(page: Page, priceStr: string): Promise<void> {
  const priceInput = page.locator('input[name="newPriceLimitValue"]');
  await priceInput.waitFor({ state: 'visible', timeout: 10000 });
  await priceInput.click();
  await priceInput.clear();
  await priceInput.fill(priceStr);

  // Явно уводим фокус с поля (Tab) — подозрение, что валидация/нормализация
  // цены навешена на onBlur, а не на каждый ввод, и обработчик клика
  // "Продолжить" читает уже провалидированное значение формы, а не сырой
  // DOM-value поля. Без явного blur клик по кнопке (видимой, enabled)
  // проходит без эффекта — подтверждено скриншотом DevTools пользователя
  // (disabled: false, обычный <button>, ничего не перекрывает).
  await priceInput.press('Tab');
  await page.waitForTimeout(300);

  // Если после blur на форме появилась ошибка валидации — логируем её текст
  // вместо того, чтобы вслепую жать "Продолжить" и упираться в таймаут ниже.
  const validationError = page.locator('[class*="error" i]').first();
  if (await validationError.isVisible({ timeout: 500 }).catch(() => false)) {
    console.log(`⚠️ Похоже на ошибку валидации после ввода цены "${priceStr}": ${await validationError.textContent()}`);
  }

  await clickContinueAndWaitFor(page, 'Стадии производства');
}

// Заполнение штрих-кода и цены при РЕДАКТИРОВАНИИ заявления (ответ на
// запрос) — в отличие от fillMedicineInfo, здесь НЕ кликаем "Продолжить"
// и не ждём "Стадии производства": по этому сценарию дальше идёт просто
// ещё 2 клика "Продолжить" без стадий производства и документов
export async function editBarcodeAndPrice(page: Page, barcode: string, priceStr: string) {
  const barcodeInput = page.locator('input[name="medicineInformation.barcode"]');
  await barcodeInput.waitFor({ state: 'visible', timeout: 10000 });
  await barcodeInput.fill(barcode);
  await page.waitForTimeout(300);

  const priceInput = page.locator('input[name="medicineInformation.priceLimitValue"]');
  await priceInput.fill(priceStr);
  await page.waitForTimeout(300);
}

// ------------------------------------------------------------
// ШАГ 7: СТАДИИ ПРОИЗВОДСТВА
// Форма состоит из 5 пар "субъект + площадка": первичная упаковка,
// вторичная упаковка, производство, контроль качества.
// ------------------------------------------------------------
export type ProductionStageOptions = {
  primaryPacker: string;
  primarySite: string;
  secondaryPacker: string;
  secondarySite: string;
  manufacturer: string;
  manufacturerSite: string;
  qc: string;
  qcSite: string;
};

export async function selectProductionStages(page: Page, opts: ProductionStageOptions) {
  await selectDropdownOption(
    page,
    page.locator('._selectInput_njmme_3').first(),
    page.getByText(opts.primaryPacker),
  );

  await selectDropdownOption(
    page,
    page.locator('._selectInput_njmme_3._error_njmme_58'),
    page.getByText(opts.primarySite),
  );

  await selectDropdownOption(
    page,
    page.locator('div:nth-child(2) > div > ._long_njmme_30 > ._selectInput_njmme_3').first(),
    page.locator('span').filter({ hasText: opts.secondaryPacker }),
  );

  await selectDropdownOption(
    page,
    page.locator('._selectInput_njmme_3._error_njmme_58'),
    page.locator('span').filter({ hasText: opts.secondarySite }),
  );

  await selectDropdownOption(
    page,
    page.locator('div:nth-child(3) > div > ._long_njmme_30 > ._selectInput_njmme_3').first(),
    page.locator('span').filter({ hasText: opts.manufacturer }),
  );

  await selectDropdownOption(
    page,
    page.locator('._selectInput_njmme_3._error_njmme_58'),
    page.locator('span').filter({ hasText: opts.manufacturerSite }),
  );

  await selectDropdownOption(
    page,
    page.locator('div:nth-child(4) > div > ._long_njmme_30 > ._selectInput_njmme_3').first(),
    page.getByText(opts.qc),
  );

  await selectDropdownOption(
    page,
    page.locator('._selectInput_njmme_3._error_njmme_58'),
    page.getByText(opts.qcSite),
  );

  await page.waitForSelector('button:has-text("Продолжить"):not([disabled])', {
    state: 'visible',
    timeout: 10000,
  });
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.waitForTimeout(1000);

  await page.waitForSelector('text=Документы', { state: 'visible', timeout: 100000 });
}

// ------------------------------------------------------------
// ШАГ 8: ЗАГРУЗКА ДОКУМЕНТОВ
// ------------------------------------------------------------
export type DocumentToUpload = {
  file: string;
  sig: string;
  pages: string;
};

export async function uploadDocuments(page: Page, documents: DocumentToUpload[]) {
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
}

// ------------------------------------------------------------
// НАЗНАЧЕНИЕ ИСПОЛНИТЕЛЯ (модалка "Назначение исполнителя")
// Кнопка "Назначить исполнителя" должна уже быть видна на странице —
// её готовность (с учётом возможной задержки на бэкенде) проверяется
// отдельно вызывающим кодом.
// ------------------------------------------------------------
export async function assignExecutor(page: Page, searchText: string, fullNameText: string) {
  await page.getByRole('button', { name: 'Назначить исполнителя' }).click();
  await page.waitForSelector('text=Назначение исполнителя', { state: 'visible', timeout: 10000 });

  // TODO: уточнить точный локатор поля поиска в диалоге — сейчас предполагаю
  // тот же паттерн, что и в остальных дропдаунах ("Поиск")
  const searchInput = page.getByRole('textbox', { name: 'Поиск' });
  await searchInput.fill(searchText);
  await page.waitForTimeout(500);
  await page.getByText(fullNameText).first().click();
  await page.waitForTimeout(300);

  // exact: true — иначе локатор может совпасть и с кнопкой
  // "Назначить исполнителя", которая всё ещё в DOM за модалкой
  const confirmButton = page.getByRole('button', { name: 'Назначить', exact: true });
  await confirmButton.waitFor({ state: 'visible', timeout: 5000 });

  // Кнопка неактивна, пока строка результата реально не выбрана — клик по
  // тексту иногда "проходит" без эффекта (та же гонка гидратации, что и
  // везде). Проверяем enabled вместо того, чтобы бить вслепую по disabled.
  let confirmEnabled = await confirmButton.isEnabled().catch(() => false);
  if (!confirmEnabled) {
    console.log(`⏳ Кнопка "Назначить" неактивна — строка "${fullNameText}", похоже, не выбралась, пробую ещё раз...`);
    await page.getByText(fullNameText).first().click({ force: true });
    await page.waitForTimeout(500);
    confirmEnabled = await confirmButton.isEnabled().catch(() => false);
  }

  if (!confirmEnabled) {
    await page.screenshot({ path: 'debug-assign-executor-not-enabled.png', fullPage: true }).catch(() => {});
    throw new Error(
      `Кнопка "Назначить" осталась неактивной — строка "${fullNameText}" не выбралась. ` +
        'Скриншот: debug-assign-executor-not-enabled.png',
    );
  }

  await confirmButton.click();
  await page.waitForTimeout(1000);

  // Проверяем эффект: модалка "Назначение исполнителя" должна закрыться.
  // Раньше клик мог "пройти" без последствий, и тест продолжал бы работать
  // вслепую с фактически неназначенным исполнителем.
  const modalHeading = page.getByText('Назначение исполнителя');
  let modalStillOpen = await modalHeading.isVisible({ timeout: 3000 }).catch(() => false);
  if (modalStillOpen) {
    console.log('⏳ Модалка "Назначение исполнителя" всё ещё открыта после клика "Назначить" — пробую ещё раз...');
    await confirmButton.click({ force: true });
    await page.waitForTimeout(1500);
    modalStillOpen = await modalHeading.isVisible({ timeout: 3000 }).catch(() => false);
  }

  if (modalStillOpen) {
    await page.screenshot({ path: 'debug-assign-executor-not-confirmed.png', fullPage: true }).catch(() => {});
    throw new Error(
      'Модалка "Назначение исполнителя" не закрылась после клика "Назначить" — исполнитель, похоже, не назначен. ' +
        'Скриншот: debug-assign-executor-not-confirmed.png',
    );
  }

  console.log(`✅ Исполнитель назначен: ${fullNameText}`);
}

// ------------------------------------------------------------
// ВЫБОР ДАТЫ В КАЛЕНДАРЕ react-datepicker ПО СМЕЩЕНИЮ ОТ СЕГОДНЯ
// (0 = сегодня, 1 = завтра и т.д.). Сама кликает по переданному триггеру
// и открывает календарь — с защитой от гонки гидратации (клик может
// "пройти" без эффекта на свежесозданной странице, как уже бывало раньше).
// Поле-триггер — div (не input), см. addDocumentWithLetterNumber.
// ВНИМАНИЕ: не обрабатывает переход через границу месяца (если "завтра"
// попадает в следующий месяц, календарь может не показать его на текущем
// виде) — на практике это редкий edge case, но стоит иметь в виду.
// ------------------------------------------------------------
export async function selectDateInCalendarByOffset(page: Page, trigger: Locator, dayOffset: number) {
  await trigger.scrollIntoViewIfNeeded().catch(() => {});

  const visibleCalendar = page.locator('.react-datepicker').locator('visible=true');
  let calendarOpened = false;

  // На некоторых экранах (например, "Решение о внесении изменений в
  // реестровую запись" — тяжёлая страница с блоком загрузки файлов выше)
  // двух попыток по 300/500мс оказалось мало: элемент подтверждён живым
  // прогоном как кликабельный вручную, но гонка гидратации на этой
  // конкретной странице длиннее обычной. Поэтому 3 попытки с растущей паузой.
  for (let attempt = 0; attempt < 3 && !calendarOpened; attempt++) {
    await trigger.click({ force: attempt > 0 });
    await page.waitForTimeout(300 + attempt * 500);
    calendarOpened = await visibleCalendar
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (!calendarOpened) {
      console.log(`⏳ Календарь не открылся с попытки ${attempt + 1}/3 — пробую ещё раз...`);
    }
  }

  if (!calendarOpened) {
    await page.screenshot({ path: 'no-calendar-opened.png', fullPage: true }).catch(() => {});
    throw new Error('Календарь не открылся. Скриншот: no-calendar-opened.png');
  }

  const target = new Date();
  target.setDate(target.getDate() + dayOffset);
  const dayNumber = String(target.getDate());

  const dayCell = visibleCalendar
    .locator('.react-datepicker__day:not(.react-datepicker__day--outside-month)')
    .filter({ hasText: new RegExp(`^${dayNumber}$`) })
    .first();

  await dayCell.waitFor({ state: 'visible', timeout: 5000 });
  await dayCell.click();
  await page.waitForTimeout(300);

  return target;
}

// Случайный тестовый email (например, test-4213@example.ru) — для полей
// вида "Введите адрес электронной почты в формате example@example.ru",
// когда нужно просто сменить значение, а не подставить конкретный адрес.
export function generateRandomTestEmail(): string {
  const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `test-${randomSuffix}@example.ru`;
}

// Формат номера приказа: ДД.ММ.ГГГГ_ЧЧ.ММ (например, 10.08.2026_12.34)
export function generateOrderNumber(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy}_${hh}.${mi}`;
}

// ------------------------------------------------------------
// ОЖИДАНИЕ ТЕКСТА НА СТРАНИЦЕ С ПЕРИОДИЧЕСКИМ ОБНОВЛЕНИЕМ
// Статусы могут обновляться на бэкенде с задержкой — обновляем страницу
// каждые pollIntervalMs, пока текст не появится (тот же паттерн, что уже
// использовался для кнопки "Назначить исполнителя").
// ------------------------------------------------------------
export async function waitForTextWithReload(
  page: Page,
  text: string,
  options: { maxDurationMs?: number; pollIntervalMs?: number } = {},
): Promise<void> {
  const { maxDurationMs = 3 * 60 * 1000, pollIntervalMs = 5000 } = options;
  const locator = page.getByText(text, { exact: true });

  let found = await locator.isVisible().catch(() => false);
  const startedAt = Date.now();

  while (!found && Date.now() - startedAt < maxDurationMs) {
    console.log(`⏳ "${text}" ещё не появился — обновляю страницу...`);
    await page.reload();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(pollIntervalMs);
    found = await locator.isVisible().catch(() => false);
  }

  if (!found) {
    await page.screenshot({ path: 'wait-for-text-timeout.png', fullPage: true }).catch(() => {});
    throw new Error(`"${text}" не появился за отведённое время. Скриншот: wait-for-text-timeout.png`);
  }
  console.log(`✅ "${text}" появился`);
}

// ------------------------------------------------------------
// ШАГ 9: СОЗДАНИЕ ЗАЯВЛЕНИЯ (клик "Сформировать" + получение URL)
// ------------------------------------------------------------
export async function createStatement(page: Page): Promise<string> {
  await page.waitForSelector('button:has-text("Сформировать заявление"):not([disabled])', {
    state: 'visible',
    timeout: 60000,
  });
  await page.getByRole('button', { name: 'Сформировать заявление' }).click();

  await page.waitForURL(/\/price-limit\/statements\/details\/.+/, { timeout: 60000 });
  const statementUrl = page.url();

  await page.waitForSelector('[data-automationid="price-limit-statement-page"]', {
    state: 'visible',
    timeout: 30000,
  });

  return statementUrl;
}

// ------------------------------------------------------------
// ДОБАВЛЕНИЕ ДОКУМЕНТА С НОМЕРОМ/ДАТОЙ ПИСЬМА (модалка "Добавить документ")
// Отличается от uploadDocuments (шаг 8, модалка "Добавление документа"):
// здесь только один файл, без .sig, но есть поля "Номер письма" и
// "Дата письма". Используется, когда Михайлов повторно заходит в
// заявление после ответа заявителя.
// ------------------------------------------------------------

// Формат номера письма: ДДММГГГГ_ЧЧ.ММ_ФГБУ (например, 10082026_12.34_ФГБУ)
export function generateLetterNumber(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `${dd}${mm}${yyyy}_${hh}.${mi}_ФГБУ`;
}

export type AddDocumentModalOptions = {
  openButtonName?: string;
  modalHeadingText?: string;
  numberFieldLabel?: string;
  dateFieldLabel?: string;
};

// В дефектуре и модалка, и поля называются иначе, чем в сценарии полной
// регистрации ("ФГБУ НЦЭСМП" → "заключение Росздравнадзора") — сама
// механика (номер + дата + файл + "Сохранить") общая, отличаются только
// подписи. Значения по умолчанию — сценарий полной регистрации, чтобы
// существующие вызовы (registration_full, increase) остались без изменений.
export async function addDocumentWithLetterNumber(
  page: Page,
  filePath: string,
  options: AddDocumentModalOptions = {},
) {
  const {
    openButtonName = 'Загрузить ответ ФГБУ НЦЭСМП',
    modalHeadingText = 'Добавить документ',
    numberFieldLabel = 'Номер письма',
    dateFieldLabel = 'Дата письма',
  } = options;

  const openModalButton = page.getByRole('button', { name: openButtonName });
  await openModalButton.waitFor({ state: 'visible', timeout: 15000 });
  await openModalButton.click();
  await page.waitForTimeout(500);

  // Скоупим модалку по реальному классу (_modalBox_), а не по тексту —
  // кнопка-открывашка называется так же, как заголовок модалки, и
  // неотскоуленный текстовый локатор совпал бы сразу с двумя элементами.
  const modal = page.locator('[class*="modalBox"]').filter({ hasText: modalHeadingText });
  let modalOpened = await modal.isVisible({ timeout: 3000 }).catch(() => false);

  if (!modalOpened) {
    // Клик мог "пройти" без эффекта (та же гонка, что уже встречалась) —
    // пробуем ещё раз force-кликом
    await openModalButton.click({ force: true });
    await page.waitForTimeout(500);
    modalOpened = await modal.isVisible({ timeout: 5000 }).catch(() => false);
  }

  if (!modalOpened) {
    await page.screenshot({ path: 'no-add-document-modal.png', fullPage: true }).catch(() => {});
    throw new Error(
      `Модалка "${modalHeadingText}" не открылась (возможно, кнопка называется иначе). Скриншот: no-add-document-modal.png`,
    );
  }

  // Поля не имеют name/id/aria-label — связь с лейблом только визуальная
  // (label стоит прямо перед input как sibling). Ищем input как соседа
  // конкретного label по тексту — это подтверждено реальным DOM (дамп).
  const letterNumberInput = modal
    .locator('label', { hasText: numberFieldLabel })
    .locator('xpath=following-sibling::input[1]');
  await letterNumberInput.waitFor({ state: 'visible', timeout: 10000 });
  await letterNumberInput.fill(generateLetterNumber());
  await page.waitForTimeout(300);

  // Дата — это НЕ <input>, а span "Выберите дату" внутри
  // div.react-datepicker__input-container (подтверждено дампом реального DOM).
  // Кликаем по этой обёртке, а не ищем несуществующий input.
  const letterDateTrigger = modal
    .locator('label', { hasText: dateFieldLabel })
    .locator('xpath=following-sibling::div[1]');
  await letterDateTrigger.click();
  await page.waitForTimeout(300);

  const visibleCalendar = page.locator('.react-datepicker').locator('visible=true');
  const calendarOpened = await visibleCalendar
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (!calendarOpened) {
    await page.screenshot({ path: 'no-calendar-opened.png', fullPage: true }).catch(() => {});
    throw new Error(`Календарь для "${dateFieldLabel}" не открылся. Скриншот: no-calendar-opened.png`);
  }

  const todayOption = page.locator('.react-datepicker__day--today').locator('visible=true');
  await todayOption.waitFor({ state: 'visible', timeout: 5000 });
  await todayOption.click();
  await page.waitForTimeout(300);

  // Проверяем по тексту триггера (не inputValue — это не input): после
  // выбора текст должен смениться с "Выберите дату" на саму дату
  const dateText = await letterDateTrigger.textContent().catch(() => '');
  if (!dateText || dateText.trim() === '' || dateText.includes('Выберите дату')) {
    await page.screenshot({ path: 'date-not-selected.png', fullPage: true }).catch(() => {});
    throw new Error(
      `Клик по сегодняшней дате не изменил текст поля "${dateFieldLabel}" (значение: "${dateText}"). Скриншот: date-not-selected.png`,
    );
  }
  console.log(`📅 ${dateFieldLabel} проставлена: ${dateText}`);

  // Файл документа
  const fileInput = modal.locator('input[type="file"]').last();
  await fileInput.setInputFiles([filePath]);
  await page.waitForTimeout(1000);

  const fileName = filePath.split('/').pop() || filePath;
  await modal.getByText(fileName).waitFor({ state: 'visible', timeout: 10000 });

  // Сохранить
  const saveButton = modal.getByRole('button', { name: 'Сохранить' });
  await saveButton.waitFor({ state: 'visible', timeout: 5000 });
  await saveButton.click();
  await page.waitForTimeout(1000);

  await modal.waitFor({ state: 'hidden', timeout: 10000 });
}
