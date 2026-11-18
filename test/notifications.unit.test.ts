import assert from "node:assert/strict";
import { test } from "node:test";
import { cop, uniqueRecipients } from "../src/consumers";

test("uniqueRecipients elimina destinatarios repetidos o vacíos conservando el orden", () => {
  assert.deepEqual(uniqueRecipients(["buyer-1", undefined, "admin-1", "buyer-1", "", "admin-2"]), ["buyer-1", "admin-1", "admin-2"]);
  assert.deepEqual(uniqueRecipients([undefined]), []);
});

test("cop formatea montos en pesos colombianos redondeados", () => {
  assert.equal(cop(1_234_567.6), "1.234.568 COP");
  assert.equal(cop(900), "900 COP");
});
