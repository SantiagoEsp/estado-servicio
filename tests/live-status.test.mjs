import test from "node:test";
import assert from "node:assert/strict";

import {
  applyLiveHealth,
  loadLiveHealth,
  unavailableLiveStatus,
} from "../assets/live-status.js";

const storedStatus = {
  overall: "major_outage",
  checkedAt: "2026-07-30T00:00:00.000Z",
  message: "Sin respuesta.",
  components: [
    { id: "public_site", status: "major_outage" },
    { id: "merchant_panel", status: "major_outage" },
  ],
};

test("usa la hora real del endpoint y renueva el estado visible", async () => {
  const health = await loadLiveHealth(async (url, options) => {
    assert.match(url, /^https:\/\/app\.sanezeit\.com\/api\/health\?v=\d+$/);
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "omit");
    return {
      ok: true,
      async json() {
        return {
          status: "operational",
          checkedAt: "2026-07-30T01:00:00.000Z",
        };
      },
    };
  });
  const currentStatus = applyLiveHealth(storedStatus, health);

  assert.equal(currentStatus.checkedAt, "2026-07-30T01:00:00.000Z");
  assert.equal(currentStatus.overall, "operational");
  assert.ok(currentStatus.components.every((component) => component.status === "operational"));
});

test("rechaza respuestas inválidas del endpoint", async () => {
  await assert.rejects(
    () =>
      loadLiveHealth(async () => ({
        ok: true,
        async json() {
          return { status: "operational", checkedAt: "sin-fecha" };
        },
      })),
    /estado inválido/,
  );
});

test("muestra un intento actual sin declarar operativa una aplicación inaccesible", () => {
  const currentStatus = unavailableLiveStatus(
    storedStatus,
    "2026-07-30T01:01:00.000Z",
  );

  assert.equal(currentStatus.checkedAt, "2026-07-30T01:01:00.000Z");
  assert.equal(currentStatus.overall, "unknown");
  assert.ok(currentStatus.components.every((component) => component.status === "unknown"));
});
