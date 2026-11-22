#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - A synchronous walk over source files, with no services to compose.

// Upstream merges bring back "T3 Code" wording in text users read. This fails when a source
// file names T3 more often than scripts/gs-wording-baseline.json allows. The baseline holds
// the places where T3 means T3's own project or services; `--write` records the current counts.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const ROOT = process.cwd();
const BASELINE_PATH = NodePath.join(import.meta.dirname, "gs-wording-baseline.json");
const SOURCE_ROOTS = ["apps/web", "apps/server", "apps/desktop", "apps/mobile", "packages"];
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "testkit", "fixtures", "locales"]);
const T3_WORDING =
  /\bT3 (?:Code|Connect|home|threads?|server|environment|service)\b|\b(?:npx t3|t3 (?:pair|serve|start|update|service|app|connect|browser|doctor|up|uninstall|open|auth|config))\b/g;

function isCheckedFile(name: string): boolean {
  return /\.tsx?$/.test(name) && !/\.(?:test|d)\.tsx?$/.test(name);
}

function sourceFiles(directory: string): ReadonlyArray<string> {
  if (!NodeFS.existsSync(directory)) return [];
  return NodeFS.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourceFiles(path);
    }
    return entry.isFile() && isCheckedFile(entry.name) ? [path] : [];
  });
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

function mentions(path: string): ReadonlyArray<{ readonly line: number; readonly text: string }> {
  return NodeFS.readFileSync(path, "utf8")
    .split("\n")
    .flatMap((text, index) =>
      isCommentLine(text)
        ? []
        : Array.from(text.matchAll(T3_WORDING), () => ({ line: index + 1, text: text.trim() })),
    );
}

const found = new Map<string, ReturnType<typeof mentions>>();
for (const sourceRoot of SOURCE_ROOTS) {
  for (const path of sourceFiles(NodePath.join(ROOT, sourceRoot))) {
    if (!path.includes(`${NodePath.sep}src${NodePath.sep}`)) continue;
    const hits = mentions(path);
    if (hits.length > 0)
      found.set(NodePath.relative(ROOT, path).split(NodePath.sep).join("/"), hits);
  }
}

if (process.argv.includes("--write")) {
  const counts = Object.fromEntries(
    Array.from(found, ([path, hits]) => [path, hits.length] as const).sort(([a], [b]) =>
      a < b ? -1 : 1,
    ),
  );
  NodeFS.writeFileSync(BASELINE_PATH, `${JSON.stringify(counts, null, 2)}\n`);
  process.stdout.write(`Recorded ${found.size} files in the Gradespace wording baseline.\n`);
  process.exit(0);
}

// Catalogs are keyed by their English, which the source scan already covers. A translation
// may still name T3 after its English was reworded, so compare each entry with en.json.
const CATALOG_DIRS = ["apps/web", "apps/mobile", "apps/desktop"].map((app) =>
  NodePath.join(ROOT, app, "src/i18n/translations"),
);
const T3_NAME = /T3|`t3 /;
const staleTranslations = CATALOG_DIRS.flatMap((directory) => {
  if (!NodeFS.existsSync(directory)) return [];
  const read = (name: string): Record<string, unknown> =>
    JSON.parse(NodeFS.readFileSync(NodePath.join(directory, name), "utf8"));
  const english = read("en.json");
  return NodeFS.readdirSync(directory)
    .filter((name) => name.endsWith(".json") && name !== "en.json")
    .flatMap((name) =>
      Object.entries(read(name))
        .filter(
          ([key, text]) =>
            T3_NAME.test(JSON.stringify(text)) && !/t3/i.test(JSON.stringify(english[key] ?? "")),
        )
        .map(
          ([key, text]) =>
            `${NodePath.relative(ROOT, directory)}/${name} ${key}: ${JSON.stringify(text).slice(0, 120)}`,
        ),
    );
});

const baseline: Record<string, number> = JSON.parse(NodeFS.readFileSync(BASELINE_PATH, "utf8"));
const over = Array.from(found).filter(([path, hits]) => hits.length > (baseline[path] ?? 0));

if (staleTranslations.length > 0) {
  process.stderr.write(
    `${staleTranslations.join("\n")}\n\nThese translations name T3 where their English names Gradespace. Reword them to match.\n`,
  );
}

if (over.length === 0 && staleTranslations.length === 0) {
  process.stdout.write("Gradespace wording: no new T3 wording.\n");
  process.exit(0);
}

if (over.length === 0) process.exit(1);

const report = over.flatMap(([path, hits]) => [
  `\n${path}: ${hits.length} T3 mentions, ${baseline[path] ?? 0} allowed`,
  ...hits.map((hit) => `  ${hit.line}: ${hit.text.slice(0, 160)}`),
]);
process.stderr.write(
  `${report.join("\n")}\n\nText users read says "Gradespace IDE" or "GS", and the command is \`gs\`. Reword these, or if\nT3 here means T3's own project or services, run \`node scripts/check-gs-wording.ts --write\`.\n`,
);
process.exit(1);
