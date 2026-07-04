import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    # PostgreSQL — use DATABASE_URL from Render (or local dev)
    DATABASE_URL = os.getenv(
        "DATABASE_URL",
        "postgresql://localhost:5432/dam_db"
    )

    # Render provides DATABASE_URL starting with "postgres://" but psycopg2 needs "postgresql://"
    if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

    # JWT
    JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-key")
    JWT_ALGORITHM = "HS256"
    JWT_EXPIRY_HOURS = 24

    # Google Drive
    GOOGLE_SERVICE_ACCOUNT_FILE = os.getenv(
        "GOOGLE_SERVICE_ACCOUNT_FILE", "credentials.json"
    )

    # CORS
    CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*")

    # Upload
    MAX_FILE_SIZE_MB = int(os.getenv("MAX_FILE_SIZE_MB", "100"))
    MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

    # Default folders created on signup
    DEFAULT_FOLDERS = [
        "Images", "Videos", "Documents", "Others",
        "GST", "ITR", "Audit", "TDS", "Balance Sheet",
    ]
