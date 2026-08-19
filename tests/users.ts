// ============================================================
// ФАЙЛ: tests/users.ts
// КОНФИГУРАЦИЯ ПОЛЬЗОВАТЕЛЕЙ И ФУНКЦИИ ДЛЯ РАБОТЫ С НИМИ
//
// ПОРТФОЛИО-ВЕРСИЯ: значения password ниже — плейсхолдер, реальные
// пароли не публикуются. Логика логина/логаута/переключения пользователя
// (retry-паттерны на гонки гидратации, обработка Keycloak-редиректа и
// т.д.) — без изменений от рабочей версии.
// ============================================================

import { Page } from '@playwright/test';

const TEST_PASSWORD = process.env.TEST_PASSWORD || 'CHANGE_ME';

export const users = [
  {
    name: 'Ильин Вадим Петрович',
    username: '784-967-752 98', // СНИЛС
    password: TEST_PASSWORD,
    roles: ['RLP_APPLICANT_POC'],
    title: 'Заявитель ПОЦ',
  },
  {
    name: 'Федорова Лариса Станиславовна',
    username: '077-254-921 89', // СНИЛС
    password: TEST_PASSWORD,
    roles: ['RLP_REGRESP_POC_MZ'],
    title: 'Исполнитель со стороны МЗ ПОЦ, Руководитель отдела МЗ ПОЦ',
  },
  {
    name: 'Филиппова Ирина Артёмовна',
    username: '835-247-627 18', // СНИЛС
    password: TEST_PASSWORD,
    roles: ['RLP_REGHDZAM_POC_MZ'],
    title: 'Руководитель департамента МЗ',
  },
  {
    name: 'Михайлов Дмитрий Петрович',
    username: 'D.Mikhailov@rlptest.ru', // TODO: заменить на СНИЛС
    password: TEST_PASSWORD,
    roles: ['RLP_REGRESP_POC'],
    title: 'Сотрудник отдела регулирования цен на лекарственные препараты и координации закупок Минздрава России',
  },
  {
    name: 'Демидов Захар Матвеевич',
    username: '140-141-067 90', // СНИЛС
    password: TEST_PASSWORD,
    roles: ['RLP_REGRESP_POC'],
    title: 'Сотрудник отдела регулирования цен на лекарственные препараты и координации закупок Минздрава России',
  },
  {
    name: 'Маслов Александр Сергеевич',
    username: '241-669-693 97', // СНИЛС
    password: TEST_PASSWORD,
    roles: ['RLP_REGHD_POC_MZ'],
    title: 'Руководитель отдела МЗ',
  },
  {
    name: 'Щербакова Мария Ильинична',
    username: '326-301-056 22', // СНИЛС
    password: TEST_PASSWORD,
    roles: ['RLP_REGRESP_POC_FAS'],
    title: 'Исполнитель со стороны ФАС России',
  },
  {
    name: 'Анисимов Борис Игоревич',
    username: '568-116-035 94', // СНИЛС
    password: TEST_PASSWORD,
    roles: ['RLP_REGMANAGER_POC_FAS'],
    title: 'Руководитель отдела ФАС',
  },
  {
    name: 'Новиков Даниил Валерьевич',
    username: '933-499-317 47', // СНИЛС
    password: TEST_PASSWORD,
    roles: ['RLP_REGHD_POC_FAS'],
    title: 'Руководитель департамента ФАС',
  },
  {
    name: 'Ветров Иван Васильевич',
    username: 'i.turgenev@rlptest.ru', // TODO: заменить на СНИЛС
    password: TEST_PASSWORD,
    roles: ['RLP_ADMIN'],
    title: 'Администратор',
  },
  {
    name: 'Ковалёва Елена Ивановна',
    username: '075-216-680 65', // СНИЛС
    password: TEST_PASSWORD,
    roles: ['RLP_REGRESP'],
    title: 'Исполнитель',
  },
  {
    name: 'Соколова Анна Андреевна',
    username: 'A.Sokolova@rlptest.ru', // TODO: заменить на СНИЛС
    password: TEST_PASSWORD,
    roles: ['RLP_REGMANAGER_POC'],
    title: 'NEW Начальник отдела регулирования цен на лекарства и координации закупок Минздрава России',
  },
  {
    name: 'Морозова Ирина Павловна',
    username: 'I.Morozova@rlptest.ru', // TODO: заменить на СНИЛС
    password: TEST_PASSWORD,
    roles: ['RLP_FASZAMMANAGER'],
    title: 'NEW Заместитель руководителя ФАС России',
  },
  {
    name: 'Волков Вадим Олегович',
    username: 'V.Volkov@rlptest.ru', // TODO: заменить на СНИЛС
    password: TEST_PASSWORD,
    roles: ['RLP_FASREGMANAGER'],
    title: 'NEW Начальник отдела ФАС России',
  },
  {
    name: 'Лебедева Светлана Юрьевна',
    username: 'S.Lebedeva@rlptest.ru', // TODO: заменить на СНИЛС
    password: TEST_PASSWORD,
    roles: ['RLP_FASREGRESP'],
    title: 'NEW Сотрудник ФАС России',
  },
  {
    name: 'Крылов Артем Эдуардович',
    username: 'A.Krylov@rlptest.ru', // TODO: заменить на СНИЛС
    password: TEST_PASSWORD,
    roles: ['RLP_REGRESPFREE_POC;RLP_REGRESP_POC_MZ'],
    title: 'NEW Внештатный исполнитель / Исполнитель со стороны Минздрава России для ПОЦ',
  },
  {
    name: 'Федотов Григорий Степанович',
    username: '222-870-064 46', // СНИЛС
    password: TEST_PASSWORD,
    roles: ['RLP_REGHD'],
    title: 'Подписант МЗ',
  },
];

