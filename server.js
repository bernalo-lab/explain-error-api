import express from "express";
import cors from "cors";

const app = express();
app.use(express.json({ limit: "1mb" }));

// CORS: allow your GitHub Pages + localhost
app.use(
  cors({
    origin: [
      "https://bernalo-lab.github.io",
      "http://localhost:5500",
      "http://127.0.0.1:5500"
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

// Adding a friendly GET / route
app.get("/", (req, res) => {
  res.status(200).send("ExplainError API is running. Try GET /health or POST /v1/explain-error");
});

// Health check (useful for Render)
app.get("/health", (req, res) => res.json({ ok: true }));

// MVP endpoint expected by your static page
app.post("/v1/explain-error", (req, res) => {
  // const raw = String(req.body?.rawError || "");

  const raw = String(
    req.body?.text ||
    req.body?.rawError ||
    req.body?.error ||
    req.body?.message ||
    ""
  );
  
  const stack = String(req.body?.stack || "");

  console.log("Incoming:", { hasText: !!req.body?.text, hasContext: !!req.body?.context });


// ---- classification heuristics (MVP) ----
const text = (raw + " " + stack).toLowerCase();

let classification = "unknown";
let confidence = 0.35;
let severity = "low";
let actionSignal = "review";
let confidenceRationale = "Insufficient signal to classify confidently.";
const evidence = [];

// Helpers
const addEvidence = (type, value, weight) => evidence.push({ type, value, weight });
const setOutcome = (cls, conf, sev, action, rationale) => {
  classification = cls;
  confidence = conf;
  severity = sev;
  actionSignal = action;
  confidenceRationale = rationale;
};

// 1) Network timeout (ETIMEDOUT / timeout)
if (text.includes("etimedout") || text.includes("timed out") || text.includes("timeout")) {
  setOutcome(
    "network/timeout",
    0.72,
    "medium",
    "review",
    "Matched timeout markers (ETIMEDOUT/timeout) in error text."
  );
  if (text.includes("etimedout")) addEvidence("keyword_match", "ETIMEDOUT", 0.40);
  if (text.includes("timed out")) addEvidence("keyword_match", "timed out", 0.25);
  if (text.includes("timeout")) addEvidence("keyword_match", "timeout", 0.20);
  addEvidence("heuristic", "timeout pattern", 0.32);
}

// 2) Connection refused (ECONNREFUSED / connection refused)
else if (text.includes("econnrefused") || text.includes("connection refused")) {
  setOutcome(
    "network/connection_refused",
    0.78,
    "high",
    "review",
    "Matched connection refusal markers (ECONNREFUSED/connection refused)."
  );
  if (text.includes("econnrefused")) addEvidence("keyword_match", "ECONNREFUSED", 0.45);
  if (text.includes("connection refused")) addEvidence("keyword_match", "connection refused", 0.30);
  addEvidence("heuristic", "socket connect failure", 0.25);
}
// 3) Dependency/service unavailable (503)
else if (
  text.includes(" 503") || text.includes("503 ") || text.includes("status 503") ||
  text.includes("service unavailable") || text.includes("downstream dependency failed")
) {
  setOutcome(
    "dependency/unavailable",
    0.77,
    "high",
    "review",
    "Matched downstream outage markers (503/service unavailable)."
  );
  if (text.includes("503") || text.includes("status 503")) addEvidence("status_code", "503", 0.35);
  if (text.includes("service unavailable")) addEvidence("keyword_match", "service unavailable", 0.30);
  if (text.includes("downstream dependency failed")) addEvidence("keyword_match", "downstream dependency failed", 0.30);
  addEvidence("heuristic", "dependency outage", 0.25);
}

// 4) Auth failures (401/403/unauthorized/forbidden)
else if (
  text.includes(" 401") || text.includes("401 ") || text.includes("status 401") ||
  text.includes(" 403") || text.includes("403 ") || text.includes("status 403") ||
  text.includes("unauthorized") || text.includes("forbidden")
) {
  setOutcome(
    "auth/permission",
    0.80,
    "high",
    "escalate",
    "Matched authentication/authorization markers (401/403/unauthorized/forbidden)."
  );
  if (text.includes("401") || text.includes("status 401")) addEvidence("status_code", "401", 0.35);
  if (text.includes("403") || text.includes("status 403")) addEvidence("status_code", "403", 0.35);
  if (text.includes("unauthorized")) addEvidence("keyword_match", "unauthorized", 0.25);
  if (text.includes("forbidden")) addEvidence("keyword_match", "forbidden", 0.25);
  addEvidence("heuristic", "authz/authn failure", 0.20);
}

// 5) Out of memory / heap
else if (text.includes("out of memory") || text.includes("heap out of memory") || text.includes("javascript heap")) {
  setOutcome(
    "runtime/memory",
    0.82,
    "high",
    "escalate",
    "Matched memory exhaustion markers (out of memory/heap)."
  );
  if (text.includes("heap out of memory")) addEvidence("keyword_match", "heap out of memory", 0.45);
  if (text.includes("out of memory")) addEvidence("keyword_match", "out of memory", 0.35);
  if (text.includes("javascript heap")) addEvidence("keyword_match", "javascript heap", 0.25);
  addEvidence("heuristic", "process memory limit exceeded", 0.20);
}

// 6) Missing module / dependency
else if (
  text.includes("cannot find module") ||
  text.includes("module not found") ||
  text.includes("modulenotfounderror") || // python
  text.includes("no module named")        // python
) {
  setOutcome(
    "runtime/dependency",
    0.74,
    "medium",
    "review",
    "Matched missing dependency markers (cannot find module/module not found/no module named)."
  );
  if (text.includes("cannot find module")) addEvidence("keyword_match", "cannot find module", 0.40);
  if (text.includes("module not found")) addEvidence("keyword_match", "module not found", 0.30);
  if (text.includes("no module named")) addEvidence("keyword_match", "no module named", 0.35);
  if (text.includes("modulenotfounderror")) addEvidence("keyword_match", "ModuleNotFoundError", 0.35);
  addEvidence("heuristic", "dependency resolution failure", 0.20);
}

// 7) Syntax errors
else if (text.includes("syntaxerror") || text.includes("unexpected token") || text.includes("missing initializer")) {
  setOutcome(
    "runtime/syntax",
    0.76,
    "medium",
    "review",
    "Matched syntax/parsing markers (SyntaxError/unexpected token/missing initializer)."
  );
  if (text.includes("syntaxerror")) addEvidence("keyword_match", "SyntaxError", 0.45);
  if (text.includes("unexpected token")) addEvidence("keyword_match", "unexpected token", 0.30);
  if (text.includes("missing initializer")) addEvidence("keyword_match", "missing initializer", 0.30);
  addEvidence("heuristic", "parsing failure", 0.20);
}

// Ensure evidence is never empty on unknown (keeps output consistent)
if (classification === "unknown") {
  addEvidence("weak_pattern_match", "no strong markers found", 0.10);
  actionSignal = "review";
  severity = "low";
}

  // Explanation + next step (keep short)
  const explanationMap = {
    "network/timeout": "Likely a timeout between services (dependency latency or network path issue).",
    "network/connection_refused": "Target service refused the connection (service down, wrong host/port, or firewall).",
    "auth/permission": "Authentication/authorisation failure (credentials, token scope, or policy).",
    "runtime/dependency": "Missing dependency/module or incorrect runtime packaging/build output.",
    "runtime/memory": "Process exceeded memory limits (leak, large payload, or insufficient memory allocation).",
    "runtime/syntax": "Syntax error during parsing/execution (bad deploy artifact or incompatible runtime).",
    "dependency/unavailable": "A downstream dependency is unavailable (outage, overload, or deployment issue).",
    "unknown": "Not enough signal to classify confidently from the provided text."    
  };

  const nextStepMap = {
    "network/timeout": "Check upstream latency, recent deploys, retries, and dependency health.",
    "network/connection_refused": "Verify service health, endpoint/port, and network ACL/security group rules.",
    "auth/permission": "Verify token/credentials, scopes/roles, and recent policy changes.",
    "runtime/dependency": "Confirm build artifact includes dependencies; verify bundling and runtime path.",
    "runtime/memory": "Check memory limits, recent payload changes, and heap usage trends.",
    "runtime/syntax": "Inspect the deployed build artifact; validate runtime/node version compatibility.",
    "dependency/unavailable": "Check dependency health, incident status, load, and recent deploys; add retries/backoff if safe.",
    "unknown": "Provide stack trace + environment + component name to improve classification."
  };

  res.json({
    classification,
    confidence,
    confidenceRationale,
    severity,
    evidence,
    actionSignal,
    explanation: explanationMap[classification] || explanationMap.unknown,
    recommendedNextStep: nextStepMap[classification] || nextStepMap.unknown
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`ExplainError API listening on ${port}`));
