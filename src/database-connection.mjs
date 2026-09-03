import { MariaDatabaseSync } from "./mariadb-sync.mjs";

export function openApplicationDatabase(target) {
  if (target?.engine === "mariadb") return new MariaDatabaseSync(target.connection);
  throw new Error("A MariaDB application database target is required");
}
