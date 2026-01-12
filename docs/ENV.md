# Configuración .env (credenciales de subida)

El backend usa `server/.env` para credenciales/config de subida.

---

## Qué necesitas
- Un bucket S3 compatible (por ejemplo DigitalOcean Spaces)
- Access Key + Secret Key
- Región/endpoint correctos según tu proveedor

---

## Plantilla recomendada (ejemplo)
Crea (o ajusta) `server/.env` con algo como:

```env
DO_ACCESS_ID="TU_ACCESS_KEY"
DO_SECRET_KEY="TU_SECRET_KEY"
DO_BUCKET="no-madproject"
DO_REGION="ams3"
DO_FOLDER="snapshots"
```

> Ojo: el formato `.env` **no evalúa** Python ni f-strings.  
> Si ves algo tipo `f"..."` dentro del `.env`, eso no se interpreta automáticamente: debe ser un valor plano.

---

## Seguridad
- No subas `.env` con secretos a repos públicos.
- Si necesitas compartir configuración, crea `server/.env.example` sin secretos.

---

## Validación
- Arranca el backend y entra en `http://localhost:8001/docs`
- Ejecuta una captura desde el frontend
- Si devuelve URL, la configuración está OK
