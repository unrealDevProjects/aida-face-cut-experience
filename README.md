# AIDA Face Cut Experience — Guía de uso (UX)

Experiencia tipo *photocall* en formato **kiosko vertical**: eliges personaje, te colocas en cámara, se genera tu cartel y lo obtienes vía formulario/QR.

---

## Flujo de la experiencia (lo que vive el usuario)

### 1) Pantalla de inicio — “Crea tu cartel”

- Aparece el branding y **6 personajes**.
- El usuario toca una cara (elige su careta).
- La experiencia pasa a la cámara.

**Objetivo UX:** elegir rápido, sin menús ni fricción.

---

### 2) Pantalla de cámara — “Sitúa tu rostro”

- Se activa la cámara en pantalla completa.
- Se muestra:
  - Texto de instrucciones (“Sitúa tu rostro…”).
  - **Círculo guía** para encuadrar la cara.
  - Contador (3…2…1) si está activado.
  - Botón **Continuar**.

**Qué hace el usuario:**

1. Coloca la cara dentro del círculo.
2. Mantiene la cabeza estable un momento.
3. Pulsa **Continuar** (o espera al final del contador).

**Objetivo UX:** entender en 1 segundo dónde ponerse.

---

### 3) Resultado — “Tu cartel”

- Se genera el póster final:
  - Recorte de **solo la cabeza** (sin cuello/cuerpo).
  - Se colocan las **gafas del personaje elegido**.
  - Se integra con el diseño del cartel.

**Objetivo UX:** efecto “wow” inmediato + confirmación clara de que ya está listo.

---

### 4) Formulario en “burbuja” (modal)

- Se abre un formulario en una burbuja sobre el cartel.
- El fondo del cartel se oscurece para mantener foco.
- El usuario rellena datos y participa.
- Obtiene su resultado final (descarga/QR según campaña).

**Objetivo UX:** que el usuario no salga del flujo del kiosko.

---

## Modo kiosko: reglas de experiencia

### Reinicio automático (idle)

Si el usuario no toca nada durante un rato, la experiencia vuelve a **Inicio** para:

- Evitar pantallas “colgadas”.
- Prepararse para el siguiente participante.

---

## Consejos para que salga perfecto (usuario)

- **Distancia:** ni pegado ni lejos; distancia cómoda.
- **Luz:** evita contraluz fuerte.
- **Encaje:** ojos y cara bien centrados en el círculo.
- **Quieto al capturar:** 1 segundo sin moverte mejora el recorte.

---

## Checklist rápido para staff / operador

- Si el recorte sale raro:
  - centrar mejor la cara en el círculo,
  - reducir movimiento,
  - ajustar distancia a cámara.
- Si la cámara no aparece:
  - refrescar la página o reiniciar navegador,
  - revisar permisos de cámara.
- Si el formulario no avanza por cookies:
  - abrir en pantalla completa si el kiosko lo permite,
  - o revisar configuración del navegador (cookies de terceros).

---

## Objetivo final

Que cada persona:

1) elija personaje,  
2) se vea en el póster,  
3) complete el formulario,  
4) salga con su cartel listo para compartir.