export type RlpUser = (typeof users)[number];

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================

export function findUser(name: string): RlpUser {
  const user = users.find(u => u.name === name);
  if (!user) throw new Error(`Пользователь "${name}" не найден`);
  return user;
}

export function findUserByRole(role: string): RlpUser {
  const user = users.find(u => u.roles.includes(role));
  if (!user) throw new Error(`Пользователь с ролью "${role}" не найден`);
  return user;
}

export async function loginAs(page: Page, user: RlpUser) {
  console.log(`🔑 Вход под пользователем: ${user.name} (${user.title})`);

  // Нажимаем "Войти" на главной. Сразу после logout→login перехода клик
  // иногда "проходит" без эффекта (JS ещё не навесил обработчик) —
  // проверяем, реально ли появилась форма логина, и при необходимости
  // повторяем клик принудительно.
  //
  // На стендах с Keycloak-редиректом (например, dev01) клик по "Войти"
  // уводит на ВНЕШНИЙ домен keycloak-*, а не открывает форму на этой же
  // странице — там ещё и грузиться дольше (внешний хост, VPN). Раньше
  // повторный force-клик по "Войти" срабатывал уже ПОСЛЕ ухода на чужой
  // домен, где такой кнопки просто нет — Playwright зависал в ожидании
  // несуществующего элемента без таймаута и без .catch(). Теперь: более
  // терпеливое первое ожидание, а retry-клик — с явным таймаутом и
  // catch(), чтобы "кнопки уже нет, потому что мы ушли на другую страницу"
  // не превращалось в зависание.
  const loginButton = page.getByRole('button', { name: 'Войти' });
  const usernameField = page.locator('input[name="username"]');

  const loginButtonVisible = await loginButton.isVisible({ timeout: 10000 }).catch(() => false);
  if (!loginButtonVisible) {
    await page.screenshot({ path: 'debug-login-button-not-found.png', fullPage: true }).catch(() => {});
    console.log(`❌ Кнопка "Войти" не найдена на странице. URL: ${page.url()}`);
  } else {
    await loginButton.click();
    await page.waitForTimeout(2000);

    const formOpened = await usernameField.isVisible({ timeout: 8000 }).catch(() => false);
    if (!formOpened) {
      // Может быть либо гонка гидратации (та же страница, клик не сработал —
      // тогда кнопка "Войти" всё ещё на месте и повторный клик поможет), либо
      // мы уже ушли на Keycloak, где кнопки "Войти" нет вовсе — тогда этот
      // клик должен тихо провалиться по таймауту, а не зависнуть навсегда.
      await loginButton.click({ force: true, timeout: 5000 }).catch(() => {
        console.log('ℹ️ Повторный клик по "Войти" не потребовался (страница уже сменилась)');
      });
      await page.waitForTimeout(2000);
    }
  }

  // Вводим логин
  const usernameFieldAppeared = await usernameField
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);

  if (!usernameFieldAppeared) {
    await page.screenshot({ path: 'debug-login-username-field-not-found.png', fullPage: true }).catch(() => {});
    throw new Error(
      `Поле логина не появилось для ${user.name}. URL: ${page.url()}. ` +
        'Скриншот: debug-login-username-field-not-found.png',
    );
  }
  await usernameField.fill(user.username);
  await page.waitForTimeout(500);

  // Вводим пароль
  const passwordField = page.locator('input[name="password"]');
  await passwordField.waitFor({ state: 'visible', timeout: 5000 });
  await passwordField.fill(user.password);
  await page.waitForTimeout(500);

  // Нажимаем кнопку отправки формы. Селектор по value="Log in" оказался
  // хрупким — при повторном логине в рамках одной сессии текст/локаль
  // кнопки может отличаться, поэтому ищем просто submit-элемент в форме.
  // На проде это <input type="submit">, а на Keycloak-стендах (dev01,
  // PatternFly-тема) — <button type="submit" id="kc-login">"Sign In"</button>,
  // поэтому ловим оба варианта одним локатором.
  const submitButton = page.locator('input[type="submit"], button[type="submit"]');
  const submitVisible = await submitButton
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  if (!submitVisible) {
    // Не нашли — сохраняем скриншот, чтобы понять, что реально на экране
    await page.screenshot({ path: `debug-login-${user.username}.png`, fullPage: true }).catch(() => {});
    throw new Error(
      `Кнопка отправки формы логина не появилась для ${user.name}. ` +
        `Скриншот сохранён в debug-login-${user.username}.png`,
    );
  }

  await submitButton.first().click();
  await page.waitForTimeout(3000);

  // Переход в личный кабинет. Клик по кнопке с именем пользователя — та же
  // гонка гидратации, что и с кнопкой "Войти" выше: страница после логина
  // рендерится не мгновенно, клик может "пройти" без эффекта. Проверяем
  // эффект (появилась ли ссылка "Личный кабинет") и при необходимости
  // повторяем клик принудительно, вместо того чтобы просто спать 1с и
  // надеяться, что успело прогрузиться.
  //
  // Матчим по фамилии (первое слово в name), а не по полному имени: разные
  // стенды показывают имя в шапке по-разному — прод сокращает до инициала
  // ("Ильин В."), dev01 показывает целиком, но в порядке "Фамилия Имя"
  // ("Птицына Алла"). Фамилия — единственное, что совпадает везде.
  const surname = user.name.split(' ')[0];
  const userMenuButton = page.getByRole('button', { name: surname });
  const userMenuVisible = await userMenuButton
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => true)
    .catch(() => false);

  if (!userMenuVisible) {
    await page.screenshot({ path: `debug-login-menu-${user.username}.png`, fullPage: true }).catch(() => {});
    throw new Error(
      `Кнопка пользователя "${user.name}" не появилась после логина. ` +
        `Скриншот: debug-login-menu-${user.username}.png`,
    );
  }

  await userMenuButton.click();
  await page.waitForTimeout(1000);

  const lkLink = page.getByRole('banner').getByRole('link', { name: 'Личный кабинет' });
  let lkOpened = await lkLink.isVisible({ timeout: 3000 }).catch(() => false);
  if (!lkOpened) {
    await userMenuButton.click({ force: true });
    await page.waitForTimeout(1000);
    lkOpened = await lkLink.isVisible({ timeout: 3000 }).catch(() => false);
  }

  if (!lkOpened) {
    await page.screenshot({ path: `debug-login-menu-${user.username}.png`, fullPage: true }).catch(() => {});
    throw new Error(
      `Меню пользователя "${user.name}" не открылось (ссылка "Личный кабинет" не появилась). ` +
        `Скриншот: debug-login-menu-${user.username}.png`,
    );
  }

  await lkLink.click();
  await page.waitForTimeout(2000);

  console.log(`✅ Вход выполнен: ${user.name}`);
}

