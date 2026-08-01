import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = JSON.parse(await fs.readFile(path.join(root, "reports", "data_quality_report.json"), "utf8"));
const verification = JSON.parse(await fs.readFile(path.join(root, "reports", "verification_report.json"), "utf8"));
const outputDir = path.join(root, "outputs", "data_quality");
const previewDir = path.join(root, "reports", "previews");
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

const wb = Workbook.create();
const summary = wb.worksheets.add("Resumen");
const files = wb.worksheets.add("Archivos");
const outliers = wb.worksheets.add("Outliers");
const integrity = wb.worksheets.add("Integridad");
const rules = wb.worksheets.add("Reglas");

const COLORS = {
  navy: "#16324F",
  teal: "#0F766E",
  mint: "#D1FAE5",
  blue: "#DBEAFE",
  amber: "#FEF3C7",
  red: "#FEE2E2",
  gray: "#F3F4F6",
  white: "#FFFFFF",
  text: "#111827",
  muted: "#6B7280",
};

function title(sheet, range, text) {
  sheet.getRange(range).merge();
  const cell = sheet.getRange(range);
  cell.values = [[text]];
  cell.format = {
    fill: COLORS.navy,
    font: { bold: true, color: COLORS.white, size: 18 },
    verticalAlignment: "center",
  };
  cell.format.rowHeight = 30;
}

function header(range) {
  range.format = {
    fill: COLORS.teal,
    font: { bold: true, color: COLORS.white },
    borders: { preset: "outside", style: "thin", color: "#0B5F59" },
    verticalAlignment: "center",
  };
  range.format.rowHeight = 23;
}

function section(range) {
  range.format = {
    fill: COLORS.blue,
    font: { bold: true, color: COLORS.navy },
    borders: { preset: "outside", style: "thin", color: "#93C5FD" },
  };
}

for (const sheet of [summary, files, outliers, integrity, rules]) {
  sheet.showGridLines = false;
}

// ------------------------------ Archivos (fuente formula-driven del resumen)
title(files, "A1:H1", "Auditoría por archivo");
files.getRange("A3:H3").values = [[
  "Archivo", "Filas raw", "Filas clean", "Duplicados eliminados",
  "Cuarentena", "Vacíos raw", "Vacíos clean", "Columnas clean",
]];
header(files.getRange("A3:H3"));
const fileRows = Object.entries(report.files).map(([name, info]) => {
  const c = info.changes;
  return [
    name,
    c.rows_raw,
    c.rows_clean,
    c.exact_duplicates_removed + c.duplicate_primary_keys_removed,
    c.rows_quarantined,
    c.blanks_raw,
    c.blanks_clean,
    info.clean_profile.column_count,
  ];
});
files.getRange(`A4:H${3 + fileRows.length}`).values = fileRows;
files.getRange(`B4:H${3 + fileRows.length}`).format.numberFormat = "#,##0";
files.getRange(`A3:H${3 + fileRows.length}`).format.borders = {
  insideHorizontal: { style: "thin", color: "#E5E7EB" },
  bottom: { style: "thin", color: "#9CA3AF" },
};
files.freezePanes.freezeRows(3);
files.getRange("A:A").format.columnWidth = 22;
files.getRange("B:H").format.columnWidth = 18;

// --------------------------------------------------------------- Resumen
title(summary, "A1:H2", "Calidad de datos — FreeTicket + Boom");
summary.getRange("A4:H5").values = [
  ["Filas raw", null, "Filas clean", null, "Filas model-ready", null, "Checks aprobados", null],
  [null, null, null, null, null, null, null, null],
];
summary.getRange("A4:H4").format = { fill: COLORS.gray, font: { bold: true, color: COLORS.muted } };
summary.getRange("A5").formulas = [["=SUM('Archivos'!B4:B11)"]];
summary.getRange("C5").formulas = [["=SUM('Archivos'!C4:C11)"]];
summary.getRange("E5").values = [[Object.values(report.model_ready_rows).reduce((a, b) => a + b, 0)]];
summary.getRange("G5").values = [[verification.checks_passed]];
summary.getRange("A5:H5").format = { fill: COLORS.mint, font: { bold: true, color: COLORS.navy, size: 15 } };
summary.getRange("A5:H5").format.numberFormat = "#,##0";

summary.getRange("A7:B7").values = [["Normalización", "Cantidad"]];
header(summary.getRange("A7:B7"));
const fixLabels = {
  names_uppercased: "Textos de nombre a mayúsculas",
  email_uppercase: "Emails con mayúsculas",
  email_plus_alias: "Alias +... removidos",
  email_domain_typo: "Dominios corregidos",
  phone_formatted: "Teléfonos normalizados",
  phone_missing: "Teléfonos faltantes marcados",
  future_used_leak_flagged: "Tickets futuros marcados",
};
const fixRows = Object.entries(fixLabels).map(([key, label]) => [label, report.format_fixes[key] ?? 0]);
summary.getRange(`A8:B${7 + fixRows.length}`).values = fixRows;
summary.getRange(`B8:B${7 + fixRows.length}`).format.numberFormat = "#,##0";
summary.getRange(`A8:B${7 + fixRows.length}`).format.borders = { insideHorizontal: { style: "thin", color: "#E5E7EB" } };

