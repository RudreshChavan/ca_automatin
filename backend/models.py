"""
Database model helpers — raw SQL CRUD operations.
"""

from database import get_connection


# ───────────────────────── Users ─────────────────────────

def create_user(email: str, hashed_password: str, name: str = None, role: str = "user") -> dict:
    """Insert a new user and return their record."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO users (email, password, name, role) VALUES (%s, %s, %s, %s) RETURNING id, email, name, role, created_at",
        (email, hashed_password, name, role),
    )
    row = cursor.fetchone()
    conn.commit()
    user = {"id": row[0], "email": row[1], "name": row[2], "role": row[3], "created_at": str(row[4])}
    cursor.close()
    conn.close()
    return user


def get_user_by_email(email: str) -> dict | None:
    """Find a user by email."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, email, password, name, role, created_at FROM users WHERE email = %s", (email,))
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if not row:
        return None
    return {"id": row[0], "email": row[1], "password": row[2], "name": row[3], "role": row[4], "created_at": str(row[5])}


def get_user_by_id(user_id: int) -> dict | None:
    """Find a user by ID."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, email, name, role, created_at FROM users WHERE id = %s", (user_id,))
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if not row:
        return None
    return {"id": row[0], "email": row[1], "name": row[2], "role": row[3], "created_at": str(row[4])}


def get_user_count() -> int:
    """Count total users in the system."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM users")
    count = cursor.fetchone()[0]
    cursor.close()
    conn.close()
    return count


def get_all_users() -> list:
    """Get all users with file and folder counts (admin)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT u.id, u.email, u.name, u.role, u.created_at,
               (SELECT COUNT(*) FROM files WHERE user_id = u.id) AS file_count,
               (SELECT COUNT(*) FROM folders WHERE user_id = u.id) AS folder_count,
               (SELECT COALESCE(SUM(file_size), 0) FROM files WHERE user_id = u.id) AS total_size
        FROM users u
        ORDER BY u.created_at DESC
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "id": r[0], "email": r[1], "name": r[2], "role": r[3],
            "created_at": str(r[4]), "file_count": r[5],
            "folder_count": r[6], "total_size": r[7],
        }
        for r in rows
    ]


def delete_user(user_id: int) -> bool:
    """Delete a user and all their files/folders. Returns True if deleted."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        # Delete files first (FK constraint)
        cursor.execute("DELETE FROM files WHERE user_id = %s", (user_id,))
        # Delete folders
        cursor.execute("DELETE FROM folders WHERE user_id = %s", (user_id,))
        # Delete tasks (both assigned to and assigned by)
        cursor.execute("DELETE FROM tasks WHERE user_id = %s OR assigned_by = %s", (user_id, user_id))
        # Delete billing services and payments
        cursor.execute("DELETE FROM billing_services WHERE user_id = %s", (user_id,))
        cursor.execute("DELETE FROM payments WHERE user_id = %s OR recorded_by = %s", (user_id, user_id))
        # Delete storage quotas
        cursor.execute("DELETE FROM storage_quotas WHERE user_id = %s", (user_id,))
        # Delete notifications
        cursor.execute("DELETE FROM notifications WHERE user_id = %s", (user_id,))
        # Delete user
        cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted
    except Exception as e:
        conn.rollback()
        print(f"[DB] Error deleting user {user_id}: {e}")
        return False
    finally:
        cursor.close()
        conn.close()


# ───────────────────────── Folders ─────────────────────────

def create_folder(name: str, user_id: int, drive_folder_id: str = None) -> dict:
    """Create a folder for a user."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO folders (name, user_id, drive_folder_id) VALUES (%s, %s, %s) RETURNING id, name, drive_folder_id, created_at",
        (name, user_id, drive_folder_id),
    )
    row = cursor.fetchone()
    conn.commit()
    folder = {"id": row[0], "name": row[1], "drive_folder_id": row[2], "created_at": str(row[3])}
    cursor.close()
    conn.close()
    return folder


def update_folder_drive_id(folder_id: int, drive_folder_id: str):
    """Update the Google Drive folder ID for a folder."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE folders SET drive_folder_id = %s WHERE id = %s",
        (drive_folder_id, folder_id),
    )
    conn.commit()
    cursor.close()
    conn.close()


def get_user_folders(user_id: int) -> list:
    """Get all folders for a user with file counts."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT f.id, f.name, f.drive_folder_id, f.created_at,
               (SELECT COUNT(*) FROM files WHERE folder_id = f.id) AS file_count
        FROM folders f
        WHERE f.user_id = %s
        ORDER BY f.name
    """, (user_id,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "id": r[0],
            "name": r[1],
            "drive_folder_id": r[2],
            "created_at": str(r[3]),
            "file_count": r[4],
        }
        for r in rows
    ]


def get_folder_by_name(user_id: int, folder_name: str) -> dict | None:
    """Get a specific folder by name for a user."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, name, drive_folder_id, created_at FROM folders WHERE user_id = %s AND name = %s",
        (user_id, folder_name),
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if not row:
        return None
    return {"id": row[0], "name": row[1], "drive_folder_id": row[2], "created_at": str(row[3])}


def get_folder_by_id(folder_id: int, user_id: int) -> dict | None:
    """Get a specific folder by ID (scoped to user)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, name, drive_folder_id, created_at FROM folders WHERE id = %s AND user_id = %s",
        (folder_id, user_id),
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if not row:
        return None
    return {"id": row[0], "name": row[1], "drive_folder_id": row[2], "created_at": str(row[3])}


