/**
 * Финансовый учёт магазинов WB в Google Таблицах.
 *
 * Установка:
 * 1. Создайте пустую Google-таблицу.
 * 2. Откройте Расширения -> Apps Script.
 * 3. Замените содержимое Code.gs этим файлом.
 * 4. Запустите setupFinanceWorkbook и выдайте разрешения.
 *
 * Повторный запуск не удаляет операции. Скрипт обновляет структуру,
 * формулы, оформление и правила проверки данных.
 */

var FINANCE_CONFIG = {
  sheets: {
    dashboard: 'Дашборд',
    income: 'Поступления',
    expenses: 'Расходы',
    partners: 'Справочник'
  },
  rows: 2000,
  dashboardRows: 250,
  partnerSummaryRows: 300,
  currencyFormat: '#,##0.00 "сом"',
  dateFormat: 'd mmmm yyyy',
  ready: 'Готово',
  statuses: {
    business: 'Оплачено деньгами бизнеса',
    personalDebt: 'Из своих — вернуть',
    personalIgnore: 'Личная трата — не учитывать',
    offset: 'Взаимозачёт — без движения денег'
  },
  incomeTypes: {
    wbRevenue: 'Выручка WB',
    otherRevenue: 'Прочий операционный доход',
    refund: 'Возврат расхода',
    partnerLoanLegacy: 'Взнос/заём партнёра',
    partnerContribution: 'Взнос партнёра — капитал',
    partnerLoan: 'Заём партнёра — долг',
    openingBalance: 'Начальный остаток',
    offset: 'Взаимозачёт — без движения денег'
  },
  expenseGroups: {
    operating: 'Операционные',
    taxes: 'Налоги',
    dividends: 'Дивиденды',
    debtRepayment: 'Возврат долга партнёру',
    personalWithdrawal: 'Личное изъятие',
    offset: 'Взаимозачёт'
  },
  accountingRules: {
    operating: 'Операционный расход',
    taxes: 'Налог',
    dividends: 'Дивиденды',
    debtRepayment: 'Возврат долга партнёру',
    personalWithdrawal: 'Личное изъятие',
    offset: 'Взаимозачёт'
  },
  colors: {
    dark: '#172033',
    violet: '#6D28D9',
    violetLight: '#F3E8FF',
    blueLight: '#EFF6FF',
    green: '#047857',
    greenLight: '#ECFDF5',
    amber: '#B45309',
    amberLight: '#FFFBEB',
    red: '#B91C1C',
    redLight: '#FEF2F2',
    gray: '#64748B',
    grayLight: '#F8FAFC',
    formula: '#E8EEF9',
    incomeRequired: '#D1FAE5',
    incomeRequiredFilled: '#6EE7B7',
    incomeOptional: '#F3FBF7',
    expenseRequired: '#FEE2E2',
    expenseRequiredFilled: '#FCA5A5',
    expenseOptional: '#FFF7F7',
    missing: '#DC2626',
    border: '#E2E8F0',
    sectionBorder: '#475569',
    white: '#FFFFFF'
  }
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Финансовый учёт')
    .addItem('Создать / обновить структуру', 'setupFinanceWorkbook')
    .addItem('Обновить списки и формулы', 'refreshFinanceWorkbook')
    .addSeparator()
    .addItem('Проверить данные', 'validateFinanceWorkbook')
    .addToUi();
}

function setupFinanceWorkbook() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert(
    'Финансовый учёт',
    'Создать или обновить четыре листа финансового учёта? Уже внесённые операции не будут удалены.',
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return;

  buildFinanceWorkbook_();
  ui.alert(
    'Готово',
    'Структура создана. Сначала заполните магазины, партнёров, кредиторов и счета на листе «Справочник», затем вносите операции.',
    ui.ButtonSet.OK
  );
}

function refreshFinanceWorkbook() {
  buildFinanceWorkbook_();
  SpreadsheetApp.getActive().toast(
    'Списки, формулы и проверки обновлены. Операции сохранены.',
    'Финансовый учёт',
    5
  );
}

function buildFinanceWorkbook_() {
  var spreadsheet = SpreadsheetApp.getActive();
  spreadsheet.setSpreadsheetLocale('ru_RU');
  spreadsheet.setSpreadsheetTimeZone('Asia/Bishkek');

  var sheets = getOrCreateFinanceSheets_(spreadsheet);
  clearManagedProtections_(sheets);
  migrateTransactionLayouts_(spreadsheet, sheets);
  setupPartnersSheet_(sheets.partners);
  setupIncomeSheet_(sheets.income, sheets.partners);
  setupExpensesSheet_(sheets.expenses, sheets.partners);
  setupDashboardSheet_(sheets.dashboard);
  protectFormulaRanges_(sheets);
  ensureFinanceEditTrigger_();
  orderFinanceSheets_(spreadsheet, sheets);

  SpreadsheetApp.flush();
  spreadsheet.setActiveSheet(sheets.dashboard);
}

function getOrCreateFinanceSheets_(spreadsheet) {
  var names = FINANCE_CONFIG.sheets;
  var dashboard = spreadsheet.getSheetByName(names.dashboard);
  var partners = spreadsheet.getSheetByName(names.partners);

  // Безопасно переименовываем прежний лист: данные остаются на том же листе.
  if (!partners) {
    var legacyPartners = spreadsheet.getSheetByName('Партнёры');
    if (legacyPartners) {
      legacyPartners.setName(names.partners);
      partners = legacyPartners;
    }
  }

  if (!dashboard) {
    var existingSheets = spreadsheet.getSheets();
    if (existingSheets.length === 1 && existingSheets[0].getDataRange().isBlank()) {
      dashboard = existingSheets[0];
      dashboard.setName(names.dashboard);
    } else {
      dashboard = spreadsheet.insertSheet(names.dashboard);
    }
  }

  return {
    dashboard: dashboard,
    income: spreadsheet.getSheetByName(names.income) || spreadsheet.insertSheet(names.income),
    expenses: spreadsheet.getSheetByName(names.expenses) || spreadsheet.insertSheet(names.expenses),
    partners: partners || spreadsheet.insertSheet(names.partners)
  };
}

function orderFinanceSheets_(spreadsheet, sheets) {
  [sheets.dashboard, sheets.income, sheets.expenses, sheets.partners].forEach(function (sheet, index) {
    spreadsheet.setActiveSheet(sheet);
    spreadsheet.moveActiveSheet(index + 1);
  });
}

function clearManagedProtections_(sheets) {
  var prefix = 'FINANCE_AUTO:';
  Object.keys(sheets).forEach(function (key) {
    var sheet = sheets[key];
    [SpreadsheetApp.ProtectionType.RANGE, SpreadsheetApp.ProtectionType.SHEET].forEach(function (type) {
      sheet.getProtections(type).forEach(function (protection) {
        if ((protection.getDescription() || '').indexOf(prefix) === 0 && protection.canEdit()) {
          protection.remove();
        }
      });
    });
  });
}

function protectFormulaRanges_(sheets) {
  protectManaged_(sheets.dashboard.protect(), 'Дашборд — автоматические расчёты');
  protectManaged_(sheets.partners.getRange(2, 3, sheets.partners.getMaxRows() - 1, 4).protect(), 'Справочник C:F — автоматические расчёты');
  protectManaged_(sheets.income.getRange(2, 1, sheets.income.getMaxRows() - 1, 1).protect(), 'Поступления A — автоматические ID');
  protectManaged_(sheets.income.getRange(2, 11, sheets.income.getMaxRows() - 1, 1).protect(), 'Поступления K — автоматическая проверка');
  protectManaged_(sheets.expenses.getRange(2, 1, sheets.expenses.getMaxRows() - 1, 1).protect(), 'Расходы A — автоматические ID');
  protectManaged_(sheets.expenses.getRange(2, 14, sheets.expenses.getMaxRows() - 1, 1).protect(), 'Расходы N — автоматическая проверка');
  protectManaged_(sheets.expenses.getRange(2, 15, sheets.expenses.getMaxRows() - 1, 1).protect(), 'Расходы O — автоматическое правило учёта');
}

function protectManaged_(protection, description) {
  protection.setDescription('FINANCE_AUTO: ' + description);
  protection.setWarningOnly(false);

  var currentEmail = Session.getEffectiveUser().getEmail();
  var removableEditors = protection.getEditors().filter(function (user) {
    return currentEmail === '' || user.getEmail() !== currentEmail;
  });
  if (removableEditors.length > 0) protection.removeEditors(removableEditors);
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
}

