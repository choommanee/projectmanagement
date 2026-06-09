use axum::{routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::time::Instant;
use uuid::Uuid;

// ─── DSL types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Dsl {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub trigger: Value,
    #[serde(default)]
    pub input_schema: Value,
    #[serde(default)]
    pub variables: Value,
    pub steps: Vec<Step>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Step {
    pub id: String,
    #[serde(rename = "type")]
    pub step_type: String,
    // expression
    pub expr: Option<String>,
    pub out: Option<String>,
    // set_variable
    pub name: Option<String>,
    pub value: Option<Value>,
    // switch
    pub cases: Option<Vec<SwitchCase>>,
    // http
    pub method: Option<String>,
    pub url: Option<String>,
    /// Extra request headers; values are template-resolved against the context.
    pub headers: Option<HashMap<String, String>>,
    /// Request body. A string is template-resolved (and parsed as JSON when
    /// possible); any other JSON value has its nested strings template-resolved.
    pub body: Option<Value>,
    pub retry: Option<RetryConfig>,
    // human_task
    pub assignee: Option<String>,
    pub form: Option<Value>,
    /// SLA duration ("30s"/"5m"/"2h"/"1d"); template-resolvable. Parsed to
    /// seconds and surfaced on the HumanTaskResult so workflow-svc can compute
    /// sla_deadline = now + sla.
    pub sla: Option<String>,
    // wait
    pub duration: Option<String>,
    // notification
    pub channel: Option<String>,
    pub message: Option<String>,
    pub title: Option<String>,
    pub kind: Option<String>,
    pub recipient: Option<String>,
    // end
    pub result: Option<Value>,
    // create_task / update_task_status
    pub project_id: Option<String>,
    pub task_title: Option<String>,
    pub task_assignee: Option<String>,
    pub task_priority: Option<String>,
    pub task_type: Option<String>,
    pub task_id: Option<String>,
    pub task_status: Option<String>,
    // create_document
    pub doc_title: Option<String>,
    pub doc_content: Option<String>,
    // request_signature
    pub document_id: Option<String>,
    pub signers: Option<Value>,
    pub signing_order: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SwitchCase {
    pub when: String,
    #[serde(rename = "do")]
    pub do_steps: Vec<Step>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RetryConfig {
    #[serde(rename = "max")]
    pub max_attempts: u32,
    pub backoff: Option<String>,
}

// ─── I/O types ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ExecuteInput {
    pub instance_id: Option<Uuid>,
    pub dsl: Dsl,
    pub input: Value,
    pub variables: Value,
    pub resume_from_step_id: Option<String>,
    /// Bearer token forwarded on every outgoing cross-service HTTP call.
    /// Absent => no Authorization header (legacy behavior).
    #[serde(default)]
    pub auth_token: Option<String>,
    /// Tenant id forwarded as `X-Tenant-Id` on every outgoing cross-service
    /// HTTP call. Absent => no header.
    #[serde(default)]
    pub tenant_id: Option<String>,
    /// Resume semantics. None / Some(true) (default) => skip up-to-AND-including
    /// the cursor step, then continue (correct for human_task / wait / signature
    /// pauses). Some(false) => re-execute the cursor step itself (skip only steps
    /// strictly BEFORE the cursor); used to retry a FAILED step.
    #[serde(default)]
    pub resume_inclusive: Option<bool>,
}

#[derive(Debug, Serialize, Clone)]
pub struct StepResult {
    pub step_id: String,
    pub step_type: String,
    pub status: String,
    pub input: Value,
    pub output: Value,
    pub error: Option<String>,
    pub duration_ms: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct HumanTaskResult {
    pub step_id: String,
    pub assignee: Option<String>,
    pub form: Value,
    /// Parsed SLA duration in seconds (from the step's `sla` field). None when
    /// the step declares no SLA. workflow-svc computes sla_deadline from this.
    pub sla_seconds: Option<i64>,
}

/// A resolved notification produced by a `notification` step. The Rust engine
/// never sends mail/webhooks itself — it only resolves templates and returns
/// the structured result; workflow-svc fans it out via libs/go/notification.
#[derive(Debug, Serialize, Clone)]
pub struct NotificationResult {
    pub step_id: String,
    pub channel: String,
    pub recipient: Option<String>,
    pub message: String,
    pub kind: String,
    pub title: String,
}

/// A signature envelope created by a `request_signature` step that the engine
/// paused on. workflow-svc persists this so it can correlate the document-svc
/// envelope webhook (signed/declined) back to the paused instance and resume.
#[derive(Debug, Serialize, Clone)]
pub struct PendingSignature {
    pub step_id: String,
    pub envelope_id: String,
    pub document_id: String,
}

#[derive(Debug, Serialize)]
pub struct ExecuteOutput {
    pub status: String,
    pub variables: Value,
    pub output: Value,
    pub cursor: Option<String>,
    pub error: Option<String>,
    pub steps: Vec<StepResult>,
    pub human_tasks: Vec<HumanTaskResult>,
    /// Notifications resolved during this run, to be delivered by workflow-svc.
    pub notifications: Vec<NotificationResult>,
    /// When the engine pauses on a `wait` step this is the number of seconds
    /// the service should sleep before resuming (used to compute wake_at).
    /// None for human_task pauses (which wake on task completion).
    pub wake_seconds: Option<i64>,
    /// Set only when the engine just paused on a `request_signature` step.
    /// Null otherwise.
    pub pending_signature: Option<PendingSignature>,
}

// ─── Expression Evaluator ─────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Number(f64),
    Str(String),
    Bool(bool),
    Null,
    Ident(String),
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    Eq,
    Ne,
    Gt,
    Lt,
    Ge,
    Le,
    And,
    Or,
    Not,
    LParen,
    RParen,
    Eof,
}

struct Lexer {
    chars: Vec<char>,
    pos: usize,
}

impl Lexer {
    fn new(s: &str) -> Self {
        Lexer { chars: s.chars().collect(), pos: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn next_char(&mut self) -> Option<char> {
        let c = self.chars.get(self.pos).copied();
        if c.is_some() { self.pos += 1; }
        c
    }

    fn skip_ws(&mut self) {
        while self.peek().map(|c| c.is_whitespace()).unwrap_or(false) {
            self.pos += 1;
        }
    }

    fn tokenize(&mut self) -> Vec<Token> {
        let mut tokens = Vec::new();
        loop {
            self.skip_ws();
            match self.peek() {
                None => { tokens.push(Token::Eof); break; }
                Some(c) => {
                    match c {
                        '+' => { self.next_char(); tokens.push(Token::Plus); }
                        '-' => { self.next_char(); tokens.push(Token::Minus); }
                        '*' => { self.next_char(); tokens.push(Token::Star); }
                        '/' => { self.next_char(); tokens.push(Token::Slash); }
                        '%' => { self.next_char(); tokens.push(Token::Percent); }
                        '(' => { self.next_char(); tokens.push(Token::LParen); }
                        ')' => { self.next_char(); tokens.push(Token::RParen); }
                        '!' => {
                            self.next_char();
                            if self.peek() == Some('=') { self.next_char(); tokens.push(Token::Ne); }
                            else { tokens.push(Token::Not); }
                        }
                        '=' => {
                            self.next_char();
                            if self.peek() == Some('=') { self.next_char(); tokens.push(Token::Eq); }
                            else { tokens.push(Token::Eq); } // single = also treated as ==
                        }
                        '>' => {
                            self.next_char();
                            if self.peek() == Some('=') { self.next_char(); tokens.push(Token::Ge); }
                            else { tokens.push(Token::Gt); }
                        }
                        '<' => {
                            self.next_char();
                            if self.peek() == Some('=') { self.next_char(); tokens.push(Token::Le); }
                            else { tokens.push(Token::Lt); }
                        }
                        '&' => {
                            self.next_char();
                            if self.peek() == Some('&') { self.next_char(); }
                            tokens.push(Token::And);
                        }
                        '|' => {
                            self.next_char();
                            if self.peek() == Some('|') { self.next_char(); }
                            tokens.push(Token::Or);
                        }
                        '\'' | '"' => {
                            let quote = c;
                            self.next_char();
                            let mut s = String::new();
                            loop {
                                match self.next_char() {
                                    None | Some('\n') => break,
                                    Some(ch) if ch == quote => break,
                                    Some('\\') => {
                                        if let Some(esc) = self.next_char() {
                                            match esc {
                                                'n' => s.push('\n'),
                                                't' => s.push('\t'),
                                                _ => s.push(esc),
                                            }
                                        }
                                    }
                                    Some(ch) => s.push(ch),
                                }
                            }
                            tokens.push(Token::Str(s));
                        }
                        c if c.is_ascii_digit() || c == '.' => {
                            let mut num = String::new();
                            while self.peek().map(|x| x.is_ascii_digit() || x == '.').unwrap_or(false) {
                                num.push(self.next_char().unwrap());
                            }
                            tokens.push(Token::Number(num.parse().unwrap_or(0.0)));
                        }
                        c if c.is_alphabetic() || c == '_' => {
                            let mut ident = String::new();
                            while self.peek().map(|x| x.is_alphanumeric() || x == '_' || x == '.').unwrap_or(false) {
                                ident.push(self.next_char().unwrap());
                            }
                            match ident.as_str() {
                                "true" => tokens.push(Token::Bool(true)),
                                "false" => tokens.push(Token::Bool(false)),
                                "null" | "nil" => tokens.push(Token::Null),
                                "and" => tokens.push(Token::And),
                                "or" => tokens.push(Token::Or),
                                "not" => tokens.push(Token::Not),
                                _ => tokens.push(Token::Ident(ident)),
                            }
                        }
                        _ => { self.next_char(); } // skip unknown chars
                    }
                }
            }
        }
        tokens
    }
}

pub struct ExprContext {
    pub input: Value,
    pub variables: Value,
    pub output: Value,
}

struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    fn new(tokens: Vec<Token>) -> Self {
        Parser { tokens, pos: 0 }
    }

    fn peek(&self) -> &Token {
        self.tokens.get(self.pos).unwrap_or(&Token::Eof)
    }

    fn consume(&mut self) -> &Token {
        let t = self.tokens.get(self.pos).unwrap_or(&Token::Eof);
        if self.pos < self.tokens.len() { self.pos += 1; }
        t
    }

    fn parse_expr(&mut self, ctx: &ExprContext) -> Result<Value, String> {
        self.parse_or(ctx)
    }

    fn parse_or(&mut self, ctx: &ExprContext) -> Result<Value, String> {
        let mut left = self.parse_and(ctx)?;
        loop {
            if self.peek() == &Token::Or {
                self.consume();
                let right = self.parse_and(ctx)?;
                left = Value::Bool(is_truthy(&left) || is_truthy(&right));
            } else {
                break;
            }
        }
        Ok(left)
    }

    fn parse_and(&mut self, ctx: &ExprContext) -> Result<Value, String> {
        let mut left = self.parse_cmp(ctx)?;
        loop {
            if self.peek() == &Token::And {
                self.consume();
                let right = self.parse_cmp(ctx)?;
                left = Value::Bool(is_truthy(&left) && is_truthy(&right));
            } else {
                break;
            }
        }
        Ok(left)
    }

    fn parse_cmp(&mut self, ctx: &ExprContext) -> Result<Value, String> {
        let left = self.parse_add(ctx)?;
        match self.peek().clone() {
            Token::Eq => { self.consume(); let r = self.parse_add(ctx)?; Ok(Value::Bool(values_eq(&left, &r))) }
            Token::Ne => { self.consume(); let r = self.parse_add(ctx)?; Ok(Value::Bool(!values_eq(&left, &r))) }
            Token::Gt => { self.consume(); let r = self.parse_add(ctx)?; Ok(Value::Bool(as_f64(&left) > as_f64(&r))) }
            Token::Lt => { self.consume(); let r = self.parse_add(ctx)?; Ok(Value::Bool(as_f64(&left) < as_f64(&r))) }
            Token::Ge => { self.consume(); let r = self.parse_add(ctx)?; Ok(Value::Bool(as_f64(&left) >= as_f64(&r))) }
            Token::Le => { self.consume(); let r = self.parse_add(ctx)?; Ok(Value::Bool(as_f64(&left) <= as_f64(&r))) }
            _ => Ok(left),
        }
    }

    fn parse_add(&mut self, ctx: &ExprContext) -> Result<Value, String> {
        let mut left = self.parse_mul(ctx)?;
        loop {
            match self.peek() {
                Token::Plus => {
                    self.consume();
                    let right = self.parse_mul(ctx)?;
                    // string concat if either is string
                    if left.is_string() || right.is_string() {
                        left = Value::String(format!("{}{}", val_to_str(&left), val_to_str(&right)));
                    } else {
                        left = Value::Number(serde_json::Number::from_f64(as_f64(&left) + as_f64(&right)).unwrap_or(serde_json::Number::from(0)));
                    }
                }
                Token::Minus => {
                    self.consume();
                    let right = self.parse_mul(ctx)?;
                    left = num_val(as_f64(&left) - as_f64(&right));
                }
                _ => break,
            }
        }
        Ok(left)
    }

    fn parse_mul(&mut self, ctx: &ExprContext) -> Result<Value, String> {
        let mut left = self.parse_unary(ctx)?;
        loop {
            match self.peek() {
                Token::Star => {
                    self.consume();
                    let right = self.parse_unary(ctx)?;
                    left = num_val(as_f64(&left) * as_f64(&right));
                }
                Token::Slash => {
                    self.consume();
                    let right = self.parse_unary(ctx)?;
                    let d = as_f64(&right);
                    if d == 0.0 { return Err("division by zero".into()); }
                    left = num_val(as_f64(&left) / d);
                }
                Token::Percent => {
                    self.consume();
                    let right = self.parse_unary(ctx)?;
                    left = num_val(as_f64(&left) % as_f64(&right));
                }
                _ => break,
            }
        }
        Ok(left)
    }

    fn parse_unary(&mut self, ctx: &ExprContext) -> Result<Value, String> {
        match self.peek().clone() {
            Token::Minus => {
                self.consume();
                let v = self.parse_primary(ctx)?;
                Ok(num_val(-as_f64(&v)))
            }
            Token::Not => {
                self.consume();
                let v = self.parse_primary(ctx)?;
                Ok(Value::Bool(!is_truthy(&v)))
            }
            _ => self.parse_primary(ctx),
        }
    }

    fn parse_primary(&mut self, ctx: &ExprContext) -> Result<Value, String> {
        match self.peek().clone() {
            Token::Number(n) => { self.consume(); Ok(num_val(n)) }
            Token::Str(s) => { self.consume(); Ok(Value::String(s)) }
            Token::Bool(b) => { self.consume(); Ok(Value::Bool(b)) }
            Token::Null => { self.consume(); Ok(Value::Null) }
            Token::LParen => {
                self.consume();
                let v = self.parse_expr(ctx)?;
                if self.peek() == &Token::RParen { self.consume(); }
                Ok(v)
            }
            Token::Ident(ident) => {
                self.consume();
                Ok(resolve_ident(&ident, ctx))
            }
            _ => Ok(Value::Null),
        }
    }
}

fn resolve_ident(ident: &str, ctx: &ExprContext) -> Value {
    let parts: Vec<&str> = ident.splitn(2, '.').collect();
    if parts.is_empty() { return Value::Null; }
    let root = match parts[0] {
        "input" => &ctx.input,
        "var" | "variables" => &ctx.variables,
        "output" => &ctx.output,
        _ => {
            // try variables first, then input
            if let Some(v) = ctx.variables.get(parts[0]) {
                return if parts.len() > 1 { walk_path(v, parts[1]) } else { v.clone() };
            }
            if let Some(v) = ctx.input.get(parts[0]) {
                return if parts.len() > 1 { walk_path(v, parts[1]) } else { v.clone() };
            }
            return Value::Null;
        }
    };
    if parts.len() > 1 {
        walk_path(root, parts[1])
    } else {
        root.clone()
    }
}

fn walk_path(v: &Value, path: &str) -> Value {
    let mut cur = v;
    let mut result = Value::Null;
    for part in path.split('.') {
        match cur.get(part) {
            Some(next) => { result = next.clone(); cur = next; }
            None => return Value::Null,
        }
    }
    result
}

fn is_truthy(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Null => false,
        Value::Number(n) => n.as_f64().unwrap_or(0.0) != 0.0,
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

fn values_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::String(x), Value::String(y)) => x == y,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Null, Value::Null) => true,
        _ => a == b,
    }
}

