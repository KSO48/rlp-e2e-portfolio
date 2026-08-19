// ============================================================
// ФАЙЛ: tests/chromiumGost.ts
// ЗАПУСК CHROMIUM-GOST С ПЛАГИНОМ КРИПТОПРО (переиспользуемый шаг)
//
// Обычная playwright-фикстура page не подходит для подписания — нужен
// реальный плагин КриптоПро (CAdES Browser Plug-in) + сертификат/контейнер
// вне браузера. Полагаться на то, что плагин уже стоит в чьём-то личном
// профиле — хрупко (у каждого разработчика свой профиль, свой набор
// расширений). Вместо этого грузим распакованные копии плагина из
// e2e-tests/extensions/ явно через --load-extension — так плагин
// гарантированно есть в любом профиле на любой машине, где склонирован
// репозиторий.
// ============================================================

import fs from 'fs';
import path from 'path';

import { chromium, type BrowserContext, type Page } from '@playwright/test';

import { e2eEnv } from '../src/helpers/env';

const extensionsRoot = path.resolve(__dirname, '../extensions');

// Версия зашита в имени соседней с chrome.exe папки (например "98.0.4758.80") —
// надёжнее, чем звать `chrome.exe --version`: при уже запущенном инстансе
// (single-instance) команда просто форвардится в него и версию не печатает.
function detectChromiumMajorVersion(executablePath: string): number | null {
  const appDir = path.dirname(executablePath);
  const versionDir = fs
    .readdirSync(appDir, { withFileTypes: true })
    .find(entry => entry.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(entry.name));

  return versionDir ? Number(versionDir.name.split('.')[0]) : null;
}

