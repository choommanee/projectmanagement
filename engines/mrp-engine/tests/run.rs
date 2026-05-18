use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use serde_json::json;
use tower::ServiceExt;

#[tokio::test]
async fn healthz_ok() {
    let app = mrp_engine::router();
    let res = app
        .oneshot(
            Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
}

#[tokio::test]
async fn run_releases_when_net_positive() {
    let body = json!({
        "tenant_id": "00000000-0000-0000-0000-000000000000",
        "items": [{
            "item_id": "00000000-0000-0000-0000-000000000001",
            "code": "ITM-1",
            "demand_qty": 100.0,
            "due_date": "2026-06-30",
            "on_hand": 10.0,
            "lead_time_days": 5
        }]
    });
    let app = mrp_engine::router();
    let req = Request::builder()
        .method("POST")
        .uri("/run")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), 200);
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(v["demands"].as_array().unwrap().len(), 1);
    assert_eq!(v["demands"][0]["qty"].as_f64().unwrap(), 90.0);
    assert_eq!(v["actions"][0]["action"], "release");
}

#[tokio::test]
async fn run_noop_when_stock_sufficient() {
    let body = json!({
        "tenant_id": "00000000-0000-0000-0000-000000000000",
        "items": [{
            "item_id": "00000000-0000-0000-0000-000000000001",
            "code": "ITM-1",
            "demand_qty": 5.0,
            "on_hand": 50.0
        }]
    });
    let app = mrp_engine::router();
    let req = Request::builder()
        .method("POST")
        .uri("/run")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(v["demands"].as_array().unwrap().is_empty());
    assert_eq!(v["actions"][0]["action"], "noop");
}
