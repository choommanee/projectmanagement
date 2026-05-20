use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;
use traceability_engine::{router, LotNode, TraceInput, TraceOutput};
use uuid::Uuid;

fn make_app() -> axum::Router {
    router()
}

#[tokio::test]
async fn healthz_ok() {
    let app = make_app();
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let val: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(val["status"], "ok");
}

#[tokio::test]
async fn trace_3_node_graph_forward() {
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let c = Uuid::new_v4();
    let item = Uuid::new_v4();

    let input = TraceInput {
        tenant_id: Uuid::new_v4(),
        root_lot_id: a,
        direction: "forward".to_string(),
        graph: vec![
            LotNode {
                lot_id: a,
                item_id: item,
                item_code: "X-001".into(),
                lot_no: "L-A".into(),
                parents: vec![],
                children: vec![b],
            },
            LotNode {
                lot_id: b,
                item_id: item,
                item_code: "X-001".into(),
                lot_no: "L-B".into(),
                parents: vec![a],
                children: vec![c],
            },
            LotNode {
                lot_id: c,
                item_id: item,
                item_code: "X-001".into(),
                lot_no: "L-C".into(),
                parents: vec![b],
                children: vec![],
            },
        ],
    };

    let body = serde_json::to_string(&input).unwrap();
    let app = make_app();
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/trace")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let out: TraceOutput = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(out.nodes.len(), 3);
    // BFS order: A(0), B(1), C(2)
    assert_eq!(out.nodes[0].lot_id, a);
    assert_eq!(out.nodes[0].depth, 0);
    assert_eq!(out.nodes[1].lot_id, b);
    assert_eq!(out.nodes[1].depth, 1);
    assert_eq!(out.nodes[2].lot_id, c);
    assert_eq!(out.nodes[2].depth, 2);
    // Verify paths
    assert_eq!(out.nodes[2].path, vec![a, b, c]);
}

#[tokio::test]
async fn trace_backward() {
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let c = Uuid::new_v4();
    let item = Uuid::new_v4();

    // Graph: A→B→C; backward from C should give B(1), A(2)
    let input = TraceInput {
        tenant_id: Uuid::new_v4(),
        root_lot_id: c,
        direction: "backward".to_string(),
        graph: vec![
            LotNode {
                lot_id: a,
                item_id: item,
                item_code: "X-001".into(),
                lot_no: "L-A".into(),
                parents: vec![],
                children: vec![b],
            },
            LotNode {
                lot_id: b,
                item_id: item,
                item_code: "X-001".into(),
                lot_no: "L-B".into(),
                parents: vec![a],
                children: vec![c],
            },
            LotNode {
                lot_id: c,
                item_id: item,
                item_code: "X-001".into(),
                lot_no: "L-C".into(),
                parents: vec![b],
                children: vec![],
            },
        ],
    };

    let body = serde_json::to_string(&input).unwrap();
    let app = make_app();
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/trace")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let out: TraceOutput = serde_json::from_slice(&bytes).unwrap();

    // Should include C(0), B(1), A(2) when traversing backward
    assert_eq!(out.nodes.len(), 3);
    assert_eq!(out.nodes[0].lot_id, c);
    assert_eq!(out.nodes[0].depth, 0);
    assert_eq!(out.nodes[1].lot_id, b);
    assert_eq!(out.nodes[1].depth, 1);
    assert_eq!(out.nodes[2].lot_id, a);
    assert_eq!(out.nodes[2].depth, 2);
}