def move_file_to_folder(file_id: int, new_folder_id: int) -> bool:
    """Move a file to a different folder by updating its folder_id."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE files SET folder_id = %s WHERE id = %s",
        (new_folder_id, file_id),
    )
    affected = cursor.rowcount
    conn.commit()
    cursor.close()
    conn.close()
    return affected > 0


# ───────────────────────── Files ─────────────────────────

def create_file(file_name: str, file_type: str, file_size: int,
                drive_file_id: str, drive_web_link: str,
                folder_id: int, user_id: int) -> dict:
    """Insert a file metadata record."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO files (file_name, file_type, file_size, drive_file_id, drive_web_link, folder_id, user_id)
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id, file_name, file_type, file_size,
                  drive_file_id, drive_web_link, folder_id,
                  user_id, created_at""",
        (file_name, file_type, file_size, drive_file_id, drive_web_link, folder_id, user_id),
    )
    row = cursor.fetchone()
    conn.commit()
    result = _file_row_to_dict(row)
    cursor.close()
    conn.close()
    return result


def get_files(user_id: int, folder_id: int = None, search: str = None, status: str = None) -> list:
    """List files for a user with optional folder, search, and status filters."""
    conn = get_connection()
    cursor = conn.cursor()

    query = """
        SELECT f.id, f.file_name, f.file_type, f.file_size,
               f.drive_file_id, f.drive_web_link, f.folder_id,
               f.user_id, f.created_at, fo.name AS folder_name,
               f.status, f.category, f.reviewed_at,
               f.sub_category, f.financial_year, f.classification_confidence
        FROM files f
        JOIN folders fo ON f.folder_id = fo.id
        WHERE f.user_id = %s
    """
    params = [user_id]

    if folder_id:
        query += " AND f.folder_id = %s"
        params.append(folder_id)

    if search:
        query += " AND f.file_name LIKE %s"
        params.append(f"%{search}%")

    if status:
        query += " AND f.status = %s"
        params.append(status)

    query += " ORDER BY f.created_at DESC"

    cursor.execute(query, params)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    return [
        {
            "id": r[0], "file_name": r[1], "file_type": r[2], "file_size": r[3],
            "drive_file_id": r[4], "drive_web_link": r[5], "folder_id": r[6],
            "user_id": r[7], "created_at": str(r[8]), "folder_name": r[9],
            "status": r[10], "category": r[11], "reviewed_at": str(r[12]) if r[12] else None,
            "sub_category": r[13], "financial_year": r[14],
            "classification_confidence": r[15],
        }
        for r in rows
    ]


def get_all_files(user_id_filter: int = None, folder_id_filter: int = None, search: str = None, status: str = None) -> list:
    """List files across ALL users (admin). Full access including file links."""
    conn = get_connection()
    cursor = conn.cursor()

    query = """
        SELECT f.id, f.file_name, f.file_type, f.file_size,
               f.drive_file_id, f.drive_web_link, f.folder_id,
               f.user_id, f.created_at, fo.name AS folder_name,
               u.email AS user_email,
               f.status, f.category, f.reviewed_at,
               f.sub_category, f.financial_year, f.classification_confidence
        FROM files f
        JOIN folders fo ON f.folder_id = fo.id
        JOIN users u ON f.user_id = u.id
        WHERE 1=1
    """
    params = []

    if user_id_filter:
        query += " AND f.user_id = %s"
        params.append(user_id_filter)

    if folder_id_filter:
        query += " AND f.folder_id = %s"
        params.append(folder_id_filter)

    if search:
        query += " AND f.file_name LIKE %s"
        params.append(f"%{search}%")

    if status:
        query += " AND f.status = %s"
        params.append(status)

    query += " ORDER BY f.created_at DESC"

    cursor.execute(query, params)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    return [
        {
            "id": r[0], "file_name": r[1], "file_type": r[2], "file_size": r[3],
            "drive_file_id": r[4], "drive_web_link": r[5], "folder_id": r[6],
            "user_id": r[7], "created_at": str(r[8]), "folder_name": r[9],
            "user_email": r[10],
            "status": r[11], "category": r[12], "reviewed_at": str(r[13]) if r[13] else None,
            "sub_category": r[14], "financial_year": r[15],
            "classification_confidence": r[16],
        }
        for r in rows
    ]


def get_file_by_id(file_id: int, user_id: int) -> dict | None:
    """Get a single file by ID (scoped to user)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """SELECT f.id, f.file_name, f.file_type, f.file_size,
                  f.drive_file_id, f.drive_web_link, f.folder_id,
                  f.user_id, f.created_at, fo.name AS folder_name
           FROM files f
           JOIN folders fo ON f.folder_id = fo.id
           WHERE f.id = %s AND f.user_id = %s""",
        (file_id, user_id),
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if not row:
        return None
    return {
        "id": row[0], "file_name": row[1], "file_type": row[2], "file_size": row[3],
        "drive_file_id": row[4], "drive_web_link": row[5], "folder_id": row[6],
        "user_id": row[7], "created_at": str(row[8]), "folder_name": row[9],
    }


def get_file_by_id_admin(file_id: int) -> dict | None:
    """Get a single file by ID (no user scoping — admin)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """SELECT f.id, f.file_name, f.file_type, f.file_size,
                  f.drive_file_id, f.drive_web_link, f.folder_id,
                  f.user_id, f.created_at, fo.name AS folder_name
           FROM files f
           JOIN folders fo ON f.folder_id = fo.id
           WHERE f.id = %s""",
        (file_id,),
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if not row:
        return None
    return {
        "id": row[0], "file_name": row[1], "file_type": row[2], "file_size": row[3],
        "drive_file_id": row[4], "drive_web_link": row[5], "folder_id": row[6],
        "user_id": row[7], "created_at": str(row[8]), "folder_name": row[9],
    }


def delete_file(file_id: int, user_id: int) -> bool:
    """Delete a file record. Returns True if deleted."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM files WHERE id = %s AND user_id = %s", (file_id, user_id))
    deleted = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return deleted


def delete_file_admin(file_id: int) -> bool:
    """Delete any file record without user scoping (admin). Returns True if deleted."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM files WHERE id = %s", (file_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return deleted


def get_dashboard_stats(user_id: int) -> dict:
    """Get dashboard statistics for a user."""
    conn = get_connection()
    cursor = conn.cursor()

    # Total files + total size
    cursor.execute(
        "SELECT COUNT(*), COALESCE(SUM(file_size), 0) FROM files WHERE user_id = %s",
        (user_id,),
    )
    total_files, total_size = cursor.fetchone()

    # Per-folder counts
    cursor.execute("""
        SELECT fo.name, COUNT(f.id)
        FROM folders fo
        LEFT JOIN files f ON f.folder_id = fo.id
        WHERE fo.user_id = %s
        GROUP BY fo.name
    """, (user_id,))
    folder_counts = {r[0]: r[1] for r in cursor.fetchall()}

    # Recent uploads (last 10)
    cursor.execute("""
        SELECT f.id, f.file_name, f.file_type, f.file_size,
               f.drive_web_link, f.created_at, fo.name AS folder_name
        FROM files f
        JOIN folders fo ON f.folder_id = fo.id
        WHERE f.user_id = %s
        ORDER BY f.created_at DESC
        LIMIT 10
    """, (user_id,))
    recent = [
        {
            "id": r[0], "file_name": r[1], "file_type": r[2], "file_size": r[3],
            "drive_web_link": r[4], "created_at": str(r[5]), "folder_name": r[6],
        }
        for r in cursor.fetchall()
    ]

    cursor.close()
    conn.close()

    return {
        "total_files": total_files,
        "total_size": total_size,
        "folder_counts": folder_counts,
        "recent_uploads": recent,
    }


def get_admin_dashboard_stats() -> dict:
    """Get admin dashboard statistics — across ALL users. Full data."""
    conn = get_connection()
    cursor = conn.cursor()

    # Total users
    cursor.execute("SELECT COUNT(*) FROM users")
    total_users = cursor.fetchone()[0]

    # Total files + total size
    cursor.execute("SELECT COUNT(*), COALESCE(SUM(file_size), 0) FROM files")
    total_files, total_size = cursor.fetchone()

    # Recent uploads (last 15, full metadata)
    cursor.execute("""
        SELECT f.id, f.file_name, f.file_type, f.file_size,
               f.drive_web_link, f.created_at, fo.name AS folder_name,
               u.email AS user_email
        FROM files f
        JOIN folders fo ON f.folder_id = fo.id
        JOIN users u ON f.user_id = u.id
        ORDER BY f.created_at DESC
        LIMIT 15
    """)
    recent = [
        {
            "id": r[0], "file_name": r[1], "file_type": r[2], "file_size": r[3],
            "drive_web_link": r[4], "created_at": str(r[5]), "folder_name": r[6],
            "user_email": r[7],
        }
        for r in cursor.fetchall()
    ]

    # Per-type counts
    cursor.execute("""
        SELECT
            SUM(CASE WHEN f.file_type LIKE 'image/%' THEN 1 ELSE 0 END) AS images,
            SUM(CASE WHEN f.file_type LIKE 'video/%' THEN 1 ELSE 0 END) AS videos,
            SUM(CASE WHEN f.file_type LIKE 'text/%' OR f.file_type LIKE '%pdf%' OR f.file_type LIKE '%document%' OR f.file_type LIKE '%sheet%' THEN 1 ELSE 0 END) AS documents
        FROM files f
    """)
    type_row = cursor.fetchone()
    type_counts = {
        "images": type_row[0] or 0,
        "videos": type_row[1] or 0,
        "documents": type_row[2] or 0,
    }

    # Files per user breakdown
    cursor.execute("""
        SELECT u.email, COUNT(f.id) AS file_count, COALESCE(SUM(f.file_size), 0) AS total_size
        FROM users u
        LEFT JOIN files f ON f.user_id = u.id
        GROUP BY u.email
        ORDER BY file_count DESC
    """)
    files_per_user = [
        {"email": r[0], "file_count": r[1], "total_size": r[2]}
        for r in cursor.fetchall()
    ]

    cursor.close()
    conn.close()

    return {
        "total_users": total_users,
        "total_files": total_files,
        "total_size": total_size,
        "type_counts": type_counts,
        "recent_uploads": recent,
        "files_per_user": files_per_user,
    }


def _file_row_to_dict(row) -> dict:
    """Convert a file OUTPUT row to dict."""
    return {
        "id": row[0], "file_name": row[1], "file_type": row[2], "file_size": row[3],
        "drive_file_id": row[4], "drive_web_link": row[5], "folder_id": row[6],
        "user_id": row[7], "created_at": str(row[8]),
    }


# ── USER STATS ──

def get_user_stats(user_id: int) -> dict:
    """Get basic file stats for a specific user (admin view)."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT COUNT(*), COALESCE(SUM(file_size), 0) FROM files WHERE user_id = %s",
        (user_id,)
    )
    row = cursor.fetchone()

    cursor.close()
    conn.close()

    return {
        "total_files": row[0] or 0,
        "total_size": row[1] or 0
    }


