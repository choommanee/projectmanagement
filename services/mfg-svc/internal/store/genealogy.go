package store

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// GenealogyNode is a lot node returned by trace queries.
type GenealogyNode struct {
	LotID     uuid.UUID `json:"lot_id"`
	Depth     int       `json:"depth"`
	ItemID    uuid.UUID `json:"item_id"`
	ItemCode  string    `json:"item_code"`
	LotNo     string    `json:"lot_no"`
	Status    string    `json:"status"`
	QtyOnHand float64   `json:"qty_on_hand"`
}

// Genealogy handles lot traceability storage.
type Genealogy struct {
	p *pgxpool.Pool
}

func NewGenealogy(p *pgxpool.Pool) *Genealogy { return &Genealogy{p: p} }

func (s *Genealogy) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
	tx, err := s.p.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", tid.String())); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// AddGenealogy creates a parent→child lot link.
func (s *Genealogy) AddGenealogy(ctx context.Context, tid, parentLotID, childLotID uuid.UUID, woID *uuid.UUID, qty *float64) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO lot_genealogy(id, tenant_id, parent_lot_id, child_lot_id, work_order_id, qty)
			VALUES ($1,$2,$3,$4,$5,$6)
			ON CONFLICT (parent_lot_id, child_lot_id) DO UPDATE SET qty = EXCLUDED.qty`,
			uuid.New(), tid, parentLotID, childLotID, woID, qty)
		return err
	})
}

// TraceForward returns the closure of lots reachable from root (parent→child direction).
func (s *Genealogy) TraceForward(ctx context.Context, tid, root uuid.UUID, maxDepth int) ([]GenealogyNode, error) {
	if maxDepth <= 0 {
		maxDepth = 20
	}
	return s.traceQuery(ctx, tid, root, maxDepth, `
WITH RECURSIVE lineage AS (
  SELECT g.child_lot_id AS lot_id, g.parent_lot_id, 1 AS depth
  FROM lot_genealogy g
  WHERE g.parent_lot_id = $1 AND g.tenant_id = $2
  UNION ALL
  SELECT g.child_lot_id, g.parent_lot_id, l.depth + 1
  FROM lot_genealogy g
  JOIN lineage l ON g.parent_lot_id = l.lot_id
  WHERE l.depth < $3 AND g.tenant_id = $2
)
SELECT DISTINCT l.lot_id, l.depth, lot.item_id, i.code, lot.lot_no, lot.status, lot.qty_on_hand
FROM lineage l
JOIN lot ON lot.id = l.lot_id
JOIN item i ON i.id = lot.item_id
ORDER BY l.depth`)
}

// TraceBackward returns the closure of lots that lead to root (child→parent direction).
func (s *Genealogy) TraceBackward(ctx context.Context, tid, root uuid.UUID, maxDepth int) ([]GenealogyNode, error) {
	if maxDepth <= 0 {
		maxDepth = 20
	}
	return s.traceQuery(ctx, tid, root, maxDepth, `
WITH RECURSIVE lineage AS (
  SELECT g.parent_lot_id AS lot_id, g.child_lot_id, 1 AS depth
  FROM lot_genealogy g
  WHERE g.child_lot_id = $1 AND g.tenant_id = $2
  UNION ALL
  SELECT g.parent_lot_id, g.child_lot_id, l.depth + 1
  FROM lot_genealogy g
  JOIN lineage l ON g.child_lot_id = l.lot_id
  WHERE l.depth < $3 AND g.tenant_id = $2
)
SELECT DISTINCT l.lot_id, l.depth, lot.item_id, i.code, lot.lot_no, lot.status, lot.qty_on_hand
FROM lineage l
JOIN lot ON lot.id = l.lot_id
JOIN item i ON i.id = lot.item_id
ORDER BY l.depth`)
}

func (s *Genealogy) traceQuery(ctx context.Context, tid, root uuid.UUID, maxDepth int, q string) ([]GenealogyNode, error) {
	var nodes []GenealogyNode
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, q, root, tid, maxDepth)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var n GenealogyNode
			if err := rows.Scan(&n.LotID, &n.Depth, &n.ItemID, &n.ItemCode, &n.LotNo, &n.Status, &n.QtyOnHand); err != nil {
				return err
			}
			nodes = append(nodes, n)
		}
		return rows.Err()
	})
	return nodes, err
}

// LotsForTrace builds graph nodes for the root + its closure.
func (s *Genealogy) LotsForTrace(ctx context.Context, tid, root uuid.UUID, direction string) ([]LotNode, error) {
	// First get the root lot itself
	var rootNode LotNode
	if err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT l.id, l.item_id, i.code, l.lot_no, l.status
			FROM lot l JOIN item i ON i.id = l.item_id
			WHERE l.id = $1`, root).Scan(
			&rootNode.LotID, &rootNode.ItemID, &rootNode.ItemCode, &rootNode.LotNo, &rootNode.Status)
	}); err != nil {
		return nil, err
	}

	// Get edges for the closure
	edges, err := s.edgesForClosure(ctx, tid, root, direction)
	if err != nil {
		return nil, err
	}

	// Build a map of lot_id → node
	nodeMap := map[uuid.UUID]*LotNode{
		root: &rootNode,
	}
	for _, e := range edges {
		if _, ok := nodeMap[e.ChildLotID]; !ok {
			n := &LotNode{LotID: e.ChildLotID}
			nodeMap[e.ChildLotID] = n
		}
		if _, ok := nodeMap[e.ParentLotID]; !ok {
			n := &LotNode{LotID: e.ParentLotID}
			nodeMap[e.ParentLotID] = n
		}
	}

	// Populate children/parents for each edge
	for _, e := range edges {
		parent := nodeMap[e.ParentLotID]
		child := nodeMap[e.ChildLotID]
		parent.ChildrenLotIDs = append(parent.ChildrenLotIDs, e.ChildLotID)
		child.ParentLotIDs = append(child.ParentLotIDs, e.ParentLotID)
	}

	// Fetch lot+item data for any node not yet populated
	allIDs := make([]uuid.UUID, 0, len(nodeMap))
	for id := range nodeMap {
		allIDs = append(allIDs, id)
	}
	if err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		for id, node := range nodeMap {
			if node.ItemCode != "" {
				continue
			}
			if err := tx.QueryRow(ctx, `
				SELECT l.item_id, i.code, l.lot_no, l.status
				FROM lot l JOIN item i ON i.id = l.item_id
				WHERE l.id = $1`, id).Scan(&node.ItemID, &node.ItemCode, &node.LotNo, &node.Status); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}

	result := make([]LotNode, 0, len(nodeMap))
	for _, n := range nodeMap {
		result = append(result, *n)
	}
	return result, nil
}

