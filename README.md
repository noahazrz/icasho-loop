# Icasho Loop (app de escritorio)

Reproductor flotante que pasa en bucle y al azar los videos de un perfil de TikTok
(por defecto `@icasho`). La ventana se queda encima de todas las apps aunque hagas
clic en otra. Funciona en Windows y Linux (Wayland y X11).

Hecha con Electron (Node.js).

## Probar la app

1. Instala Node.js 18 o superior: https://nodejs.org
2. En esta carpeta:

```
npm install
npm start
```

En Linux, si Electron se queja del sandbox (pasa en Ubuntu 24.04):

```
npm run start:nosandbox
```

## Primer uso

1. Se abre el panel de Ajustes. Pulsa **Escanear videos**.
2. Una ventana oculta abre el perfil, baja hasta el final y guarda los IDs. Si TikTok pide
   captcha o login, la ventana se muestra: resuélvelo y el escaneo sigue solo.
3. Al terminar empieza el bucle aleatorio. Cada video se reproduce entero y salta al siguiente;
   no repite hasta recorrer toda la lista, y entonces vuelve a barajar.

La lista se guarda, así que no hace falta escanear de nuevo. Puedes cambiar el usuario o pegar
enlaces de videos a mano desde Ajustes.

## Controles

- **Fijado / Suelto**: activa o quita el "siempre encima".
- **Barra superior**: arrastra para mover. Los bordes cambian el tamaño.
- **Ajustes**: usuario, escaneo, enlaces manuales y transparencia.
- **⏮ ⏭ / Sonido**: anterior, siguiente y silenciar.
- Teclas con la ventana enfocada: → o espacio (siguiente), ← (anterior), M (silencio).

## Wayland

Wayland no permite que una app normal se ponga "siempre encima". Por eso en Linux la app
arranca por XWayland, y GNOME y KDE sí respetan el "siempre encima" para esas ventanas.
Otras cosas a saber:

- Si tu sistema no tiene XWayland (no hay variable `DISPLAY`), usa Wayland nativo, y ahí el
  "siempre encima" depende del compositor (en Sway o Hyprland hay que añadir una regla de
  ventana flotante).
- Para forzar Wayland nativo: `ICASHO_NATIVE_WAYLAND=1 npm start`.
- Las apps en pantalla completa pueden taparla; es una limitación del sistema.
- La transparencia necesita un compositor activo (lo normal en GNOME y KDE).

## Crear instalador

```
npm run dist:win     # .exe portable e instalador (mejor ejecutarlo en Windows)
npm run dist:linux   # AppImage
```

## Limitaciones

- No está probada contra TikTok real: usa el reproductor embebido oficial, que TikTok puede
  cambiar o bloquear. Si falla 4 veces seguidas, la app lo avisa y ofrece reintentar.
- Solo entran videos, no publicaciones de fotos.
- Si el escaneo se deja videos, pégalos a mano en Ajustes.
- La app quita las cabeceras anti-iframe solo de las respuestas de `tiktok.com/player/`.