# ── TASK ASSIGNMENT SYSTEM ──

def create_task(user_id: int, assigned_by: int, title: str, description: str = None) -> dict:
    """Create a new task assigned to a user."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO tasks (user_id, assigned_by, title, description)
        VALUES (%s, %s, %s, %s) RETURNING id, user_id, assigned_by, title,
               description, status, created_at
    """, (user_id, assigned_by, title, description))

    row = cursor.fetchone()
    conn.commit()
    cursor.close()
    conn.close()

    return {
        "id": row[0], "user_id": row[1], "assigned_by": row[2],
        "title": row[3], "description": row[4],
        "status": row[5], "created_at": str(row[6])
    }


def get_user_tasks(user_id: int) -> list:
    """Get all pending tasks assigned to a user."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT t.id, t.title, t.description, t.status, t.created_at, u.email AS assigned_by_email
        FROM tasks t
        JOIN users u ON t.assigned_by = u.id
        WHERE t.user_id = %s AND t.status = 'pending'
        ORDER BY t.created_at DESC
    """, (user_id,))

    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    return [
        {
            "id": r[0], "title": r[1], "description": r[2],
            "status": r[3], "created_at": str(r[4]),
            "assigned_by_email": r[5]
        }
        for r in rows
    ]


def mark_task_done(task_id: int, user_id: int) -> bool:
    """Mark a task as done — updates status and sets completed_at timestamp."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE tasks SET status = 'done', completed_at = NOW() WHERE id = %s AND user_id = %s AND status = 'pending'",
        (task_id, user_id)
    )
    updated = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return updated


def get_completed_tasks() -> list:
    """Get all completed tasks across all users (admin view)."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT t.id, t.title, t.description, t.status, t.created_at, t.completed_at,
               u.email AS user_email, u.name AS user_name,
               a.email AS assigned_by_email
        FROM tasks t
        JOIN users u ON t.user_id = u.id
        JOIN users a ON t.assigned_by = a.id
        WHERE t.status = 'done'
        ORDER BY t.completed_at DESC
    """)

    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    return [
        {
            "id": r[0], "title": r[1], "description": r[2],
            "status": r[3], "created_at": str(r[4]),
            "completed_at": str(r[5]) if r[5] else None,
            "user_email": r[6], "user_name": r[7],
            "assigned_by_email": r[8]
        }
        for r in rows
    ]


def get_all_tasks() -> list:
    """Get all tasks across all users (admin view)."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT t.id, t.title, t.description, t.status, t.created_at, t.completed_at,
               t.user_id, u.email AS user_email, u.name AS user_name,
               a.email AS assigned_by_email
        FROM tasks t
        JOIN users u ON t.user_id = u.id
        JOIN users a ON t.assigned_by = a.id
        ORDER BY t.created_at DESC
    """)

    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    return [
        {
            "id": r[0], "title": r[1], "description": r[2],
            "status": r[3], "created_at": str(r[4]),
            "completed_at": str(r[5]) if r[5] else None,
            "user_id": r[6], "user_email": r[7], "user_name": r[8],
            "assigned_by_email": r[9]
        }
        for r in rows
    ]


def get_user_task_count(user_id: int) -> int:
    """Get the count of pending tasks for a user."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COUNT(*) FROM tasks WHERE user_id = %s AND status = 'pending'",
        (user_id,)
    )
    count = cursor.fetchone()[0]
    cursor.close()
    conn.close()
    return count


# ───────────────────────── Notifications ─────────────────────────

def create_notification(user_id: int, notif_type: str, title: str, message: str = None, related_id: int = None) -> dict:
    """Create a notification for a user."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO notifications (user_id, type, title, message, related_id)
           VALUES (%s, %s, %s, %s, %s) RETURNING id, user_id, type, title,
                  message, is_read, related_id, created_at""",
        (user_id, notif_type, title, message, related_id),
    )
    row = cursor.fetchone()
    conn.commit()
    result = {
        "id": row[0], "user_id": row[1], "type": row[2], "title": row[3],
        "message": row[4], "is_read": bool(row[5]), "related_id": row[6],
        "created_at": str(row[7]),
    }
    cursor.close()
    conn.close()
    return result


def get_user_notifications(user_id: int, limit: int = 50) -> list:
    """Get notifications for a user, most recent first."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(f"""
        SELECT id, user_id, type, title, message, is_read, related_id, created_at
        FROM notifications
        WHERE user_id = %s
        ORDER BY created_at DESC
        LIMIT {limit}
    """, (user_id,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "id": r[0], "user_id": r[1], "type": r[2], "title": r[3],
            "message": r[4], "is_read": bool(r[5]), "related_id": r[6],
            "created_at": str(r[7]),
        }
        for r in rows
    ]


def get_unread_notification_count(user_id: int) -> int:
    """Get count of unread notifications."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COUNT(*) FROM notifications WHERE user_id = %s AND is_read = FALSE",
        (user_id,),
    )
    count = cursor.fetchone()[0]
    cursor.close()
    conn.close()
    return count


def mark_notification_read(notification_id: int, user_id: int) -> bool:
    """Mark a single notification as read."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE notifications SET is_read = TRUE WHERE id = %s AND user_id = %s",
        (notification_id, user_id),
    )
    updated = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return updated


def mark_all_notifications_read(user_id: int) -> int:
    """Mark all notifications as read for a user. Returns count updated."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE notifications SET is_read = TRUE WHERE user_id = %s AND is_read = FALSE",
        (user_id,),
    )
    count = cursor.rowcount
    conn.commit()
    cursor.close()
    conn.close()
    return count


def notify_admins(notif_type: str, title: str, message: str = None, related_id: int = None):
    """Send a notification to all admin users."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE role = 'admin'")
    admin_ids = [r[0] for r in cursor.fetchall()]
    cursor.close()
    conn.close()

    for admin_id in admin_ids:
        create_notification(admin_id, notif_type, title, message, related_id)


# ───────────────────────── File Workflow ─────────────────────────

def update_file_status(file_id: int, status: str, reviewed_by: int = None) -> bool:
    """Update file status (pending → reviewed). Sets reviewed_at timestamp."""
    conn = get_connection()
    cursor = conn.cursor()
    if status == "reviewed" and reviewed_by:
        cursor.execute(
            "UPDATE files SET status = %s, reviewed_at = NOW(), reviewed_by = %s WHERE id = %s",
            (status, reviewed_by, file_id),
        )
    else:
        cursor.execute(
            "UPDATE files SET status = %s WHERE id = %s",
            (status, file_id),
        )
    updated = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return updated


def update_file_category(file_id: int, category: str) -> bool:
    """Update the smart category of a file."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE files SET category = %s WHERE id = %s",
        (category, file_id),
    )
    updated = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return updated


