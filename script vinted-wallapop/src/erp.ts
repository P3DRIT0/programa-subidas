import path from "node:path";
import { app } from "electron";
import { chromium, Locator, Page } from "playwright";
import { vintedPlatformLabels, WallapopFormData } from "./shared";

const ERP_PRODUCTS_URL = "https://erp.retrobay.es/products";

type StatusCallback = (message: string) => void;

let activeErpLoginContext: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null;

function getProfileDir() {
  return path.join(app.getPath("userData"), "erp-profile");
}

function emitStatus(callback: StatusCallback, message: string) {
  callback(message);
}

async function launchErpContext() {
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

function registerContextCleanup(
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>,
) {
  context.once("close", () => {
    if (activeErpLoginContext === context) {
      activeErpLoginContext = null;
    }
  });
}

async function getOrCreateErpContext() {
  if (activeErpLoginContext) {
    return activeErpLoginContext;
  }

  const context = await launchErpContext();
  activeErpLoginContext = context;
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

async function clickFirstVisible(page: Page, candidates: Array<Locator | string>) {
  for (const candidate of candidates) {
    const locator = typeof candidate === "string" ? page.locator(candidate).first() : candidate;
    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ force: true }).catch(async () => locator.click());
      return;
    }
  }
  throw new Error("No se encontro ningun elemento visible para hacer clic en el ERP.");
}

async function fillNamedField(page: Page, selectors: string[], value: string) {
  for (const selector of selectors) {
    const field = page.locator(selector).first();
    if (await field.isVisible().catch(() => false)) {
      await field.scrollIntoViewIfNeeded().catch(() => undefined);
      const inputType = await field.getAttribute("type").catch(() => "");
      const normalizedValue = inputType === "number" ? value.replace(",", ".") : value;
      await field.fill("");
      await field.fill(normalizedValue);
      return;
    }
  }
}

async function fillInputByText(page: Page, label: string, value: string) {
  const candidates = [
    page.getByLabel(label, { exact: false }).first(),
    page.locator(`input[name='${label}']`).first(),
    page.locator(`textarea[name='${label}']`).first(),
    page.locator("label", { hasText: label }).first(),
  ];

  for (const locator of candidates) {
    if (await locator.isVisible().catch(() => false)) {
      const tagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
      if (tagName === "input" || tagName === "textarea") {
        await locator.fill(value);
        return;
      }

      const field = locator.locator("xpath=following::input[1] | xpath=following::textarea[1]").first();
      if (await field.isVisible().catch(() => false)) {
        await field.fill(value);
        return;
      }
    }
  }

  throw new Error(`No se encontro el campo "${label}" en el ERP.`);
}

async function fillField(page: Page, selectors: string[], fallbackLabel: string, value: string) {
  await fillNamedField(page, selectors, value);

  const firstSelector = selectors[0];
  if (firstSelector) {
    const target = page.locator(firstSelector).first();
    const currentValue = await target.inputValue().catch(() => "");
    if (currentValue.trim() === value.trim()) {
      return;
    }
  }

  await fillInputByText(page, fallbackLabel, value);
}

async function selectByLabel(page: Page, label: string, value: string) {
  const labelLocator = page.locator("label", { hasText: label }).first();
  if (await labelLocator.isVisible().catch(() => false)) {
    const select = labelLocator.locator("xpath=following::select[1]").first();
    if (await select.isVisible().catch(() => false)) {
      const selected = await forceSelectValue(select, value);

      if (selected) {
        return;
      }
    }
  }

  const select = page.locator(`select[aria-label*='${label}'], select[name*='${label}']`).first();
  if (await select.isVisible().catch(() => false)) {
    const selected = await forceSelectValue(select, value);

    if (selected) {
      return;
    }
  }
}