function ensureFinanceEditTrigger_() {
  var handlerName = 'handleFinanceEdit';
  var matchingTriggers = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === handlerName &&
      trigger.getEventType() === ScriptApp.EventType.ON_EDIT;
  });

  if (matchingTriggers.length === 0) {
    ScriptApp.newTrigger(handlerName)
      .forSpreadsheet(SpreadsheetApp.getActive())
      .onEdit()
      .create();
    return;
  }

  matchingTriggers.slice(1).forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });
}

function ensureSheetSize_(sheet, minRows, minColumns) {
  if (sheet.getMaxRows() < minRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), minRows - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < minColumns) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), minColumns - sheet.getMaxColumns());
  }
}

function incomeHeaders_() {
  return [
    'ID операции\n(авто)',
    'Дата *',
    'Магазин *',
    'Сумма, сом *',
    'Вид поступления *',
    'Счёт получения *',
    'Источник / кто дал',
    'Назначение',
    'Кто внёс запись',
    'Ссылка на документ',
    'Проверка\n(авто)'
  ];
}

function expenseHeaders_() {
  return [
    'ID операции\n(авто)',
    'Дата *',
    'Магазин *',
    'Сумма, сом *',
    'Группа расхода *',
    'Статус оплаты *',
    'Счёт списания *',
    'Связанный партнёр / кредитор *',
    'Категория',
    'Контрагент / кому',
    'Назначение',
    'Кто оплатил',
    'Ссылка на документ',
    'Проверка\n(авто)'
  ];
}

/**
 * Один раз переставляет уже существующие колонки по их заголовкам.
 * Перед изменением каждого заполненного листа создаётся скрытая полная копия.
 * Повторные обновления ничего не копируют и не переставляют.
 */
function migrateTransactionLayouts_(spreadsheet, sheets) {
  reorderTransactionSheet_(spreadsheet, sheets.income, incomeHeaders_());
  reorderTransactionSheet_(spreadsheet, sheets.expenses, expenseHeaders_());
}

function reorderTransactionSheet_(spreadsheet, sheet, desiredHeaders) {
  ensureSheetSize_(sheet, FINANCE_CONFIG.rows, desiredHeaders.length);

  var columnCount = desiredHeaders.length;
  var currentHeaders = sheet.getRange(1, 1, 1, columnCount).getDisplayValues()[0];
  var hasHeaders = currentHeaders.some(function (header) {
    return normalizeTransactionHeader_(header) !== '';
  });
  if (!hasHeaders) return;

  var currentKeys = currentHeaders.map(normalizeTransactionHeader_);
  var desiredKeys = desiredHeaders.map(normalizeTransactionHeader_);
  var alreadyOrdered = desiredKeys.every(function (key, index) {
    return currentKeys[index] === key;
  });
  if (alreadyOrdered) return;

  var sourceByKey = {};
  currentKeys.forEach(function (key, index) {
    if (key !== '' && sourceByKey[key] === undefined) sourceByKey[key] = index;
  });

  var missingHeaders = desiredKeys.filter(function (key) {
    return sourceByKey[key] === undefined;
  });
  if (missingHeaders.length > 0) {
    throw new Error(
      'Лист «' + sheet.getName() + '» не изменён: не найдены колонки «' +
      missingHeaders.join('», «') + '». Верните исходные названия заголовков и повторите обновление.'
    );
  }

  createMigrationBackup_(spreadsheet, sheet);

  var rowCount = sheet.getMaxRows();
  var sourceRange = sheet.getRange(1, 1, rowCount, columnCount);
  var sourceValues = sourceRange.getValues();
  var sourceFormulas = sourceRange.getFormulas();
  var originalValues = [];
  var reorderedValues = [];

  for (var rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    var originalRow = [];
    var reorderedRow = [];
    for (var originalColumn = 0; originalColumn < columnCount; originalColumn += 1) {
      originalRow.push(sourceFormulas[rowIndex][originalColumn] || sourceValues[rowIndex][originalColumn]);
    }
    for (var columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      var sourceIndex = sourceByKey[desiredKeys[columnIndex]];
      reorderedRow.push(sourceFormulas[rowIndex][sourceIndex] || sourceValues[rowIndex][sourceIndex]);
    }
    originalValues.push(originalRow);
    reorderedValues.push(reorderedRow);
  }

  try {
    sourceRange.clearDataValidations();
    sourceRange.clearContent();
    sourceRange.setValues(reorderedValues);
  } catch (error) {
    sourceRange.clearContent();
    sourceRange.setValues(originalValues);
    throw new Error(
      'Не удалось переставить колонки листа «' + sheet.getName() + '». ' +
      'Исходный порядок восстановлен, резервная копия сохранена. Причина: ' + error.message
    );
  }
}

