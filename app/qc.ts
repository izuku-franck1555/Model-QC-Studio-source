export type DataRow = Record<string, unknown>;

export type ParsedDataset = {
  name: string;
  rows: DataRow[];
  columns: string[];
  size?: number;
};

export type TemplateRule = {
  name: string;
  min?: number;
  max?: number;
};

export type VariableDefinition = {
  name: string;
  label?: string;
  description?: string;
  unit?: string;
};

export type ColumnProfile = {
  name: string;
  kind: "numeric" | "text" | "mixed" | "empty";
  count: number;
  missing: number;
  unique: number;
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  outliers: number;
  rangeViolations: number;
  nameValid: boolean;
};

export type TruthMetric = {
  column: string;
  pairs: number;
  mae: number;
  rmse: number;
  bias: number;
};

export type ModelResult = {
  dataset: ParsedDataset;
  expectedRows: number | null;
  rowDifference: number;
  expectedColumns: number | null;
  matchedColumns: number;
  missingColumns: string[];
  unexpectedColumns: string[];
  invalidNames: string[];
  identifierColumns: string[];
  identifierRowsMatched: number;
  identifierRowsMissing: number;
  identifierRowsUnexpected: number;
  identifierRowsDuplicated: number;
  identifierOrderMismatches: number;
  identifierMissingExamples: string[];
  identifierUnexpectedExamples: string[];
  columns: ColumnProfile[];
  truth: TruthMetric[];
  issueCount: number;
  warningCount: number;
  status: "Pass" | "Review";
};

const normalized = (value: string) =>
  value.trim().toLowerCase().replace(/[\s-]+/g, "_");

export const isMissingValue = (value: unknown) => {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return text === "" || ["NA", "N/A", "NAN", "NULL"].includes(text.toUpperCase());
};

const finiteNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || isMissingValue(value)) return null;
  const compact = value.trim().replaceAll(",", "");
  const number = Number(compact);
  return Number.isFinite(number) ? number : null;
};

const percentile = (sorted: number[], ratio: number) => {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * ratio;
  const base = Math.floor(position);
  const remainder = position - base;
  return sorted[base + 1] === undefined
    ? sorted[base]
    : sorted[base] + remainder * (sorted[base + 1] - sorted[base]);
};

export function parseDelimited(text: string, delimiter?: string): DataRow[] {
  text = text.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const detected = ["\t", ",", ";", "|"]
    .map((candidate) => ({ candidate, count: firstLine.split(candidate).length - 1 }))
    .sort((a, b) => b.count - a.count)[0];
  if (!delimiter && detected.count === 0 && firstLine.trim().split(/\s+/).length > 1) {
    const grid = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/));
    const headers = grid[0].map((header, index) => header.trim() || `column_${index + 1}`);
    return grid.slice(1).map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? null])),
    );
  }
  const chosen = delimiter ?? detected.candidate;
  const grid: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === chosen && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) grid.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) grid.push(row);
  if (!grid.length) return [];

  const headers = grid[0].map((header, index) => header.trim() || `column_${index + 1}`);
  return grid.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? null])),
  );
}

function decodeTextFile(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes);
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes);
  }

  const sampleLength = Math.min(bytes.length, 512);
  let evenNulls = 0;
  let oddNulls = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] === 0) {
      if (index % 2 === 0) evenNulls += 1;
      else oddNulls += 1;
    }
  }
  const nullThreshold = Math.max(4, sampleLength * 0.12);
  if (oddNulls > nullThreshold && oddNulls > evenNulls * 2) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (evenNulls > nullThreshold && evenNulls > oddNulls * 2) {
    return new TextDecoder("utf-16be").decode(bytes);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export async function parseFile(file: File): Promise<ParsedDataset> {
  const lower = file.name.toLowerCase();
  let rows: DataRow[];
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
    rows = parseDelimited(decodeTextFile(await file.arrayBuffer()), lower.endsWith(".tsv") ? "\t" : undefined);
  } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json<DataRow>(firstSheet, { defval: null, raw: true });
  } else {
    throw new Error(`${file.name}: unsupported file type`);
  }
  const columns = rows.length ? Object.keys(rows[0]) : [];
  if (!columns.length) throw new Error(`${file.name}: no tabular data found`);
  return { name: file.name, rows, columns, size: file.size };
}

