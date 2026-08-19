// ============================================================
// ФАЙЛ: tests/dev01Users.ts
// ПОЛЬЗОВАТЕЛИ И БАЗОВЫЙ URL СТЕНДА DEV01
//
// ПОРТФОЛИО-ВЕРСИЯ: значения password ниже — плейсхолдер, реальные
// пароли не публикуются.
//
// approvalChain.ts НЕ переиспользуется для dev-сценариев — там
// захардкожены прод-имена (с отчествами в другом порядке/составе полей).
// ============================================================

import type { RlpUser } from './users';

const TEST_PASSWORD = process.env.TEST_PASSWORD || 'CHANGE_ME';

export const DEV01_BASE_URL = 'https://rlp-dev.example.internal';

export const dev01Applicant: RlpUser = {
  // На dev01 в шапке отображается "Фамилия Имя" полностью (без сокращения
  // до инициала, как на проде) — подтверждено скриншотом кнопки после логина.
  name: 'Птицына Алла',
  username: '933-258-656-27',
  password: TEST_PASSWORD,
  roles: ['RLP_APPLICANT_POC'],
  title: 'Заявитель ПОЦ',
};

export const dev01ResponsibleMz: RlpUser = {
  name: 'Михайлов Дмитрий',
  username: '772-309-396-18',
  password: TEST_PASSWORD,
  roles: ['RLP_REGRESP_POC'],
  title: 'Исполнитель со стороны МЗ ПОЦ',
};

export const dev01HeadOfDepartment: RlpUser = {
  name: 'Соколова Анна',
  username: '718-567-212-23',
  password: TEST_PASSWORD,
  roles: ['RLP_REGMANAGER_POC'],
  title: 'начальник отдела ПОЦ МЗ',
};

export const dev01Signer: RlpUser = {
  name: 'Федотов Григорий',
  username: 'g.fedotov@rlptest.ru',
  password: TEST_PASSWORD,
  roles: ['RLP_REGHD'],
  title: 'Руководитель департамента МЗ',
};

export const dev01FasExecutor: RlpUser = {
  name: 'Щербакова Мария',
  username: '967-890-123-45',
  password: TEST_PASSWORD,
  roles: ['RLP_REGRESP_POC_FAS'],
  title: 'Исполнитель со стороны ФАС России',
};

// ------------------------------------------------------------
// Текст для клика по строке результата в модалке "Назначение исполнителя".
// ВАЖНО: эта модалка показывает "Имя Фамилия" БЕЗ отчества — подтверждено
// скриншотом ("Дмитрий Михайлов"), в отличие от блока "Согласование"
// (Исполнитель/Согласующий/Подписант), где то же имя показывается как
// "Фамилия Имя Отчество" ("Михайлов Дмитрий Петрович"). Это два разных
// компонента с разным форматированием — не путать.
// ------------------------------------------------------------
export const DEV01_RESPONSIBLE_MZ_ASSIGN_NAME = 'Дмитрий Михайлов';
export const DEV01_FAS_EXECUTOR_ASSIGN_NAME = 'Мария Щербакова';

// ------------------------------------------------------------
// Полные ФИО (с отчеством) — формат блока "Согласование" (Исполнитель/
// Согласующий/Подписант), подтверждено реальным дампом DOM.
// ------------------------------------------------------------
export const DEV01_RESPONSIBLE_MZ_FULL_NAME = 'Михайлов Дмитрий Петрович';
export const DEV01_FAS_EXECUTOR_FULL_NAME = 'Щербакова Мария Ильинична';
