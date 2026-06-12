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
  condition: string;
  price: string;
  weight: WallapopWeight;
  photoPaths: string[];
  publish: boolean;
};

type DesktopAppApi = {
  openWallapopLogin: () => Promise<{ ok: boolean; message: string }>;
  openVintedLogin: () => Promise<{ ok: boolean; message: string }>;
  pickImages: () => Promise<string[]>;
  publishWallapop: (data: WallapopPayload) => Promise<{ ok: boolean; message: string }>;
  publishVinted: (data: WallapopPayload) => Promise<{ ok: boolean; message: string }>;
  onStatus: (callback: (message: string) => void) => () => void;
};

const defaultWeight: WallapopWeight = "0 a 1 kg";
const form = document.querySelector<HTMLFormElement>("#wallapop-form");
const pickImagesButton = document.querySelector<HTMLButtonElement>("#pick-images");
const loginButton = document.querySelector<HTMLButtonElement>("#open-login");
const vintedLoginButton = document.querySelector<HTMLButtonElement>("#open-vinted-login");
const runVintedButton = document.querySelector<HTMLButtonElement>("#run-vinted");
const runBothButton = document.querySelector<HTMLButtonElement>("#run-both");
const statusBox = document.querySelector<HTMLElement>("#status-box");
const resultBox = document.querySelector<HTMLElement>("#result-box");
const imageList = document.querySelector<HTMLElement>("#image-list");
const publishCheckbox = document.querySelector<HTMLInputElement>("#publish");

if (
  !form ||
  !pickImagesButton ||
  !loginButton ||
  !vintedLoginButton ||
  !runVintedButton ||
  !runBothButton ||
  !statusBox ||
  !resultBox ||
  !imageList ||
  !publishCheckbox
) {
  throw new Error("No se pudo inicializar la interfaz.");
}

const safeForm = form;
const safeStatusBox = statusBox;
const safeResultBox = resultBox;
const safeImageList = imageList;
const safePublishCheckbox = publishCheckbox;
const photoPaths = new Set<string>();
const desktopBridge = (window as unknown as { desktopApp: DesktopAppApi }).desktopApp;

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

function updateImageList() {
  safeImageList.innerHTML = "";
  for (const photoPath of photoPaths) {
    const item = document.createElement("div");
    item.className = "image-pill";
    item.textContent = photoPath;
    safeImageList.appendChild(item);
  }
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

  if (!photoPaths.size) {
    throw new Error("Debes seleccionar al menos una foto.");
  }

  return {
    summary: readRequiredText(formData, "summary", "Resumen inicial", 3),
    category: String(formData.get("category") ?? "videojuegos").trim() as WallapopPayload["category"],
    preferSuggestedCategory: true,
    vintedPlatform: String(formData.get("vintedPlatform") ?? "").trim(),
    vintedContentRating: String(formData.get("vintedContentRating") ?? "PEGI 3").trim() as WallapopPayload["vintedContentRating"],
    brand: String(formData.get("brand") ?? "").trim(),
    title: String(formData.get("title") ?? "").trim() || readRequiredText(formData, "summary", "Resumen inicial", 3),
    description: readRequiredText(formData, "description", "Descripcion", 10),
    condition: readRequiredText(formData, "condition", "Estado", 2),
    price: readRequiredText(formData, "price", "Precio", 1),
    weight: String(formData.get("weight") ?? defaultWeight).trim() as WallapopWeight,
    photoPaths: Array.from(photoPaths),
    publish: safePublishCheckbox.checked,
  };
}

pickImagesButton.addEventListener("click", async () => {
  try {
    const selectedPaths = await desktopBridge.pickImages();
    for (const selectedPath of selectedPaths) {
      photoPaths.add(selectedPath);
    }
    updateImageList();
    setStatus(`${photoPaths.size} imagen(es) seleccionadas.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron seleccionar las imagenes.";
    setResult(message, "error");
  }
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
    setResult(
      `Wallapop: ${wallapopResult.message}\nVinted: ${vintedResult.message}`,
      vintedResult.ok ? "ok" : "error",
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
