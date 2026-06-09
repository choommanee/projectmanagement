use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::{mpsc, Mutex};
use tower::ServiceExt;

/// Serializes tests that mutate the process-global `DOCUMENT_SVC_URL` env var.
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn app() -> axum::Router {
    workflow_runtime::router()
}

/// A captured HTTP request seen by the mock server.
#[derive(Debug, Clone)]
struct CapturedReq {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: String,
}

impl CapturedReq {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// Spin up a one-shot-ish mock HTTP server that responds to `n` requests using
/// the provided responder, returning (base_url, receiver_of_captured_requests).
/// The responder gets the request index (0-based) and the captured request, and
/// returns (status_code, json_body).
fn mock_server<F>(n: usize, responder: F) -> (String, mpsc::Receiver<CapturedReq>)
where
    F: Fn(usize, &CapturedReq) -> (u16, Value) + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let base = format!("http://{}", addr);
    let (tx, rx) = mpsc::channel();

    std::thread::spawn(move || {
        for i in 0..n {
            let (mut stream, _) = match listener.accept() {
                Ok(s) => s,
                Err(_) => break,
            };
            let mut reader = BufReader::new(stream.try_clone().unwrap());

            // Request line.
            let mut request_line = String::new();
            if reader.read_line(&mut request_line).is_err() {
                break;
            }
            let mut parts = request_line.split_whitespace();
            let method = parts.next().unwrap_or("").to_string();
            let path = parts.next().unwrap_or("").to_string();

            // Headers.
            let mut headers = Vec::new();
            let mut content_length = 0usize;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() {
                    break;
                }
                let trimmed = line.trim_end();
                if trimmed.is_empty() {
                    break;
                }
                if let Some((k, v)) = trimmed.split_once(':') {
                    let k = k.trim().to_string();
                    let v = v.trim().to_string();
                    if k.eq_ignore_ascii_case("content-length") {
                        content_length = v.parse().unwrap_or(0);
                    }
                    headers.push((k, v));
                }
            }

            // Body.
            let mut body = vec![0u8; content_length];
            if content_length > 0 {
                let _ = reader.read_exact(&mut body);
            }
            let body = String::from_utf8_lossy(&body).to_string();

            let captured = CapturedReq { method, path, headers, body };
            let (status, resp_body) = responder(i, &captured);
            let _ = tx.send(captured);

            let resp_text = resp_body.to_string();
            let response = format!(
                "HTTP/1.1 {} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                status,
                resp_text.len(),
                resp_text
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        }
    });

    (base, rx)
}

/// Run the engine synchronously (no async/await) by deserializing the request
/// body into `ExecuteInput` and calling `execute` directly. Used by tests that
/// mutate the process-global `DOCUMENT_SVC_URL` env var, so the env mutex never
/// has to be held across an await point.
fn run_execute(body: Value) -> Value {
    let input: workflow_runtime::ExecuteInput = serde_json::from_value(body).unwrap();
    let out = workflow_runtime::execute(input);
    serde_json::to_value(&out).unwrap()
}

