type WallapopWeight =
  | "0 a 1 kg"
  | "1 a 2 kg"
  | "2 a 5 kg"
  | "5 a 10 kg"
  | "10 a 20 kg"
  | "20 a 30 kg";

type WallapopPayload = {
  summary: string;
  category: "consolas" | "accesorios-consolas" | "videojuegos";
  preferSuggestedCategory: boolean;
  vintedPlatform: string;
  vintedContentRating:
    | "AO - Solo adultos"
    | "E - Todos los públicos"
    | "E10+ - Mayores de 10 años"
    | "M - Mayores de 17 años"
    | "PEGI 3"
    | "PEGI 12"
    | "PEGI 16"
    | "PEGI 18";
  brand: string;
  title: string;
  description: string;
  erpDetailsText: string;
  condition: string;
  price: string;
  stockQuantity: string;
  erpRegion:
    | "Sin definir"
    | "NTSC/JP"
    | "NTSC/USA"
    | "PAL/AUS"
    | "PAL/CH"
    | "PAL/DE"
    | "PAL/ES"
    | "PAL/EU"
    | "PAL/FR"
    | "PAL/IT"
    | "PAL/NL"
    | "PAL/PT"
    | "PAL/UK";
  erpWebCondition:
    | "Sin definir"
    | "Completo"
    | "Incompleto"
    | "Sellado"
    | "Solo juego"
    | "Nuevo";
  weight: WallapopWeight;
  photoPaths: string[];
  publish: boolean;
};

type DesktopAppApi = {
  openWallapopLogin: () => Promise<{ ok: boolean; message: string }>;
  openVintedLogin: () => Promise<{ ok: boolean; message: string }>;
  openErpLogin: () => Promise<{ ok: boolean; message: string }>;
  pickImages: () => Promise<string[]>;
  publishWallapop: (data: WallapopPayload) => Promise<{ ok: boolean; message: string }>;
  publishVinted: (data: WallapopPayload) => Promise<{ ok: boolean; message: string }>;
  publishErp: (data: WallapopPayload) => Promise<{ ok: boolean; message: string }>;
  onStatus: (callback: (message: string) => void) => () => void;
};

const defaultWeight: WallapopWeight = "0 a 1 kg";
const form = document.querySelector<HTMLFormElement>("#wallapop-form");
const pickImagesButton = document.querySelector<HTMLButtonElement>("#pick-images");
const loginButton = document.querySelector<HTMLButtonElement>("#open-login");
const vintedLoginButton = document.querySelector<HTMLButtonElement>("#open-vinted-login");
const erpLoginButton = document.querySelector<HTMLButtonElement>("#open-erp-login");
const runVintedButton = document.querySelector<HTMLButtonElement>("#run-vinted");
const runErpButton = document.querySelector<HTMLButtonElement>("#run-erp");
const runBothButton = document.querySelector<HTMLButtonElement>("#run-both");
const statusBox = document.querySelector<HTMLElement>("#status-box");
const resultBox = document.querySelector<HTMLElement>("#result-box");
const imageList = document.querySelector<HTMLElement>("#image-list");
const imageDropzone = document.querySelector<HTMLElement>("#image-dropzone");
const publishCheckbox = document.querySelector<HTMLInputElement>("#publish");

if (
  !form ||
  !pickImagesButton ||
  !loginButton ||
  !vintedLoginButton ||
  !erpLoginButton ||
  !runVintedButton ||
  !runErpButton ||
  !runBothButton ||
  !statusBox ||
  !resultBox ||
  !imageList ||
  !imageDropzone ||
  !publishCheckbox
) {
  throw new Error("No se pudo inicializar la interfaz.");
}

const safeForm = form;
const safeStatusBox = statusBox;
const safeResultBox = resultBox;
const safeImageList = imageList;
const safeImageDropzone = imageDropzone;
const safePublishCheckbox = publishCheckbox;
const photoPaths: string[] = [];
const desktopBridge = (window as unknown as { desktopApp: DesktopAppApi }).desktopApp;
let draggedPhotoPath = "";

if (!desktopBridge) {
  safeStatusBox.textContent = "No se pudo conectar la interfaz con Electron.";
  safeResultBox.textContent = "Fallo interno: window.desktopApp no existe.";
  safeResultBox.dataset.type = "error";
  throw new Error("window.desktopApp no existe en el renderer.");
}

function setStatus(message: string) {
  safeStatusBox.textContent = message;
}

function setResult(message: string, type: "ok" | "error" = "ok") {
  safeResultBox.textContent = message;
  safeResultBox.dataset.type = type;
}