fn as_f64(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(0.0),
        Value::Bool(b) => if *b { 1.0 } else { 0.0 },
        Value::String(s) => s.parse().unwrap_or(0.0),
        _ => 0.0,
    }
}

fn num_val(f: f64) -> Value {
    Value::Number(serde_json::Number::from_f64(f).unwrap_or(serde_json::Number::from(0)))
}

fn val_to_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".into(),
        _ => v.to_string(),
    }
}

/// Evaluate an expression string against a context.
pub fn eval_expr(expr: &str, ctx: &ExprContext) -> Result<Value, String> {
    let mut lexer = Lexer::new(expr);
    let tokens = lexer.tokenize();
    let mut parser = Parser::new(tokens);
    parser.parse_expr(ctx)
}

/// Resolve a template string like "{{input.manager_id}}" against context.
fn resolve_template(s: &str, ctx: &ExprContext) -> String {
    let mut result = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '{' && chars.peek() == Some(&'{') {
            chars.next();
            let mut expr = String::new();
            loop {
                match chars.next() {
                    None => break,
                    Some('}') if chars.peek() == Some(&'}') => { chars.next(); break; }
                    Some(ch) => expr.push(ch),
                }
            }
            let resolved = match eval_expr(expr.trim(), ctx) {
                Ok(v) => val_to_str(&v),
                Err(_) => expr.trim().to_string(),
            };
            result.push_str(&resolved);
        } else {
            result.push(c);
        }
    }
    result
}