export function templateRules(template: ParsedDataset | null): TemplateRule[] {
  if (!template) return [];
  const lookup = new Map(template.columns.map((name) => [normalized(name), name]));
  const nameKey = ["column", "column_name", "name", "field", "variable"]
    .map((key) => lookup.get(key))
    .find(Boolean);
  if (!nameKey) return template.columns.map((name) => ({ name }));
  const minKey = ["min", "minimum", "min_value", "lower_bound"]
    .map((key) => lookup.get(key))
    .find(Boolean);
  const maxKey = ["max", "maximum", "max_value", "upper_bound"]
    .map((key) => lookup.get(key))
    .find(Boolean);
  const schemaMetadata = new Set([
    "column", "column_name", "name", "field", "variable",
    "description", "definition", "unit", "units", "type",
  ]);
  const isSchemaList = Boolean(nameKey) && template.columns.every((name) =>
    schemaMetadata.has(normalized(name)) || normalized(name).startsWith("column_"),
  );
  if (nameKey && !minKey && !maxKey && !isSchemaList) return template.columns.map((name) => ({ name }));
  return template.rows
    .map((row) => {
      const name = String(row[nameKey] ?? "").trim();
      const min = minKey ? finiteNumber(row[minKey]) : null;
      const max = maxKey ? finiteNumber(row[maxKey]) : null;
      return {
        name,
        ...(min === null ? {} : { min }),
        ...(max === null ? {} : { max }),
      };
    })
    .filter((rule) => rule.name);
}

export function templateExpectedRows(template: ParsedDataset | null): number | null {
  if (!template) return null;
  const templateLookup = new Set(template.columns.map(normalized));
  const hasNameKey = ["column", "column_name", "name", "field", "variable"].some((name) => templateLookup.has(name));
  const hasBounds = ["min", "minimum", "min_value", "lower_bound", "max", "maximum", "max_value", "upper_bound"].some((name) => templateLookup.has(name));
  const schemaMetadata = new Set([
    "column", "column_name", "name", "field", "variable",
    "description", "definition", "unit", "units", "type",
    "min", "minimum", "min_value", "lower_bound",
    "max", "maximum", "max_value", "upper_bound",
  ]);
  const isSchemaList = hasNameKey && template.columns.every((name) =>
    schemaMetadata.has(normalized(name)) || normalized(name).startsWith("column_"),
  );
  return hasBounds || isSchemaList ? null : template.rows.length;
}

export function templateIdentifierColumns(template: ParsedDataset | null): string[] {
  if (!template || templateExpectedRows(template) === null || !template.rows.length) return [];
  return template.columns.filter((column) =>
    template.rows.every((row) => !isMissingValue(row[column])),
  );
}

export function variableDefinitions(dataset: ParsedDataset | null): VariableDefinition[] {
  if (!dataset) return [];
  const lookup = new Map(dataset.columns.map((name) => [normalized(name), name]));
  const findKey = (candidates: string[]) =>
    candidates.map((candidate) => lookup.get(candidate)).find(Boolean);
  const nameKey = findKey([
    "code_display",
    "variable_code",
    "code",
    "template_variable",
    "variable",
    "column",
    "column_name",
    "field",
    "name",
    "variable_name",
  ]);
  if (!nameKey) return [];
  const labelKey = findKey(["variable_name", "label", "variable_label", "display_name"]);
  const descriptionKey = findKey(["definition", "description", "meaning", "notes"]);
  const unitKey = findKey(["unit", "units", "measurement_unit", "scale"]);
  return dataset.rows
    .map((row) => {
      const name = String(row[nameKey] ?? "").trim();
      const label = labelKey ? String(row[labelKey] ?? "").trim() : "";
      const description = descriptionKey ? String(row[descriptionKey] ?? "").trim() : "";
      const unit = unitKey ? String(row[unitKey] ?? "").trim() : "";
      return {
        name,
        ...(label ? { label } : {}),
        ...(description ? { description } : {}),
        ...(unit ? { unit } : {}),
      };
    })
    .filter((definition) => definition.name);
}

