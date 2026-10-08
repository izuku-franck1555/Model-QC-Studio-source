"use client";

import { DragEvent, useMemo, useRef, useState } from "react";
import {
  analyze,
  ColumnProfile,
  formatNumber,
  makeSampleData,
  ModelResult,
  numericValues,
  ParsedDataset,
  parseFile,
  templateExpectedRows,
  templateIdentifierColumns,
  templateRules,
  variableDefinitions,
} from "./qc";

type Tab = "workspace" | "compare" | "reports";

const displayName = (filename: string) =>
  filename.replace(/\.(txt|csv|tsv|xlsx|xls)$/i, "").replaceAll("_", " ");

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <i /><i /><i />
    </span>
  );
}

function FileGlyph({ database = false }: { database?: boolean }) {
  return <span className={`file-glyph ${database ? "database" : ""}`} aria-hidden="true">{database ? "●" : "▦"}</span>;
}

function downloadBlob(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

type WritableFile = {
  write: (content: string) => Promise<void>;
  close: () => Promise<void>;
};

type SaveFileHandle = {
  createWritable: () => Promise<WritableFile>;
};

async function saveTextFile(filename: string, content: string) {
  const pickerWindow = window as Window & {
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<SaveFileHandle>;
  };
  if (pickerWindow.showSaveFilePicker) {
    const handle = await pickerWindow.showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: "Text report", accept: { "text/plain": [".txt"] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return "saved";
  }
  downloadBlob(filename, content, "text/plain;charset=utf-8");
  return "downloaded";
}

const reportFilename = (result: ModelResult) => {
  const model = displayName(result.dataset.name)
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "_") || "model";
  return `${model}-quality-check-${new Date().toISOString().slice(0, 10)}.txt`;
};

function feedbackFor(result: ModelResult) {
  const notes: string[] = [];
  if (result.rowDifference < 0) notes.push(`Add ${Math.abs(result.rowDifference)} missing row${Math.abs(result.rowDifference) === 1 ? "" : "s"} to match the template.`);
  if (result.rowDifference > 0) notes.push(`Review ${result.rowDifference} extra row${result.rowDifference === 1 ? "" : "s"} beyond the template.`);
  if (result.missingColumns.length) notes.push(`Add missing columns: ${result.missingColumns.join(", ")}.`);
  if (result.unexpectedColumns.length) notes.push(`Review unexpected columns: ${result.unexpectedColumns.join(", ")}.`);
  if (result.invalidNames.length) notes.push(`Rename non-compliant columns: ${result.invalidNames.join(", ")}.`);
  if (result.identifierRowsMissing) notes.push(`Restore ${result.identifierRowsMissing} template identifier row${result.identifierRowsMissing === 1 ? "" : "s"}.`);
  if (result.identifierRowsUnexpected) notes.push(`Review ${result.identifierRowsUnexpected} identifier row${result.identifierRowsUnexpected === 1 ? "" : "s"} not present in the template.`);
  if (result.identifierRowsDuplicated) notes.push(`Remove ${result.identifierRowsDuplicated} duplicated identifier row${result.identifierRowsDuplicated === 1 ? "" : "s"}.`);
  if (result.identifierOrderMismatches) notes.push(`Realign ${result.identifierOrderMismatches} row${result.identifierOrderMismatches === 1 ? "" : "s"} to the template identifier order.`);
  const mixed = result.columns.filter((column) => column.kind === "mixed");
  if (mixed.length) notes.push(`Normalize mixed data types in: ${mixed.map((column) => column.name).join(", ")}.`);
  return notes;
}

function reportText(
  results: ModelResult[],
  template: ParsedDataset | null,
  truth: ParsedDataset | null,
  definitions: ParsedDataset | null,
) {
  const checkedAt = new Date();
  const divider = "=".repeat(88);
  const sectionDivider = "-".repeat(88);
  const definitionMap = new Map(variableDefinitions(definitions).map((definition) => [definition.name, definition]));
  const templateVariables = templateRules(template).map((rule) => rule.name);
  const matchedDefinitions = templateVariables.filter((name) => definitionMap.has(name));
  const missingDefinitions = templateVariables.filter((name) => !definitionMap.has(name));
  const definitionsOutsideTemplate = [...definitionMap.keys()].filter((name) => templateVariables.length && !templateVariables.includes(name));
  const resultSections = results.map((result, modelIndex) => {
    const feedback = feedbackFor(result);
    const columnRows = result.columns.map((column, index) => {
      const definition = definitionMap.get(column.name);
      const isIdentifier = result.identifierColumns.includes(column.name);
      if (isIdentifier) {
        return [
          `${index + 1}. ${column.name}${definition?.label ? ` — ${definition.label}` : ""}`,
          `   Definition: ${definition?.description ?? "Not provided"}`,
          `   Unit: ${definition?.unit ?? "Not provided"}`,
          "   Role: Identifier",
          "   Type: text",
          `   Count: ${column.count} | Missing: ${column.missing} | Unique: ${column.unique}`,
          "   Statistical analysis: Not applied to identifier columns",
          `   Column name check: ${column.nameValid ? "PASS" : "REVIEW"}`,
        ].join("\n");
      }
      return [
        `${index + 1}. ${column.name}${definition?.label ? ` — ${definition.label}` : ""}`,
        `   Definition: ${definition?.description ?? "Not provided"}`,
        `   Unit: ${definition?.unit ?? "Not provided"}`,
        `   Type: ${column.kind}`,
        `   Count: ${column.count} | Missing: ${column.missing} | Unique: ${column.unique}`,
        `   Observed range: ${formatNumber(column.min)} to ${formatNumber(column.max)}`,
        `   Mean: ${formatNumber(column.mean)} | Median: ${formatNumber(column.median)}`,
        `   Statistical outliers: ${column.outliers}`,
        `   Column name check: ${column.nameValid ? "PASS" : "REVIEW"}`,
      ].join("\n");
    }).join("\n\n");
    const truthRows = result.truth.length
      ? result.truth.map((metric) => [
          `- ${metric.column}`,
          `  Matched values: ${metric.pairs} | MAE: ${formatNumber(metric.mae)} | RMSE: ${formatNumber(metric.rmse)} | Bias: ${formatNumber(metric.bias)}`,
        ].join("\n")).join("\n")
      : "No comparable numeric ground-truth values were available.";
    const feedbackRows = feedback.length
      ? feedback.map((note, index) => `${index + 1}. ${note}`).join("\n")
      : "No corrective feedback is required. This model section contains descriptive statistics and available ground-truth comparisons only.";
    const expectedColumns = result.expectedColumns ?? "No template supplied";
    const identifierResult = !result.identifierColumns.length
      ? "NOT CHECKED"
      : result.identifierRowsMissing || result.identifierRowsUnexpected || result.identifierRowsDuplicated || result.identifierOrderMismatches
        ? "REVIEW"
        : "PASS";

    return [
      divider,
      `MODEL ${modelIndex + 1}`,
      divider,
      `Model name: ${displayName(result.dataset.name)}`,
      `File name: ${result.dataset.name}`,
      `Quality status: ${result.status}`,
      `Rows checked: ${result.dataset.rows.length}`,
      "",
      "ROW COUNT CHECK",
      sectionDivider,
      `Observed row count: ${result.dataset.rows.length}`,
      `Expected row count: ${result.expectedRows ?? "No observation template supplied"}`,
      `Result: ${result.expectedRows === null ? "NOT CHECKED" : result.rowDifference === 0 ? "PASS" : "REVIEW"}`,
      `Difference: ${result.expectedRows === null ? "Not available" : `${result.rowDifference > 0 ? "+" : ""}${result.rowDifference}`}`,
      "",
      "COLUMN STRUCTURE CHECK",
      sectionDivider,
      `Observed column count: ${result.dataset.columns.length}`,
      `Expected column count: ${expectedColumns}`,
      `Matched expected columns: ${result.matchedColumns}`,
      `Missing columns: ${result.missingColumns.length ? result.missingColumns.join(", ") : "None"}`,
      `Unexpected columns: ${result.unexpectedColumns.length ? result.unexpectedColumns.join(", ") : "None"}`,
      "",
      "COLUMN NAMING CHECK",
      sectionDivider,
      `Result: ${result.invalidNames.length ? "REVIEW" : "PASS"}`,
      `Non-compliant or unexpected names: ${result.invalidNames.length ? result.invalidNames.join(", ") : "None"}`,
      "",
      "IDENTIFIER CHECK",
      sectionDivider,
      `Identifier columns detected from template: ${result.identifierColumns.length ? result.identifierColumns.join(", ") : "None"}`,
      `Result: ${identifierResult}`,
      `Matched identifier rows: ${result.identifierRowsMatched}`,
      `Missing template identifier rows: ${result.identifierRowsMissing}`,
      `Unexpected identifier rows: ${result.identifierRowsUnexpected}`,
      `Duplicated identifier rows: ${result.identifierRowsDuplicated}`,
      `Rows outside template order: ${result.identifierOrderMismatches}`,
      `Missing examples: ${result.identifierMissingExamples.length ? result.identifierMissingExamples.join("; ") : "None"}`,
      `Unexpected examples: ${result.identifierUnexpectedExamples.length ? result.identifierUnexpectedExamples.join("; ") : "None"}`,
      "",
      "VALUE DISTRIBUTION CHECK",
      sectionDivider,
      `Statistical outliers identified: ${result.columns.reduce((sum, column) => sum + column.outliers, 0)}`,
      `Columns containing mixed data types: ${result.columns.filter((column) => column.kind === "mixed").map((column) => column.name).join(", ") || "None"}`,
      "",
      "FEEDBACK",
      sectionDivider,
      feedbackRows,
      "",
      "COLUMN PROFILES",
      sectionDivider,
      columnRows,
      "",
      "GROUND-TRUTH COMPARISON",
      sectionDivider,
      truthRows,
    ].join("\n");
  }).join("\n\n");

  return [
    divider,
    "MODEL QUALITY CHECK REPORT",
    divider,
    `Check date: ${checkedAt.toLocaleDateString("en-GB")}`,
    `Check time: ${checkedAt.toLocaleTimeString("en-GB")}`,
    `ISO timestamp: ${checkedAt.toISOString()}`,
    `Schema template file: ${template?.name ?? "Not provided"}`,
    `Ground-truth file: ${truth?.name ?? "Not provided"}`,
    `Variable-definition file: ${definitions?.name ?? "Not provided"}`,
    `Template identifier columns: ${templateIdentifierColumns(template).join(", ") || "None detected"}`,
    `Variable definitions matched to template: ${templateVariables.length ? `${matchedDefinitions.length}/${templateVariables.length}` : "No template supplied"}`,
    `Template variables without definitions: ${missingDefinitions.length ? missingDefinitions.join(", ") : "None"}`,
    `Definition codes outside template: ${definitionsOutsideTemplate.length ? definitionsOutsideTemplate.join(", ") : "None"}`,
    "",
    "REPORT SUMMARY",
    sectionDivider,
    `Models checked: ${results.length}`,
    `Models passed: ${results.filter((result) => result.status === "Pass").length}`,
    `Models requiring review: ${results.filter((result) => result.status === "Review").length}`,
    `Total quality issues: ${results.reduce((sum, result) => sum + result.issueCount, 0)}`,
    `Total statistical warnings: ${results.reduce((sum, result) => sum + result.warningCount, 0)}`,
    "",
    "Ground-truth matching note: records are matched by a shared record key when available; otherwise row order is used. Only non-missing comparable numeric values are included.",
    "",
    resultSections,
    "",
    divider,
    "END OF REPORT",
    divider,
  ].join("\n");
}

function EmptyState({ onSample }: { onSample: () => void }) {
  return (
    <div className="empty-state">
      <span>▤</span>
      <h3>No model results yet</h3>
      <p>Upload one or more files, or use the built-in dataset to explore the complete workflow.</p>
      <button className="secondary" onClick={onSample}>Load sample data</button>
    </div>
  );
}

function RangeLabel({ column }: { column: ColumnProfile }) {
  if (column.min === undefined) return <span className="muted-cell">Not numeric</span>;
  return <span>{formatNumber(column.min)} <i>to</i> {formatNumber(column.max)}</span>;
}

const quantile = (sorted: number[], ratio: number) => {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * ratio;
  const base = Math.floor(position);
  const remainder = position - base;
  return sorted[base + 1] === undefined
    ? sorted[base]
    : sorted[base] + remainder * (sorted[base + 1] - sorted[base]);
};

function DistributionPlot({
  results,
  variable,
  unit,
}: {
  results: ModelResult[];
  variable: string;
  unit?: string;
}) {
  const series = results.map((result, index) => ({
    index,
    name: displayName(result.dataset.name),
    values: numericValues(result.dataset, variable).sort((a, b) => a - b),
  }));
  const combined = series.flatMap((item) => item.values);
  if (!variable || !combined.length) {
    return <div className="distribution-empty">No comparable numeric values are available for this variable.</div>;
  }

  const rawMin = Math.min(...combined);
  const rawMax = Math.max(...combined);
  const padding = rawMin === rawMax ? Math.max(1, Math.abs(rawMin) * .1) : (rawMax - rawMin) * .04;
  const domainMin = rawMin - padding;
  const domainMax = rawMax + padding;
  const plotWidth = 760;
  const inset = 12;
  const scaleX = (value: number) =>
    inset + ((value - domainMin) / (domainMax - domainMin)) * (plotWidth - inset * 2);
  const ticks = Array.from({ length: 5 }, (_, index) => domainMin + (domainMax - domainMin) * index / 4);

  return (
    <div className="distribution-chart">
      <div className="distribution-legend">
        <span><i className="legend-violin" />Distribution density</span>
        <span><i className="legend-box" />Interquartile range</span>
        <span><i className="legend-median" />Median</span>
      </div>
      {series.map((item) => {
        if (!item.values.length) {
          return (
            <div className="distribution-row" key={`${item.name}-${item.index}`}>
              <div className="distribution-label"><strong>{item.name}</strong><span>No numeric values</span></div>
              <div className="distribution-missing">Not available</div>
            </div>
          );
        }
        const mean = item.values.reduce((sum, value) => sum + value, 0) / item.values.length;
        const variance = item.values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, item.values.length - 1);
        const standardDeviation = Math.sqrt(variance);
        const bandwidth = Math.max(
          (domainMax - domainMin) / 80,
          standardDeviation ? 1.06 * standardDeviation * item.values.length ** -.2 : (domainMax - domainMin) / 20,
        );
        const densityPoints = Array.from({ length: 48 }, (_, index) => {
          const value = domainMin + (domainMax - domainMin) * index / 47;
          const density = item.values.reduce((sum, observed) => {
            const z = (value - observed) / bandwidth;
            return sum + Math.exp(-.5 * z * z);
          }, 0) / (item.values.length * bandwidth);
          return { x: scaleX(value), density };
        });
        const maxDensity = Math.max(...densityPoints.map((point) => point.density), Number.EPSILON);
        const top = densityPoints.map((point) => `${point.x},${32 - point.density / maxDensity * 22}`);
        const bottom = [...densityPoints].reverse().map((point) => `${point.x},${32 + point.density / maxDensity * 22}`);
        const q1 = quantile(item.values, .25);
        const median = quantile(item.values, .5);
        const q3 = quantile(item.values, .75);
        const minimum = item.values[0];
        const maximum = item.values[item.values.length - 1];
        const label = `${item.name}: ${item.values.length} values, range ${formatNumber(minimum)} to ${formatNumber(maximum)}, median ${formatNumber(median)}${unit ? ` ${unit}` : ""}.`;

        return (
          <div className="distribution-row" key={`${item.name}-${item.index}`}>
            <div className="distribution-label">
              <strong><i className={`dot dot-${item.index % 3}`} />{item.name}</strong>
              <span>n = {item.values.length} · {formatNumber(minimum)}–{formatNumber(maximum)}</span>
            </div>
            <svg viewBox={`0 0 ${plotWidth} 64`} role="img" aria-label={label} preserveAspectRatio="none">
              <title>{label}</title>
              {ticks.map((tick) => <line className="distribution-gridline" x1={scaleX(tick)} x2={scaleX(tick)} y1="5" y2="59" key={tick} />)}
              <path className={`violin violin-${item.index % 3}`} d={`M ${top.join(" L ")} L ${bottom.join(" L ")} Z`} />
              <line className="box-whisker" x1={scaleX(minimum)} x2={scaleX(maximum)} y1="32" y2="32" />
              <line className="box-cap" x1={scaleX(minimum)} x2={scaleX(minimum)} y1="24" y2="40" />
              <line className="box-cap" x1={scaleX(maximum)} x2={scaleX(maximum)} y1="24" y2="40" />
              <rect className={`box-fill box-${item.index % 3}`} x={scaleX(q1)} y="22" width={Math.max(2, scaleX(q3) - scaleX(q1))} height="20" rx="3" />
              <line className="median-line" x1={scaleX(median)} x2={scaleX(median)} y1="19" y2="45" />
            </svg>
          </div>
        );
      })}
      <div className="distribution-axis">
        <span />
        <div>
          {ticks.map((tick) => <span key={tick} style={{ left: `${(scaleX(tick) / plotWidth) * 100}%` }}>{formatNumber(tick)}</span>)}
        </div>
      </div>
      <p className="distribution-unit">{variable}{unit ? ` · ${unit}` : ""}</p>
    </div>
  );
}

