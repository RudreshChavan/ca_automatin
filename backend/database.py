"""
Database connection and initialization for PostgreSQL.
Uses psycopg2 with DATABASE_URL connection string.
"""

import psycopg2
import psycopg2.extras
from config import Config


def get_connection():
    """Get a new database connection."""
    conn = psycopg2.connect(Config.DATABASE_URL)
    conn.autocommit = False
    return conn


def init_db():
    """Create all tables if they don't exist."""
    conn = get_connection()
    cursor = conn.cursor()

    # ── Users ──
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id          SERIAL PRIMARY KEY,
            email       VARCHAR(255) UNIQUE NOT NULL,
            password    VARCHAR(255) NOT NULL,
            name        VARCHAR(255),
            role        VARCHAR(20) NOT NULL DEFAULT 'user',
            created_at  TIMESTAMP DEFAULT NOW()
        )
    """)

    # ── Folders ──
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS folders (
            id              SERIAL PRIMARY KEY,
            name            VARCHAR(100) NOT NULL,
            user_id         INT NOT NULL,
            drive_folder_id VARCHAR(255),
            parent_id       INT,
            created_by      INT,
            created_at      TIMESTAMP DEFAULT NOW(),
            CONSTRAINT fk_folders_user FOREIGN KEY (user_id) REFERENCES users(id),
            CONSTRAINT uq_folder_user UNIQUE (name, user_id)
        )
    """)

    # ── Files ──
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS files (
            id                        SERIAL PRIMARY KEY,
            file_name                 VARCHAR(500) NOT NULL,
            file_type                 VARCHAR(100),
            file_size                 BIGINT,
            drive_file_id             VARCHAR(255),
            drive_web_link            VARCHAR(1000),
            folder_id                 INT NOT NULL,
            user_id                   INT NOT NULL,
            status                    VARCHAR(20) NOT NULL DEFAULT 'pending',
            category                  VARCHAR(100),
            sub_category              VARCHAR(100),
            financial_year            VARCHAR(20),
            classification_confidence INT,
            reviewed_at               TIMESTAMP,
            reviewed_by               INT,
            created_at                TIMESTAMP DEFAULT NOW(),
            CONSTRAINT fk_files_folder FOREIGN KEY (folder_id) REFERENCES folders(id),
            CONSTRAINT fk_files_user   FOREIGN KEY (user_id)   REFERENCES users(id)
        )
    """)

    # ── Tasks ──
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id              SERIAL PRIMARY KEY,
            user_id         INT NOT NULL,
            assigned_by     INT NOT NULL,
            title           VARCHAR(500) NOT NULL,
            description     TEXT,
            status          VARCHAR(20) DEFAULT 'pending',
            created_at      TIMESTAMP DEFAULT NOW(),
            completed_at    TIMESTAMP,
            CONSTRAINT fk_tasks_user  FOREIGN KEY (user_id) REFERENCES users(id),
            CONSTRAINT fk_tasks_admin FOREIGN KEY (assigned_by) REFERENCES users(id)
        )
    """)

    # ── Notifications ──
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id              SERIAL PRIMARY KEY,
            user_id         INT NOT NULL,
            type            VARCHAR(50) NOT NULL,
            title           VARCHAR(500) NOT NULL,
            message         TEXT,
            is_read         BOOLEAN DEFAULT FALSE,
            related_id      INT,
            created_at      TIMESTAMP DEFAULT NOW(),
            CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    # ── Payments ──
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS payments (
            id               SERIAL PRIMARY KEY,
            user_id          INT NOT NULL,
            amount           DECIMAL(12,2) NOT NULL,
            payment_date     TIMESTAMP,
            payment_method   VARCHAR(50),
            reference_number VARCHAR(255),
            description      TEXT,
            status           VARCHAR(20) NOT NULL DEFAULT 'pending',
            due_date         TIMESTAMP,
            recorded_by      INT,
            created_at       TIMESTAMP DEFAULT NOW(),
            CONSTRAINT fk_payments_user  FOREIGN KEY (user_id) REFERENCES users(id),
            CONSTRAINT fk_payments_admin FOREIGN KEY (recorded_by) REFERENCES users(id)
        )
    """)

    # ── Billing Services ──
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS billing_services (
            id              SERIAL PRIMARY KEY,
            user_id         INT NOT NULL,
            service_name    VARCHAR(255) NOT NULL,
            amount          DECIMAL(12,2) NOT NULL,
            billing_period  VARCHAR(50),
            billing_date    TIMESTAMP DEFAULT NOW(),
            status          VARCHAR(20) NOT NULL DEFAULT 'pending',
            payment_id      INT,
            notes           TEXT,
            created_at      TIMESTAMP DEFAULT NOW(),
            CONSTRAINT fk_billing_user    FOREIGN KEY (user_id) REFERENCES users(id),
            CONSTRAINT fk_billing_payment FOREIGN KEY (payment_id) REFERENCES payments(id)
        )
    """)

    # ── Storage Quotas ──
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS storage_quotas (
            id              SERIAL PRIMARY KEY,
            user_id         INT NOT NULL UNIQUE,
            quota_bytes     BIGINT NOT NULL DEFAULT 1099511627776,
            used_bytes      BIGINT NOT NULL DEFAULT 0,
            plan_name       VARCHAR(50) NOT NULL DEFAULT 'free',
            upgraded_at     TIMESTAMP,
            created_at      TIMESTAMP DEFAULT NOW(),
            CONSTRAINT fk_storage_user FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    # ── File Shares ──
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS file_shares (
            id              SERIAL PRIMARY KEY,
            file_id         INT NOT NULL,
            shared_by       INT NOT NULL,
            shared_with     INT NOT NULL,
            permission      VARCHAR(20) NOT NULL DEFAULT 'view',
            expires_at      TIMESTAMP,
            created_at      TIMESTAMP DEFAULT NOW(),
            CONSTRAINT fk_shares_file FOREIGN KEY (file_id) REFERENCES files(id),
            CONSTRAINT fk_shares_by   FOREIGN KEY (shared_by) REFERENCES users(id),
            CONSTRAINT fk_shares_with FOREIGN KEY (shared_with) REFERENCES users(id),
            CONSTRAINT uq_share UNIQUE (file_id, shared_with)
        )
    """)

    # ── Workspace Documents ──
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS workspace_documents (
            id              SERIAL PRIMARY KEY,
            title           VARCHAR(500) NOT NULL,
            description     TEXT,
            file_name       VARCHAR(500) NOT NULL,
            file_size       BIGINT DEFAULT 0,
            file_path       VARCHAR(1000) NOT NULL,
            created_by      INT NOT NULL,
            updated_by      INT,
            version         INT NOT NULL DEFAULT 1,
            status          VARCHAR(20) NOT NULL DEFAULT 'draft',
            created_at      TIMESTAMP DEFAULT NOW(),
            updated_at      TIMESTAMP DEFAULT NOW(),
            CONSTRAINT fk_wsdoc_creator FOREIGN KEY (created_by) REFERENCES users(id),
            CONSTRAINT fk_wsdoc_updater FOREIGN KEY (updated_by) REFERENCES users(id)
        )
    """)

    # ── Workspace Shares ──
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS workspace_shares (
            id              SERIAL PRIMARY KEY,
            document_id     INT NOT NULL,
            shared_by       INT NOT NULL,
            shared_with     INT NOT NULL,
            permission      VARCHAR(20) NOT NULL DEFAULT 'view',
            created_at      TIMESTAMP DEFAULT NOW(),
            CONSTRAINT fk_wsshare_doc   FOREIGN KEY (document_id) REFERENCES workspace_documents(id),
            CONSTRAINT fk_wsshare_by    FOREIGN KEY (shared_by) REFERENCES users(id),
            CONSTRAINT fk_wsshare_with  FOREIGN KEY (shared_with) REFERENCES users(id),
            CONSTRAINT uq_wsshare UNIQUE (document_id, shared_with)
        )
    """)

    # ── Classification Logs ──
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS classification_logs (
            id                  SERIAL PRIMARY KEY,
            file_id             INT NOT NULL,
            user_id             INT NOT NULL,
            category            VARCHAR(100) NOT NULL,
            sub_category        VARCHAR(100) NOT NULL,
            financial_year      VARCHAR(20),
            month               VARCHAR(20),
            confidence_score    INT NOT NULL DEFAULT 0,
            suggested_name      VARCHAR(500),
            folder_path         VARCHAR(1000),
            needs_review        BOOLEAN DEFAULT FALSE,
            reviewed            BOOLEAN DEFAULT FALSE,
            reviewed_by         INT,
            source              VARCHAR(50),
            matched_keywords    TEXT,
            raw_result          TEXT,
            created_at          TIMESTAMP DEFAULT NOW(),
            CONSTRAINT fk_classlog_file FOREIGN KEY (file_id) REFERENCES files(id),
            CONSTRAINT fk_classlog_user FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    conn.commit()
    cursor.close()
    conn.close()
    print("[DB] Tables initialized successfully.")
