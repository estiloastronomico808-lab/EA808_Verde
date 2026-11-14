/*
 * chroma.js — quitado de fondo verde (chroma key) sobre píxeles RGBA.
 * Funciona en el navegador (window.Chroma) y en Node (module.exports) para pruebas.
 *
 * Método: se compara cada píxel con el color clave en el espacio YCbCr
 * (solo croma Cb/Cr, así la iluminación desigual del fondo afecta menos),
 * se genera un alfa suave entre "similitud" y "similitud + suavizado",
 * y se aplica supresión de derrame verde (spill) en los bordes.
 */
(function (root) {
  'use strict';

  function rgbToCbCr(r, g, b) {
    return [
      128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
      128 + 0.5 * r - 0.418688 * g - 0.081312 * b
    ];
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16)
    ];
  }

  /**
   * Modifica `data` (Uint8ClampedArray RGBA) en sitio.
   * opts: { key:[r,g,b], similarity:0..1, smoothness:0..1, spill:0..1 }
   */
  function applyChroma(data, opts) {
    const key = opts.key || [0, 177, 64];
    const sim = (opts.similarity != null ? opts.similarity : 0.35) * 100;
    const smooth = (opts.smoothness != null ? opts.smoothness : 0.12) * 100 + 0.0001;
    const spill = opts.spill != null ? opts.spill : 0.6;
    const kc = rgbToCbCr(key[0], key[1], key[2]);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const c = rgbToCbCr(r, g, b);
      const dCb = c[0] - kc[0];
      const dCr = c[1] - kc[1];
      const dist = Math.sqrt(dCb * dCb + dCr * dCr);

      // alfa: 0 dentro del umbral de similitud, 1 pasado el suavizado
      let a = (dist - sim) / smooth;
      a = a < 0 ? 0 : a > 1 ? 1 : a;

      // supresión de derrame: si el verde domina, lo bajamos al promedio de rojo/azul
      if (a > 0 && spill > 0) {
        const limit = (r + b) / 2;
        if (g > limit) {
          data[i + 1] = g - (g - limit) * spill;
        }
      }
      data[i + 3] = Math.round(a * 255 * (data[i + 3] / 255));
    }
    return data;
  }

  /**
   * Calibra el color clave promediando una región central pequeña de un ImageData,
   * útil para el botón "Muestrear fondo".
   */
  function sampleKey(imageData, cx, cy, radius) {
    const { data, width, height } = imageData;
    let r = 0, g = 0, b = 0, n = 0;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(width - 1, Math.floor(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(height - 1, Math.floor(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * width + x) * 4;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    }
    return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 177, 64];
  }

  const api = { applyChroma, sampleKey, hexToRgb, rgbToCbCr };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Chroma = api;
})(typeof self !== 'undefined' ? self : this);
