use axum::{routing::get, Router, Json};
use serde_json::json;

pub fn router() -> Router {
    Router::new().route("/healthz", get(|| async { Json(json!({"status":"ok"})) }))
}
