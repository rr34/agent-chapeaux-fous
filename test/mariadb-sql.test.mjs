import assert from "node:assert/strict";
import test from "node:test";
import { countSqlParameters, parseUpdateReturning } from "../src/mariadb-sql.mjs";

test("MariaDB parameter counting ignores quoted question marks", () => {
  assert.equal(countSqlParameters("UPDATE tags SET label = '?' WHERE tag_id = ? AND slug = ?"), 2);
});

test("UPDATE RETURNING parsing separates mutation and predicate parameters", () => {
  const parsed = parseUpdateReturning(`
    UPDATE tags
    SET label = ?, is_active = ?
    WHERE tag_id = ?
    RETURNING *
  `);
  assert.deepEqual(parsed, {
    table: "tags",
    setSql: "label = ?, is_active = ?",
    whereSql: "tag_id = ?",
    returningSql: "*",
    setParameterCount: 2,
  });
});
