import { test } from '@playwright/test';
import * as path from 'path';

import { launchChromiumGost } from './chromiumGost';
import { signStatement } from './statementSigning';
import { loginAs, forceLogout } from './users';
import { runFullApprovalChain } from './approvalChain';
import {
  selectMedicine,
  fillContactInfo,
  skipIntermediateSteps,
  selectReleaseForm,
  generateStatementData,
  fillMedicineInfo,
  regenerateBarcode,
  generatePriceInRange,
  editBarcodeAndPrice,
  selectProductionStages,
  uploadDocuments,
  createStatement,
  type DocumentToUpload,
} from './statementCreation';
import { saveReport, type StatementResult } from './reportUtils';
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
// ПОЛНАЯ РЕГИСТРАЦИЯ ДЛЯ СТЕНДА DEV01 (<dev-stand-url>)
// Аналог test_regress1_registration.spec.ts, но переиспользует обобщённый
// runFullApprovalChain (approvalChain.ts) с пользователями/baseUrl/
// проверкой маршрута ЭДО dev01 — вместо дублирования всей цепочки.
//
// НЕ прогонялся целиком на dev01 — построен по образцу подтверждённого
// dev_smoke1_registration.spec.ts. Возможны несостыковки на первом прогоне
// (тексты писем ФАС/Минздрава, файлы вложений и т.п. не переподтверждены
// именно для dev01, только для прод-стенда).
// ============================================================

const releaseFormOptions = {
  releaseForm: 'капсулы с порошком для ингаляций 50 мкг+150 мкг+160 мкг (блистеры) 10 x 1/3',
  dosageForm: 'Капсулы с порошком для ингаляций',
  dosage: '50 мкг+150 мкг+160 мкг',
  secondaryPackage: 'Пачка картонная \\(3 шт\\)',
  primaryPackage: 'Упаковка контурная ячейковая',
};

const productionStageOptions = {
  primaryPacker: 'Зигфрид Барбера С.Л',
  primarySite: 'Ronda Santa Maria, 158, 08210 Barbera Del Valles, Barcelona, Spain (Испания)',
  secondaryPacker: 'Зигфрид Барбера С.Л',
  secondarySite: 'Ronda Santa Maria, 158, 08210',
  manufacturer: 'Зигфрид Барбера С.Л',
  manufacturerSite: 'Ronda Santa Maria, 158, 08210',
  qc: 'Новартис Фармасьютика С.А',
  qcSite: 'Aina Ávalos Tercero',
};

const documents: DocumentToUpload[] = [
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

test('test', async () => {
  const { context, page } = await launchChromiumGost();

  try {
    // ============================================================
    // ШАГ 1: ЛОГИН
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
    // СОЗДАНИЕ ЗАЯВЛЕНИЯ
    // ============================================================
    await selectMedicine(page, 'Регистрация предельной отпускной цены', 'ЛП-007476', 'ЛП-007476');
    await fillContactInfo(page, 'rlp@mdevteam.com', '10150012862');
    await skipIntermediateSteps(page, 2);
    await selectReleaseForm(page, releaseFormOptions);

    const { barcode, priceStr } = generateStatementData(1);
    console.log(`📌 Штрих-код: ${barcode}, цена: ${priceStr}`);
    await fillMedicineInfo(page, barcode, '3004900003', priceStr);

    await selectProductionStages(page, productionStageOptions);
    await uploadDocuments(page, documents);

    const statementUrl = await createStatement(page);
    console.log(`🔗 Ссылка на заявление: ${statementUrl}`);
    console.log('✅ Заявление создано');

    // ============================================================
    // ПОДПИСАНИЕ ЗАЯВЛЕНИЯ
    // ============================================================
    await signStatement(page);
    console.log('✅ Заявление подписано');

    const statement: StatementResult = { number: 1, barcode, price: priceStr, url: statementUrl };

    // ============================================================
    // ПОЛНАЯ ЦЕПОЧКА СОГЛАСОВАНИЯ (МЗ → ФАС → решения → "Услуга оказана")
    // ============================================================
    await runFullApprovalChain(page, {
      applicant,
      statement,

      fillMzResponseFields: async p => {
        const newBarcode = regenerateBarcode();
        const newPriceStr = generatePriceInRange(3399.99, 3599.99);
        console.log(`📌 Новый штрих-код: ${newBarcode}, новая цена: ${newPriceStr}`);
        await editBarcodeAndPrice(p, newBarcode, newPriceStr);
      },

      fillFasResponseFields: async p => {
        const fasClarifiedPriceStr = '3499.99';
        console.log(`📌 Штрих-код остаётся прежним: ${statement.barcode}, новая цена: ${fasClarifiedPriceStr}`);
        await editBarcodeAndPrice(p, statement.barcode, fasClarifiedPriceStr);
      },

      document: { filePath: 'docs/ФГБУ НЦЭСМП.pdf' },
      finalDecisionText: 'Решение о государственной регистрации предельной отпускной цены',

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
    // СОХРАНЕНИЕ ОТЧЁТА
    // ============================================================
    saveReport([statement], path.join(__dirname, 'statements_report.txt'));
    console.log('\n✅ Регресс-тест регистрации на dev01 пройден!');
  } finally {
    await context.close();
  }
});