function normalizeTransactionHeader_(header) {
  var normalized = String(header || '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized === 'Связанный партнёр') return 'Связанный партнёр / кредитор';
  if (normalized === 'Источник') return 'Источник / кто дал';
  return normalized;
}

function createMigrationBackup_(spreadsheet, sheet) {
  var timestamp = Utilities.formatDate(
    new Date(),
    spreadsheet.getSpreadsheetTimeZone(),
    'yyyyMMdd-HHmmss'
  );
  var baseName = 'Резерв ' + sheet.getName() + ' ' + timestamp;
  var backupName = baseName;
  var suffix = 2;
  while (spreadsheet.getSheetByName(backupName)) {
    backupName = baseName + ' (' + suffix + ')';
    suffix += 1;
  }

  var backup = sheet.copyTo(spreadsheet).setName(backupName);
  backup.setTabColor('#94A3B8');
  backup.hideSheet();
  spreadsheet.toast(
    'Создана скрытая резервная копия «' + backupName + '».',
    'Безопасная перестановка колонок',
    6
  );
}

function ensurePartnerAccountingRuleColumn_(sheet) {
  var groupHeader = normalizeTransactionHeader_(sheet.getRange(1, 12).getDisplayValue());
  var nextHeader = normalizeTransactionHeader_(sheet.getRange(1, 13).getDisplayValue());
  var ruleHeader = normalizeTransactionHeader_('Правило учёта группы');

  if (nextHeader === ruleHeader || (groupHeader === '' && nextHeader === '')) return;
  if (groupHeader === 'Группы расходов' && nextHeader === 'Категории расходов') {
    sheet.insertColumnAfter(12);
    return;
  }

  throw new Error(
    'Лист «Справочник» не изменён: рядом с «Группы расходов» ожидалась колонка «Категории расходов». ' +
    'Верните исходные названия заголовков и повторите обновление.'
  );
}

function setupPartnersSheet_(sheet) {
  var cfg = FINANCE_CONFIG;
  ensurePartnerAccountingRuleColumn_(sheet);
  ensureSheetSize_(sheet, cfg.rows, 15);
  sheet.setTabColor(cfg.colors.violet);
  sheet.setFrozenRows(1);

  var headers = [[
    'Партнёр / кредитор',
    'Контакт',
    'Текущий долг\n(+ мы должны / − переплата)',
    'Всего оплачено\nиз своих',
    'Всего возвращено',
    'Выплачено дивидендов',
    'Комментарий',
    '',
    'Магазины',
    'Счета бизнеса',
    'Виды поступлений',
    'Группы расходов',
    'Правило учёта группы',
    'Категории расходов',
    'Статусы оплаты'
  ]];
  sheet.getRange(1, 1, 1, 15).setValues(headers);
  styleHeader_(sheet.getRange(1, 1, 1, 7), cfg.colors.dark);
  styleHeader_(sheet.getRange(1, 9, 1, 7), cfg.colors.violet);
  sheet.getRange('H:H').setBackground(cfg.colors.grayLight);

  seedColumnIfEmpty_(sheet, 9, ['Общее']);
  seedColumnIfEmpty_(sheet, 10, ['Расчётный счёт', 'Наличные', 'Другое']);
  seedColumnIfEmpty_(sheet, 11, [
    cfg.incomeTypes.wbRevenue,
    cfg.incomeTypes.otherRevenue,
    cfg.incomeTypes.refund,
    cfg.incomeTypes.partnerContribution,
    cfg.incomeTypes.partnerLoan,
    cfg.incomeTypes.openingBalance
  ]);
  appendValuesIfMissing_(sheet, 11, [
    cfg.incomeTypes.partnerContribution,
    cfg.incomeTypes.partnerLoan,
    cfg.incomeTypes.offset
  ]);
  seedColumnIfEmpty_(sheet, 12, [
    cfg.expenseGroups.operating,
    cfg.expenseGroups.taxes,
    cfg.expenseGroups.dividends,
    cfg.expenseGroups.debtRepayment,
    cfg.expenseGroups.personalWithdrawal
  ]);
  appendValuesIfMissing_(sheet, 12, [cfg.expenseGroups.offset]);
  seedColumnIfEmpty_(sheet, 14, [
    'Закупка товара',
    'Упаковка',
    'Маркировка',
    'Логистика',
    'Комиссии WB',
    'Хранение WB',
    'Реклама',
    'Зарплата',
    'Аренда',
    'Сервисы и подписки',
    'Налог',
    'Дивиденды',
    'Возврат партнёру',
    'Личная трата',
    'Прочее'
  ]);
  seedColumnIfEmpty_(sheet, 15, [
    cfg.statuses.business,
    cfg.statuses.personalDebt,
    cfg.statuses.personalIgnore
  ]);
  appendValuesIfMissing_(sheet, 15, [cfg.statuses.offset]);
  fillKnownAccountingRules_(sheet);
  applyValueListValidation_(
    sheet.getRange(2, 13, sheet.getMaxRows() - 1, 1),
    accountingRuleValues_(),
    'Выберите, как эта группа влияет на прибыль и долги.'
  );

  var formulaRows = Math.min(cfg.partnerSummaryRows, sheet.getMaxRows() - 1);
  var debtFormulas = [];
  var paidOwnFormulas = [];
  var repaidFormulas = [];
  var dividendFormulas = [];
  for (var row = 2; row <= formulaRows + 1; row += 1) {
    debtFormulas.push([partnerDebtFormula_(row)]);
    paidOwnFormulas.push([partnerPaidOwnFormula_(row)]);
    repaidFormulas.push([partnerRepaidFormula_(row)]);
    dividendFormulas.push([partnerDividendsFormula_(row)]);
  }
  setLocalizedFormulas_(sheet.getRange(2, 3, formulaRows, 1), debtFormulas);
  setLocalizedFormulas_(sheet.getRange(2, 4, formulaRows, 1), paidOwnFormulas);
  setLocalizedFormulas_(sheet.getRange(2, 5, formulaRows, 1), repaidFormulas);
  setLocalizedFormulas_(sheet.getRange(2, 6, formulaRows, 1), dividendFormulas);

  sheet.getRange(2, 3, formulaRows, 4).setNumberFormat(cfg.currencyFormat).setBackground(cfg.colors.formula);
  sheet.getRange(2, 1, sheet.getMaxRows() - 1, 2).setBackground(cfg.colors.white);
  sheet.getRange(2, 7, sheet.getMaxRows() - 1, 1).setBackground(cfg.colors.white);
  sheet.getRange(2, 9, sheet.getMaxRows() - 1, 7).setBackground(cfg.colors.violetLight);

  setColumnWidths_(sheet, [180, 170, 165, 135, 135, 145, 220, 24, 210, 190, 220, 210, 230, 210, 245]);
  sheet.setRowHeight(1, 46);

  sheet.getRange('A1').setNote('Добавляйте партнёров и кредиторов вниз по колонке A. Итоги в C:F рассчитываются автоматически.');
  sheet.getRange('I1').setNote('Добавляйте магазины вниз. Новое значение автоматически станет доступно в выпадающих списках. «Общее» не удаляйте.');
  sheet.getRange('J1').setNote('Только счета и кассы бизнеса. Личный счёт партнёра сюда добавлять не нужно.');
  sheet.getRange('K1:O1').setNote('Справочники можно дополнять вручную. Не оставляйте пустые строки внутри списка.');
  sheet.getRange('M1').setNote('Для каждой группы из колонки L один раз выберите правило учёта в той же строке. Операции используют его автоматически.');
}

function setupIncomeSheet_(sheet, partnersSheet) {
  var cfg = FINANCE_CONFIG;
  ensureSheetSize_(sheet, cfg.rows, 11);
  sheet.setTabColor('#16A34A');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(6);

  var headers = [incomeHeaders_()];
  sheet.getRange(1, 1, 1, 11).setValues(headers);
  styleHeader_(sheet.getRange(1, 1, 1, 11), cfg.colors.green);
  sheet.setRowHeight(1, 46);

  var rowCount = sheet.getMaxRows() - 1;
  sheet.getRange(2, 2, rowCount, 1).setNumberFormat(cfg.dateFormat);
  sheet.getRange(2, 4, rowCount, 1).setNumberFormat(cfg.currencyFormat);
  sheet.getRange(2, 1, rowCount, 1).setFontColor(cfg.colors.gray).setBackground(cfg.colors.formula);
  sheet.getRange(2, 11, rowCount, 1).setBackground(cfg.colors.formula);

  applyDateValidation_(sheet.getRange(2, 2, rowCount, 1));
  applyListValidation_(sheet.getRange(2, 3, rowCount, 1), partnersSheet.getRange(2, 9, partnersSheet.getMaxRows() - 1, 1), 'Сначала добавьте магазин на листе «Справочник».');
  applyPositiveAmountValidation_(sheet.getRange(2, 4, rowCount, 1));
  applyListValidation_(sheet.getRange(2, 5, rowCount, 1), partnersSheet.getRange(2, 11, partnersSheet.getMaxRows() - 1, 1), 'Выберите вид поступления из справочника.');
  applyListValidation_(sheet.getRange(2, 6, rowCount, 1), partnersSheet.getRange(2, 10, partnersSheet.getMaxRows() - 1, 1), 'Выберите счёт бизнеса из справочника.');
  syncIncomeSourceValidations_(sheet, partnersSheet);

  var checkFormulas = [];
  for (var row = 2; row <= sheet.getMaxRows(); row += 1) {
    checkFormulas.push([incomeCheckFormula_(row)]);
  }
  setLocalizedFormulas_(sheet.getRange(2, 11, rowCount, 1), checkFormulas);

  applyTransactionFormatting_(sheet, {
    totalColumns: 11,
    requiredEndColumn: 6,
    checkColumn: 11,
    requiredColor: cfg.colors.incomeRequired,
    requiredFilledColor: cfg.colors.incomeRequiredFilled,
    optionalColor: cfg.colors.incomeOptional,
    alwaysRequiredEndColumn: 5,
    conditionalRequired: [
      {
        column: 6,
        missingFormula: '=AND($D2<>"",$E2<>"' + cfg.incomeTypes.offset + '",$F2="")'
      },
      {
        column: 7,
        missingFormula: '=AND($D2<>"",' + partnerLoanTypeCondition_('$E2') + ',$G2="")'
      }
    ]
  });
  ensureFilter_(sheet, 11);
  setColumnWidths_(sheet, [150, 130, 190, 125, 195, 175, 180, 250, 175, 210, 190]);

  sheet.getRange('A1').setNote('ID создаётся автоматически после заполнения строки. Не редактируйте его вручную.');
  sheet.getRange('E1').setNote('Взнос в капитал и заём увеличивают деньги, но не прибыль. Только заём создаёт долг перед выбранным партнёром или кредитором. Взаимозачёт не влияет ни на деньги, ни на прибыль.');
  sheet.getRange('F1').setNote('Обязательно для всех поступлений, кроме взаимозачёта без движения денег. Все колонки слева закреплены при горизонтальной прокрутке.');
  sheet.getRange('G1').setNote('При займе выберите партнёра или кредитора из списка. Для остальных поступлений поле остаётся обычным текстом.');
  sheet.getRange('K1').setNote('В расчёты попадают только строки со значением «Готово».');
}

function setupExpensesSheet_(sheet, partnersSheet) {
  var cfg = FINANCE_CONFIG;
  ensureSheetSize_(sheet, cfg.rows, 15);
  sheet.setTabColor('#DC2626');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(8);

  var headers = [expenseHeaders_()];
  sheet.getRange(1, 1, 1, 14).setValues(headers);
  sheet.getRange(1, 15).setValue('Правило учёта\n(авто)');
  styleHeader_(sheet.getRange(1, 1, 1, 14), cfg.colors.red);
  styleHeader_(sheet.getRange(1, 15), cfg.colors.dark);
  sheet.setRowHeight(1, 46);

  var rowCount = sheet.getMaxRows() - 1;
  sheet.getRange(2, 2, rowCount, 1).setNumberFormat(cfg.dateFormat);
  sheet.getRange(2, 4, rowCount, 1).setNumberFormat(cfg.currencyFormat);
  sheet.getRange(2, 1, rowCount, 1).setFontColor(cfg.colors.gray).setBackground(cfg.colors.formula);
  sheet.getRange(2, 14, rowCount, 1).setBackground(cfg.colors.formula);
  sheet.getRange(2, 15, rowCount, 1).setBackground(cfg.colors.formula);

  applyDateValidation_(sheet.getRange(2, 2, rowCount, 1));
  applyListValidation_(sheet.getRange(2, 3, rowCount, 1), partnersSheet.getRange(2, 9, partnersSheet.getMaxRows() - 1, 1), 'Сначала добавьте магазин на листе «Справочник».');
  applyPositiveAmountValidation_(sheet.getRange(2, 4, rowCount, 1));
  applyListValidation_(sheet.getRange(2, 5, rowCount, 1), partnersSheet.getRange(2, 12, partnersSheet.getMaxRows() - 1, 1), 'Выберите группу расхода из справочника.');
  applyListValidation_(sheet.getRange(2, 6, rowCount, 1), partnersSheet.getRange(2, 15, partnersSheet.getMaxRows() - 1, 1), 'Статус определяет влияние операции на деньги бизнеса и долг партнёру или кредитору.');
  applyListValidation_(sheet.getRange(2, 7, rowCount, 1), partnersSheet.getRange(2, 10, partnersSheet.getMaxRows() - 1, 1), 'Для оплаты деньгами бизнеса выберите счёт списания.');
  applyListValidation_(sheet.getRange(2, 8, rowCount, 1), partnersSheet.getRange(2, 1, partnersSheet.getMaxRows() - 1, 1), 'Сначала добавьте партнёра или кредитора в колонку A листа «Справочник».');
  applyListValidation_(sheet.getRange(2, 9, rowCount, 1), partnersSheet.getRange(2, 14, partnersSheet.getMaxRows() - 1, 1), 'Выберите категорию из справочника.');

  var checkFormulas = [];
  var accountingRuleFormulas = [];
  for (var row = 2; row <= sheet.getMaxRows(); row += 1) {
    checkFormulas.push([expenseCheckFormula_(row)]);
    accountingRuleFormulas.push([expenseAccountingRuleFormula_(row)]);
  }
  setLocalizedFormulas_(sheet.getRange(2, 15, rowCount, 1), accountingRuleFormulas);
  setLocalizedFormulas_(sheet.getRange(2, 14, rowCount, 1), checkFormulas);

  applyTransactionFormatting_(sheet, {
    totalColumns: 14,
    requiredEndColumn: 8,
    checkColumn: 14,
    requiredColor: cfg.colors.expenseRequired,
    requiredFilledColor: cfg.colors.expenseRequiredFilled,
    optionalColor: cfg.colors.expenseOptional,
    conditionalRequired: [
      {
        column: 7,
        missingFormula: '=AND($D2<>"",$F2="' + cfg.statuses.business + '",$G2="")'
      },
      {
        column: 8,
        missingFormula: '=AND($D2<>"",OR($F2="' + cfg.statuses.personalDebt + '",$F2="' + cfg.statuses.offset + '",$O2="' + cfg.accountingRules.debtRepayment + '",$O2="' + cfg.accountingRules.dividends + '",$O2="' + cfg.accountingRules.offset + '"),$H2="")'
      }
    ]
  });
  ensureFilter_(sheet, 14);
  setColumnWidths_(sheet, [150, 130, 180, 125, 190, 220, 165, 175, 180, 190, 240, 165, 210, 195, 150]);
  sheet.hideColumns(15);

  sheet.getRange('A1').setNote('ID создаётся автоматически после заполнения строки. Не редактируйте его вручную.');
  sheet.getRange('F1').setNote('«Из своих — вернуть» создаёт долг перед связанным партнёром или кредитором. Взаимозачёт уменьшает долг без движения денег. «Личная трата — не учитывать» не влияет на деньги, прибыль и долг бизнеса.');
  sheet.getRange('G1').setNote('Обязательно только при статусе «Оплачено деньгами бизнеса».');
  sheet.getRange('H1').setNote('Обязательно для оплаты из своих, возврата долга, выплаты дивидендов и взаимозачёта. Это последняя колонка закреплённого обязательного блока.');
  sheet.getRange('K1').setNote('Необязательное поле: при необходимости напишите, зачем и для чего была произведена трата.');
  sheet.getRange('N1').setNote('В расчёты попадают только строки со значением «Готово».');
}

function setupDashboardSheet_(sheet) {
  var cfg = FINANCE_CONFIG;
  ensureSheetSize_(sheet, cfg.dashboardRows, 14);
  sheet.setTabColor(cfg.colors.dark);
  sheet.setFrozenRows(7);
  sheet.getRange(1, 1, cfg.dashboardRows, 14).breakApart();
  sheet.getRange(1, 1, cfg.dashboardRows, 14).clearContent().clearNote();
  sheet.getRange(1, 1, 6, 14).clearFormat();
  styleDashboardCards_(sheet);

  sheet.getRange('A7:G7').setValues([[
    'Магазин',
    'Доход для прибыли',
    'Операционные расходы',
    'Налоги',
    'Прибыль',
    'Остаток денег',
    'Долг партнёрам / кредиторам'
  ]]);
  sheet.getRange('J7:K7').setValues([['Счёт бизнеса', 'Текущий остаток']]);
  sheet.getRange('M7:N7').setValues([['Партнёр / кредитор', 'Текущий долг']]);
  styleHeader_(sheet.getRange('A7:G7'), cfg.colors.violet);
  styleHeader_(sheet.getRange('J7:K7'), cfg.colors.green);
  styleHeader_(sheet.getRange('M7:N7'), cfg.colors.amber);

  var storeRows = 200;
  var storeNames = [];
  var storeRevenue = [];
  var storeOperating = [];
  var storeTaxes = [];
  var storeProfit = [];
  var storeCash = [];
  var storeDebt = [];
  for (var index = 0; index < storeRows; index += 1) {
    var row = 8 + index;
    storeNames.push([dashboardDirectoryValueFormula_('I', row, 'A')]);
    storeRevenue.push([storeRevenueFormula_(row)]);
    storeOperating.push([storeOperatingExpenseFormula_(row)]);
    storeTaxes.push([storeTaxFormula_(row)]);
    storeProfit.push(['=IF($A' + row + '="","",B' + row + '-C' + row + '-D' + row + ')']);
    storeCash.push([storeCashFormula_(row)]);
    storeDebt.push([storeDebtFormula_(row)]);
  }
  setLocalizedFormulas_(sheet.getRange(8, 1, storeRows, 1), storeNames);
  setLocalizedFormulas_(sheet.getRange(8, 2, storeRows, 1), storeRevenue);
  setLocalizedFormulas_(sheet.getRange(8, 3, storeRows, 1), storeOperating);
  setLocalizedFormulas_(sheet.getRange(8, 4, storeRows, 1), storeTaxes);
  setLocalizedFormulas_(sheet.getRange(8, 5, storeRows, 1), storeProfit);
  setLocalizedFormulas_(sheet.getRange(8, 6, storeRows, 1), storeCash);
  setLocalizedFormulas_(sheet.getRange(8, 7, storeRows, 1), storeDebt);
  sheet.getRange(8, 2, storeRows, 6).setNumberFormat(cfg.currencyFormat);

  var sideRows = 100;
  var accountNames = [];
  var accountBalances = [];
  var partnerNames = [];
  var partnerDebts = [];
  for (var sideIndex = 0; sideIndex < sideRows; sideIndex += 1) {
    var sideRow = 8 + sideIndex;
    accountNames.push([dashboardDirectoryValueFormula_('J', sideRow, 'J')]);
    accountBalances.push([accountBalanceFormula_(sideRow)]);
    partnerNames.push([dashboardDirectoryValueFormula_('A', sideRow, 'M')]);
    partnerDebts.push([dashboardPartnerDebtFormula_(sideRow)]);
  }
  setLocalizedFormulas_(sheet.getRange(8, 10, sideRows, 1), accountNames);
  setLocalizedFormulas_(sheet.getRange(8, 11, sideRows, 1), accountBalances);
  setLocalizedFormulas_(sheet.getRange(8, 13, sideRows, 1), partnerNames);
  setLocalizedFormulas_(sheet.getRange(8, 14, sideRows, 1), partnerDebts);
  sheet.getRange(8, 11, sideRows, 1).setNumberFormat(cfg.currencyFormat);
  sheet.getRange(8, 14, sideRows, 1).setNumberFormat(cfg.currencyFormat);

  sheet.getRange(8, 1, storeRows, 7).setBackground(cfg.colors.white);
  sheet.getRange(8, 10, sideRows, 2).setBackground(cfg.colors.greenLight);
  sheet.getRange(8, 13, sideRows, 2).setBackground(cfg.colors.amberLight);
  setColumnWidths_(sheet, [215, 145, 160, 120, 135, 145, 145, 24, 24, 190, 150, 24, 190, 150]);
}

function styleHeader_(range, color) {
  range
    .setBackground(color)
    .setFontColor(FINANCE_CONFIG.colors.white)
    .setFontWeight('bold')
    .setFontSize(10)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
}

function styleDashboardCards_(sheet) {
  var cfg = FINANCE_CONFIG;
  var cards = [
    {
      row: 1,
      label: 'Деньги бизнеса сейчас',
      formula: overallCashFormula_(),
      background: cfg.colors.greenLight,
      fontColor: cfg.colors.green,
      numberFormat: cfg.currencyFormat
    },
    {
      row: 2,
      label: 'Управленческая прибыль',
      formula: overallProfitFormula_(),
      background: cfg.colors.violetLight,
      fontColor: cfg.colors.violet,
      numberFormat: cfg.currencyFormat
    },
    {
      row: 3,
      label: 'Долг партнёрам / кредиторам',
      formula: overallPartnerDebtFormula_(),
      background: cfg.colors.amberLight,
      fontColor: cfg.colors.amber,
      numberFormat: cfg.currencyFormat
    },
    {
      row: 4,
      label: 'Операций с ошибками',
      formula: invalidOperationsFormula_(),
      background: cfg.colors.redLight,
      fontColor: cfg.colors.red,
      numberFormat: '0'
    }
  ];

  cards.forEach(function (card) {
    var labelRange = sheet.getRange(card.row, 1, 1, 5).merge();
    var valueRange = sheet.getRange(card.row, 6, 1, 2).merge();

    sheet.getRange(card.row, 1).setValue(card.label);
    labelRange
      .setFontWeight('bold')
      .setFontSize(11)
      .setFontColor(cfg.colors.dark)
      .setBackground(cfg.colors.grayLight)
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle');

    setLocalizedFormula_(sheet.getRange(card.row, 6), card.formula);
    valueRange
      .setFontWeight('bold')
      .setFontSize(14)
      .setFontColor(card.fontColor)
      .setBackground(card.background)
      .setNumberFormat(card.numberFormat)
      .setHorizontalAlignment('right')
      .setVerticalAlignment('middle');

    sheet.getRange(card.row, 1, 1, 7).setBorder(
      null,
      null,
      true,
      null,
      null,
      null,
      cfg.colors.border,
      SpreadsheetApp.BorderStyle.SOLID
    );
    sheet.setRowHeight(card.row, 42);
  });

  sheet.setRowHeights(5, 2, 12);
}

function setColumnWidths_(sheet, widths) {
  widths.forEach(function (width, index) {
    sheet.setColumnWidth(index + 1, width);
  });
}

function seedColumnIfEmpty_(sheet, column, values) {
  var range = sheet.getRange(2, column, sheet.getMaxRows() - 1, 1);
  var hasValue = range.getDisplayValues().some(function (row) {
    return row[0].trim() !== '';
  });
  if (hasValue) return;
  sheet.getRange(2, column, values.length, 1).setValues(values.map(function (value) { return [value]; }));
}

function appendValuesIfMissing_(sheet, column, values) {
  var range = sheet.getRange(2, column, sheet.getMaxRows() - 1, 1);
  var existingValues = range.getDisplayValues();
  var existing = {};
  var lastUsedRow = 1;

  existingValues.forEach(function (row, index) {
    var value = row[0].trim();
    if (value === '') return;
    existing[value.toLocaleLowerCase()] = true;
    lastUsedRow = index + 2;
  });

  var missing = values.filter(function (value) {
    return !existing[String(value).trim().toLocaleLowerCase()];
  });
  if (missing.length === 0) return;
  if (lastUsedRow + missing.length > sheet.getMaxRows()) {
    throw new Error('На листе «' + sheet.getName() + '» закончилось место в справочнике.');
  }

  sheet.getRange(lastUsedRow + 1, column, missing.length, 1).setValues(
    missing.map(function (value) { return [value]; })
  );
}

function accountingRuleValues_() {
  var rules = FINANCE_CONFIG.accountingRules;
  return [
    rules.operating,
    rules.taxes,
    rules.dividends,
    rules.debtRepayment,
    rules.personalWithdrawal,
    rules.offset
  ];
}

function fillKnownAccountingRules_(sheet) {
  var cfg = FINANCE_CONFIG;
  var knownRules = {};
  knownRules[cfg.expenseGroups.operating] = cfg.accountingRules.operating;
  knownRules[cfg.expenseGroups.taxes] = cfg.accountingRules.taxes;
  knownRules[cfg.expenseGroups.dividends] = cfg.accountingRules.dividends;
  knownRules[cfg.expenseGroups.debtRepayment] = cfg.accountingRules.debtRepayment;
  knownRules[cfg.expenseGroups.personalWithdrawal] = cfg.accountingRules.personalWithdrawal;
  knownRules[cfg.expenseGroups.offset] = cfg.accountingRules.offset;

  var rowCount = sheet.getMaxRows() - 1;
  var groupValues = sheet.getRange(2, 12, rowCount, 1).getDisplayValues();
  var ruleRange = sheet.getRange(2, 13, rowCount, 1);
  var ruleValues = ruleRange.getValues();
  var changed = false;

  for (var index = 0; index < rowCount; index += 1) {
    var group = groupValues[index][0].trim();
    if (ruleValues[index][0] === '' && knownRules[group]) {
      ruleValues[index][0] = knownRules[group];
      changed = true;
    }
  }

  if (changed) ruleRange.setValues(ruleValues);
}

function applyValueListValidation_(targetRange, values, helpText) {
  targetRange.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(values, true)
      .setAllowInvalid(false)
      .setHelpText(helpText)
      .build()
  );
}

