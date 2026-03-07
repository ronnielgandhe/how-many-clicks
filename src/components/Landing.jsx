import { useState, useEffect } from 'react';
import { searchArticles } from '../utils/wikipedia';

export default function Landing({ onStart }) {
  const [start, setStart] = useState('');
  const [target, setTarget] = useState('');
  const [mode, setMode] = useState('normal');
  const [startSuggestions, setStartSuggestions] = useState([]);
  const [targetSuggestions, setTargetSuggestions] = useState([]);
  const [showStartDrop, setShowStartDrop] = useState(false);
  const [showTargetDrop, setShowTargetDrop] = useState(false);

  useEffect(() => {
    if (start.length < 2) {
      setStartSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await searchArticles(start);
      setStartSuggestions(r);
    }, 300);
    return () => clearTimeout(t);
  }, [start]);

  useEffect(() => {
    if (target.length < 2) {
      setTargetSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await searchArticles(target);
      setTargetSuggestions(r);
    }, 300);
    return () => clearTimeout(t);
  }, [target]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (start.trim() && target.trim()) {
      onStart(start.trim(), target.trim(), mode);
    }
  };

  return (
    <div className="landing">
      <div className="landing-bg">
        {Array.from({ length: 20 }, (_, i) => (
          <span key={i} className="floating-char" style={{
            left: `${Math.random() * 100}%`,
            animationDelay: `${Math.random() * 5}s`,
            animationDuration: `${3 + Math.random() * 4}s`,
            fontSize: `${14 + Math.random() * 24}px`,
            opacity: 0.08 + Math.random() * 0.08,
          }}>
            {['?', 'W', '?', 'W', '?'][i % 5]}
          </span>
        ))}
      </div>

      <div className="title-section">
        <h1 className="game-title">
          <span className="title-line">HOW MANY</span>
          <span className="title-line accent">CLICKS</span>
          <span className="title-q">?</span>
        </h1>
        <p className="subtitle">The Wikipedia Connection Game</p>
        <p className="subtitle-small">How many links does it take to get from A to B?</p>
      </div>

      <form className="input-form" onSubmit={handleSubmit}>
        <div className="input-group">
          <label className="input-label">START FROM</label>
          <div className="autocomplete-wrap">
            <input
              type="text"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              onFocus={() => setShowStartDrop(true)}
              onBlur={() => setTimeout(() => setShowStartDrop(false), 200)}
              placeholder="e.g., Batman"
              className="game-input"
              autoComplete="off"
            />
            {showStartDrop && startSuggestions.length > 0 && (
              <ul className="suggestions">
                {startSuggestions.map((s, i) => (
                  <li
                    key={i}
                    onMouseDown={() => {
                      setStart(s);
                      setShowStartDrop(false);
                    }}
                  >
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="arrow-connector">
          <div className="arrow-line" />
          <div className="arrow-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 4v16m0 0l-6-6m6 6l6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="arrow-line" />
        </div>

        <div className="input-group">
          <label className="input-label">NAVIGATE TO</label>
          <div className="autocomplete-wrap">
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onFocus={() => setShowTargetDrop(true)}
              onBlur={() => setTimeout(() => setShowTargetDrop(false), 200)}
              placeholder="e.g., Bank of England"
              className="game-input"
              autoComplete="off"
            />
            {showTargetDrop && targetSuggestions.length > 0 && (
              <ul className="suggestions">
                {targetSuggestions.map((s, i) => (
                  <li
                    key={i}
                    onMouseDown={() => {
                      setTarget(s);
                      setShowTargetDrop(false);
                    }}
                  >
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mode-selector">
          <button
            type="button"
            className={`mode-btn ${mode === 'normal' ? 'active' : ''}`}
            onClick={() => setMode('normal')}
          >
            <span className="mode-icon">&#129504;</span>
            <span>Normal</span>
          </button>
          <button
            type="button"
            className={`mode-btn god ${mode === 'god' ? 'active' : ''}`}
            onClick={() => setMode('god')}
          >
            <span className="mode-icon">&#9889;</span>
            <span>God Mode</span>
          </button>
        </div>

        <button
          type="submit"
          className="go-btn"
          disabled={!start.trim() || !target.trim()}
        >
          <span className="go-text">GO!</span>
          <span className="go-subtext">Let the machine try first</span>
        </button>
      </form>

      <p className="footer-hint">
        Can you beat the machine at connecting Wikipedia articles?
      </p>
    </div>
  );
}
