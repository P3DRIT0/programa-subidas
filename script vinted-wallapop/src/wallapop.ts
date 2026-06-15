import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  chromium,
  Locator,
  Page,
} from "playwright";
import { WallapopFormData } from "./shared";

const WALLAPOP_UPLOAD_URL = "https://es.wallapop.com/app/catalog/upload";

type StatusCallback = (message: string) => void;
let activeLoginContext: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null;

function getProfileDir() {
  return path.join(app.getPath("userData"), "wallapop-profile");
}

function emitStatus(callback: StatusCallback, message: string) {
  callback(message);
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

async function launchWallapopContext() {
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

        Object.defineProperty(navigator, "languages", {
          get: () => ["es-ES", "es", "en"],
        });

        Object.defineProperty(navigator, "plugins", {
          get: () => [1, 2, 3, 4, 5],
        });
      });
      return context;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function registerContextCleanup(
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>,
) {
  context.once("close", () => {
    if (activeLoginContext === context) {
      activeLoginContext = null;
    }
  });
}

async function getOrCreateWallapopContext() {
  if (activeLoginContext) {
    return activeLoginContext;
  }

  const context = await launchWallapopContext();
  activeLoginContext = context;
  registerContextCleanup(context);
  return context;
}

async function getPrimaryPage(
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>,
) {
  const pages = context.pages();
  const primaryPage = pages[0] ?? (await context.newPage());

  for (const extraPage of pages.slice(1)) {
    await extraPage.close().catch(() => undefined);
  }

  return primaryPage;
}

async function ensurePhotoPaths(photoPaths: string[]) {
  for (const photoPath of photoPaths) {
    await fs.promises.access(photoPath, fs.constants.R_OK);
  }
}

async function waitForAny(page: Page, selectors: string[], timeout = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) {
        return locator;
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`No se encontro ninguno de los selectores esperados: ${selectors.join(", ")}`);
}

async function clickByVisibleText(page: Page, text: string, exact = true) {
  const roleLocator = page.getByText(text, { exact }).first();
  if (await roleLocator.isVisible().catch(() => false)) {
    await roleLocator.click();
    return;
  }

  const locator = page.locator(`text=${JSON.stringify(text)}`).first();
  await locator.click();
}

async function fillFieldByLabel(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: false }).first();
  if (await input.count()) {
    await input.fill(value);
    return;
  }

  const labelLocator = page.locator("label", { hasText: label }).first();
  if (await labelLocator.count()) {
    const fieldId = await labelLocator.getAttribute("for");
    if (fieldId) {
      await page.locator(`#${fieldId}`).fill(value);
      return;
    }
  }

  throw new Error(`No se encontro el campo con etiqueta "${label}".`);
}

async function fillFieldByLabelIfVisible(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: false }).first();
  if (await input.isVisible().catch(() => false)) {
    await input.fill(value);
    return true;
  }

  const labelLocator = page.locator("label", { hasText: label }).first();
  if (await labelLocator.isVisible().catch(() => false)) {
    const fieldId = await labelLocator.getAttribute("for");
    if (fieldId) {
      const target = page.locator(`#${fieldId}`).first();
      if (await target.isVisible().catch(() => false)) {
        await target.fill(value);
        return true;
      }
    }
  }

  return false;
}

