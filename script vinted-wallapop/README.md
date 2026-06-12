# Publicador de Wallapop

Aplicacion de escritorio en TypeScript + Electron que automatiza el alta de productos en Wallapop y Vinted usando navegador real con Playwright.

## Lo que hace ahora

- Abre Wallapop y Vinted en ventanas de navegador real.
- Guarda la sesion para no iniciar sesion cada vez.
- Reutiliza el mismo formulario para ambos marketplaces.
- Sube fotos desde archivos locales, incluidos `webp`.
- Automatiza Wallapop con el flujo afinado que ya has probado.
- Incluye una primera automatizacion de Vinted para fotos, titulo, descripcion, categoria, estado y precio.

## Arranque

```powershell
npm install
npm start
```

## Flujo recomendado

1. Pulsa `Abrir Wallapop para login`.
2. Inicia sesion manualmente en el navegador que se abre.
3. Cierra esa ventana cuando ya estes dentro.
4. Rellena el formulario de la app.
5. Selecciona las fotos.
6. Ejecuta la automatizacion.

## Importante

- Wallapop cambia el HTML con el tiempo, asi que algunos selectores pueden necesitar ajuste fino.
- Si algo falla, el navegador se queda abierto para que veas el punto exacto del problema.
- Esta primera version esta centrada solo en Wallapop. Vinted y ERP se pueden enchufar despues con la misma arquitectura.