def get_pending_files() -> list:
    """Get all files with 'pending' status (admin — pending review)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT f.id, f.file_name, f.file_type, f.file_size,
               f.drive_file_id, f.drive_web_link, f.folder_id,
               f.user_id, f.created_at, fo.name AS folder_name,
               u.email AS user_email, u.name AS user_name,
               f.status, f.category
        FROM files f
        JOIN folders fo ON f.folder_id = fo.id
        JOIN users u ON f.user_id = u.id
        WHERE f.status = 'pending'
        ORDER BY f.created_at DESC
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "id": r[0], "file_name": r[1], "file_type": r[2], "file_size": r[3],
            "drive_file_id": r[4], "drive_web_link": r[5], "folder_id": r[6],
            "user_id": r[7], "created_at": str(r[8]), "folder_name": r[9],
            "user_email": r[10], "user_name": r[11],
            "status": r[12], "category": r[13],
        }
        for r in rows
    ]


def get_pending_files_count() -> int:
    """Get count of files pending review."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM files WHERE status = 'pending'")
    count = cursor.fetchone()[0]
    cursor.close()
    conn.close()
    return count


# ───────────────────────── Admin Folder Management ─────────────────────────

def create_folder_for_client(name: str, user_id: int, created_by: int, parent_id: int = None, drive_folder_id: str = None) -> dict:
    """Create a folder for a client (admin action)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO folders (name, user_id, drive_folder_id, parent_id, created_by) VALUES (%s, %s, %s, %s, %s) RETURNING id, name, drive_folder_id, created_at""",
        (name, user_id, drive_folder_id, parent_id, created_by),
    )
    row = cursor.fetchone()
    conn.commit()
    folder = {"id": row[0], "name": row[1], "drive_folder_id": row[2], "created_at": str(row[3])}
    cursor.close()
    conn.close()
    return folder


def get_all_folders_admin(user_id: int = None) -> list:
    """Get all folders, optionally filtered by user (admin view)."""
    conn = get_connection()
    cursor = conn.cursor()

    query = """
        SELECT f.id, f.name, f.user_id, f.drive_folder_id, f.created_at, f.parent_id, f.created_by,
               u.email AS user_email,
               (SELECT COUNT(*) FROM files WHERE folder_id = f.id) AS file_count
        FROM folders f
        JOIN users u ON f.user_id = u.id
    """
    params = []
    if user_id:
        query += " WHERE f.user_id = %s"
        params.append(user_id)

    query += " ORDER BY f.name"

    cursor.execute(query, params)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "id": r[0], "name": r[1], "user_id": r[2], "drive_folder_id": r[3],
            "created_at": str(r[4]), "parent_id": r[5], "created_by": r[6],
            "user_email": r[7], "file_count": r[8],
        }
        for r in rows
    ]



# ───────────────────────── Storage Quotas ─────────────────────────

ONE_TB = 1099511627776  # 1 TB in bytes


def create_storage_quota(user_id: int, quota_bytes: int = ONE_TB, plan_name: str = "free") -> dict:
    """Initialize storage quota for a new user (1 TB free by default)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """INSERT INTO storage_quotas (user_id, quota_bytes, plan_name)
               VALUES (%s, %s, %s) RETURNING id, user_id, quota_bytes,
                      used_bytes, plan_name, created_at""",
            (user_id, quota_bytes, plan_name),
        )
        row = cursor.fetchone()
        conn.commit()
        return {
            "id": row[0], "user_id": row[1], "quota_bytes": row[2],
            "used_bytes": row[3], "plan_name": row[4], "created_at": str(row[5]),
        }
    except Exception as e:
        conn.rollback()
        print(f"[DB] Storage quota may already exist for user {user_id}: {e}")
        return get_storage_quota(user_id)
    finally:
        cursor.close()
        conn.close()


def get_storage_quota(user_id: int) -> dict | None:
    """Get storage quota info for a user."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """SELECT sq.id, sq.user_id, sq.quota_bytes, sq.used_bytes, sq.plan_name,
                  sq.upgraded_at, sq.created_at,
                  (SELECT COALESCE(SUM(file_size), 0) FROM files WHERE user_id = sq.user_id) AS actual_used
           FROM storage_quotas sq WHERE sq.user_id = %s""",
        (user_id,),
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if not row:
        return None
    return {
        "id": row[0], "user_id": row[1], "quota_bytes": row[2],
        "used_bytes": row[3], "plan_name": row[4],
        "upgraded_at": str(row[5]) if row[5] else None,
        "created_at": str(row[6]), "actual_used": row[7],
    }


def get_all_storage_quotas() -> list:
    """Get storage quotas for all users (admin view)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT sq.id, sq.user_id, sq.quota_bytes, sq.used_bytes, sq.plan_name,
               sq.upgraded_at, sq.created_at, u.email, u.name,
               (SELECT COALESCE(SUM(file_size), 0) FROM files WHERE user_id = sq.user_id) AS actual_used
        FROM storage_quotas sq
        JOIN users u ON sq.user_id = u.id
        ORDER BY actual_used DESC
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "id": r[0], "user_id": r[1], "quota_bytes": r[2], "used_bytes": r[3],
            "plan_name": r[4], "upgraded_at": str(r[5]) if r[5] else None,
            "created_at": str(r[6]), "user_email": r[7], "user_name": r[8],
            "actual_used": r[9],
        }
        for r in rows
    ]


def update_storage_used(user_id: int) -> int:
    """Recalculate and update used_bytes from files table. Returns new used_bytes."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COALESCE(SUM(file_size), 0) FROM files WHERE user_id = %s", (user_id,)
    )
    used = cursor.fetchone()[0]
    cursor.execute(
        "UPDATE storage_quotas SET used_bytes = %s WHERE user_id = %s", (used, user_id)
    )
    conn.commit()
    cursor.close()
    conn.close()
    return used


def upgrade_storage(user_id: int, plan_name: str, quota_bytes: int) -> bool:
    """Upgrade a user's storage plan."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE storage_quotas SET plan_name = %s, quota_bytes = %s, upgraded_at = NOW() WHERE user_id = %s",
        (plan_name, quota_bytes, user_id),
    )
    updated = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return updated


# ───────────────────────── Payments ─────────────────────────

def create_payment(user_id: int, amount: float, description: str = None,
                   payment_method: str = None, reference_number: str = None,
                   status: str = "pending", due_date: str = None,
                   recorded_by: int = None, payment_date: str = None) -> dict:
    """Record a new payment entry."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO payments (user_id, amount, description, payment_method,
                reference_number, status, due_date, recorded_by, payment_date)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, user_id, amount, description,
                  payment_method, reference_number, status,
                  due_date, recorded_by, payment_date,
                  created_at""",
        (user_id, amount, description, payment_method, reference_number,
         status, due_date, recorded_by, payment_date),
    )
    row = cursor.fetchone()
    conn.commit()
    result = {
        "id": row[0], "user_id": row[1], "amount": float(row[2]),
        "description": row[3], "payment_method": row[4],
        "reference_number": row[5], "status": row[6],
        "due_date": str(row[7]) if row[7] else None,
        "recorded_by": row[8],
        "payment_date": str(row[9]) if row[9] else None,
        "created_at": str(row[10]),
    }
    cursor.close()
    conn.close()
    return result


