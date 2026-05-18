use axum::{routing::{get, post}, Json, Router};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Deserialize, Clone)]
pub struct DemandLine {
    pub item_id: Uuid,
    pub code: String,
    pub demand_qty: f64,
    #[serde(default)]
    pub due_date: Option<NaiveDate>,
    #[serde(default)]
    pub on_hand: f64,
    #[serde(default)]
    pub lead_time_days: i64,
    #[serde(default)]
    pub source_ref: Option<String>,
}

#[derive(Deserialize)]
pub struct RunInput {
    pub tenant_id: Uuid,
    pub items: Vec<DemandLine>,
}

#[derive(Serialize, Clone)]
pub struct DemandOut {
    pub item_id: Uuid,
    pub qty: f64,
    pub due_date: Option<NaiveDate>,
    pub source: String,
    pub source_ref: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct SupplyOut {
    pub item_id: Uuid,
    pub qty: f64,
    pub available_at: Option<NaiveDate>,
    pub source: String,
    pub source_ref: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct ActionOut {
    pub action: String,
    pub entity_type: String,
    pub entity_id: Option<Uuid>,
    pub message: String,
}

#[derive(Serialize)]
pub struct RunOutput {
    pub demands: Vec<DemandOut>,
    pub supplies: Vec<SupplyOut>,
    pub actions: Vec<ActionOut>,
}

pub fn compute(input: RunInput) -> RunOutput {
    let mut demands = Vec::new();
    let mut supplies = Vec::new();
    let mut actions = Vec::new();
    for it in input.items {
        let net = it.demand_qty - it.on_hand;
        if net > 0.0 {
            demands.push(DemandOut {
                item_id: it.item_id,
                qty: net,
                due_date: it.due_date,
                source: "wo".into(),
                source_ref: it.source_ref.clone(),
            });
            if it.on_hand > 0.0 {
                supplies.push(SupplyOut {
                    item_id: it.item_id,
                    qty: it.on_hand,
                    available_at: None,
                    source: "stock".into(),
                    source_ref: None,
                });
            }
            let release_by = it
                .due_date
                .map(|d| d - chrono::Duration::days(it.lead_time_days));
            let by = release_by
                .map(|d| d.format("%Y-%m-%d").to_string())
                .unwrap_or_else(|| "ASAP".into());
            actions.push(ActionOut {
                action: "release".into(),
                entity_type: "work_order".into(),
                entity_id: None,
                message: format!("Release WO for {:.2} {} by {}", net, it.code, by),
            });
        } else {
            supplies.push(SupplyOut {
                item_id: it.item_id,
                qty: it.demand_qty,
                available_at: None,
                source: "stock".into(),
                source_ref: None,
            });
            actions.push(ActionOut {
                action: "noop".into(),
                entity_type: "item".into(),
                entity_id: Some(it.item_id),
                message: format!(
                    "Sufficient stock for {} (on_hand={:.2})",
                    it.code, it.on_hand
                ),
            });
        }
    }
    RunOutput {
        demands,
        supplies,
        actions,
    }
}

pub fn router() -> Router {
    Router::new()
        .route(
            "/healthz",
            get(|| async { Json(serde_json::json!({"status":"ok"})) }),
        )
        .route(
            "/run",
            post(|Json(input): Json<RunInput>| async move { Json(compute(input)) }),
        )
}
