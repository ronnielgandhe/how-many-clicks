import { useState, useEffect, useRef } from 'react';
import { getPageLinks, getPageSummary } from '../utils/wikipedia';

export default function UserGame({ startTitle, targetTitle, machineClicks, onFinish, onGiveUp }) {
  const [currentPage, setCurrentPage] = useState(startTitle);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [userPath, setUserPath] = useState([startTitle]);
  const [summary, setSummary] = useState(null);
  const [won, setWon] = useState(false);
  const filterRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setFilter('');
      const [pageLinks, pageSummary] = await Promise.all([
        getPageLinks(currentPage),
        getPageSummary(currentPage),
      ]);
      if (!cancelled) {
        setLinks(pageLinks);
        setSummary(pageSummary);
        setLoading(false);
        if (filterRef.current) filterRef.current.focus();
      }
    }
    load();
    return () => { cancelled = true; };
  }, [currentPage]);

  const handleClickLink = (title) => {
    const newPath = [...userPath, title];
    setUserPath(newPath);

    if (title.toLowerCase().replace(/_/g, ' ') === targetTitle.toLowerCase().replace(/_/g, ' ')) {
      setWon(true);
      onFinish(newPath);
    } else {
      setCurrentPage(title);
    }
  };

  const clicks = userPath.length - 1;
  const filteredLinks = filter
    ? links.filter((l) => l.toLowerCase().includes(filter.toLowerCase()))
    : links;

  if (won) {
    const beat = clicks < machineClicks;
    const tied = clicks === machineClicks;
    return (
      <div className="user-game">
        <div className="user-won">
          <div className="won-icon">{beat ? '\uD83C\uDFC6' : tied ? '\uD83E\uDD1D' : '\uD83D\uDE05'}</div>
          <h2 className="won-title">
            {beat
              ? 'YOU BEAT THE MACHINE!'
              : tied
              ? "IT'S A TIE!"
              : 'The Machine Wins This Round!'}
          </h2>
          <div className="score-compare">
            <div className="score-box you">
              <span className="score-label">You</span>
              <span className="score-num">{clicks}</span>
              <span className="score-unit">clicks</span>
            </div>
            <div className="score-vs">VS</div>
            <div className="score-box machine">
              <span className="score-label">Machine</span>
              <span className="score-num">{machineClicks}</span>
              <span className="score-unit">clicks</span>
            </div>
          </div>
          <div className="quirky-section">
            <p className="quirky-message">
              "maybe the fun was the things we saw on the way"
            </p>
          </div>
          <button className="play-again-btn" onClick={onGiveUp}>
            Play Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="user-game">
      <div className="user-header">
        <div className="user-header-top">
          <h2 className="user-title">YOUR TURN!</h2>
          <div className="user-stats">
            <span className="user-clicks">{clicks} click{clicks !== 1 ? 's' : ''}</span>
            <span className="user-target">Machine did it in {machineClicks}</span>
          </div>
        </div>

        {/* Path breadcrumb */}
        <div className="user-path">
          {userPath.map((p, i) => (
            <span key={i} className="user-crumb">
              {i > 0 && <span className="crumb-arrow">&#x2192;</span>}
              <span className={i === userPath.length - 1 ? 'crumb-current' : ''}>{p}</span>
            </span>
          ))}
          <span className="user-crumb">
            <span className="crumb-arrow">&#x2192;</span>
            <span className="crumb-target">{targetTitle}</span>
          </span>
        </div>
      </div>

      {/* Current article */}
      <div className="current-article">
        {summary && (
          <div className="article-preview">
            {summary.thumbnail && (
              <img src={summary.thumbnail} alt={summary.title} className="article-thumb" />
            )}
            <div className="article-info">
              <h3>{summary.title}</h3>
              <p>{summary.extract ? summary.extract.slice(0, 200) + '...' : summary.description}</p>
            </div>
          </div>
        )}
      </div>

      {/* Links */}
      <div className="links-section">
        <div className="links-header">
          <h3>Links on this page ({links.length})</h3>
          <input
            ref={filterRef}
            type="text"
            className="link-filter"
            placeholder="Search links..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="links-loading">Loading links...</div>
        ) : (
          <div className="links-grid">
            {filteredLinks.slice(0, 100).map((link, i) => (
              <button
                key={i}
                className={`link-btn ${
                  link.toLowerCase().replace(/_/g, ' ') === targetTitle.toLowerCase().replace(/_/g, ' ')
                    ? 'target-link'
                    : ''
                }`}
                onClick={() => handleClickLink(link)}
              >
                {link}
              </button>
            ))}
            {filteredLinks.length > 100 && (
              <div className="links-more">
                + {filteredLinks.length - 100} more links. Use search to filter!
              </div>
            )}
            {filteredLinks.length === 0 && (
              <div className="links-empty">No links match "{filter}"</div>
            )}
          </div>
        )}
      </div>

      <button className="give-up-btn" onClick={onGiveUp}>
        Give Up & Play Again
      </button>
    </div>
  );
}
