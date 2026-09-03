import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export const repositoryRoot = path.resolve(moduleDirectory, "..");
export const semanticFormFilename = path.join(repositoryRoot, "db", "schema-semantics.json");
export const baselineFilename = path.join(repositoryRoot, "db", "mariadb", "0001-baseline.sql");