// Ищет во всех подпапках extensions/<id>/<version>/manifest.json — не
// хардкодим номер версии, чтобы апдейт плагина не ломал путь. Расширения,
// требующие более новый Chromium, чем реально установлен (manifest.json →
// minimum_chrome_version), пропускает — иначе Chromium встречает загрузку
// модальным диалогом "Ошибка при загрузке расширения" и виснет.
function resolveBundledExtensionPaths(chromiumMajorVersion: number | null): string[] {
  if (!fs.existsSync(extensionsRoot)) {
    return [];
  }

  return fs
    .readdirSync(extensionsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(idDir => {
      const idPath = path.join(extensionsRoot, idDir.name);
      const versionDir = fs
        .readdirSync(idPath, { withFileTypes: true })
        .find(entry => entry.isDirectory() && fs.existsSync(path.join(idPath, entry.name, 'manifest.json')));

      if (!versionDir) {
        return [];
      }

      const extensionPath = path.join(idPath, versionDir.name);
      const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'));
      const minChromeVersion = manifest.minimum_chrome_version ? Number(manifest.minimum_chrome_version) : null;

      if (minChromeVersion !== null && chromiumMajorVersion !== null && chromiumMajorVersion < minChromeVersion) {
        console.log(
          `⚠️ Пропускаю расширение ${idDir.name} — требует Chromium ${minChromeVersion}+, установлен ${chromiumMajorVersion}`,
        );

        return [];
      }

      return [extensionPath];
    });
}

// Плавающий таймер в углу страницы — просто ориентир "сколько уже идёт
// прогон", не влияет на сам тест. addInitScript выполняется на КАЖДОЙ новой
// загрузке документа в контексте (логины, переключения пользователей,
// page.goto) — значит, оверлей появляется заново сам, без ручной инжекции
// после каждой навигации. startedAt передаём снаружи, чтобы отсчёт не
// сбрасывался на очередной перезагрузке страницы.
async function installElapsedTimeOverlay(context: BrowserContext, startedAt: number): Promise<void> {
  await context.addInitScript((startedAtArg: number) => {
    // addInitScript выполняется в каждом документе контекста, включая
    // iframe'ы (модалки подписания/предпросмотра PDF могут рендериться
    // через iframe) — рисуем оверлей только в главном фрейме страницы,
    // чтобы не плодить лишние копии поверх контента внутри iframe.
    if (window.top !== window.self) {
      return;
    }

    const render = () => {
      let el = document.getElementById('__e2e_timer__');
      if (!el) {
        el = document.createElement('div');
        el.id = '__e2e_timer__';
        Object.assign(el.style, {
          position: 'fixed',
          top: '8px',
          right: '8px',
          zIndex: '2147483647',
          background: 'rgba(0,0,0,0.75)',
          color: '#0f0',
          font: '13px monospace',
          padding: '4px 8px',
          borderRadius: '4px',
          pointerEvents: 'none',
        } as CSSStyleDeclaration);
        (document.documentElement || document).appendChild(el);
      }

      const elapsedSec = Math.floor((Date.now() - startedAtArg) / 1000);
      const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
      const ss = String(elapsedSec % 60).padStart(2, '0');
      el.textContent = `⏱ ${mm}:${ss}`;
    };

    render();
    setInterval(render, 1000);
  }, startedAt);
}

// ============================================================
// ПЕРЕХВАТ ОШИБОК КОНСОЛИ/СЕТИ ("всё кроме успешных кодов")
//
// Вешаем один раз на страницу — дальше при ЛЮБОЙ навигации/переключении
// пользователя (page.goto, логин, свитч) события продолжают приходить,
// специально ничего переустанавливать не нужно. Печатаем сразу в
// консоль теста (с явным префиксом 🔴), чтобы в обычном stdout прогона
// (который и так копируется в чат для разбора) сразу было видно, что на
// странице реально что-то упало — без ручного похода в DevTools.
// ------------------------------------------------------------
// Что ловим:
//  - console.error() из кода страницы;
//  - необработанные JS-исключения (pageerror) — то, что в DevTools
//    подсвечено красным отдельной строкой, не через console.error;
//  - HTTP-ответы с кодом 4xx/5xx ("всё кроме успешных");
//  - запросы, упавшие на сетевом уровне (обрыв/таймаут/CORS) — у них
//    вообще нет HTTP-статуса, поэтому 'response' их не поймает.
// ------------------------------------------------------------
function installPageErrorCapture(page: Page): { getErrors: () => string[] } {
  const errors: string[] = [];

  const record = (line: string) => {
    errors.push(line);
    console.log(`🔴 ${line}`);
  };

  page.on('console', msg => {
    if (msg.type() === 'error') {
      record(`[console.error] ${msg.text()}`);
    }
  });

  page.on('pageerror', err => {
    record(`[pageerror] ${err.message}`);
  });

  page.on('response', res => {
    if (res.status() >= 400) {
      record(`[http ${res.status()}] ${res.request().method()} ${res.url()}`);
    }
  });

  page.on('requestfailed', req => {
    // Отменённые сами Playwright/браузером запросы (например, при
    // переходе на новую страницу) — не реальная ошибка, шумят зря.
    if (req.failure()?.errorText === 'net::ERR_ABORTED') return;
    record(`[requestfailed] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });

  return { getErrors: () => errors };
}

export async function launchChromiumGost(): Promise<{
  context: BrowserContext;
  page: Page;
  testStartedAt: number;
  getPageErrors: () => string[];
}> {
  const testStartedAt = Date.now();

  if (!e2eEnv.chromiumGostExecutablePath || !e2eEnv.chromiumGostProfileDir) {
    throw new Error(
      'Не заданы CHROMIUM_GOST_PATH / CHROMIUM_GOST_PROFILE_DIR. ' +
        'Скопируй .env.local.example в .env.local и подставь свои пути.',
    );
  }

  const bundledExtensionPaths = resolveBundledExtensionPaths(
    detectChromiumMajorVersion(e2eEnv.chromiumGostExecutablePath),
  );

  if (bundledExtensionPaths.length === 0) {
    console.log('⚠️ Не найдено ни одного расширения в e2e-tests/extensions — плагин КриптоПро не будет загружен');
  }

  const context = await chromium.launchPersistentContext(e2eEnv.chromiumGostProfileDir, {
    executablePath: e2eEnv.chromiumGostExecutablePath,
    headless: false,
    args: [
      '--enable-extensions',
      ...(bundledExtensionPaths.length > 0
        ? [
            `--load-extension=${bundledExtensionPaths.join(',')}`,
            `--disable-extensions-except=${bundledExtensionPaths.join(',')}`,
          ]
        : []),
      '--disable-extensions-http-throttling',
      '--disable-features=ExtensionsToolbarMenu',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
    ],
  });

  // Персистентный контекст обычно открывается сразу с одной пустой вкладкой —
  // переиспользуем её вместо создания второй.
  const page = context.pages()[0] ?? (await context.newPage());

  const { getErrors } = installPageErrorCapture(page);

  // ВРЕМЕННО ОТКЛЮЧЕНО: подозрение, что addInitScript-оверлей как-то связан
  // с зависанием страницы на "сером экране" (?logout=1 не дорендеривается).
  // Проверяем на чистом прогоне без него — если проблема останется, вернуть.
  // await installElapsedTimeOverlay(context, testStartedAt);

  return { context, page, testStartedAt, getPageErrors: getErrors };
}