def get_user_payments(user_id: int) -> list:
    """Get payment history for a specific client."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT p.id, p.user_id, p.amount, p.description, p.payment_method,
               p.reference_number, p.status, p.due_date, p.recorded_by,
               p.payment_date, p.created_at,
               a.email AS recorded_by_email
        FROM payments p
        LEFT JOIN users a ON p.recorded_by = a.id
        WHERE p.user_id = %s
        ORDER BY p.created_at DESC
    """, (user_id,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "id": r[0], "user_id": r[1], "amount": float(r[2]),
            "description": r[3], "payment_method": r[4],
            "reference_number": r[5], "status": r[6],
            "due_date": str(r[7]) if r[7] else None,
            "recorded_by": r[8],
            "payment_date": str(r[9]) if r[9] else None,
            "created_at": str(r[10]),
            "recorded_by_email": r[11],
        }
        for r in rows
    ]


def get_all_payments(status_filter: str = None, user_id_filter: int = None) -> list:
    """Get all payments across all users (admin)."""
    conn = get_connection()
    cursor = conn.cursor()
    query = """
        SELECT p.id, p.user_id, p.amount, p.description, p.payment_method,
               p.reference_number, p.status, p.due_date, p.recorded_by,
               p.payment_date, p.created_at,
               u.email AS user_email, u.name AS user_name,
               a.email AS recorded_by_email
        FROM payments p
        JOIN users u ON p.user_id = u.id
        LEFT JOIN users a ON p.recorded_by = a.id
        WHERE 1=1
    """
    params = []
    if status_filter:
        query += " AND p.status = %s"
        params.append(status_filter)
    if user_id_filter:
        query += " AND p.user_id = %s"
        params.append(user_id_filter)
    query += " ORDER BY p.created_at DESC"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "id": r[0], "user_id": r[1], "amount": float(r[2]),
            "description": r[3], "payment_method": r[4],
            "reference_number": r[5], "status": r[6],
            "due_date": str(r[7]) if r[7] else None,
            "recorded_by": r[8],
            "payment_date": str(r[9]) if r[9] else None,
            "created_at": str(r[10]),
            "user_email": r[11], "user_name": r[12],
            "recorded_by_email": r[13],
        }
        for r in rows
    ]


def get_pending_payments() -> list:
    """Get all pending or overdue payments."""
    return get_all_payments(status_filter="pending")


def update_payment_status(payment_id: int, status: str, payment_date: str = None,
                          payment_method: str = None, reference_number: str = None) -> bool:
    """Update payment status (pending -> received, etc.)."""
    conn = get_connection()
    cursor = conn.cursor()
    if status == "received":
        cursor.execute(
            """UPDATE payments SET status = %s, payment_date = COALESCE(%s, NOW()),
                      payment_method = COALESCE(%s, payment_method),
                      reference_number = COALESCE(%s, reference_number)
               WHERE id = %s""",
            (status, payment_date, payment_method, reference_number, payment_id),
        )
    else:
        cursor.execute("UPDATE payments SET status = %s WHERE id = %s", (status, payment_id))
    updated = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return updated


def get_payment_summary() -> dict:
    """Get payment summary for billing dashboard."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'received'")
    total_received = float(cursor.fetchone()[0])
    cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'pending'")
    total_pending = float(cursor.fetchone()[0])
    cursor.execute("""
        SELECT COALESCE(SUM(amount), 0) FROM payments
        WHERE status = 'received'
        AND EXTRACT(MONTH FROM payment_date) = EXTRACT(MONTH FROM NOW())
        AND EXTRACT(YEAR FROM payment_date) = EXTRACT(YEAR FROM NOW())
    """)
    this_month = float(cursor.fetchone()[0])
    cursor.execute("""
        SELECT EXTRACT(YEAR FROM COALESCE(payment_date, created_at))::INT AS yr,
            EXTRACT(MONTH FROM COALESCE(payment_date, created_at))::INT AS mn,
            SUM(CASE WHEN status = 'received' THEN amount ELSE 0 END) AS received,
            SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS pending,
            COUNT(*) AS count
        FROM payments
        GROUP BY EXTRACT(YEAR FROM COALESCE(payment_date, created_at))::INT, EXTRACT(MONTH FROM COALESCE(payment_date, created_at))::INT
        ORDER BY yr DESC, mn DESC
        LIMIT 12
    """)
    monthly = [
        {"year": r[0], "month": r[1], "received": float(r[2]),
         "pending": float(r[3]), "count": r[4]}
        for r in cursor.fetchall()
    ]
    cursor.close()
    conn.close()
    return {"total_received": total_received, "total_pending": total_pending,
            "this_month": this_month, "monthly": monthly}


# ───────────────────────── Billing Services ─────────────────────────

def create_billing_service(user_id: int, service_name: str, amount: float,
                           billing_period: str = None, notes: str = None) -> dict:
    """Add a service charge for a client."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO billing_services (user_id, service_name, amount, billing_period, notes)
           VALUES (%s, %s, %s, %s, %s) RETURNING id, user_id, service_name,
                  amount, billing_period, billing_date,
                  status, notes, created_at""",
        (user_id, service_name, amount, billing_period, notes),
    )
    row = cursor.fetchone()
    conn.commit()
    result = {
        "id": row[0], "user_id": row[1], "service_name": row[2],
        "amount": float(row[3]), "billing_period": row[4],
        "billing_date": str(row[5]), "status": row[6],
        "notes": row[7], "created_at": str(row[8]),
    }
    cursor.close()
    conn.close()
    return result


def get_user_billing(user_id: int) -> list:
    """Get billing services for a specific client."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT bs.id, bs.user_id, bs.service_name, bs.amount, bs.billing_period,
               bs.billing_date, bs.status, bs.payment_id, bs.notes, bs.created_at
        FROM billing_services bs
        WHERE bs.user_id = %s
        ORDER BY bs.created_at DESC
    """, (user_id,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "id": r[0], "user_id": r[1], "service_name": r[2],
            "amount": float(r[3]), "billing_period": r[4],
            "billing_date": str(r[5]), "status": r[6],
            "payment_id": r[7], "notes": r[8], "created_at": str(r[9]),
        }
        for r in rows
    ]


def get_billing_overview() -> list:
    """Client-wise billing overview (admin)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT u.id, u.email, u.name,
               COALESCE(SUM(bs.amount), 0) AS total_billed,
               SUM(CASE WHEN bs.status = 'paid' THEN bs.amount ELSE 0 END) AS total_paid,
               SUM(CASE WHEN bs.status = 'pending' THEN bs.amount ELSE 0 END) AS total_pending,
               COUNT(bs.id) AS service_count
        FROM users u
        LEFT JOIN billing_services bs ON bs.user_id = u.id
        WHERE u.role = 'user'
        GROUP BY u.id, u.email, u.name
        ORDER BY total_billed DESC
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "user_id": r[0], "user_email": r[1], "user_name": r[2],
            "total_billed": float(r[3]), "total_paid": float(r[4]),
            "total_pending": float(r[5]), "service_count": r[6],
        }
        for r in rows
    ]


def get_monthly_revenue() -> list:
    """Monthly revenue tracking from billing services."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT EXTRACT(YEAR FROM billing_date)::INT AS yr,
            EXTRACT(MONTH FROM billing_date)::INT AS mn,
            SUM(amount) AS total,
            SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS collected,
            SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS outstanding,
            COUNT(*) AS service_count
        FROM billing_services
        GROUP BY EXTRACT(YEAR FROM billing_date)::INT, EXTRACT(MONTH FROM billing_date)::INT
        ORDER BY yr DESC, mn DESC
        LIMIT 12
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "year": r[0], "month": r[1], "total": float(r[2]),
            "collected": float(r[3]), "outstanding": float(r[4]),
            "service_count": r[5],
        }
        for r in rows
    ]


def update_billing_status(billing_id: int, status: str, payment_id: int = None) -> bool:
    """Update billing service status."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE billing_services SET status = %s, payment_id = COALESCE(%s, payment_id) WHERE id = %s",
        (status, payment_id, billing_id),
    )
    updated = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return updated