export default function Home() {
  const initial = useMemo(() => makeSampleData(), []);
  const [activeTab, setActiveTab] = useState<Tab>("workspace");
  const [models, setModels] = useState<ParsedDataset[]>(initial.models);
  const [template, setTemplate] = useState<ParsedDataset | null>(initial.template);
  const [truth, setTruth] = useState<ParsedDataset | null>(initial.truth);
  const [definitions, setDefinitions] = useState<ParsedDataset | null>(initial.definitions);
  const [usingSample, setUsingSample] = useState(true);
  const [selectedModel, setSelectedModel] = useState(0);
  const [selectedVariable, setSelectedVariable] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("Sample data is loaded. Replace it with your files when ready.");
  const modelInput = useRef<HTMLInputElement>(null);
  const templateInput = useRef<HTMLInputElement>(null);
  const truthInput = useRef<HTMLInputElement>(null);
  const definitionsInput = useRef<HTMLInputElement>(null);

  const results = useMemo(() => analyze(models, template, truth), [models, template, truth]);
  const issues = results.reduce((sum, result) => sum + result.issueCount, 0);
  const warnings = results.reduce((sum, result) => sum + result.warningCount, 0);
  const passed = results.filter((result) => result.status === "Pass").length;
  const current = results[Math.min(selectedModel, Math.max(0, results.length - 1))];
  const definitionMap = useMemo(
    () => new Map(variableDefinitions(definitions).map((definition) => [definition.name, definition])),
    [definitions],
  );
  const definitionCoverage = useMemo(() => {
    const expected = templateRules(template).map((rule) => rule.name);
    const matched = expected.filter((name) => definitionMap.has(name)).length;
    return { expected: expected.length, matched };
  }, [definitionMap, template]);
  const variables = useMemo(() => {
    const identifiers = new Set(templateIdentifierColumns(template));
    const names = new Set<string>();
    results.forEach((result) => result.columns
      .filter((column) => column.kind === "numeric" && !identifiers.has(column.name))
      .forEach((column) => names.add(column.name)));
    return [...names];
  }, [results, template]);
  const activeVariable = variables.includes(selectedVariable) ? selectedVariable : (variables[0] ?? "");
  const activeUnit = definitionMap.get(activeVariable)?.unit;

  const loadModels = async (files: FileList | File[]) => {
    setIsParsing(true);
    try {
      const parsed = await Promise.all(Array.from(files).map(parseFile));
      const firstNewIndex = usingSample ? 0 : models.length;
      setModels((currentModels) => usingSample ? parsed : [...currentModels, ...parsed]);
      if (usingSample) {
        setTemplate((currentTemplate) => currentTemplate?.name === "qc_schema_template.csv" ? null : currentTemplate);
        setTruth((currentTruth) => currentTruth?.name === "partial_ground_truth.csv" ? null : currentTruth);
        setDefinitions((currentDefinitions) => currentDefinitions?.name === "variable_definitions.txt" ? null : currentDefinitions);
      }
      setUsingSample(false);
      setSelectedModel(firstNewIndex);
      setMessage(`${parsed.length} model file${parsed.length === 1 ? "" : "s"} added. ${firstNewIndex + parsed.length} total models are available for comparison.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to parse the selected files.");
    } finally {
      setIsParsing(false);
      setDragging(false);
      if (modelInput.current) modelInput.current.value = "";
    }
  };

  const loadOptional = async (file: File | undefined, kind: "template" | "truth" | "definitions") => {
    if (!file) return;
    setIsParsing(true);
    try {
      const parsed = await parseFile(file);
      if (kind === "template") setTemplate(parsed);
      else if (kind === "truth") setTruth(parsed);
      else setDefinitions(parsed);
      setMessage(`${file.name} added successfully.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to parse the selected file.");
    } finally {
      setIsParsing(false);
    }
  };

  const loadSample = () => {
    const sample = makeSampleData();
    setModels(sample.models);
    setTemplate(sample.template);
    setTruth(sample.truth);
    setDefinitions(sample.definitions);
    setUsingSample(true);
    setSelectedModel(0);
    setSelectedVariable("demand");
    setMessage("Sample data restored.");
  };

  const clearAll = () => {
    setModels([]);
    setTemplate(null);
    setTruth(null);
    setDefinitions(null);
    setUsingSample(false);
    setSelectedModel(0);
    setMessage("Workspace cleared.");
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files.length) void loadModels(event.dataTransfer.files);
  };

  const downloadReport = async (requested?: ModelResult) => {
    const result = requested ?? current ?? results[0];
    if (!result) return;
    try {
      const outcome = await saveTextFile(
        reportFilename(result),
        reportText([result], template, truth, definitions),
      );
      setMessage(outcome === "saved" ? `${displayName(result.dataset.name)} report saved.` : `${displayName(result.dataset.name)} report downloaded.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessage("Report save cancelled.");
        return;
      }
      setMessage("Unable to save the report.");
    }
  };

  const downloadProfiles = () => {
    const header = ["model", "column", "type", "rows", "missing", "unique", "min", "max", "mean", "median", "outliers"];
    const lines = results.flatMap((result) =>
      result.columns.map((column) => [
        result.dataset.name, column.name, column.kind, column.count, column.missing, column.unique,
        column.min ?? "", column.max ?? "", column.mean ?? "", column.median ?? "", column.outliers,
      ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")),
    );
    downloadBlob("model-qc-column-profiles.csv", [header.join(","), ...lines].join("\n"), "text/csv;charset=utf-8");
    setMessage("Column profiles downloaded.");
  };

  const navigate = (tab: Tab) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate("workspace")} aria-label="Open QC workspace">
          <BrandMark />
          <span>Model QC Studio</span>
        </button>
        <nav className="main-nav" aria-label="Primary navigation">
          <button className={activeTab === "workspace" ? "active" : ""} onClick={() => navigate("workspace")}>QC Workspace</button>
          <button className={activeTab === "compare" ? "active" : ""} onClick={() => navigate("compare")}>Model Compare</button>
          <button className={activeTab === "reports" ? "active" : ""} onClick={() => navigate("reports")}>Reports</button>
        </nav>
        <div className="local-note"><span>✓</span> Processed in this session</div>
      </header>

      <div className="workspace">
        <section className="intro-row">
          <div>
            <p className="eyebrow">{activeTab === "workspace" ? "QUALITY CONTROL WORKSPACE" : activeTab === "compare" ? "INTERACTIVE MODEL ANALYSIS" : "REPORT CENTRE"}</p>
            <h1>{activeTab === "workspace" ? "Trust every model output." : activeTab === "compare" ? "Compare what matters." : "Share a clear decision record."}</h1>
            <p className="lede">
              {activeTab === "workspace"
                ? "Validate schemas, surface value anomalies, and compare model results against partial ground truth — all in one review flow."
                : activeTab === "compare"
                  ? "Explore performance by model and variable, with aligned descriptive statistics and available ground-truth metrics."
                  : "Generate a self-contained quality-control report with findings, feedback, statistics, and model comparisons."}
            </p>
          </div>
          <div className="intro-actions">
            {models.length > 0 && <button className="text-button" onClick={clearAll}>Clear workspace</button>}
            <button className="secondary small" onClick={loadSample}>Load sample data</button>
            <button className="primary small" disabled={!results.length} onClick={() => void downloadReport()}>Save selected report <span>↓</span></button>
          </div>
        </section>

        <div className={`notice ${issues ? "has-issues" : ""}`} role="status">
          <span>{isParsing ? "◌" : issues ? "!" : "✓"}</span>
          <p>{isParsing ? "Reading and profiling your files…" : message}</p>
          {!isParsing && results.length > 0 && <b>{issues ? `${issues} issue${issues === 1 ? "" : "s"} · ${warnings} statistical warning${warnings === 1 ? "" : "s"}` : "All required checks passed"}</b>}
        </div>

        {activeTab === "workspace" && (
          <>
            <section className="top-grid">
              <article className="card upload-card">
                <div className="card-heading">
                  <div><p className="step">01 / INPUTS</p><h2>Add model outputs</h2></div>
                  <span className="file-count">{models.length} file{models.length === 1 ? "" : "s"} ready</span>
                </div>
                <button
                  className={`dropzone ${dragging ? "dragging" : ""}`}
                  onClick={() => modelInput.current?.click()}
                  onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                >
                  <input ref={modelInput} type="file" multiple accept=".txt,.csv,.tsv,.xlsx,.xls,text/plain" onChange={(event) => event.target.files && void loadModels(event.target.files)} />
                  <span className="upload-icon">{isParsing ? "◌" : "↑"}</span>
                  <strong>{dragging ? "Release to add files" : "Drop model result files here"}</strong>
                  <span>or click to browse · TXT, CSV, TSV, XLSX, XLS</span>
                </button>
                <div className="optional-files">
                  <button onClick={() => templateInput.current?.click()}>
                    <input ref={templateInput} hidden type="file" accept=".txt,.csv,.tsv,.xlsx,.xls,text/plain" onChange={(event) => void loadOptional(event.target.files?.[0], "template")} />
                    <FileGlyph />
                    <span><strong>{template?.name ?? "Schema template"}</strong><small>{template ? `${templateRules(template).length} columns${templateExpectedRows(template) !== null ? ` · ${templateExpectedRows(template)} rows` : ""}` : "Optional · expected columns and rows"}</small></span>
                    <b>{template ? "Replace" : "Choose file"}</b>
                  </button>
                  <button onClick={() => truthInput.current?.click()}>
                    <input ref={truthInput} hidden type="file" accept=".txt,.csv,.tsv,.xlsx,.xls,text/plain" onChange={(event) => void loadOptional(event.target.files?.[0], "truth")} />
                    <FileGlyph database />
                    <span><strong>{truth?.name ?? "Ground truth"}</strong><small>{truth ? `${truth.rows.length} partial rows available` : "Optional · partial data supported"}</small></span>
                    <b>{truth ? "Replace" : "Choose file"}</b>
                  </button>
                  <button onClick={() => definitionsInput.current?.click()}>
                    <input ref={definitionsInput} hidden type="file" accept=".txt,.csv,.tsv,.xlsx,.xls,text/plain" onChange={(event) => void loadOptional(event.target.files?.[0], "definitions")} />
                    <FileGlyph />
                    <span><strong>{definitions?.name ?? "Variable definitions"}</strong><small>{definitions ? (definitionCoverage.expected ? `${definitionCoverage.matched}/${definitionCoverage.expected} template variables matched` : `${variableDefinitions(definitions).length} variables documented`) : "Optional · code, name, description, unit"}</small></span>
                    <b>{definitions ? "Replace" : "Choose file"}</b>
                  </button>
                </div>
              </article>

              <article className="card overview-card">
                <div className="card-heading">
                  <div><p className="step">02 / REVIEW</p><h2>Quality overview</h2></div>
                  {!!results.length && <span className={issues ? "review-pill" : "pass-pill"}>{issues ? `${issues} checks need review` : "All checks passed"}</span>}
                </div>
                {!results.length ? <EmptyState onSample={loadSample} /> : (
                  <>
                    <div className="summary-line"><strong>{results.length}</strong><span>model files analyzed</span><small>{truth ? "Ground truth linked" : "No ground truth"}</small></div>
                    <div className="model-list" role="table" aria-label="Quality check results">
                      <div className="model-row model-head" role="row"><span>MODEL</span><span>ROWS</span><span>COLUMNS</span><span>NAMING</span><span>IDENTIFIERS</span><span>STATUS</span></div>
                      {results.map((result, index) => (
                        <button className={`model-row ${selectedModel === index ? "selected" : ""}`} role="row" key={`${result.dataset.name}-${index}`} onClick={() => setSelectedModel(index)}>
                          <span className="model-name"><i>{String.fromCharCode(65 + index)}</i><b>{displayName(result.dataset.name)}</b></span>
                          <span className={result.rowDifference ? "warning" : "ok"}>{result.dataset.rows.length}{result.expectedRows !== null ? ` / ${result.expectedRows}` : ""}</span>
                          <span>{result.dataset.columns.length}{result.expectedColumns ? ` / ${result.expectedColumns}` : ""}</span>
                          <span className={result.invalidNames.length ? "warning" : "ok"}>{result.invalidNames.length ? `${result.invalidNames.length} flags` : "Clear"}</span>
                          <span className={result.identifierRowsMissing || result.identifierRowsUnexpected || result.identifierRowsDuplicated || result.identifierOrderMismatches ? "warning" : "ok"}>
                            {!result.identifierColumns.length
                              ? "Not checked"
                              : result.identifierRowsMissing || result.identifierRowsUnexpected || result.identifierRowsDuplicated || result.identifierOrderMismatches
                                ? "Review"
                                : "Matched"}
                          </span>
                          <span><em className={`status ${result.status === "Pass" ? "ready" : "review"}`}>{result.status}</em></span>
                        </button>
                      ))}
                    </div>
                    <div className="overview-stats">
                      <div><b>{passed} / {results.length}</b><span>Models passed</span></div>
                      <div><b>{results.filter((result) => result.identifierColumns.length && !result.identifierRowsMissing && !result.identifierRowsUnexpected && !result.identifierRowsDuplicated && !result.identifierOrderMismatches).length} / {results.length}</b><span>Identifiers matched</span></div>
                      <div><b>{issues}</b><span>Total issues</span></div>
                    </div>
                  </>
                )}
              </article>
            </section>

            <section className="card comparison-card">
              <div className="comparison-heading">
                <div><p className="step">03 / INSPECT</p><h2>{current ? displayName(current.dataset.name) : "Column profiles"}</h2></div>
                {results.length > 1 && (
                  <div className="model-switcher" aria-label="Choose model">
                    {results.map((result, index) => <button key={`${result.dataset.name}-${index}`} className={selectedModel === index ? "active" : ""} onClick={() => setSelectedModel(index)}>{String.fromCharCode(65 + index)}</button>)}
                  </div>
                )}
                <div className="comparison-actions">
                  <button className="text-button" onClick={() => navigate("compare")}>Open full comparison <span>↗</span></button>
                  <button className="primary small" disabled={!results.length} onClick={() => void downloadReport()}>Save selected report <span>↓</span></button>
                </div>
              </div>
              {!current ? <EmptyState onSample={loadSample} /> : (
                <div className="profile-layout">
                  <div className="status-panel">
                    <span className={`status-mark ${current.status === "Pass" ? "ready" : "review"}`} aria-hidden="true">{current.status === "Pass" ? "✓" : "!"}</span>
                    <div><strong>{current.status === "Pass" ? "Ready to use" : "Review recommended"}</strong><p>{current.issueCount ? `${current.issueCount} structural, identifier, or data-type issue${current.issueCount === 1 ? "" : "s"} found.` : "No structural, identifier, or data-type issues found."}</p></div>
                  </div>
                  <div className="profile-table">
                    <div className="profile-row profile-head"><span>COLUMN</span><span>TYPE / UNIT</span><span>OBSERVED RANGE</span><span>MISSING</span><span>FLAGS</span></div>
                    {current.columns.slice(0, 5).map((column) => (
                      <div className="profile-row" key={column.name}>
                        <span title={definitionMap.get(column.name)?.description}>{definitionMap.get(column.name)?.label ?? column.name}</span><span className="type-chip">{column.kind}{definitionMap.get(column.name)?.unit ? ` · ${definitionMap.get(column.name)?.unit}` : ""}</span><RangeLabel column={column} /><span>{column.missing}</span><span className={column.outliers ? "warning" : "ok"}>{column.outliers || "Clear"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {activeTab === "compare" && (
          <section className="compare-view">
            {!results.length ? <article className="card"><EmptyState onSample={loadSample} /></article> : (
              <>
                <article className="card filter-card">
                  <div><p className="step">VARIABLE VIEW</p><h2>Compare one variable across models</h2></div>
                  <label className="variable-select-label">
                    <span>Variable</span>
                    <select value={activeVariable} onChange={(event) => setSelectedVariable(event.target.value)} disabled={!variables.length}>
                      {!variables.length && <option>No shared numeric variables</option>}
                      {variables.map((variable) => <option key={variable} value={variable}>{definitionMap.get(variable)?.label ?? variable}{definitionMap.get(variable)?.unit ? ` · ${definitionMap.get(variable)?.unit}` : ""}</option>)}
                    </select>
                  </label>
                </article>
                <div className="kpi-grid">
                  <article className="card kpi"><span>MODELS PASSED</span><b>{passed} / {results.length}</b><small>No required review findings</small></article>
                  <article className="card kpi"><span>LOWEST MEAN MAE</span><b>{formatNumber(Math.min(...results.map((result) => result.truth.length ? result.truth.reduce((sum, metric) => sum + metric.mae, 0) / result.truth.length : Infinity)))}</b><small>{truth ? "Against available truth" : "Ground truth required"}</small></article>
                  <article className="card kpi"><span>SHARED VARIABLES</span><b>{results.reduce((shared, result, index) => index === 0 ? result.dataset.columns.length : Math.min(shared, result.dataset.columns.length), 0)}</b><small>Across selected models</small></article>
                  <article className="card kpi"><span>ROWS REVIEWED</span><b>{results.reduce((sum, result) => sum + result.dataset.rows.length, 0)}</b><small>All model outputs</small></article>
                </div>
                <article className="card visual-compare">
                  <div className="section-heading"><div><p className="step">VALUE DISTRIBUTIONS</p><h2>{(definitionMap.get(activeVariable)?.label ?? activeVariable) || "No numeric variable"}</h2></div><span>Violin density + box plot · shared scale</span></div>
                  <DistributionPlot results={results} variable={activeVariable} unit={activeUnit} />
                  <div className="comparison-matrix distribution-matrix">
                    <div className="matrix-row matrix-head"><span>MODEL</span><span>MEAN</span><span>MIN–MAX</span><span>MISSING</span><span>TRUTH MAE</span><span>STATUS</span></div>
                    {results.map((result, index) => {
                      const profile = result.columns.find((column) => column.name === activeVariable);
                      const truthMetric = result.truth.find((metric) => metric.column === activeVariable)?.mae;
                      return (
                        <div className="matrix-row" key={`${result.dataset.name}-${index}`}>
                          <span><i className={`dot dot-${index % 3}`} />{displayName(result.dataset.name)}</span>
                          <strong>{formatNumber(profile?.mean)}</strong>
                          <span>{profile?.min !== undefined ? `${formatNumber(profile.min)}–${formatNumber(profile.max)}` : "Not available"}</span>
                          <span>{profile?.missing ?? result.dataset.rows.length}</span>
                          <strong>{formatNumber(truthMetric)}</strong>
                          <span><em className={`status ${result.status === "Pass" ? "ready" : "review"}`}>{result.status}</em></span>
                        </div>
                      );
                    })}
                  </div>
                </article>
                <article className="card truth-card">
                  <div className="section-heading"><div><p className="step">GROUND TRUTH</p><h2>Available-value comparison</h2></div><span>{truth ? `${truth.rows.length} partial rows loaded` : "No ground truth loaded"}</span></div>
                  <div className="truth-grid">
                    {results.map((result, index) => (
                      <div key={`${result.dataset.name}-${index}`}>
                        <strong>{displayName(result.dataset.name)}</strong>
                        <span>{result.truth.length ? `${result.truth.length} comparable variables` : "No comparable variables"}</span>
                        <b>{result.truth.length ? `${formatNumber(result.truth.reduce((sum, metric) => sum + metric.rmse, 0) / result.truth.length)} mean RMSE` : "—"}</b>
                      </div>
                    ))}
                  </div>
                </article>
              </>
            )}
          </section>
        )}

        {activeTab === "reports" && (
          <section className="reports-view">
            <article className="card report-hero">
              <div>
                <p className="step">DOWNLOADABLE OUTPUT</p>
                <h2>Quality-control report</h2>
                <p>Each model has its own TXT report and filename. Choosing a report opens a save-location dialog when supported by your browser; otherwise it uses the browser&apos;s normal download flow.</p>
                <div className="report-meta"><span>Models <b>{results.length}</b></span><span>Issues <b>{issues}</b></span><span>Template <b>{template ? "Included" : "None"}</b></span><span>Definitions <b>{definitions ? "Included" : "None"}</b></span><span>Ground truth <b>{truth ? "Included" : "None"}</b></span></div>
              </div>
              <div className="report-downloads">
                {results.map((result, index) => (
                  <button className={index === selectedModel ? "primary" : "secondary"} key={`${result.dataset.name}-${index}`} onClick={() => void downloadReport(result)}>
                    <span className="button-icon">↓</span>
                    <span><strong>{displayName(result.dataset.name)}</strong><small>Save model-specific TXT report</small></span>
                  </button>
                ))}
                <button className="secondary" disabled={!results.length} onClick={downloadProfiles}><span className="button-icon">↧</span><span><strong>Export column profiles</strong><small>CSV · analysis-ready</small></span></button>
              </div>
            </article>
            <article className="card findings-card">
              <div className="section-heading"><div><p className="step">FINDINGS</p><h2>Feedback queue</h2></div><span>{issues ? `${issues} issues across ${results.filter((result) => result.issueCount).length} models` : "No feedback required"}</span></div>
              {!results.length ? <EmptyState onSample={loadSample} /> : issues ? (
                <div className="feedback-list">
                  {results.filter((result) => result.issueCount).map((result, index) => (
                    <div className="feedback-item" key={`${result.dataset.name}-${index}`}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div><strong>{displayName(result.dataset.name)}</strong><ul>{feedbackFor(result).map((note) => <li key={note}>{note}</li>)}</ul></div>
                      <em className="status review">{result.issueCount} issues</em>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="all-clear"><span>✓</span><div><strong>No corrective feedback is required.</strong><p>The report will contain descriptive statistics and available ground-truth comparisons only.</p></div></div>
              )}
            </article>
          </section>
        )}
      </div>
    </main>
  );
}
