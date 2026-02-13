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
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

// Health check (useful for Render)
app.get("/health", (req, res) => res.json({ ok: true }));

// MVP endpoint expected by your static page
app.post("/v1/explain-error", (req, res) => {
  const raw = String(req.body?.rawError || "");
  const stack = String(req.body?.stack || "");

  // ---- ultra-simple classification heuristics (MVP) ----
  let classification = "unknown";
  if (/timeout|timed out|ETIMEDOUT/i.test(raw + stack)) classification = "network/timeout";
  else if (/ECONNREFUSED|connection refused/i.test(raw + stack)) classification = "network/connection_refused";
  else if (/permission|unauthorized|forbidden|401|403/i.test(raw + stack)) classification = "auth/permission";
  else if (/cannot find module|module not found/i.test(raw + stack)) classification = "runtime/dependency";
  else if (/out of memory|heap/i.test(raw + stack)) classification = "runtime/memory";
  else if (/syntaxerror|unexpected token/i.test(raw + stack)) classification = "runtime/syntax";

  // Confidence is deliberately conservative for MVP
  const confidence = classification === "unknown" ? 0.35 : 0.72;

  // Evidence type is explicit (your “trust signal” angle)
  const evidenceType =
    classification === "unknown"
      ? ["weak_pattern_match"]
      : ["pattern_match", "stack_trace_marker"];

  // Action signal mapping
  let actionSignal = "review";
  if (classification.startsWith("auth/")) actionSignal = "escalate";
  if (classification.startsWith("runtime/syntax")) actionSignal = "review";
  if (classification.startsWith("network/timeout")) actionSignal = "review";

  // Explanation + next step (keep short)
  const explanationMap = {
    "network/timeout": "Likely a timeout between services (dependency latency or network path issue).",
    "network/connection_refused": "Target service refused the connection (service down, wrong host/port, or firewall).",
    "auth/permission": "Authentication/authorisation failure (credentials, token scope, or policy).",
    "runtime/dependency": "Missing dependency/module or incorrect runtime packaging/build output.",
    "runtime/memory": "Process exceeded memory limits (leak, large payload, or insufficient memory allocation).",
    "runtime/syntax": "Syntax error during parsing/execution (bad deploy artifact or incompatible runtime).",
    "unknown": "Not enough signal to classify confidently from the provided text."
  };

  const nextStepMap = {
    "network/timeout": "Check upstream latency, recent deploys, retries, and dependency health.",
    "network/connection_refused": "Verify service health, endpoint/port, and network ACL/security group rules.",
    "auth/permission": "Verify token/credentials, scopes/roles, and recent policy changes.",
    "runtime/dependency": "Confirm build artifact includes dependencies; verify bundling and runtime path.",
    "runtime/memory": "Check memory limits, recent payload changes, and heap usage trends.",
    "runtime/syntax": "Inspect the deployed build artifact; validate runtime/node version compatibility.",
    "unknown": "Provide stack trace + environment + component name to improve classification."
  };

  res.json({
    classification,
    confidence,
    evidenceType,
    actionSignal,
    explanation: explanationMap[classification] || explanationMap.unknown,
    recommendedNextStep: nextStepMap[classification] || nextStepMap.unknown
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`ExplainError API listening on ${port}`));
