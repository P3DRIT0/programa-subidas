import { z } from "zod";

export const wallapopWeightValues = [
  "0 a 1 kg",
  "1 a 2 kg",
  "2 a 5 kg",
  "5 a 10 kg",
  "10 a 20 kg",
  "20 a 30 kg",
] as const;

export const wallapopConditionValues = [
  "Sin abrir",
  "En su caja",
  "Nuevo",
  "Como nuevo",
  "En buen estado",
  "En condiciones aceptables",
  "Lo ha dado todo",
] as const;

export const wallapopCategoryRouteValues = [
  "consolas",
  "accesorios-consolas",
  "videojuegos",
] as const;

export const vintedPlatformValues = [
  "8575",
  "8573",
  "8574",
  "1259",
  "8576",
  "8577",
  "1260",
  "1261",
  "1262",
  "1263",
  "8579",
  "8580",
  "8578",
  "8581",
  "1264",
  "1265",
  "1266",
  "1267",
  "1268",
  "1269",
  "1270",
  "1272",
  "1273",
  "6478",
  "1274",
  "1275",
  "1276",
  "1277",
  "1278",
  "1279",
  "1280",
  "1281",
  "8582",
  "1282",
  "8583",
  "1283",
  "1284",
  "1285",
  "1286",
  "1287",
  "1288",
  "1289",
  "8584",
  "1290",
  "1291",
  "8585",
] as const;

export const vintedPlatformLabels: Record<(typeof vintedPlatformValues)[number], string> = {
  "8575": "Acer Nitro Blaze 11",
  "8573": "Acer Nitro Blaze 7",
  "8574": "Acer Nitro Blaze 8",
  "1259": "Asus ROG Ally",
  "8576": "Asus ROG Ally X",
  "8577": "Asus ROG Xbox Ally",
  "1260": "Atari",
  "1261": "Ayaneo",
  "1262": "Commodore",
  "1263": "Lenovo Legion Go",
  "8579": "MSI Claw 7 AI+",
  "8580": "MSI Claw 8 AI+",
  "8578": "MSI Claw A1M",
  "8581": "MSI Claw A8",
  "1264": "Nintendo 2DS",
  "1265": "Nintendo 3DS",
  "1266": "Nintendo 64",
  "1267": "Nintendo DS",
  "1268": "Nintendo Entertainment System",
  "1269": "Nintendo Game Boy",
  "1270": "Nintendo Game Boy Advance",
  "1272": "Nintendo GameCube",
  "1273": "Nintendo Switch",
  "6478": "Nintendo Switch 2",
  "1274": "Nintendo Wii",
  "1275": "Nintendo Wii U",
  "1276": "PC y Mac",
  "1277": "PlayStation 1",
  "1278": "PlayStation 2",
  "1279": "PlayStation 3",
  "1280": "PlayStation 4",
  "1281": "PlayStation 5",
  "8582": "PlayStation 5 Pro",
  "1282": "PlayStation Portable",
  "8583": "PlayStation Portal",
  "1283": "PlayStation Vita",
  "1284": "Sega Dreamcast",
  "1285": "Sega Mega Drive",
  "1286": "Steam Deck",
  "1287": "Super Nintendo",
  "1288": "Xbox (original)",
  "1289": "Xbox 360",
  "8584": "Xbox Ally X",
  "1290": "Xbox One",
  "1291": "Xbox Series S y X",
  "8585": "Zotac Gaming Zone",
};

export const vintedContentRatingValues = [
  "AO - Solo adultos",
  "E - Todos los públicos",
  "E10+ - Mayores de 10 años",
  "M - Mayores de 17 años",
  "PEGI 3",
  "PEGI 12",
  "PEGI 16",
  "PEGI 18",
] as const;

export const erpRegionValues = [
  "Sin definir",
  "NTSC/JP",
  "NTSC/USA",
  "PAL/AUS",
  "PAL/CH",
  "PAL/DE",
  "PAL/ES",
  "PAL/EU",
  "PAL/FR",
  "PAL/IT",
  "PAL/NL",
  "PAL/PT",
  "PAL/UK",
] as const;

export const erpWebConditionValues = [
  "Sin definir",
  "Completo",
  "Incompleto",
  "Sellado",
  "Solo juego",
  "Nuevo",
] as const;

export const wallapopFormSchema = z.object({
  summary: z.string().min(3, "El resumen es obligatorio."),
  category: z.enum(wallapopCategoryRouteValues),
  preferSuggestedCategory: z.boolean().default(true),
  vintedPlatform: z.union([z.literal(""), z.enum(vintedPlatformValues)]).default(""),
  vintedContentRating: z.enum(vintedContentRatingValues).optional(),
  brand: z.string().optional(),
  title: z.string().min(3, "El titulo es obligatorio."),
  description: z.string().min(10, "La descripcion es obligatoria."),
  condition: z.enum(wallapopConditionValues),
  price: z.string().min(1, "El precio es obligatorio."),
  stockQuantity: z.string().min(1, "La cantidad en stock es obligatoria.").default("1"),
  erpRegion: z.enum(erpRegionValues).default("Sin definir"),
  erpWebCondition: z.enum(erpWebConditionValues).default("Sin definir"),
  weight: z.enum(wallapopWeightValues),
  photoPaths: z.array(z.string()).min(1, "Debes seleccionar al menos una foto."),
  publish: z.boolean().default(false),
}).superRefine((data, context) => {
  if (data.category === "videojuegos" && !data.vintedPlatform) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["vintedPlatform"],
      message: "Debes seleccionar una plataforma de Vinted.",
    });
  }
});

export type WallapopFormData = z.infer<typeof wallapopFormSchema>;

export type RendererToMainApi = {
  openWallapopLogin: () => Promise<{ ok: boolean; message: string }>;
  openVintedLogin: () => Promise<{ ok: boolean; message: string }>;
  openErpLogin: () => Promise<{ ok: boolean; message: string }>;
  pickImages: () => Promise<string[]>;
  publishWallapop: (
    data: WallapopFormData,
  ) => Promise<{ ok: boolean; message: string }>;
  publishVinted: (
    data: WallapopFormData,
  ) => Promise<{ ok: boolean; message: string }>;
  publishErp: (
    data: WallapopFormData,
  ) => Promise<{ ok: boolean; message: string }>;
  onStatus: (callback: (message: string) => void) => () => void;
};
