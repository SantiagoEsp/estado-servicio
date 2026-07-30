export const LIVE_HEALTH_URL = "https://app.sanezeit.com/api/health";

export async function loadLiveHealth(fetchImplementation = fetch) {
  const response = await fetchImplementation(`${LIVE_HEALTH_URL}?v=${Date.now()}`, {
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error("La aplicación no respondió correctamente.");
  }

  const health = await response.json();
  if (health.status !== "operational" || Number.isNaN(Date.parse(health.checkedAt))) {
    throw new Error("La aplicación devolvió un estado inválido.");
  }

  return health;
}

export function applyLiveHealth(statusData, health) {
  return {
    ...statusData,
    overall: "operational",
    checkedAt: health.checkedAt,
    message: "No detectamos problemas en los servicios controlados.",
    components: statusData.components.map((component) => ({
      ...component,
      status: "operational",
    })),
  };
}

export function unavailableLiveStatus(statusData, checkedAt = new Date().toISOString()) {
  return {
    ...statusData,
    overall: "unknown",
    checkedAt,
    message: "La página está disponible, pero no pudimos confirmar la aplicación.",
    components: statusData.components.map((component) => ({
      ...component,
      status: "unknown",
    })),
  };
}
