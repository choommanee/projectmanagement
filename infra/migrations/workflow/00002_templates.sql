-- +goose Up

CREATE TABLE workflow_template (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    category    text NOT NULL DEFAULT 'general',
    definition  jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_system   bool NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO workflow_template (name, description, category, definition) VALUES
('Purchase Order Approval',
 'Multi-level approval for purchase orders with value-based routing',
 'finance',
 '{"steps":[
   {"id":"check_amount","step_type":"switch","name":"Check Amount","cases":[
     {"when":"{{input.amount}} < 10000","do":[
       {"id":"low_approval","step_type":"human_task","name":"Low-Value Approval","assignee":"{{input.manager_id}}","form":{"prompt":"PO {{input.po_number}} ({{input.amount}} THB) — quick approve?","fields":[]}}
     ]},
     {"when":"default","do":[
       {"id":"mgr_approval","step_type":"human_task","name":"Manager Approval","assignee":"{{input.manager_id}}","form":{"prompt":"PO {{input.po_number}} requires approval. Amount: {{input.amount}} THB","fields":[{"name":"notes","type":"text","label":"Notes"}]}},
       {"id":"notify_result","step_type":"notification","name":"Notify Requester","channel":"in_app","message":"Your PO {{input.po_number}} has been processed"}
     ]}
   ]},
   {"id":"done","step_type":"end","name":"Complete","result":{"po_number":"{{input.po_number}}","outcome":"{{outcome}}"}}
 ]}'),
('Leave Request Approval',
 'Employee leave request with manager approval and HR notification',
 'hr',
 '{"steps":[
   {"id":"mgr_approve","step_type":"human_task","name":"Manager Approval","assignee":"{{input.manager_id}}","form":{"prompt":"Leave request: {{input.employee_name}} from {{input.start_date}} to {{input.end_date}}","fields":[{"name":"notes","type":"text","label":"Comments"}]}},
   {"id":"notify","step_type":"notification","name":"Notify Employee","channel":"in_app","message":"Your leave request ({{input.start_date}} – {{input.end_date}}) has been {{outcome}}"},
   {"id":"done","step_type":"end","name":"Complete","result":{"status":"{{outcome}}"}}
 ]}'),
('Document Review & Approval',
 'Route a document for review then collect approval signature',
 'document',
 '{"steps":[
   {"id":"review","step_type":"human_task","name":"Document Review","assignee":"{{input.reviewer_id}}","form":{"prompt":"Please review document: {{input.document_title}}","fields":[{"name":"feedback","type":"text","label":"Reviewer Feedback"}]}},
   {"id":"route","step_type":"switch","name":"Review Result","cases":[
     {"when":"{{outcome}} == approved","do":[
       {"id":"sign_notify","step_type":"notification","name":"Request Signature","channel":"in_app","message":"Document {{input.document_title}} is ready for your signature"}
     ]},
     {"when":"default","do":[
       {"id":"reject_notify","step_type":"notification","name":"Notify Author","channel":"in_app","message":"Document {{input.document_title}} needs revision. Feedback: {{review.feedback}}"}
     ]}
   ]},
   {"id":"done","step_type":"end","name":"Complete","result":{"review_outcome":"{{outcome}}"}}
 ]}'),
('Change Request',
 'Technical change request with impact assessment and management approval',
 'engineering',
 '{"steps":[
   {"id":"impact","step_type":"human_task","name":"Impact Assessment","assignee":"{{input.tech_lead_id}}","form":{"prompt":"Assess impact of: {{input.title}}","fields":[{"name":"impact_level","type":"text","label":"Impact Level (low/medium/high)"},{"name":"effort_days","type":"text","label":"Effort (days)"}]}},
   {"id":"approval","step_type":"human_task","name":"Manager Approval","assignee":"{{input.manager_id}}","form":{"prompt":"Change: {{input.title}} — Impact: {{impact.impact_level}}, Effort: {{impact.effort_days}} days","fields":[]}},
   {"id":"done","step_type":"end","name":"Complete","result":{"change":"{{input.title}}","approved":"{{outcome}}"}}
 ]}'),
('Employee Onboarding',
 'New employee IT setup, HR induction, and welcome notification',
 'hr',
 '{"steps":[
   {"id":"it_setup","step_type":"human_task","name":"IT Account Setup","assignee":"{{input.it_admin_id}}","form":{"prompt":"Setup IT accounts for {{input.employee_name}} (start date: {{input.start_date}})","fields":[{"name":"accounts","type":"text","label":"Accounts Created"}]}},
   {"id":"hr_induction","step_type":"human_task","name":"HR Induction","assignee":"{{input.hr_id}}","form":{"prompt":"Complete HR induction for {{input.employee_name}}","fields":[]}},
   {"id":"welcome","step_type":"notification","name":"Welcome","channel":"in_app","message":"Welcome {{input.employee_name}}! Your onboarding is complete."},
   {"id":"done","step_type":"end","name":"Complete","result":{"employee":"{{input.employee_name}}","status":"onboarded"}}
 ]}'),
('Project Kickoff Checklist',
 'Structured kickoff: charter approval, team assignment, and milestone setup',
 'project',
 '{"steps":[
   {"id":"charter","step_type":"human_task","name":"Charter Approval","assignee":"{{input.sponsor_id}}","form":{"prompt":"Approve project charter for: {{input.project_name}}","fields":[{"name":"budget","type":"text","label":"Approved Budget"},{"name":"timeline","type":"text","label":"Target Timeline"}]}},
   {"id":"notify_team","step_type":"notification","name":"Notify Team","channel":"in_app","message":"Project {{input.project_name}} has been approved. Budget: {{charter.budget}}"},
   {"id":"done","step_type":"end","name":"Kickoff Complete","result":{"project":"{{input.project_name}}","budget":"{{charter.budget}}"}}
 ]}');

-- +goose Down
DROP TABLE IF EXISTS workflow_template;
