use axum::{routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use uuid::Uuid;

/// A lot node in the genealogy graph.
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct LotNode {
    pub lot_id: Uuid,
    pub item_id: Uuid,
    #[serde(default)]
    pub item_code: String,
    #[serde(default)]
    pub lot_no: String,
    #[serde(default)]
    pub parents: Vec<Uuid>,
    #[serde(default)]
    pub children: Vec<Uuid>,
}

/// Input to the /trace endpoint.
#[derive(Deserialize, Serialize)]
pub struct TraceInput {
    pub tenant_id: Uuid,
    pub root_lot_id: Uuid,
    /// "forward" (parent→child) or "backward" (child→parent)
    #[serde(default = "default_direction")]
    pub direction: String,
    pub graph: Vec<LotNode>,
}

fn default_direction() -> String {
    "forward".to_string()
}

/// One lot in the BFS result.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TraceNode {
    pub lot_id: Uuid,
    pub item_id: Uuid,
    pub item_code: String,
    pub lot_no: String,
    pub depth: usize,
    pub path: Vec<Uuid>,
}

/// Output of the /trace endpoint.
#[derive(Serialize, Deserialize)]
pub struct TraceOutput {
    pub tenant_id: Uuid,
    pub root_lot_id: Uuid,
    pub direction: String,
    pub nodes: Vec<TraceNode>,
}

/// Core BFS trace computation.
pub fn compute(input: TraceInput) -> TraceOutput {
    // Build lookup map
    let nodes: HashMap<Uuid, LotNode> = input
        .graph
        .into_iter()
        .map(|n| (n.lot_id, n))
        .collect();

    let root = input.root_lot_id;
    let forward = input.direction != "backward";

    let mut result: Vec<TraceNode> = Vec::new();
    let mut visited: HashSet<Uuid> = HashSet::new();
    let mut queue: VecDeque<(Uuid, usize, Vec<Uuid>)> = VecDeque::new();

    // Seed with root if it's in the graph
    if let Some(root_node) = nodes.get(&root) {
        visited.insert(root);
        result.push(TraceNode {
            lot_id: root,
            item_id: root_node.item_id,
            item_code: root_node.item_code.clone(),
            lot_no: root_node.lot_no.clone(),
            depth: 0,
            path: vec![root],
        });
        // Seed BFS with the root's neighbors
        let neighbors = if forward {
            root_node.children.clone()
        } else {
            root_node.parents.clone()
        };
        for neighbor in neighbors {
            if !visited.contains(&neighbor) {
                queue.push_back((neighbor, 1, vec![root, neighbor]));
            }
        }
    }

    while let Some((lot_id, depth, path)) = queue.pop_front() {
        if visited.contains(&lot_id) {
            continue;
        }
        visited.insert(lot_id);

        if let Some(node) = nodes.get(&lot_id) {
            result.push(TraceNode {
                lot_id,
                item_id: node.item_id,
                item_code: node.item_code.clone(),
                lot_no: node.lot_no.clone(),
                depth,
                path: path.clone(),
            });
            let neighbors = if forward {
                node.children.clone()
            } else {
                node.parents.clone()
            };
            for neighbor in neighbors {
                if !visited.contains(&neighbor) {
                    let mut new_path = path.clone();
                    new_path.push(neighbor);
                    queue.push_back((neighbor, depth + 1, new_path));
                }
            }
        }
    }

    // Sort by depth then lot_id for deterministic output
    result.sort_by_key(|n| (n.depth, n.lot_id));

    TraceOutput {
        tenant_id: input.tenant_id,
        root_lot_id: root,
        direction: if forward { "forward".to_string() } else { "backward".to_string() },
        nodes: result,
    }
}

pub fn router() -> Router {
    Router::new()
        .route(
            "/healthz",
            get(|| async { Json(serde_json::json!({"status": "ok"})) }),
        )
        .route(
            "/trace",
            post(|Json(input): Json<TraceInput>| async move { Json(compute(input)) }),
        )
}