function profileColumn(
  dataset: ParsedDataset,
  name: string,
  rule?: TemplateRule,
  forceText = false,
): ColumnProfile {
  const raw = dataset.rows.map((row) => row[name]);
  const present = raw.filter((value) => !isMissingValue(value));
  const numeric = forceText
    ? []
    : present.map(finiteNumber).filter((value): value is number => value !== null);
  const sorted = [...numeric].sort((a, b) => a - b);
  const missing = raw.length - present.length;
  const unique = new Set(present.map((value) => String(value))).size;
  let kind: ColumnProfile["kind"] = "empty";
  if (present.length && forceText) kind = "text";
  else if (present.length && numeric.length === present.length) kind = "numeric";
  else if (present.length && numeric.length === 0) kind = "text";
  else if (present.length) kind = "mixed";

  let outliers = 0;
  if (sorted.length >= 8) {
    const q1 = percentile(sorted, .25);
    const q3 = percentile(sorted, .75);
    const iqr = q3 - q1;
    outliers = iqr === 0 ? 0 : sorted.filter((value) => value < q1 - 3 * iqr || value > q3 + 3 * iqr).length;
  }
  const rangeViolations = rule
    ? numeric.filter((value) => (rule.min !== undefined && value < rule.min) || (rule.max !== undefined && value > rule.max)).length
    : 0;

  return {
    name,
    kind,
    count: raw.length,
    missing,
    unique,
    ...(sorted.length
      ? {
          min: sorted[0],
          max: sorted[sorted.length - 1],
          mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
          median: percentile(sorted, .5),
        }
      : {}),
    outliers,
    rangeViolations,
    nameValid: /^[A-Za-z][A-Za-z0-9_]*$/.test(name),
  };
}

function compareTruth(
  dataset: ParsedDataset,
  groundTruth: ParsedDataset | null,
  identifierColumns: string[],
): TruthMetric[] {
  if (!groundTruth) return [];
  const sharedIdentifierColumns = identifierColumns.length &&
    identifierColumns.every((column) => dataset.columns.includes(column) && groundTruth.columns.includes(column))
    ? identifierColumns
    : [];
  const fallbackKey = ["record_id", "row_id", "observation_id", "case_id", "id", "timestamp", "date"]
    .find((candidate) => dataset.columns.includes(candidate) && groundTruth.columns.includes(candidate));
  const keyColumns = sharedIdentifierColumns.length
    ? sharedIdentifierColumns
    : fallbackKey
      ? [fallbackKey]
      : [];
  const rowKey = (row: DataRow) => keyColumns.map((column) => String(row[column] ?? "").trim()).join(" | ");
  const truthByKey = keyColumns.length
    ? new Map(groundTruth.rows.map((row) => [rowKey(row), row]))
    : null;
  const alignedRows = truthByKey
    ? dataset.rows
        .map((row) => [row, truthByKey.get(rowKey(row))] as const)
        .filter((pair): pair is readonly [DataRow, DataRow] => Boolean(pair[1]))
    : dataset.rows
        .slice(0, groundTruth.rows.length)
        .map((row, index) => [row, groundTruth.rows[index]] as const);
  return dataset.columns
    .filter((column) => !keyColumns.includes(column) && groundTruth.columns.includes(column))
    .map((column) => {
      const differences: number[] = [];
      const signed: number[] = [];
      for (const [modelRow, truthRow] of alignedRows) {
        const predicted = finiteNumber(modelRow[column]);
        const actual = finiteNumber(truthRow[column]);
        if (predicted !== null && actual !== null) {
          differences.push(Math.abs(predicted - actual));
          signed.push(predicted - actual);
        }
      }
      if (!differences.length) return null;
      return {
        column,
        pairs: differences.length,
        mae: differences.reduce((sum, value) => sum + value, 0) / differences.length,
        rmse: Math.sqrt(signed.reduce((sum, value) => sum + value * value, 0) / signed.length),
        bias: signed.reduce((sum, value) => sum + value, 0) / signed.length,
      };
    })
    .filter((metric): metric is TruthMetric => metric !== null);
}