// ─── Step executor ────────────────────────────────────────────────────────────

/// Outcome of running a (sub)list of steps when execution stops early:
/// (status, output, cursor, error).
type RunOutcome = (String, Option<Value>, Option<String>, Option<String>);

struct Executor {
    variables: Value,
    steps: Vec<StepResult>,
    human_tasks: Vec<HumanTaskResult>,
    notifications: Vec<NotificationResult>,
    wake_seconds: Option<i64>,
    pending_signature: Option<PendingSignature>,
    auth_token: Option<String>,
    tenant_id: Option<String>,
    /// true => skip cursor inclusively (default); false => re-run the cursor step.
    resume_inclusive: bool,
}

impl Executor {
    fn new(variables: Value) -> Self {
        Executor {
            variables,
            steps: Vec::new(),
            human_tasks: Vec::new(),
            notifications: Vec::new(),
            wake_seconds: None,
            pending_signature: None,
            auth_token: None,
            tenant_id: None,
            resume_inclusive: true,
        }
    }

    /// Build the auth/tenant header list for an outgoing cross-service call.
    fn svc_headers(&self) -> Vec<(String, String)> {
        let mut h = Vec::new();
        if let Some(tok) = &self.auth_token {
            if !tok.is_empty() {
                h.push(("Authorization".to_string(), format!("Bearer {}", tok)));
            }
        }
        if let Some(tid) = &self.tenant_id {
            if !tid.is_empty() {
                h.push(("X-Tenant-Id".to_string(), tid.clone()));
            }
        }
        h
    }

    fn ctx(&self, input: &Value) -> ExprContext {
        ExprContext {
            input: input.clone(),
            variables: self.variables.clone(),
            output: Value::Null,
        }
    }

