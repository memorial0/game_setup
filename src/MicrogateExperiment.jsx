import React, { useState, useEffect, useRef, useCallback } from 'react';

// --- Types & Constants ---
const STAGES = {
  INTRO: 'intro',
  GUIDE_CONTROLS: 'guide_controls',
  SESSION_INTRO: 'session_intro',
  SESSION_PLAY: 'session_play',
  SESSION_SURVEY: 'session_survey',
  FINAL_SURVEY: 'final_survey',
  COMPLETION: 'completion'
};

// 고정된 2가지 조건 순서
const CONDITION_ORDER = ['fail', 'rewind'];

const DEFAULT_LOG = {
  participantId: '',
  startedAt: '',
  sessions: [],
  finalSurvey: { mostAttractive: '', mostWantToInstall: '', reason: '' },
  completed: false
};

const MicrogateExperiment = () => {
  const [stage, setStage] = useState(STAGES.INTRO);
  const [log, setLog] = useState(DEFAULT_LOG);
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
    ship: { x: 240, y: 550, w: 40, h: 40, power: 10 },
    gates: [], enemies: [], particles: [],
    speed: 4, score: 0, time: 0, history: []
  });
  const input = useRef({ left: false, right: false, mouseX: null });
  const condition = CONDITION_ORDER[currentSessionIndex];

  // --- Handlers ---
  const handleStartIntro = () => {
    const id = pidInput.trim() || 'anonymous';
    setLog({ ...DEFAULT_LOG, participantId: id, startedAt: new Date().toISOString() });
    setStage(STAGES.GUIDE_CONTROLS);
  };

  const startSession = () => {
    setSessionSurvey({ interesting: 0, agency: 0, betterThanFail: 0, wantToPlay: 0, schadenfreude: 0 });
    setSessionStartTime(Date.now());
    initGame(condition);
    setStage(STAGES.SESSION_PLAY);
  };

  const endSessionPlay = useCallback((resultStatus, scoreVal, rescueSucceeded, rewindDidOccur) => {
    setGameResult(resultStatus);
    setGamePhase('ended');
    const duration = Date.now() - sessionStartTime;
    setLog(prev => {
      const newSessions = [...prev.sessions];
      newSessions[currentSessionIndex] = {
        sessionIndex: currentSessionIndex + 1,
        condition: condition,
        result: resultStatus,
        score: scoreVal,
        durationMs: duration,
        rescueSuccess: rescueSucceeded,
        rewindOccurred: rewindDidOccur,
        survey: {}
      };
      return { ...prev, sessions: newSessions };
    });
    setTimeout(() => setStage(STAGES.SESSION_SURVEY), 2000);
  }, [sessionStartTime, currentSessionIndex, condition]);

  const submitSessionSurvey = () => {
    if (Object.values(sessionSurvey).some(v => v === 0)) { alert("모든 문항에 응답해 주세요."); return; }
    setLog(prev => {
      const newSessions = [...prev.sessions];
      newSessions[currentSessionIndex].survey = { ...sessionSurvey };
      return { ...prev, sessions: newSessions };
    });
    if (currentSessionIndex + 1 < CONDITION_ORDER.length) {
      setCurrentSessionIndex(prev => prev + 1);
      setStage(STAGES.SESSION_INTRO);
    } else {
      setStage(STAGES.FINAL_SURVEY);
    }
  };

  const submitFinalSurvey = () => {
    if (!finalSurvey.mostAttractive || !finalSurvey.mostWantToInstall) { alert("필수 항목을 선택해 주세요."); return; }
    setLog(prev => ({ ...prev, finalSurvey: { ...finalSurvey }, completed: true }));
    setStage(STAGES.COMPLETION);
  };

  // --- Game Engine ---
  const initGame = (cond) => {
    gameState.current = {
      ship: { x: 220, y: 550, w: 40, h: 40, power: 10 },
      gates: [
        { y: -100, x1: 50, w1: 180, p1: 8, x2: 250, w2: 180, p2: -5, passed: false } // 왼쪽은 부스트, 오른쪽은 패널티
      ],
      enemies: [
        { x: 210, y: -400, w: 60, h: 60, hp: 9, dead: false } // 파워가 10->5(패널티)가 되면 죽고, 10->18(부스트)가 되면 삼
      ],
      particles: [], speed: 4, score: 0, time: 0, history: []
    };
    setGamePhase('autoplay_fail_watch');
    input.current = { left: false, right: false, mouseX: null };
  };

  const cloneState = (s) => ({
    ship: { ...s.ship },
    gates: s.gates.map(g => ({ ...g })),
    enemies: s.enemies.map(e => ({ ...e })),
    score: s.score, time: s.time, speed: s.speed
  });

  const updateGame = useCallback(() => {
    const state = gameState.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    if (gamePhase === 'autoplay_fail_watch') {
      state.time++;
      // 의도된 실패 연출: 오른쪽 마이너스 게이트로 이동
      if (state.time > 20 && state.time < 80) state.ship.x += 1.5;
      
      if (condition === 'rewind') {
        state.history.push(cloneState(state));
        if (state.history.length > 250) state.history.shift();
      }

      state.gates.forEach(g => g.y += state.speed);
      state.enemies.forEach(e => e.y += state.speed);

      checkCollisions(state, () => {
        if (condition === 'fail') endSessionPlay('fail', state.score, null, false);
        else { setGamePhase('rewind_watch'); setTimeout(() => setGamePhase('rewind_back'), 1000); }
      });
    } else if (gamePhase === 'rewind_rescue') {
      state.time++;
      // 참가자 직접 조작
      if (input.current.left && state.ship.x > 0) state.ship.x -= 6;
      if (input.current.right && state.ship.x < width - state.ship.w) state.ship.x += 6;
      if (input.current.mouseX !== null) {
        state.ship.x = input.current.mouseX - state.ship.w/2;
        if (state.ship.x < 0) state.ship.x = 0;
        if (state.ship.x > width - state.ship.w) state.ship.x = width - state.ship.w;
      }

      state.gates.forEach(g => g.y += state.speed);
      state.enemies.forEach(e => e.y += state.speed);
      
      // 구출 성공을 위한 추가 레벨 생성
      if (state.time > 400 && state.gates.length < 2) {
        state.gates.push({ y: -100, x1: 50, w1: 180, p1: 10, x2: 250, w2: 180, p2: 10, passed: false });
      }

      checkCollisions(state, () => endSessionPlay('fail', state.score, false, true));
      if (state.time > 700) endSessionPlay('success', state.score + 500, true, true);

    } else if (gamePhase === 'rewind_back') {
      if (state.history.length > 0) {
        for(let i=0; i<4; i++) {
          if (state.history.length > 0) {
            const prev = state.history.pop();
            Object.assign(state, prev);
          }
        }
      } else {
        setGamePhase('rewind_rescue');
        input.current.mouseX = state.ship.x + state.ship.w/2;
      }
    }

    // --- Rendering ---
    ctx.fillStyle = '#071018';
    ctx.fillRect(0, 0, width, height);
    
    // Grid
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.1)';
    ctx.beginPath();
    for (let i = 0; i < width; i += 40) { ctx.moveTo(i, 0); ctx.lineTo(i, height); }
    for (let i = (state.time * 3) % 40; i < height; i += 40) { ctx.moveTo(0, i); ctx.lineTo(width, i); }
    ctx.stroke();

    // Draw Gates
    state.gates.forEach(g => {
      if (g.passed) return;
      ctx.fillStyle = g.p1 > 0 ? 'rgba(0, 255, 204, 0.4)' : 'rgba(255, 50, 50, 0.4)';
      ctx.fillRect(g.x1, g.y, g.w1, 30);
      ctx.fillStyle = g.p2 > 0 ? 'rgba(0, 255, 204, 0.4)' : 'rgba(255, 50, 50, 0.4)';
      ctx.fillRect(g.x2, g.y, g.w2, 30);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(g.p1 > 0 ? `+${g.p1}` : g.p1, g.x1 + g.w1/2, g.y + 20);
      ctx.fillText(g.p2 > 0 ? `+${g.p2}` : g.p2, g.x2 + g.w2/2, g.y + 20);
    });

    // Draw Enemies
    state.enemies.forEach(e => {
      if (e.dead) return;
      ctx.fillStyle = '#ff3366';
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(`HP ${e.hp}`, e.x + e.w/2, e.y + e.h/2 + 7);
    });

    // Draw Ship
    ctx.fillStyle = '#00ffcc';
    ctx.beginPath();
    ctx.moveTo(state.ship.x + state.ship.w/2, state.ship.y);
    ctx.lineTo(state.ship.x + state.ship.w, state.ship.y + state.ship.h);
    ctx.lineTo(state.ship.x, state.ship.y + state.ship.h);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px monospace';
    ctx.fillText(`POWER: ${state.ship.power}`, state.ship.x + state.ship.w/2, state.ship.y + state.ship.h + 20);

    // Overlays
    if (gamePhase === 'autoplay_fail_watch') {
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0,0,width,height);
      ctx.fillStyle = '#fff'; ctx.font = '18px sans-serif';
      ctx.fillText('자동 진행 중... 조작 불가', width/2, 100);
    } else if (gamePhase === 'rewind_watch' || gamePhase === 'rewind_back') {
      ctx.fillStyle = 'rgba(255, 0, 80, 0.2)'; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 30px monospace';
      ctx.fillText(gamePhase === 'rewind_watch' ? 'FAILURE' : '◀◀ REWIND', width/2, height/2);
    } else if (gamePhase === 'ended') {
      ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(0,0,width,height);
      ctx.fillStyle = gameResult === 'success' ? '#00ffcc' : '#ff3366';
      ctx.font = 'bold 40px sans-serif';
      ctx.fillText(gameResult === 'success' ? 'SUCCESS' : 'FAILED', width/2, height/2);
    }
  }, [gamePhase, condition, endSessionPlay, gameResult]);

  const checkCollisions = (state, onFail) => {
    const s = state.ship;
    state.gates.forEach(g => {
      if (!g.passed && g.y + 30 > s.y && g.y < s.y + s.h) {
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
    if (stage !== STAGES.SESSION_PLAY) return;
    const loop = () => { if (gamePhase !== 'ended') updateGame(); reqRef.current = requestAnimationFrame(loop); };
    reqRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(reqRef.current);
  }, [stage, gamePhase, updateGame]);

  useEffect(() => {
    if (stage !== STAGES.SESSION_PLAY || gamePhase === 'autoplay_fail_watch' || gamePhase === 'ended') return;
    const handleMove = (e) => {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      input.current.mouseX = x - rect.left;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('touchmove', handleMove);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('touchmove', handleMove); };
  }, [stage, gamePhase]);

  // --- Render Helpers ---
  const renderLikert = (key, question) => (
    <div className="survey-q">
      <p>{question}</p>
      <div className="likert-group">
        {[1, 2, 3, 4, 5].map(val => (
          <label key={val} className="likert-label">
            <input type="radio" name={key} checked={sessionSurvey[key] === val} onChange={() => setSessionSurvey(p => ({ ...p, [key]: val }))} />
            <span className="likert-circle">{val}</span>
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
          <h2 className="subtitle">광고 형식 비교 연구 (2가지)</h2>
          <p>본 실험은 동일한 게임 콘텐츠를 서로 다른 두 가지 광고 형식으로 체험하고 반응을 비교하기 위한 것입니다.</p>
          <div className="input-group">
            <label>참가자 ID</label>
            <input type="text" placeholder="예: P001" value={pidInput} onChange={e => setPidInput(e.target.value)} />
            <small>파일 관리를 위해 사용되며 실명 입력은 금지합니다.</small>
          </div>
          <button className="btn primary" onClick={handleStartIntro}>연구 시작</button>
        </div>
      )}

      {stage === STAGES.GUIDE_CONTROLS && (
        <div className="card guide-card">
          <h2>안내: 플레이 방법</h2>
          <div className="guide-content">
            <div className="guide-item"><strong>1. 조작:</strong> 마우스 이동 또는 화면 드래그로 좌우 이동합니다.</div>
            <div className="guide-item"><strong>2. 파워:</strong> 게이트(+ / -)를 통과하여 [파워]를 높이세요.</div>
            <div className="guide-item"><strong>3. 적:</strong> 내 파워가 적의 HP보다 높아야만 처치하고 생존합니다.</div>
          </div>
          <button className="btn primary" onClick={() => setStage(STAGES.SESSION_INTRO)}>계속</button>
        </div>
      )}

      {stage === STAGES.SESSION_INTRO && (
        <div className="card intro-card">
          <h2>세션 {currentSessionIndex + 1} / 2</h2>
          <div className="cond-display">
            {condition === 'fail' ? (
              <><h3>[ 형식 1: 실패 광고 ]</h3><p>이번 조건은 <strong>조작 없이 보기만</strong> 하시면 됩니다.</p></>
            ) : (
              <><h3>[ 형식 2: 리와인드 구출 ]</h3><p>자동 장면 후 <strong>직접 조작할 수 있게</strong> 됩니다.</p></>
            )}
          </div>
          <button className="btn primary" onClick={startSession}>시작</button>
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
          <p className="survey-inst">방금 체험한 형식에 대해 응답해 주세요.</p>
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
          <div className="survey-q">
            <p>1. 어떤 형식이 가장 매력적이었습니까? (필수)</p>
            <select value={finalSurvey.mostAttractive} onChange={e => setFinalSurvey({...finalSurvey, mostAttractive: e.target.value})}>
              <option value="">선택하세요</option>
              <option value="fail">형식 1: 실패 광고 보기만 하기</option>
              <option value="rewind">형식 2: 실패 후 되감기 구출</option>
            </select>
          </div>
          <div className="survey-q">
            <p>2. 어떤 형식이 가장 게임을 해보고 싶게 만들었습니까? (필수)</p>
            <select value={finalSurvey.mostWantToInstall} onChange={e => setFinalSurvey({...finalSurvey, mostWantToInstall: e.target.value})}>
              <option value="">선택하세요</option>
              <option value="fail">형식 1: 실패 광고 보기만 하기</option>
              <option value="rewind">형식 2: 실패 후 되감기 구출</option>
            </select>
          </div>
          <div className="survey-q">
            <p>3. 왜 그렇게 선택하셨나요? (자유 응답)</p>
            <textarea rows="3" value={finalSurvey.reason} onChange={e => setFinalSurvey({...finalSurvey, reason: e.target.value})}></textarea>
          </div>
          <button className="btn primary" onClick={submitFinalSurvey}>완료하기</button>
        </div>
      )}

      {stage === STAGES.COMPLETION && (
        <div className="card completion-card">
          <h2>실험 완료</h2>
          <p>수고하셨습니다. 아래 버튼을 눌러 데이터를 저장해 주세요.</p>
          <div className="btn-group">
            <button className="btn outline" onClick={() => downloadData('json')}>JSON 저장</button>
            <button className="btn outline" onClick={() => downloadData('csv')}>CSV 저장</button>
          </div>
        </div>
      )}
    </div>
  );

  function downloadData(type) {
    const fileName = `${log.participantId || 'anon'}_microgate.${type}`;
    let content = '';
    if (type === 'json') content = JSON.stringify(log, null, 2);
    else {
      content = "participantId,session,condition,result,q1,q2,q3,q4,q5,final1,final2\n";
      log.sessions.forEach(s => {
        content += `${log.participantId},${s.sessionIndex},${s.condition},${s.result},${s.survey.interesting},${s.survey.agency},${s.survey.betterThanFail},${s.survey.wantToPlay},${s.survey.schadenfreude},${log.finalSurvey.mostAttractive},${log.finalSurvey.mostWantToInstall}\n`;
      });
    }
    const blob = new Blob([content], { type: type === 'json' ? 'application/json' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = fileName; a.click();
  }
};

export default MicrogateExperiment;
