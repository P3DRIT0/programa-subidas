import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { chromium, Locator, Page } from "playwright";
import { WallapopFormData } from "./shared";

const VINTED_NEW_ITEM_URL = "https://www.vinted.es/items/new";

type StatusCallback = (message: string) => void;
let activeVintedLoginContext: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null;

function getProfileDir() {
  return path.join(app.getPath("userData"), "vinted-profile");
}

function emitStatus(callback: StatusCallback, message: string) {
  callback(message);
}

function logVintedDebug(message: string) {
  const debugLogPath = path.join(process.cwd(), "debug.log");
  fs.appendFileSync(debugLogPath, `${new Date().toISOString()} [vinted] ${message}\n`);
}

async function launchVintedContext() {
  const userDataDir = getProfileDir();
  type PersistentOptions = Parameters<typeof chromium.launchPersistentContext>[1];

  const commonOptions: PersistentOptions = {
    headless: false,
    viewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--start-maximized",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
    ],
  };

  const launchAttempts: PersistentOptions[] = [
    { ...commonOptions, channel: "msedge" },
    { ...commonOptions, channel: "chrome" },
    commonOptions,
  ];

  let lastError: unknown;
  for (const options of launchAttempts) {
    try {
      const context = await chromium.launchPersistentContext(userDataDir, options);
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
        });
      });
      return context;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function ensurePhotoPaths(photoPaths: string[]) {
  for (const photoPath of photoPaths) {
    await fs.promises.access(photoPath, fs.constants.R_OK);
  }
}

async function clickFirstVisible(page: Page, candidates: Array<Locator | string>) {
  for (const candidate of candidates) {
    const locator = typeof candidate === "string" ? page.locator(candidate).first() : candidate;
    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ force: true }).catch(async () => locator.click());
      return;
    }
  }
  throw new Error("No se encontro ningun elemento visible para hacer clic en Vinted.");
}

async function fillField(page: Page, selectors: string[], value: string) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ force: true }).catch(() => undefined);
      await locator.fill("").catch(() => undefined);
      await locator.type(value, { delay: 25 }).catch(async () => locator.fill(value));
      return true;
    }
  }
  return false;
}

async function setInputFiles(page: Page, photoPaths: string[]) {
  logVintedDebug("Iniciando subida de fotos.");
  const dropzone = page.locator("[data-testid='dropzone']").first();
  await dropzone.waitFor({ state: "visible", timeout: 12000 }).catch(() => undefined);
  await page.waitForTimeout(1200);

  const selectors = [
    ".media-select__input-content input[type='file']",
    ".media-select input[type='file']",
    "[data-testid='dropzone'] input[type='file']",
    "[data-testid='media-upload-grid'] ~ .media-select__input input[type='file']",
    "[data-testid='media-select'] input[type='file']",
    "input[type='file'][multiple]",
    "input[type='file'][accept*='image']",
    "input[type='file']",
  ];

  const tryKnownInputs = async () => {
    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count();
      logVintedDebug(`Selector ${selector} encontró ${count} nodos.`);
      for (let index = 0; index < count; index += 1) {
        const item = locator.nth(index);
        try {
          await item.setInputFiles(photoPaths);
          logVintedDebug(`setInputFiles correcto con selector ${selector} índice ${index}.`);
          return true;
        } catch (error) {
          logVintedDebug(`setInputFiles fallo con selector ${selector} índice ${index}: ${String(error)}`);
          continue;
        }
      }
    }
    return false;
  };

  if (await tryKnownInputs()) {
    return;
  }
  logVintedDebug("No hubo inputs útiles antes del click.");

  const uploadTriggers = [
    page.locator("[data-testid='dropzone'] .media-select__input-content button").first(),
    page.locator("[data-testid='dropzone'] .web_ui__Button__label").filter({ hasText: "Subir fotos" }).first(),
    page.locator("[data-testid='dropzone'] button").first(),
    page.locator(".media-select__input-content .web_ui__Button__button").first(),
    page.locator("[data-testid='dropzone']").first(),
    page.locator(".media-select__input-content button").first(),
    page.getByRole("button", { name: /subir fotos/i }).first(),
    page.getByText(/subir fotos|añadir fotos|arrastra/i).first(),
    page.locator("button").filter({ hasText: "Subir fotos" }).first(),
    page.locator(".media-select__input-content").first(),
  ];

  for (const trigger of uploadTriggers) {
    if (await trigger.isVisible().catch(() => false)) {
      const triggerText = await trigger.textContent().catch(() => "");
      logVintedDebug(`Probando trigger visible con texto "${(triggerText ?? "").trim()}".`);
      const chooserPromise = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
      await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
      await trigger.click({ force: true }).catch(async () => {
        await trigger.focus().catch(() => undefined);
        await page.keyboard.press("Enter").catch(() => undefined);
      });
      const chooser = await chooserPromise;
      if (chooser) {
        logVintedDebug("filechooser capturado correctamente.");
        await chooser.setFiles(photoPaths);
        return;
      }

      await page.waitForTimeout(1200);
      logVintedDebug("Sin filechooser tras click; reintentando inputs.");
      if (await tryKnownInputs()) {
        return;
      }
    }
  }

  const triggerCount = await page.locator("[data-testid='dropzone'] button, .media-select__input-content button").count().catch(() => 0);
  logVintedDebug(`Numero de botones encontrados en dropzone/media-select: ${triggerCount}.`);

  const dropped = await page.evaluate(async (fileNames) => {
    const dropzone = document.querySelector("[data-testid='dropzone']") as HTMLElement | null;
    if (!dropzone) {
      return false;
    }

    const dataTransfer = new DataTransfer();
    for (const fileName of fileNames) {
      const file = new File([""], fileName, { type: "image/webp" });
      dataTransfer.items.add(file);
    }

    dropzone.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer }));
    dropzone.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer }));
    dropzone.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer }));
    return true;
  }, photoPaths.map((filePath) => path.basename(filePath))).catch(() => false);

  if (dropped) {
    logVintedDebug("Dropzone detectado, pero sin input real accesible.");
    throw new Error("Vinted detecto la zona de subida, pero necesita el input real de archivos para adjuntar las imagenes.");
  }

  logVintedDebug("No se encontró control de fotos utilizable.");
  throw new Error("No se encontro el control de fotos de Vinted.");
}