    /// Execute a list of steps. Returns Some(ExecuteOutput) if execution should stop (paused/failed/completed).
    /// Returns None if steps exhausted without hitting end.
    fn run_steps(
        &mut self,
        steps: &[Step],
        input: &Value,
        resume_from: Option<&str>,
        _is_inline: bool,
    ) -> Option<RunOutcome> {
        // (status, output, cursor, error)
        // When resuming, skip all steps UP TO AND INCLUDING the cursor step,
        // then continue from the step after the cursor.
        let mut skipping = resume_from.is_some();

        for step in steps {
            if skipping {
                if step.id == resume_from.unwrap_or("") {
                    // Found the cursor step.
                    skipping = false;
                    if self.resume_inclusive {
                        // Inclusive (default): cursor already executed/paused — skip
                        // it and resume from the next step.
                        continue;
                    }
                    // Non-inclusive: re-execute the cursor step itself — fall through
                    // to the normal execution path below WITHOUT continuing.
                } else {
                    // Cursor may be nested inside a switch case's do-steps.
                    // Re-evaluate the matching case and recurse with resume_from set.
                    if step.step_type == "switch" {
                        if let Some(cases) = &step.cases {
                            let ctx = self.ctx(input);
                            for case in cases {
                                let case_matches = case.when == "default"
                                    || eval_expr(&case.when, &ctx).map(|v| is_truthy(&v)).unwrap_or(false);
                                if case_matches && contains_step_id(&case.do_steps, resume_from.unwrap_or("")) {
                                    skipping = false;
                                    let step_input = json!({"variables": self.variables, "input": input});
                                    self.steps.push(StepResult {
                                        step_id: step.id.clone(),
                                        step_type: step.step_type.clone(),
                                        status: "completed".into(),
                                        input: step_input,
                                        output: json!({"matched": true}),
                                        error: None,
                                        duration_ms: 0,
                                    });
                                    if let Some(result) = self.run_steps(&case.do_steps, input, resume_from, true) {
                                        return Some(result);
                                    }
                                    break;
                                }
                                if case_matches { break; } // only first matching case
                            }
                        }
                    }
                    // Still skipping (cursor not this step / handled by recursion):
                    // move to the next step.
                    continue;
                }
            }

            let start = Instant::now();
            let step_input = json!({
                "variables": self.variables,
                "input": input
            });

            match step.step_type.as_str() {
                "expression" => {
                    let expr = step.expr.as_deref().unwrap_or("");
                    let out_var = step.out.as_deref().unwrap_or("_result");
                    let ctx = self.ctx(input);
                    match eval_expr(expr, &ctx) {
                        Ok(val) => {
                            if let Value::Object(ref mut map) = self.variables {
                                map.insert(out_var.to_string(), val.clone());
                            } else {
                                self.variables = json!({ out_var: val });
                            }
                            let dur = start.elapsed().as_millis() as u64;
                            self.steps.push(StepResult {
                                step_id: step.id.clone(),
                                step_type: step.step_type.clone(),
                                status: "completed".into(),
                                input: step_input,
                                output: json!({ out_var: self.variables.get(out_var) }),
                                error: None,
                                duration_ms: dur,
                            });
                        }
                        Err(e) => {
                            let dur = start.elapsed().as_millis() as u64;
                            self.steps.push(StepResult {
                                step_id: step.id.clone(),
                                step_type: step.step_type.clone(),
                                status: "failed".into(),
                                input: step_input,
                                output: Value::Null,
                                error: Some(e.clone()),
                                duration_ms: dur,
                            });
                            return Some(("failed".into(), None, None, Some(e)));
                        }
                    }
                }

                "set_variable" => {
                    let var_name = step.name.as_deref().unwrap_or("_var");
                    let val = resolve_json_templates(step.value.clone().unwrap_or(Value::Null), &self.ctx(input));
                    if let Value::Object(ref mut map) = self.variables {
                        map.insert(var_name.to_string(), val.clone());
                    } else {
                        self.variables = json!({ var_name: val });
                    }
                    let dur = start.elapsed().as_millis() as u64;
                    self.steps.push(StepResult {
                        step_id: step.id.clone(),
                        step_type: step.step_type.clone(),
                        status: "completed".into(),
                        input: step_input,
                        output: json!({ var_name: &self.variables[var_name] }),
                        error: None,
                        duration_ms: dur,
                    });
                }

                "switch" => {
                    let cases = step.cases.as_deref().unwrap_or(&[]);
                    let ctx = self.ctx(input);
                    let mut matched = false;
                    let mut matched_do: Option<Vec<Step>> = None;

                    for case in cases {
                        if case.when == "default" {
                            matched = true;
                            matched_do = Some(case.do_steps.clone());
                            break;
                        }
                        match eval_expr(&case.when, &ctx) {
                            Ok(val) if is_truthy(&val) => {
                                matched = true;
                                matched_do = Some(case.do_steps.clone());
                                break;
                            }
                            _ => {}
                        }
                    }

                    // Record the switch step itself
                    let dur = start.elapsed().as_millis() as u64;
                    self.steps.push(StepResult {
                        step_id: step.id.clone(),
                        step_type: step.step_type.clone(),
                        status: if matched { "completed" } else { "skipped" }.into(),
                        input: step_input,
                        output: json!({ "matched": matched }),
                        error: None,
                        duration_ms: dur,
                    });

                    if let Some(do_steps) = matched_do {
                        // Execute inline steps — pass is_inline=true so that resume won't apply
                        if let Some(result) = self.run_steps(&do_steps, input, None, true) {
                            return Some(result);
                        }
                    }
                }

                "http" => {
                    let ctx = self.ctx(input);
                    let method = step.method.as_deref().unwrap_or("GET").to_uppercase();
                    let url = resolve_template(step.url.as_deref().unwrap_or(""), &ctx);
                    let max_attempts = step.retry.as_ref().map(|r| r.max_attempts).unwrap_or(1);
                    let backoff = step.retry.as_ref().and_then(|r| r.backoff.as_deref()).unwrap_or("fixed");

                    // Merge step headers (template-resolved values) over the
                    // auth/tenant headers; a step header wins on key collision.
                    let mut headers = self.svc_headers();
                    if let Some(custom) = &step.headers {
                        for (k, v) in custom {
                            if k.trim().is_empty() {
                                continue;
                            }
                            let resolved = resolve_template(v, &ctx);
                            headers.retain(|(hk, _)| !hk.eq_ignore_ascii_case(k));
                            headers.push((k.clone(), resolved));
                        }
                    }

                    // Resolve the body: a string is template-resolved then parsed
                    // as JSON when possible (designer textarea holds JSON text);
                    // any other JSON value gets nested templates resolved.
                    let body: Option<Value> = match &step.body {
                        Some(Value::String(s)) => {
                            let resolved = resolve_template(s, &ctx);
                            if resolved.trim().is_empty() {
                                None
                            } else {
                                Some(serde_json::from_str(&resolved).unwrap_or(Value::String(resolved)))
                            }
                        }
                        Some(Value::Null) | None => None,
                        Some(other) => Some(resolve_json_templates(other.clone(), &ctx)),
                    };

                    let mut last_err: Option<String> = None;
                    let mut step_out = Value::Null;
                    let mut success = false;

                    for attempt in 0..max_attempts {
                        if attempt > 0 {
                            let sleep_secs = if backoff == "exponential" {
                                std::cmp::min(2u64.pow(attempt), 30)
                            } else {
                                1
                            };
                            std::thread::sleep(std::time::Duration::from_secs(sleep_secs));
                        }

                        // Use reqwest blocking via a simple approach.
                        // Forward auth/tenant headers when present (no-op if absent).
                        let result = make_http_request_h(&method, &url, body.as_ref(), &headers);
                        match result {
                            Ok(out) => {
                                step_out = out;
                                success = true;
                                break;
                            }
                            Err(e) => {
                                last_err = Some(e);
                            }
                        }
                    }

                    let dur = start.elapsed().as_millis() as u64;
                    if success {
                        self.steps.push(StepResult {
                            step_id: step.id.clone(),
                            step_type: step.step_type.clone(),
                            status: "completed".into(),
                            input: step_input,
                            output: step_out,
                            error: None,
                            duration_ms: dur,
                        });
                    } else {
                        let err = last_err.unwrap_or_else(|| "http request failed".into());
                        self.steps.push(StepResult {
                            step_id: step.id.clone(),
                            step_type: step.step_type.clone(),
                            status: "failed".into(),
                            input: step_input,
                            output: Value::Null,
                            error: Some(err.clone()),
                            duration_ms: dur,
                        });
                        return Some(("failed".into(), None, Some(step.id.clone()), Some(err)));
                    }
                }

                "human_task" => {
                    let ctx = self.ctx(input);
                    let assignee_raw = step.assignee.as_deref().unwrap_or("");
                    let assignee = if assignee_raw.contains("{{") {
                        let resolved = resolve_template(assignee_raw, &ctx);
                        if resolved.is_empty() { None } else { Some(resolved) }
                    } else if assignee_raw.is_empty() {
                        None
                    } else {
                        Some(assignee_raw.to_string())
                    };

                    let form = resolve_json_templates(
                        step.form.clone().unwrap_or(Value::Null),
                        &ctx,
                    );
                    // SLA duration ("30s"/"5m"/"2h"/"1d"); 0/invalid => no SLA.
                    let sla_seconds = step.sla.as_deref().and_then(|raw| {
                        let resolved = if raw.contains("{{") {
                            resolve_template(raw, &ctx)
                        } else {
                            raw.to_string()
                        };
                        let secs = parse_duration_secs(&resolved);
                        if secs > 0 { Some(secs) } else { None }
                    });
                    self.human_tasks.push(HumanTaskResult {
                        step_id: step.id.clone(),
                        assignee: assignee.clone(),
                        form: form.clone(),
                        sla_seconds,
                    });

                    let dur = start.elapsed().as_millis() as u64;
                    self.steps.push(StepResult {
                        step_id: step.id.clone(),
                        step_type: step.step_type.clone(),
                        status: "running".into(),
                        input: step_input,
                        output: json!({ "queued": true, "assignee": assignee, "sla_seconds": sla_seconds }),
                        error: None,
                        duration_ms: dur,
                    });

                    return Some(("paused".into(), None, Some(step.id.clone()), None));
                }

                "wait" => {
                    let ctx = self.ctx(input);
                    let dur_raw = step.duration.as_deref().unwrap_or("0s");
                    let resolved = if dur_raw.contains("{{") {
                        resolve_template(dur_raw, &ctx)
                    } else {
                        dur_raw.to_string()
                    };
                    let wake_secs = parse_duration_secs(&resolved);
                    self.wake_seconds = Some(wake_secs);
                    let dur = start.elapsed().as_millis() as u64;
                    self.steps.push(StepResult {
                        step_id: step.id.clone(),
                        step_type: step.step_type.clone(),
                        status: "running".into(),
                        input: step_input,
                        output: json!({ "duration": resolved, "wake_seconds": wake_secs }),
                        error: None,
                        duration_ms: dur,
                    });
                    return Some(("paused".into(), None, Some(step.id.clone()), None));
                }

                "notification" => {
                    let ctx = self.ctx(input);
                    let message = resolve_template(step.message.as_deref().unwrap_or(""), &ctx);
                    let channel = resolve_template(step.channel.as_deref().unwrap_or("in_app"), &ctx);
                    let kind = resolve_template(step.kind.as_deref().unwrap_or("workflow.notification"), &ctx);
                    let title = {
                        let raw = step.title.as_deref().unwrap_or("");
                        if raw.is_empty() {
                            "Workflow notification".to_string()
                        } else {
                            resolve_template(raw, &ctx)
                        }
                    };
                    // recipient may come from `recipient` or fall back to `assignee`
                    let recipient_raw = step
                        .recipient
                        .as_deref()
                        .or(step.assignee.as_deref())
                        .unwrap_or("");
                    let recipient = if recipient_raw.is_empty() {
                        None
                    } else {
                        let r = resolve_template(recipient_raw, &ctx);
                        if r.is_empty() { None } else { Some(r) }
                    };

                    self.notifications.push(NotificationResult {
                        step_id: step.id.clone(),
                        channel: channel.clone(),
                        recipient: recipient.clone(),
                        message: message.clone(),
                        kind,
                        title,
                    });

                    let dur = start.elapsed().as_millis() as u64;
                    self.steps.push(StepResult {
                        step_id: step.id.clone(),
                        step_type: step.step_type.clone(),
                        status: "completed".into(),
                        input: step_input,
                        output: json!({ "queued": true, "channel": channel, "recipient": recipient }),
                        error: None,
                        duration_ms: dur,
                    });
                }

                "end" => {
                    let ctx = self.ctx(input);
                    let output = resolve_json_templates(step.result.clone().unwrap_or(Value::Null), &ctx);
                    let dur = start.elapsed().as_millis() as u64;
                    self.steps.push(StepResult {
                        step_id: step.id.clone(),
                        step_type: step.step_type.clone(),
                        status: "completed".into(),
                        input: step_input,
                        output: output.clone(),
                        error: None,
                        duration_ms: dur,
                    });
                    return Some(("completed".into(), Some(output), None, None));
                }

                "create_task" => {
                    let ctx = self.ctx(input);
                    let project_id = resolve_template(
                        step.project_id.as_deref().unwrap_or(""),
                        &ctx,
                    );
                    let title = resolve_template(
                        step.task_title.as_deref().unwrap_or("Untitled Task"),
                        &ctx,
                    );
                    let assignee = resolve_template(
                        step.task_assignee.as_deref().unwrap_or(""),
                        &ctx,
                    );
                    let priority = resolve_template(
                        step.task_priority.as_deref().unwrap_or("med"),
                        &ctx,
                    );
                    let task_type = resolve_template(
                        step.task_type.as_deref().unwrap_or("task"),
                        &ctx,
                    );
                    let code = format!("AUTO-{}", &step.id[..step.id.len().min(4)].to_uppercase());
                    let mut body = json!({
                        "code": code,
                        "title": title,
                        "priority": priority,
                        "type": task_type,
                    });
                    if !assignee.is_empty() {
                        body["assignee_id"] = Value::String(assignee);
                    }
                    let svc_url = std::env::var("PROJECT_SVC_URL")
                        .unwrap_or_else(|_| "http://localhost:8083".into());
                    let url = format!("{}/v1/projects/{}/tasks", svc_url, project_id);
                    let dur = start.elapsed().as_millis() as u64;
                    match make_http_post_json_h(&url, body, &self.svc_headers()) {
                        Ok(out) => {
                            self.steps.push(StepResult {
                                step_id: step.id.clone(),
                                step_type: step.step_type.clone(),
                                status: "completed".into(),
                                input: step_input,
                                output: out,
                                error: None,
                                duration_ms: dur,
                            });
                        }
                        Err(e) => {
                            tracing::warn!(step_id = %step.id, err = %e, "create_task failed, continuing");
                            self.steps.push(StepResult {
                                step_id: step.id.clone(),
                                step_type: step.step_type.clone(),
                                status: "failed".into(),
                                input: step_input,
                                output: Value::Null,
                                error: Some(e),
                                duration_ms: dur,
                            });
                        }
                    }
                }

                "create_document" => {
                    let ctx = self.ctx(input);
                    let project_id = resolve_template(
                        step.project_id.as_deref().unwrap_or(""),
                        &ctx,
                    );
                    let title = resolve_template(
                        step.doc_title.as_deref().unwrap_or("Untitled Document"),
                        &ctx,
                    );
                    let content = resolve_template(
                        step.doc_content.as_deref().unwrap_or(""),
                        &ctx,
                    );
                    let body = json!({
                        "title": title,
                        "project_id": project_id,
                        "content": content,
                        "kind": "general",
                    });
                    let svc_url = std::env::var("DOCUMENT_SVC_URL")
                        .unwrap_or_else(|_| "http://localhost:8084".into());
                    let url = format!("{}/v1/documents", svc_url);
                    let dur = start.elapsed().as_millis() as u64;
                    match make_http_post_json_h(&url, body, &self.svc_headers()) {
                        Ok(out) => {
                            self.steps.push(StepResult {
                                step_id: step.id.clone(),
                                step_type: step.step_type.clone(),
                                status: "completed".into(),
                                input: step_input,
                                output: out,
                                error: None,
                                duration_ms: dur,
                            });
                        }
                        Err(e) => {
                            tracing::warn!(step_id = %step.id, err = %e, "create_document failed, continuing");
                            self.steps.push(StepResult {
                                step_id: step.id.clone(),
                                step_type: step.step_type.clone(),
                                status: "failed".into(),
                                input: step_input,
                                output: Value::Null,
                                error: Some(e),
                                duration_ms: dur,
                            });
                        }
                    }
                }

                "request_signature" => {
                    let ctx = self.ctx(input);
                    let document_id = resolve_template(
                        step.document_id.as_deref().unwrap_or(""),
                        &ctx,
                    );
                    let signing_order = {
                        let raw = step.signing_order.as_deref().unwrap_or("sequential");
                        let r = resolve_template(raw, &ctx);
                        if r.is_empty() { "sequential".to_string() } else { r }
                    };
                    let title = {
                        let raw = step.title.as_deref().unwrap_or("");
                        if raw.is_empty() { None } else { Some(resolve_template(raw, &ctx)) }
                    };

                    // Resolve signers: either an inline array, or a template
                    // string that resolves+parses to an array.
                    let signers: Value = match &step.signers {
                        Some(Value::String(s)) => {
                            let resolved = resolve_template(s, &ctx);
                            serde_json::from_str(&resolved).unwrap_or(Value::Null)
                        }
                        Some(Value::Array(_)) => {
                            resolve_json_templates(step.signers.clone().unwrap(), &ctx)
                        }
                        Some(other) => resolve_json_templates(other.clone(), &ctx),
                        None => Value::Null,
                    };

                    let mut create_body = json!({
                        "signing_order": signing_order,
                        "signers": signers,
                    });
                    if let Some(t) = &title {
                        create_body["title"] = Value::String(t.clone());
                    }

                    let svc_url = std::env::var("DOCUMENT_SVC_URL")
                        .unwrap_or_else(|_| "http://localhost:8084".into());
                    let create_url = format!(
                        "{}/v1/documents/{}/sign-envelopes",
                        svc_url, document_id
                    );

                    let headers = self.svc_headers();
                    let create_res = make_http_post_json_h(&create_url, create_body, &headers);
                    let (envelope_id, create_out) = match create_res {
                        Ok(out) => {
                            let status = out.get("status").and_then(|s| s.as_u64()).unwrap_or(0);
                            if !(200..300).contains(&status) {
                                let dur = start.elapsed().as_millis() as u64;
                                let err = format!(
                                    "create sign-envelope returned status {}",
                                    status
                                );
                                self.steps.push(StepResult {
                                    step_id: step.id.clone(),
                                    step_type: step.step_type.clone(),
                                    status: "failed".into(),
                                    input: step_input,
                                    output: out,
                                    error: Some(err.clone()),
                                    duration_ms: dur,
                                });
                                return Some(("failed".into(), None, Some(step.id.clone()), Some(err)));
                            }
                            match extract_envelope_id(&out) {
                                Some(id) => (id, out),
                                None => {
                                    let dur = start.elapsed().as_millis() as u64;
                                    let err = "could not parse envelope id from create response".to_string();
                                    self.steps.push(StepResult {
                                        step_id: step.id.clone(),
                                        step_type: step.step_type.clone(),
                                        status: "failed".into(),
                                        input: step_input,
                                        output: out,
                                        error: Some(err.clone()),
                                        duration_ms: dur,
                                    });
                                    return Some(("failed".into(), None, Some(step.id.clone()), Some(err)));
                                }
                            }
                        }
                        Err(e) => {
                            let dur = start.elapsed().as_millis() as u64;
                            self.steps.push(StepResult {
                                step_id: step.id.clone(),
                                step_type: step.step_type.clone(),
                                status: "failed".into(),
                                input: step_input,
                                output: Value::Null,
                                error: Some(e.clone()),
                                duration_ms: dur,
                            });
                            return Some(("failed".into(), None, Some(step.id.clone()), Some(e)));
                        }
                    };

                    // Send the envelope.
                    let send_url = format!(
                        "{}/v1/sign-envelopes/{}/send",
                        svc_url, envelope_id
                    );
                    let send_res = make_http_post_json_h(&send_url, json!({}), &headers);
                    match send_res {
                        Ok(out) => {
                            let status = out.get("status").and_then(|s| s.as_u64()).unwrap_or(0);
                            if !(200..300).contains(&status) {
                                let dur = start.elapsed().as_millis() as u64;
                                let err = format!("send sign-envelope returned status {}", status);
                                self.steps.push(StepResult {
                                    step_id: step.id.clone(),
                                    step_type: step.step_type.clone(),
                                    status: "failed".into(),
                                    input: step_input,
                                    output: out,
                                    error: Some(err.clone()),
                                    duration_ms: dur,
                                });
                                return Some(("failed".into(), None, Some(step.id.clone()), Some(err)));
                            }
                        }
                        Err(e) => {
                            let dur = start.elapsed().as_millis() as u64;
                            self.steps.push(StepResult {
                                step_id: step.id.clone(),
                                step_type: step.step_type.clone(),
                                status: "failed".into(),
                                input: step_input,
                                output: Value::Null,
                                error: Some(e.clone()),
                                duration_ms: dur,
                            });
                            return Some(("failed".into(), None, Some(step.id.clone()), Some(e)));
                        }
                    }

                    // Success: record running + pause for the signature outcome.
                    self.pending_signature = Some(PendingSignature {
                        step_id: step.id.clone(),
                        envelope_id: envelope_id.clone(),
                        document_id: document_id.clone(),
                    });
                    let dur = start.elapsed().as_millis() as u64;
                    self.steps.push(StepResult {
                        step_id: step.id.clone(),
                        step_type: step.step_type.clone(),
                        status: "running".into(),
                        input: step_input,
                        output: json!({
                            "envelope_id": envelope_id,
                            "document_id": document_id,
                            "create_response": create_out,
                        }),
                        error: None,
                        duration_ms: dur,
                    });
                    return Some(("paused".into(), None, Some(step.id.clone()), None));
                }

                unknown => {
                    let dur = start.elapsed().as_millis() as u64;
                    self.steps.push(StepResult {
                        step_id: step.id.clone(),
                        step_type: step.step_type.clone(),
                        status: "skipped".into(),
                        input: step_input,
                        output: Value::Null,
                        error: None,
                        duration_ms: dur,
                    });
                    tracing::warn!(step_id = %step.id, step_type = %unknown, "unknown step type, skipping");
                }
            }
        }

        None // reached end of step list without explicit end/pause/fail
    }
}

