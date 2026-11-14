# Cabina Chroma (PWA)

Cámara en vivo → quita el fondo verde → pone el fondo que elijas → descarga o comparte la foto.
Todo se procesa en el dispositivo; no se sube nada a ningún servidor.

## 1. Agrega tus fondos
1. Copia tus imágenes a la carpeta `fondos/`.
2. Edita `fondos/fondos.json` con sus nombres de archivo:
   ```json
   [
     { "name": "Galaxia", "src": "galaxia.jpg" },
     { "name": "Marte",   "src": "marte.jpg" }
   ]
   ```
3. Recomendado: JPG o WebP de 1920 px de ancho o menos (carga más rápido).
4. Cada vez que cambies archivos, sube el número de `VERSION` en `sw.js` (por ejemplo `cabina-v2`) para que los dispositivos se actualicen.

## 2. Publícala (la cámara exige HTTPS)
- **GitHub Pages**: sube la carpeta a un repositorio → Settings → Pages → rama `main`, carpeta raíz.
- Netlify o Cloudflare Pages: arrastra la carpeta.
- Para probar en tu computadora: `python3 -m http.server 8080` y abre `http://localhost:8080`
  (localhost sí permite cámara sin HTTPS).

## 3. Instalar en el celular
- Android (Chrome): botón **Instalar app** o menú ⋮ → *Instalar aplicación*.
- iPhone (Safari): Compartir → *Agregar a pantalla de inicio*.

## 4. Consejos para un buen recorte
- Ilumina el fondo verde **de forma pareja**, sin sombras ni arrugas.
- Separa a la persona del fondo al menos 1 m para evitar reflejo verde.
- Evita ropa verde (se vuelve transparente).
- Si quedan bordes verdes: sube *Quitar reflejo verde* o *Suavizado*.
- Si queda verde en el fondo: sube *Similitud*, o usa **Muestrear fondo** y toca una zona verde.
- Si se recorta parte de la persona: baja *Similitud*.

## Archivos
| Archivo | Para qué sirve |
|---|---|
| `index.html`, `styles.css` | Interfaz |
| `app.js` | Cámara, fondos, captura, descarga/compartir |
| `chroma.js` | Algoritmo de quitado de verde |
| `sw.js`, `manifest.webmanifest`, `icons/` | Funcionamiento offline e instalación |
