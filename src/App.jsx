import { useState, useCallback, useRef } from 'react';
import Landing from './components/Landing';
import GameView from './components/GameView';
import Results from './components/Results';
import UserGame from './components/UserGame';
import { findPath } from './utils/pathfinder';

export default function App() {
  const [screen, setScreen] = useState('landing');
  const [startTopic, setStartTopic] = useState('');
  const [targetTopic, setTargetTopic] = useState('');
  const [mode, setMode] = useState('normal');
  const [steps, setSteps] = useState([]);
  const [currentPath, setCurrentPath] = useState([]);
  const [machinePath, setMachinePath] = useState(null);
  const [totalExplored, setTotalExplored] = useState(0);
  const [resolvedStart, setResolvedStart] = useState('');
  const [resolvedTarget, setResolvedTarget] = useState('');

  const handleStart = useCallback(async (start, target, selectedMode) => {
    setStartTopic(start);
    setTargetTopic(target);
    setMode(selectedMode);
    setSteps([]);
    setCurrentPath([start]);
    setMachinePath(null);
    setTotalExplored(0);
    setScreen('machine');

    const result = await findPath(start, target, selectedMode, (step) => {
      setSteps((prev) => [...prev, step]);

      if (step.totalExplored != null) {
        setTotalExplored(step.totalExplored);
      }

      if (step.type === 'resolved') {
        setResolvedStart(step.start);
        setResolvedTarget(step.target);
        setCurrentPath([step.start]);
      }
      if (step.type === 'clicking' && step.path) {
        setCurrentPath(step.path);
      }
      if (step.type === 'visiting' && step.path) {
        setCurrentPath(step.path);
      }
    });

    if (result) {
      setMachinePath(result.path);
      setTotalExplored(result.totalExplored);
      setCurrentPath(result.path);
    } else {
      setMachinePath(null);
    }

    setTimeout(() => {
      setScreen('results');
    }, 1500);
  }, []);

  const handlePlayAgain = useCallback(() => {
    setScreen('landing');
    setSteps([]);
    setCurrentPath([]);
    setMachinePath(null);
    setTotalExplored(0);
  }, []);

  const handleChallenge = useCallback(() => {
    setScreen('userGame');
  }, []);

  const handleUserFinish = useCallback(() => {}, []);

  const primeClicks = machinePath ? machinePath.length - 1 : null;

  return (
    <div className="app">
      {screen === 'landing' && <Landing onStart={handleStart} />}

      {screen === 'machine' && (
        <GameView
          steps={steps}
          currentPath={currentPath}
          mode={mode}
          startTitle={resolvedStart || startTopic}
          targetTitle={resolvedTarget || targetTopic}
          totalExplored={totalExplored}
        />
      )}

      {screen === 'results' && (
        <Results
          path={machinePath}
          mode={mode}
          totalExplored={totalExplored}
          primeClicks={primeClicks}
          onPlayAgain={handlePlayAgain}
          onChallenge={handleChallenge}
        />
      )}

      {screen === 'userGame' && (
        <UserGame
          startTitle={resolvedStart || startTopic}
          targetTitle={resolvedTarget || targetTopic}
          machineClicks={primeClicks || 999}
          machineTotalExplored={totalExplored}
          onFinish={handleUserFinish}
          onGiveUp={handlePlayAgain}
        />
      )}
    </div>
  );
}
