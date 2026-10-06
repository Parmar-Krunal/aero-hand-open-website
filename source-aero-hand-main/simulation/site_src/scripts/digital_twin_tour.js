(function () {
  'use strict';

  const card = document.getElementById('twinTourCard');
  const startButton = document.getElementById('twinTourStart');
  if (!card || !startButton) return;

  const title = document.getElementById('twinTourTitle');
  const description = document.getElementById('twinTourDescription');
  const stepCount = document.getElementById('twinTourStepCount');
  const progress = document.getElementById('twinTourProgress');
  const backButton = document.getElementById('twinTourBack');
  const nextButton = document.getElementById('twinTourNext');
  const exitButton = document.getElementById('twinTourExit');

  const steps = [
    {
      title: 'Meet the live hand model',
      description: 'Drag to orbit the hand and use your scroll wheel or trackpad to zoom. Choose Left or Right above the model.',
      target: '#urdfSimulationViewport'
    },
    {
      title: 'Choose where motion comes from',
      description: 'Hardware + Sim is the default view. AI Vision switches to camera-based tracking; selecting it does not start your camera.',
      target: '.twin-source-switch'
    },
    {
      title: 'Explore poses and joint controls',
      description: 'In Hardware + Sim mode, presets and sliders move the on-screen model. Switch back from AI Vision if needed. They only command physical hardware when a bridge is connected and Mirror Mode is enabled.',
      target: '#twinPresetGroup',
      fallback: '#btnTwinHardwareMode'
    },
    {
      title: 'Read the sensor and bridge status',
      description: 'Review fingertip force gauges, actuator current, and bridge status in Hardware + Sim mode. Switch back from AI Vision if needed. Demo Mode values are illustrative—not hardware readings.',
      target: '#hardwareTelemetryPanel',
      fallback: '#btnTwinHardwareMode'
    },
    {
      title: 'Try AI vision when you are ready',
      description: 'Select AI Vision Hand Tracking, then start the camera yourself if you want to try it. Camera permission is requested only after that action.',
      target: '#btnTwinAiMode'
    }
  ];

  let currentStep = 0;
  let highlightedTarget = null;

  function getVisibleTarget(step) {
    const target = document.querySelector(step.target);
    if (target && target.getClientRects().length > 0) return target;
    return step.fallback ? document.querySelector(step.fallback) : target;
  }

  function renderStep() {
    const step = steps[currentStep];
    if (highlightedTarget) highlightedTarget.classList.remove('twin-tour-highlight');
    highlightedTarget = getVisibleTarget(step);
    if (highlightedTarget) {
      highlightedTarget.classList.add('twin-tour-highlight');
      highlightedTarget.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center'
      });
    }

    title.textContent = step.title;
    description.textContent = step.description;
    stepCount.textContent = `Step ${currentStep + 1} of ${steps.length}`;
    progress.style.width = `${((currentStep + 1) / steps.length) * 100}%`;
    backButton.hidden = currentStep === 0;
    nextButton.textContent = currentStep === steps.length - 1 ? 'Finish tour' : 'Next';
  }

  function closeTour() {
    card.hidden = true;
    if (highlightedTarget) highlightedTarget.classList.remove('twin-tour-highlight');
    highlightedTarget = null;
    startButton.focus();
  }

  startButton.addEventListener('click', () => {
    currentStep = 0;
    card.hidden = false;
    renderStep();
    title.focus({ preventScroll: true });
  });

  backButton.addEventListener('click', () => {
    if (currentStep > 0) {
      currentStep -= 1;
      renderStep();
    }
  });

  nextButton.addEventListener('click', () => {
    if (currentStep === steps.length - 1) {
      closeTour();
      return;
    }
    currentStep += 1;
    renderStep();
  });

  exitButton.addEventListener('click', closeTour);
})();