type lotEdge struct {
	ParentLotID uuid.UUID
	ChildLotID  uuid.UUID
}

func (s *Genealogy) edgesForClosure(ctx context.Context, tid, root uuid.UUID, direction string) ([]lotEdge, error) {
	var q string
	if direction == "backward" {
		q = `
WITH RECURSIVE closure AS (
  SELECT parent_lot_id, child_lot_id FROM lot_genealogy
  WHERE child_lot_id = $1 AND tenant_id = $2
  UNION ALL
  SELECT g.parent_lot_id, g.child_lot_id FROM lot_genealogy g
  JOIN closure c ON g.child_lot_id = c.parent_lot_id
  WHERE g.tenant_id = $2
)
SELECT parent_lot_id, child_lot_id FROM closure`
	} else {
		q = `
WITH RECURSIVE closure AS (
  SELECT parent_lot_id, child_lot_id FROM lot_genealogy
  WHERE parent_lot_id = $1 AND tenant_id = $2
  UNION ALL
  SELECT g.parent_lot_id, g.child_lot_id FROM lot_genealogy g
  JOIN closure c ON g.parent_lot_id = c.child_lot_id
  WHERE g.tenant_id = $2
)
SELECT parent_lot_id, child_lot_id FROM closure`
	}

	var edges []lotEdge
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, q, root, tid)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var e lotEdge
			if err := rows.Scan(&e.ParentLotID, &e.ChildLotID); err != nil {
				return err
			}
			edges = append(edges, e)
		}
		return rows.Err()
	})
	return edges, err
}

// LotNode is a node in the lot genealogy graph.
type LotNode struct {
	LotID          uuid.UUID   `json:"lot_id"`
	ItemID         uuid.UUID   `json:"item_id"`
	ItemCode       string      `json:"item_code"`
	LotNo          string      `json:"lot_no"`
	Status         string      `json:"status"`
	ParentLotIDs   []uuid.UUID `json:"parents"`
	ChildrenLotIDs []uuid.UUID `json:"children"`
}

// TraceViaEngine fetches the closure, builds a graph, POSTs to the traceability-engine,
// and returns the result. Falls back to sorted GenealogyNodes on engine error.
func (s *Genealogy) TraceViaEngine(ctx context.Context, tid, root uuid.UUID, direction string, maxDepth int, engineURL string) (any, error) {
	// Get flat closure nodes for fallback
	var flatNodes []GenealogyNode
	var err error
	if direction == "backward" {
		flatNodes, err = s.TraceBackward(ctx, tid, root, maxDepth)
	} else {
		flatNodes, err = s.TraceForward(ctx, tid, root, maxDepth)
	}
	if err != nil {
		return nil, err
	}

	// Build graph nodes
	graphNodes, err := s.LotsForTrace(ctx, tid, root, direction)
	if err != nil {
		// Fall back to flat nodes
		return flatNodes, nil
	}

	// Attempt engine call
	type enginePayload struct {
		TenantID  string      `json:"tenant_id"`
		RootLotID string      `json:"root_lot_id"`
		Direction string      `json:"direction"`
		Graph     []LotNode   `json:"graph"`
	}
	payload := enginePayload{
		TenantID:  tid.String(),
		RootLotID: root.String(),
		Direction: direction,
		Graph:     graphNodes,
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return flatNodes, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, engineURL+"/trace", bytes.NewReader(bodyBytes))
	if err != nil {
		return flatNodes, nil
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		// Engine unreachable — return flat closure
		return flatNodes, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return flatNodes, nil
	}

	var result any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return flatNodes, nil
	}
	return result, nil
}
