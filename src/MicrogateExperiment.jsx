import React, { useState, useEffect, useRef, useCallback } from 'react';

const STAGES = {
  INTRO: 'intro',
  COMMON_INFO: 'common_info',
  TUTORIAL_PLAY: 'tutorial_play',
  SESSION_INTRO: 'session_intro',
  SESSION_PLAY: 'session_play',
  SESSION_SURVEY: 'session_survey',
  FINAL_SURVEY: 'final_survey',
  COMPLETION: 'completion'
};

const CONDITION_ORDER = ['fail', 'rewind'];
const EMPTY_SURVEY = { interesting: 0, agency: 0, betterThanFail: 0, wantToPlay: 0, schadenfreude: 0 };

// --- 타임라인 데이터 ---
const TUTORIAL_TIMELINE = [
  { type: 'gate', t: 40, x1: 20, w1: 200, p1: 10, x2: 240, w2: 220, p2: 5 },
  { type: 'enemy', t: 120, x: 140, w: 200, h: 60, hp: 3 },
  { type: 'gate', t: 200, x1: 20, w1: 220, p1: 5, x2: 240, w2: 200, p2: 15 },
  { type: 'enemy', t: 300, x: 80, w: 320, h: 80, hp: 8 }
];

const MAIN_TIMELINE = [
  // 시작 파워 10
  { type: 'gate', t: 40, x1: 20, w1: 100, p1: 12, x2: 130, w2: 330, p2: 5, autoTarget: 295 }, // 자동:+5 -> 15
  { type: 'enemy', t: 110, x: 300, w: 100, h: 50, hp: 3 }, // 보조 적: -3 -> 12
  { type: 'enemy', t: 170, x: 140, w: 200, h: 80, hp: 7 }, // 메인 적: -7 -> 5
  { type: 'gate', t: 240, x1: 300, w1: 150, p1: 3, x2: 20, w2: 270, p2: 1, autoTarget: 155 }, // 보조 게이트: +1 -> 6
  { type: 'gate', t: 310, x1: 20, w1: 330, p1: 6, x2: 360, w2: 100, p2: 15, autoTarget: 185 }, // 메인 게이트: +6 -> 12
  { type: 'enemy', t: 380, x: 40, w: 120, h: 50, hp: 4 }, // 보조 적: -4 -> 8
  { type: 'enemy', t: 450, x: 100, w: 280, h: 80, hp: 6 }, // 메인 적: -6 -> 2
  { type: 'gate', t: 520, x1: 200, w1: 260, p1: 4, x2: 20, w2: 170, p2: 2, autoTarget: 105 }, // 보조 게이트: +2 -> 4
  { type: 'gate', t: 590, x1: 20, w1: 100, p1: 18, x2: 130, w2: 330, p2: 7, autoTarget: 295 }, // 메인 게이트: +7 -> 11
  { type: 'enemy', t: 660, x: 50, w: 150, h: 60, hp: 5 }, // 보조 적: -5 -> 6
  { type: 'enemy', t: 740, x: 90, w: 300, h: 100, hp: 14 } // 최종 적: HP 14 vs Power 6 -> 실패!
];

