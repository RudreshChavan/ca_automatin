"""
CA Backend — Flask Application Entry Point.
"""

import os
from flask import Flask, send_from_directory
from flask_cors import CORS

from config import Config
from database import init_db
from routes.auth_routes import auth_bp
from routes.folder_routes import folder_bp
from routes.file_routes import file_bp
from routes.dashboard_routes import dashboard_bp
from routes.admin_routes import admin_bp
from routes.user_routes import user_bp
from routes.notification_routes import notification_bp
from routes.payment_routes import payment_bp
from routes.billing_routes import billing_bp
from routes.storage_routes import storage_bp
from routes.share_routes import share_bp
from routes.workspace_routes import workspace_bp
from routes.classify_routes import classify_bp

def create_app():
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = Config.MAX_FILE_SIZE_BYTES

    # CORS — allow frontend
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # Register blueprints
    app.register_blueprint(auth_bp)
    app.register_blueprint(folder_bp)
    app.register_blueprint(file_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(user_bp)
    app.register_blueprint(notification_bp)
    app.register_blueprint(payment_bp)
    app.register_blueprint(billing_bp)
    app.register_blueprint(storage_bp)
    app.register_blueprint(share_bp)
    app.register_blueprint(workspace_bp)
    app.register_blueprint(classify_bp)

    # ── Serve frontend static files ──
    frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
    frontend_dir = os.path.abspath(frontend_dir)

    @app.route("/")
    def serve_index():
        return send_from_directory(frontend_dir, "index.html")

    @app.route("/dashboard")
    def serve_dashboard():
        return send_from_directory(frontend_dir, "dashboard.html")

    @app.route("/admin")
    def serve_admin():
        return send_from_directory(frontend_dir, "admin.html")

    @app.route("/viewer")
    def serve_viewer():
        return send_from_directory(frontend_dir, "viewer.html")

    @app.route("/workspace")
    def serve_workspace():
        return send_from_directory(frontend_dir, "workspace.html")

    @app.route("/billing")
    def serve_billing():
        return send_from_directory(frontend_dir, "billing.html")

    @app.route("/classify")
    def serve_classify():
        return send_from_directory(frontend_dir, "classify.html")

    @app.route("/<path:path>")
    def serve_static(path):
        # Try to serve from frontend directory
        full_path = os.path.join(frontend_dir, path)
        if os.path.isfile(full_path):
            directory = os.path.dirname(full_path)
            filename = os.path.basename(full_path)
            return send_from_directory(directory, filename)
        # Fallback to index for SPA-like behavior
        return send_from_directory(frontend_dir, "index.html")

    return app


if __name__ == "__main__":
    print("=" * 50)
    print("CA Admitration")
    print("=" * 50)

    # Initialize database tables
    init_db()

    app = create_app()
    app.run(debug=True, host="0.0.0.0", port=5000)
