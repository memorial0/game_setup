import React, { useState, useEffect, useRef, useCallback } from 'react';

// --- Types & Constants ---
const STAGES = {
  INTRO: 'intro',
  GUIDE_CONTROLS: 'guide_controls',
  GUIDE_CONDITIONS: 'guide_conditions',
  SESSION_INTRO: 'session_intro',
  SESSION_PLAY: 'session_play',
  SESSION_SURVEY: 'session_survey',
  FINAL_SURVEY: 'final_survey',
  COMPLETION: 'completion'
};

const CONDITIONS = ['fail', 'playable', 'rewind'];

const DEFAULT_LOG = {
  participantId: '',
  startedAt: '',
  conditionOrder: [],
  sessions: [],
  finalSurvey: {
    mostAttractive: '',
    mostWantToInstall: '',
    reason: ''
  },
  completed: false
};

const MicrogateExperiment = () => {
  // --- State ---
  const [stage, setStage] = useState(STAGES.INTRO);
  const [log, setLog] = useState(DEFAULT_LOG);
  const [pidInput, setPidInput] = useState('');
  
  // Session tracking
  const [currentSessionIndex, setCurrentSessionIndex] = useState(0);
  const [sessionStartTime, setSessionStartTime] = useState(0);
  
  // Survey states
  const [sessionSurvey, setSessionSurvey] = useState({
    interesting: 0, agency: 0, betterThanFail: 0, wantToPlay: 0, schadenfreude: 0
  });
  const [finalSurvey, setFinalSurvey] = useState({
    mostAttractive: '', mostWantToInstall: '', reason: ''
  });

  // Game/Condition state
  const [gamePhase, setGamePhase] = useState('none'); // autoplay_fail_watch, playable_active, rewind_watch, rewind_back, rewind_rescue, ended
  const [gameResult, setGameResult] = useState(''); // success, fail

  // Refs for Game Canvas & Logic
  const canvasRef = useRef(null);
  const reqRef = useRef(null);
  const gameState = useRef({
    ship: { x: 240, y: 600, w: 30, h: 40, power: 10 },
    gates: [],
    enemies: [],
    particles: [],
    speed: 3,
    score: 0,
    time: 0,
    isRewinding: false,
    history: [] // For rewind
  });
  const input = useRef({ left: false, right: false, mouseX: null });
  
  // Safe condition access
  const condition = (log.conditionOrder && log.conditionOrder.length > currentSessionIndex) 
    ? log.conditionOrder[currentSessionIndex] 
    : 'fail';

  // --- Handlers: Flow ---
  const handleStartIntro = () => {
    const id = pidInput.trim() || 'anonymous';
    const shuffled = [...CONDITIONS].sort(() => Math.random() - 0.5);
    setLog({
      ...DEFAULT_LOG,
      participantId: id,
      startedAt: new Date().toISOString(),
      conditionOrder: shuffled,
      sessions: []
    });
    setStage(STAGES.GUIDE_CONTROLS);
  };

  const handleNextGuide = () => setStage(STAGES.GUIDE_CONDITIONS);
  const handleStartSessions = () => setStage(STAGES.SESSION_INTRO);

  const startCurrentSessionPlay = () => {
    setSessionSurvey({ interesting: 0, agency: 0, betterThanFail: 0, wantToPlay: 0, schadenfreude: 0 });
    setSessionStartTime(Date.now());
    initGame(condition);
    setStage(STAGES.SESSION_PLAY);
  };

  const endCurrentSessionPlay = useCallback((resultStatus, scoreVal, rescueSucceeded, rewindDidOccur) => {
    setGameResult(resultStatus);
    setGamePhase('ended');
    
    const duration = Date.now() - sessionStartTime;
    setLog(prev => {
      const newSessions = [...prev.sessions];
      newSessions[currentSessionIndex] = {
        sessionIndex: currentSessionIndex + 1,
        condition: condition,
        startedAt: new Date(sessionStartTime).toISOString(),
        endedAt: new Date().toISOString(),
        result: resultStatus,
        score: scoreVal,
        durationMs: duration,
        interventionAllowed: condition !== 'fail',
        rewindOccurred: rewindDidOccur,
        rescueSuccess: rescueSucceeded,
        survey: {}, 
        notes: ''
      };
      return { ...prev, sessions: newSessions };
    });

    setTimeout(() => {
      setStage(STAGES.SESSION_SURVEY);
    }, 2000); 
  }, [sessionStartTime, currentSessionIndex, condition]);

  const submitSessionSurvey = () => {
    if (Object.values(sessionSurvey).some(v => v === 0)) {
      alert("모든 문항에 응답해 주세요.");
      return;
    }
    
    setLog(prev => {
      const newSessions = [...prev.sessions];
      if (newSessions[currentSessionIndex]) {
        newSessions[currentSessionIndex].survey = { ...sessionSurvey };
      }
      return { ...prev, sessions: newSessions };
    });

    if (currentSessionIndex + 1 < 3) {
      setCurrentSessionIndex(prev => prev + 1);
      setStage(STAGES.SESSION_INTRO);
    } else {
      setStage(STAGES.FINAL_SURVEY);
    }
  };

  const submitFinalSurvey = () => {
    if (!finalSurvey.mostAttractive || !finalSurvey.mostWantToInstall) {
      alert("필수 항목을 선택해 주세요.");
      return;
    }
    setLog(prev => ({
      ...prev,
      finalSurvey: { ...finalSurvey },
      completed: true
    }));
    setStage(STAGES.COMPLETION);
  };

  // --- Game Engine ---
  const initGame = (cond) => {
    gameState.current = {
      ship: { x: 240, y: 550, w: 40, h: 40, power: 10 },
      gates: [
        { y: -100, x1: 50, w1: 150, p1: 15, x2: 280, w2: 150, p2: -10, passed: false } 
      ],
      enemies: [
        { x: 120, y: -400, w: 60, h: 60, hp: 20 },
        { x: 300, y: -700, w: 80, h: 80, hp: 50 } 
      ],
      particles: [],
      speed: 4,
      score: 0,
      time: 0,
      isRewinding: false,
      history: []
    };
    
    if (cond === 'fail' || cond === 'rewind') {
      setGamePhase('autoplay_fail_watch');
    } else {
      setGamePhase('playable_active');
    }
    input.current = { left: false, right: false, mouseX: null };
  };

  const cloneState = (s) => {
    return {
      ship: { ...s.ship },
      gates: s.gates.map(g => ({ ...g })),
      enemies: s.enemies.map(e => ({ ...e })),
      score: s.score,
      time: s.time,
      speed: s.speed
    };
  };

  const checkCollisions = (state, onFail) => {
    const s = state.ship;
    state.gates.forEach(g => {
      if (!g.passed && g.y + 20 > s.y && g.y < s.y + s.h) {
        if (s.x + s.w/2 > g.x1 && s.x + s.w/2 < g.x1 + g.w1) {
          state.ship.power += g.p1;
          g.passed = true;
          state.score += 10;
        } else if (s.x + s.w/2 > g.x2 && s.x + s.w/2 < g.x2 + g.w2) {
          state.ship.power += g.p2;
          g.passed = true;
          state.score += 10;
        }
        if (state.ship.power <= 0) onFail();
      }
    });

    state.enemies.forEach(e => {
      if (e.hp > 0 && s.x < e.x + e.w && s.x + s.w > e.x && s.y < e.y + e.h && s.y + s.h > e.y) {
        if (state.ship.power > e.hp) {
          state.score += e.hp;
          state.ship.power -= e.hp;
          e.hp = 0; 
        } else {
          onFail();
        }
      }
    });
  };

  const updateGame = useCallback(() => {
    const state = gameState.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    if (gamePhase === 'autoplay_fail_watch') {
      state.time++;
      state.ship.y = 550;
      if (state.time > 30 && state.time < 100) state.ship.x += 2;
      if (state.time > 150 && state.time < 220) state.ship.x += 1;
      
      if (condition === 'rewind') {
        state.history.push(cloneState(state));
        if (state.history.length > 300) state.history.shift();
      }

      state.gates.forEach(g => g.y += state.speed);
      state.enemies.forEach(e => e.y += state.speed);

      checkCollisions(state, () => {
        if (condition === 'fail') {
          endCurrentSessionPlay('fail', state.score, null, false);
        } else if (condition === 'rewind') {
          setGamePhase('rewind_watch');
          setTimeout(() => setGamePhase('rewind_back'), 1000);
        }
      });
    } else if (gamePhase === 'playable_active' || gamePhase === 'rewind_rescue') {
      if (input.current.left && state.ship.x > 0) state.ship.x -= 6;
      if (input.current.right && state.ship.x < width - state.ship.w) state.ship.x += 6;
      if (input.current.mouseX !== null) {
        state.ship.x = input.current.mouseX - state.ship.w / 2;
        if (state.ship.x < 0) state.ship.x = 0;
        if (state.ship.x > width - state.ship.w) state.ship.x = width - state.ship.w;
      }

      state.gates.forEach(g => g.y += state.speed);
      state.enemies.forEach(e => e.y += state.speed);
      
      if (state.time++ % 150 === 0 && state.time > 200) {
        state.gates.push({ y: -100, x1: 50, w1: 150, p1: 10, x2: 280, w2: 150, p2: -5, passed: false });
        state.enemies.push({ x: Math.random() * 300 + 50, y: -300, w: 50, h: 50, hp: 15 });
        state.speed += 0.2;
      }

      checkCollisions(state, () => {
        endCurrentSessionPlay('fail', state.score, gamePhase === 'rewind_rescue' ? false : null, gamePhase === 'rewind_rescue');
      });

      if (state.time > 800) {
        endCurrentSessionPlay('success', state.score + 500, gamePhase === 'rewind_rescue' ? true : null, gamePhase === 'rewind_rescue');
      }
    } else if (gamePhase === 'rewind_back') {
      if (state.history.length > 0) {
        for(let i=0; i<3; i++) {
            if(state.history.length > 0) {
                const prev = state.history.pop();
                state.ship = { ...prev.ship };
                state.gates = prev.gates;
                state.enemies = prev.enemies;
                state.score = prev.score;
                state.time = prev.time;
            }
        }
      } else {
        setGamePhase('rewind_rescue');
      }
    }

    // Drawing
    ctx.fillStyle = '#071018';
    ctx.fillRect(0, 0, width, height);
    
    // Draw Grid
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.1)';
    ctx.beginPath();
    for (let i = 0; i < width; i += 40) { ctx.moveTo(i, 0); ctx.lineTo(i, height); }
    for (let i = (state.time * 2) % 40; i < height; i += 40) { ctx.moveTo(0, i); ctx.lineTo(width, i); }
    ctx.stroke();

    // Draw Ship
    ctx.fillStyle = '#00ffcc';
    ctx.beginPath();
    ctx.moveTo(state.ship.x + state.ship.w/2, state.ship.y);
    ctx.lineTo(state.ship.x + state.ship.w, state.ship.y + state.ship.h);
    ctx.lineTo(state.ship.x, state.ship.y + state.ship.h);
    ctx.fill();
    
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(state.ship.power, state.ship.x + state.ship.w/2, state.ship.y + state.ship.h + 15);

    // Draw Gates
    state.gates.forEach(g => {
      ctx.fillStyle = g.p1 > 0 ? 'rgba(0, 255, 204, 0.3)' : 'rgba(255, 50, 50, 0.3)';
      ctx.fillRect(g.x1, g.y, g.w1, 20);
      ctx.fillStyle = g.p2 > 0 ? 'rgba(0, 255, 204, 0.3)' : 'rgba(255, 50, 50, 0.3)';
      ctx.fillRect(g.x2, g.y, g.w2, 20);
    });

    // Draw Enemies
    state.enemies.forEach(e => {
      if (e.hp > 0) {
        ctx.fillStyle = '#ff3366';
        ctx.fillRect(e.x, e.y, e.w, e.h);
        ctx.fillStyle = '#fff';
        ctx.fillText(e.hp, e.x + e.w/2, e.y + e.h/2 + 5);
      }
    });

    // Overlays
    if (gamePhase === 'rewind_watch' || gamePhase === 'rewind_back') {
      ctx.fillStyle = 'rgba(255, 0, 100, 0.2)';
      ctx.fillRect(0, 0, width, height);
    }
    
    if (gamePhase === 'ended') {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0,0,width,height);
      ctx.fillStyle = gameResult === 'success' ? '#00ffcc' : '#ff3366';
      ctx.font = 'bold 40px sans-serif';
      ctx.fillText(gameResult === 'success' ? 'SUCCESS' : 'FAILED', width/2, height/2);
    }

  }, [gamePhase, condition, endCurrentSessionPlay, gameResult]);

  // --- Effects ---
  useEffect(() => {
    if (stage !== STAGES.SESSION_PLAY) return;
    const loop = () => {
      if (gamePhase !== 'ended') updateGame();
      reqRef.current = requestAnimationFrame(loop);
    };
    reqRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(reqRef.current);
  }, [stage, gamePhase, updateGame]);

  useEffect(() => {
    if (stage !== STAGES.SESSION_PLAY) return;
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') input.current.left = true;
      if (e.key === 'ArrowRight') input.current.right = true;
    };
    const handleKeyUp = (e) => {
      if (e.key === 'ArrowLeft') input.current.left = false;
      if (e.key === 'ArrowRight') input.current.right = false;
    };
    const handleMouseMove = (e) => {
      const rect = canvasRef.current.getBoundingClientRect();
      input.current.mouseX = e.clientX - rect.left;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    const cvs = canvasRef.current;
    if (cvs) cvs.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (cvs) cvs.removeEventListener('mousemove', handleMouseMove);
    };
  }, [stage]);

  // --- Exports ---
  const downloadJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(log, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `${log.participantId || 'anon'}_microgate.json`;
    a.click();
  };

  const downloadCSV = () => {
    const headers = "participantId,sessionIndex,condition,result,score,durationMs,q1,q2,q3,q4,q5,finalMostAttractive,finalMostInstall\n";
    const rows = log.sessions.map(s => {
      return `${log.participantId},${s.sessionIndex},${s.condition},${s.result},${s.score},${s.durationMs},${s.survey.interesting},${s.survey.agency},${s.survey.betterThanFail},${s.survey.wantToPlay},${s.survey.schadenfreude},${log.finalSurvey.mostAttractive},${log.finalSurvey.mostWantToInstall}`;
    }).join("\n");
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${log.participantId || 'anon'}_microgate.csv`;
    a.click();
  };

  const renderLikert = (key, question) => (
    <div className="survey-q">
      <p>{question}</p>
      <div className="likert-group">
        {[1, 2, 3, 4, 5].map(val => (
          <label key={val} className="likert-label">
            <input type="radio" checked={sessionSurvey[key] === val} onChange={() => setSessionSurvey(p => ({ ...p, [key]: val }))} />
            <span className="likert-circle">{val}</span>
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="microgate-app">
      {stage === STAGES.INTRO && (
        <div className="card intro-card">
          <h1 className="logo">MICROGATE</h1>
          <h2 className="subtitle">광고 형식 비교 연구</h2>
          <div className="input-group">
            <label>참가자 ID</label>
            <input type="text" placeholder="P001" value={pidInput} onChange={e => setPidInput(e.target.value)} />
          </div>
          <button className="btn primary" onClick={handleStartIntro}>연구 시작</button>
        </div>
      )}
      {stage === STAGES.GUIDE_CONTROLS && (
        <div className="card guide-card">
          <h2>플레이 방법</h2>
          <div className="guide-content">
            <div className="guide-item"><strong>조작:</strong> 좌우 키 또는 마우스</div>
            <div className="guide-item"><strong>파워:</strong> 게이트를 통과해 파워를 높이세요</div>
            <div className="guide-item"><strong>적:</strong> 파워가 적의 HP보다 높아야 처치 가능합니다</div>
          </div>
          <button className="btn primary" onClick={handleNextGuide}>계속</button>
        </div>
      )}
      {stage === STAGES.GUIDE_CONDITIONS && (
        <div className="card guide-card">
          <h2>세션 안내</h2>
          <p>총 3개의 세션이 무작위로 진행됩니다.</p>
          <button className="btn primary" onClick={handleStartSessions}>세션 시작</button>
        </div>
      )}
      {stage === STAGES.SESSION_INTRO && (
        <div className="card intro-card">
          <h2>세션 {currentSessionIndex + 1} / 3</h2>
          <p className="cond-display">
            {condition === 'fail' && "이번 조건은 조작 없이 보시면 됩니다."}
            {condition === 'playable' && "이번 조건은 처음부터 직접 조작하시면 됩니다."}
            {condition === 'rewind' && "자동 장면 후 직접 조작할 수 있게 됩니다."}
          </p>
          <button className="btn primary" onClick={startCurrentSessionPlay}>시작</button>
        </div>
      )}
      {stage === STAGES.SESSION_PLAY && (
        <div className="game-container">
          <canvas ref={canvasRef} width="480" height="720" className="game-canvas"></canvas>
        </div>
      )}
      {stage === STAGES.SESSION_SURVEY && (
        <div className="card survey-card">
          <h2>세션 설문</h2>
          <div className="survey-list">
            {renderLikert('interesting', '1. 이 광고 형식은 흥미로웠다.')}
            {renderLikert('agency', '2. 결과에 내가 영향을 줄 수 있다고 느꼈다.')}
            {renderLikert('betterThanFail', '3. 실패한 플레이보다 내가 더 잘할 수 있다고 느꼈다.')}
            {renderLikert('wantToPlay', '4. 이 게임을 직접 해보거나 설치하고 싶다.')}
            {renderLikert('schadenfreude', '5. 실패 장면을 보는 것이 재미있거나 통쾌했다.')}
          </div>
          <button className="btn primary" onClick={submitSessionSurvey}>다음</button>
        </div>
      )}
      {stage === STAGES.FINAL_SURVEY && (
        <div className="card survey-card">
          <h2>최종 비교 설문</h2>
          <div className="survey-q">
            <p>가장 매력적인 형식은?</p>
            <select value={finalSurvey.mostAttractive} onChange={e => setFinalSurvey(p => ({ ...p, mostAttractive: e.target.value }))}>
              <option value="">선택</option>
              <option value="fail">형식 A</option>
              <option value="playable">형식 B</option>
              <option value="rewind">형식 C</option>
            </select>
          </div>
          <div className="survey-q">
            <p>가장 설치하고 싶은 형식은?</p>
            <select value={finalSurvey.mostWantToInstall} onChange={e => setFinalSurvey(p => ({ ...p, mostWantToInstall: e.target.value }))}>
              <option value="">선택</option>
              <option value="fail">형식 A</option>
              <option value="playable">형식 B</option>
              <option value="rewind">형식 C</option>
            </select>
          </div>
          <button className="btn primary" onClick={submitFinalSurvey}>완료</button>
        </div>
      )}
      {stage === STAGES.COMPLETION && (
        <div className="card completion-card">
          <h2>실험 완료</h2>
          <button className="btn outline" onClick={downloadJSON}>JSON 저장</button>
          <button className="btn outline" onClick={downloadCSV}>CSV 저장</button>
        </div>
      )}
    </div>
  );
};

export default MicrogateExperiment;
