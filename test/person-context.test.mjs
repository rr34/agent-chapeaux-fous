import assert from "node:assert/strict";
import test from "node:test";
import {
  configureDefaultPersonId, currentPersonId, runWithPerson,
} from "../src/person-context.mjs";

test("person context isolates concurrent asynchronous work and retains a legacy default", async () => {
  configureDefaultPersonId(1);
  const observed = await Promise.all([
    runWithPerson(7, async () => { await Promise.resolve(); return currentPersonId(); }),
    runWithPerson(9, async () => { await Promise.resolve(); return currentPersonId(); }),
  ]);
  assert.deepEqual(observed, [7, 9]);
  assert.equal(currentPersonId(), 1);
  assert.throws(() => runWithPerson(0, () => {}), /positive safe integer/);
});
