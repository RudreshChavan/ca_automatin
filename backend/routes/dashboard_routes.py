"""
Dashboard routes — aggregated stats for the current user.
"""

from flask import Blueprint, jsonify, g

from middleware import require_auth
from models import get_dashboard_stats

dashboard_bp = Blueprint("dashboard", __name__, url_prefix="/api/dashboard")


@dashboard_bp.route("", methods=["GET"])
@require_auth
def dashboard():
    """Get dashboard statistics: total files, folder counts, recent uploads."""
    stats = get_dashboard_stats(g.user_id)
    return jsonify(stats), 200
