use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

fn app() -> axum::Router {
    workflow_runtime::router()
}

#[tokio::test]
async fn test_healthz() {
    let app = app();
    let req = axum::http::Request::builder()
        .uri("/healthz")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let val: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(val["status"], "ok");
}

#[tokio::test]
async fn test_execute_linear_completion() {
    let app = app();
    let body = json!({
        "instance_id": null,
        "dsl": {
            "id": "v1",
            "steps": [
                {"id": "calc1", "type": "expression", "expr": "input.amount + 100", "out": "sum"},
                {"id": "calc2", "type": "expression", "expr": "var.sum * 2", "out": "doubled"},
                {"id": "end", "type": "end", "result": "done"}
            ]
        },
        "input": {"amount": 50},
        "variables": {}
    });

    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/execute")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let val: Value = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(val["status"], "completed");
    assert_eq!(val["variables"]["sum"], json!(150.0));
    assert_eq!(val["variables"]["doubled"], json!(300.0));
    assert_eq!(val["steps"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn test_execute_switch_high_goes_to_human_task() {
    let app = app();
    let body = json!({
        "instance_id": null,
        "dsl": {
            "id": "v1",
            "steps": [
                {"id": "branch", "type": "switch", "cases": [
                    {"when": "input.amount > 1000", "do": [
                        {"id": "approve", "type": "human_task", "assignee": "mgr-001", "form": {"prompt": "Approve?"}}
                    ]},
                    {"when": "default", "do": [
                        {"id": "auto_approve", "type": "set_variable", "name": "approved", "value": true}
                    ]}
                ]},
                {"id": "end", "type": "end"}
            ]
        },
        "input": {"amount": 2000},
        "variables": {}
    });

    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/execute")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let val: Value = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(val["status"], "paused");
    assert!(!val["human_tasks"].as_array().unwrap().is_empty());
    assert_eq!(val["human_tasks"][0]["step_id"], "approve");
}

#[tokio::test]
async fn test_execute_switch_low_auto_approves() {
    let app = app();
    let body = json!({
        "instance_id": null,
        "dsl": {
            "id": "v1",
            "steps": [
                {"id": "branch", "type": "switch", "cases": [
                    {"when": "input.amount > 1000", "do": [
                        {"id": "approve", "type": "human_task", "assignee": "mgr-001", "form": {"prompt": "Approve?"}}
                    ]},
                    {"when": "default", "do": [
                        {"id": "auto_approve", "type": "set_variable", "name": "approved", "value": true}
                    ]}
                ]},
                {"id": "end", "type": "end"}
            ]
        },
        "input": {"amount": 100},
        "variables": {}
    });

    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/execute")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let val: Value = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(val["status"], "completed");
    assert_eq!(val["variables"]["approved"], Value::Bool(true));
    assert!(val["human_tasks"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn test_expression_evaluator_via_execute() {
    let app = app();
    // Test arithmetic + comparison in one workflow
    let body = json!({
        "instance_id": null,
        "dsl": {
            "id": "v1",
            "steps": [
                {"id": "s1", "type": "expression", "expr": "1 + 2", "out": "three"},
                {"id": "s2", "type": "expression", "expr": "var.three * 3", "out": "nine"},
                {"id": "end", "type": "end"}
            ]
        },
        "input": {},
        "variables": {}
    });

    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/execute")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let val: Value = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(val["status"], "completed");
    assert_eq!(val["variables"]["three"], json!(3.0));
    assert_eq!(val["variables"]["nine"], json!(9.0));
}
