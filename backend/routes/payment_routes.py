"""
Payment routes — record, track, and manage client payments.
Admin routes for recording payments; client route for viewing history.
"""

from flask import Blueprint, request, jsonify, g

from middleware import require_auth, require_admin
from models import (
    create_payment, get_user_payments, get_all_payments,
    get_pending_payments, update_payment_status, get_payment_summary,
    create_notification,
)

payment_bp = Blueprint("payments", __name__)


# ═══════════════════════════════════════════════════════════
# ADMIN PAYMENT MANAGEMENT
# ═══════════════════════════════════════════════════════════

@payment_bp.route("/api/admin/payment", methods=["POST"])
@require_auth
@require_admin
def record_payment():
    """Record a new payment for a client."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body is required"}), 400

    user_id = data.get("user_id")
    amount = data.get("amount")

    if not user_id or not amount:
        return jsonify({"error": "user_id and amount are required"}), 400

    try:
        amount = float(amount)
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid amount"}), 400

    payment = create_payment(
        user_id=user_id,
        amount=amount,
        description=(data.get("description") or "").strip() or None,
        payment_method=(data.get("payment_method") or "").strip() or None,
        reference_number=(data.get("reference_number") or "").strip() or None,
        status=data.get("status", "pending"),
        due_date=data.get("due_date") or None,
        recorded_by=g.user_id,
        payment_date=data.get("payment_date") or None,
    )

    # Notify client
    try:
        status_text = "received" if payment["status"] == "received" else "recorded"
        create_notification(
            user_id=user_id,
            notif_type="payment_recorded",
            title=f"Payment {status_text.title()}",
            message=f"A payment of ₹{amount:,.2f} has been {status_text}.",
            related_id=payment["id"],
        )
    except Exception as e:
        print(f"[Notify] Failed to notify client about payment: {e}")

    return jsonify({"message": "Payment recorded", "payment": payment}), 201


@payment_bp.route("/api/admin/payments", methods=["GET"])
@require_auth
@require_admin
def list_payments():
    """List all payments with optional filters."""
    status = request.args.get("status", "").strip() or None
    user_id = request.args.get("user_id", type=int)
    payments = get_all_payments(status_filter=status, user_id_filter=user_id)
    return jsonify({"payments": payments}), 200


@payment_bp.route("/api/admin/payments/pending", methods=["GET"])
@require_auth
@require_admin
def list_pending_payments():
    """Get all pending payments."""
    payments = get_pending_payments()
    return jsonify({"payments": payments}), 200


@payment_bp.route("/api/admin/payment/<int:payment_id>/status", methods=["PUT"])
@require_auth
@require_admin
def change_payment_status(payment_id):
    """Update payment status (e.g., pending → received)."""
    data = request.get_json()
    if not data or not data.get("status"):
        return jsonify({"error": "status is required"}), 400

    status = data["status"]
    if status not in ("pending", "received", "overdue", "cancelled"):
        return jsonify({"error": "Invalid status"}), 400

    success = update_payment_status(
        payment_id=payment_id,
        status=status,
        payment_date=data.get("payment_date"),
        payment_method=data.get("payment_method"),
        reference_number=data.get("reference_number"),
    )

    if not success:
        return jsonify({"error": "Payment not found"}), 404

    return jsonify({"message": f"Payment status updated to {status}"}), 200


@payment_bp.route("/api/admin/payment/summary", methods=["GET"])
@require_auth
@require_admin
def payment_summary():
    """Get payment summary for dashboard."""
    summary = get_payment_summary()
    return jsonify(summary), 200


@payment_bp.route("/api/admin/user/<int:user_id>/payments", methods=["GET"])
@require_auth
@require_admin
def admin_user_payments(user_id):
    """Get payment history for a specific client (admin)."""
    payments = get_user_payments(user_id)
    return jsonify({"payments": payments}), 200


# ═══════════════════════════════════════════════════════════
# CLIENT PAYMENT HISTORY
# ═══════════════════════════════════════════════════════════

@payment_bp.route("/api/payments/my", methods=["GET"])
@require_auth
def my_payments():
    """Get current user's payment history."""
    payments = get_user_payments(g.user_id)
    return jsonify({"payments": payments}), 200
