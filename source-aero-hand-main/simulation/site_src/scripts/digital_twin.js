/* ============================================================
   AERO HAND OPEN — DIGITAL TWIN TELEMETRY & WEBSOCKET ENGINE
   ============================================================ */

(function () {
  'use strict';

  const JOINT_NAMES = [
    { id: 't_abd', name: 'Thumb ABD', max: 100 },
    { id: 't_flx', name: 'Thumb FLX', max: 55 },
    { id: 't_mcp', name: 'Thumb MCP', max: 90 },
    { id: 't_ip',  name: 'Thumb IP',  max: 90 },
    { id: 'i_mcp', name: 'Index MCP', max: 90 },
    { id: 'i_pip', name: 'Index PIP', max: 90 },
    { id: 'i_dip', name: 'Index DIP', max: 90 },
    { id: 'm_mcp', name: 'Middle MCP', max: 90 },
    { id: 'm_pip', name: 'Middle PIP', max: 90 },
    { id: 'm_dip', name: 'Middle DIP', max: 90 },
    { id: 'r_mcp', name: 'Ring MCP', max: 90 },
    { id: 'r_pip', name: 'Ring PIP', max: 90 },
    { id: 'r_dip', name: 'Ring DIP', max: 90 },
    { id: 'p_mcp', name: 'Pinky MCP', max: 90 },
    { id: 'p_pip', name: 'Pinky PIP', max: 90 },
    { id: 'p_dip', name: 'Pinky DIP', max: 90 }
  ];

  const ACTUATOR_NAMES = [
    'thumb_cmc_abd', 'thumb_cmc_flex', 'thumb_tendon',
    'index_tendon', 'middle_tendon', 'ring_tendon', 'pinky_tendon'
  ];

  let ws = null;
  let isConnected = false;
  let isMirrorMode = false;
  let isDemoMotion = false;
  let syntheticAnimFrame = null;
  let currentAngles = new Array(16).fill(0);
  let currentForces = [0, 0, 0, 0, 0];

  // 1. Render Joint Sliders
  const container = document.getElementById('jointSlidersContainer');
  if (container) {
    container.innerHTML = JOINT_NAMES.map((j, idx) => `
      <div class="joint-row">
        <label for="jointSlider_${idx}">${j.name}</label>
        <input type="range" class="joint-slider" id="jointSlider_${idx}" min="0" max="${j.max}" step="0.5" value="0">
        <span class="joint-deg-val" id="jointVal_${idx}">0°</span>
      </div>
    `).join('');

    // Attach slider change listeners for mirror mode
    JOINT_NAMES.forEach((_, idx) => {
      const slider = document.getElementById(`jointSlider_${idx}`);
      if (slider) {
        slider.addEventListener('input', (e) => {
          const val = parseFloat(e.target.value);
          currentAngles[idx] = val;
          const display = document.getElementById(`jointVal_${idx}`);
          if (display) display.textContent = `${val.toFixed(1)}°`;

          if (isMirrorMode && isConnected && ws) {
            sendMirrorCommand();
          }
          // Notify 3D viewer if present
          if (window.AeroCadViewer && window.AeroCadViewer.updateJoints) {
            window.AeroCadViewer.updateJoints(currentAngles);
          }
        });
      }
    });
  }

  // 2. Render Actuator Table
  const tableBody = document.getElementById('actuatorTableBody');
  if (tableBody) {
    tableBody.innerHTML = ACTUATOR_NAMES.map((name, idx) => `
      <tr>
        <td style="color:var(--ink)">${name}</td>
        <td id="actCurr_${idx}" style="color:var(--cyan)">0.0 mA</td>
        <td><span class="pill pill-g" id="actStatus_${idx}">Normal</span></td>
      </tr>
    `).join('');
  }

  // 3. Connect WebSocket to Bridge
  const statusPill = document.getElementById('twinStatusPill');
  const statusText = document.getElementById('twinStatusText');
  const btnToggleConnect = document.getElementById('btnToggleConnect');
  const btnToggleDemo = document.getElementById('btnToggleDemo');
  const btnTwinHardwareMode = document.getElementById('btnTwinHardwareMode');
  const btnTwinAiMode = document.getElementById('btnTwinAiMode');
  const hardwareTelemetryPanel = document.getElementById('hardwareTelemetryPanel');
  const bridgeTelemetryPanel = document.getElementById('bridgeTelemetryPanel');
  const aiVisionPanel = document.getElementById('aiVisionPanel');
  const twinHardwareControls = document.getElementById('twinHardwareControls');
  const twinModeTitle = document.getElementById('twinModeTitle');
  const twinModeTarget = document.getElementById('twinModeTarget');
  const twinHardwareActions = document.getElementById('twinHardwareActions');
  const chkMirrorMode = document.getElementById('chkMirrorMode');

  if (chkMirrorMode) {
    chkMirrorMode.addEventListener('change', (e) => {
      isMirrorMode = e.target.checked;
    });
  }

  let reconnectTimer = null;
  let shouldAutoReconnect = true;

  function scheduleReconnect() {
    if (!shouldAutoReconnect || isConnected || reconnectTimer) return;
    if (statusPill && statusText) {
      statusPill.className = 'twin-status-pill offline';
      statusText.textContent = 'Bridge Offline · Retrying in 3s...';
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (shouldAutoReconnect && !isConnected) {
        connectWebSocket();
      }
    }, 3000);
  }

  function connectWebSocket() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const wsUrl = 'ws://127.0.0.1:8888';
    if (statusPill && statusText && !isConnected) {
      statusPill.className = 'twin-status-pill connecting';
      statusText.textContent = 'Connecting to Bridge (Port 8888)...';
    }
    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        isConnected = true;
        shouldAutoReconnect = true;
        setDemoMotion(false);
        if (statusPill && statusText) {
          statusPill.className = 'twin-status-pill online';
          statusText.textContent = 'Hardware Bridge Online (50 Hz)';
        }
        if (btnToggleConnect) btnToggleConnect.textContent = 'Disconnect';
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleTelemetry(data);
        } catch (err) {
          console.error('[Twin] Error parsing telemetry JSON:', err);
        }
      };

      ws.onclose = () => {
        isConnected = false;
        if (btnToggleConnect) btnToggleConnect.textContent = 'Connect Bridge';
        if (shouldAutoReconnect) {
          scheduleReconnect();
        } else {
          if (statusPill && statusText) {
            statusPill.className = 'twin-status-pill offline';
            statusText.textContent = 'Disconnected (Demo Mode)';
          }
          setDemoMotion(false);
        }
      };

      ws.onerror = () => {
        try { ws.close(); } catch {}
      };
    } catch {
      scheduleReconnect();
    }
  }

  if (btnToggleConnect) {
    btnToggleConnect.addEventListener('click', () => {
      if (isConnected && ws) {
        shouldAutoReconnect = false;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        ws.close();
      } else {
        shouldAutoReconnect = true;
        connectWebSocket();
      }
    });
  }

  function setTwinSource(mode) {
    const aiMode = mode === 'ai';
    if (btnTwinHardwareMode) btnTwinHardwareMode.classList.toggle('active', !aiMode);
    if (btnTwinAiMode) btnTwinAiMode.classList.toggle('active', aiMode);
    if (hardwareTelemetryPanel) hardwareTelemetryPanel.hidden = aiMode;
    if (bridgeTelemetryPanel) bridgeTelemetryPanel.hidden = aiMode;
    if (aiVisionPanel) aiVisionPanel.hidden = !aiMode;
    if (twinHardwareControls) twinHardwareControls.hidden = aiMode;
    if (twinModeTitle) twinModeTitle.textContent = aiMode ? 'AI Vision Hand Tracking' : 'Hardware & Sim Telemetry';
    if (twinModeTarget) twinModeTarget.innerHTML = aiMode
      ? 'Source: live camera pose tracking'
      : 'Target: <code>digital_twin_bridge.py</code>';
    if (twinHardwareActions) twinHardwareActions.hidden = aiMode;
  }

  if (btnTwinHardwareMode) btnTwinHardwareMode.addEventListener('click', () => setTwinSource('hardware'));
  if (btnTwinAiMode) btnTwinAiMode.addEventListener('click', () => setTwinSource('ai'));

  function setDemoMotion(enabled) {
    isDemoMotion = Boolean(enabled) && !isConnected;
    if (isDemoMotion) {
      startSyntheticDemo();
    } else {
      stopSyntheticDemo();
    }
    if (btnToggleDemo) btnToggleDemo.textContent = isDemoMotion ? 'Stop Demo Motion' : 'Start Demo Motion';
  }

  if (btnToggleDemo) {
    btnToggleDemo.addEventListener('click', () => {
      setDemoMotion(!isDemoMotion);
    });
  }

  function handleTelemetry(data) {
    // 1. Joint angles
    if (data.joint_deg && Array.isArray(data.joint_deg)) {
      currentAngles = data.joint_deg.slice(0, 16);
      currentAngles.forEach((deg, idx) => {
        const slider = document.getElementById(`jointSlider_${idx}`);
        const valText = document.getElementById(`jointVal_${idx}`);
        if (slider && !isMirrorMode) slider.value = deg;
        if (valText) valText.textContent = `${deg.toFixed(1)}°`;
      });
      if (window.AeroCadViewer && window.AeroCadViewer.updateJoints) {
        window.AeroCadViewer.updateJoints(currentAngles);
      }
    }

    // 2. FSR forces
    if (data.fsr_n && Array.isArray(data.fsr_n)) {
      currentForces = data.fsr_n.slice(0, 5);
      updateFsrDisplays(currentForces);
    }

    // 3. Actuator currents
    if (data.current_ma && Array.isArray(data.current_ma)) {
      data.current_ma.forEach((curr, idx) => {
        const cell = document.getElementById(`actCurr_${idx}`);
        const stat = document.getElementById(`actStatus_${idx}`);
        if (cell) {
          cell.textContent = `${curr >= 0 ? '+' : ''}${curr.toFixed(1)} mA`;
          cell.style.color = Math.abs(curr) > 800 ? 'var(--red)' : 'var(--cyan)';
        }
        if (stat) {
          if (Math.abs(curr) > 800) {
            stat.className = 'pill pill-r';
            stat.textContent = 'High Load';
          } else {
            stat.className = 'pill pill-g';
            stat.textContent = 'Normal';
          }
        }
      });
    }
  }

  function updateFsrDisplays(forces) {
    forces.forEach((f, idx) => {
      const valEl = document.getElementById(`valFsr${idx}`);
      const barEl = document.getElementById(`barFsr${idx}`);
      if (valEl) valEl.innerHTML = `${f.toFixed(1)} <span style="font-size:10px;color:var(--muted)">N</span>`;
      if (barEl) {
        const pct = Math.min(100, Math.max(0, (f / 15.0) * 100));
        barEl.style.width = `${pct}%`;
      }
    });
  }

  function sendMirrorCommand() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const cmd = {
      type: 'joint_command',
      joint_deg: currentAngles
    };
    ws.send(JSON.stringify(cmd));
  }

  // 4. Synthetic Demo Generator (When bridge is offline)
  let simTime = 0;
  function runSyntheticLoop() {
    if (!isDemoMotion) {
      syntheticAnimFrame = null;
      return;
    }
    simTime += 0.025;
    const t = simTime;

    // Natural undulating motion
    const demoAngles = [
      25 + 20 * Math.sin(t * 0.8), // Thumb abd
      20 + 15 * Math.sin(t * 1.0), // Thumb flex
      35 + 25 * Math.sin(t * 1.2), // Thumb mcp
      35 + 25 * Math.sin(t * 1.2), // Thumb ip
      40 + 35 * Math.sin(t * 1.3), // Index
      40 + 35 * Math.sin(t * 1.3),
      40 + 35 * Math.sin(t * 1.3),
      45 + 35 * Math.sin(t * 1.4), // Middle
      45 + 35 * Math.sin(t * 1.4),
      45 + 35 * Math.sin(t * 1.4),
      45 + 35 * Math.sin(t * 1.5), // Ring
      45 + 35 * Math.sin(t * 1.5),
      45 + 35 * Math.sin(t * 1.5),
      40 + 35 * Math.sin(t * 1.6), // Pinky
      40 + 35 * Math.sin(t * 1.6),
      40 + 35 * Math.sin(t * 1.6)
    ];

    // Synthetic touch forces
    const demoForces = [
      Math.max(0, 1.2 + 2.5 * Math.sin(t * 1.2)),
      Math.max(0, 2.0 + 4.8 * Math.sin(t * 1.3)),
      Math.max(0, 1.8 + 4.2 * Math.sin(t * 1.4)),
      Math.max(0, 0.8 + 2.0 * Math.sin(t * 1.5)),
      Math.max(0, 1.5 + 3.9 * Math.sin(t * 1.6))
    ];

    // Synthetic currents
    const demoCurrents = [
      35 + 15 * Math.sin(t * 0.8),
      42 + 20 * Math.sin(t * 1.0),
      55 + 25 * Math.sin(t * 1.2),
      60 + 30 * Math.sin(t * 1.3),
      65 + 35 * Math.sin(t * 1.4),
      48 + 22 * Math.sin(t * 1.5),
      52 + 26 * Math.sin(t * 1.6)
    ];

    if (!isMirrorMode) {
      handleTelemetry({
        joint_deg: demoAngles,
        fsr_n: demoForces,
        current_ma: demoCurrents
      });
    }

    syntheticAnimFrame = requestAnimationFrame(runSyntheticLoop);
  }

  function startSyntheticDemo() {
    if (!syntheticAnimFrame) {
      syntheticAnimFrame = requestAnimationFrame(runSyntheticLoop);
    }
  }

  function stopSyntheticDemo() {
    if (syntheticAnimFrame) {
      cancelAnimationFrame(syntheticAnimFrame);
      syntheticAnimFrame = null;
    }
  }

  // 5. Preset Gestures
  function applyPreset(angles) {
    currentAngles = [...angles];
    currentAngles.forEach((deg, idx) => {
      const slider = document.getElementById(`jointSlider_${idx}`);
      const valText = document.getElementById(`jointVal_${idx}`);
      if (slider) slider.value = deg;
      if (valText) valText.textContent = `${deg.toFixed(1)}°`;
    });
    if (isMirrorMode && isConnected && ws) {
      sendMirrorCommand();
    }
    if (window.AeroCadViewer && window.AeroCadViewer.updateJoints) {
      window.AeroCadViewer.updateJoints(currentAngles);
    }
  }

  document.getElementById('btnPresetOpen')?.addEventListener('click', () => {
    applyPreset(new Array(16).fill(0));
  });

  document.getElementById('btnPresetGrasp')?.addEventListener('click', () => {
    applyPreset([45, 30, 60, 60, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80]);
  });

  document.getElementById('btnPresetPinch')?.addEventListener('click', () => {
    applyPreset([40, 25, 55, 55, 60, 65, 50, 15, 10, 10, 15, 10, 10, 15, 10, 10]);
  });

  document.getElementById('btnPresetPeace')?.addEventListener('click', () => {
    applyPreset([30, 20, 20, 20, 0, 0, 0, 0, 0, 0, 80, 80, 80, 80, 80, 80]);
  });

  document.getElementById('btnPresetPoint')?.addEventListener('click', () => {
    applyPreset([35, 25, 45, 45, 0, 0, 0, 80, 80, 80, 80, 80, 80, 80, 80, 80]);
  });

  document.getElementById('btnPresetRock')?.addEventListener('click', () => {
    applyPreset([35, 30, 50, 50, 0, 0, 0, 80, 80, 80, 80, 80, 80, 0, 0, 0]);
  });

  // 6. Real-Time Telemetry Oscilloscope Loop
  const oscCanvas = document.getElementById('oscCanvas');
  if (oscCanvas) {
    const ctx = oscCanvas.getContext('2d');
    const historyLen = 200;
    const historyA = new Array(historyLen).fill(0);
    const historyB = new Array(historyLen).fill(0);
    const historyC = new Array(historyLen).fill(0);

    function resizeOsc() {
      const rect = oscCanvas.getBoundingClientRect();
      oscCanvas.width = rect.width * (window.devicePixelRatio || 1);
      oscCanvas.height = rect.height * (window.devicePixelRatio || 1);
    }
    window.addEventListener('resize', resizeOsc);
    resizeOsc();

    function drawOsc() {
      if (!ctx || !oscCanvas.width) {
        requestAnimationFrame(drawOsc);
        return;
      }

      // Shift history
      historyA.shift();
      historyA.push(currentAngles[4] || 0); // Index MCP
      historyB.shift();
      historyB.push(currentAngles[1] || 0); // Thumb Flex
      historyC.shift();
      const fsrSum = currentForces.reduce((a, b) => a + b, 0) * 4;
      historyC.push(fsrSum);

      const w = oscCanvas.width;
      const h = oscCanvas.height;

      // Dark background with faint grid
      ctx.fillStyle = '#060f1e';
      ctx.fillRect(0, 0, w, h);

      // Grid lines
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 30) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 20) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Draw Trace A (Index Angle - Cyan)
      ctx.strokeStyle = '#087f9d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      historyA.forEach((val, i) => {
        const x = (i / (historyLen - 1)) * w;
        const y = h - ((val / 90) * (h * 0.8) + h * 0.1);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Draw Trace B (Thumb Flex - Amber)
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      historyB.forEach((val, i) => {
        const x = (i / (historyLen - 1)) * w;
        const y = h - ((val / 60) * (h * 0.7) + h * 0.15);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Draw Trace C (Touch Pressure - Green)
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      historyC.forEach((val, i) => {
        const x = (i / (historyLen - 1)) * w;
        const y = h - ((val / 80) * (h * 0.6) + h * 0.1);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      requestAnimationFrame(drawOsc);
    }
    requestAnimationFrame(drawOsc);
  }

  // Auto-connect to live hardware / bridge websocket
  connectWebSocket();
})();