/// Parse a duration string like "30s", "5m", "2h", "1d", or a bare number
/// (interpreted as seconds) into a number of seconds. Unknown/invalid input
/// yields 0 (resume immediately on next poll).
fn parse_duration_secs(s: &str) -> i64 {
    let s = s.trim();
    if s.is_empty() {
        return 0;
    }
    let (num_part, unit): (String, char) = {
        let last = s.chars().last().unwrap();
        if last.is_ascii_alphabetic() {
            (s[..s.len() - last.len_utf8()].to_string(), last.to_ascii_lowercase())
        } else {
            (s.to_string(), 's')
        }
    };
    let n: f64 = num_part.trim().parse().unwrap_or(0.0);
    let mult = match unit {
        's' => 1.0,
        'm' => 60.0,
        'h' => 3600.0,
        'd' => 86400.0,
        _ => 1.0,
    };
    (n * mult).round() as i64
}

/// Extract the envelope id from a create-sign-envelope response. The helper
/// `make_http_post_json_h` wraps the service body under `body`. The service may
/// return the envelope at the top level or nested under `envelope`, and the id
/// field may be `id` or `ID`.
fn extract_envelope_id(out: &Value) -> Option<String> {
    let body = out.get("body").unwrap_or(out);
    // Candidate objects: body itself, then body.envelope.
    let candidates = [body, body.get("envelope").unwrap_or(&Value::Null)];
    for c in candidates {
        for key in ["id", "ID"] {
            if let Some(v) = c.get(key) {
                if let Some(s) = v.as_str() {
                    if !s.is_empty() {
                        return Some(s.to_string());
                    }
                }
            }
        }
    }
    None
}

