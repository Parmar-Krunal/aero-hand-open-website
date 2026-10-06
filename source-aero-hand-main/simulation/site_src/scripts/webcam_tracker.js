/* ============================================================
   AERO HAND OPEN — MEDIAPIPE AI WEBCAM HAND TRACKING PIPELINE
   Transforms 21 Hand Landmarks into 7-DoF Aero Hand Joint Angles
   ============================================================ */

(function () {
  'use strict';

  let videoElement = null;
  let canvasElement = null;
  let canvasCtx = null;
  let cameraInstance = null;
  let handsTracker = null;
  let isTracking = false;

  // Smoothing & Telemetry
  let smoothedJoints = [0, 0, 0, 0, 0, 0, 0];
  const SMOOTH_TIME_CONSTANT = 0.09;
  const MAX_JOINT_SPEED = 360;
  let hasSmoothedPose = false;
  let latestRawPose = null;
  let handVisible = false;
  const CALIBRATION_STORAGE_KEY = 'aero-hand-vision-calibration-v1';
  const JOINT_RANGES = [100, 55, 90, 90, 90, 90, 90];
  let calibration = { open: null, closed: null };
  let calibrationStorageWarning = '';
  let lastFrameTime = performance.now();
  let frameCount = 0;
  let fps = 0;

  // DOM Elements
  const btnToggle = document.getElementById('btnOpenWebcamCalibration') || document.getElementById('btnToggleWebcam');
  const statusDot = document.getElementById('cadWebcamStatusDot') || document.getElementById('webcamStatusDot');
  const statusText = document.getElementById('cadWebcamStatusText') || document.getElementById('webcamStatusText');
  const placeholder = document.getElementById('cadWebcamPlaceholder') || document.getElementById('webcamPlaceholder');
  const fpsDisplay = document.getElementById('webcamFpsVal');
  const confDisplay = document.getElementById('webcamConfVal');
  const latencyDisplay = document.getElementById('webcamLatencyVal');
  const previewDisplay = document.getElementById('webcamJointsPreview');
  const calibrationState = document.getElementById('webcamCalibrationState');
  const calibrationHint = document.getElementById('webcamCalibrationHint');
  const captureOpenButton = document.getElementById('btnCaptureOpenHand');
  const captureClosedButton = document.getElementById('btnCaptureClosedHand');
  const resetCalibrationButton = document.getElementById('btnResetHandCalibration');

  // Landmark indices in MediaPipe Hands
  const LM = {
    WRIST: 0,
    THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
    INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
    MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
    RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
    PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function setCalibrationMessage(state, hint) {
    if (calibrationState) calibrationState.textContent = state;
    if (calibrationHint) calibrationHint.textContent = hint;
  }

  function updateCalibrationControls() {
    if (captureOpenButton) captureOpenButton.disabled = !isTracking || !handVisible;
    if (captureClosedButton) captureClosedButton.disabled = !isTracking || !handVisible;
    if (!isTracking) {
      setCalibrationMessage(
        calibration.open && calibration.closed ? 'Saved calibration ready' : 'Using default tracking range',
        'Start the camera and show one hand to enable calibration.'
      );
    } else if (!handVisible) {
      setCalibrationMessage(
        calibration.open && calibration.closed ? 'Saved calibration ready' : 'Waiting for a hand',
        'Keep one hand clearly visible in the camera view.'
      );
    } else if (calibration.open && calibration.closed) {
      setCalibrationMessage('Personal calibration active', 'Calibration adjusts the on-screen retargeting range.');
    } else if (calibration.open) {
      setCalibrationMessage('Open-hand pose saved', 'Now hold a comfortable fist and capture it.');
    } else if (calibration.closed) {
      setCalibrationMessage('Fist pose saved', 'Now hold a relaxed open hand and capture it.');
    } else {
      setCalibrationMessage('Hand detected · ready', 'Capture a relaxed open hand, then a comfortable fist.');
    }
    if (calibrationStorageWarning && calibrationState) {
      calibrationState.textContent = calibrationStorageWarning;
    }
  }

  function isValidPose(pose) {
    return Array.isArray(pose) && pose.length === JOINT_RANGES.length
      && pose.every(value => Number.isFinite(value));
  }

  function loadCalibration() {
    try {
      const saved = localStorage.getItem(CALIBRATION_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      calibration = {
        open: isValidPose(parsed.open) ? parsed.open : null,
        closed: isValidPose(parsed.closed) ? parsed.closed : null
      };
    } catch (err) {
      console.warn('[Webcam Tracker] Could not load saved hand calibration:', err);
      calibrationStorageWarning = 'Saved calibration unavailable';
    }
  }

  function saveCalibration() {
    try {
      localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(calibration));
      calibrationStorageWarning = '';
      updateCalibrationControls();
    } catch (err) {
      console.warn('[Webcam Tracker] Could not save hand calibration:', err);
      calibrationStorageWarning = 'Not saved · session only';
      setCalibrationMessage('Calibration not saved', 'Browser storage is unavailable; this calibration will last only until the page closes.');
    }
  }

  function setHandVisible(visible) {
    if (handVisible === visible) return;
    handVisible = visible;
    updateCalibrationControls();
  }

  function applyCalibration(pose) {
    if (!calibration.open || !calibration.closed) return pose;
    return pose.map((value, index) => {
      const open = calibration.open[index];
      const closed = calibration.closed[index];
      const span = closed - open;
      if (Math.abs(span) < 1) return value;
      return clamp((value - open) / span, 0, 1) * JOINT_RANGES[index];
    });
  }

  function captureCalibrationPose(kind) {
    if (!isTracking || !handVisible || !latestRawPose) {
      setCalibrationMessage('Hand not ready', 'Start the camera and keep one hand clearly visible before capturing.');
      return;
    }
    calibration[kind] = latestRawPose.slice();
    saveCalibration();
    if (calibration.open && calibration.closed) {
      setCalibrationMessage('Personal calibration active', 'Calibration is saved in this browser and adjusts on-screen retargeting only.');
    }
  }

  if (captureOpenButton) {
    captureOpenButton.addEventListener('click', () => captureCalibrationPose('open'));
  }
  if (captureClosedButton) {
    captureClosedButton.addEventListener('click', () => captureCalibrationPose('closed'));
  }
  if (resetCalibrationButton) {
    resetCalibrationButton.addEventListener('click', () => {
      calibration = { open: null, closed: null };
      try {
        localStorage.removeItem(CALIBRATION_STORAGE_KEY);
        calibrationStorageWarning = '';
        updateCalibrationControls();
      } catch (err) {
        console.warn('[Webcam Tracker] Could not clear saved hand calibration:', err);
        calibrationStorageWarning = 'Saved copy may remain';
        setCalibrationMessage('Calibration reset for this session', 'Browser storage could not be cleared; the saved copy may return on reload.');
      }
    });
  }

  loadCalibration();
  updateCalibrationControls();

  function flexionAt(a, b, c) {
    if (!a || !b || !c) return 0;
    const ab = [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)];
    const cb = [c.x - b.x, c.y - b.y, (c.z || 0) - (b.z || 0)];
    const abLength = Math.hypot(ab[0], ab[1], ab[2]);
    const cbLength = Math.hypot(cb[0], cb[1], cb[2]);
    if (abLength < 1e-6 || cbLength < 1e-6) return 0;
    const cosine = clamp((ab[0] * cb[0] + ab[1] * cb[1] + ab[2] * cb[2]) / (abLength * cbLength), -1, 1);
    return clamp(180 - Math.acos(cosine) * 180 / Math.PI, 0, 120);
  }

  function computeFingerCurl(points) {
    const mcpBend = flexionAt(points.wrist, points.mcp, points.pip);
    const pipBend = flexionAt(points.mcp, points.pip, points.dip);
    const dipBend = flexionAt(points.pip, points.dip, points.tip);
    return clamp((mcpBend * 0.2 + pipBend * 0.55 + dipBend * 0.25) * 0.9, 0, 90);
  }

  function computeThumbOpposition(thumbTip, indexMcp, pinkyMcp) {
    if (!thumbTip || !indexMcp || !pinkyMcp) return 0;
    const palmWidth = Math.hypot(indexMcp.x - pinkyMcp.x, indexMcp.y - pinkyMcp.y, (indexMcp.z || 0) - (pinkyMcp.z || 0));
    if (palmWidth < 1e-6) return 0;
    const tipDistance = Math.hypot(thumbTip.x - indexMcp.x, thumbTip.y - indexMcp.y, (thumbTip.z || 0) - (indexMcp.z || 0));
    const normalizedDistance = tipDistance / palmWidth;
    return clamp((0.78 - normalizedDistance) / 0.6 * 100, 0, 100);
  }

  // 2. Process MediaPipe Results
  function onResults(results) {
    const now = performance.now();
    const dt = now - lastFrameTime;
    lastFrameTime = now;
    frameCount++;
    if (frameCount % 6 === 0 && dt > 0) {
      fps = Math.round(1000 / dt);
      if (fpsDisplay) fpsDisplay.textContent = `${fps}`;
      if (latencyDisplay) latencyDisplay.textContent = `${Math.round(dt)} ms`;
    }

    if (!canvasCtx || !canvasElement) return;

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];
      const score = results.multiHandedness && results.multiHandedness[0] ? results.multiHandedness[0].score : 0.95;
      if (confDisplay) confDisplay.textContent = `${Math.round(score * 100)}%`;

      // Draw cybernetic skeleton
      drawLandmarks(landmarks);

      if (score < 0.35) {
        setHandVisible(false);
        canvasCtx.restore();
        return;
      }
      setHandVisible(true);

      // Compute 7-DoF angles
      const poseLandmarks = results.multiHandWorldLandmarks && results.multiHandWorldLandmarks[0]
        ? results.multiHandWorldLandmarks[0]
        : landmarks;
      const point = (index) => poseLandmarks[index];
      const thumbOpposition = computeThumbOpposition(point(LM.THUMB_TIP), point(LM.INDEX_MCP), point(LM.PINKY_MCP));
      const thumbCmcFlex = clamp(flexionAt(point(LM.WRIST), point(LM.THUMB_CMC), point(LM.THUMB_MCP)) / 90 * 55, 0, 55);
      const thumbMcpFlex = clamp((flexionAt(point(LM.THUMB_CMC), point(LM.THUMB_MCP), point(LM.THUMB_IP)) * 0.65
        + flexionAt(point(LM.THUMB_MCP), point(LM.THUMB_IP), point(LM.THUMB_TIP)) * 0.35) * 0.9, 0, 90);
      const fingerCurl = (mcp, pip, dip, tip) => computeFingerCurl({
        wrist: point(LM.WRIST), mcp: point(mcp), pip: point(pip), dip: point(dip), tip: point(tip)
      });
      const raw = [
        thumbOpposition,
        thumbCmcFlex,
        thumbMcpFlex,
        fingerCurl(LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP),
        fingerCurl(LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP),
        fingerCurl(LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP),
        fingerCurl(LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP)
      ];
      latestRawPose = raw;

      const frameSeconds = clamp(dt / 1000, 0, 0.1);
      if (!hasSmoothedPose) {
        smoothedJoints = raw.slice();
        hasSmoothedPose = true;
      }
      const alpha = 1 - Math.exp(-frameSeconds / SMOOTH_TIME_CONSTANT);
      const maxStep = MAX_JOINT_SPEED * frameSeconds;
      for (let i = 0; i < 7; i++) {
        const difference = raw[i] - smoothedJoints[i];
        const filteredStep = difference * alpha;
        smoothedJoints[i] += clamp(filteredStep, -maxStep, maxStep);
      }
      const outputJoints = applyCalibration(smoothedJoints);

      // Update UI Telemetry Preview
      if (previewDisplay) {
        previewDisplay.textContent =
          `Thumb: ${Math.round(outputJoints[2])}° | Index: ${Math.round(outputJoints[3])}° | ` +
          `Mid: ${Math.round(outputJoints[4])}° | Ring: ${Math.round(outputJoints[5])}° | Pinky: ${Math.round(outputJoints[6])}°`;
      }

      // Mirror directly onto 3D CAD Visualizer & Digital Twin!
      if (window.AeroCadViewer && window.AeroCadViewer.updateJointsFromTeleop) {
        window.AeroCadViewer.updateJointsFromTeleop(outputJoints);
      }
    } else {
      if (confDisplay) confDisplay.textContent = `0%`;
      latestRawPose = null;
      setHandVisible(false);
    }
    canvasCtx.restore();
  }

  // 3. Draw Cybernetic Landmarks
  function drawLandmarks(landmarks) {
    const w = canvasElement.width;
    const h = canvasElement.height;

    // Connections
    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
      [0, 5], [5, 6], [6, 7], [7, 8],       // Index
      [0, 9], [9, 10], [10, 11], [11, 12],  // Middle
      [0, 13], [13, 14], [14, 15], [15, 16],// Ring
      [0, 17], [17, 18], [18, 19], [19, 20],// Pinky
      [5, 9], [9, 13], [13, 17]             // Palm arch
    ];

    canvasCtx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
    canvasCtx.lineWidth = 2;
    connections.forEach(([i, j]) => {
      const p1 = landmarks[i];
      const p2 = landmarks[j];
      canvasCtx.beginPath();
      canvasCtx.moveTo(p1.x * w, p1.y * h);
      canvasCtx.lineTo(p2.x * w, p2.y * h);
      canvasCtx.stroke();
    });

    // Landmark Points
    landmarks.forEach((pt, idx) => {
      canvasCtx.beginPath();
      canvasCtx.arc(pt.x * w, pt.y * h, idx % 4 === 0 ? 4 : 2.5, 0, 2 * Math.PI);
      canvasCtx.fillStyle = (idx === 4 || idx === 8 || idx === 12 || idx === 16 || idx === 20) 
        ? '#38bdf8' 
        : '#22c55e';
      canvasCtx.fill();
    });
  }

  // 4. Start / Stop Camera Tracking
  async function startWebcam() {
    videoElement = document.getElementById('cadWebcamVideo') || document.getElementById('webcamVideo');
    canvasElement = document.getElementById('cadWebcamLandmarkCanvas') || document.getElementById('webcamLandmarkCanvas');
    if (!videoElement || !canvasElement) return;

    smoothedJoints = [0, 0, 0, 0, 0, 0, 0];
    hasSmoothedPose = false;
    lastFrameTime = performance.now();
    canvasCtx = canvasElement.getContext('2d');
    canvasElement.width = videoElement.clientWidth || 320;
    canvasElement.height = videoElement.clientHeight || 240;

    try {
      if (typeof Hands === 'undefined') {
        throw new Error('MediaPipe Hands did not load. Check your network connection and reload the page.');
      }
      if (typeof Camera === 'undefined') {
        throw new Error('MediaPipe Camera Utils did not load. Check your network connection and reload the page.');
      }
      handsTracker = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });
      handsTracker.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      handsTracker.onResults(onResults);

      isTracking = true;
      cameraInstance = new Camera(videoElement, {
        onFrame: async () => {
          if (isTracking && handsTracker) {
            await handsTracker.send({ image: videoElement });
          }
        },
        width: 640,
        height: 480
      });
      await cameraInstance.start();
      isTracking = true;
      if (statusDot) statusDot.classList.add('active');
      if (statusText) statusText.textContent = 'AI Tracking Active';
      if (placeholder) placeholder.style.display = 'none';
      updateCalibrationControls();
      if (btnToggle) {
        btnToggle.innerHTML = '<span>⏹</span> Stop Camera';
        btnToggle.classList.remove('btn-p');
      }
    } catch (err) {
      console.warn('[Webcam Tracker] Camera access error:', err);
      stopWebcam();
      const message = err instanceof Error ? err.message : 'Camera or MediaPipe could not start.';
      if (statusText) statusText.textContent = 'Tracking unavailable';
      setCalibrationMessage('Tracking unavailable', message);
      if (btnToggle) {
        btnToggle.innerHTML = '<span>📷</span> Retry Camera';
      }
    }
  }

  function stopWebcam() {
    isTracking = false;
    if (cameraInstance && cameraInstance.stop) {
      cameraInstance.stop();
    }
    if (videoElement && videoElement.srcObject) {
      videoElement.srcObject.getTracks().forEach(track => track.stop());
      videoElement.srcObject = null;
    }
    if (canvasCtx && canvasElement) {
      canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    }
    if (statusDot) statusDot.classList.remove('active');
    if (statusText) statusText.textContent = 'Camera Inactive';
    if (placeholder) placeholder.style.display = 'flex';
    if (fpsDisplay) fpsDisplay.textContent = '--';
    if (confDisplay) confDisplay.textContent = '--%';
    if (latencyDisplay) latencyDisplay.textContent = '-- ms';
    if (previewDisplay) previewDisplay.textContent = 'Thumb: 0° | Index: 0° | Middle: 0° | Ring: 0° | Pinky: 0°';
    latestRawPose = null;
    setHandVisible(false);
    updateCalibrationControls();
    if (btnToggle) {
      btnToggle.innerHTML = '<span>📷</span> Start AI Camera';
      btnToggle.classList.add('btn-p');
    }
  }

  // 5. Initialize Controls
  function init() {
    if (btnToggle) {
      btnToggle.addEventListener('click', () => {
        if (isTracking) {
          stopWebcam();
        } else {
          startWebcam();
        }
      });
    }

    const chkMirror = document.getElementById('chkWebcamMirror');
    if (chkMirror && videoElement && canvasElement) {
      chkMirror.addEventListener('change', (e) => {
        const val = e.target.checked ? 'scaleX(-1)' : 'none';
        videoElement.style.transform = val;
        canvasElement.style.transform = val;
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.AeroWebcamTracker = {
    start: startWebcam,
    stop: stopWebcam,
    isTracking: () => isTracking
  };
})();
