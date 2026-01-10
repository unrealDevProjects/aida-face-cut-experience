# Hotfix calidad (1080p camera)

## Qué se arregla
- Evita degradación por DPR "falso" cuando el canvas está capado por `CAM.maxW/maxH`.
  Antes: con `devicePixelRatio=2` y `maxW=1080`, estabas dibujando a ~540px de ancho y re-escalando a 1080px => blur.
  Ahora: calculamos el **DPR efectivo real** del canvas y dibujamos 1:1.

- `getUserMedia()` pide 1920×1080 (tu cámara real) para evitar que el navegador caiga a 640×480.

## Qué NO se toca
- No se cambia el flujo, vistas, composición, recorte ni MediaPipe.
- Solo calidad de entrada/sampling.

## Recomendación rápida (kiosko 1080p)
- Si tu monitor es 1080×1920: deja `CAM.maxW=1080`, `CAM.maxH=1920`, `dprCap=2` (ya no emborrona).
- Si quieres estabilidad máxima CPU: `dprCap=1`.

## Captura HQ (nuevo)
- Se desactiva CHROMA en la app (Broadcast ya entrega el fondo rojo).
- Captura/export a 2160×3840 (configurable en CAPTURE_HQ) para mejorar nitidez del póster.
- Preview sigue fluido; el export es el que sube de calidad.