function getFileName(filePath: string) {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

function toFileUrl(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  return encodeURI(`file:///${normalizedPath}`);
}

function syncDropzoneState() {
  safeImageDropzone.dataset.empty = photoPaths.length ? "false" : "true";
}

function addPhotoPaths(paths: string[]) {
  for (const path of paths) {
    if (!path || photoPaths.includes(path)) {
      continue;
    }
    photoPaths.push(path);
  }
  updateImageList();
}

function removePhotoPath(pathToRemove: string) {
  const index = photoPaths.indexOf(pathToRemove);
  if (index < 0) {
    return;
  }
  photoPaths.splice(index, 1);
  updateImageList();
}

function movePhoto(pathToMove: string, targetPath: string) {
  if (!pathToMove || !targetPath || pathToMove === targetPath) {
    return;
  }

  const sourceIndex = photoPaths.indexOf(pathToMove);
  const targetIndex = photoPaths.indexOf(targetPath);
  if (sourceIndex < 0 || targetIndex < 0) {
    return;
  }

  const [moved] = photoPaths.splice(sourceIndex, 1);
  photoPaths.splice(targetIndex, 0, moved);
  updateImageList();
}

function nudgePhoto(pathToMove: string, direction: -1 | 1) {
  const sourceIndex = photoPaths.indexOf(pathToMove);
  if (sourceIndex < 0) {
    return;
  }

  const targetIndex = sourceIndex + direction;
  if (targetIndex < 0 || targetIndex >= photoPaths.length) {
    return;
  }

  const [moved] = photoPaths.splice(sourceIndex, 1);
  photoPaths.splice(targetIndex, 0, moved);
  updateImageList();
}

function updateImageList() {
  safeImageList.innerHTML = "";

  if (!photoPaths.length) {
    safeImageList.innerHTML = '<div class="image-empty">Todavia no has anadido imagenes.</div>';
    syncDropzoneState();
    return;
  }

  photoPaths.forEach((photoPath, index) => {
    const item = document.createElement("article");
    item.className = "image-card";
    item.draggable = true;
    item.dataset.path = photoPath;

    item.addEventListener("dragstart", () => {
      draggedPhotoPath = photoPath;
      item.classList.add("dragging");
    });

    item.addEventListener("dragend", () => {
      draggedPhotoPath = "";
      item.classList.remove("dragging");
    });

    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      item.classList.add("drag-target");
    });

    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-target");
    });

    item.addEventListener("drop", (event) => {
      event.preventDefault();
      item.classList.remove("drag-target");
      movePhoto(draggedPhotoPath, photoPath);
    });

    const badge = document.createElement("span");
    badge.className = "image-index";
    badge.textContent = String(index + 1).padStart(2, "0");

    const body = document.createElement("div");
    body.className = "image-body";

    const preview = document.createElement("img");
    preview.className = "image-preview";
    preview.src = toFileUrl(photoPath);
    preview.alt = getFileName(photoPath);
    preview.loading = "lazy";

    const name = document.createElement("strong");
    name.textContent = getFileName(photoPath);

    const path = document.createElement("span");
    path.textContent = photoPath;

    body.append(preview, badge, name, path);

    const controls = document.createElement("div");
    controls.className = "image-controls";

    const upButton = document.createElement("button");
    upButton.type = "button";
    upButton.className = "image-action";
    upButton.textContent = "Subir";
    upButton.disabled = index === 0;
    upButton.addEventListener("click", () => nudgePhoto(photoPath, -1));

    const downButton = document.createElement("button");
    downButton.type = "button";
    downButton.className = "image-action";
    downButton.textContent = "Bajar";
    downButton.disabled = index === photoPaths.length - 1;
    downButton.addEventListener("click", () => nudgePhoto(photoPath, 1));

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "image-action image-action-danger";
    removeButton.textContent = "Quitar";
    removeButton.addEventListener("click", () => removePhotoPath(photoPath));

    controls.append(upButton, downButton, removeButton);
    item.append(body, controls);
    safeImageList.appendChild(item);
  });

  syncDropzoneState();
}

function readRequiredText(formData: FormData, fieldName: string, label: string, minLength = 1) {
  const value = String(formData.get(fieldName) ?? "").trim();
  if (value.length < minLength) {
    throw new Error(`El campo "${label}" es obligatorio.`);
  }
  return value;
}

function getFormData(): WallapopPayload {
  const formData = new FormData(safeForm);

  if (!photoPaths.length) {
    throw new Error("Debes seleccionar al menos una foto.");
  }

  return {
    summary: readRequiredText(formData, "summary", "Resumen inicial", 3),
    category: String(formData.get("category") ?? "videojuegos").trim() as WallapopPayload["category"],
    preferSuggestedCategory: true,
    vintedPlatform: String(formData.get("vintedPlatform") ?? "").trim() as WallapopPayload["vintedPlatform"],
    vintedContentRating: String(formData.get("vintedContentRating") ?? "PEGI 3").trim() as WallapopPayload["vintedContentRating"],
    brand: String(formData.get("brand") ?? "").trim(),
    title: readRequiredText(formData, "summary", "Resumen inicial", 3),
    description: readRequiredText(formData, "description", "Descripcion", 10),
    erpDetailsText: readRequiredText(formData, "erpDetailsText", "Detalles ERP", 3),
    condition: readRequiredText(formData, "condition", "Estado", 2),
    price: readRequiredText(formData, "price", "Precio", 1),
    stockQuantity: readRequiredText(formData, "stockQuantity", "Cantidad en stock", 1),
    erpRegion: String(formData.get("erpRegion") ?? "Sin definir").trim() as WallapopPayload["erpRegion"],
    erpWebCondition: String(formData.get("erpWebCondition") ?? "Sin definir").trim() as WallapopPayload["erpWebCondition"],
    weight: String(formData.get("weight") ?? defaultWeight).trim() as WallapopWeight,
    photoPaths: [...photoPaths],
    publish: safePublishCheckbox.checked,
  };
}