async function fillPriceIfVisible(page: Page, value: string) {
  const normalizedValue = value.replace(",", ".").trim();
  const priceInput = await waitForPriceField(page);
  if (!(await priceInput.isVisible().catch(() => false))) {
    return false;
  }

  const wrapper = page.locator("div.inputWrapper").filter({ has: page.locator("#price_amount") }).first();
  if (await wrapper.isVisible().catch(() => false)) {
    await wrapper.scrollIntoViewIfNeeded().catch(() => undefined);
    await wrapper.click({ force: true }).catch(() => undefined);
  }

  await priceInput.scrollIntoViewIfNeeded().catch(() => undefined);
  await priceInput.click({ force: true }).catch(() => undefined);
  await page.waitForTimeout(150);
  await priceInput.focus().catch(() => undefined);
  await page.keyboard.press("Control+A").catch(() => undefined);
  await page.keyboard.press("Backspace").catch(() => undefined);
  await page.keyboard.type(normalizedValue, { delay: 60 }).catch(() => undefined);

  let currentValue = await priceInput.inputValue().catch(() => "");
  if (currentValue.trim()) {
    await priceInput.evaluate((element) => {
      if (element instanceof HTMLInputElement) {
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.blur();
      }
    }).catch(() => undefined);
    return true;
  }

  const wroteViaDom = await page
    .evaluate((newValue) => {
      const input = document.querySelector("#price_amount") as HTMLInputElement | null;
      if (!input) {
        return "";
      }

      input.focus();
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      descriptor?.set?.call(input, String(newValue));
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: String(newValue), inputType: "insertText" }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
      return input.value;
    }, normalizedValue)
    .catch(() => "");

  currentValue = await priceInput.inputValue().catch(() => "");
  if (currentValue.trim() || String(wroteViaDom).trim()) {
    return true;
  }

  const digitsOnlyValue = normalizedValue.replace(/[^\d]/g, "");
  if (!digitsOnlyValue) {
    return false;
  }

  await priceInput.click({ force: true }).catch(() => undefined);
  await page.keyboard.press("Control+A").catch(() => undefined);
  await page.keyboard.press("Backspace").catch(() => undefined);
  await page.keyboard.type(digitsOnlyValue, { delay: 60 }).catch(() => undefined);
  await priceInput.evaluate((element) => {
    if (element instanceof HTMLInputElement) {
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "5" }));
      element.blur();
    }
  }).catch(() => undefined);

  currentValue = await priceInput.inputValue().catch(() => "");
  if (currentValue.trim()) {
    return true;
  }

  const finalAttemptValue = await page
    .evaluate((newValue) => {
      const input = document.getElementById("price_amount") as HTMLInputElement | null;
      if (!input) {
        return "";
      }

      input.removeAttribute("readonly");
      input.removeAttribute("disabled");
      input.focus();
      input.value = String(newValue);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: String(newValue), inputType: "insertReplacementText" }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true }));
      return input.value;
    }, digitsOnlyValue || normalizedValue)
    .catch(() => "");

  currentValue = await priceInput.inputValue().catch(() => "");
  return Boolean(currentValue.trim() || String(finalAttemptValue).trim());
}

async function fillInitialSummary(page: Page, value: string) {
  const candidates = [
    page.getByPlaceholder("Resumen del producto").first(),
    page.locator("input[placeholder='Resumen del producto']").first(),
    page.locator("textarea[placeholder='Resumen del producto']").first(),
    page.locator("[contenteditable='true']").first(),
    page.locator("div[role='textbox']").first(),
    page.getByLabel("Resumen del producto", { exact: false }).first(),
  ];

  for (const locator of candidates) {
    const isVisible = await locator.isVisible().catch(() => false);
    if (isVisible) {
      await locator.waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
      await locator.click();
      await page.waitForTimeout(300);
      const tagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
      const isEditable = await locator
        .evaluate((element) => {
          const htmlElement = element as HTMLElement;
          return htmlElement.isContentEditable || element.getAttribute("contenteditable") === "true";
        })
        .catch(() => false);

      if (tagName === "input" || tagName === "textarea") {
        await locator.fill("");
        await locator.type(value, { delay: 25 });
        const currentValue = await locator.inputValue().catch(() => "");
        if (currentValue.trim()) {
          return;
        }
      }

      if (isEditable) {
        await page.keyboard.press("Control+A").catch(() => undefined);
        await page.keyboard.press("Backspace").catch(() => undefined);
        await locator.type(value, { delay: 25 });
        const currentText = await locator.textContent().catch(() => "");
        if ((currentText ?? "").trim()) {
          return;
        }
      }
    }
  }

  throw new Error("No se pudo rellenar el resumen inicial de Wallapop.");
}