/// Recursively search for a step ID in a step tree (including switch do-blocks).
fn contains_step_id(steps: &[Step], target: &str) -> bool {
    for step in steps {
        if step.id == target { return true; }
        if let Some(cases) = &step.cases {
            for case in cases {
                if contains_step_id(&case.do_steps, target) { return true; }
            }
        }
    }
    false
}

/// Recursively resolve {{expr}} templates in every string inside a JSON value.
fn resolve_json_templates(v: Value, ctx: &ExprContext) -> Value {
    match v {
        Value::String(s) => Value::String(resolve_template(&s, ctx)),
        Value::Array(arr) => Value::Array(arr.into_iter().map(|x| resolve_json_templates(x, ctx)).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter().map(|(k, val)| (k, resolve_json_templates(val, ctx))).collect(),
        ),
        other => other,
    }
}

/// Issue an HTTP request with an optional JSON body and extra headers
/// (auth/tenant + step-declared). A `Value::String` body is sent verbatim;
/// any other JSON value is serialized. Content-Type defaults to
/// application/json unless the caller already supplied one.
fn make_http_request_h(
    method: &str,
    url: &str,
    body: Option<&Value>,
    headers: &[(String, String)],
) -> Result<Value, String> {
    // Use reqwest blocking in a spawned thread to avoid tokio runtime conflict.
    let url_owned = url.to_owned();
    let method_owned = method.to_owned();
    let headers_owned = headers.to_vec();
    let body_owned = body.cloned();
    let result = std::thread::spawn(move || -> Result<Value, String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e: reqwest::Error| e.to_string())?;
        let mut req = match method_owned.as_str() {
            "POST" => client.post(&url_owned),
            "PUT" => client.put(&url_owned),
            "DELETE" => client.delete(&url_owned),
            "PATCH" => client.patch(&url_owned),
            _ => client.get(&url_owned),
        };
        for (k, v) in &headers_owned {
            req = req.header(k.as_str(), v.as_str());
        }
        if let Some(b) = &body_owned {
            let has_ct = headers_owned
                .iter()
                .any(|(k, _)| k.eq_ignore_ascii_case("content-type"));
            if !has_ct {
                req = req.header("Content-Type", "application/json");
            }
            req = match b {
                Value::String(s) => req.body(s.clone()),
                other => req.body(other.to_string()),
            };
        }
        let resp = req.send().map_err(|e: reqwest::Error| e.to_string())?;
        let status = resp.status().as_u16();
        let body = resp.text().unwrap_or_default();
        let body_val: Value = serde_json::from_str(&body).unwrap_or(Value::String(body));
        Ok(json!({ "status": status, "body": body_val }))
    }).join();

    match result {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("thread panicked during http request".into()),
    }
}