# ───────────────────────── File Sharing ─────────────────────────

def create_file_share(file_id: int, shared_by: int, shared_with: int,
                      permission: str = "view", expires_at: str = None) -> dict:
    """Share a file with a user. Permission: 'view', 'edit', or 'download'."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO file_shares (file_id, shared_by, shared_with, permission, expires_at)
           VALUES (%s, %s, %s, %s, %s) RETURNING id, file_id, shared_by, shared_with,
                  permission, expires_at, created_at""",
        (file_id, shared_by, shared_with, permission, expires_at),
    )
    row = cursor.fetchone()
    conn.commit()
    result = {
        "id": row[0], "file_id": row[1], "shared_by": row[2],
        "shared_with": row[3], "permission": row[4],
        "expires_at": str(row[5]) if row[5] else None,
        "created_at": str(row[6]),
    }
    cursor.close()
    conn.close()
    return result


def get_shares_for_file(file_id: int) -> list:
    """Get all users a file is shared with."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT fs.id, fs.shared_with, fs.permission, fs.expires_at, fs.created_at,
               u.email, u.name, u.role
        FROM file_shares fs
        JOIN users u ON fs.shared_with = u.id
        WHERE fs.file_id = %s
        ORDER BY fs.created_at DESC
    """, (file_id,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "id": r[0], "shared_with": r[1], "permission": r[2],
            "expires_at": str(r[3]) if r[3] else None,
            "created_at": str(r[4]),
            "user_email": r[5], "user_name": r[6], "user_role": r[7],
        }
        for r in rows
    ]


def get_shared_files_for_user(user_id: int) -> list:
    """Get all files shared with a specific user."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT fs.id AS share_id, fs.permission, fs.expires_at, fs.created_at AS shared_at,
               f.id AS file_id, f.file_name, f.file_type, f.file_size,
               f.drive_web_link, f.category,
               u.email AS shared_by_email, u.name AS shared_by_name
        FROM file_shares fs
        JOIN files f ON fs.file_id = f.id
        JOIN users u ON fs.shared_by = u.id
        WHERE fs.shared_with = %s
          AND (fs.expires_at IS NULL OR fs.expires_at > NOW())
        ORDER BY fs.created_at DESC
    """, (user_id,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "share_id": r[0], "permission": r[1],
            "expires_at": str(r[2]) if r[2] else None,
            "shared_at": str(r[3]),
            "id": r[4], "file_name": r[5], "file_type": r[6],
            "file_size": r[7], "drive_web_link": r[8], "category": r[9],
            "shared_by_email": r[10], "shared_by_name": r[11],
        }
        for r in rows
    ]


def update_file_share(share_id: int, permission: str, expires_at: str = None) -> bool:
    """Update permissions or expiration for a share."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE file_shares SET permission = %s, expires_at = %s WHERE id = %s",
        (permission, expires_at, share_id),
    )
    updated = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return updated


def revoke_file_share(share_id: int) -> bool:
    """Delete a file share."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM file_shares WHERE id = %s", (share_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return deleted


def check_user_file_access(user_id: int, file_id: int) -> dict:
    """Check if a user has access to a file via a share, returning the permission level."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT permission FROM file_shares
        WHERE file_id = %s AND shared_with = %s
          AND (expires_at IS NULL OR expires_at > NOW())
    """, (file_id, user_id))
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if row:
        return {"has_access": True, "permission": row[0]}
    return {"has_access": False, "permission": None}


def get_all_shares_admin() -> list:
    """Get all active file shares across the platform (admin view)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT fs.id, fs.file_id, fs.shared_by, fs.shared_with, fs.permission,
               fs.expires_at, fs.created_at,
               f.file_name, f.file_type, f.category,
               ub.email AS shared_by_email,
               uw.email AS shared_with_email, uw.name AS shared_with_name, uw.role AS shared_with_role
        FROM file_shares fs
        JOIN files f ON fs.file_id = f.id
        JOIN users ub ON fs.shared_by = ub.id
        JOIN users uw ON fs.shared_with = uw.id
        ORDER BY fs.created_at DESC
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "id": r[0], "file_id": r[1], "shared_by": r[2],
            "shared_with": r[3], "permission": r[4],
            "expires_at": str(r[5]) if r[5] else None,
            "created_at": str(r[6]),
            "file_name": r[7], "file_type": r[8], "category": r[9],
            "shared_by_email": r[10],
            "shared_with_email": r[11], "shared_with_name": r[12],
            "shared_with_role": r[13],
        }
        for r in rows
    ]


def get_employees_and_clients() -> list:
    """Get all non-admin users for the share dropdown."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, email, name, role FROM users
        WHERE role IN ('user', 'employee')
        ORDER BY role, name, email
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {"id": r[0], "email": r[1], "name": r[2], "role": r[3]}
        for r in rows
    ]


# ───────────────────────── Workspace Documents ─────────────────────────

def create_workspace_document(title: str, description: str, file_name: str,
                               file_size: int, file_path: str, created_by: int,
                               status: str = "draft") -> dict:
    """Create a new workspace document record."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO workspace_documents (title, description, file_name, file_size, file_path, created_by, status)
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id, title, description, file_name,
                  file_size, file_path, created_by,
                  version, status, created_at, updated_at""",
        (title, description, file_name, file_size, file_path, created_by, status),
    )
    row = cursor.fetchone()
    conn.commit()
    result = {
        "id": row[0], "title": row[1], "description": row[2],
        "file_name": row[3], "file_size": row[4], "file_path": row[5],
        "created_by": row[6], "version": row[7], "status": row[8],
        "created_at": str(row[9]), "updated_at": str(row[10]),
    }
    cursor.close()
    conn.close()
    return result


def get_workspace_documents(status_filter: str = None, search: str = None) -> list:
    """List all workspace documents (admin)."""
    conn = get_connection()
    cursor = conn.cursor()
    query = """
        SELECT wd.id, wd.title, wd.description, wd.file_name, wd.file_size,
               wd.file_path, wd.created_by, wd.updated_by, wd.version,
               wd.status, wd.created_at, wd.updated_at,
               u.email AS creator_email, u.name AS creator_name,
               (SELECT COUNT(*) FROM workspace_shares WHERE document_id = wd.id) AS share_count
        FROM workspace_documents wd
        JOIN users u ON wd.created_by = u.id
        WHERE 1=1
    """
    params = []
    if status_filter:
        query += " AND wd.status = %s"
        params.append(status_filter)
    if search:
        query += " AND (wd.title LIKE %s OR wd.description LIKE %s)"
        params.extend([f"%{search}%", f"%{search}%"])
    query += " ORDER BY wd.updated_at DESC"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "id": r[0], "title": r[1], "description": r[2], "file_name": r[3],
            "file_size": r[4], "file_path": r[5], "created_by": r[6],
            "updated_by": r[7], "version": r[8], "status": r[9],
            "created_at": str(r[10]), "updated_at": str(r[11]),
            "creator_email": r[12], "creator_name": r[13], "share_count": r[14],
        }
        for r in rows
    ]