async function waitForProductDetailsSection(page: Page) {
  const anchors = [
    page.getByText("Información del producto", { exact: true }).first(),
    page.locator("label", { hasText: "Descripción" }).first(),
    page.locator("label", { hasText: "Estado" }).first(),
    page.locator("label", { hasText: "Precio" }).first(),
  ];

  for (const locator of anchors) {
    if (await locator.isVisible().catch(() => false)) {
      await locator.waitFor({ state: "visible", timeout: 12000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
      return;
    }
  }

  await page.waitForTimeout(1800);
}

async function waitForPriceField(page: Page) {
  const priceField = page.locator("#price_amount").first();
  await priceField.waitFor({ state: "visible", timeout: 12000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  return priceField;
}

async function clickContinueFromInitialStep(page: Page) {
  const continueButton = page.getByRole("button", { name: /continuar/i }).last();
  if (await continueButton.isVisible().catch(() => false)) {
    await continueButton.waitFor({ state: "visible", timeout: 10000 });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const isDisabled = await continueButton.isDisabled().catch(() => false);
      if (!isDisabled) {
        break;
      }
      await page.waitForTimeout(250);
    }
    await continueButton.click();
    return;
  }

  await clickFirstVisible(page, [page.getByText("Continuar", { exact: true }).first()]);
}

async function clickContinueAfterPhotos(page: Page) {
  const continueCandidates = [
    page.getByRole("button", { name: /continuar/i }).last(),
    page.getByText("Continuar", { exact: true }).last(),
  ];

  for (const locator of continueCandidates) {
    if (await locator.isVisible().catch(() => false)) {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const isDisabled = await locator.isDisabled().catch(() => false);
        if (!isDisabled) {
          break;
        }
        await page.waitForTimeout(500);
      }
      await locator.click();
      return;
    }
  }

  throw new Error("No se encontro el boton Continuar despues de subir las fotos.");
}

async function openComboboxByLabel(page: Page, label: string) {
  const labelled = page.getByLabel(label, { exact: false }).first();
  if (await labelled.count()) {
    await labelled.click();
    return;
  }

  const labelLocator = page.locator("label", { hasText: label }).first();
  if (!(await labelLocator.count())) {
    throw new Error(`No se encontro el selector con etiqueta "${label}".`);
  }

  const container = labelLocator.locator("xpath=ancestor::*[self::div or self::label][1]");
  const combobox = container.locator("[role='combobox'], button, input").first();
  await combobox.click();
}

async function chooseOption(page: Page, value: string) {
  const normalized = normalizeText(value);
  const optionCandidates = [
    page.getByRole("option", { name: value, exact: true }).first(),
    page.getByRole("option", { name: value }).first(),
    page.getByText(value, { exact: true }).first(),
    page.getByText(value).first(),
  ];

  for (const locator of optionCandidates) {
    if (await locator.isVisible().catch(() => false)) {
      await locator.click();
      return;
    }
  }

  const allTexts = await page.locator("li, div[role='option'], button, span").allTextContents();
  const match = allTexts.find((text) => normalizeText(text) === normalized);
  if (match) {
    await clickByVisibleText(page, match, false);
    return;
  }

  throw new Error(`No se encontro la opcion "${value}".`);
}

async function setInputFiles(page: Page, photoPaths: string[]) {
  const selectors = [
    "tsl-drop-area-v2[formcontrolname='images'] input#dropAreaPreviewInput",
    "tsl-drop-area-v2[formcontrolname='images'] input[type='file']",
    "tsl-drop-area-zone input[type='file'][accept*='image/webp']",
    "tsl-drop-area-preview input[type='file'][accept*='image/webp']",
    "input[type='file']",
    "[data-testid='file-input'] input[type='file']",
    "input[type='file'][accept*='image']",
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.setInputFiles(photoPaths);
      return;
    }
  }

  await page.waitForTimeout(1500);

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.setInputFiles(photoPaths);
      return;
    }
  }

  const uploadTriggers = [
    page.getByRole("button", { name: /subir fotos/i }).first(),
    page.getByText(/subir fotos/i).first(),
    page.locator("tsl-drop-area-v2[formcontrolname='images'] label[for='dropAreaPreviewInput']").first(),
    page.locator("tsl-drop-area-v2[formcontrolname='images'] .DropAreaZone__wrapper").first(),
    page.locator("div, section").filter({ hasText: "Arrastra tus fotos aquí" }).first(),
    page.locator("div, section").filter({ hasText: "Arrastra tus fotos aqui" }).first(),
    page.locator("div, section").filter({ hasText: "Formatos aceptados" }).first(),
  ];

  for (const trigger of uploadTriggers) {
    if (await trigger.isVisible().catch(() => false)) {
      const chooserPromise = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
      await trigger.click().catch(() => undefined);
      const chooser = await chooserPromise;
      if (chooser) {
        await chooser.setFiles(photoPaths);
        return;
      }
    }
  }

  throw new Error("No se encontro el control para subir fotos.");
}

