import fs from "node:fs";
import { assertSemanticForm, compileSchemaProjection } from "schema-semantic-compiler";

export class SchemaSemantics {
  constructor({ filename, ledger }) {
    this.filename = filename;
    this.ledger = ledger;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
    } catch (error) {
      throw new Error(`Cannot load schema semantic form ${filename}: ${error.message}`);
    }
    this.form = assertSemanticForm(parsed);
  }

  compile(operation, context = {}) {
    const product = compileSchemaProjection({ form: this.form, operation });
    if (context.requestId) {
      this.ledger.append({
        type: "schema.semantics.compiled", status: "complete",
        actorType: "service", actorName: "Schema Semantic Compiler",
        turnId: context.requestId, operationId: context.callId,
        name: `Schema semantics for ${operation.name}`,
        payload: product,
      });
    }
    return product;
  }

  health() {
    return {
      ready: true,
      filename: this.filename,
      compiler: this.form.compiler,
      database: this.form.database,
    };
  }
}