const identifierKey = (row: DataRow, columns: string[]) =>
  columns.map((column) => String(row[column] ?? "").trim()).join(" | ");

function countKeys(keys: string[]) {
  const counts = new Map<string, number>();
  keys.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));
  return counts;
}

function compareIdentifiers(
  dataset: ParsedDataset,
  template: ParsedDataset | null,
  columns: string[],
) {
  if (!template || !columns.length) {
    return {
      matched: 0,
      missing: 0,
      unexpected: 0,
      duplicated: 0,
      orderMismatches: 0,
      missingExamples: [] as string[],
      unexpectedExamples: [] as string[],
    };
  }
  if (columns.some((column) => !dataset.columns.includes(column))) {
    return {
      matched: 0,
      missing: template.rows.length,
      unexpected: 0,
      duplicated: 0,
      orderMismatches: 0,
      missingExamples: template.rows.slice(0, 5).map((row) => identifierKey(row, columns)),
      unexpectedExamples: [] as string[],
    };
  }

  const templateKeys = template.rows.map((row) => identifierKey(row, columns));
  const modelKeys = dataset.rows.map((row) => identifierKey(row, columns));
  const templateCounts = countKeys(templateKeys);
  const modelCounts = countKeys(modelKeys);
  let matched = 0;
  let missing = 0;
  let unexpected = 0;
  let duplicated = 0;
  const missingExamples: string[] = [];
  const unexpectedExamples: string[] = [];

  templateCounts.forEach((expectedCount, key) => {
    const observedCount = modelCounts.get(key) ?? 0;
    matched += Math.min(expectedCount, observedCount);
    if (observedCount < expectedCount) {
      missing += expectedCount - observedCount;
      if (missingExamples.length < 5) missingExamples.push(key);
    }
  });
  modelCounts.forEach((observedCount, key) => {
    const expectedCount = templateCounts.get(key) ?? 0;
    if (observedCount > expectedCount) {
      unexpected += observedCount - expectedCount;
      if (unexpectedExamples.length < 5) unexpectedExamples.push(key);
    }
    if (observedCount > 1) duplicated += observedCount - 1;
  });

  const comparedRows = Math.min(templateKeys.length, modelKeys.length);
  const orderMismatches = missing || unexpected
    ? 0
    : Array.from(
        { length: comparedRows },
        (_, index) => templateKeys[index] !== modelKeys[index],
      ).filter(Boolean).length;

  return {
    matched,
    missing,
    unexpected,
    duplicated,
    orderMismatches,
    missingExamples,
    unexpectedExamples,
  };
}

export function numericValues(dataset: ParsedDataset, column: string): number[] {
  return dataset.rows
    .map((row) => finiteNumber(row[column]))
    .filter((value): value is number => value !== null);
}

