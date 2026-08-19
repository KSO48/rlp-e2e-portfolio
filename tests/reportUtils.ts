// ============================================================
// ФАЙЛ: tests/reportUtils.ts
// СОХРАНЕНИЕ ОТЧЁТА О СОЗДАННЫХ ЗАЯВЛЕНИЯХ
// ============================================================

import * as fs from 'fs';

export type StatementResult = {
  number: number;
  barcode: string;
  price: string;
  url: string;
};

export function saveReport(results: StatementResult[], filePath: string) {
  let fileContent = '========================================\n';
  fileContent += `ОТЧЕТ О СОЗДАНИИ ЗАЯВЛЕНИЙ\n`;
  fileContent += `Дата: ${new Date().toLocaleString()}\n`;
  fileContent += `Всего создано: ${results.length}\n`;
  fileContent += '========================================\n\n';

  for (const item of results) {
    fileContent += `Заявление №${item.number}\n`;
    fileContent += `  Штрих-код: ${item.barcode}\n`;
    fileContent += `  Цена: ${item.price}\n`;
    fileContent += `  Ссылка: ${item.url}\n`;
    fileContent += `\n`;
  }

  fileContent += '========================================\n';
  fileContent += `Конец отчета\n`;

  fs.writeFileSync(filePath, fileContent, 'utf8');
  console.log(`✅ Отчет сохранен в файл: ${filePath}`);
}
