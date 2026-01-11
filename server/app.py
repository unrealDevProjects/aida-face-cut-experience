import os
import base64
import uuid
from datetime import datetime
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from boto3 import session
from botocore.exceptions import ClientError, NoCredentialsError
from dotenv import load_dotenv

load_dotenv()

ACCESS_ID = os.getenv("DO_ACCESS_ID")
SECRET_KEY = os.getenv("DO_SECRET_KEY")
BUCKET_NAME = os.getenv("DO_BUCKET", "no-madproject")
REGION = os.getenv("DO_REGION", "ams3")
FOLDER = os.getenv("DO_FOLDER", "snapshots-aida")
ENDPOINT_URL = f"https://{REGION}.digitaloceanspaces.com"

if not ACCESS_ID or not SECRET_KEY:
    raise RuntimeError("Faltan DO_ACCESS_ID/DO_SECRET_KEY en .env")

s3_session = session.Session()
client = s3_session.client(
    "s3",
    region_name=REGION,
    endpoint_url=ENDPOINT_URL,
    aws_access_key_id=ACCESS_ID,
    aws_secret_access_key=SECRET_KEY,
)

app = FastAPI()

# Para desarrollo local (tu front estará en http://localhost:8000 normalmente)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:5500",   # Live Server VSCode típico
        "http://127.0.0.1:5500",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SnapshotIn(BaseModel):
    data_url: str  # "data:image/png;base64,...."
    filename: str | None = None

@app.post("/api/snapshot")
def snapshot(payload: SnapshotIn):
    try:
        data_url = payload.data_url
        if "base64," not in data_url:
            raise HTTPException(status_code=400, detail="data_url inválida (falta base64,)")

        b64 = data_url.split("base64,")[1]
        image_bytes = base64.b64decode(b64)

        filename = payload.filename
        if not filename:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            uid = uuid.uuid4().hex[:8]
            filename = f"snapshot_{ts}_{uid}.png"

        object_key = f"{FOLDER}/{filename}" if FOLDER else filename

        client.put_object(
            Bucket=BUCKET_NAME,
            Key=object_key,
            Body=image_bytes,
            ACL="public-read",
            ContentType="image/png",
            ContentDisposition="inline",
        )

        public_url = f"https://{BUCKET_NAME}.{REGION}.digitaloceanspaces.com/{object_key}"
        return {"success": True, "url": public_url, "filename": filename}

    except NoCredentialsError:
        raise HTTPException(status_code=500, detail="Credenciales no disponibles")
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"Error S3/Spaces: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error inesperado: {str(e)}")