/// POST a JSON body with optional extra headers (auth/tenant).
fn make_http_post_json_h(
    url: &str,
    body: Value,
    headers: &[(String, String)],
) -> Result<Value, String> {
    let url_owned = url.to_owned();
    let headers_owned = headers.to_vec();
    let result = std::thread::spawn(move || -> Result<Value, String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e: reqwest::Error| e.to_string())?;
        let mut req = client
            .post(&url_owned)
            .header("Content-Type", "application/json");
        for (k, v) in &headers_owned {
            req = req.header(k.as_str(), v.as_str());
        }
        let resp = req
            .json(&body)
            .send()
            .map_err(|e: reqwest::Error| e.to_string())?;
        let status = resp.status().as_u16();
        let text = resp.text().unwrap_or_default();
        let body_val: Value = serde_json::from_str(&text).unwrap_or(Value::String(text));
        Ok(json!({ "status": status, "body": body_val }))
    }).join();
    match result {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("thread panicked during http post".into()),
    }
}

// ─── Public execute function ──────────────────────────────────────────────────

pub fn execute(input: ExecuteInput) -> ExecuteOutput {
    let mut exec = Executor::new(input.variables);
    exec.auth_token = input.auth_token;
    exec.tenant_id = input.tenant_id;
    exec.resume_inclusive = input.resume_inclusive.unwrap_or(true);
    let resume = input.resume_from_step_id.as_deref();

    let result = exec.run_steps(&input.dsl.steps, &input.input, resume, false);

    match result {
        Some((status, output, cursor, error)) => ExecuteOutput {
            status,
            variables: exec.variables,
            output: output.unwrap_or(Value::Null),
            cursor,
            error,
            steps: exec.steps,
            human_tasks: exec.human_tasks,
            notifications: exec.notifications,
            wake_seconds: exec.wake_seconds,
            pending_signature: exec.pending_signature,
        },
        None => ExecuteOutput {
            status: "completed".into(),
            variables: exec.variables,
            output: Value::Null,
            cursor: None,
            error: None,
            steps: exec.steps,
            human_tasks: exec.human_tasks,
            notifications: exec.notifications,
            wake_seconds: exec.wake_seconds,
            pending_signature: exec.pending_signature,
        },
    }
}

