const STATUS_LABELS = {
  operational: "Operativo",
  degraded: "Rendimiento degradado",
  partial_outage: "Interrupción parcial",
  major_outage: "Interrupción total",
  maintenance: "Mantenimiento",
  unknown: "Sin confirmar",
};

const OVERALL_TITLES = {
  operational: "Todo funciona con normalidad.",
  degraded: "El servicio funciona con demoras.",
  partial_outage: "Hay una interrupción parcial.",
  major_outage: "El servicio está interrumpido.",
  maintenance: "Mantenimiento en curso.",
  unknown: "No pudimos confirmar el estado.",
};

const dateTimeFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function safeStatus(value) {
  return Object.hasOwn(STATUS_LABELS, value) ? value : "unknown";
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Horario sin confirmar" : dateTimeFormatter.format(date);
}

function componentRow(component) {
  const status = safeStatus(component.status);
  const article = document.createElement("article");
  article.className = "service-row";
  article.dataset.status = status;

  const node = document.createElement("span");
  node.className = "service-node";
  node.setAttribute("aria-hidden", "true");

  const copy = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = component.name;
  const description = document.createElement("p");
  description.textContent = component.description;
  copy.append(title, description);

  const label = document.createElement("span");
  label.className = "status-label";
  label.textContent = STATUS_LABELS[status];

  article.append(node, copy, label);
  return article;
}

function incidentRow(incident) {
  const article = document.createElement("article");
  article.className = "incident";
  article.dataset.state = incident.resolvedAt ? "resolved" : "open";

  const marker = document.createElement("span");
  marker.className = "incident-marker";
  marker.setAttribute("aria-hidden", "true");

  const copy = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = incident.title;
  const description = document.createElement("p");
  description.textContent = incident.message;
  copy.append(title, description);

  const time = document.createElement("time");
  time.dateTime = incident.resolvedAt || incident.startedAt;
  time.textContent = incident.resolvedAt
    ? `Resuelto · ${formatDate(incident.resolvedAt)}`
    : `En curso · ${formatDate(incident.startedAt)}`;

  article.append(marker, copy, time);
  return article;
}

function emptyHistory() {
  const article = document.createElement("article");
  article.className = "empty-state";

  const mark = document.createElement("span");
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "✓";

  const message = document.createElement("p");
  message.textContent = "No hubo incidentes informados en los últimos 90 días.";

  article.append(mark, message);
  return article;
}

async function loadJson(path) {
  const response = await fetch(`${path}?v=${Date.now()}`, {
    cache: "no-store",
    credentials: "omit",
  });

  if (!response.ok) {
    throw new Error(`No se pudo cargar ${path}`);
  }

  return response.json();
}

async function render() {
  const componentsContainer = document.querySelector("#components");
  const incidentsContainer = document.querySelector("#incidents");
  const title = document.querySelector("#estado-general");
  const message = document.querySelector("#status-message");
  const lastUpdated = document.querySelector("#last-updated");

  try {
    const [statusData, incidentsData] = await Promise.all([
      loadJson("./data/status.json"),
      loadJson("./data/incidents.json"),
    ]);

    const overall = safeStatus(statusData.overall);
    document.body.dataset.overall = overall;
    title.textContent = OVERALL_TITLES[overall];
    message.textContent = statusData.message;
    lastUpdated.textContent = `Última verificación: ${formatDate(statusData.checkedAt)}`;

    componentsContainer.replaceChildren();
    const line = document.createElement("div");
    line.className = "signal-line";
    line.setAttribute("aria-hidden", "true");
    componentsContainer.append(line, ...statusData.components.map(componentRow));

    incidentsContainer.replaceChildren(
      ...(incidentsData.incidents.length
        ? incidentsData.incidents.map(incidentRow)
        : [emptyHistory()]),
    );
  } catch {
    document.body.dataset.overall = "unknown";
    title.textContent = OVERALL_TITLES.unknown;
    message.textContent =
      "La página está disponible, pero no pudo leer la última verificación. Volvé a intentar en unos minutos.";
    lastUpdated.textContent = "Datos momentáneamente no disponibles";
  }
}

render();