async function clickFirstVisible(page: Page, candidates: Array<Locator | string>) {
  for (const candidate of candidates) {
    const locator = typeof candidate === "string" ? page.locator(candidate).first() : candidate;
    if (await locator.isVisible().catch(() => false)) {
      await locator.click();
      return;
    }
  }
  throw new Error("No se encontro ningun elemento visible para hacer clic.");
}

async function openCategoryDropdown(page: Page) {
  const wrapperCandidates = [
    page.locator("div[aria-label='Categoría y subcategoría'][role='button']").first(),
    page.locator("walla-dropdown div[role='button'][aria-haspopup='listbox']").first(),
    page.locator("input.sc-walla-text-input[tabindex='-1']").first(),
    page.locator("div.inputWrapper").filter({ hasText: "Categoría y subcategoría" }).first(),
    page.locator("label.walla-text-input__label", { hasText: "Categoría y subcategoría" }).first(),
  ];

  for (const locator of wrapperCandidates) {
    if (!(await locator.isVisible().catch(() => false))) {
      continue;
    }

    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(300);

    const directClickWorked = await locator
      .click({ force: true })
      .then(() => true)
      .catch(() => false);

    if (!directClickWorked) {
      await locator.focus().catch(() => undefined);
      await page.keyboard.press("Enter").catch(() => undefined);
      await page.keyboard.press("Space").catch(() => undefined);
    }

    const expanded = await page
      .locator("div[role='listbox'], walla-dropdown-item[role='option']")
      .first()
      .isVisible()
      .catch(() => false);

    if (expanded) {
      return;
    }

    const openedViaAncestor = await locator
      .evaluate((element) => {
        const target =
          element.closest("div[role='button'][aria-haspopup='listbox']") ??
          element.closest("walla-dropdown")?.querySelector("div[role='button'][aria-haspopup='listbox']");
        if (target instanceof HTMLElement) {
          target.click();
          return true;
        }
        return false;
      })
      .catch(() => false);

    if (openedViaAncestor) {
      await page.waitForTimeout(500);
      const visible = await page
        .locator("div[role='listbox'], walla-dropdown-item[role='option']")
        .first()
        .isVisible()
        .catch(() => false);
      if (visible) {
        return;
      }
    }
  }

  throw new Error("No se pudo abrir el desplegable de categoría y subcategoría.");
}

