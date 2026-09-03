import { DatabaseSync } from "node:sqlite";
import { MariaDatabaseSync } from "./mariadb-sync.mjs";

export function openApplicationDatabase(target) {
  if (typeof target === "string") {
    const database = new DatabaseSync(target);
    database.engine = "sqlite";
    return database;
  }
  if (target?.engine === "sqlite") {
    const database = new DatabaseSync(target.filename);
    database.engine = "sqlite";
    return database;
  }
  if (target?.engine === "mariadb") return new MariaDatabaseSync(target.connection);
  throw new Error("Unknown application database target");
}