async function openDropdownByText(page: Page, label: string) {
  const candidates = [
    page.getByLabel(label, { exact: false }).first(),
    page.locator("label", { hasText: label }).first(),
    page.getByText(label, { exact: false }).first(),
  ];

  for (const locator of candidates) {
    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ force: true }).catch(() => undefined);
      return true;
    }
  }

  return false;
}

async function fillCategorySearch(page: Page, value: string) {
  const searchInput = page.locator("#catalog-search-input, input[name='catalog-search-input']").first();
  await searchInput.waitFor({ state: "visible", timeout: 10000 });
  await searchInput.click({ force: true }).catch(() => undefined);
  await searchInput.fill("").catch(() => undefined);
  await searchInput.type(value, { delay: 40 }).catch(async () => searchInput.fill(value));
  await page.waitForTimeout(900);
}

async function chooseOption(page: Page, value: string) {
  const candidates = [
    page.getByRole("option", { name: new RegExp(value, "i") }).first(),
    page.getByRole("button", { name: new RegExp(value, "i") }).first(),
    page.getByText(value, { exact: true }).first(),
    page.getByText(new RegExp(value, "i")).first(),
  ];

  for (const locator of candidates) {
    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ force: true }).catch(() => undefined);
      return true;
    }
  }

  return false;
}

async function selectVintedCategory(page: Page, categoryRoute: WallapopFormData["category"]) {
  const searchMap: Record<WallapopFormData["category"], { search: string; target: string }> = {
    videojuegos: { search: "juegos", target: "Juegos" },
    consolas: { search: "consolas", target: "Consolas" },
    "accesorios-consolas": { search: "otros accesorios", target: "Otros accesorios" },
  };

  await openDropdownByText(page, "Categoría");
  await page.waitForTimeout(700);
  await fillCategorySearch(page, searchMap[categoryRoute].search);
  const selected = await chooseOption(page, searchMap[categoryRoute].target);
  if (!selected) {
    throw new Error(`No se encontro la categoría "${searchMap[categoryRoute].target}" en Vinted.`);
  }
  await page.waitForTimeout(900);
}

async function selectVintedCondition(page: Page, condition: string) {
  const map: Record<string, string> = {
    "Sin abrir": "Nuevo con etiquetas",
    "En su caja": "Nuevo sin etiquetas",
    "Nuevo": "Nuevo sin etiquetas",
    "Como nuevo": "Muy bueno",
    "En buen estado": "Bueno",
    "En condiciones aceptables": "Satisfactorio",
    "Lo ha dado todo": "Satisfactorio",
  };

  const target = map[condition] ?? "Muy bueno";
  const opened = await openDropdownByText(page, "Estado");
  if (!opened) {
    return;
  }
  await page.waitForTimeout(500);
  await chooseOption(page, target);
}