async function selectWeight(page: Page, weight: string) {
  const weightToValue: Record<string, string> = {
    "0 a 1 kg": "0",
    "1 a 2 kg": "1",
    "2 a 5 kg": "2",
    "5 a 10 kg": "3",
    "10 a 20 kg": "4",
    "20 a 30 kg": "5",
  };

  const radioValue = weightToValue[weight];
  if (radioValue) {
    const exactRadio = page.locator(`input.walla-radio__input[type='radio'][value='${radioValue}']`).first();
    if (await exactRadio.isVisible().catch(() => false)) {
      await exactRadio.check().catch(async () => {
        await exactRadio.click({ force: true });
      });
      return;
    }
  }

  const line = page.getByText(weight, { exact: true }).first();
  if (await line.isVisible().catch(() => false)) {
    await line.click();
    return;
  }

  throw new Error(`No se encontro la opcion de peso "${weight}".`);
}

async function maybeSelectBrand(page: Page, brand?: string) {
  if (!brand || !brand.trim()) {
    return;
  }

  await openComboboxByLabel(page, "Marca");
  await chooseOption(page, brand);
}

async function selectCondition(page: Page, condition: string) {
  await openComboboxByLabel(page, "Estado");
  await chooseOption(page, condition);
}

async function selectConditionIfVisible(page: Page, condition: string) {
  const candidates = [
    page.getByLabel("Estado", { exact: false }).first(),
    page.locator("label", { hasText: "Estado" }).first(),
  ];

  for (const locator of candidates) {
    if (await locator.isVisible().catch(() => false)) {
      await selectCondition(page, condition);
      return true;
    }
  }

  return false;
}

async function selectFirstSuggestedCategory(page: Page) {
  const suggestionContainers = [
    page.locator("div, section").filter({ hasText: "Categorías sugeridas" }).first(),
    page.locator("div, section").filter({ hasText: "Categorias sugeridas" }).first(),
  ];

  for (const container of suggestionContainers) {
    if (await container.isVisible().catch(() => false)) {
      const firstOption = container.locator("button, li, [role='button']").first();
      if (await firstOption.isVisible().catch(() => false)) {
        await firstOption.click();
        return true;
      }
    }
  }

  return false;
}

async function clickCategoryPathStep(page: Page, step: string) {
  const candidates = [
    page.locator(`walla-dropdown-item[aria-label="${step}"]`).first(),
    page.getByRole("button", { name: new RegExp(step, "i") }).first(),
    page.getByRole("option", { name: new RegExp(step, "i") }).first(),
    page.getByText(step, { exact: true }).first(),
    page.getByText(new RegExp(step, "i")).first(),
  ];

  for (const locator of candidates) {
    if (await locator.isVisible().catch(() => false)) {
      await locator.click();
      await page.waitForTimeout(700);
      return;
    }
  }

  throw new Error(`No se encontro el paso de categoria "${step}".`);
}

async function waitForCategoryValue(page: Page, expectedValue: string) {
  const normalizedExpected = normalizeText(expectedValue);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const currentValue = await page
      .locator("div[aria-label='Categoría y subcategoría'][role='button'] input.sc-walla-text-input, walla-dropdown input.sc-walla-text-input")
      .first()
      .inputValue()
      .catch(() => "");

    if (normalizeText(currentValue) === normalizedExpected) {
      return;
    }

    await page.waitForTimeout(250);
  }
}

async function selectFixedGamingCategory(page: Page, categoryRoute: WallapopFormData["category"]) {
  const branchByRoute: Record<WallapopFormData["category"], string[]> = {
    consolas: ["Consolas y accesorios", "Consolas"],
    "accesorios-consolas": ["Consolas y accesorios", "Accesorios y recambios de consolas"],
    videojuegos: ["Videojuegos y más", "Videojuegos"],
  };

  const categoryPath = [
    "Tecnología y electrónica",
    "Gaming: consolas y videojuegos",
    ...branchByRoute[categoryRoute],
  ];

  for (const step of categoryPath) {
    await clickCategoryPathStep(page, step);
  }

  await waitForCategoryValue(page, categoryPath[categoryPath.length - 1]);
}

async function selectCategory(page: Page, category: WallapopFormData["category"]) {
  await openCategoryDropdown(page);
  await page.waitForTimeout(700);

  await selectFixedGamingCategory(page, category);
  await page.waitForTimeout(1800);
}

