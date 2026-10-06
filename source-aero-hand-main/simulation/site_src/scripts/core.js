/* ============================================================
   AERO HAND OPEN — WORKBENCH SECTION-WISE ROUTING & CORE UI
   Non-continuous section management: switches workspace views instantly
   without long-scroll clutter. Keeps state synchronized across modules.
   ============================================================ */

(function () {
  'use strict';

  const SECTION_TITLES = {
    'cad-viewer':     { icon: '🦾', name: '3D CAD & Text-to-CAD Studio' },
    'studio-ide':     { icon: '💻', name: 'Studio IDE & In-Browser Compiler' },
    'digital-twin':   { icon: '🔀', name: 'Digital Twin Telemetry & Hardware Bridge' },
    'overview':       { icon: '📐', name: 'System Architecture & Specifications' },
    'electronics':    { icon: '⚡', name: 'Electronics, Schematics & Wiring' },
    'simulation-hub': { icon: '🌐', name: 'Simulation Hub (MuJoCo / Gazebo / Unity)' },
    'firmware':       { icon: '💾', name: 'Firmware & High-Speed Protocol' },
    'sdk':            { icon: '🐍', name: 'Python Control SDK & Kinematics' },
    'ros2':           { icon: '🤖', name: 'ROS 2 Control & Teleoperation' },
    'community':      { icon: '💬', name: 'Community, Assembly & Source Repos' }
  };

  // 1. Switch Workspace Section
  function switchWorkspaceSection(rawId) {
    if (!rawId) return;
    const sectionId = rawId.replace(/^#/, '');
    const targetSection = document.getElementById(sectionId);
    if (!targetSection) return;

    // A. Hide all sections and activate target
    const allSections = document.querySelectorAll('.main > section');
    allSections.forEach(s => s.classList.remove('active'));
    targetSection.classList.add('active');
    window.dispatchEvent(new Event('aero-section-change'));

    // B. Update Sidebar Active Item
    document.querySelectorAll('.nav-item').forEach(item => {
      const href = item.getAttribute('href');
      if (href === '#' + sectionId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // C. Notify Viewers & Editors of Viewport Change
    window.dispatchEvent(new Event('resize'));
    if (window.AeroStudioIde && window.AeroStudioIde.refresh) {
      window.AeroStudioIde.refresh();
    }

    // F. Smooth scroll window to top of viewport
    window.scrollTo({ top: 0, behavior: 'instant' });

    // G. Sync URL hash without jumping
    if (window.location.hash !== '#' + sectionId) {
      history.replaceState(null, '', '#' + sectionId);
    }
  }

  // 2. Bind Navigation Click Handlers
  function initThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    if (!themeToggle) return;

    const savedTheme = localStorage.getItem('aero-hand-theme');

    function setTheme(theme) {
      const isDark = theme === 'dark';
      document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
      themeToggle.setAttribute('aria-pressed', String(isDark));
      themeToggle.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} mode`);
      themeToggle.querySelector('.theme-toggle-icon').textContent = isDark ? '☀' : '☾';
      themeToggle.querySelector('.theme-toggle-label').textContent = isDark ? 'Light mode' : 'Dark mode';
      const themeColor = document.querySelector('meta[name="theme-color"]');
      if (themeColor) themeColor.setAttribute('content', isDark ? '#151a19' : '#f5f4ef');
    }

    setTheme(savedTheme || 'light');
    themeToggle.addEventListener('click', () => {
      const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('aero-hand-theme', nextTheme);
      setTheme(nextTheme);
    });
  }

  function initNav() {
    initThemeToggle();
    // Sidebar items
    document.querySelectorAll('.nav-item[href^="#"]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = a.getAttribute('href');
        switchWorkspaceSection(targetId);
        
        // Close mobile drawer if open
        const sidebar = document.getElementById('sidebar');
        const sbOverlay = document.getElementById('sbOverlay');
        if (sidebar) sidebar.classList.remove('open');
        if (sbOverlay) sbOverlay.classList.remove('open');
      });
    });

    // Topbar Tabs
    document.querySelectorAll('.wb-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-target');
        if (target) switchWorkspaceSection(target);
      });
    });

    // Any generic hash links (e.g. hero CTA buttons "#cad-viewer")
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      if (!a.classList.contains('nav-item')) {
        a.addEventListener('click', (e) => {
          const href = a.getAttribute('href');
          if (href && href.length > 1) {
            e.preventDefault();
            switchWorkspaceSection(href);
          }
        });
      }
    });

    // Hamburger & Overlay
    const sidebar = document.getElementById('sidebar');
    const sbOverlay = document.getElementById('sbOverlay');
    const hamburger = document.getElementById('hamburger');
    if (hamburger && sidebar && sbOverlay) {
      hamburger.addEventListener('click', () => {
        const isDesktop = window.matchMedia('(min-width: 961px)').matches;
        if (isDesktop) {
          const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
          hamburger.setAttribute('aria-expanded', String(!isCollapsed));
          window.dispatchEvent(new Event('resize'));
          return;
        }

        const isOpen = sidebar.classList.toggle('open');
        sbOverlay.classList.toggle('open', isOpen);
        hamburger.setAttribute('aria-expanded', String(isOpen));
      });
      sbOverlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        sbOverlay.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    }

    // Collapse toggle button
    const btnCollapseSidebar = document.getElementById('btnCollapseSidebar');
    if (btnCollapseSidebar) {
      btnCollapseSidebar.addEventListener('click', () => {
        const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
        window.dispatchEvent(new Event('resize'));
      });
    }



    // Auto Copy Code Buttons
    initCodeCopyButtons();

    // XT30 Power Estimator
    initXt30Calculator();

    // Protocol Byte Inspector
    initProtocolInspector();

    // Listen for browser back / forward buttons
    window.addEventListener('hashchange', () => {
      if (window.location.hash) {
        switchWorkspaceSection(window.location.hash);
      }
    });

    // Initial section routing on page load
    const initialHash = window.location.hash ? window.location.hash.slice(1) : 'overview';
    switchWorkspaceSection(initialHash);
  }



  // 5. Code Copy Buttons System
  function initCodeCopyButtons() {
    document.querySelectorAll('.ex-card, pre').forEach(box => {
      if (box.querySelector('.btn-copy-code')) return;
      const btn = document.createElement('button');
      btn.className = 'btn-copy-code';
      btn.innerHTML = '<span>📋</span> Copy';
      btn.setAttribute('type', 'button');
      btn.setAttribute('aria-label', 'Copy code snippet');
      btn.addEventListener('click', async () => {
        const text = box.innerText.replace(/📋 Copy|✓ Copied!/g, '').trim();
        try {
          await navigator.clipboard.writeText(text);
          btn.innerHTML = '<span>✓</span> Copied!';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.innerHTML = '<span>📋</span> Copy';
            btn.classList.remove('copied');
          }, 2000);
        } catch (err) {
          console.warn('Copy failed:', err);
        }
      });
      box.appendChild(btn);
    });
  }

  // 6. Interactive XT30 Load & Power Calculator
  function initXt30Calculator() {
    const slider = document.getElementById('xt30LoadSlider');
    const loadDisp = document.getElementById('xt30LoadDisplay');
    const curVal = document.getElementById('xt30CurrentVal');
    const pwrVal = document.getElementById('xt30PowerVal');
    const gaugeVal = document.getElementById('xt30GaugeVal');
    if (!slider) return;

    slider.addEventListener('input', () => {
      const load = parseFloat(slider.value);
      // Up to 7.0 Amps peak across 7 Feetech servos
      const amps = ((load / 100) * 7.0).toFixed(1);
      const watts = (amps * 6.0).toFixed(1);

      if (loadDisp) {
        let label = 'Normal Grasp';
        if (load < 30) label = 'Idle / Free Motion';
        else if (load > 75) label = 'High Stall Torque';
        loadDisp.textContent = `${load}% (${label})`;
      }
      if (curVal) curVal.textContent = `${amps} A`;
      if (pwrVal) pwrVal.textContent = `${watts} W`;
      if (gaugeVal) {
        if (load > 80) {
          gaugeVal.textContent = '16 AWG · Caution';
          gaugeVal.style.color = 'var(--amber)';
        } else {
          gaugeVal.textContent = '18 AWG · Safe';
          gaugeVal.style.color = 'var(--green)';
        }
      }
    });
  }

  // 7. Protocol Byte Inspector
  function initProtocolInspector() {
    const detailBox = document.getElementById('protocolByteDetail');
    if (!detailBox) return;

    document.querySelectorAll('.protocol-byte-box').forEach(box => {
      box.addEventListener('click', () => {
        document.querySelectorAll('.protocol-byte-box').forEach(b => {
          b.style.transform = 'none';
          b.style.borderColor = 'var(--border)';
        });
        box.style.transform = 'translateY(-3px)';
        box.style.borderColor = 'var(--cyan)';

        const name = box.getAttribute('data-byte-name') || 'Register Byte';
        const desc = box.getAttribute('data-byte-desc') || '';
        detailBox.innerHTML = `
          <div>
            <strong style="color:var(--cyan);font-family:var(--mono)">[${name}]</strong>
            <span style="margin-left:8px;color:var(--ink)">${desc}</span>
          </div>
        `;
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNav);
  } else {
    initNav();
  }

  window.AeroCore = {
    switchSection: switchWorkspaceSection
  };
})();
