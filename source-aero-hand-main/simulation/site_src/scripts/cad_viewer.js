/* ============================================================
   AERO HAND OPEN — 3D CAD STUDIO CONTROLLER
   Manages the embedded Parametric STEP CAD Viewer & Model Switcher
   ============================================================ */

(function () {
  'use strict';

  const iframe = document.getElementById('cadViewerIframe');
  const stageWrapper = document.getElementById('cadStageWrapper');
  const btnSelectRight = document.getElementById('btnSelectRightStep');
  const btnSelectLeft = document.getElementById('btnSelectLeftStep');
  const btnReload = document.getElementById('btnReloadCadViewer');
  const btnOpenStandalone = document.getElementById('btnCadOpenStandalone');
  const btnFullscreen = document.getElementById('btnCadFullscreen');
  const fingerPreset = document.getElementById('cadFingerPreset');
  const fingerPosition = document.getElementById('cadFingerPosition');
  const thumbPosition = document.getElementById('cadThumbPosition');
  const fingerPositionValue = document.getElementById('cadFingerPositionValue');
  const thumbPositionValue = document.getElementById('cadThumbPositionValue');
  const resetPose = document.getElementById('btnResetCadPose');
  const applyPose = document.getElementById('btnApplyCadPose');
  const openWebcamCalibration = document.getElementById('btnOpenWebcamCalibration');
  const editStatus = document.getElementById('cadEditStatus');
  const stepModeButton = document.getElementById('btnCadStepMode');
  const urdfModeButton = document.getElementById('btnCadUrdfMode');
  const manualControls = document.getElementById('cadManualControls');
  const webcamControls = document.getElementById('cadWebcamControls');
  const workspaceNote = document.getElementById('cadWorkspaceNote');
  const urdfViewport = document.getElementById('urdfSimulationViewport');
  const urdfCanvas = document.getElementById('urdfSimulationCanvas');
  const urdfStatus = document.getElementById('urdfSimulationStatus');
  const urdfModelButtons = document.querySelectorAll('[data-urdf-model]');
  const cadOverlay = document.getElementById('cadEngineOverlay');
  const cadMsg = document.getElementById('cadEngineMsg');
  const cadSubMsg = document.getElementById('cadEngineSubMsg');
  const btnRetryCad = document.getElementById('btnRetryCadEngine');

  const MODEL_URLS = {
    right: 'http://127.0.0.1:3245/?file=Aero_Hand_Open_Right.step',
    left: 'http://127.0.0.1:3245/?file=Aero_Hand_Open_Left.step'
  };

  const URDF_MODEL_URLS = {
    right: '../ros2/src/aero_hand_open_description/cad_viewer_motion/aero_hand_open_right_7dof.urdf',
    left: '../ros2/src/aero_hand_open_description/cad_viewer_motion/aero_hand_open_left_7dof.urdf'
  };

  let currentModel = 'right';
  let cadEngineCheckAttempts = 0;
  let isCadEngineOnline = false;

  async function probeCadEngine() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      await fetch('http://127.0.0.1:3245/', { mode: 'no-cors', signal: controller.signal });
      clearTimeout(timeoutId);
      isCadEngineOnline = true;
      if (cadOverlay) cadOverlay.hidden = true;
      if (iframe && (!iframe.src || iframe.src === 'about:blank' || iframe.src.indexOf('3245') === -1)) {
        iframe.src = MODEL_URLS[currentModel];
      }
      return true;
    } catch {
      isCadEngineOnline = false;
      cadEngineCheckAttempts++;
      if (cadOverlay && workspaceMode === 'step') {
        cadOverlay.hidden = false;
        if (cadEngineCheckAttempts < 6) {
          if (cadMsg) cadMsg.textContent = 'Connecting to CAD Engine (Port 3245)...';
          if (cadSubMsg) cadSubMsg.textContent = `Warming up build123d / OCC viewer daemon (attempt ${cadEngineCheckAttempts}/6)...`;
          if (btnRetryCad) btnRetryCad.style.display = 'none';
          setTimeout(probeCadEngine, 2200);
        } else {
          if (cadMsg) cadMsg.textContent = 'CAD Engine Offline (Port 3245)';
          if (cadSubMsg) cadSubMsg.textContent = 'The CAD engine daemon is not reachable on port 3245. Launch START_WEBSITE.bat or click below to retry.';
          if (btnRetryCad) btnRetryCad.style.display = 'inline-block';
        }
      }
      return false;
    }
  }

  if (btnRetryCad) {
    btnRetryCad.addEventListener('click', () => {
      cadEngineCheckAttempts = 0;
      if (btnRetryCad) btnRetryCad.style.display = 'none';
      if (cadMsg) cadMsg.textContent = 'Retrying CAD Engine (Port 3245)...';
      probeCadEngine();
    });
  }
  let workspaceMode = 'step';
  let urdfRobot = null;
  let urdfRenderer = null;
  let urdfCamera = null;
  let urdfControls = null;
  let urdfScene = null;
  let urdfLoadVersion = 0;
  let latestPose = new Array(16).fill(0);

  function resizeUrdfSimulation() {
    if (!urdfRenderer || !urdfCamera || !urdfCanvas) return;
    const width = urdfCanvas.clientWidth || 640;
    const height = urdfCanvas.clientHeight || 520;
    urdfCamera.aspect = width / height;
    urdfCamera.updateProjectionMatrix();
    urdfRenderer.setSize(width, height, false);
  }

  function initUrdfSimulation() {
    if (!urdfCanvas || typeof URDFLoader === 'undefined' || typeof THREE === 'undefined') return;

    if (!urdfRenderer) {
      const width = urdfCanvas.clientWidth || 640;
      const height = urdfCanvas.clientHeight || 520;
      urdfScene = new THREE.Scene();
      urdfScene.background = new THREE.Color(0x172630);
      urdfCamera = new THREE.PerspectiveCamera(35, width / height, 0.01, 100);
      urdfCamera.position.set(0.18, 0.1, 0.28);
      urdfRenderer = new THREE.WebGLRenderer({ canvas: urdfCanvas, antialias: true, alpha: false });
      urdfRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      urdfRenderer.setSize(width, height, false);
      urdfRenderer.outputEncoding = THREE.sRGBEncoding;
      urdfControls = new THREE.OrbitControls(urdfCamera, urdfCanvas);
      urdfControls.target.set(0, 0.05, 0);
      urdfControls.update();
      urdfScene.add(new THREE.HemisphereLight(0xd9e8ee, 0x1b2e3a, 0.48));
      const key = new THREE.DirectionalLight(0xc8e5ee, 0.72);
      key.position.set(1, 2, 2);
      urdfScene.add(key);
      const fill = new THREE.DirectionalLight(0x4ca8bf, 0.28);
      fill.position.set(-2, 0.5, 1);
      urdfScene.add(fill);

      function render() {
        if (!urdfRenderer || !urdfScene) return;
        urdfRenderer.render(urdfScene, urdfCamera);
        requestAnimationFrame(render);
      }
      render();
    }

    if (urdfRobot) {
      urdfRobot.parent && urdfRobot.parent.remove(urdfRobot);
      urdfRobot = null;
    }

    const loader = new URDFLoader();
    const loadVersion = ++urdfLoadVersion;
    const modelPath = URDF_MODEL_URLS[currentModel] || URDF_MODEL_URLS.right;
    if (urdfStatus) urdfStatus.textContent = `Loading ${currentModel === 'left' ? 'Left' : 'Right'} hand...`;
    loader.load(modelPath, function (robot) {
      if (loadVersion !== urdfLoadVersion) return;
      urdfRobot = robot;
      urdfRobot.traverse(function (node) {
        if (!node.isMesh || !node.material) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach(function (material) {
          if (material.color) material.color.setHex(0x6d8793);
          material.roughness = 0.78;
          material.metalness = 0.04;
        });
      });

      urdfRobot.rotation.set(-Math.PI / 2, 0, currentModel === 'left' ? Math.PI : 0);
      urdfRobot.position.set(0, 0, 0);
      urdfRobot.updateMatrixWorld(true);

      const bounds = new THREE.Box3().setFromObject(urdfRobot);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const diameter = Math.max(size.x, size.y, size.z) || 0.25;
      urdfRobot.position.sub(center);
      urdfRobot.position.y = 0;
      urdfRobot.position.x = 0;
      urdfRobot.position.z = 0;

      const fitDistance = diameter / (2 * Math.tan(THREE.MathUtils.degToRad(urdfCamera.fov / 2))) * 1.35;
      urdfCamera.position.copy(new THREE.Vector3(0.46, 0.3, 1).normalize().multiplyScalar(fitDistance));
      urdfCamera.near = diameter / 100;
      urdfCamera.far = diameter * 20;
      urdfCamera.updateProjectionMatrix();
      urdfControls.target.set(0, 0, 0);
      urdfControls.update();

      urdfScene.add(urdfRobot);

      if (urdfStatus) urdfStatus.textContent = `URDF ready · ${currentModel === 'left' ? 'Left' : 'Right'} hand`;
      updateUrdfPose(latestPose);
    }, undefined, function () {
      if (loadVersion !== urdfLoadVersion) return;
      if (urdfStatus) urdfStatus.textContent = 'URDF load failed · run from a local server';
    });
  }

  function updateUrdfPose(angles) {
    latestPose = Array.isArray(angles) ? angles.slice() : latestPose;
    if (!urdfRobot) return;
    const sourceAngles = Array.isArray(angles) && angles.length >= 16
      ? [
        angles.slice(0, 4),
        angles.slice(4, 7),
        angles.slice(7, 10),
        angles.slice(10, 13),
        angles.slice(13, 16)
      ]
      : [
        [angles[0], angles[1], angles[2], angles[2]],
        [angles[3], angles[3], angles[3]],
        [angles[4], angles[4], angles[4]],
        [angles[5], angles[5], angles[5]],
        [angles[6], angles[6], angles[6]]
      ];
    const radians = sourceAngles.map(function (chain) {
      return chain.map(function (value) {
        return (Number(value) || 0) * Math.PI / 180;
      });
    });
    const side = currentModel === 'left' ? 'left' : 'right';
    const jointNames = [
      [`${side}_thumb_cmc_abd`, `${side}_thumb_cmc_flex`, `${side}_thumb_mcp`, `${side}_thumb_ip`],
      [`${side}_index_mcp_flex`, `${side}_index_pip`, `${side}_index_dip`],
      [`${side}_middle_mcp_flex`, `${side}_middle_pip`, `${side}_middle_dip`],
      [`${side}_ring_mcp_flex`, `${side}_ring_pip`, `${side}_ring_dip`],
      [`${side}_pinky_mcp_flex`, `${side}_pinky_pip`, `${side}_pinky_dip`]
    ];
    jointNames.forEach(function (chain, fingerIndex) {
      chain.forEach(function (jointName, jointIndex) {
        const joint = urdfRobot.joints && urdfRobot.joints[jointName];
        if (joint && typeof joint.setJointValue === 'function') {
          joint.setJointValue(radians[fingerIndex][jointIndex] || 0);
        }
      });
    });
  }

  function sendPoseToViewer(angles, source) {
    latestPose = Array.isArray(angles) ? angles.slice() : latestPose;
    if (!urdfRobot && typeof URDFLoader !== 'undefined' && typeof THREE !== 'undefined') {
      initUrdfSimulation();
    }
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage({
      type: 'aero-hand-joint-pose',
      source: source || 'manual',
      angles: angles.map(function (angle) { return Number(angle) || 0; })
    }, '*');
    updateUrdfPose(angles);
  }

  window.AeroCadViewer = {
    updateJoints: function (angles) {
      sendPoseToViewer(angles, 'digital-twin');
    },
    updateJointsFromTeleop: function (angles) {
      sendPoseToViewer(angles, 'ai-webcam');
      if (editStatus) editStatus.textContent = 'AI pose streaming';
    }
  };

  function setWorkspaceMode(mode) {
    workspaceMode = mode;
    const urdf = mode === 'urdf';
    if (stepModeButton) stepModeButton.classList.toggle('active', !urdf);
    if (urdfModeButton) urdfModeButton.classList.toggle('active', urdf);
    if (iframe) iframe.hidden = urdf;
    if (urdfViewport) urdfViewport.hidden = !urdf;
    if (cadOverlay && urdf) cadOverlay.hidden = true;
    if (cadOverlay && !urdf && !isCadEngineOnline) cadOverlay.hidden = false;
    if (workspaceNote) workspaceNote.textContent = urdf
      ? 'URDF simulation is active. Manual sliders and AI vision now articulate the 7-DoF robot model.'
      : 'STEP is used for accurate static assembly inspection. Switch to URDF Simulation to articulate the hand.';
    if (editStatus) editStatus.textContent = urdf ? 'URDF simulation' : 'CAD inspection';
    if (urdf) initUrdfSimulation();
    resizeUrdfSimulation();
    window.dispatchEvent(new Event('resize'));
  }

  window.addEventListener('resize', resizeUrdfSimulation);

  function updatePosePreview() {
    const pose = {
      type: 'aero-hand-pose-preview',
      preset: fingerPreset ? fingerPreset.value : 'open',
      finger: fingerPosition ? Number(fingerPosition.value) : 50,
      thumb: thumbPosition ? Number(thumbPosition.value) : 50
    };

    if (fingerPositionValue && fingerPosition) fingerPositionValue.textContent = `${fingerPosition.value}%`;
    if (thumbPositionValue && thumbPosition) thumbPositionValue.textContent = `${thumbPosition.value}%`;
    sendPoseToViewer([
      pose.thumb,
      pose.thumb * 0.55,
      pose.thumb * 0.9,
      pose.finger,
      pose.finger,
      pose.finger,
      pose.finger
    ], 'manual');
    if (editStatus) editStatus.textContent = 'Preview pose changed';
  }

  function setModel(modelKey) {
    if (!MODEL_URLS[modelKey]) return;
    currentModel = modelKey;

    const url = MODEL_URLS[modelKey];
    if (iframe) {
      iframe.src = url;
    }

    if (btnSelectRight && btnSelectLeft) {
      if (modelKey === 'right') {
        btnSelectRight.classList.add('active');
        btnSelectLeft.classList.remove('active');
      } else {
        btnSelectLeft.classList.add('active');
        btnSelectRight.classList.remove('active');
      }
    }

    if (btnOpenStandalone) {
      btnOpenStandalone.href = url;
    }

    urdfModelButtons.forEach(function (button) {
      const isActive = button.dataset.urdfModel === modelKey;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });

    if (urdfCanvas && typeof URDFLoader !== 'undefined' && typeof THREE !== 'undefined') {
      initUrdfSimulation();
    }
  }

  urdfModelButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      setModel(button.dataset.urdfModel);
    });
  });

  if (btnSelectRight) {
    btnSelectRight.addEventListener('click', function () {
      setModel('right');
    });
  }

  if (btnSelectLeft) {
    btnSelectLeft.addEventListener('click', function () {
      setModel('left');
    });
  }

  if (btnReload && iframe) {
    btnReload.addEventListener('click', function () {
      probeCadEngine().then(() => {
        const currentSrc = iframe.src;
        iframe.src = 'about:blank';
        setTimeout(function () {
          iframe.src = currentSrc || MODEL_URLS[currentModel];
        }, 50);
      });
    });
  }

  if (btnFullscreen && stageWrapper) {
    btnFullscreen.addEventListener('click', function () {
      if (!document.fullscreenElement) {
        if (stageWrapper.requestFullscreen) {
          stageWrapper.requestFullscreen();
        } else if (stageWrapper.webkitRequestFullscreen) {
          stageWrapper.webkitRequestFullscreen();
        }
        stageWrapper.classList.add('fullscreen');
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
        stageWrapper.classList.remove('fullscreen');
      }
    });

    document.addEventListener('fullscreenchange', function () {
      if (!document.fullscreenElement) {
        stageWrapper.classList.remove('fullscreen');
      }
    });
  }

  [fingerPreset, fingerPosition, thumbPosition].forEach(function (control) {
    if (control) control.addEventListener('input', updatePosePreview);
  });

  if (stepModeButton) stepModeButton.addEventListener('click', function () { setWorkspaceMode('step'); });
  if (urdfModeButton) urdfModeButton.addEventListener('click', function () { setWorkspaceMode('urdf'); });

  if (resetPose) {
    resetPose.addEventListener('click', function () {
      if (fingerPreset) fingerPreset.value = 'open';
      if (fingerPosition) fingerPosition.value = '50';
      if (thumbPosition) thumbPosition.value = '50';
      updatePosePreview();
      if (editStatus) editStatus.textContent = 'Preview reset';
    });
  }

  if (applyPose) {
    applyPose.addEventListener('click', function () {
      updatePosePreview();
      if (editStatus) editStatus.textContent = 'Preview applied';
    });
  }

  if (openWebcamCalibration) {
    openWebcamCalibration.addEventListener('click', async function () {
      if (!window.AeroWebcamTracker) return;
      if (window.AeroWebcamTracker.isTracking()) {
        window.AeroWebcamTracker.stop();
        openWebcamCalibration.innerHTML = '📷 Start AI camera';
      } else {
        await window.AeroWebcamTracker.start();
        openWebcamCalibration.innerHTML = window.AeroWebcamTracker.isTracking()
          ? '⏹ Stop AI camera'
          : '📷 Start AI camera';
      }
    });
  }

  if (urdfCanvas) {
    initUrdfSimulation();
  }

  // Camera & Material Presets for 3D Viewport
  document.getElementById('btnCamIso')?.addEventListener('click', function () {
    if (!urdfCamera || !urdfControls) return;
    urdfCamera.position.set(0.25, 0.22, 0.38);
    urdfControls.target.set(0, 0, 0);
    urdfControls.update();
  });
  document.getElementById('btnCamFront')?.addEventListener('click', function () {
    if (!urdfCamera || !urdfControls) return;
    urdfCamera.position.set(0, 0, 0.45);
    urdfControls.target.set(0, 0, 0);
    urdfControls.update();
  });
  document.getElementById('btnCamTop')?.addEventListener('click', function () {
    if (!urdfCamera || !urdfControls) return;
    urdfCamera.position.set(0, 0.45, 0.02);
    urdfControls.target.set(0, 0, 0);
    urdfControls.update();
  });

  function setRobotMaterial(hex, roughness) {
    if (!urdfRobot) return;
    urdfRobot.traverse(function (node) {
      if (!node.isMesh || !node.material) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(function (mat) {
        if (mat.color) mat.color.setHex(hex);
        mat.roughness = roughness;
      });
    });
  }

  document.getElementById('btnMatCarbon')?.addEventListener('click', function () {
    setRobotMaterial(0x1e293b, 0.85);
  });
  document.getElementById('btnMatOrange')?.addEventListener('click', function () {
    setRobotMaterial(0xea580c, 0.55);
  });
  document.getElementById('btnMatCyan')?.addEventListener('click', function () {
    setRobotMaterial(0x087f9d, 0.6);
  });

  // Probe CAD Engine initially
  probeCadEngine();
  window.addEventListener('aero-section-change', function () {
    if (window.location.hash === '#cad-viewer') {
      probeCadEngine();
    }
  });
})();
