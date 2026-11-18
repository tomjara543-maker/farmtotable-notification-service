import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { as, request, Running, startApp } from "./helpers";

let api: Running;

before(async () => {
  const { createApp } = await import("../src/app");
  api = await startApp(createApp());
});

after(() => api.close());

test("solo acepta identidades reenviadas por el gateway con el token interno", async () => {
  process.env.INTERNAL_TOKEN = "token-interno";
  try {
    const anonymous = await request(api.url, "/notifications/unread-count");
    assert.equal(anonymous.status, 401);

    const spoofed = await request(api.url, "/notifications/unread-count", {
      headers: { ...as("buyer-1", "BUYER"), "x-internal-token": "adivinado" },
    });
    assert.equal(spoofed.status, 401);
    assert.equal(spoofed.body.error, "Debes iniciar sesión");
  } finally {
    delete process.env.INTERNAL_TOKEN;
  }
});

test("si la base de datos no responde devuelve un 500 genérico sin filtrar detalles internos", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const res = await request(api.url, "/notifications/mine", { headers: as("buyer-1", "BUYER") });

    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: "Error interno del servidor" });
  } finally {
    console.error = originalError;
  }
});
