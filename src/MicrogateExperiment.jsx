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
  const condition = log.conditionOrder[currentSessionIndex];

  // --- Handlers: Flow ---
  const handleStartIntro = () => {
    const id = pidInput.trim() || 'anonymous';
    // Shuffle conditions
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

  const endCurrentSessionPlay = (resultStatus, scoreVal, rescueSucceeded, rewindDidOccur) => {
    setGameResult(resultStatus);
    setGamePhase('ended');
    
    // Save session log partially
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
        survey: {}, // Filled later
        notes: ''
      };
      return { ...prev, sessions: newSessions };
    });

    setTimeout(() => {
      setStage(STAGES.SESSION_SURVEY);
    }, 2000); // Show result overlay for 2 seconds
  };

  const submitSessionSurvey = () => {
    if (Object.values(sessionSurvey).some(v => v === 0)) {
      alert("모든 문항에 응답해 주세요.");
      return;
    }
    
    setLog(prev => {
      const newSessions = [...prev.sessions];
      newSessions[currentSessionIndex].survey = { ...sessionSurvey };
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
        { y: -100, x1: 50, w1: 150, p1: 15, x2: 280, w2: 150, p2: -10 } // Initial gate
      ],
      enemies: [
        { x: 120, y: -400, w: 60, h: 60, hp: 20 },
        { x: 300, y: -700, w: 80, h: 80, hp: 50 } // The boss that causes failure
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

  const updateGame = useCallback(() => {
    const state = gameState.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // --- Phase Logic ---
    if (gamePhase === 'autoplay_fail_watch') {
      // Scripted movement to hit the bad gate and then the boss
      state.time++;
      state.ship.y = 550;
      
      // Auto move right to hit bad gate (p2: -10)
      if (state.time > 30 && state.time < 100) state.ship.x += 2;
      // Auto move right to hit boss (hp 50)
      if (state.time > 150 && state.time < 220) state.ship.x += 1;
      
      // Save history for rewind (only in rewind condition)
      if (condition === 'rewind') {
        state.history.push(JSON.parse(JSON.stringify(state)));
        if (state.history.length > 300) state.history.shift();
      }

      state.gates.forEach(g => g.y += state.speed);
      state.enemies.forEach(e => e.y += state.speed);

      // Simple collision checks for scripted failure
      checkCollisions(state, () => {
        // Boss collision -> Fail
        if (condition === 'fail') {
          endCurrentSessionPlay('fail', state.score, null, false);
        } else if (condition === 'rewind') {
          setGamePhase('rewind_watch');
          setTimeout(() => setGamePhase('rewind_back'), 1000);
        }
      });

    } else if (gamePhase === 'playable_active' || gamePhase === 'rewind_rescue') {
      // Player Control
      if (input.current.left && state.ship.x > 0) state.ship.x -= 6;
      if (input.current.right && state.ship.x < width - state.ship.w) state.ship.x += 6;
      if (input.current.mouseX !== null) {
        state.ship.x = input.current.mouseX - state.ship.w / 2;
        if (state.ship.x < 0) state.ship.x = 0;
        if (state.ship.x > width - state.ship.w) state.ship.x = width - state.ship.w;
      }

      state.gates.forEach(g => g.y += state.speed);
      state.enemies.forEach(e => e.y += state.speed);
      
      // Generate endless level after initial setup
      if (state.time++ % 150 === 0 && state.time > 200) {
        state.gates.push({ y: -100, x1: 50, w1: 150, p1: 10, x2: 280, w2: 150, p2: -5 });
        state.enemies.push({ x: Math.random() * 300 + 50, y: -300, w: 50, h: 50, hp: 15 });
        state.speed += 0.2;
      }

      checkCollisions(state, () => {
        // Fail
        endCurrentSessionPlay('fail', state.score, gamePhase === 'rewind_rescue' ? false : null, gamePhase === 'rewind_rescue');
      });

      // Win Condition (Survival for time limit)
      if (state.time > 800) {
        endCurrentSessionPlay('success', state.score + 500, gamePhase === 'rewind_rescue' ? true : null, gamePhase === 'rewind_rescue');
      }

    } else if (gamePhase === 'rewind_back') {
      if (state.history.length > 0) {
        // Play backwards 3x speed
        for(let i=0; i<3; i++) {
            if(state.history.length > 0) {
                const prev = state.history.pop();
                Object.assign(state, prev);
            }
        }
      } else {
        setGamePhase('rewind_rescue');
        input.current.mouseX = state.ship.x + state.ship.w/2; // Sync mouse
      }
    }

    // Update Particles
    state.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.life--; });
    state.particles = state.particles.filter(p => p.life > 0);

    // Clean up off-screen
    state.gates = state.gates.filter(g => g.y < height + 100);
    state.enemies = state.enemies.filter(e => e.y < height + 100 && e.hp > 0);

    // --- Drawing ---
    ctx.fillStyle = '#071018';
    ctx.fillRect(0, 0, width, height);

    // Grid effect
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < width; i += 40) { ctx.moveTo(i, 0); ctx.lineTo(i, height); }
    for (let i = (state.time * state.speed) % 40; i < height; i += 40) { ctx.moveTo(0, i); ctx.lineTo(width, i); }
    ctx.stroke();

    // Rewind visual effect
    if (gamePhase === 'rewind_watch' || gamePhase === 'rewind_back') {
      ctx.fillStyle = 'rgba(255, 0, 100, 0.2)';
      ctx.fillRect(0, 0, width, height);
      // Scanlines
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      for (let i = 0; i < height; i += 10) ctx.fillRect(0, i, width, 2);
    }

    // Draw Gates
    state.gates.forEach(g => {
      ctx.fillStyle = g.p1 > 0 ? 'rgba(0, 255, 204, 0.3)' : 'rgba(255, 50, 50, 0.3)';
      ctx.fillRect(g.x1, g.y, g.w1, 20);
      ctx.fillStyle = '#fff';
      ctx.font = '16px monospace';
      ctx.fillText((g.p1 > 0 ? '+' : '') + g.p1, g.x1 + g.w1/2 - 10, g.y + 15);

      ctx.fillStyle = g.p2 > 0 ? 'rgba(0, 255, 204, 0.3)' : 'rgba(255, 50, 50, 0.3)';
      ctx.fillRect(g.x2, g.y, g.w2, 20);
      ctx.fillStyle = '#fff';
      ctx.fillText((g.p2 > 0 ? '+' : '') + g.p2, g.x2 + g.w2/2 - 10, g.y + 15);
    });

    // Draw Enemies
    state.enemies.forEach(e => {
      ctx.fillStyle = '#ff3366';
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(e.hp, e.x + e.w/2 - 12, e.y + e.h/2 + 6);
    });

    // Draw Ship
    ctx.fillStyle = '#00ffcc';
    ctx.beginPath();
    ctx.moveTo(state.ship.x + state.ship.w/2, state.ship.y);
    ctx.lineTo(state.ship.x + state.ship.w, state.ship.y + state.ship.h);
    ctx.lineTo(state.ship.x, state.ship.y + state.ship.h);
    ctx.fill();
    // Ship Power
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(state.ship.power, state.ship.x + state.ship.w/2 - 10, state.ship.y + state.ship.h + 20);

    // Draw Particles
    ctx.fillStyle = '#fff';
    state.particles.forEach(p => {
      ctx.globalAlpha = p.life / 30;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    ctx.globalAlpha = 1.0;

    // UI Overlays
    ctx.fillStyle = '#fff';
    ctx.font = '18px monospace';
    ctx.fillText(`SCORE: ${state.score}`, 20, 30);
    
    if (gamePhase === 'autoplay_fail_watch') {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0,0,width,height);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText('자동 진행 중... 조작 불가', width/2, height/2);
      ctx.textAlign = 'left';
    } else if (gamePhase === 'rewind_watch') {
      ctx.fillStyle = '#ff3366';
      ctx.textAlign = 'center';
      ctx.font = 'bold 30px monospace';
      ctx.fillText('FAILURE', width/2, height/2);
      ctx.textAlign = 'left';
    } else if (gamePhase === 'rewind_back') {
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 30px monospace';
      ctx.fillText('◀◀ REWIND', width/2, height/2);
      ctx.textAlign = 'left';
    } else if (gamePhase === 'rewind_rescue') {
      ctx.fillStyle = '#00ffcc';
      ctx.textAlign = 'center';
      ctx.font = 'bold 24px monospace';
      ctx.fillText('직접 조작하여 구출하세요!', width/2, 100);
      ctx.textAlign = 'left';
    } else if (gamePhase === 'ended') {
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillRect(0,0,width,height);
      ctx.fillStyle = gameResult === 'success' ? '#00ffcc' : '#ff3366';
      ctx.textAlign = 'center';
      ctx.font = 'bold 40px monospace';
      ctx.fillText(gameResult === 'success' ? 'SUCCESS' : 'FAILED', width/2, height/2);
      ctx.textAlign = 'left';
    }

  }, [gamePhase, condition, endCurrentSessionPlay, gameResult]);

  const checkCollisions = (state, onFail) => {
    const s = state.ship;
    // Gates
    state.gates.forEach(g => {
      if (!g.passed && g.y + 20 > s.y && g.y < s.y + s.h) {
        if (s.x + s.w/2 > g.x1 && s.x + s.w/2 < g.x1 + g.w1) {
          state.ship.power += g.p1;
          g.passed = true;
          state.score += 10;
          createExplosion(state, s.x + s.w/2, s.y, '#00ffcc');
        } else if (s.x + s.w/2 > g.x2 && s.x + s.w/2 < g.x2 + g.w2) {
          state.ship.power += g.p2;
          g.passed = true;
          state.score += 10;
          createExplosion(state, s.x + s.w/2, s.y, '#ff3366');
        }
        if (state.ship.power <= 0) onFail();
      }
    });

    // Enemies
    state.enemies.forEach(e => {
      if (s.x < e.x + e.w && s.x + s.w > e.x && s.y < e.y + e.h && s.y + s.h > e.y) {
        if (state.ship.power > e.hp) {
          state.score += e.hp;
          state.ship.power -= e.hp;
          e.hp = 0; // Dead
          createExplosion(state, e.x + e.w/2, e.y + e.h/2, '#ffaa00');
        } else {
          onFail();
        }
      }
    });
  };

  const createExplosion = (state, x, y, color) => {
    for(let i=0; i<15; i++) {
      state.particles.push({
        x: x, y: y,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10,
        life: 30, size: Math.random() * 4 + 2, color
      });
    }
  };

  // --- Game Loop Effect ---
  useEffect(() => {
    if (stage !== STAGES.SESSION_PLAY) return;

    const loop = () => {
      if (gamePhase !== 'ended') updateGame();
      // Draw final state once if ended
      if (gamePhase === 'ended') updateGame(); 
      else reqRef.current = requestAnimationFrame(loop);
    };
    reqRef.current = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(reqRef.current);
  }, [stage, gamePhase, updateGame]);

  // --- Input Handlers ---
  useEffect(() => {
    if (stage !== STAGES.SESSION_PLAY || gamePhase === 'autoplay_fail_watch' || gamePhase === 'rewind_watch' || gamePhase === 'rewind_back' || gamePhase === 'ended') return;

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
    const handleTouchMove = (e) => {
      e.preventDefault();
      const rect = canvasRef.current.getBoundingClientRect();
      input.current.mouseX = e.touches[0].clientX - rect.left;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    const cvs = canvasRef.current;
    if (cvs) {
      cvs.addEventListener('mousemove', handleMouseMove);
      cvs.addEventListener('touchmove', handleTouchMove, { passive: false });
    }
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (cvs) {
        cvs.removeEventListener('mousemove', handleMouseMove);
        cvs.removeEventListener('touchmove', handleTouchMove);
      }
    };
  }, [stage, gamePhase]);

  // --- Data Export ---
  const downloadJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(log, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `${log.participantId}_microgate.json`);
    dlAnchorElem.click();
  };

  const downloadCSV = () => {
    const headers = [
      "participantId", "sessionIndex", "condition", "result", "score", "durationMs",
      "interventionAllowed", "rewindOccurred", "rescueSuccess",
      "q1_interesting", "q2_agency", "q3_betterThanFail", "q4_wantToPlay", "q5_schadenfreude",
      "final_mostAttractive", "final_mostWantToInstall", "final_reason"
    ];
    
    const rows = log.sessions.map(s => [
      log.participantId, s.sessionIndex, s.condition, s.result, s.score, s.durationMs,
      s.interventionAllowed, s.rewindOccurred, s.rescueSuccess,
      s.survey.interesting, s.survey.agency, s.survey.betterThanFail, s.survey.wantToPlay, s.survey.schadenfreude,
      log.finalSurvey.mostAttractive, log.finalSurvey.mostWantToInstall, `"${log.finalSurvey.reason.replace(/"/g, '""')}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n" 
      + rows.map(e => e.join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${log.participantId}_microgate.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Render Helpers ---
  const renderLikert = (key, question) => (
    <div className="survey-q">
      <p>{question}</p>
      <div className="likert-group">
        {[1, 2, 3, 4, 5].map(val => (
          <label key={val} className="likert-label">
            <input 
              type="radio" 
              name={key} 
              value={val} 
              checked={sessionSurvey[key] === val}
              onChange={() => setSessionSurvey(prev => ({ ...prev, [key]: val }))}
            />
            <span className="likert-circle">{val}</span>
          </label>
        ))}
      </div>
      <div className="likert-text">
        <span>매우 아니다</span><span>매우 그렇다</span>
      </div>
    </div>
  );

  // --- Main Render ---
  return (
    <div className="microgate-app">
      {stage === STAGES.INTRO && (
        <div className="card intro-card">
          <h1 className="logo">MICROGATE</h1>
          <h2 className="subtitle">광고 형식 비교 연구</h2>
          <p className="desc">
            본 실험은 동일한 게임 콘텐츠를 서로 다른 세 가지 광고 형식으로 체험하고, 반응을 비교하기 위한 프로토타입입니다.
          </p>
          <div className="input-group">
            <label>참가자 ID</label>
            <input 
              type="text" 
              placeholder="예: P001 (실명 금지)" 
              value={pidInput} 
              onChange={e => setPidInput(e.target.value)} 
            />
            <small>데이터 저장 파일 관리를 위해 사용됩니다.</small>
          </div>
          <button className="btn primary" onClick={handleStartIntro}>연구 시작</button>
        </div>
      )}

      {stage === STAGES.GUIDE_CONTROLS && (
        <div className="card guide-card">
          <h2>안내 1: 플레이 방법</h2>
          <div className="guide-content">
            <div className="guide-item">
              <strong>1. 조작</strong>
              <p>좌우 방향키 또는 화면 드래그로 우주선을 이동합니다.</p>
            </div>
            <div className="guide-item">
              <strong>2. 파워와 게이트</strong>
              <p>우주선은 [파워] 수치를 가집니다. 게이트(+ 또는 -)를 통과하여 파워를 관리하세요.</p>
            </div>
            <div className="guide-item">
              <strong>3. 전투 (장애물)</strong>
              <p>적(HP)과 부딪힐 때 내 파워가 더 높으면 파괴하고 통과하지만, 낮으면 실패합니다.</p>
            </div>
          </div>
          <button className="btn primary" onClick={handleNextGuide}>계속</button>
        </div>
      )}

      {stage === STAGES.GUIDE_CONDITIONS && (
        <div className="card guide-card">
          <h2>안내 2: 실험 세션 설명</h2>
          <p>총 3개의 세션이 무작위 순서로 진행됩니다.</p>
          <div className="guide-content">
            <div className="guide-item">
              <strong>형식 A: 실패 광고</strong>
              <p>자동 플레이가 실패하는 장면을 <strong>보기만</strong> 합니다.</p>
            </div>
            <div className="guide-item">
              <strong>형식 B: 플레이어블 광고</strong>
              <p>처음부터 <strong>직접 조작</strong>하여 플레이합니다.</p>
            </div>
            <div className="guide-item">
              <strong>형식 C: 리와인드 구출</strong>
              <p>자동 장면 실패 후, 되감기 애니메이션이 나오고 <strong>직접 조작</strong>할 수 있게 됩니다.</p>
            </div>
          </div>
          <button className="btn primary" onClick={handleStartSessions}>세션 시작</button>
        </div>
      )}

      {stage === STAGES.SESSION_INTRO && (
        <div className="card intro-card">
          <h2>세션 {currentSessionIndex + 1} / 3</h2>
          <div className="cond-display">
            {condition === 'fail' && (
              <>
                <h3>[ 실패 광고 조건 ]</h3>
                <p>이번 조건은 조작 없이 보시면 됩니다.</p>
              </>
            )}
            {condition === 'playable' && (
              <>
                <h3>[ 플레이어블 광고 조건 ]</h3>
                <p>이번 조건은 처음부터 직접 조작하시면 됩니다.</p>
              </>
            )}
            {condition === 'rewind' && (
              <>
                <h3>[ 리와인드 구출 조건 ]</h3>
                <p>자동 장면 후 직접 조작할 수 있게 됩니다.</p>
              </>
            )}
          </div>
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
          <h2>세션 {currentSessionIndex + 1} 설문</h2>
          <p className="cond-tag">방금 체험한 형식: 
            {condition === 'fail' ? ' 실패 시청' : condition === 'playable' ? ' 직접 플레이' : ' 리와인드 구출'}
          </p>
          <p className="survey-inst">느끼신 대로 가장 가까운 응답을 선택해 주세요.</p>
          
          <div className="survey-list">
            {renderLikert('interesting', '1. 이 광고 형식은 흥미로웠다.')}
            {renderLikert('agency', '2. 결과에 내가 영향을 줄 수 있다고 느꼈다.')}
            {renderLikert('betterThanFail', '3. 실패한 플레이보다 내가 더 잘할 수 있다고 느꼈다.')}
            {renderLikert('wantToPlay', '4. 이 게임을 직접 해보거나 설치하고 싶다.')}
            {renderLikert('schadenfreude', '5. 실패 장면을 보는 것이 재미있거나 통쾌했다.')}
          </div>
          <button className="btn primary" onClick={submitSessionSurvey}>제출 및 다음</button>
        </div>
      )}

      {stage === STAGES.FINAL_SURVEY && (
        <div className="card survey-card">
          <h2>최종 비교 설문</h2>
          <p>세 가지 형식을 모두 체험하셨습니다. 비교하여 답해주세요.</p>
          
          <div className="survey-q">
            <p>1. 어떤 형식이 가장 매력적이었습니까? (필수)</p>
            <select value={finalSurvey.mostAttractive} onChange={e => setFinalSurvey({...finalSurvey, mostAttractive: e.target.value})}>
              <option value="">선택하세요</option>
              <option value="fail">형식 A: 실패 광고 보기만 하기</option>
              <option value="playable">형식 B: 처음부터 직접 플레이</option>
              <option value="rewind">형식 C: 실패 후 되감기 구출</option>
            </select>
          </div>

          <div className="survey-q">
            <p>2. 어떤 형식이 가장 게임을 해보고 싶게 만들었습니까? (필수)</p>
            <select value={finalSurvey.mostWantToInstall} onChange={e => setFinalSurvey({...finalSurvey, mostWantToInstall: e.target.value})}>
              <option value="">선택하세요</option>
              <option value="fail">형식 A: 실패 광고 보기만 하기</option>
              <option value="playable">형식 B: 처음부터 직접 플레이</option>
              <option value="rewind">형식 C: 실패 후 되감기 구출</option>
            </select>
          </div>

          <div className="survey-q">
            <p>3. 왜 그렇게 선택하셨나요? (자유 응답)</p>
            <textarea 
              rows="4" 
              placeholder="이유를 간단히 적어주세요."
              value={finalSurvey.reason}
              onChange={e => setFinalSurvey({...finalSurvey, reason: e.target.value})}
            ></textarea>
          </div>

          <button className="btn primary" onClick={submitFinalSurvey}>완료하기</button>
        </div>
      )}

      {stage === STAGES.COMPLETION && (
        <div className="card completion-card">
          <h2>실험 완료</h2>
          <p>모든 세션과 설문이 완료되었습니다. 참여해 주셔서 감사합니다.</p>
          
          <div className="export-section">
            <p>아래 버튼을 눌러 실험 데이터를 저장하세요.</p>
            <div className="btn-group">
              <button className="btn outline" onClick={downloadJSON}>JSON 다운로드</button>
              <button className="btn outline" onClick={downloadCSV}>CSV 다운로드</button>
            </div>
            <p className="file-hint">파일명 예시: {log.participantId}_microgate.csv</p>
          </div>

          <div className="admin-help">
            <h3>[운영자 안내]</h3>
            <ul>
              <li>저장된 파일은 연구 분석용으로 사용됩니다.</li>
              <li>화면 멈춤/오류 발생 시 새로고침하여 재시작하세요.</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default MicrogateExperiment;