async function selectVintedPlatform(page: Page, platform: string) {
  if (!platform.trim()) {
    return;
  }

  const opened = await openDropdownByText(page, "Plataforma");
  if (!opened) {
    return;
  }

  await page.waitForTimeout(500);
  const searchInput = page.locator("input[placeholder*='plataforma'], input[placeholder*='Buscar'], input[type='search']").first();
  if (await searchInput.isVisible().catch(() => false)) {
    await searchInput.click({ force: true }).catch(() => undefined);
    await searchInput.fill("").catch(() => undefined);
    await searchInput.type(platform, { delay: 40 }).catch(async () => searchInput.fill(platform));
    await page.waitForTimeout(900);
  }

  const firstOption = page.getByRole("option").first();
  if (await firstOption.isVisible().catch(() => false)) {
    await firstOption.click({ force: true }).catch(() => undefined);
    return;
  }

  await chooseOption(page, platform);
}

async function selectVintedContentRating(page: Page, rating: string) {
  const opened = await openDropdownByText(page, "Clasificación de contenidos");
  if (!opened) {
    return;
  }

  await page.waitForTimeout(500);
  await chooseOption(page, rating);
}

async function fillPrice(page: Page, value: string) {
  const normalized = value.replace(".", ",");
  const selectors = [
    "input[name='price']",
    "input[inputmode='decimal']",
    "input[placeholder*='€']",
  ];

  return fillField(page, selectors, normalized);
}

async function completeVintedFlow(page: Page, data: WallapopFormData, status: StatusCallback) {
  emitStatus(status, "Abriendo Vinted para subir el artículo...");
  await page.goto(VINTED_NEW_ITEM_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  emitStatus(status, "Subiendo fotos en Vinted...");
  await setInputFiles(page, data.photoPaths);
  await page.waitForTimeout(1500);

  emitStatus(status, "Rellenando título en Vinted...");
  await fillField(page, ["input[name='title']", "input[placeholder*='Título']", "input[placeholder*='title']"], data.title || data.summary);

  emitStatus(status, "Rellenando descripción en Vinted...");
  await fillField(page, ["textarea[name='description']", "textarea[placeholder*='Descripción']", "textarea"], data.description);

  emitStatus(status, "Seleccionando categoría en Vinted...");
  await selectVintedCategory(page, data.category);

  if (data.category === "videojuegos") {
    emitStatus(status, "Seleccionando plataforma en Vinted...");
    await selectVintedPlatform(page, data.vintedPlatform);

    emitStatus(status, "Seleccionando clasificación en Vinted...");
    await selectVintedContentRating(page, data.vintedContentRating ?? "PEGI 3");
  }

  emitStatus(status, "Seleccionando estado en Vinted...");
  await selectVintedCondition(page, data.condition);

  emitStatus(status, "Rellenando precio en Vinted...");
  await fillPrice(page, data.price);

  if (data.publish) {
    emitStatus(status, "Intentando publicar en Vinted...");
    await clickFirstVisible(page, [
      page.getByRole("button", { name: /subir|publicar/i }).first(),
      page.getByText(/subir|publicar/i).first(),
    ]);
  } else {
    emitStatus(status, "Formulario de Vinted completado. He dejado la ventana abierta para revisión manual.");
  }
}

export async function openVintedLogin(status: StatusCallback) {
  emitStatus(status, "Abriendo Vinted para iniciar sesión...");
  if (activeVintedLoginContext) {
    const existingPage = activeVintedLoginContext.pages()[0] ?? (await activeVintedLoginContext.newPage());
    await existingPage.bringToFront().catch(() => undefined);
    return { ok: true, message: "La ventana de Vinted ya estaba abierta." };
  }

  const context = await launchVintedContext();
  activeVintedLoginContext = context;
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(VINTED_NEW_ITEM_URL, { waitUntil: "domcontentloaded" });
  await page.bringToFront().catch(() => undefined);
  emitStatus(status, "Inicia sesión manualmente en Vinted y cierra esa ventana cuando termines.");

  context.once("close", () => {
    activeVintedLoginContext = null;
    emitStatus(status, "Sesión de Vinted guardada.");
  });

  return { ok: true, message: "Ventana de login de Vinted abierta." };
}

export async function publishToVinted(data: WallapopFormData, status: StatusCallback) {
  await ensurePhotoPaths(data.photoPaths);

  if (activeVintedLoginContext) {
    await activeVintedLoginContext.close().catch(() => undefined);
    activeVintedLoginContext = null;
  }

  const context = await launchVintedContext();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await completeVintedFlow(page, data, status);
    return {
      ok: true,
      message: data.publish
        ? "Automatización de Vinted terminada. Revisa si el artículo quedó publicado."
        : "Automatización de Vinted completada. Revisa la ventana antes de publicar.",
    };
  } catch (error) {
    emitStatus(status, "He dejado Vinted abierto para que revises el punto exacto del fallo.");
    const message = error instanceof Error ? error.message : "Error desconocido en Vinted.";
    return { ok: false, message };
  }
}