// ─── HTTP Router ──────────────────────────────────────────────────────────────

pub fn router() -> Router {
    Router::new()
        .route("/healthz", get(healthz_handler))
        .route("/execute", post(execute_handler))
}

async fn healthz_handler() -> Json<Value> {
    Json(json!({"status": "ok", "service": "workflow-runtime"}))
}

async fn execute_handler(Json(body): Json<ExecuteInput>) -> Json<ExecuteOutput> {
    let output = execute(body);
    Json(output)
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(input: Value, vars: Value) -> ExprContext {
        ExprContext { input, variables: vars, output: Value::Null }
    }

    #[test]
    fn test_expr_arithmetic() {
        let c = ctx(json!({}), json!({}));
        assert_eq!(eval_expr("1 + 2", &c).unwrap(), json!(3.0));
    }

    #[test]
    fn test_expr_input_path() {
        let c = ctx(json!({"amount": 2000}), json!({}));
        let result = eval_expr("input.amount > 1000", &c).unwrap();
        assert_eq!(result, Value::Bool(true));
    }

    #[test]
    fn test_expr_var_compare() {
        let c = ctx(json!({}), json!({"x": "foo"}));
        let result = eval_expr("var.x == 'foo'", &c).unwrap();
        assert_eq!(result, Value::Bool(true));
    }

    #[test]
    fn test_expr_complex() {
        let c = ctx(json!({}), json!({"x": 3}));
        let result = eval_expr("(var.x + 1) * 2", &c).unwrap();
        assert_eq!(result, json!(8.0));
    }

    #[test]
    fn test_expr_false_compare() {
        let c = ctx(json!({"amount": 500}), json!({}));
        let result = eval_expr("input.amount > 1000", &c).unwrap();
        assert_eq!(result, Value::Bool(false));
    }

    #[test]
    fn test_execute_linear() {
        let dsl: Dsl = serde_json::from_value(json!({
            "id": "test",
            "steps": [
                {"id": "calc1", "type": "expression", "expr": "input.amount + 100", "out": "sum"},
                {"id": "calc2", "type": "expression", "expr": "var.sum * 2", "out": "doubled"},
                {"id": "end", "type": "end", "result": "done"}
            ]
        })).unwrap();
        let out = execute(ExecuteInput {
            instance_id: None,
            dsl,
            input: json!({"amount": 50}),
            variables: json!({}),
            resume_from_step_id: None,
        auth_token: None,
        tenant_id: None,
        resume_inclusive: None,
        });
        assert_eq!(out.status, "completed");
        assert_eq!(out.variables["sum"], json!(150.0));
        assert_eq!(out.variables["doubled"], json!(300.0));
    }

    #[test]
    fn test_execute_switch_high_amount() {
        let dsl: Dsl = serde_json::from_value(json!({
            "id": "test",
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
        })).unwrap();
        let out = execute(ExecuteInput {
            instance_id: None,
            dsl,
            input: json!({"amount": 2000}),
            variables: json!({}),
            resume_from_step_id: None,
        auth_token: None,
        tenant_id: None,
        resume_inclusive: None,
        });
        assert_eq!(out.status, "paused");
        assert!(!out.human_tasks.is_empty());
        assert_eq!(out.human_tasks[0].step_id, "approve");
    }

    #[test]
    fn test_execute_switch_low_amount() {
        let dsl: Dsl = serde_json::from_value(json!({
            "id": "test",
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
        })).unwrap();
        let out = execute(ExecuteInput {
            instance_id: None,
            dsl,
            input: json!({"amount": 100}),
            variables: json!({}),
            resume_from_step_id: None,
        auth_token: None,
        tenant_id: None,
        resume_inclusive: None,
        });
        assert_eq!(out.status, "completed");
        assert_eq!(out.variables["approved"], Value::Bool(true));
        assert!(out.human_tasks.is_empty());
    }

    #[test]
    fn test_execute_human_task_pauses() {
        let dsl: Dsl = serde_json::from_value(json!({
            "id": "test",
            "steps": [
                {"id": "approve", "type": "human_task", "assignee": "user-123", "form": {"prompt": "Ok?"}},
                {"id": "end", "type": "end"}
            ]
        })).unwrap();
        let out = execute(ExecuteInput {
            instance_id: None,
            dsl,
            input: json!({}),
            variables: json!({}),
            resume_from_step_id: None,
        auth_token: None,
        tenant_id: None,
        resume_inclusive: None,
        });
        assert_eq!(out.status, "paused");
        assert_eq!(out.cursor.as_deref(), Some("approve"));
    }

    #[test]
    fn test_execute_notification() {
        let dsl: Dsl = serde_json::from_value(json!({
            "id": "test",
            "steps": [
                {"id": "notify", "type": "notification", "message": "Hello {{input.name}}",
                 "channel": "email", "recipient": "{{input.to}}", "title": "Hi", "kind": "workflow.greeting"},
                {"id": "end", "type": "end"}
            ]
        })).unwrap();
        let out = execute(ExecuteInput {
            instance_id: None,
            dsl,
            input: json!({"name": "Sam", "to": "u-1"}),
            variables: json!({}),
            resume_from_step_id: None,
        auth_token: None,
        tenant_id: None,
        resume_inclusive: None,
        });
        assert_eq!(out.status, "completed");
        assert_eq!(out.notifications.len(), 1);
        let n = &out.notifications[0];
        assert_eq!(n.message, "Hello Sam");
        assert_eq!(n.channel, "email");
        assert_eq!(n.recipient.as_deref(), Some("u-1"));
        assert_eq!(n.title, "Hi");
        assert_eq!(n.kind, "workflow.greeting");
    }

    #[test]
    fn test_wait_returns_wake_seconds() {
        let dsl: Dsl = serde_json::from_value(json!({
            "id": "test",
            "steps": [
                {"id": "pause", "type": "wait", "duration": "5m"},
                {"id": "end", "type": "end"}
            ]
        })).unwrap();
        let out = execute(ExecuteInput {
            instance_id: None,
            dsl,
            input: json!({}),
            variables: json!({}),
            resume_from_step_id: None,
        auth_token: None,
        tenant_id: None,
        resume_inclusive: None,
        });
        assert_eq!(out.status, "paused");
        assert_eq!(out.cursor.as_deref(), Some("pause"));
        assert_eq!(out.wake_seconds, Some(300));
    }

    #[test]
    fn test_parse_duration_secs() {
        assert_eq!(parse_duration_secs("30s"), 30);
        assert_eq!(parse_duration_secs("5m"), 300);
        assert_eq!(parse_duration_secs("2h"), 7200);
        assert_eq!(parse_duration_secs("1d"), 86400);
        assert_eq!(parse_duration_secs("45"), 45);
        assert_eq!(parse_duration_secs(""), 0);
        assert_eq!(parse_duration_secs("garbage"), 0);
    }
}
