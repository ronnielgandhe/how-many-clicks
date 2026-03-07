import { useState, useEffect } from 'react';
import { getPageSummary } from '../utils/wikipedia';

function Confetti() {
  const pieces = Array.from({ length: 60 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 2,
    duration: 2.5 + Math.random() * 3,
    size: 6 + Math.random() * 10,
    color: ['#00ff88', '#ff6b6b', '#ffd93d', '#6c5ce7', '#00d4ff', '#ff9ff3'][
      Math.floor(Math.random() * 6)
    ],
    rotation: Math.random() * 360,
    drift: (Math.random() - 0.5) * 200,
  }));

  return (
    <div className="confetti-container">
      {pieces.map((p) => (
        <div
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            width: `${p.size}px`,
            height: `${p.size * 0.6}px`,
            backgroundColor: p.color,
            '--drift': `${p.drift}px`,
            '--rotation': `${p.rotation}deg`,
          }}
        />
      ))}
    </div>
  );
}

export default function Results({ path, mode, totalExplored, primeClicks, onPlayAgain, onChallenge }) {
  const [journeyCards, setJourneyCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showConfetti, setShowConfetti] = useState(true);

  useEffect(() => {
    if (!path || path.length === 0) return;
    let cancelled = false;

    async function loadJourney() {
      const summaries = await Promise.all(path.map((title) => getPageSummary(title)));
      if (!cancelled) {
        setJourneyCards(summaries);
        setLoading(false);
      }
    }
    loadJourney();

    const timer = setTimeout(() => setShowConfetti(false), 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path]);

  if (!path) {
    return (
      <div className="results">
        <div className="results-header">
          <h2 className="results-title fail">COULDN'T FIND A PATH!</h2>
          <p className="results-subtitle">
            Explored {totalExplored} pages but these topics live in different Wikipedia galaxies...
          </p>
        </div>
        <button className="play-again-btn" onClick={onPlayAgain}>
          Try Different Topics
        </button>
      </div>
    );
  }

  const clicks = primeClicks ?? path.length - 1;

  return (
    <div className="results">
      {showConfetti && <Confetti />}

      <div className="results-header">
        {/* Dual metric display */}
        <div className="dual-stats">
          <div className="big-stat prime-stat">
            <span className="big-stat-number">{clicks}</span>
            <span className="big-stat-label">PRIME CLICKS</span>
            <span className="big-stat-sub">shortest path found</span>
          </div>
          <div className="stat-vs-divider">/</div>
          <div className="big-stat total-stat">
            <span className="big-stat-number">{totalExplored}</span>
            <span className="big-stat-label">TOTAL CLICKS</span>
            <span className="big-stat-sub">pages explored</span>
          </div>
        </div>

        <p className="results-subtitle">
          {clicks <= 2
            ? "Lightning fast! Almost too easy."
            : clicks <= 4
            ? "Not bad! A nice little journey."
            : clicks <= 6
            ? "Quite the adventure through Wikipedia!"
            : "What a wild ride through the wiki-verse!"}
        </p>
        <div className="mode-used">
          {mode === 'god' ? '\u26A1 God Mode' : '\uD83E\uDDE0 Normal Mode'}
        </div>
      </div>

      {/* Journey visualization */}
      <div className="journey-section">
        <h3 className="journey-title">The Journey</h3>
        {loading ? (
          <div className="journey-loading">Loading the journey snapshots...</div>
        ) : (
          <div className="journey-cards">
            {journeyCards.map((card, i) => (
              <div key={i} className="journey-step">
                <div className="journey-card">
                  <div className="card-number">
                    {i === 0 ? 'START' : i === journeyCards.length - 1 ? 'FINISH' : `#${i}`}
                  </div>
                  {card.thumbnail ? (
                    <img src={card.thumbnail} alt={card.title} className="card-thumb" />
                  ) : (
                    <div className="card-thumb-placeholder">
                      {card.title.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <h4 className="card-title">{card.title}</h4>
                  <p className="card-desc">
                    {card.extract
                      ? card.extract.length > 120
                        ? card.extract.slice(0, 120) + '...'
                        : card.extract
                      : card.description || 'Wikipedia article'}
                  </p>
                </div>
                {i < journeyCards.length - 1 && (
                  <div className="journey-arrow">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12h14m0 0l-6-6m6 6l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quirky message */}
      <div className="quirky-section">
        <p className="quirky-message">
          "maybe the fun was the things we saw on the way"
        </p>
        <p className="quirky-sub">&#x2014; a very wise click-counter</p>
      </div>

      {/* Actions */}
      <div className="results-actions">
        <button className="challenge-btn" onClick={onChallenge}>
          <span className="challenge-icon">&#127918;</span>
          <span>
            <strong>Think you can do better?</strong>
            <small>Try it yourself!</small>
          </span>
        </button>
        <button className="play-again-btn" onClick={onPlayAgain}>
          Play Again
        </button>
      </div>
    </div>
  );
}