function applyDateValidation_(range) {
  range.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireDate()
      .setAllowInvalid(false)
      .setHelpText('Введите дату вручную или выберите её в календаре.')
      .build()
  );
}

function applyPositiveAmountValidation_(range) {
  range.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireNumberGreaterThan(0)
      .setAllowInvalid(false)
      .setHelpText('Сумма должна быть числом больше нуля.')
      .build()
  );
}

function applyListValidation_(targetRange, sourceRange, helpText) {
  targetRange.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(sourceRange, true)
      .setAllowInvalid(false)
      .setHelpText(helpText)
      .build()
  );
}

function partnerLoanTypeValues_() {
  var types = FINANCE_CONFIG.incomeTypes;
  return [types.partnerLoan, types.partnerLoanLegacy];
}

function isPartnerLoanType_(value) {
  var normalized = String(value || '').trim();
  return partnerLoanTypeValues_().some(function (type) {
    return normalized === type;
  });
}

function partnerLoanTypeCondition_(cellReference) {
  return 'OR(' + partnerLoanTypeValues_().map(function (type) {
    return cellReference + '="' + type + '"';
  }).join(',') + ')';
}

function incomeSourceValidationRule_(partnersSheet) {
  return SpreadsheetApp.newDataValidation()
    .requireValueInRange(partnersSheet.getRange(2, 1, partnersSheet.getMaxRows() - 1, 1), true)
    .setAllowInvalid(false)
    .setHelpText('Для займа выберите партнёра или кредитора из листа «Справочник».')
    .build();
}