summary.getRange("D7:H7").merge();
summary.getRange("D7:H7").values = [["Fuga temporal detectada"]];
summary.getRange("D7:H7").format = { fill: COLORS.red, font: { bold: true, color: "#991B1B" } };
summary.getRange("D8:E11").values = [
  ["Tickets futuros", report.future_leak.rows],
  ["Usuarios afectados", report.future_leak.users],
  ["Primera fecha futura", report.future_leak.min_date_used],
  ["Última fecha futura", report.future_leak.max_date_used],
];
summary.getRange("D8:D11").format.font = { bold: true, color: COLORS.navy };
summary.getRange("E8:E9").format.numberFormat = "#,##0";
summary.getRange("E10:E11").format.numberFormat = "yyyy-mm-dd hh:mm";
summary.getRange("D8:H11").format.borders = { preset: "outside", style: "thin", color: "#FCA5A5" };

summary.getRange("D13:H14").merge();
summary.getRange("D13:H14").values = [[
  "Decisión: raw intacto; clean marca la fuga; model_ready usa una cohorte madura y retira los objetivos de agosto.",
]];
summary.getRange("D13:H14").format = { fill: COLORS.amber, font: { bold: true, color: "#92400E" }, wrapText: true };

// Chart: vacíos raw vs clean. Source is the auditable Archivos table.
const blanksChart = summary.charts.add("bar", {
  chartType: "bar",
  title: "Vacíos por archivo: antes vs después",
  hasLegend: true,
});
blanksChart.title = "Vacíos por archivo: antes vs después";
blanksChart.hasLegend = true;
blanksChart.setPosition("A18", "H34");
// Discontiguous series are explicit so the chart remains traceable to Archivos.
const rawSeries = blanksChart.series.add("Vacíos raw");
rawSeries.categoryFormula = "'Archivos'!$A$4:$A$11";
rawSeries.formula = "'Archivos'!$F$4:$F$11";
rawSeries.fill = "#F59E0B";
const cleanSeries = blanksChart.series.add("Vacíos clean");
cleanSeries.categoryFormula = "'Archivos'!$A$4:$A$11";
cleanSeries.formula = "'Archivos'!$G$4:$G$11";
cleanSeries.fill = "#0F766E";
blanksChart.xAxis = { axisType: "textAxis", textStyle: { fontSize: 9 } };
blanksChart.yAxis = { numberFormatCode: "#,##0" };

summary.getRange("A:H").format.columnWidth = 17;
summary.getRange("A:A").format.columnWidth = 32;
summary.getRange("D:D").format.columnWidth = 23;
summary.freezePanes.freezeRows(2);

// --------------------------------------------------------------- Outliers
title(outliers, "A1:I1", "Valores atípicos detectados por IQR");
outliers.getRange("A3:I3").values = [["Archivo", "Columna", "Outliers", "Mínimo", "Q1", "Mediana", "Q3", "Máximo", "Decisión"]];
header(outliers.getRange("A3:I3"));
const outlierRows = [];
for (const [file, info] of Object.entries(report.files)) {
  for (const [column, stats] of Object.entries(info.raw_profile.numeric ?? {})) {
    if ((stats.outliers_iqr ?? 0) > 0) {
      outlierRows.push([
        file, column, stats.outliers_iqr, stats.min, stats.q1, stats.median, stats.q3, stats.max,
        "CONSERVADO: extremo válido; solo se eliminan valores imposibles",
      ]);
    }
  }
}
if (outlierRows.length) outliers.getRange(`A4:I${3 + outlierRows.length}`).values = outlierRows;
outliers.getRange(`C4:H${3 + outlierRows.length}`).format.numberFormat = "#,##0.0000";
outliers.getRange(`C4:C${3 + outlierRows.length}`).format.numberFormat = "#,##0";
outliers.getRange(`A3:I${3 + outlierRows.length}`).format.borders = { insideHorizontal: { style: "thin", color: "#E5E7EB" } };
outliers.getRange("A:B").format.columnWidth = 22;
outliers.getRange("C:H").format.columnWidth = 14;
outliers.getRange("I:I").format.columnWidth = 48;
outliers.getRange(`I4:I${3 + outlierRows.length}`).format.wrapText = true;
outliers.freezePanes.freezeRows(3);

