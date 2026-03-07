import { useEffect, useRef } from 'react';

export default function GameView({ steps, currentPath, mode, startTitle, targetTitle, totalExplored }) {
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [steps]);

  const getStepIcon = (step) => {
    switch (step.type) {
      case 'status': return '\uD83D\uDD0D';
      case 'resolved': return '\uD83C\uDFAF';
      case 'visiting': return '\uD83D\uDCD6';
      case 'links_found': return '\uD83D\uDD17';
      case 'considering': {
        if (step.score >= 15) return '\uD83D\uDCA1';
        if (step.score >= 5) return '\uD83E\uDD14';
        return '\uD83D\uDE10';
      }
      case 'clicking': return '\uD83D\uDC49';
      case 'found': return '\uD83C\uDF89';
      case 'not_found': return '\uD83E\uDD2F';
      case 'error': return '\u274C';
      default: return '\u2022';
    }
  };

  const getStepClass = (step) => {
    if (step.type === 'found') return 'log-entry found';
    if (step.type === 'clicking') return 'log-entry clicking';
    if (step.type === 'considering' && step.score >= 15) return 'log-entry hot';
    if (step.type === 'not_found' || step.type === 'error') return 'log-entry error';
    return 'log-entry';
  };

  const uniquePath = currentPath || [];

  return (
    <div className="game-view">
      <div className="game-header">
        <div className="game-header-info">
          <span className="from-label">{startTitle || '...'}</span>
          <span className="header-arrow">&#x2192;</span>
          <span className="to-label">{targetTitle || '...'}</span>
        </div>
        <div className={`mode-badge ${mode}`}>
          {mode === 'god' ? '\u26A1 GOD MODE' : '\uD83E\uDDE0 NORMAL'}
        </div>
      </div>

      <div className="game-body">
        {/* Path breadcrumb */}
        <div className="path-strip">
          <h3 className="section-label">CURRENT PATH</h3>
          <div className="path-crumbs">
            {uniquePath.map((p, i) => (
              <span key={i} className="crumb">
                {i > 0 && <span className="crumb-arrow">&#x2192;</span>}
                <span className={`crumb-text ${i === uniquePath.length - 1 ? 'current' : ''}`}>
                  {p}
                </span>
              </span>
            ))}
            {steps[steps.length - 1]?.type !== 'found' && (
              <span className="crumb">
                <span className="crumb-arrow">&#x2192;</span>
                <span className="crumb-text pulsing">???</span>
              </span>
            )}
          </div>
        </div>

        {/* Thinking log */}
        <div className="thinking-section">
          <h3 className="section-label">
            <span className="brain-pulse">&#129504;</span> AI THINKING
          </h3>
          <div className="thinking-log" ref={logRef}>
            {steps.map((step, i) => (
              <div key={i} className={getStepClass(step)}>
                <span className="log-icon">{getStepIcon(step)}</span>
                <span className="log-text">{step.message}</span>
              </div>
            ))}
            {steps.length > 0 && steps[steps.length - 1].type !== 'found' && steps[steps.length - 1].type !== 'not_found' && (
              <div className="log-entry thinking">
                <span className="log-icon typing-dots">
                  <span>.</span><span>.</span><span>.</span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="stats-bar">
        <div className="stat-item">
          <span className="stat-num prime">{uniquePath.length > 0 ? uniquePath.length - 1 : 0}</span>
          <span className="stat-label">Prime Path</span>
        </div>
        <div className="stat-divider" />
        <div className="stat-item">
          <span className="stat-num total">{totalExplored || 0}</span>
          <span className="stat-label">Total Clicks</span>
        </div>
      </div>
    </div>
  );
}
