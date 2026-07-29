import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const STATUS_PATH = new URL("../data/status.json", import.meta.url);
const INCIDENTS_PATH = new URL("../data/incidents.json", import.meta.url);
const MAX_HISTORY_DAYS = 90;
const REFRESH_AFTER_MINUTES = 55;
const STATUS_SEVERITY = {
  unknown: -1,
  operational: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
};

export const TARGETS = [
  {
    id: "public_site",
    url: "https://app.sanezeit.com/",
    acceptedStatuses: [200],
    expectedText: "<html",
  },
  {
    id: "merchant_panel",
    url: "https://app.sanezeit.com/login",
    acceptedStatuses: [200],
    expectedText: "<html",
  },
];

const STATUS_MESSAGES = {
  operational: "No detectamos problemas en los servicios controlados.",
  partial_outage: "Detectamos problemas en una parte del servicio.",
  major_outage: "La plataforma no está respondiendo correctamente.",
};

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function checkTarget(target, fetchImplementation = fetch) {
  let lastResult = { ok: false, httpStatus: null };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchImplementation(target.url, {
        headers: {
          "User-Agent": "EstadoServicio/1.0 (+https://estado.sanezeit.com)",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.text();
      const accepted = target.acceptedStatuses.includes(response.status);
      const contentMatches = body.toLowerCase().includes(target.expectedText.toLowerCase());
      lastResult = {
        ok: accepted && contentMatches,
        httpStatus: response.status,
      };
    } catch {
      lastResult = { ok: false, httpStatus: null };
    }

    if (lastResult.ok || attempt === 3) {
      break;
    }

    await delay(5_000);
  }

  return { id: target.id, ...lastResult };
}

export function overallFromResults(results) {
  const healthyCount = results.filter((result) => result.ok).length;

  if (healthyCount === results.length) {
    return "operational";
  }

  return healthyCount === 0 ? "major_outage" : "partial_outage";
}

function componentStatus(componentId, results, overall) {
  const directResult = results.find((result) => result.id === componentId);

  if (directResult) {
    return directResult.ok ? "operational" : "major_outage";
  }

  if (componentId === "catalogs_orders") {
    return overall;
  }

  if (componentId === "notifications" && overall === "major_outage") {
    return "major_outage";
  }

  return "operational";
}

export function updateStatusDocument(currentStatus, results, checkedAt) {
  const overall = overallFromResults(results);

  const nextStatus = {
    ...currentStatus,
    overall,
    checkedAt,
    message: STATUS_MESSAGES[overall],
    components: currentStatus.components.map((component) => ({
      ...component,
      status: componentStatus(component.id, results, overall),
    })),
  };

  return {
    ...nextStatus,
    history: updateDailyHistory(currentStatus.history, nextStatus, checkedAt),
  };
}

function worseStatus(first, second) {
  return STATUS_SEVERITY[first] >= STATUS_SEVERITY[second] ? first : second;
}

export function updateDailyHistory(currentHistory, nextStatus, checkedAt) {
  const date = checkedAt.slice(0, 10);
  const history = currentHistory ?? { startedAt: date, days: [] };
  const components = Object.fromEntries(
    nextStatus.components.map((component) => [component.id, component.status]),
  );
  const nextDay = {
    date,
    overall: nextStatus.overall,
    components,
  };
  const existingIndex = history.days.findIndex((day) => day.date === date);
  const days = [...history.days];

  if (existingIndex === -1) {
    days.push(nextDay);
  } else {
    const existing = days[existingIndex];
    days[existingIndex] = {
      date,
      overall: worseStatus(existing.overall, nextDay.overall),
      components: Object.fromEntries(
        Object.entries(nextDay.components).map(([id, status]) => [
          id,
          worseStatus(existing.components?.[id] ?? "unknown", status),
        ]),
      ),
    };
  }

  return {
    startedAt: history.startedAt ?? date,
    days: days
      .filter((day) => Date.parse(`${day.date}T00:00:00Z`) >= Date.parse(checkedAt) - 89 * 86400000)
      .sort((first, second) => first.date.localeCompare(second.date)),
  };
}

function incidentTitle(status) {
  return status === "major_outage"
    ? "Interrupción del servicio"
    : "Interrupción parcial del servicio";
}

export function updateIncidentsDocument(currentIncidents, previousOverall, nextOverall, now) {
  const incidents = [...currentIncidents.incidents];
  const openIncidentIndex = incidents.findIndex((incident) => !incident.resolvedAt);
  const wasHealthy = previousOverall === "operational";
  const isHealthy = nextOverall === "operational";

  if (wasHealthy && !isHealthy && openIncidentIndex === -1) {
    incidents.unshift({
      id: `automatic-${now.replaceAll(/[^0-9]/g, "").slice(0, 14)}`,
      title: incidentTitle(nextOverall),
      message: STATUS_MESSAGES[nextOverall],
      startedAt: now,
      resolvedAt: null,
    });
  } else if (!wasHealthy && !isHealthy && openIncidentIndex !== -1) {
    incidents[openIncidentIndex] = {
      ...incidents[openIncidentIndex],
      title: incidentTitle(nextOverall),
      message: STATUS_MESSAGES[nextOverall],
    };
  } else if (!wasHealthy && isHealthy && openIncidentIndex !== -1) {
    incidents[openIncidentIndex] = {
      ...incidents[openIncidentIndex],
      message: "El funcionamiento normal fue restablecido.",
      resolvedAt: now,
    };
  }

  const cutoff = Date.parse(now) - MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000;
  return {
    incidents: incidents.filter((incident) => Date.parse(incident.startedAt) >= cutoff),
  };
}

export function shouldPersist(previousStatus, nextStatus, now) {
  if (previousStatus.overall !== nextStatus.overall) {
    return true;
  }

  return Date.parse(now) - Date.parse(previousStatus.checkedAt) >= REFRESH_AFTER_MINUTES * 60 * 1000;
}

async function main() {
  const [statusRaw, incidentsRaw] = await Promise.all([
    readFile(STATUS_PATH, "utf8"),
    readFile(INCIDENTS_PATH, "utf8"),
  ]);
  const currentStatus = JSON.parse(statusRaw);
  const currentIncidents = JSON.parse(incidentsRaw);
  const checkedAt = new Date().toISOString();
  const results = await Promise.all(TARGETS.map((target) => checkTarget(target)));
  const nextStatus = updateStatusDocument(currentStatus, results, checkedAt);
  const nextIncidents = updateIncidentsDocument(
    currentIncidents,
    currentStatus.overall,
    nextStatus.overall,
    checkedAt,
  );

  if (shouldPersist(currentStatus, nextStatus, checkedAt)) {
    await Promise.all([
      writeFile(STATUS_PATH, `${JSON.stringify(nextStatus, null, 2)}\n`, "utf8"),
      writeFile(INCIDENTS_PATH, `${JSON.stringify(nextIncidents, null, 2)}\n`, "utf8"),
    ]);
  }

  process.stdout.write(
    `${JSON.stringify({
      overall: nextStatus.overall,
      checkedAt,
      persisted: shouldPersist(currentStatus, nextStatus, checkedAt),
      results,
    })}\n`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  await main();
}