function syncIncomeSourceValidations_(sheet, partnersSheet) {
  var rowCount = sheet.getMaxRows() - 1;
  var sourceRange = sheet.getRange(2, 7, rowCount, 1);
  sourceRange.clearDataValidations();

  var typeValues = sheet.getRange(2, 5, rowCount, 1).getDisplayValues();
  var loanCells = [];
  typeValues.forEach(function (row, index) {
    if (isPartnerLoanType_(row[0])) loanCells.push('G' + (index + 2));
  });
  if (loanCells.length === 0) return;

  var validation = incomeSourceValidationRule_(partnersSheet);
  sheet.getRangeList(loanCells).getRanges().forEach(function (range) {
    range.setDataValidation(validation);
  });
}

function syncIncomeSourceValidation_(sheet, partnersSheet, row) {
  var sourceCell = sheet.getRange(row, 7);
  sourceCell.clearDataValidations();
  if (isPartnerLoanType_(sheet.getRange(row, 5).getDisplayValue())) {
    sourceCell.setDataValidation(incomeSourceValidationRule_(partnersSheet));
  }
}

/**
 * Русская локаль Google Таблиц использует «;» между аргументами формул.
 * Генераторы ниже хранят формулы в стандартном виде с «,», а перед записью
 * этот метод меняет только разделители вне строковых значений.
 */