def get_workspace_document_by_id(doc_id: int) -> dict | None:
    """Get a single workspace document by ID."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """SELECT wd.id, wd.title, wd.description, wd.file_name, wd.file_size,
                  wd.file_path, wd.created_by, wd.updated_by, wd.version,
                  wd.status, wd.created_at, wd.updated_at,
                  u.email AS creator_email, u.name AS creator_name
           FROM workspace_documents wd
           JOIN users u ON wd.created_by = u.id
           WHERE wd.id = %s""",
        (doc_id,),
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if not row:
        return None
    return {
        "id": row[0], "title": row[1], "description": row[2], "file_name": row[3],
        "file_size": row[4], "file_path": row[5], "created_by": row[6],
        "updated_by": row[7], "version": row[8], "status": row[9],
        "created_at": str(row[10]), "updated_at": str(row[11]),
        "creator_email": row[12], "creator_name": row[13],
    }


def update_workspace_document(doc_id: int, title: str = None, description: str = None,
                                status: str = None, updated_by: int = None,
                                file_size: int = None) -> bool:
    """Update workspace document metadata."""
    conn = get_connection()
    cursor = conn.cursor()
    sets = ["updated_at = NOW()"]
    params = []
    if title is not None:
        sets.append("title = %s")
        params.append(title)
    if description is not None:
        sets.append("description = %s")
        params.append(description)
    if status is not None:
        sets.append("status = %s")
        params.append(status)
    if updated_by is not None:
        sets.append("updated_by = %s")
        params.append(updated_by)
    if file_size is not None:
        sets.append("file_size = %s")
        params.append(file_size)
    params.append(doc_id)
    cursor.execute(f"UPDATE workspace_documents SET {', '.join(sets)} WHERE id = %s", params)
    updated = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return updated


def increment_workspace_version(doc_id: int, updated_by: int, new_size: int = None) -> bool:
    """Increment version number after content edit."""
    conn = get_connection()
    cursor = conn.cursor()
    if new_size is not None:
        cursor.execute(
            "UPDATE workspace_documents SET version = version + 1, updated_by = %s, file_size = %s, updated_at = NOW() WHERE id = %s",
            (updated_by, new_size, doc_id),
        )
    else:
        cursor.execute(
            "UPDATE workspace_documents SET version = version + 1, updated_by = %s, updated_at = NOW() WHERE id = %s",
            (updated_by, doc_id),
        )
    updated = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return updated


def delete_workspace_document(doc_id: int) -> bool:
    """Delete a workspace document and its shares."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM workspace_shares WHERE document_id = %s", (doc_id,))
        cursor.execute("DELETE FROM workspace_documents WHERE id = %s", (doc_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted
    except Exception as e:
        conn.rollback()
        print(f"[DB] Error deleting workspace doc {doc_id}: {e}")
        return False
    finally:
        cursor.close()
        conn.close()


# ───────────────────────── Workspace Shares ─────────────────────────

def create_workspace_share(document_id: int, shared_by: int, shared_with: int,
                            permission: str = "view") -> dict:
    """Share a workspace document with a user."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO workspace_shares (document_id, shared_by, shared_with, permission)
           VALUES (%s, %s, %s, %s) RETURNING id, document_id, shared_by,
                  shared_with, permission, created_at""",
        (document_id, shared_by, shared_with, permission),
    )
    row = cursor.fetchone()
    conn.commit()
    result = {
        "id": row[0], "document_id": row[1], "shared_by": row[2],
        "shared_with": row[3], "permission": row[4], "created_at": str(row[5]),
    }
    cursor.close()
    conn.close()
    return result


def get_workspace_shares(document_id: int) -> list:
    """Get all shares for a workspace document."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT ws.id, ws.shared_with, ws.permission, ws.created_at,
               u.email, u.name, u.role
        FROM workspace_shares ws
        JOIN users u ON ws.shared_with = u.id
        WHERE ws.document_id = %s
        ORDER BY ws.created_at DESC
    """, (document_id,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "id": r[0], "shared_with": r[1], "permission": r[2],
            "created_at": str(r[3]),
            "user_email": r[4], "user_name": r[5], "user_role": r[6],
        }
        for r in rows
    ]


def get_shared_workspace_docs(user_id: int) -> list:
    """Get workspace documents shared with a specific user (client view)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT ws.id AS share_id, ws.permission, ws.created_at AS shared_at,
               wd.id AS doc_id, wd.title, wd.description, wd.file_name, wd.file_size,
               wd.version, wd.status, wd.updated_at,
               u.email AS shared_by_email, u.name AS shared_by_name
        FROM workspace_shares ws
        JOIN workspace_documents wd ON ws.document_id = wd.id
        JOIN users u ON ws.shared_by = u.id
        WHERE ws.shared_with = %s
        ORDER BY ws.created_at DESC
    """, (user_id,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "share_id": r[0], "permission": r[1], "shared_at": str(r[2]),
            "id": r[3], "title": r[4], "description": r[5],
            "file_name": r[6], "file_size": r[7], "version": r[8],
            "status": r[9], "updated_at": str(r[10]),
            "shared_by_email": r[11], "shared_by_name": r[12],
        }
        for r in rows
    ]


def revoke_workspace_share(share_id: int) -> bool:
    """Delete a workspace share."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM workspace_shares WHERE id = %s", (share_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return deleted


def check_workspace_access(user_id: int, document_id: int) -> dict:
    """Check if a user has access to a workspace document via a share."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT permission FROM workspace_shares WHERE document_id = %s AND shared_with = %s",
        (document_id, user_id),
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if row:
        return {"has_access": True, "permission": row[0]}
    return {"has_access": False, "permission": None}


def get_workspace_stats() -> dict:
    """Get workspace statistics for the admin dashboard."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM workspace_documents")
    total_docs = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM workspace_documents WHERE status = 'draft'")
    draft_count = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM workspace_documents WHERE status = 'published'")
    published_count = cursor.fetchone()[0]
    cursor.execute("SELECT COALESCE(SUM(file_size), 0) FROM workspace_documents")
    total_size = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM workspace_shares")
    total_shares = cursor.fetchone()[0]
    cursor.close()
    conn.close()
    return {
        "total_documents": total_docs,
        "draft_count": draft_count,
        "published_count": published_count,
        "total_size": total_size,
        "total_shares": total_shares,
    }


# ───────────────────────── Document Classification ─────────────────────────

def create_classification_log(file_id: int, user_id: int, result: dict) -> dict:
    """Persist a classification result to the classification_logs table."""
    import json
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO classification_logs
               (file_id, user_id, category, sub_category, financial_year, month,
                confidence_score, suggested_name, folder_path, needs_review,
                source, matched_keywords, raw_result)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, file_id, category, sub_category,
                  financial_year, month, confidence_score,
                  suggested_name, folder_path, needs_review,
                  created_at""",
        (
            file_id, user_id,
            result.get("category", "UNCATEGORIZED"),
            result.get("sub_category", "UNKNOWN"),
            result.get("financial_year"),
            result.get("month"),
            result.get("confidence_score", 0),
            result.get("suggested_file_name"),
            result.get("folder_path"),
            result.get("needs_review", False),
            result.get("source", "none"),
            json.dumps(result.get("matched_keywords", [])),
            json.dumps(result),
        ),
    )
    row = cursor.fetchone()
    conn.commit()
    log = {
        "id": row[0], "file_id": row[1], "category": row[2],
        "sub_category": row[3], "financial_year": row[4], "month": row[5],
        "confidence_score": row[6], "suggested_name": row[7],
        "folder_path": row[8], "needs_review": bool(row[9]),
        "created_at": str(row[10]),
    }
    cursor.close()
    conn.close()
    return log