export function analyze(
  models: ParsedDataset[],
  template: ParsedDataset | null,
  groundTruth: ParsedDataset | null,
): ModelResult[] {
  const rules = templateRules(template);
  const expected = rules.map((rule) => rule.name);
  const ruleMap = new Map(rules.map((rule) => [rule.name, rule]));
  const expectedRows = templateExpectedRows(template);
  const identifierColumns = templateIdentifierColumns(template);

  return models.map((dataset) => {
    const missingColumns = expected.filter((name) => !dataset.columns.includes(name));
    const unexpectedColumns = expected.length ? dataset.columns.filter((name) => !expected.includes(name)) : [];
    const invalidNames = expected.length
      ? dataset.columns.filter((name) => !expected.includes(name))
      : dataset.columns.filter((name) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(name));
    const columns = dataset.columns.map((name) =>
      profileColumn(dataset, name, ruleMap.get(name), identifierColumns.includes(name)),
    );
    const mixedColumns = columns.filter((column) => column.kind === "mixed").length;
    const missingCells = columns.reduce((sum, column) => sum + column.missing, 0);
    const rowDifference = expectedRows === null ? 0 : dataset.rows.length - expectedRows;
    const identifiers = compareIdentifiers(dataset, template, identifierColumns);
    const identifierIssueCount = [
      identifiers.missing,
      identifiers.unexpected,
      identifiers.duplicated,
      identifiers.orderMismatches,
    ].filter((value) => value > 0).length;
    const issueCount = missingColumns.length + invalidNames.length + mixedColumns + (rowDifference ? 1 : 0) + identifierIssueCount;
    const warningCount = columns.reduce((sum, column) => sum + column.outliers, 0) + (missingCells ? 1 : 0);
    return {
      dataset,
      expectedRows,
      rowDifference,
      expectedColumns: expected.length || null,
      matchedColumns: expected.length ? expected.filter((name) => dataset.columns.includes(name)).length : dataset.columns.length,
      missingColumns,
      unexpectedColumns,
      invalidNames,
      identifierColumns,
      identifierRowsMatched: identifiers.matched,
      identifierRowsMissing: identifiers.missing,
      identifierRowsUnexpected: identifiers.unexpected,
      identifierRowsDuplicated: identifiers.duplicated,
      identifierOrderMismatches: identifiers.orderMismatches,
      identifierMissingExamples: identifiers.missingExamples,
      identifierUnexpectedExamples: identifiers.unexpectedExamples,
      columns,
      truth: compareTruth(dataset, groundTruth, identifierColumns),
      issueCount,
      warningCount,
      status: issueCount ? "Review" : "Pass",
    };
  });
}

export function formatNumber(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if ((absolute >= 100000 || (absolute > 0 && absolute < .001))) return value.toExponential(2);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
}

export function makeSampleData(): {
  models: ParsedDataset[];
  template: ParsedDataset;
  truth: ParsedDataset;
  definitions: ParsedDataset;
} {
  const truthRows = Array.from({ length: 36 }, (_, index) => ({
    record_id: index + 1,
    demand: 74 + Math.sin(index / 3.4) * 18 + index * .42,
    revenue: 940 + Math.cos(index / 4.2) * 120 + index * 8.5,
    churn_risk: Math.max(.04, Math.min(.89, .28 + Math.sin(index / 5) * .18)),
  }));
  const model = (name: string, demandBias: number, noise: number, renamed = false): ParsedDataset => ({
    name,
    rows: truthRows.map((row, index) => ({
      record_id: row.record_id,
      demand: Number((row.demand + demandBias + Math.sin(index * 1.8) * noise).toFixed(3)),
      revenue: Number((row.revenue + demandBias * 9 + Math.cos(index * 1.4) * noise * 7).toFixed(3)),
      [renamed ? "churn probability" : "churn_risk"]: Number((row.churn_risk + demandBias / 100 + Math.sin(index) * noise / 100).toFixed(4)),
    })),
    columns: renamed ? ["record_id", "demand", "revenue", "churn probability"] : ["record_id", "demand", "revenue", "churn_risk"],
  });
  return {
    models: [
      model("Demand_Forecast_v3.csv", .3, 1.4),
      model("Gradient_Boosting.csv", 1.2, 2.3),
      model("Baseline_Model.csv", 2.6, 4.1, true),
    ],
    template: {
      name: "qc_schema_template.csv",
      columns: ["column", "min", "max"],
      rows: [
        { column: "record_id", min: 1, max: 1000000 },
        { column: "demand", min: 0, max: 200 },
        { column: "revenue", min: 0, max: 5000 },
        { column: "churn_risk", min: 0, max: 1 },
      ],
    },
    truth: {
      name: "partial_ground_truth.csv",
      rows: truthRows.slice(0, 24),
      columns: ["record_id", "demand", "revenue", "churn_risk"],
    },
    definitions: {
      name: "variable_definitions.txt",
      columns: ["variable", "definition", "unit"],
      rows: [
        { variable: "record_id", definition: "Unique observation identifier", unit: "ID" },
        { variable: "demand", definition: "Predicted product demand", unit: "units/day" },
        { variable: "revenue", definition: "Predicted gross revenue", unit: "USD" },
        { variable: "churn_risk", definition: "Estimated probability of customer churn", unit: "probability (0–1)" },
      ],
    },
  };
}
