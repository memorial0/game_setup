import React, { useState, useEffect, useRef, useCallback } from 'react';

const STAGES = {
  INTRO: 'intro',
  GUIDE_CONTROLS: 'guide_controls',
  SESSION_INTRO: 'session_intro',
  SESSION_PLAY: 'session_play',
  SESSION_SURVEY: 'session_survey',
  FINAL_SURVEY: 'final_survey',
  COMPLETION: 'completion'
};

const CONDITION_ORDER = ['fail', 'rewind'];

const MicrogateExperiment = () => {
  const [stage, setStage] = useState(STAGES.INTRO);
  const [log, setLog] = useState({ participantId: '', startedAt: '', sessions: [], finalSurvey: {}, completed: false });
  const [pidInput, setPidInput] = useState('');
  const [currentSessionIndex, setCurrentSessionIndex] = useState(0);
  const [sessionStartTime, setSessionStartTime] = useState(0);
  const [sessionSurvey, setSessionSurvey] = useState({ interesting: 0, agency: 0, betterThanFail: 0, wantToPlay: 0, schadenfreude: 0 });
  const [finalSurvey, setFinalSurvey] = useState({ mostAttractive: '', mostWantToInstall: '', reason: '' });
  const [gamePhase, setGamePhase] = useState('none'); 
  const [gameResult, setGameResult] = useState('');

  const canvasRef = useRef(null);
  const reqRef = useRef(null);
  const gameState = useRef({
    ship: { x: 220, y: 550, w: 40, h: 40, power: 10 },
    gates: [], enemies: [], particles: [], speed: 4.5, score: 0, time: 0, history: []
  });
  const input = useRef({ left: false, right: false, mouseX: null });
  const condition = CONDITION_ORDER[currentSessionIndex];

  const handleStartIntro = () => {
    const id = pidInput.trim() || 'anonymous';
    setLog(prev => ({ ...prev, participantId: id, startedAt: new Date().toISOString() }));
    setStage(STAGES.GUIDE_CONTROLS);
  };

  const initGame = (cond) => {
    gameState.current = {
      ship: { x: 220, y: 550, w: 40, h: 40, power: 10 },
      gates: [
        { y: -100, x1: 20, w1: 210, p1: 10, x2: 250, w2: 210, p2: -8, passed: false }
      ],
      enemies: [
        { x: 190, y: -450, w: 100, h: 80, hp: 15, dead: false }
      ],
      particles: [], speed: 4.5, score: 0, time: 0, history: []
    };
    setGamePhase('autoplay_fail_watch');
    input.current = { left: false, right: false, mouseX: null };
  };

  const endSession = useCallback((result, score, rescue, rewind) => {
    setGameResult(result);
    setGamePhase('ended');
    const duration = Date.now() - sessionStartTime;
    setLog(prev => {
      const newSessions = [...prev.sessions];
      newSessions[currentSessionIndex] = { sessionIndex: currentSessionIndex+1, condition, result, score, durationMs: duration, rescueSuccess: rescue, rewindOccurred: rewind, survey: {} };
      return { ...prev, sessions: newSessions };
    });
    setTimeout(() => setStage(STAGES.SESSION_SURVEY), 2000);
  }, [sessionStartTime, currentSessionIndex, condition]);

  const updateGame = useCallback(() => {
    const state = gameState.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    if (gamePhase === 'autoplay_fail_watch') {
      state.time++;
      // --- Scripted Autoplay: 반드시 오른쪽(-8) 게이트를 향해 이동하도록 고정 ---
      const targetX = 340; 
      if (state.time > 10 && state.time < 100) {
        state.ship.x += (targetX - state.ship.x) * 0.05;
      }
      
      if (condition === 'rewind') {
        state.history.push({ 
          ship: { ...state.ship }, 
          gates: state.gates.map(g => ({ ...g })), 
          enemies: state.enemies.map(e => ({ ...e })),
          time: state.time 
        });
        if (state.history.length > 300) state.history.shift();
      }

      state.gates.forEach(g => g.y += state.speed);
      state.enemies.forEach(e => e.y += state.speed);

      checkCollisions(state, () => {
        if (condition === 'fail') endSession('fail', state.score, null, false);
        else { setGamePhase('rewind_watch'); setTimeout(() => setGamePhase('rewind_back'), 1000); }
      });

    } else if (gamePhase === 'rewind_rescue') {
      state.time++;
      if (input.current.left && state.ship.x > 0) state.ship.x -= 7;
      if (input.current.right && state.ship.x < width - state.ship.w) state.ship.x += 7;
      if (input.current.mouseX !== null) {
        state.ship.x = input.current.mouseX - state.ship.w/2;
        if (state.ship.x < 0) state.ship.x = 0;
        if (state.ship.x > width - state.ship.w) state.ship.x = width - state.ship.w;
      }
      state.gates.forEach(g => g.y += state.speed);
      state.enemies.forEach(e => e.y += state.speed);
      if (state.time > 450 && state.gates.length < 2) {
        state.gates.push({ y: -100, x1: 20, w1: 440, p1: 5, x2: 999, w2: 0, p2: 0, passed: false });
      }
      checkCollisions(state, () => endSession('fail', state.score, false, true));
      if (state.time > 750) endSession('success', state.score + 100, true, true);

    } else if (gamePhase === 'rewind_back') {
      if (state.history.length > 0) {
        for(let i=0; i<5; i++) {
          if (state.history.length > 0) {
            const p = state.history.pop();
            Object.assign(state, p);
          }
        }
      } else { setGamePhase('rewind_rescue'); }
    }

    // --- Draw ---
    ctx.fillStyle = '#071018'; ctx.fillRect(0, 0, width, height);
    state.gates.forEach(g => {
      if (g.passed) return;
      ctx.fillStyle = g.p1 > 0 ? 'rgba(0, 255, 204, 0.4)' : 'rgba(255, 50, 50, 0.4)';
      ctx.fillRect(g.x1, g.y, g.w1, 40);
      ctx.fillStyle = g.p2 > 0 ? 'rgba(0, 255, 204, 0.4)' : 'rgba(255, 50, 50, 0.4)';
      ctx.fillRect(g.x2, g.y, g.w2, 40);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center';
      ctx.fillText(g.p1 > 0 ? `+${g.p1}` : g.p1, g.x1 + g.w1/2, g.y + 25);
      ctx.fillText(g.p2 > 0 ? `+${g.p2}` : g.p2, g.x2 + g.w2/2, g.y + 25);
    });
    state.enemies.forEach(e => {
      if (e.dead) return;
      ctx.fillStyle = '#ff3366'; ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 22px monospace';
      ctx.fillText(`HP ${e.hp}`, e.x + e.w/2, e.y + e.h/2 + 8);
    });
    ctx.fillStyle = '#00ffcc';
    ctx.beginPath(); ctx.moveTo(state.ship.x + state.ship.w/2, state.ship.y);
    ctx.lineTo(state.ship.x + state.ship.w, state.ship.y + state.ship.h);
    ctx.lineTo(state.ship.x, state.ship.y + state.ship.h); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 20px monospace';
    ctx.fillText(state.ship.power, state.ship.x + state.ship.w/2, state.ship.y + state.ship.h + 25);

    if (gamePhase === 'rewind_watch' || gamePhase === 'rewind_back') {
      ctx.fillStyle = 'rgba(255, 0, 80, 0.2)'; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 30px monospace';
      ctx.fillText(gamePhase === 'rewind_watch' ? 'FAILURE' : '◀◀ REWIND', width/2, height/2);
    } else if (gamePhase === 'ended') {
      ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(0,0,width,height);
      ctx.fillStyle = gameResult === 'success' ? '#00ffcc' : '#ff3366';
      ctx.font = 'bold 40px sans-serif'; ctx.fillText(gameResult === 'success' ? 'SUCCESS' : 'FAILED', width/2, height/2);
    }
  }, [gamePhase, condition, endSession, gameResult]);

  const checkCollisions = (state, onFail) => {
    const s = state.ship;
    state.gates.forEach(g => {
      if (!g.passed && g.y + 40 > s.y && g.y < s.y + s.h) {
        if (s.x + s.w/2 > g.x1 && s.x + s.w/2 < g.x1 + g.w1) { state.ship.power += g.p1; g.passed = true; }
        else if (s.x + s.w/2 > g.x2 && s.x + s.w/2 < g.x2 + g.w2) { state.ship.power += g.p2; g.passed = true; }
        if (state.ship.power <= 0) onFail();
      }
    });
    state.enemies.forEach(e => {
      if (!e.dead && s.x < e.x + e.w && s.x + s.w > e.x && s.y < e.y + e.h && s.y + s.h > e.y) {
        if (state.ship.power >= e.hp) { state.ship.power -= e.hp; e.dead = true; }
        else onFail();
      }
    });
  };

  useEffect(() => {
    if (stage === STAGES.SESSION_PLAY) {
      const loop = () => { if (gamePhase !== 'ended') updateGame(); reqRef.current = requestAnimationFrame(loop); };
      reqRef.current = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(reqRef.current);
    }
  }, [stage, gamePhase, updateGame]);

  useEffect(() => {
    if (stage !== STAGES.SESSION_PLAY || gamePhase === 'autoplay_fail_watch' || gamePhase === 'ended') return;
    const move = (e) => {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      input.current.mouseX = x - rect.left;
    };
    window.addEventListener('mousemove', move); window.addEventListener('touchmove', move);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('touchmove', move); };
  }, [stage, gamePhase]);

  const renderLikert = (key, question) => (
    <div className="survey-q">
      <p>{question}</p>
      <div className="likert-group">
        {[1, 2, 3, 4, 5].map(v => (
          <label key={v} className="likert-label">
            <input type="radio" checked={sessionSurvey[key] === v} onChange={() => setSessionSurvey(p => ({ ...p, [key]: v }))} />
            <span className="likert-circle">{v}</span>
          </label>
        ))}
      </div>
      <div className="likert-text"><span>전혀 아니다</span><span>매우 그렇다</span></div>
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
          <h2>플레이 방법 안내</h2>
          <div className="guide-content">
            <div className="guide-item"><strong>조작:</strong> 마우스/드래그로 좌우 이동</div>
            <div className="guide-item"><strong>파워:</strong> 게이트를 통과해 적의 HP보다 높여야 합니다</div>
          </div>
          <button className="btn primary" onClick={() => setStage(STAGES.SESSION_INTRO)}>세션 시작</button>
        </div>
      )}
      {stage === STAGES.SESSION_INTRO && (
        <div className="card intro-card">
          <h2>세션 {currentSessionIndex + 1} / 2</h2>
          <p className="cond-display">
            {condition === 'fail' ? "[ 형식 1 ] 조작 없이 보기만 하시면 됩니다." : "[ 형식 2 ] 자동 장면 후 직접 조작할 수 있게 됩니다."}
          </p>
          <button className="btn primary" onClick={() => { initGame(condition); setSessionStartTime(Date.now()); setStage(STAGES.SESSION_PLAY); }}>시작</button>
        </div>
      )}
      {stage === STAGES.SESSION_PLAY && (
        <div className="game-container"><canvas ref={canvasRef} width="480" height="720" className="game-canvas"></canvas></div>
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
          <button className="btn primary" onClick={() => {
            if (Object.values(sessionSurvey).some(v => v === 0)) return alert("모든 문항에 응답해 주세요.");
            setLog(prev => { 
              const ns = [...prev.sessions]; 
              ns[currentSessionIndex].survey = { ...sessionSurvey }; 
              return { ...prev, sessions: ns }; 
            });
            if (currentSessionIndex + 1 < 2) { setCurrentSessionIndex(1); setStage(STAGES.SESSION_INTRO); }
            else setStage(STAGES.FINAL_SURVEY);
          }}>제출</button>
        </div>
      )}
      {stage === STAGES.FINAL_SURVEY && (
        <div className="card survey-card">
          <h2>최종 비교 설문</h2>
          <div className="survey-q"><p>매력적인 형식은?</p><select value={finalSurvey.mostAttractive} onChange={e => setFinalSurvey(p => ({ ...p, mostAttractive: e.target.value }))}><option value="">선택</option><option value="fail">형식 1</option><option value="rewind">형식 2</option></select></div>
          <div className="survey-q"><p>설치하고 싶은 형식은?</p><select value={finalSurvey.mostWantToInstall} onChange={e => setFinalSurvey(p => ({ ...p, mostWantToInstall: e.target.value }))}><option value="">선택</option><option value="fail">형식 1</option><option value="rewind">형식 2</option></select></div>
          <button className="btn primary" onClick={() => {
            if (!finalSurvey.mostAttractive || !finalSurvey.mostWantToInstall) return alert("필수 항목을 선택해 주세요.");
            setLog(prev => ({ ...prev, finalSurvey, completed: true })); setStage(STAGES.COMPLETION);
          }}>완료</button>
        </div>
      )}
      {stage === STAGES.COMPLETION && (
        <div className="card completion-card">
          <h2>실험 완료</h2>
          <button className="btn outline" onClick={() => {
            const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `${log.participantId}_data.json`; a.click();
          }}>데이터 저장</button>
        </div>
      )}
    </div>
  );
};

export default MicrogateExperiment;