const MicrogateExperiment = () => {
  const [stage, setStage] = useState(STAGES.INTRO);
  const [log, setLog] = useState({ participantId: '', startedAt: '', sessions: [], finalSurvey: {}, completed: false });
  const [pidInput, setPidInput] = useState('');
  const [currentSessionIndex, setCurrentSessionIndex] = useState(0);
  const [sessionStartTime, setSessionStartTime] = useState(0);
  const [sessionSurvey, setSessionSurvey] = useState(EMPTY_SURVEY);
  const [finalSurvey, setFinalSurvey] = useState({ mostAttractive: '', mostWantToInstall: '', reason: '' });
  const [gamePhase, setGamePhase] = useState('none'); 
  const [gameResult, setGameResult] = useState('');
  const [isSlowMo, setIsSlowMo] = useState(false);

  const canvasRef = useRef(null);
  const reqRef = useRef(null);
  const gameState = useRef({
    ship: { x: 220, y: 550, w: 40, h: 40, power: 10 },
    gates: [], enemies: [], stars: [], particles: [], speed: 5, time: 0, eventIdx: 0, history: [],
    flash: 0, slowFactor: 1, timeline: MAIN_TIMELINE
  });
  const input = useRef({ left: false, right: false, mouseX: null });
  const condition = CONDITION_ORDER[currentSessionIndex];

  const handleStartIntro = () => {
    const id = pidInput.trim() || 'anonymous';
    setLog(prev => ({ ...prev, participantId: id, startedAt: new Date().toISOString() }));
    setStage(STAGES.COMMON_INFO);
  };

  const initGame = (isTutorial = false) => {
    gameState.current = {
      ship: { x: 220, y: 550, w: 40, h: 40, power: 10 },
      gates: [], enemies: [], stars: Array.from({length: 30}, () => ({x: Math.random()*480, y: Math.random()*720, s: 1+Math.random()*3})),
      particles: [], speed: 5, time: 0, eventIdx: 0, history: [],
      flash: 0, slowFactor: 1,
      timeline: isTutorial ? TUTORIAL_TIMELINE : MAIN_TIMELINE
    };
    setIsSlowMo(false);
    setGamePhase(isTutorial ? 'tutorial_play' : 'autoplay_fail_watch');
    input.current = { left: false, right: false, mouseX: null };
  };

  const endSession = useCallback((result, score, rescue, rewind) => {
    if (gamePhase === 'ended') return;
    setGameResult(result);
    setGamePhase('ended');

    if (stage === STAGES.TUTORIAL_PLAY) {
      setTimeout(() => setStage(STAGES.SESSION_INTRO), 2000);
      return;
    }

    const duration = Date.now() - sessionStartTime;
    setLog(prev => {
      const newSessions = [...prev.sessions];
      newSessions[currentSessionIndex] = { sessionIndex: currentSessionIndex+1, condition, result, score, durationMs: duration, rescueSuccess: rescue, rewindOccurred: rewind, survey: {} };
      return { ...prev, sessions: newSessions };
    });
    setTimeout(() => setStage(STAGES.SESSION_SURVEY), 2500);
  }, [sessionStartTime, currentSessionIndex, condition, gamePhase, stage]);

  const updateGame = useCallback(() => {
    const state = gameState.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    // --- Timeline Spawner ---
    if (state.eventIdx < state.timeline.length && state.time >= state.timeline[state.eventIdx].t) {
      const ev = state.timeline[state.eventIdx];
      if (ev.type === 'gate') state.gates.push({ ...ev, y: -120, passed: false }); // 스폰 위치 약간 위로
      else if (ev.type === 'enemy') state.enemies.push({ ...ev, y: -120, dead: false });
      state.eventIdx++;
    }

    const currentSpeed = state.speed * state.slowFactor;

    // Move Background Stars
    state.stars.forEach(s => {
      s.y += currentSpeed * s.s * 0.5;
      if (s.y > height) { s.y = -10; s.x = Math.random() * width; }
    });

    if (gamePhase === 'autoplay_fail_watch') {
      state.time += state.slowFactor;
      const currentGate = state.gates.find(g => !g.passed && g.y < state.ship.y);
      if (currentGate && currentGate.autoTarget) {
        state.ship.x += (currentGate.autoTarget - (state.ship.x + state.ship.w/2)) * 0.04;
        state.ship.x += Math.sin(state.time * 0.1) * 0.5;
      }

      if (condition === 'rewind') {
        state.history.push({ 
          ship: { ...state.ship }, gates: state.gates.map(g => ({ ...g })), 
          enemies: state.enemies.map(e => ({ ...e })), time: state.time, eventIdx: state.eventIdx
        });
        if (state.history.length > 500) state.history.shift();
      }

      state.gates.forEach(g => g.y += currentSpeed);
      state.enemies.forEach(e => e.y += currentSpeed);

      const imminentEnemy = state.enemies.find(e => !e.dead && e.y + e.h > state.ship.y - 80 && e.y < state.ship.y + state.ship.h);
      if (imminentEnemy && state.ship.power < imminentEnemy.hp) {
        state.slowFactor = Math.max(0.2, state.slowFactor - 0.05);
        setIsSlowMo(true);
      } else {
        state.slowFactor = Math.min(1.0, state.slowFactor + 0.1);
        setIsSlowMo(false);
      }

      checkCollisions(state, () => {
        state.flash = 1.0;
        if (condition === 'fail') endSession('fail', 0, null, false);
        else { setGamePhase('rewind_watch'); setTimeout(() => setGamePhase('rewind_back'), 1000); }
      });

    } else if (gamePhase === 'rewind_rescue' || gamePhase === 'tutorial_play') {
      state.time++;
      state.slowFactor = 1.0;
      if (input.current.mouseX !== null) {
        state.ship.x += (input.current.mouseX - state.ship.w/2 - state.ship.x) * 0.2;
        if (state.ship.x < 0) state.ship.x = 0;
        if (state.ship.x > width - state.ship.w) state.ship.x = width - state.ship.w;
      }
      state.gates.forEach(g => g.y += state.speed);
      state.enemies.forEach(e => e.y += state.speed);
      
      checkCollisions(state, () => {
        state.flash = 1.0;
        if (gamePhase === 'tutorial_play') { state.ship.power = 10; return; } // No death in tutorial
        endSession('fail', 0, false, true);
      });
      if (state.time > 450 && gamePhase === 'tutorial_play') endSession('success', 100, true, false);
      if (state.time > 950 && gamePhase === 'rewind_rescue') endSession('success', 500, true, true);

    } else if (gamePhase === 'rewind_back') {
      if (state.history.length > 0) {
        for(let i=0; i<10; i++) {
          if (state.history.length > 0) {
            const p = state.history.pop();
            Object.assign(state, p);
          }
        }
      } else { setGamePhase('rewind_rescue'); }
    }

    // --- Rendering ---
    ctx.fillStyle = '#071018'; ctx.fillRect(0, 0, width, height);

    // Draw Stars
    ctx.fillStyle = '#fff';
    state.stars.forEach(s => {
      ctx.globalAlpha = s.s / 4;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    });
    ctx.globalAlpha = 1.0;
    
    // Draw Grid
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.05)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < width; i += 40) { ctx.moveTo(i, 0); ctx.lineTo(i, height); }
    for (let i = (state.time * 2) % 40; i < height; i += 40) { ctx.moveTo(0, i); ctx.lineTo(width, i); }
    ctx.stroke();

    state.gates.forEach(g => {
      if (g.passed) return;
      ctx.fillStyle = g.p1 > 0 ? 'rgba(0, 255, 204, 0.4)' : 'rgba(255, 50, 50, 0.4)';
      ctx.fillRect(g.x1, g.y, g.w1, 40);
      ctx.fillStyle = g.p2 > 0 ? 'rgba(0, 255, 204, 0.4)' : 'rgba(255, 50, 50, 0.4)';
      ctx.fillRect(g.x2, g.y, g.w2, 40);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
      ctx.fillText(g.p1 > 0 ? `+${g.p1}` : g.p1, g.x1 + g.w1/2, g.y + 25);
      ctx.fillText(g.p2 > 0 ? `+${g.p2}` : g.p2, g.x2 + g.w2/2, g.y + 25);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = (g.w1 < 120 || g.w2 < 120) ? 2 : 0;
      if (g.w1 < 120) ctx.strokeRect(g.x1, g.y, g.w1, 40);
      if (g.w2 < 120) ctx.strokeRect(g.x2, g.y, g.w2, 40);
    });

    state.enemies.forEach(e => {
      if (e.dead) return;
      ctx.fillStyle = '#ff3366'; ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`HP ${e.hp}`, e.x + e.w/2, e.y + e.h/2 + 8);
    });

    // Ship with small vibration if slow-mo
    const vib = isSlowMo ? Math.random() * 4 - 2 : 0;
    ctx.fillStyle = '#00ffcc';
    ctx.beginPath(); ctx.moveTo(state.ship.x + state.ship.w/2 + vib, state.ship.y);
    ctx.lineTo(state.ship.x + state.ship.w + vib, state.ship.y + state.ship.h);
    ctx.lineTo(state.ship.x + vib, state.ship.y + state.ship.h); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 20px monospace';
    ctx.fillText(state.ship.power, state.ship.x + state.ship.w/2, state.ship.y + state.ship.h + 25);

    // --- Failure/Overlay Effects ---
    
    // 1. Initial Collision Flash (Burgundy instead of Bright Red)
    if (state.flash > 0) {
      ctx.fillStyle = `rgba(120, 0, 30, ${state.flash * 0.7})`;
      ctx.fillRect(0, 0, width, height);
      state.flash -= 0.04;
    }

    // 2. Rewind/Failure Vignette Overlay
    if (gamePhase === 'rewind_watch' || gamePhase === 'rewind_back') {
      const grad = ctx.createRadialGradient(width/2, height/2, 100, width/2, height/2, width);
      grad.addColorStop(0, 'rgba(10, 15, 25, 0.4)'); // Center: Dark & Clear
      grad.addColorStop(1, 'rgba(80, 0, 20, 0.6)');  // Edge: Deep Wine
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = '#ffeef0'; // Soft pinkish white
      ctx.font = 'bold 40px monospace'; ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(255, 50, 80, 0.5)'; ctx.shadowBlur = 15;
      ctx.fillText(gamePhase === 'rewind_watch' ? 'COLLISION!' : '◀◀ REWIND', width/2, height/2);
      ctx.shadowBlur = 0;
    } 
    // 3. Final Result Screen
    else if (gamePhase === 'ended') {
      ctx.fillStyle = 'rgba(5, 10, 20, 0.85)';
      ctx.fillRect(0, 0, width, height);
      
      const isSuccess = gameResult === 'success';
      ctx.fillStyle = isSuccess ? '#00ffcc' : '#ff5577';
      ctx.shadowColor = isSuccess ? 'rgba(0, 255, 204, 0.5)' : 'rgba(255, 80, 110, 0.5)';
      ctx.shadowBlur = 20;
      ctx.font = 'bold 44px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(stage === STAGES.TUTORIAL_PLAY ? 'TUTORIAL END' : (isSuccess ? 'MISSION COMPLETE' : 'MISSION FAILED'), width/2, height/2);
      ctx.shadowBlur = 0;
      
      ctx.font = '20px monospace'; ctx.fillStyle = '#94a3b8';
      ctx.fillText(isSuccess ? '모든 적을 격파했습니다' : '파워가 부족합니다', width/2, height/2 + 60);
    }
  }, [gamePhase, condition, endSession, gameResult, isSlowMo, stage]);

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
    if (stage === STAGES.SESSION_PLAY || stage === STAGES.TUTORIAL_PLAY) {
      const loop = () => { if (gamePhase !== 'ended') updateGame(); reqRef.current = requestAnimationFrame(loop); };
      reqRef.current = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(reqRef.current);
    }
  }, [stage, gamePhase, updateGame]);

  useEffect(() => {
    if ((stage !== STAGES.SESSION_PLAY && stage !== STAGES.TUTORIAL_PLAY) || gamePhase === 'autoplay_fail_watch' || gamePhase === 'ended') return;
    const move = (e) => {
      if (!canvasRef.current) return;
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
        {[1, 2, 3, 4, 5, 6, 7].map(v => (
          <label key={v} className="likert-label">
            <input type="radio" checked={sessionSurvey[key] === v} onChange={() => setSessionSurvey(p => ({ ...p, [key]: v }))} />
            <span className="likert-circle">{v}</span>
          </label>
        ))}
      </div>
      <div className="likert-text">
        <span>1 전혀 아니다</span>
        <span>4 보통이다</span>
        <span>7 매우 그렇다</span>
      </div>
    </div>
  );

  const exportCSV = () => {
    // ID 포맷팅 (숫자만 있으면 P000 형식으로, 아니면 그대로)
    const rawId = log.participantId;
    const formattedId = /^\d+$/.test(rawId) ? `P${rawId.padStart(3, '0')}` : rawId;

    const headers = [
      "participantId", "session", "condition", "result", "durationMs", 
      "q1_interesting", "q2_agency", "q3_betterThanFail", "q4_wantToPlay", "q5_schadenfreude",
      "final_attractive", "final_install", "final_reason"
    ];

    let rows = log.sessions.map(s => {
      // 결과 상태 명확화
      let detailedResult = s.result;
      if (s.condition === 'fail') detailedResult = 'scripted_fail';
      else if (s.condition === 'rewind') {
        detailedResult = s.result === 'success' ? 'rescue_success' : 'rescue_fail';
      }

      return [
        formattedId,
        s.sessionIndex,
        s.condition,
        detailedResult,
        s.durationMs,
        s.survey.interesting,
        s.survey.agency,
        s.survey.betterThanFail,
        s.survey.wantToPlay,
        s.survey.schadenfreude,
        log.finalSurvey.mostAttractive || "",
        log.finalSurvey.mostWantToInstall || "",
        `"${(log.finalSurvey.reason || "").replace(/"/g, '""')}"` // CSV 쉼표/따옴표 처리
      ];
    });

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' }); // Excel 한글 깨짐 방지 BOM 추가
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${formattedId}_full_data.csv`; a.click();
  };

  return (
    <div className="microgate-app">
      {stage === STAGES.INTRO && (
        <div className="card intro-card">
          <h1 className="logo">MICROGATE</h1>
          <p className="subtitle">광고 형식 비교 연구</p>
          <div className="intro-description">
            <p>본 프로토타입은 모바일 게임의 2가지 인터랙티브 광고 형식을 비교합니다.</p>
            <p>총 2개의 세션을 체험하며, 각 세션 종료 후 설문에 응답하게 됩니다.</p>
            <p className="privacy-note">※ 모든 데이터는 로컬에만 저장되며 외부로 전송되지 않습니다.</p>
          </div>
          <div className="input-group">
            <label>참가자 ID</label>
            <input type="text" placeholder="P001" value={pidInput} onChange={e => setPidInput(e.target.value)} />
          </div>
          <button className="btn primary" onClick={handleStartIntro}>연구 시작</button>
        </div>
      )}

      {stage === STAGES.COMMON_INFO && (
        <div className="card guide-card">
          <h2>실험 안내</h2>
          <div className="guide-content">
            <p>이번 연구에서 참가자는 2가지 광고 형식을 체험하게 됩니다.</p>
            <div className="guide-item">
              <strong>형식 1: 실패 광고</strong>
              <p>게임 플레이를 시청만 하는 조건입니다.</p>
            </div>
            <div className="guide-item">
              <strong>형식 2: 리와인드 구출</strong>
              <p>실패 장면을 본 뒤, 되감기 시점부터 직접 조작하여 결과를 바꾸는 조건입니다.</p>
            </div>
            <p>본 실험에 앞서 조작법을 익히기 위한 튜토리얼을 진행합니다.</p>
          </div>
          <button className="btn primary" onClick={() => { initGame(true); setStage(STAGES.TUTORIAL_PLAY); }}>튜토리얼 시작</button>
        </div>
      )}

      {stage === STAGES.TUTORIAL_PLAY && (
        <div className="game-container">
          <div className="tutorial-overlay" style={{position:'absolute', top:'20px', left:'50%', transform:'translateX(-50%)', background:'rgba(0,0,0,0.7)', padding:'10px 20px', borderRadius:'20px', zIndex:10, pointerEvents:'none', width:'auto', textAlign:'center', color:'#00ffcc', border:'1px solid #00ffcc'}}>마우스/드래그로 좌우로 이동하여 파워를 높이세요!</div>
          <canvas ref={canvasRef} width="480" height="720" className="game-canvas"></canvas>
        </div>
      )}

      {stage === STAGES.SESSION_INTRO && (
        <div className="card intro-card">
          <h2>세션 {currentSessionIndex + 1} / {CONDITION_ORDER.length}</h2>
          <div className="cond-display">
            {condition === 'fail' ? (
              <><h3>[ 형식 1: 실패 광고 ]</h3><p>이번 조건은 조작 없이 <strong>보기만</strong> 하시면 됩니다.</p></>
            ) : (
              <><h3>[ 형식 2: 리와인드 구출 ]</h3><p>실패 장면 후 <strong>직접 조작하여 구출</strong>하십시오.</p></>
            )}
          </div>
          <button className="btn primary" onClick={() => { initGame(false); setSessionStartTime(Date.now()); setStage(STAGES.SESSION_PLAY); }}>시작</button>
        </div>
      )}

      {(stage === STAGES.SESSION_PLAY) && (
        <div className="game-container"><canvas ref={canvasRef} width="480" height="720" className="game-canvas"></canvas></div>
      )}

      {stage === STAGES.SESSION_SURVEY && (
        <div className="card survey-card" key={`survey-session-${currentSessionIndex}`}>
          <h2>세션 설문 ({currentSessionIndex + 1}/{CONDITION_ORDER.length})</h2>
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
            if (currentSessionIndex + 1 < CONDITION_ORDER.length) { 
              setCurrentSessionIndex(prev => prev + 1); 
              setSessionSurvey(EMPTY_SURVEY);
              setStage(STAGES.SESSION_INTRO); 
            }
            else setStage(STAGES.FINAL_SURVEY);
          }}>제출</button>
        </div>
      )}

      {stage === STAGES.FINAL_SURVEY && (
        <div className="card survey-card">
          <h2>최종 비교 설문</h2>
          <div className="survey-list">
            <div className="survey-q">
              <p>1. 어느 형식이 가장 매력적이었나요?</p>
              <select value={finalSurvey.mostAttractive} onChange={e => setFinalSurvey(p => ({ ...p, mostAttractive: e.target.value }))}>
                <option value="">선택</option>
                <option value="fail">실패 광고</option>
                <option value="rewind">리와인드 구출</option>
              </select>
            </div>
            <div className="survey-q">
              <p>2. 어느 형식이 게임 설치 의향을 가장 높였나요?</p>
              <select value={finalSurvey.mostWantToInstall} onChange={e => setFinalSurvey(p => ({ ...p, mostWantToInstall: e.target.value }))}>
                <option value="">선택</option>
                <option value="fail">실패 광고</option>
                <option value="rewind">리와인드 구출</option>
              </select>
            </div>
            <div className="survey-q">
              <p>3. 이유가 있다면? (선택사항)</p>
              <textarea placeholder="자유롭게 입력해 주세요." value={finalSurvey.reason} onChange={e => setFinalSurvey(p => ({ ...p, reason: e.target.value }))} style={{height:'100px'}}></textarea>
            </div>
          </div>
          <button className="btn primary" onClick={() => {
            if (!finalSurvey.mostAttractive || !finalSurvey.mostWantToInstall) return alert("필수 항목을 선택해 주세요.");
            setLog(prev => ({ ...prev, finalSurvey, completed: true })); setStage(STAGES.COMPLETION);
          }}>완료</button>
        </div>
      )}

      {stage === STAGES.COMPLETION && (
        <div className="card completion-card">
          <h2>실험 완료</h2>
          <p style={{textAlign:'center', marginBottom:'20px'}}>참여해주셔서 감사합니다.</p>
          <div className="btn-group">
            <button className="btn outline" onClick={() => {
              const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = `${log.participantId}_data.json`; a.click();
            }}>JSON 저장</button>
            <button className="btn primary" onClick={exportCSV}>CSV 저장</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MicrogateExperiment;
