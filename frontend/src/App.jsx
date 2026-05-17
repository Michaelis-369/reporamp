import { useState, useRef, useEffect } from 'react'
import './App.css'

// ─── Landing ──────────────────────────────────────────────────────────────────
function LandingPage({ onAnalyze }) {
  const [url, setUrl]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')
  const [phase, setPhase]   = useState(0)

  const examples = [
    { label: 'facebook/react',     url: 'https://github.com/facebook/react' },
    { label: 'pallets/flask',      url: 'https://github.com/pallets/flask' },
    { label: 'tiangolo/fastapi',   url: 'https://github.com/tiangolo/fastapi' },
  ]

  const phases = [
    '🔍 Fetching repository structure from GitHub…',
    '🧠 IBM watsonx Granite reading your codebase…',
    '🗺  Building architecture map…',
    '📚 Generating your learning path…',
  ]

  useEffect(() => {
    if (!loading) { setPhase(0); return }
    const t = setInterval(() => setPhase(p => Math.min(p + 1, phases.length - 1)), 3500)
    return () => clearInterval(t)
  }, [loading])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!url.trim()) return
    setLoading(true)
    setError('')
    try {
      const resp = await fetch('${import.meta.env.VITE_API_URL}/api/analyze', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ repo_url: url.trim() }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Analysis failed')
      onAnalyze(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="landing">
      <div className="landing-inner">
        <div className="hero">
          <div className="hero-icon">⚡</div>
          <h1 className="hero-title">RepoRamp</h1>
          <p className="hero-sub">Drop a GitHub URL. Understand any codebase in seconds.</p>
          <p className="hero-tag">Powered by IBM Bob · watsonx.ai Granite</p>
        </div>

        <form className="url-form" onSubmit={handleSubmit}>
          <div className="url-row">
            <input
              className="url-input"
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repository"
              disabled={loading}
              autoFocus
            />
            <button className="url-btn" type="submit" disabled={loading || !url.trim()}>
              {loading ? <span className="spin" /> : 'Analyze →'}
            </button>
          </div>
          {error && <p className="error">⚠ {error}</p>}
        </form>

        {loading && (
          <div className="loading-card">
            {phases.map((p, i) => (
              <p key={i} className={`load-line ${i <= phase ? 'visible' : ''}`}>{p}</p>
            ))}
          </div>
        )}

        {!loading && (
          <>
            <div className="examples">
              <span className="examples-label">Try an example →</span>
              {examples.map(ex => (
                <button key={ex.url} className="chip" onClick={() => setUrl(ex.url)}>
                  {ex.label}
                </button>
              ))}
            </div>

            <div className="features">
              {[
                { icon: '🗺', title: 'Architecture Map',  desc: 'See how every component connects at a glance' },
                { icon: '📚', title: 'Learning Path',     desc: 'Know exactly which files to read, and in what order' },
                { icon: '💬', title: 'Ask Bob Anything',  desc: 'Chat with Granite about any part of the code' },
              ].map(f => (
                <div key={f.title} className="feature-card">
                  <span className="feat-icon">{f.icon}</span>
                  <h3>{f.title}</h3>
                  <p>{f.desc}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Overview tab ─────────────────────────────────────────────────────────────
function OverviewTab({ analysis, owner, repo }) {
  const ghLink = path => `https://github.com/${owner}/${repo}/blob/HEAD/${path}`
  return (
    <div className="tab-body">
      <div className="card">
        <h2 className="card-title">📝 What does this do?</h2>
        <p className="card-text">{analysis.summary}</p>
        <div className="badges">
          <span className="badge arch">{analysis.architecture_type}</span>
          {(analysis.tech_stack || []).map(t => <span key={t} className="badge tech">{t}</span>)}
        </div>
      </div>

      <div className="section">
        <h2 className="section-title">🚪 Start here</h2>
        <div className="file-chips">
          {(analysis.entry_points || []).map(f => (
            <a key={f} href={ghLink(f)} target="_blank" rel="noreferrer" className="file-chip">
              📄 {f}
            </a>
          ))}
        </div>
      </div>

      <div className="section">
        <h2 className="section-title">🧩 Key Components</h2>
        <div className="comp-grid">
          {(analysis.key_components || []).map((c, i) => (
            <div key={i} className="comp-card">
              <div className="comp-num">{i + 1}</div>
              <div>
                <h3 className="comp-name">{c.name}</h3>
                <p className="comp-desc">{c.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Learning Path tab ────────────────────────────────────────────────────────
function LearningTab({ analysis, owner, repo }) {
  const [active, setActive] = useState(0)
  const steps = analysis.learning_path || []
  const ghLink = path => `https://github.com/${owner}/${repo}/blob/HEAD/${path}`
  const cur = steps[active]

  return (
    <div className="tab-body">
      <div className="lp-header">
        <h2>📚 Your Onboarding Path</h2>
        <p className="muted">Follow these steps to understand this codebase from scratch</p>
      </div>
      <div className="lp-layout">
        <div className="lp-sidebar">
          {steps.map((s, i) => (
            <button key={i} className={`step-btn ${active === i ? 'active' : ''}`} onClick={() => setActive(i)}>
              <span className={`step-dot ${active === i ? 'active' : ''}`}>{s.step || i + 1}</span>
              <span className="step-label">{s.title}</span>
            </button>
          ))}
        </div>

        {cur && (
          <div className="step-panel">
            <h3 className="step-title">Step {cur.step || active + 1}: {cur.title}</h3>
            <p className="step-desc">{cur.description}</p>
            <div className="step-files-section">
              <p className="step-files-label">FILES TO READ</p>
              <div className="file-chips">
                {(cur.files || []).map(f => (
                  <a key={f} href={ghLink(f)} target="_blank" rel="noreferrer" className="file-chip">
                    📄 {f}
                  </a>
                ))}
              </div>
            </div>
            <div className="step-nav">
              <button className="nav-btn" disabled={active === 0} onClick={() => setActive(a => a - 1)}>
                ← Previous
              </button>
              <span className="step-counter">{active + 1} / {steps.length}</span>
              <button className="nav-btn primary" disabled={active === steps.length - 1} onClick={() => setActive(a => a + 1)}>
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Chat tab ─────────────────────────────────────────────────────────────────
function ChatTab({ repoCtx, owner, repo }) {
  const [msgs, setMsgs]     = useState([
    { role: 'bot', text: `Hi! I've analyzed **${owner}/${repo}** and I'm ready to answer your questions. Ask me anything — architecture, specific files, how components connect, where to start, anything.` }
  ])
  const [input, setInput]   = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const SUGGESTIONS = [
    'How is this project structured?',
    'What are the main dependencies?',
    'Where does the main logic live?',
    'How do I run this project?',
  ]

  async function send(text) {
    const q = (text || input).trim()
    if (!q || loading) return
    setInput('')
    setMsgs(m => [...m, { role: 'user', text: q }])
    setLoading(true)
    try {
      const resp = await fetch('${import.meta.env.VITE_API_URL}/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ question: q, repo_context: repoCtx }),
      })
      const data = await resp.json()
      setMsgs(m => [...m, { role: 'bot', text: data.answer || data.error || 'No response.' }])
    } catch {
      setMsgs(m => [...m, { role: 'bot', text: 'Connection error. Is the backend running?' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="chat-wrap">
      <div className="chat-msgs">
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="msg-av">{m.role === 'bot' ? '🤖' : '👤'}</div>
            <div className="msg-bubble">
              {m.text.split('\n').filter(Boolean).map((line, j) => <p key={j}>{line}</p>)}
            </div>
          </div>
        ))}
        {loading && (
          <div className="msg bot">
            <div className="msg-av">🤖</div>
            <div className="msg-bubble typing"><span /><span /><span /></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {msgs.length === 1 && !loading && (
        <div className="suggestions">
          {SUGGESTIONS.map(s => (
            <button key={s} className="sug-chip" onClick={() => send(s)}>{s}</button>
          ))}
        </div>
      )}

      <div className="chat-bar">
        <input
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Ask about the codebase…"
          disabled={loading}
        />
        <button className="chat-send" onClick={() => send()} disabled={loading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ data, onReset }) {
  const [tab, setTab] = useState('overview')
  const { owner, repo, analysis, file_tree, analyzed_files } = data

  const repoCtx = [
    `Repository: ${owner}/${repo}`,
    `Summary: ${analysis.summary}`,
    `Architecture: ${analysis.architecture_type}`,
    `Tech stack: ${(analysis.tech_stack || []).join(', ')}`,
    `Entry points: ${(analysis.entry_points || []).join(', ')}`,
    `Components: ${(analysis.key_components || []).map(c => `${c.name} — ${c.description}`).join(' | ')}`,
    `Files (sample): ${(file_tree || []).slice(0, 60).join(', ')}`,
  ].join('\n')

  const TABS = [
    { id: 'overview',  label: '🗺  Overview' },
    { id: 'learning',  label: '📚 Learning Path' },
    { id: 'chat',      label: '💬 Ask Bob' },
  ]

  return (
    <div className="dash">
      <header className="dash-head">
        <div className="dash-title-row">
          <span className="repo-emoji">📦</span>
          <div>
            <h1 className="repo-name">{owner}/{repo}</h1>
            <a href={`https://github.com/${owner}/${repo}`} target="_blank" rel="noreferrer" className="gh-link">
              View on GitHub →
            </a>
          </div>
        </div>
        <button className="back-btn" onClick={onReset}>← New Repo</button>
      </header>

      <div className="stats-row">
        {[
          { n: file_tree?.length || 0,      l: 'Total Files' },
          { n: analyzed_files?.length || 0, l: 'Files Analyzed' },
          { n: analysis.tech_stack?.length || 0, l: 'Technologies' },
          { n: analysis.key_components?.length || 0, l: 'Components' },
        ].map(s => (
          <div key={s.l} className="stat">
            <strong>{s.n}</strong>
            <span>{s.l}</span>
          </div>
        ))}
      </div>

      <nav className="tab-nav">
        {TABS.map(t => (
          <button key={t.id} className={`tab-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <OverviewTab analysis={analysis} owner={owner} repo={repo} />}
      {tab === 'learning' && <LearningTab analysis={analysis} owner={owner} repo={repo} />}
      {tab === 'chat'     && <ChatTab repoCtx={repoCtx} owner={owner} repo={repo} />}
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [result, setResult] = useState(null)
  return (
    <div className="app">
      {result
        ? <Dashboard data={result} onReset={() => setResult(null)} />
        : <LandingPage onAnalyze={setResult} />
      }
    </div>
  )
}