def get_classification_log(file_id: int) -> dict | None:
    """Get the most recent classification result for a file."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """SELECT id, file_id, user_id, category, sub_category, financial_year,
                  month, confidence_score, suggested_name, folder_path,
                  needs_review, reviewed, reviewed_by, source,
                  matched_keywords, created_at
           FROM classification_logs
           WHERE file_id = %s
           ORDER BY created_at DESC
           LIMIT 1""",
        (file_id,),
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if not row:
        return None
    import json
    return {
        "id": row[0], "file_id": row[1], "user_id": row[2],
        "category": row[3], "sub_category": row[4], "financial_year": row[5],
        "month": row[6], "confidence_score": row[7], "suggested_name": row[8],
        "folder_path": row[9], "needs_review": bool(row[10]),
        "reviewed": bool(row[11]), "reviewed_by": row[12],
        "source": row[13],
        "matched_keywords": json.loads(row[14]) if row[14] else [],
        "created_at": str(row[15]),
    }


def get_files_needing_review(limit: int = 100) -> list:
    """Get all classified files that need manual review (confidence < 80)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(f"""
        SELECT cl.id AS log_id, cl.file_id, cl.category, cl.sub_category,
               cl.financial_year, cl.month, cl.confidence_score,
               cl.suggested_name, cl.folder_path, cl.needs_review,
               cl.reviewed, cl.source, cl.created_at,
               f.file_name, f.file_type, f.file_size, f.created_at AS file_date,
               u.email AS user_email, u.name AS user_name
        FROM classification_logs cl
        JOIN files f ON cl.file_id = f.id
        JOIN users u ON cl.user_id = u.id
        WHERE cl.needs_review = TRUE AND cl.reviewed = FALSE
        ORDER BY cl.created_at DESC
        LIMIT {limit}
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "log_id": r[0], "file_id": r[1], "category": r[2],
            "sub_category": r[3], "financial_year": r[4], "month": r[5],
            "confidence_score": r[6], "suggested_name": r[7],
            "folder_path": r[8], "needs_review": bool(r[9]),
            "reviewed": bool(r[10]), "source": r[11],
            "created_at": str(r[12]),
            "file_name": r[13], "file_type": r[14], "file_size": r[15],
            "file_date": str(r[16]),
            "user_email": r[17], "user_name": r[18],
        }
        for r in rows
    ]


def get_all_classification_logs(limit: int = 200) -> list:
    """Get all recent classification logs (admin view)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(f"""
        SELECT cl.id AS log_id, cl.file_id, cl.category, cl.sub_category,
               cl.financial_year, cl.month, cl.confidence_score,
               cl.suggested_name, cl.folder_path, cl.needs_review,
               cl.reviewed, cl.source, cl.created_at,
               f.file_name, f.file_type, f.file_size,
               u.email AS user_email, u.name AS user_name
        FROM classification_logs cl
        JOIN files f ON cl.file_id = f.id
        JOIN users u ON cl.user_id = u.id
        ORDER BY cl.created_at DESC
        LIMIT {limit}
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "log_id": r[0], "file_id": r[1], "category": r[2],
            "sub_category": r[3], "financial_year": r[4], "month": r[5],
            "confidence_score": r[6], "suggested_name": r[7],
            "folder_path": r[8], "needs_review": bool(r[9]),
            "reviewed": bool(r[10]), "source": r[11],
            "created_at": str(r[12]),
            "file_name": r[13], "file_type": r[14], "file_size": r[15],
            "user_email": r[16], "user_name": r[17],
        }
        for r in rows
    ]


def mark_classification_reviewed(log_id: int, admin_id: int) -> bool:
    """Mark a classification as reviewed/approved by an admin."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE classification_logs SET reviewed = TRUE, reviewed_by = %s WHERE id = %s",
        (admin_id, log_id),
    )
    updated = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return updated


def update_file_classification(file_id: int, category: str, sub_category: str,
                                financial_year: str = None, confidence: int = None) -> bool:
    """Update the classification fields on the files table."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """UPDATE files
           SET category = %s, sub_category = %s, financial_year = %s,
               classification_confidence = %s
           WHERE id = %s""",
        (category, sub_category, financial_year, confidence, file_id),
    )
    updated = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return updated


def reclassify_file_manual(file_id: int, category: str, sub_category: str,
                           financial_year: str, admin_id: int) -> bool:
    """
    Admin manually overrides the classification of a file.
    Updates both the file record and the classification log.
    """
    conn = get_connection()
    cursor = conn.cursor()
    try:
        # Update file record
        cursor.execute(
            """UPDATE files
               SET category = %s, sub_category = %s, financial_year = %s,
                   classification_confidence = 100
               WHERE id = %s""",
            (category, sub_category, financial_year, file_id),
        )

        # Update the latest classification log
        cursor.execute(
            """UPDATE classification_logs
               SET category = %s, sub_category = %s, financial_year = %s,
                   confidence_score = 100, reviewed = TRUE, reviewed_by = %s,
                   needs_review = FALSE
               WHERE id = (
                   SELECT id FROM classification_logs
                    WHERE file_id = %s ORDER BY created_at DESC LIMIT 1
                )""",
            (category, sub_category, financial_year, admin_id, file_id),
        )

        conn.commit()
        return True
    except Exception as e:
        conn.rollback()
        print(f"[DB] Error reclassifying file {file_id}: {e}")
        return False
    finally:
        cursor.close()
        conn.close()


def get_classification_stats() -> dict:
    """Get classification distribution statistics for the dashboard."""
    conn = get_connection()
    cursor = conn.cursor()

    # Total classified
    cursor.execute("SELECT COUNT(*) FROM classification_logs")
    total = cursor.fetchone()[0]

    # Needing review
    cursor.execute("SELECT COUNT(*) FROM classification_logs WHERE needs_review = TRUE AND reviewed = FALSE")
    pending_review = cursor.fetchone()[0]

    # Category distribution
    cursor.execute("""
        SELECT category, COUNT(*) AS cnt
        FROM classification_logs
        GROUP BY category
        ORDER BY cnt DESC
    """)
    by_category = {r[0]: r[1] for r in cursor.fetchall()}

    # Confidence distribution
    cursor.execute("""
        SELECT
            SUM(CASE WHEN confidence_score >= 90 THEN 1 ELSE 0 END) AS high,
            SUM(CASE WHEN confidence_score >= 70 AND confidence_score < 90 THEN 1 ELSE 0 END) AS medium,
            SUM(CASE WHEN confidence_score >= 50 AND confidence_score < 70 THEN 1 ELSE 0 END) AS low,
            SUM(CASE WHEN confidence_score < 50 THEN 1 ELSE 0 END) AS very_low
        FROM classification_logs
    """)
    conf_row = cursor.fetchone()
    confidence_dist = {
        "high": conf_row[0] or 0,
        "medium": conf_row[1] or 0,
        "low": conf_row[2] or 0,
        "very_low": conf_row[3] or 0,
    }

    # Recent classifications (last 10)
    cursor.execute("""
        SELECT cl.file_id, cl.category, cl.sub_category,
               cl.confidence_score, cl.needs_review, cl.created_at,
               f.file_name, u.email
        FROM classification_logs cl
        JOIN files f ON cl.file_id = f.id
        JOIN users u ON cl.user_id = u.id
        ORDER BY cl.created_at DESC
        LIMIT 10
    """)
    recent = [
        {
            "file_id": r[0], "category": r[1], "sub_category": r[2],
            "confidence_score": r[3], "needs_review": bool(r[4]),
            "created_at": str(r[5]), "file_name": r[6], "user_email": r[7],
        }
        for r in cursor.fetchall()
    ]

    cursor.close()
    conn.close()

    return {
        "total_classified": total,
        "pending_review": pending_review,
        "by_category": by_category,
        "confidence_distribution": confidence_dist,
        "recent": recent,
    }


def get_all_files_for_reclassification() -> list:
    """Get all files that need (re)classification — for batch processing existing files."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT f.id, f.file_name, f.file_type, f.user_id, f.drive_web_link,
               u.email AS user_email, u.name AS user_name
        FROM files f
        JOIN users u ON f.user_id = u.id
        ORDER BY f.created_at DESC
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {
            "id": r[0], "file_name": r[1], "file_type": r[2],
            "user_id": r[3], "drive_web_link": r[4],
            "user_email": r[5], "user_name": r[6],
        }
        for r in rows
    ]