pickImagesButton.addEventListener("click", async () => {
  try {
    const selectedPaths = await desktopBridge.pickImages();
    addPhotoPaths(selectedPaths);
    setStatus(`${photoPaths.length} imagen(es) seleccionadas.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron seleccionar las imagenes.";
    setResult(message, "error");
  }
});

safeImageDropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  safeImageDropzone.classList.add("is-active");
});

safeImageDropzone.addEventListener("dragleave", () => {
  safeImageDropzone.classList.remove("is-active");
});

safeImageDropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  safeImageDropzone.classList.remove("is-active");
  const droppedFiles = Array.from(event.dataTransfer?.files ?? [])
    .map((file) => {
      const fileWithPath = file as File & { path?: string };
      return fileWithPath.path ?? "";
    })
    .filter(Boolean);

  addPhotoPaths(droppedFiles);
  setStatus(`${photoPaths.length} imagen(es) listas para subir.`);
});

loginButton.addEventListener("click", async () => {
  setResult("", "ok");
  setStatus("Abriendo el navegador para iniciar sesion...");
  try {
    const result = await desktopBridge.openWallapopLogin();
    setResult(result.message, result.ok ? "ok" : "error");
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo abrir Wallapop para el login.";
    setResult(message, "error");
    setStatus("Fallo al abrir el navegador para login.");
  }
});

vintedLoginButton.addEventListener("click", async () => {
  setResult("", "ok");
  setStatus("Abriendo el navegador para iniciar sesion en Vinted...");
  try {
    const result = await desktopBridge.openVintedLogin();
    setResult(result.message, result.ok ? "ok" : "error");
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo abrir Vinted para el login.";
    setResult(message, "error");
    setStatus("Fallo al abrir el navegador para login en Vinted.");
  }
});

erpLoginButton.addEventListener("click", async () => {
  setResult("", "ok");
  setStatus("Abriendo el navegador para iniciar sesion en ERP...");
  try {
    const result = await desktopBridge.openErpLogin();
    setResult(result.message, result.ok ? "ok" : "error");
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo abrir ERP para el login.";
    setResult(message, "error");
    setStatus("Fallo al abrir el navegador para login en ERP.");
  }
});

safeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setResult("", "ok");

  try {
    const data = getFormData();
    setStatus("Lanzando automatizacion...");
    const result = await desktopBridge.publishWallapop(data);
    setResult(result.message, result.ok ? "ok" : "error");
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo validar el formulario.";
    setResult(message, "error");
  }
});

runVintedButton.addEventListener("click", async () => {
  setResult("", "ok");
  try {
    const data = getFormData();
    setStatus("Lanzando automatizacion de Vinted...");
    const result = await desktopBridge.publishVinted(data);
    setResult(result.message, result.ok ? "ok" : "error");
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo validar el formulario.";
    setResult(message, "error");
  }
});

runErpButton.addEventListener("click", async () => {
  setResult("", "ok");
  try {
    const data = getFormData();
    setStatus("Lanzando automatizacion de ERP...");
    const result = await desktopBridge.publishErp(data);
    setResult(result.message, result.ok ? "ok" : "error");
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo validar el formulario.";
    setResult(message, "error");
  }
});

runBothButton.addEventListener("click", async () => {
  setResult("", "ok");
  try {
    const data = getFormData();
    setStatus("Lanzando Wallapop...");
    const wallapopResult = await desktopBridge.publishWallapop(data);
    if (!wallapopResult.ok) {
      setResult(`Wallapop: ${wallapopResult.message}`, "error");
      return;
    }

    setStatus("Lanzando Vinted...");
    const vintedResult = await desktopBridge.publishVinted(data);
    setStatus("Lanzando ERP...");
    const erpResult = await desktopBridge.publishErp(data);
    setResult(
      `Wallapop: ${wallapopResult.message}\nVinted: ${vintedResult.message}\nERP: ${erpResult.message}`,
      wallapopResult.ok && vintedResult.ok && erpResult.ok ? "ok" : "error",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo validar el formulario.";
    setResult(message, "error");
  }
});

desktopBridge.onStatus((message: string) => {
  setStatus(message);
});

setStatus("Prepara los datos del producto y lanza la automatizacion.");
updateImageList();