function localizeFormula_(formula) {
  var result = '';
  var insideString = false;
  for (var index = 0; index < formula.length; index += 1) {
    var character = formula.charAt(index);
    if (character === '"') {
      if (insideString && formula.charAt(index + 1) === '"') {
        result += '""';
        index += 1;
        continue;
      }
      insideString = !insideString;
      result += character;
    } else if (character === ',' && !insideString) {
      result += ';';
    } else {
      result += character;
    }
  }
  return result;
}

function setLocalizedFormula_(range, formula) {
  range.setFormula(localizeFormula_(formula));
}

function setLocalizedFormulas_(range, formulas) {
  range.setFormulas(formulas.map(function (row) {
    return row.map(localizeFormula_);
  }));
}

function applyTransactionFormatting_(sheet, options) {
  var cfg = FINANCE_CONFIG;
  var rowCount = sheet.getMaxRows() - 1;
  var requiredRange = sheet.getRange(2, 1, rowCount, options.requiredEndColumn);
  var optionalColumnCount = options.checkColumn - options.requiredEndColumn - 1;
  var checkRange = sheet.getRange(2, options.checkColumn, rowCount, 1);
  var checkLetter = columnToLetter_(options.checkColumn);

  requiredRange
    .setBackground(options.requiredColor)
    .setFontColor(cfg.colors.dark)
    .setFontWeight('normal');

  if (optionalColumnCount > 0) {
    sheet.getRange(2, options.requiredEndColumn + 1, rowCount, optionalColumnCount)
      .setBackground(options.optionalColor)
      .setFontColor(cfg.colors.dark)
      .setFontWeight('normal');
  }

  checkRange
    .setBackground(cfg.colors.formula)
    .setFontColor(cfg.colors.dark)
    .setFontWeight('normal');
  sheet.getRange(2, 1, rowCount, 1).setFontColor(cfg.colors.gray);

  sheet.getRange(1, options.requiredEndColumn, sheet.getMaxRows(), 1).setBorder(
    null,
    null,
    null,
    true,
    null,
    null,
    cfg.colors.sectionBorder,
    SpreadsheetApp.BorderStyle.SOLID_THICK
  );

  var rules = [];
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(localizeFormula_('=AND($D2<>"",A2<>"")'))
      .setBackground(options.requiredFilledColor)
      .setFontColor(cfg.colors.dark)
      .setRanges([requiredRange])
      .build()
  );

  var alwaysRequiredEndColumn = options.alwaysRequiredEndColumn || Math.min(6, options.requiredEndColumn);
  var alwaysRequiredRange = sheet.getRange(2, 2, rowCount, alwaysRequiredEndColumn - 1);
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(localizeFormula_('=AND($D2<>"",B2="")'))
      .setBackground(cfg.colors.missing)
      .setFontColor(cfg.colors.white)
      .setBold(true)
      .setRanges([alwaysRequiredRange])
      .build()
  );

  (options.conditionalRequired || []).forEach(function (conditional) {
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(localizeFormula_(conditional.missingFormula))
        .setBackground(cfg.colors.missing)
        .setFontColor(cfg.colors.white)
        .setBold(true)
        .setRanges([sheet.getRange(2, conditional.column, rowCount, 1)])
        .build()
    );
  });

  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(localizeFormula_('=$' + checkLetter + '2="' + cfg.ready + '"'))
      .setBackground(cfg.colors.greenLight)
      .setFontColor(cfg.colors.green)
      .setBold(true)
      .setRanges([checkRange])
      .build()
  );
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(localizeFormula_('=AND($D2<>"",$' + checkLetter + '2<>"' + cfg.ready + '")'))
      .setBackground(cfg.colors.redLight)
      .setFontColor(cfg.colors.red)
      .setBold(true)
      .setRanges([checkRange])
      .build()
  );

  sheet.setConditionalFormatRules(rules);
}

function ensureFilter_(sheet, totalColumns) {
  if (!sheet.getFilter()) {
    sheet.getRange(1, 1, sheet.getMaxRows(), totalColumns).createFilter();
  }
}

