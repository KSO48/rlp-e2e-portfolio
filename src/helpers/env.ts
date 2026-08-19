// src/helpers/env.ts
//
// ПОРТФОЛИО-ВЕРСИЯ: без зашитых в код дефолтных логина/пароля — только
// чтение из .env / .env.local (см. .env.example).
import dotenv from 'dotenv';
import path from 'path';

// .env — общие для команды значения (в git).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
// .env.local — машинно-специфичные пути (не в git), перекрывают .env.
// См. .env.local.example.
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), override: true });

export const e2eEnv = {
  baseUrl: process.env.BASE_URL || 'https://example-test-stand.example.com',
  applicantLogin: process.env.APPLICANT_LOGIN || '',
  applicantPassword: process.env.APPLICANT_PASSWORD || '',

  // Chromium-Gost с установленным плагином КриптоПро — путь к бинарю и
  // профилю свои на каждой машине, настраиваются через .env.local.
  chromiumGostExecutablePath: process.env.CHROMIUM_GOST_PATH,
  chromiumGostProfileDir: process.env.CHROMIUM_GOST_PROFILE_DIR,
};
