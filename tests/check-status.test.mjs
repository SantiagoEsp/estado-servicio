import test from "node:test";
import assert from "node:assert/strict";

import {
  checkTarget,
  dayStatusFromCounts,
  hasNetworkAccess,
  overallFromResults,
  updateDailyHistory,
  updateIncidentsDocument,
  updateStatusDocument,
} from "../scripts/check-status.mjs";

const baseStatus = {
  overall: "operational",
  checkedAt: "2026-07-29T20:00:00.000Z",
  message: "Todo bien.",
  components: [
    { id: "public_site", name: "Sitio", description: "", status: "operational" },
    { id: "merchant_panel", name: "Panel", description: "", status: "operational" },
    { id: "catalogs_orders", name: "Pedidos", description: "", status: "operational" },
    { id: "notifications", name: "Avisos", description: "", status: "operational" },
  ],
};

test("clasifica el estado general según los controles", () => {
  assert.equal(
    overallFromResults([
      { id: "public_site", ok: true },
      { id: "merchant_panel", ok: true },
    ]),
    "operational",
  );
  assert.equal(
    overallFromResults([
      { id: "public_site", ok: true },
      { id: "merchant_panel", ok: false },
    ]),
    "partial_outage",
  );
  assert.equal(
    overallFromResults([
      { id: "public_site", ok: false },
      { id: "merchant_panel", ok: false },
    ]),
    "major_outage",
  );
});

test("actualiza componentes sin publicar diagnósticos internos", () => {
  const next = updateStatusDocument(
    baseStatus,
    [
      { id: "public_site", ok: true, httpStatus: 200 },
      { id: "merchant_panel", ok: false, httpStatus: 503 },
    ],
    "2026-07-29T21:00:00.000Z",
  );

  assert.equal(next.overall, "partial_outage");
  assert.equal(next.components[0].status, "operational");
  assert.equal(next.components[1].status, "major_outage");
  assert.equal(next.components[2].status, "partial_outage");
  assert.equal(JSON.stringify(next).includes("503"), false);
});

test("renueva la hora en cada control aunque todo siga operativo", () => {
  const checkedAt = "2026-07-29T20:15:00.000Z";
  const next = updateStatusDocument(
    baseStatus,
    [
      { id: "public_site", ok: true, httpStatus: 200 },
      { id: "merchant_panel", ok: true, httpStatus: 200 },
    ],
    checkedAt,
  );

  assert.equal(next.overall, "operational");
  assert.equal(next.checkedAt, checkedAt);
  assert.notEqual(next.checkedAt, baseStatus.checkedAt);
});

test("abre y resuelve un incidente automático", () => {
  const startedAt = "2026-07-29T21:00:00.000Z";
  const opened = updateIncidentsDocument(
    { incidents: [] },
    "operational",
    "major_outage",
    startedAt,
  );

  assert.equal(opened.incidents.length, 1);
  assert.equal(opened.incidents[0].resolvedAt, null);

  const resolvedAt = "2026-07-29T21:10:00.000Z";
  const resolved = updateIncidentsDocument(
    opened,
    "major_outage",
    "operational",
    resolvedAt,
  );

  assert.equal(resolved.incidents[0].resolvedAt, resolvedAt);
  assert.match(resolved.incidents[0].message, /restablecido/i);
});

test("registra disponibilidad diaria sin inventar días anteriores", () => {
  const history = updateDailyHistory(
    undefined,
    {
      overall: "operational",
      components: baseStatus.components,
    },
    "2026-07-29T23:00:00.000Z",
  );

  assert.equal(history.startedAt, "2026-07-29");
  assert.equal(history.days.length, 1);
  assert.equal(history.days[0].checks, 1);
  assert.equal(history.days[0].failed.public_site, 0);
  assert.equal(history.days[0].overall, "operational");
});

test("acumula los controles del día en lugar de quedarse con el peor", () => {
  const caido = baseStatus.components.map((component) => ({
    ...component,
    status: "major_outage",
  }));
  let history = updateDailyHistory(
    undefined,
    { overall: "major_outage", components: caido },
    "2026-07-29T01:00:00.000Z",
  );

  for (let i = 0; i < 19; i += 1) {
    history = updateDailyHistory(
      history,
      { overall: "operational", components: baseStatus.components },
      `2026-07-29T${String(2 + i).padStart(2, "0")}:00:00.000Z`,
    );
  }

  assert.equal(history.days.length, 1);
  assert.equal(history.days[0].checks, 20);
  assert.equal(history.days[0].failed.public_site, 1);
  // Un control fallido de veinte no puede publicarse como caída total.
  assert.equal(history.days[0].overall, "degraded");
});

test("marca caída total el día en que la mayoría de los controles falla", () => {
  const caido = baseStatus.components.map((component) => ({
    ...component,
    status: "major_outage",
  }));
  let history = updateDailyHistory(
    undefined,
    { overall: "operational", components: baseStatus.components },
    "2026-07-29T01:00:00.000Z",
  );

  for (let i = 0; i < 9; i += 1) {
    history = updateDailyHistory(
      history,
      { overall: "major_outage", components: caido },
      `2026-07-29T${String(2 + i).padStart(2, "0")}:00:00.000Z`,
    );
  }

  assert.equal(history.days[0].checks, 10);
  assert.equal(history.days[0].failed.public_site, 9);
  assert.equal(history.days[0].overall, "major_outage");
});

test("clasifica el día según la proporción de controles fallidos", () => {
  assert.equal(dayStatusFromCounts(30, 0), "operational");
  assert.equal(dayStatusFromCounts(30, 1), "degraded");
  assert.equal(dayStatusFromCounts(30, 12), "partial_outage");
  assert.equal(dayStatusFromCounts(30, 25), "major_outage");
  assert.equal(dayStatusFromCounts(0, 0), "operational");
});

test("no da por buena una caída si el control se quedó sin internet", async () => {
  const sinRed = async () => {
    throw new Error("getaddrinfo EAI_AGAIN");
  };

  assert.equal(await hasNetworkAccess(sinRed), false);
});

test("confirma que hay red cuando responde al menos un destino externo", async () => {
  let llamadas = 0;
  const mitad = async () => {
    llamadas += 1;
    if (llamadas === 1) {
      throw new Error("timeout");
    }
    return { ok: true, status: 200 };
  };

  assert.equal(await hasNetworkAccess(mitad), true);
});

test("anota entre qué controles se detectó el incidente", () => {
  const abierto = updateIncidentsDocument(
    { incidents: [] },
    "operational",
    "major_outage",
    "2026-07-29T04:00:00.000Z",
    "2026-07-29T01:00:00.000Z",
  );

  assert.equal(abierto.incidents[0].lastHealthyAt, "2026-07-29T01:00:00.000Z");
  assert.equal(abierto.incidents[0].startedAt, "2026-07-29T04:00:00.000Z");
});

test("valida código y contenido con un fetch reemplazable", async () => {
  const target = {
    id: "web",
    url: "https://example.test",
    acceptedStatuses: [200],
    expectedText: "<html",
  };
  const result = await checkTarget(target, async () => ({
    status: 200,
    text: async () => "<!doctype html><html></html>",
  }));

  assert.deepEqual(result, { id: "web", ok: true, httpStatus: 200 });
});