function columnToLetter_(column) {
  var result = '';
  var value = column;
  while (value > 0) {
    var remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function handleFinanceEdit(event) {
  if (!event || !event.range) return;
  var sheet = event.range.getSheet();
  var name = sheet.getName();

  if (name === FINANCE_CONFIG.sheets.dashboard) {
    setupDashboardSheet_(sheet);
    return;
  }

  if (name === FINANCE_CONFIG.sheets.partners) {
    if (event.range.getLastRow() < 2) return;
    var partnerNameChanged = rangeTouchesColumns_(event.range, 1, 1);
    var partnerFormulaChanged = rangeTouchesColumns_(event.range, 3, 6);
    if (!partnerNameChanged && !partnerFormulaChanged) return;
    var firstPartnerRow = Math.max(2, event.range.getRow());
    for (var partnerRow = firstPartnerRow; partnerRow <= event.range.getLastRow(); partnerRow += 1) {
      setPartnerSummaryFormulas_(sheet, partnerRow);
    }
    return;
  }
  var isIncome = name === FINANCE_CONFIG.sheets.income;
  var isExpense = name === FINANCE_CONFIG.sheets.expenses;
  if (!isIncome && !isExpense) return;
  if (event.range.getLastRow() < 2) return;

  var firstRow = Math.max(2, event.range.getRow());
  var lastRow = event.range.getLastRow();
  var lastManualColumn = isIncome ? 10 : 13;
  var checkColumn = isIncome ? 11 : 14;
  var amountWasEdited = rangeTouchesColumns_(event.range, 4, 4);
  var partnersSheet = isIncome && event.source
    ? event.source.getSheetByName(FINANCE_CONFIG.sheets.partners)
    : null;

  if (rangeTouchesColumns_(event.range, checkColumn, checkColumn)) {
    for (var checkRow = firstRow; checkRow <= lastRow; checkRow += 1) {
      setLocalizedFormula_(
        sheet.getRange(checkRow, checkColumn),
        isIncome ? incomeCheckFormula_(checkRow) : expenseCheckFormula_(checkRow)
      );
    }
  }

  if (event.range.getColumn() > lastManualColumn || event.range.getLastColumn() < 2) return;

  for (var row = firstRow; row <= lastRow; row += 1) {
    ensureTransactionRow_(sheet, row, isIncome, lastManualColumn, checkColumn, amountWasEdited);
    if (isIncome && partnersSheet) {
      syncIncomeSourceValidation_(sheet, partnersSheet, row);
    }
  }
}

function rangeTouchesColumns_(range, firstColumn, lastColumn) {
  return range.getColumn() <= lastColumn && range.getLastColumn() >= firstColumn;
}

function setPartnerSummaryFormulas_(sheet, row) {
  setLocalizedFormulas_(sheet.getRange(row, 3, 1, 4), [[
    partnerDebtFormula_(row),
    partnerPaidOwnFormula_(row),
    partnerRepaidFormula_(row),
    partnerDividendsFormula_(row)
  ]]);
  sheet.getRange(row, 3, 1, 4)
    .setNumberFormat(FINANCE_CONFIG.currencyFormat)
    .setBackground(FINANCE_CONFIG.colors.formula);
}

function ensureTransactionRow_(sheet, row, isIncome, lastManualColumn, checkColumn, amountWasEdited) {
  var manualValues = sheet.getRange(row, 2, 1, lastManualColumn - 1).getDisplayValues()[0];
  var hasManualData = manualValues.some(function (value) { return value.trim() !== ''; });
  var idCell = sheet.getRange(row, 1);
  var amountCell = sheet.getRange(row, 4);
  var isNewOperation = amountWasEdited && !amountCell.isBlank();

  if (isNewOperation) {
    if (idCell.isBlank()) {
      idCell.setValue(makeOperationId_(isIncome ? 'IN' : 'OUT'));
    }
    var dateCell = sheet.getRange(row, 2);
    if (dateCell.isBlank()) {
      dateCell.setValue(new Date());
    }
  } else if (!hasManualData) {
    idCell.clearContent();
  }

  var checkCell = sheet.getRange(row, checkColumn);
  if (checkCell.isBlank()) {
    setLocalizedFormula_(checkCell, isIncome ? incomeCheckFormula_(row) : expenseCheckFormula_(row));
  }

  if (row > 2) {
    sheet.getRange(2, 2, 1, lastManualColumn - 1).copyTo(
      sheet.getRange(row, 2, 1, lastManualColumn - 1),
      SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION,
      false
    );
  }
}

function makeOperationId_(prefix) {
  var timezone = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  var date = Utilities.formatDate(new Date(), timezone, 'yyyyMMdd');
  return prefix + '-' + date + '-' + Utilities.getUuid().slice(0, 8).toUpperCase();
}

function incomeCheckFormula_(row) {
  var cfg = FINANCE_CONFIG;
  var loanCondition = partnerLoanTypeCondition_('E' + row);
  return '=IF(COUNTA(B' + row + ':J' + row + ')=0,"",' +
    'IF(B' + row + '="","Нет даты",' +
    'IF(C' + row + '="","Нет магазина",' +
    'IF(OR(D' + row + '="",D' + row + '<=0),"Нет корректной суммы",' +
    'IF(E' + row + '="","Нет вида поступления",' +
    'IF(AND(E' + row + '<>"' + cfg.incomeTypes.offset + '",F' + row + '=""),"Нет счёта получения",' +
    'IF(AND(E' + row + '="' + cfg.incomeTypes.offset + '",F' + row + '<>""),"Очистите счёт получения",' +
    'IF(AND(' + loanCondition + ',G' + row + '=""),"Не указан партнёр / кредитор",' +
    'IF(AND(' + loanCondition + ',G' + row + '<>"",COUNTIF(' + txRange_('partners', 'A') + ',G' + row + ')=0),"Партнёр / кредитор не найден","' + cfg.ready + '")))))))))';
}

function expenseAccountingRuleFormula_(row) {
  return '=IF(E' + row + '="","",IFERROR(INDEX(' + txRange_('partners', 'M') + ',MATCH(E' + row + ',' + txRange_('partners', 'L') + ',0)),""))';
}

function expenseCheckFormula_(row) {
  var cfg = FINANCE_CONFIG;
  return '=IF(COUNTA(B' + row + ':M' + row + ')=0,"",' +
    'IF(B' + row + '="","Нет даты",' +
    'IF(C' + row + '="","Нет магазина",' +
    'IF(OR(D' + row + '="",D' + row + '<=0),"Нет корректной суммы",' +
    'IF(E' + row + '="","Нет группы расхода",' +
    'IF(O' + row + '="","Нет правила учёта группы",' +
    'IF(F' + row + '="","Нет статуса оплаты",' +
    'IF(OR(AND(O' + row + '="' + cfg.accountingRules.offset + '",F' + row + '<>"' + cfg.statuses.offset + '"),AND(F' + row + '="' + cfg.statuses.offset + '",O' + row + '<>"' + cfg.accountingRules.offset + '")),"Проверьте группу и статус взаимозачёта",' +
    'IF(AND(F' + row + '="' + cfg.statuses.business + '",G' + row + '=""),"Нет счёта списания",' +
    'IF(AND(F' + row + '="' + cfg.statuses.offset + '",G' + row + '<>""),"Очистите счёт списания",' +
    'IF(AND(OR(F' + row + '="' + cfg.statuses.personalDebt + '",F' + row + '="' + cfg.statuses.offset + '",O' + row + '="' + cfg.accountingRules.debtRepayment + '",O' + row + '="' + cfg.accountingRules.dividends + '",O' + row + '="' + cfg.accountingRules.offset + '"),H' + row + '=""),"Не указан партнёр / кредитор","' + cfg.ready + '")))))))))))';
}

function partnerLoanDebtExpression_(partnerReference, storeReference) {
  var cfg = FINANCE_CONFIG;
  var extraCriteria = '';
  if (partnerReference) {
    extraCriteria += ',' + txRange_('income', 'G') + ',' + partnerReference;
  }
  if (storeReference) {
    extraCriteria += ',' + txRange_('income', 'C') + ',' + storeReference;
  }

  return partnerLoanTypeValues_().map(function (type) {
    return 'SUMIFS(' + txRange_('income', 'D') + ',' + txRange_('income', 'E') + ',"' + type + '",' + txRange_('income', 'K') + ',"' + cfg.ready + '"' + extraCriteria + ')';
  }).join('+');
}

function partnerDebtFormula_(row) {
  var cfg = FINANCE_CONFIG;
  return '=IF(A' + row + '="","",' +
    partnerLoanDebtExpression_('$A' + row, '') + '+' +
    'SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'H') + ',$A' + row + ',' + txRange_('expenses', 'F') + ',"' + cfg.statuses.personalDebt + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '")-' +
    'SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'H') + ',$A' + row + ',' + txRange_('expenses', 'O') + ',"' + cfg.accountingRules.debtRepayment + '",' + txRange_('expenses', 'F') + ',"' + cfg.statuses.business + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '")-' +
    'SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'H') + ',$A' + row + ',' + txRange_('expenses', 'O') + ',"' + cfg.accountingRules.offset + '",' + txRange_('expenses', 'F') + ',"' + cfg.statuses.offset + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '"))';
}

function partnerPaidOwnFormula_(row) {
  var cfg = FINANCE_CONFIG;
  return '=IF(A' + row + '="","",SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'H') + ',$A' + row + ',' + txRange_('expenses', 'F') + ',"' + cfg.statuses.personalDebt + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '"))';
}

function partnerRepaidFormula_(row) {
  var cfg = FINANCE_CONFIG;
  return '=IF(A' + row + '="","",' +
    'SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'H') + ',$A' + row + ',' + txRange_('expenses', 'O') + ',"' + cfg.accountingRules.debtRepayment + '",' + txRange_('expenses', 'F') + ',"' + cfg.statuses.business + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '")+' +
    'SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'H') + ',$A' + row + ',' + txRange_('expenses', 'O') + ',"' + cfg.accountingRules.offset + '",' + txRange_('expenses', 'F') + ',"' + cfg.statuses.offset + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '"))';
}

function partnerDividendsFormula_(row) {
  var cfg = FINANCE_CONFIG;
  return '=IF(A' + row + '="","",SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'H') + ',$A' + row + ',' + txRange_('expenses', 'O') + ',"' + cfg.accountingRules.dividends + '",' + txRange_('expenses', 'F') + ',"' + cfg.statuses.business + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '"))';
}

function overallCashFormula_() {
  var cfg = FINANCE_CONFIG;
  return '=SUMIFS(' + txRange_('income', 'D') + ',' + txRange_('income', 'E') + ',"<>' + cfg.incomeTypes.offset + '",' + txRange_('income', 'K') + ',"' + cfg.ready + '")-' +
    'SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'F') + ',"' + cfg.statuses.business + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '")';
}

function overallProfitFormula_() {
  return '=(' + incomeForProfitExpression_('') + ')-(' + expenseForProfitExpression_('') + ')';
}

function overallPartnerDebtFormula_() {
  var cfg = FINANCE_CONFIG;
  return '=' + partnerLoanDebtExpression_('', '') + '+' +
    'SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'F') + ',"' + cfg.statuses.personalDebt + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '")-' +
    'SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'O') + ',"' + cfg.accountingRules.debtRepayment + '",' + txRange_('expenses', 'F') + ',"' + cfg.statuses.business + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '")-' +
    'SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'O') + ',"' + cfg.accountingRules.offset + '",' + txRange_('expenses', 'F') + ',"' + cfg.statuses.offset + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '")';
}

function invalidOperationsFormula_() {
  var cfg = FINANCE_CONFIG;
  return '=COUNTIFS(' + txRange_('income', 'A') + ',"<>",' + txRange_('income', 'K') + ',"<>' + cfg.ready + '")+' +
    'COUNTIFS(' + txRange_('expenses', 'A') + ',"<>",' + txRange_('expenses', 'N') + ',"<>' + cfg.ready + '")';
}

