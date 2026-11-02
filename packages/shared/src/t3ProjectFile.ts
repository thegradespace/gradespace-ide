import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import {
  GS_PROJECT_FILE_NAME,
  PROJECT_FILE_NAMES,
  type ProjectFileName,
  type ProjectReadFileResult,
  T3ProjectFile,
  T3_PROJECT_FILE_SCHEMA_URL,
} from "@t3tools/contracts";

import { fromLenientJson } from "./schemaJson.ts";

export const T3ProjectFileFromJson = fromLenientJson(T3ProjectFile);

const decodeT3ProjectFile = Schema.decodeExit(T3ProjectFileFromJson);

export function isProjectFileName(path: string): path is ProjectFileName {
  return (PROJECT_FILE_NAMES as readonly string[]).includes(path);
}

/** The first present file wins and the two are never merged. With neither present, new files are gs.json. */
export function resolveProjectFileName(
  isPresent: (name: ProjectFileName) => boolean,
): ProjectFileName {
  return PROJECT_FILE_NAMES.find(isPresent) ?? GS_PROJECT_FILE_NAME;
}

/** Picks the read of the file `resolveProjectFileName` chooses; null when neither exists. */
export function pickProjectFileRead(
  reads: Readonly<Record<ProjectFileName, ProjectReadFileResult | null>>,
): ProjectReadFileResult | null {
  const isPresent = (name: ProjectFileName) => {
    const read = reads[name];
    return read !== null && read.exists !== false;
  };
  const read = reads[resolveProjectFileName(isPresent)];
  return read !== null && read.exists !== false ? read : null;
}

export function parseT3ProjectFile(contents: string): T3ProjectFile | null {
  const decoded = decodeT3ProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

export function buildT3ProjectFileJsonSchema(): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(T3ProjectFile, { onExcessProperty: "error" });
  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: T3_PROJECT_FILE_SCHEMA_URL,
    ...document.schema,
  };
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    jsonSchema.$defs = document.definitions;
  }
  return jsonSchema;
}
