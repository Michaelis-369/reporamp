import os
import re
import json
import time
import base64
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app,
     origins="*",
     allow_headers=["Content-Type", "Authorization"],
     methods=["GET", "POST", "OPTIONS"],
     supports_credentials=False)

GITHUB_TOKEN       = os.getenv("GITHUB_TOKEN", "")
WATSONX_API_KEY    = os.getenv("WATSONX_API_KEY")
WATSONX_PROJECT_ID = os.getenv("WATSONX_PROJECT_ID")
WATSONX_URL        = os.getenv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com")
MODEL_ID           = "ibm/granite-3-8b-instruct"

# ── CORS headers on every response ────────────────────────────────────────────
@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"]  = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Max-Age"]       = "86400"
    return response

@app.route("/api/analyze", methods=["OPTIONS"])
def options_analyze():
    return "", 204

@app.route("/api/chat", methods=["OPTIONS"])
def options_chat():
    return "", 204

@app.route("/health", methods=["GET", "OPTIONS"])
def health():
    return jsonify({"status": "ok"})
    
# ── IAM token cache ───────────────────────────────────────────────────────────
_iam_cache = {"token": None, "expires": 0}

def get_iam_token():
    if _iam_cache["token"] and time.time() < _iam_cache["expires"] - 120:
        return _iam_cache["token"]
    resp = requests.post(
        "https://iam.cloud.ibm.com/identity/token",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data=f"grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey={WATSONX_API_KEY}",
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    _iam_cache["token"]   = data["access_token"]
    _iam_cache["expires"] = time.time() + data.get("expires_in", 3600)
    return _iam_cache["token"]

# ── watsonx.ai call ───────────────────────────────────────────────────────────
def call_watsonx(prompt: str, max_tokens: int = 1200) -> str:
    token = get_iam_token()
    resp = requests.post(
        f"{WATSONX_URL}/ml/v1/text/generation?version=2023-05-29",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={
            "model_id": MODEL_ID,
            "input": prompt,
            "parameters": {
                "decoding_method": "greedy",
                "max_new_tokens": max_tokens,
                "repetition_penalty": 1.05,
            },
            "project_id": WATSONX_PROJECT_ID,
        },
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["results"][0]["generated_text"].strip()

# ── JSON extraction ───────────────────────────────────────────────────────────
def extract_json(text: str) -> dict:
    text = text.strip()
    for fence in ("```json", "```JSON", "```"):
        if text.startswith(fence):
            text = text[len(fence):]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object found in model output")

    depth = 0
    end   = -1
    for i, ch in enumerate(text[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break

    if end == -1:
        open_braces = text[start:].count("{") - text[start:].count("}")
        text = text[start:] + "}" * open_braces
        end  = len(text)

    return json.loads(text[start:end])

# ── GitHub helpers ────────────────────────────────────────────────────────────
def gh_headers():
    h = {"Accept": "application/vnd.github.v3+json"}
    if GITHUB_TOKEN:
        h["Authorization"] = f"token {GITHUB_TOKEN}"
    return h

def parse_github_url(url: str):
    m = re.search(r"github\.com[/:]([^/\s]+)/([^/\s#?]+)", url.replace(".git", ""))
    if not m:
        raise ValueError("Could not parse GitHub URL")
    return m.group(1), m.group(2)

def fetch_tree(owner: str, repo: str) -> list:
    resp = requests.get(
        f"https://api.github.com/repos/{owner}/{repo}/git/trees/HEAD?recursive=1",
        headers=gh_headers(), timeout=15,
    )
    resp.raise_for_status()
    return resp.json().get("tree", [])

def fetch_file(owner: str, repo: str, path: str):
    resp = requests.get(
        f"https://api.github.com/repos/{owner}/{repo}/contents/{path}",
        headers=gh_headers(), timeout=10,
    )
    if resp.status_code != 200:
        return None
    data = resp.json()
    if data.get("encoding") == "base64":
        try:
            return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
        except Exception:
            return None
    return None

PRIORITY  = [
    "README.md","README.txt","readme.md","package.json","requirements.txt",
    "pyproject.toml","setup.py","go.mod","Cargo.toml","pom.xml",
    "Dockerfile","docker-compose.yml","main.py","app.py","server.py",
    "index.js","index.ts","main.js","main.ts","server.js","server.ts",
]
CODE_EXT  = {".py",".js",".ts",".jsx",".tsx",".go",".java",".rs",".rb",
             ".php",".cs",".cpp",".c",".h",".swift"}
SKIP_DIRS = {"node_modules",".git","dist","build","__pycache__","vendor",".next","coverage"}

def pick_files(tree: list) -> list:
    blobs    = [i["path"] for i in tree if i["type"] == "blob"]
    selected = []
    for name in PRIORITY:
        for path in blobs:
            if path == name or path.endswith(f"/{name}"):
                if path not in selected:
                    selected.append(path)
                break
    for path in blobs:
        if path in selected:
            continue
        if any(skip in path.split("/") for skip in SKIP_DIRS):
            continue
        if any(path.endswith(ext) for ext in CODE_EXT):
            selected.append(path)
        if len(selected) >= 20:
            break
    return selected[:20]

# ── Routes ────────────────────────────────────────────────────────────────────
@app.route("/api/analyze", methods=["POST"])
def analyze():
    body     = request.json or {}
    repo_url = body.get("repo_url", "").strip()
    if not repo_url:
        return jsonify({"error": "repo_url is required"}), 400

    try:
        owner, repo = parse_github_url(repo_url)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    try:
        tree = fetch_tree(owner, repo)
    except Exception as e:
        return jsonify({"error": f"Could not fetch repo tree: {e}"}), 400

    all_paths  = [i["path"] for i in tree if i["type"] == "blob"]
    file_paths = pick_files(tree)

    contents = {}
    for path in file_paths:
        text = fetch_file(owner, repo, path)
        if text:
            contents[path] = text[:3000] + ("\n... [truncated]" if len(text) > 3000 else "")

    ctx = f"Repository: {owner}/{repo}\n\n"
    for path, text in contents.items():
        ctx += f"\n=== {path} ===\n{text}\n"

    prompt = f"""<|system|>
You are a senior software architect. Analyse the provided repository and respond ONLY with a single valid JSON object — no markdown, no explanation, no text outside the JSON.
<|user|>
Analyse this codebase and return exactly this JSON structure:
{{
  "summary": "<2-3 sentence plain-English description of what the project does>",
  "architecture_type": "<e.g. REST API, MVC, Microservices, CLI Tool, Library, Monolith>",
  "tech_stack": ["<technology1>", "<technology2>"],
  "entry_points": ["<file_path1>", "<file_path2>"],
  "key_components": [
    {{"name": "<component name>", "description": "<what it does, 1 sentence>"}},
    {{"name": "<component name>", "description": "<what it does, 1 sentence>"}}
  ],
  "learning_path": [
    {{"step": 1, "title": "<step title>", "files": ["<file>"], "description": "<what to learn here>"}},
    {{"step": 2, "title": "<step title>", "files": ["<file>"], "description": "<what to learn here>"}}
  ]
}}

Rules:
- key_components: 4 to 8 items
- learning_path: 4 to 6 steps
- All file paths must be real paths from the repo
- Return ONLY the JSON object

{ctx[:7000]}
<|assistant|>
{{"""

    fallback = {
        "summary": f"{owner}/{repo} — analysis unavailable. Check your watsonx credentials.",
        "architecture_type": "Unknown",
        "tech_stack": ["Unknown"],
        "entry_points": file_paths[:3],
        "key_components": [{"name": "Repository", "description": "Could not parse model output."}],
        "learning_path": [{"step": 1, "title": "Read the README", "files": ["README.md"], "description": "Start here."}],
    }

    try:
        raw      = "{" + call_watsonx(prompt, max_tokens=1400)
        analysis = extract_json(raw)
    except Exception:
        try:
            raw2     = call_watsonx(prompt.replace("<|assistant|>\n{", "<|assistant|>"), max_tokens=1400)
            analysis = extract_json(raw2)
        except Exception:
            analysis = fallback

    return jsonify({
        "owner":          owner,
        "repo":           repo,
        "file_tree":      all_paths[:150],
        "analyzed_files": list(contents.keys()),
        "analysis":       analysis,
    })


@app.route("/api/chat", methods=["POST"])
def chat():
    body     = request.json or {}
    question = body.get("question", "").strip()
    ctx      = body.get("repo_context", "")

    if not question:
        return jsonify({"error": "question is required"}), 400

    prompt = f"""<|system|>
You are RepoRamp, an expert code guide. Answer the developer's question concisely. Reference real file names when relevant.
<|user|>
Repository context:
{ctx[:5500]}

Developer question: {question}
<|assistant|>
"""
    try:
        answer = call_watsonx(prompt, max_tokens=800)
        return jsonify({"answer": answer})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