function dashboardDirectoryValueFormula_(directoryColumn, dashboardRow, dashboardColumn) {
  var cfg = FINANCE_CONFIG;
  var startRow = 8;
  var directoryRange = txRange_('partners', directoryColumn);
  return '=IFERROR(INDEX(FILTER(' + directoryRange + ',' + directoryRange + '<>""),ROWS($' + dashboardColumn + '$' + startRow + ':' + dashboardColumn + dashboardRow + ')),"")';
}

function storeRevenueFormula_(row) {
  return '=IF($A' + row + '="","",' + incomeForProfitExpression_('$A' + row) + ')';
}

function storeOperatingExpenseFormula_(row) {
  var cfg = FINANCE_CONFIG;
  return '=IF($A' + row + '="","",SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'C') + ',$A' + row + ',' + txRange_('expenses', 'O') + ',"' + cfg.accountingRules.operating + '",' + txRange_('expenses', 'F') + ',"<>' + cfg.statuses.personalIgnore + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '"))';
}

function storeTaxFormula_(row) {
  var cfg = FINANCE_CONFIG;
  return '=IF($A' + row + '="","",SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'C') + ',$A' + row + ',' + txRange_('expenses', 'O') + ',"' + cfg.accountingRules.taxes + '",' + txRange_('expenses', 'F') + ',"<>' + cfg.statuses.personalIgnore + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '"))';
}

function storeCashFormula_(row) {
  var cfg = FINANCE_CONFIG;
  return '=IF($A' + row + '="","",' +
    'SUMIFS(' + txRange_('income', 'D') + ',' + txRange_('income', 'C') + ',$A' + row + ',' + txRange_('income', 'E') + ',"<>' + cfg.incomeTypes.offset + '",' + txRange_('income', 'K') + ',"' + cfg.ready + '")-' +
    'SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'C') + ',$A' + row + ',' + txRange_('expenses', 'F') + ',"' + cfg.statuses.business + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '"))';
}

function storeDebtFormula_(row) {
  var cfg = FINANCE_CONFIG;
  return '=IF($A' + row + '="","",' +
    partnerLoanDebtExpression_('', '$A' + row) + '+' +
    'SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'C') + ',$A' + row + ',' + txRange_('expenses', 'F') + ',"' + cfg.statuses.personalDebt + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '")-' +
    'SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'C') + ',$A' + row + ',' + txRange_('expenses', 'O') + ',"' + cfg.accountingRules.debtRepayment + '",' + txRange_('expenses', 'F') + ',"' + cfg.statuses.business + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '")-' +
    'SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'C') + ',$A' + row + ',' + txRange_('expenses', 'O') + ',"' + cfg.accountingRules.offset + '",' + txRange_('expenses', 'F') + ',"' + cfg.statuses.offset + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '"))';
}

function accountBalanceFormula_(row) {
  var cfg = FINANCE_CONFIG;
  return '=IF($J' + row + '="","",' +
    'SUMIFS(' + txRange_('income', 'D') + ',' + txRange_('income', 'F') + ',$J' + row + ',' + txRange_('income', 'E') + ',"<>' + cfg.incomeTypes.offset + '",' + txRange_('income', 'K') + ',"' + cfg.ready + '")-' +
    'SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'G') + ',$J' + row + ',' + txRange_('expenses', 'F') + ',"' + cfg.statuses.business + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '"))';
}

function dashboardPartnerDebtFormula_(row) {
  var cfg = FINANCE_CONFIG;
  return '=IF($M' + row + '="","",' +
    partnerLoanDebtExpression_('$M' + row, '') + '+' +
    'SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'H') + ',$M' + row + ',' + txRange_('expenses', 'F') + ',"' + cfg.statuses.personalDebt + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '")-' +
    'SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'H') + ',$M' + row + ',' + txRange_('expenses', 'O') + ',"' + cfg.accountingRules.debtRepayment + '",' + txRange_('expenses', 'F') + ',"' + cfg.statuses.business + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '")-' +
    'SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'H') + ',$M' + row + ',' + txRange_('expenses', 'O') + ',"' + cfg.accountingRules.offset + '",' + txRange_('expenses', 'F') + ',"' + cfg.statuses.offset + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '"))';
}

function incomeForProfitExpression_(storeReference) {
  var cfg = FINANCE_CONFIG;
  var storeCriteria = storeReference ? ',' + txRange_('income', 'C') + ',' + storeReference : '';
  var types = [cfg.incomeTypes.wbRevenue, cfg.incomeTypes.otherRevenue, cfg.incomeTypes.refund];
  return types.map(function (type) {
    return 'SUMIFS(' + txRange_('income', 'D') + ',' + txRange_('income', 'E') + ',"' + type + '",' + txRange_('income', 'K') + ',"' + cfg.ready + '"' + storeCriteria + ')';
  }).join('+');
}

function expenseForProfitExpression_(storeReference) {
  var cfg = FINANCE_CONFIG;
  var storeCriteria = storeReference ? ',' + txRange_('expenses', 'C') + ',' + storeReference : '';
  var rules = [cfg.accountingRules.operating, cfg.accountingRules.taxes];
  return rules.map(function (rule) {
    return 'SUMIFS(' + txRange_('expenses', 'D') + ',' + txRange_('expenses', 'O') + ',"' + rule + '",' + txRange_('expenses', 'F') + ',"<>' + cfg.statuses.personalIgnore + '",' + txRange_('expenses', 'N') + ',"' + cfg.ready + '"' + storeCriteria + ')';
  }).join('+');
}

function txRange_(sheetKey, column) {
  var sheetName = FINANCE_CONFIG.sheets[sheetKey];
  return '\'' + sheetName + '\'!$' + column + '$2:$' + column + '$' + FINANCE_CONFIG.rows;
}

function validateFinanceWorkbook() {
  var spreadsheet = SpreadsheetApp.getActive();
  var cfg = FINANCE_CONFIG;
  var income = spreadsheet.getSheetByName(cfg.sheets.income);
  var expenses = spreadsheet.getSheetByName(cfg.sheets.expenses);
  var partners = spreadsheet.getSheetByName(cfg.sheets.partners);

  if (!income || !expenses || !partners) {
    SpreadsheetApp.getUi().alert('Сначала запустите «Создать / обновить структуру».');
    return;
  }

  SpreadsheetApp.flush();
  var issues = [];
  appendDuplicateIssues_(issues, partners, 1, 'партнёров и кредиторов');
  appendDuplicateIssues_(issues, partners, 9, 'магазинов');
  appendDuplicateIssues_(issues, partners, 10, 'счетов бизнеса');

  var invalidIncome = countInvalidRows_(income, 11);
  var invalidExpenses = countInvalidRows_(expenses, 14);
  if (invalidIncome > 0) issues.push('Незаполненные поступления: ' + invalidIncome);
  if (invalidExpenses > 0) issues.push('Незаполненные расходы: ' + invalidExpenses);

  var message = issues.length === 0
    ? 'Ошибок не найдено. Все заполненные операции готовы к расчёту.'
    : 'Найдены проблемы:\n\n• ' + issues.join('\n• ');
  SpreadsheetApp.getUi().alert('Проверка финансового учёта', message, SpreadsheetApp.getUi().ButtonSet.OK);
}

function appendDuplicateIssues_(issues, sheet, column, label) {
  var values = sheet.getRange(2, column, sheet.getLastRow() - 1 || 1, 1).getDisplayValues()
    .map(function (row) { return row[0].trim(); })
    .filter(function (value) { return value !== ''; });
  var seen = {};
  var duplicates = {};
  values.forEach(function (value) {
    var key = value.toLocaleLowerCase();
    if (seen[key]) duplicates[value] = true;
    seen[key] = true;
  });
  var names = Object.keys(duplicates);
  if (names.length > 0) issues.push('Дубли в списке ' + label + ': ' + names.join(', '));
}

function countInvalidRows_(sheet, checkColumn) {
  var lastRow = Math.max(2, sheet.getLastRow());
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  var checks = sheet.getRange(2, checkColumn, lastRow - 1, 1).getDisplayValues();
  var count = 0;
  for (var index = 0; index < ids.length; index += 1) {
    if (ids[index][0] !== '' && checks[index][0] !== FINANCE_CONFIG.ready) count += 1;
  }
  return count;
}