async function forceSelectValue(select: Locator, desiredValue: string) {
  const match = await select.evaluate((element, rawDesiredValue) => {
    if (!(element instanceof HTMLSelectElement)) {
      return { value: "", label: "", options: [] as string[] };
    }

    const normalize = (text: string) => text.trim().toLowerCase();
    const expected = normalize(rawDesiredValue);
    const options = Array.from(element.options).map((item) => `${item.text.trim()}|${item.value}`);
    const option = Array.from(element.options).find((item) => {
      return normalize(item.text) === expected || normalize(item.value) === expected;
    });

    if (!option) {
      return { value: "", label: "", options };
    }

    return {
      value: option.value,
      label: option.text.trim(),
      options,
    };
  }, desiredValue).catch(() => ({ value: "", label: "", options: [] as string[] }));

  if (!match.value) {
    return {
      ok: false,
      label: "",
      options: match.options,
    };
  }

  await select.selectOption({ value: match.value }).catch(() => undefined);
  await select.evaluate((element, optionValue) => {
    if (!(element instanceof HTMLSelectElement)) {
      return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    descriptor?.set?.call(element, optionValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }, match.value).catch(() => undefined);

  const selectedLabel = await select.evaluate((element) => {
    if (!(element instanceof HTMLSelectElement)) {
      return "";
    }
    return element.selectedOptions[0]?.text?.trim() ?? "";
  }).catch(() => "");

  return {
    ok: selectedLabel.trim().toLowerCase() === match.label.trim().toLowerCase(),
    label: selectedLabel,
    options: match.options,
  };
}

async function selectField(page: Page, selectors: string[], fallbackLabel: string, value: string) {
  for (const selector of selectors) {
    const select = page.locator(selector).first();
    if (await select.isVisible().catch(() => false)) {
      await select.scrollIntoViewIfNeeded().catch(() => undefined);
      const result = await forceSelectValue(select, value);
      if (result.ok) {
        return;
      }

      throw new Error(
        `ERP no pudo fijar "${fallbackLabel}" a "${value}". Opciones detectadas: ${result.options.join(", ") || "ninguna"}`,
      );
    }
  }

  await selectByLabel(page, fallbackLabel, value);

  const fallbackSelect = page.locator(`select[aria-label*='${fallbackLabel}'], select[name*='${fallbackLabel}']`).first();
  if (await fallbackSelect.isVisible().catch(() => false)) {
    const result = await forceSelectValue(fallbackSelect, value);
    if (result.ok) {
      return;
    }
    throw new Error(
      `ERP no pudo verificar "${fallbackLabel}" a "${value}" tras fallback. Opciones detectadas: ${result.options.join(", ") || "ninguna"}`,
    );
  }
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferErpCategory(data: WallapopFormData) {
  if (data.category === "consolas") {
    return "Consola";
  }
  if (data.category === "accesorios-consolas") {
    return "Accesorio";
  }
  return "Videojuegos";
}

function getErpPlatformCategoryName(platformLabel: string) {
  const replacements: Record<string, string> = {
    "Nintendo DS": "NDS",
    "Nintendo Entertainment System": "Nintendo NES",
    "PlayStation Portable": "PSP",
    "PlayStation Vita": "PSVita",
    "Xbox (original)": "Xbox Original",
    "Xbox Series S y X": "Xbox Series",
    "Sega Mega Drive": "Mega Drive",
  };

  return replacements[platformLabel] ?? platformLabel;
}

function getErpLeafCategoryName(category: WallapopFormData["category"]) {
  if (category === "consolas") {
    return "Consolas";
  }
  if (category === "accesorios-consolas") {
    return "Accesorios y Repuestos";
  }
  return "Videojuegos";
}

function escapeXPathText(value: string) {
  if (!value.includes("'")) {
    return `'${value}'`;
  }

  const parts = value.split("'").map((part) => `'${part}'`);
  return `concat(${parts.join(", \"'\", ")})`;
}

async function clickCategoryCheckboxByLabel(page: Page, label: string) {
  const escaped = escapeXPathText(label);
  const candidates = [
    page.locator(`xpath=//*[normalize-space(text())=${escaped}]/ancestor::*[self::div or self::label][1]//input[@type='checkbox'][1]`).first(),
    page.locator(`xpath=//*[normalize-space(text())=${escaped}]/preceding::input[@type='checkbox'][1]`).first(),
  ];

  for (const checkbox of candidates) {
    if (await checkbox.isVisible().catch(() => false)) {
      await checkbox.scrollIntoViewIfNeeded().catch(() => undefined);
      const isChecked = await checkbox.isChecked().catch(() => false);
      if (!isChecked) {
        await checkbox.check().catch(async () => {
          await checkbox.click({ force: true });
        });
      }
      return true;
    }
  }

  return false;
}

async function selectErpPrimaryCategory(page: Page, data: WallapopFormData) {
  const select = page.locator("#primaryCategoryId, select[name='primaryCategoryId']").first();
  await select.waitFor({ state: "visible", timeout: 10000 });

  const desiredLeafLabel = data.category === "consolas"
    ? "- - Consolas"
    : data.category === "accesorios-consolas"
      ? "- - Accesorios y Repuestos"
      : "- - Videojuegos";

  const platformLabel = data.vintedPlatform ? vintedPlatformLabels[data.vintedPlatform] : "";
  const erpPlatformName = platformLabel ? getErpPlatformCategoryName(platformLabel) : "";

  const resolution = await select.evaluate((element, payload) => {
    if (!(element instanceof HTMLSelectElement)) {
      return { ok: false, message: "No es un select", chosen: "", options: [] as string[] };
    }

    const options = Array.from(element.options).map((option) => ({
      value: option.value,
      text: option.text.trim(),
    }));

    const normalize = (text: string) => text.trim().toLowerCase();
    const fallback = options.find((option) => normalize(option.text) === normalize(payload.fallbackLabel));
    let target = fallback;

    if (payload.erpPlatformName) {
      const platformIndex = options.findIndex((option) => normalize(option.text) === normalize(`- ${payload.erpPlatformName}`));
      if (platformIndex >= 0) {
        for (let index = platformIndex + 1; index < options.length; index += 1) {
          const currentText = options[index].text;
          if (currentText.startsWith("- ") && !currentText.startsWith("- - ")) {
            break;
          }
          if (normalize(currentText) === normalize(payload.desiredLeafLabel)) {
            target = options[index];
            break;
          }
        }
      }
    }

    if (!target) {
      return {
        ok: false,
        message: `No se encontro destino para ${payload.desiredLeafLabel}`,
        chosen: "",
        options: options.map((option) => `${option.text}|${option.value}`),
      };
    }

    element.value = target.value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));

    return {
      ok: true,
      message: "",
      chosen: target.text,
      options: options.map((option) => `${option.text}|${option.value}`),
    };
  }, {
    desiredLeafLabel,
    erpPlatformName,
    fallbackLabel: inferErpCategory(data),
  }).catch(() => ({
    ok: false,
    message: "Error evaluando categoria principal",
    chosen: "",
    options: [] as string[],
  }));

  if (!resolution.ok) {
    throw new Error(
      `ERP no pudo fijar "Categoria principal". ${resolution.message}. Opciones detectadas: ${resolution.options.join(", ") || "ninguna"}`,
    );
  }
}

async function selectErpCategoryTree(page: Page, data: WallapopFormData) {
  const searchInput = page.getByPlaceholder("Nombre o Woo ID").first();
  const leafCategoryName = getErpLeafCategoryName(data.category);
  const platformLabel = data.vintedPlatform ? vintedPlatformLabels[data.vintedPlatform] : "";
  const erpPlatformName = platformLabel ? getErpPlatformCategoryName(platformLabel) : inferErpCategory(data);

  if (await searchInput.isVisible().catch(() => false)) {
    await searchInput.scrollIntoViewIfNeeded().catch(() => undefined);
    await searchInput.fill("");
    await searchInput.fill(erpPlatformName);
    await page.waitForTimeout(400);
  }

  const branchSelected = await clickCategoryCheckboxByLabel(page, erpPlatformName);
  const leafSelected = await clickCategoryCheckboxByLabel(page, leafCategoryName);

  if (await searchInput.isVisible().catch(() => false)) {
    await searchInput.fill("").catch(() => undefined);
  }

  if (!leafSelected) {
    throw new Error(`ERP no pudo marcar la categoria del arbol para "${erpPlatformName}" -> "${leafCategoryName}".`);
  }

  if (!branchSelected && data.category !== "videojuegos") {
    await clickCategoryCheckboxByLabel(page, inferErpCategory(data)).catch(() => undefined);
  }
}

function inferErpWebConditionGrade(condition: WallapopFormData["condition"]) {
  switch (condition) {
    case "Sin abrir":
      return "Excelente";
    case "En su caja":
      return "Muy bueno";
    case "Nuevo":
      return "Excelente";
    case "Como nuevo":
      return "Muy bueno";
    case "En buen estado":
      return "Bueno";
    case "En condiciones aceptables":
      return "Aceptable";
    case "Lo ha dado todo":
      return "tara";
    default:
      return "Sin definir";
  }
}

async function fillErpForm(page: Page, data: WallapopFormData, status: StatusCallback) {
  emitStatus(status, "Abriendo ERP en productos...");
  await page.goto(ERP_PRODUCTS_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  emitStatus(status, "Entrando en Web/Venta del ERP...");
  await clickFirstVisible(page, [
    page.getByRole("button", { name: /web\/venta/i }).first(),
    page.getByText("Web/Venta", { exact: true }).first(),
  ]);

  emitStatus(status, "Abriendo nuevo producto en ERP...");
  await clickFirstVisible(page, [
    page.getByRole("button", { name: /nuevo producto/i }).first(),
    page.getByText("Nuevo producto", { exact: true }).first(),
  ]);
  await page.locator("#name, input[name='name']").first().waitFor({ state: "visible", timeout: 15000 });

  const productName = data.title || data.summary;
  const platformLabel = data.vintedPlatform ? vintedPlatformLabels[data.vintedPlatform] : "";
  const introDetails = platformLabel ? `${productName} - ${platformLabel}` : productName;
  const erpWebConditionGrade = inferErpWebConditionGrade(data.condition);
  const detailsText = [data.description.trim(), platformLabel ? `Plataforma|${platformLabel}` : "", `Estado|${data.condition}`]
    .filter(Boolean)
    .join("\n");

  emitStatus(status, "Rellenando datos generales del ERP...");
  await fillField(page, ["#name", "input[name='name']"], "Nombre", productName);
  await fillField(page, ["#slug", "input[name='slug']"], "Slug", slugify(productName));
  await fillField(page, ["#brandName", "input[name='brandName']"], "Marca", data.brand ?? "");
  await fillField(
    page,
    ["#desiredGrossPrice", "input[name='desiredGrossPrice']"],
    "Precio deseado (IVA incl.)",
    data.price.replace(",", "."),
  );
  await fillField(page, ["#stockQty", "input[name='stockQty']"], "Cantidad de stock", data.stockQuantity);
  await selectField(page, ["#featured", "select[name='featured']"], "Destacado", "No");
  await selectField(page, ["#catalogVisibility", "select[name='catalogVisibility']"], "Visible en catalogo", "visible");
  await fillField(page, ["#currency", "input[name='currency']"], "Moneda", "EUR");
  await selectField(page, ["#isComposed", "select[name='isComposed']"], "Producto compuesto", "No");

  emitStatus(status, "Configurando estados del ERP...");
  emitStatus(status, "ERP: Estado ERP -> Listo para la venta");
  await selectField(page, ["#erpState", "select[name='erpState']"], "Estado ERP", "Listo para la venta");
  emitStatus(status, `ERP: Condicion web -> ${data.erpWebCondition}`);
  await selectField(page, ["#webConditionType", "select[name='webConditionType']"], "Condicion web", data.erpWebCondition);
  emitStatus(status, `ERP: Grado condicion web -> ${erpWebConditionGrade}`);
  await selectField(page, ["#webConditionGrade", "select[name='webConditionGrade']"], "Grado condicion web", erpWebConditionGrade);
  emitStatus(status, `ERP: Region web -> ${data.erpRegion}`);
  await selectField(page, ["#webRegion", "select[name='webRegion']"], "Region web", data.erpRegion);
  emitStatus(status, "ERP: Publicar web -> Si");
  await selectField(page, ["#publishToWeb", "select[name='publishToWeb']"], "Publicar web", "Si");
  emitStatus(status, "ERP: Gestion stock Woo -> Si");
  await selectField(page, ["#manageStockInWoo", "select[name='manageStockInWoo']"], "Gestion stock Woo", "Si");
  emitStatus(status, "ERP: Estado impuestos -> taxable");
  await selectField(page, ["#taxStatus", "select[name='taxStatus']"], "Estado impuestos", "taxable");

  emitStatus(status, "Rellenando categoria e informacion web del ERP...");
  emitStatus(status, "ERP: Categoria principal");
  await selectErpPrimaryCategory(page, data);
  emitStatus(status, "ERP: Marcando categorias");
  await selectErpCategoryTree(page, data);
  await fillField(page, ["#detailsIntro", "input[name='detailsIntro']"], "Intro detalles", introDetails);
  await fillField(page, ["textarea[name='detailsText']", "#detailsText"], "Detalles (titulo|desc por linea)", detailsText);
}

export async function openErpLogin(status: StatusCallback) {
  emitStatus(status, "Abriendo ERP para iniciar sesion...");
  if (activeErpLoginContext) {
    const existingPage = await getPrimaryPage(activeErpLoginContext);
    await existingPage.bringToFront().catch(() => undefined);
    return { ok: true, message: "La ventana del ERP ya estaba abierta." };
  }

  const context = await getOrCreateErpContext();
  const page = await getPrimaryPage(context);
  await page.goto(ERP_PRODUCTS_URL, { waitUntil: "domcontentloaded" });
  await page.bringToFront().catch(() => undefined);
  emitStatus(status, "Inicia sesion manualmente en el ERP y cierra esa ventana cuando termines.");

  return { ok: true, message: "Ventana de login del ERP abierta." };
}

export async function publishToErp(data: WallapopFormData, status: StatusCallback) {
  const context = await getOrCreateErpContext();
  const page = await getPrimaryPage(context);
  await page.bringToFront().catch(() => undefined);

  try {
    await fillErpForm(page, data, status);
    return {
      ok: true,
      message: "ERP completado. Revisa la ficha antes de crear el producto.",
    };
  } catch (error) {
    emitStatus(status, "He dejado ERP abierto para que revises el punto exacto del fallo.");
    const message = error instanceof Error ? error.message : "Error desconocido en ERP.";
    return { ok: false, message };
  }
}