async function completePublishFlow(page: Page, data: WallapopFormData, status: StatusCallback) {
  emitStatus(status, "Abriendo la pagina de subida de Wallapop...");
  await page.goto(WALLAPOP_UPLOAD_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  emitStatus(status, "Seleccionando 'Algo que ya no necesito'...");
  await clickFirstVisible(page, [
    page.getByText("Algo que ya no necesito", { exact: true }).first(),
    page.getByRole("button", { name: /algo que ya no necesito/i }).first(),
  ]);
  await page.waitForTimeout(1500);

  emitStatus(status, "Rellenando el resumen inicial...");
  await fillInitialSummary(page, data.summary);

  emitStatus(status, "Continuando al formulario completo...");
  await clickContinueFromInitialStep(page);

  emitStatus(status, "Subiendo imagenes...");
  await setInputFiles(page, data.photoPaths);
  await page.waitForTimeout(2000);

  emitStatus(status, "Continuando despues de las fotos...");
  await clickContinueAfterPhotos(page);
  await page.waitForTimeout(1500);

  emitStatus(status, "Seleccionando la categoria...");
  await selectCategory(page, data.category);

  emitStatus(status, "Esperando a que carguen los detalles del producto...");
  await waitForProductDetailsSection(page);

  emitStatus(status, "Rellenando informacion del producto...");
  await fillFieldByLabelIfVisible(page, "Título", data.title || data.summary);
  await fillFieldByLabelIfVisible(page, "Descripción", data.description);
  await selectConditionIfVisible(page, data.condition);
  await fillPriceIfVisible(page, data.price);

  emitStatus(status, "Seleccionando el peso del envio...");
  await selectWeight(page, data.weight);

  if (data.publish) {
    emitStatus(status, "Publicando el anuncio...");
    await clickFirstVisible(page, [
      page.getByRole("button", { name: /publicar/i }).first(),
      page.getByText("Publicar", { exact: true }).first(),
    ]);
  } else {
    emitStatus(
      status,
      "Formulario completado. He dejado el navegador abierto para que revises el anuncio antes de publicarlo.",
    );
  }
}

export async function openWallapopLogin(status: StatusCallback) {
  emitStatus(status, "Abriendo Wallapop para iniciar sesion...");
  if (activeLoginContext) {
    const existingPage = await getPrimaryPage(activeLoginContext);
    await existingPage.bringToFront().catch(() => undefined);
    emitStatus(
      status,
      "Ya habia una ventana de login abierta. La he traido al frente para que continues.",
    );
    return { ok: true, message: "La ventana de Wallapop ya estaba abierta." };
  }

  const context = await getOrCreateWallapopContext();
  const page = await getPrimaryPage(context);
  await page.goto(WALLAPOP_UPLOAD_URL, { waitUntil: "domcontentloaded" });
  await page.bringToFront().catch(() => undefined);
  emitStatus(
    status,
    "Inicia sesion manualmente en el navegador. Cuando cierres esa ventana, la sesion quedara guardada.",
  );
  return { ok: true, message: "Ventana de login abierta. Completa el acceso en el navegador." };
}

export async function publishToWallapop(data: WallapopFormData, status: StatusCallback) {
  await ensurePhotoPaths(data.photoPaths);
  const context = await getOrCreateWallapopContext();
  const page = await getPrimaryPage(context);
  await page.bringToFront().catch(() => undefined);

  try {
    await completePublishFlow(page, data, status);
    return {
      ok: true,
      message: data.publish
        ? "Automatizacion terminada. Revisa en Wallapop si el anuncio se ha publicado correctamente."
        : "Automatizacion completada. El anuncio queda preparado para revision manual.",
    };
  } catch (error) {
    emitStatus(status, "He dejado el navegador abierto para que puedas revisar el punto exacto donde fallo.");
    const message = error instanceof Error ? error.message : "Error desconocido en la automatizacion.";
    return { ok: false, message };
  }
}