// Разлогинивает по прямому URL, не завися от того, кто именно залогинен —
// нужно для персистентного профиля Chromium-Gost, который хранит сессию
// между запусками теста. Безопасно вызывать, даже если никто не залогинен.
// baseUrl — необязательный, по умолчанию прод-стенд; для других стендов
// (например, dev01) передаётся явно вызывающим кодом.
export async function forceLogout(page: Page, baseUrl: string = 'https://example-test-stand.example.com') {
  await page.goto(`${baseUrl}/?logout=1`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);
  await page.goto(`${baseUrl}/?logout=1`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);

  // На практике страница иногда зависает пустой (серый экран, ни ошибки,
  // ни контента) — простое ожидание не помогает, сколько ни жди. Похоже на
  // то же, что уже наблюдалось с кнопкой "Назначить исполнителя": страницу
  // нужно перезагрузить, а не просто ждать. Поэтому тот же паттерн —
  // поллинг с reload, а не один waitFor.
  const loginButton = page.locator('button:has-text("Войти")');
  let loginButtonVisible = await loginButton.isVisible().catch(() => false);
  const pollStartedAt = Date.now();
  const maxPollDurationMs = 60 * 1000;

  while (!loginButtonVisible && Date.now() - pollStartedAt < maxPollDurationMs) {
    console.log('⏳ Кнопка "Войти" не появилась — перезагружаю страницу...');
    await page.reload().catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);
    loginButtonVisible = await loginButton.isVisible().catch(() => false);
  }

  if (!loginButtonVisible) {
    await page.screenshot({ path: 'debug-force-logout-timeout.png', fullPage: true }).catch(() => {});
    console.log(`❌ Кнопка "Войти" не появилась после forceLogout. URL: ${page.url()}`);
    throw new Error(
      'Кнопка "Войти" не появилась после forceLogout. Скриншот: debug-force-logout-timeout.png',
    );
  }
}

