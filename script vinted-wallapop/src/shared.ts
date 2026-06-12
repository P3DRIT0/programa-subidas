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

export const wallapopFormSchema = z.object({
  summary: z.string().min(3, "El resumen es obligatorio."),
  category: z.enum(wallapopCategoryRouteValues),
  preferSuggestedCategory: z.boolean().default(true),
  vintedPlatform: z.string().optional().default(""),
  vintedContentRating: z.enum(vintedContentRatingValues).optional(),
  brand: z.string().optional(),
  title: z.string().min(3, "El titulo es obligatorio."),
  description: z.string().min(10, "La descripcion es obligatoria."),
  condition: z.enum(wallapopConditionValues),
  price: z.string().min(1, "El precio es obligatorio."),
  weight: z.enum(wallapopWeightValues),
  photoPaths: z.array(z.string()).min(1, "Debes seleccionar al menos una foto."),
  publish: z.boolean().default(false),
});

export type WallapopFormData = z.infer<typeof wallapopFormSchema>;

export type RendererToMainApi = {
  openWallapopLogin: () => Promise<{ ok: boolean; message: string }>;
  openVintedLogin: () => Promise<{ ok: boolean; message: string }>;
  pickImages: () => Promise<string[]>;
  publishWallapop: (
    data: WallapopFormData,
  ) => Promise<{ ok: boolean; message: string }>;
  publishVinted: (
    data: WallapopFormData,
  ) => Promise<{ ok: boolean; message: string }>;
  onStatus: (callback: (message: string) => void) => () => void;
};