// -------------------------------------------------------------- Integridad
title(integrity, "A1:D1", "Integridad, reconciliación y verificación");
integrity.getRange("A3:D3").values = [["Control", "Estado", "Evidencia", "Origen"]];
header(integrity.getRange("A3:D3"));
const integrityRows = verification.checks.map((item) => [
  item.check,
  item.status,
  typeof item.evidence === "object" ? JSON.stringify(item.evidence) : String(item.evidence),
  "scripts/verify_clean_data.py",
]);
integrity.getRange(`A4:D${3 + integrityRows.length}`).values = integrityRows;
integrity.getRange(`B4:B${3 + integrityRows.length}`).conditionalFormats.add("containsText", {
  text: "PASS",
  format: { fill: COLORS.mint, font: { bold: true, color: "#065F46" } },
});
integrity.getRange(`A3:D${3 + integrityRows.length}`).format.borders = { insideHorizontal: { style: "thin", color: "#E5E7EB" } };
integrity.getRange("A:A").format.columnWidth = 52;
integrity.getRange("B:B").format.columnWidth = 12;
integrity.getRange("C:C").format.columnWidth = 50;
integrity.getRange("D:D").format.columnWidth = 30;
integrity.getRange(`A4:D${3 + integrityRows.length}`).format.wrapText = true;
integrity.freezePanes.freezeRows(3);

// ------------------------------------------------------------------ Reglas
title(rules, "A1:D1", "Reglas y decisiones de limpieza");
rules.getRange("A3:D3").values = [["Tema", "Regla", "Acción", "Razón"]];
header(rules.getRange("A3:D3"));
const ruleRows = [
  ["Nombres", "Unicode NFC, espacios compactos, MAYÚSCULAS", "Agregar claves sin tildes y tokens ordenados", "Resolver formato sin inventar identidad"],
  ["Email", "Minúsculas, sin alias +..., dominios conocidos corregidos", "SIN_DATO si no es válido", "Evitar falsos negativos determinísticos"],
  ["Teléfono", "10 dígitos colombianos sin +57 ni separadores", "SIN_DATO si falta/no es válido", "Comparación consistente"],
  ["Letra/dígito incorrecto", "No corregir automáticamente", "Matching probabilístico posterior", "Una corrección arbitraria crea falsos matches"],
  ["Duplicados", "Exactos se eliminan; PK conflictiva va a cuarentena", "No fusionar personas por nombre", "La unicidad se prueba por llave"],
  ["Nulos", "SIN_DATO / NO_APLICA / NO_OBSERVADO", "Separar train julio y score agosto", "No imputar el objetivo desconocido"],
  ["Outliers", "Detectar por IQR", "Conservar si es válido para el negocio", "Aforo, precio o qty alto no es necesariamente error"],
  ["Fuga temporal", "No usar tickets Boom inmaduros", "Corte created_at <= 2026-07-01", "Ventana máxima del generador: 30 días"],
];
rules.getRange(`A4:D${3 + ruleRows.length}`).values = ruleRows;
rules.getRange(`A3:D${3 + ruleRows.length}`).format.borders = { insideHorizontal: { style: "thin", color: "#E5E7EB" } };
rules.getRange("A:A").format.columnWidth = 23;
rules.getRange("B:D").format.columnWidth = 42;
rules.getRange(`A4:D${3 + ruleRows.length}`).format.wrapText = true;
rules.freezePanes.freezeRows(3);

// Compact verification before export.
const inspections = {};
for (const [sheet, range] of [
  ["Resumen", "A1:H34"],
  ["Archivos", "A1:H11"],
  ["Outliers", `A1:I${Math.max(4, 3 + outlierRows.length)}`],
  ["Integridad", `A1:D${3 + integrityRows.length}`],
  ["Reglas", `A1:D${3 + ruleRows.length}`],
]) {
  const result = await wb.inspect({ kind: "table", sheetId: sheet, range, include: "values,formulas", tableMaxRows: 12, tableMaxCols: 10, maxChars: 6000 });
  inspections[sheet] = result.ndjson;
}
const errors = await wb.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 200 },
  summary: "final formula error scan",
});
await fs.writeFile(path.join(outputDir, "audit_inspection.json"), JSON.stringify({ inspections, errors: errors.ndjson }, null, 2));

for (const [sheetName, range] of [
  ["Resumen", "A1:H34"],
  ["Archivos", "A1:H11"],
  ["Outliers", `A1:I${Math.max(4, 3 + outlierRows.length)}`],
  ["Integridad", "A1:D28"],
  ["Reglas", `A1:D${3 + ruleRows.length}`],
]) {
  const image = await wb.render({ sheetName, range, scale: 1.2, format: "png" });
  await fs.writeFile(path.join(previewDir, `${sheetName}.png`), new Uint8Array(await image.arrayBuffer()));
}

const xlsx = await SpreadsheetFile.exportXlsx(wb);
const outputPath = path.join(outputDir, "auditoria_datos.xlsx");
await xlsx.save(outputPath);
console.log(JSON.stringify({ outputPath, sheets: ["Resumen", "Archivos", "Outliers", "Integridad", "Reglas"], formulaErrors: errors.ndjson }, null, 2));