// user передаём явно — раньше здесь был захардкожен 'Ильин В.',
// из-за чего выход работал только для одного конкретного пользователя
export async function logout(page: Page, user: RlpUser, baseUrl?: string) {
  console.log(`🚪 Выход из пользователя: ${user.name}...`);

  // forceLogout ниже сработает в любом случае, но без клика по "Выйти"
  // сессия остаётся полуоткрытой в UI до момента, пока ?logout=1 её не
  // добьёт — на практике это как раз и выглядело как "не всегда выходит".
  // 2с на появление кнопки было мало (шапка может ещё не успеть
  // перерисоваться после долгого шага вроде подписания) — увеличил до 5с
  // и добавил тот же паттерн "клик → проверка эффекта → force-повтор",
  // что и везде в коде.
  //
  // Кнопка шапки — по стабильному атрибуту, не по тексту: на dev01 текст
  // фамилии может совпасть ещё с чем-то на странице (например, полем
  // "Исполнитель" маршрута ЭДО с тем же именем) — getByText(фамилия) тогда
  // ловит 2+ элемента и падает strict-mode violation'ом. Атрибут
  // data-automationid="user-menu-trigger" подтверждён реальным дампом DOM
  // и однозначно указывает на саму кнопку в шапке.
  const surname = user.name.split(' ')[0];
  let userButton = page.locator('[data-automationid="user-menu-trigger"]');
  let userButtonVisible = await userButton.isVisible({ timeout: 5000 }).catch(() => false);

  if (!userButtonVisible) {
    // Фолбэк на случай, если атрибут почему-то отсутствует
    userButton = page.getByText(surname).first();
    userButtonVisible = await userButton.isVisible({ timeout: 3000 }).catch(() => false);
  }

  if (userButtonVisible) {
    await userButton.click();
    await page.waitForTimeout(1000);

    const logoutItem = page.getByText('Выйти');
    let logoutMenuOpened = await logoutItem.isVisible({ timeout: 3000 }).catch(() => false);
    if (!logoutMenuOpened) {
      await userButton.click({ force: true });
      await page.waitForTimeout(1000);
      logoutMenuOpened = await logoutItem.isVisible({ timeout: 3000 }).catch(() => false);
    }

    if (logoutMenuOpened) {
      await logoutItem.click();
      await page.waitForTimeout(2000);
    } else {
      console.log('⚠️ Пункт "Выйти" не появился — полагаемся на forceLogout ниже');
    }
  } else {
    console.log('⚠️ Кнопка пользователя в шапке не найдена — полагаемся на forceLogout ниже');
  }

  await forceLogout(page, baseUrl);
  console.log('✅ Выход выполнен');
}

export async function switchUser(page: Page, fromUser: RlpUser, toUser: RlpUser, baseUrl?: string) {
  await logout(page, fromUser, baseUrl);
  await loginAs(page, toUser);
}
