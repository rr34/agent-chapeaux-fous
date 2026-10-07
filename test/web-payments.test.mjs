import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");

test("the React workspace exposes Stripe connection status and invoice history", () => {
  assert.match(appSource, /\["payments", "Payments"\], \["ai-usage", "AI Usage"\]/);
  assert.match(appSource, /function PaymentsScreen\(\)/);
  assert.match(appSource, /useApi<\{ stripe: StripeConnectionStatus \}>\("\/api\/payments\/stripe\/status"\)/);
  assert.match(appSource, /api<\{ url: string \}>\("\/api\/payments\/stripe\/oauth\/start", \{ method: "POST" \}\)/);
  assert.match(appSource, /window\.location\.assign\(result\.url\)/);
  assert.match(appSource, /useApi<\{ count: number; invoices: Entity\[\] \}>\("\/api\/payment-invoices\?limit=100"\)/);
  assert.match(appSource, /Due \{formatLocalDate\(textKey\(invoice, "dueOn"\)\)\}/);
  assert.match(appSource, /Open Stripe invoice/);
});
