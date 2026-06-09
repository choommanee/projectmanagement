-- +goose Up
-- Seed the system "Document Approval (Project)" workflow template. It drives the
-- full document-approval loop:
--   review (human_task) → switch on outcome
--     approved → request_signature → wait → switch on signature outcome
--                  signed   → notify + end{status: approved_signed}
--                  declined → end{status: declined_at_signing}
--     rejected → notify + end{status: rejected}
--
-- START input contract (the caller must provide):
--   {
--     "project_id":   "<uuid>",
--     "document_id":  "<uuid>",          -- document-svc document to sign
--     "approver_id":  "<uuid>",          -- human_task assignee + done notice
--     "requester_id": "<uuid>",          -- rejection notice recipient
--     "signers": [ {"signer_id":"<uuid>","name":"...","email":"..."} ]
--   }
--
-- The matching DSL field names align with engines/workflow-runtime Step:
-- `type`, `cases`/`when`/`do`, `assignee`, `form`, `document_id`, `signers`,
-- `signing_order`, `channel`, `recipient`, `title`, `message`, `result`.
INSERT INTO workflow_template (name, description, category, definition) VALUES
('Document Approval (Project)',
 'Review a project document, then on approval collect signatures and resume when signed/declined',
 'document',
 '{"steps":[
   {"id":"review","type":"human_task","assignee":"{{input.approver_id}}","form":{"prompt":"อนุมัติเอกสารนี้หรือไม่? / Approve this document?","outcomes":["approved","rejected"],"fields":[{"name":"note","label":"หมายเหตุ / Note","type":"textarea","required":false}]}},
   {"id":"decide","type":"switch","cases":[
     {"when":"input.last_outcome == \"approved\"","do":[
       {"id":"get_sig","type":"request_signature","document_id":"{{input.document_id}}","signers":"{{input.signers}}","signing_order":"sequential","title":"ลงนามเอกสาร / Sign document"},
       {"id":"sig_decide","type":"switch","cases":[
         {"when":"input.signature_outcome == \"signed\"","do":[
           {"id":"notify_done","type":"notification","channel":"in_app","recipient":"{{input.approver_id}}","title":"เอกสารลงนามครบ","message":"เอกสารอนุมัติและลงนามครบแล้ว"},
           {"id":"end_ok","type":"end","result":{"status":"approved_signed"}}]},
         {"when":"default","do":[{"id":"end_decl","type":"end","result":{"status":"declined_at_signing"}}]}]}]},
     {"when":"default","do":[
       {"id":"notify_rej","type":"notification","channel":"in_app","recipient":"{{input.requester_id}}","title":"เอกสารถูกปฏิเสธ","message":"เอกสารไม่ผ่านการอนุมัติ"},
       {"id":"end_rej","type":"end","result":{"status":"rejected"}}]}]}
 ]}');

-- +goose Down
DELETE FROM workflow_template WHERE name = 'Document Approval (Project)';