async fn post_execute(app: axum::Router, body: Value) -> Value {
    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/execute")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
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

// ─── request_signature tests ───────────────────────────────────────────────────

fn sig_dsl(document_id: &str) -> Value {
    json!({
        "id": "sig-wf",
        "steps": [
            {"id": "get_sig", "type": "request_signature",
             "document_id": document_id,
             "signing_order": "sequential",
             "title": "Please sign {{input.doc_name}}",
             "signers": [{"signer_id": "u-1", "name": "Alice", "email": "a@x.io"}]},
            {"id": "branch", "type": "switch", "cases": [
                {"when": "input.signature_outcome == 'signed'", "do": [
                    {"id": "mark_signed", "type": "set_variable", "name": "result", "value": "ok"}
                ]},
                {"when": "default", "do": [
                    {"id": "mark_declined", "type": "set_variable", "name": "result", "value": "rejected"}
                ]}
            ]},
            {"id": "end", "type": "end"}
        ]
    })
}

#[test]
fn test_request_signature_happy_path_pauses() {
    // create -> 201 with {id}, send -> 200
    let _g = ENV_LOCK.lock().unwrap();
    let (base, rx) = mock_server(2, |i, _req| {
        if i == 0 {
            (201, json!({"id": "env-abc-123", "status": "draft"}))
        } else {
            (200, json!({"status": "sent"}))
        }
    });
    std::env::set_var("DOCUMENT_SVC_URL", &base);

    let body = json!({
        "instance_id": null,
        "dsl": sig_dsl("doc-99"),
        "input": {"doc_name": "NDA"},
        "variables": {}
    });
    let val = run_execute(body);

    assert_eq!(val["status"], "paused");
    assert_eq!(val["cursor"], "get_sig");
    assert_eq!(val["pending_signature"]["envelope_id"], "env-abc-123");
    assert_eq!(val["pending_signature"]["document_id"], "doc-99");
    assert_eq!(val["pending_signature"]["step_id"], "get_sig");

    // First captured req is the create envelope on the right path with title+signers.
    let create = rx.recv().unwrap();
    assert_eq!(create.method, "POST");
    assert_eq!(create.path, "/v1/documents/doc-99/sign-envelopes");
    let cbody: Value = serde_json::from_str(&create.body).unwrap();
    assert_eq!(cbody["signing_order"], "sequential");
    assert_eq!(cbody["title"], "Please sign NDA");
    assert_eq!(cbody["signers"][0]["signer_id"], "u-1");

    // Second captured req is the send on the envelope id.
    let send = rx.recv().unwrap();
    assert_eq!(send.method, "POST");
    assert_eq!(send.path, "/v1/sign-envelopes/env-abc-123/send");
}

#[test]
fn test_request_signature_forwards_auth_and_tenant_headers() {
    let _g = ENV_LOCK.lock().unwrap();
    let (base, rx) = mock_server(2, |i, _req| {
        if i == 0 {
            (201, json!({"envelope": {"ID": "env-xyz"}}))
        } else {
            (200, json!({"status": "sent"}))
        }
    });
    std::env::set_var("DOCUMENT_SVC_URL", &base);

    let body = json!({
        "instance_id": null,
        "dsl": sig_dsl("doc-1"),
        "input": {"doc_name": "X"},
        "variables": {},
        "auth_token": "tok-123",
        "tenant_id": "tenant-aaa"
    });
    let val = run_execute(body);
    assert_eq!(val["status"], "paused");
    // wrapped envelope under {"envelope":{"ID":...}} must still be parsed.
    assert_eq!(val["pending_signature"]["envelope_id"], "env-xyz");

    let create = rx.recv().unwrap();
    assert_eq!(create.header("Authorization"), Some("Bearer tok-123"));
    assert_eq!(create.header("X-Tenant-Id"), Some("tenant-aaa"));
    let send = rx.recv().unwrap();
    assert_eq!(send.header("Authorization"), Some("Bearer tok-123"));
    assert_eq!(send.header("X-Tenant-Id"), Some("tenant-aaa"));
}

#[test]
fn test_request_signature_failure_marks_failed() {
    let _g = ENV_LOCK.lock().unwrap();
    // create returns 500.
    let (base, _rx) = mock_server(1, |_i, _req| (500, json!({"error": "boom"})));
    std::env::set_var("DOCUMENT_SVC_URL", &base);

    let body = json!({
        "instance_id": null,
        "dsl": sig_dsl("doc-err"),
        "input": {"doc_name": "X"},
        "variables": {}
    });
    let val = run_execute(body);
    assert_eq!(val["status"], "failed");
    assert!(val["error"].is_string());
    assert!(val["pending_signature"].is_null());
}

#[tokio::test(flavor = "multi_thread")]
async fn test_resume_after_signature_branches_signed() {
    // No HTTP needed: we resume past the signature step.
    let body = json!({
        "instance_id": null,
        "dsl": sig_dsl("doc-1"),
        "input": {"doc_name": "X", "signature_outcome": "signed"},
        "variables": {},
        "resume_from_step_id": "get_sig"
    });
    let val = post_execute(app(), body).await;
    assert_eq!(val["status"], "completed");
    assert_eq!(val["variables"]["result"], "ok");
}

#[tokio::test(flavor = "multi_thread")]
async fn test_resume_after_signature_branches_declined() {
    let body = json!({
        "instance_id": null,
        "dsl": sig_dsl("doc-1"),
        "input": {"doc_name": "X", "signature_outcome": "declined"},
        "variables": {},
        "resume_from_step_id": "get_sig"
    });
    let val = post_execute(app(), body).await;
    assert_eq!(val["status"], "completed");
    assert_eq!(val["variables"]["result"], "rejected");
}

// ─── http step: headers / body / url templating ─────────────────────────────────

#[test]
fn test_http_step_sends_headers_and_templated_body() {
    // No env-var mutation: the mock base URL flows in via input templating.
    let (base, rx) = mock_server(1, |_i, _req| (200, json!({"echo": "ok"})));

    let body = json!({
        "instance_id": null,
        "dsl": {
            "id": "http-wf",
            "steps": [
                {"id": "call", "type": "http", "method": "POST",
                 "url": "{{input.base}}/v1/echo/{{input.doc_id}}",
                 "headers": {"X-Custom": "doc-{{input.doc_id}}", "X-Static": "fixed"},
                 "body": "{\"name\": \"{{input.name}}\", \"amount\": {{input.amount}}}"},
                {"id": "end", "type": "end"}
            ]
        },
        "input": {"base": base, "doc_id": "d-42", "name": "Sam", "amount": 7},
        "variables": {},
        "auth_token": "tok-9",
        "tenant_id": "tenant-z"
    });
    let val = run_execute(body);

    assert_eq!(val["status"], "completed");
    // Step output captured the mock response.
    let call_step = &val["steps"][0];
    assert_eq!(call_step["status"], "completed");
    assert_eq!(call_step["output"]["status"], 200);
    assert_eq!(call_step["output"]["body"]["echo"], "ok");

    let req = rx.recv().unwrap();
    assert_eq!(req.method, "POST");
    // URL template resolved.
    assert_eq!(req.path, "/v1/echo/d-42");
    // Custom headers resolved + sent; auth/tenant still forwarded.
    assert_eq!(req.header("X-Custom"), Some("doc-d-42"));
    assert_eq!(req.header("X-Static"), Some("fixed"));
    assert_eq!(req.header("Authorization"), Some("Bearer tok-9"));
    assert_eq!(req.header("X-Tenant-Id"), Some("tenant-z"));
    assert_eq!(req.header("Content-Type"), Some("application/json"));
    // Body template resolved and sent as JSON.
    let sent: Value = serde_json::from_str(&req.body).unwrap();
    assert_eq!(sent["name"], "Sam");
    assert_eq!(sent["amount"], 7);
}

#[test]
fn test_http_step_json_object_body_resolves_nested_templates() {
    let (base, rx) = mock_server(1, |_i, _req| (200, json!({"ok": true})));

    let body = json!({
        "instance_id": null,
        "dsl": {
            "id": "http-wf2",
            "steps": [
                {"id": "call", "type": "http", "method": "PUT",
                 "url": "{{input.base}}/v1/items",
                 "body": {"title": "Item {{input.n}}", "nested": {"who": "{{input.user}}"}},
                 "headers": {"Content-Type": "application/json; charset=utf-8"}},
                {"id": "end", "type": "end"}
            ]
        },
        "input": {"base": base, "n": 3, "user": "u-1"},
        "variables": {}
    });
    let val = run_execute(body);
    assert_eq!(val["status"], "completed");

    let req = rx.recv().unwrap();
    assert_eq!(req.method, "PUT");
    assert_eq!(req.path, "/v1/items");
    // Caller-supplied content-type wins (no duplicate default).
    assert_eq!(req.header("Content-Type"), Some("application/json; charset=utf-8"));
    let sent: Value = serde_json::from_str(&req.body).unwrap();
    assert_eq!(sent["title"], "Item 3");
    assert_eq!(sent["nested"]["who"], "u-1");
}

#[tokio::test]
async fn test_http_step_get_without_body_still_works() {
    let (base, rx) = mock_server(1, |_i, _req| (200, json!({"status": "ok"})));
    let body = json!({
        "instance_id": null,
        "dsl": {
            "id": "http-wf3",
            "steps": [
                {"id": "ping", "type": "http", "method": "GET", "url": format!("{}/healthz", base)},
                {"id": "end", "type": "end"}
            ]
        },
        "input": {},
        "variables": {}
    });
    let val = post_execute(app(), body).await;
    assert_eq!(val["status"], "completed");
    let req = rx.recv().unwrap();
    assert_eq!(req.method, "GET");
    assert_eq!(req.path, "/healthz");
    assert!(req.body.is_empty());
}

// ─── human_task SLA tests ────────────────────────────────────────────────────────

#[tokio::test]
async fn test_human_task_sla_parsed_to_seconds() {
    let body = json!({
        "instance_id": null,
        "dsl": {
            "id": "sla-wf",
            "steps": [
                {"id": "approve", "type": "human_task", "assignee": "mgr-1",
                 "form": {"prompt": "Approve?"}, "sla": "5m"},
                {"id": "end", "type": "end"}
            ]
        },
        "input": {},
        "variables": {}
    });
    let val = post_execute(app(), body).await;
    assert_eq!(val["status"], "paused");
    assert_eq!(val["human_tasks"][0]["sla_seconds"], 300);
}

#[tokio::test]
async fn test_human_task_without_sla_has_null_sla_seconds() {
    let body = json!({
        "instance_id": null,
        "dsl": {
            "id": "sla-wf2",
            "steps": [
                {"id": "approve", "type": "human_task", "form": {"prompt": "Ok?"}},
                {"id": "end", "type": "end"}
            ]
        },
        "input": {},
        "variables": {}
    });
    let val = post_execute(app(), body).await;
    assert_eq!(val["status"], "paused");
    assert!(val["human_tasks"][0]["sla_seconds"].is_null());
}

// ─── retry semantics (resume_inclusive) tests ───────────────────────────────────

#[tokio::test(flavor = "multi_thread")]
async fn test_resume_inclusive_false_reruns_step_against_unreachable() {
    // Unreachable host => transport error => http step fails => instance failed.
    let dsl = json!({
        "id": "retry-wf",
        "steps": [
            {"id": "before", "type": "set_variable", "name": "x", "value": 1},
            {"id": "call", "type": "http", "method": "GET", "url": "http://127.0.0.1:1/nope"},
            {"id": "end", "type": "end"}
        ]
    });
    let body = json!({
        "instance_id": null,
        "dsl": dsl,
        "input": {},
        "variables": {},
        "resume_from_step_id": "call",
        "resume_inclusive": false
    });
    let val = post_execute(app(), body).await;
    assert_eq!(val["status"], "failed");
    assert_eq!(val["cursor"], "call");
}

#[tokio::test(flavor = "multi_thread")]
async fn test_resume_inclusive_default_skips_cursor_step() {
    // Default (inclusive) resume from the http step => skip it, reach end => completed.
    let dsl = json!({
        "id": "skip-wf",
        "steps": [
            {"id": "before", "type": "set_variable", "name": "x", "value": 1},
            {"id": "call", "type": "http", "method": "GET", "url": "http://127.0.0.1:1/nope"},
            {"id": "end", "type": "end"}
        ]
    });
    let body = json!({
        "instance_id": null,
        "dsl": dsl,
        "input": {},
        "variables": {},
        "resume_from_step_id": "call"
    });
    let val = post_execute(app(), body).await;
    assert_eq!(val["status"], "completed");
}
