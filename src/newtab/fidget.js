(function () {
  "use strict";

  var FACE_NAMES = ["front", "right", "back", "left", "top", "bottom"];

  var FACE_TRANSFORMS = [
    "translateZ(70px)",
    "rotateY(90deg) translateZ(70px)",
    "rotateY(180deg) translateZ(70px)",
    "rotateY(-90deg) translateZ(70px)",
    "rotateX(90deg) translateZ(70px)",
    "rotateX(-90deg) translateZ(70px)"
  ];

  var STORAGE_KEY = "fidgetCubeV2";
  var FIREWORK_COLORS = ["#c9b037", "#cd7f32", "#b87333", "#e8d28a", "#daa520", "#ff8c00"];

  var wState = {
    buttons: [false, false, false, false, false],
    switchOn: false,
    spinAngle: 0,
    rollers: [false, false, false],
    dialAngle: 0,
    clicks: 0
  };

  var cubeEl = null;
  var canvasEl = null;
  var clicksEl = null;
  var faceEls = [];
  var widgetRefs = {};

  var orbitX = -25, orbitY = 35;
  var bobOffset = 0, bobStart = 0;
  var isDragging = false, dragStart = null;
  var initialized = false;

  /* ── Helpers ── */

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  /* ── Gear SVG (for spinner face) ── */

  function gearPathD(teeth, outerR, innerR) {
    var cx = 50, cy = 50;
    var step = (Math.PI * 2) / teeth;
    var half = step * 0.25;
    var d = "";
    for (var i = 0; i < teeth; i++) {
      var a = i * step - Math.PI / 2;
      var pts = [
        [cx + innerR * Math.cos(a - half),       cy + innerR * Math.sin(a - half)],
        [cx + outerR * Math.cos(a - half * 0.6), cy + outerR * Math.sin(a - half * 0.6)],
        [cx + outerR * Math.cos(a + half * 0.6), cy + outerR * Math.sin(a + half * 0.6)],
        [cx + innerR * Math.cos(a + half),       cy + innerR * Math.sin(a + half)]
      ];
      for (var j = 0; j < pts.length; j++) {
        d += (i === 0 && j === 0 ? "M" : "L");
        d += " " + pts[j][0].toFixed(2) + " " + pts[j][1].toFixed(2) + " ";
      }
      var nextA = (i + 1) * step - Math.PI / 2;
      d += "L " + (cx + innerR * Math.cos(nextA - half)).toFixed(2) +
           " " + (cy + innerR * Math.sin(nextA - half)).toFixed(2) + " ";
    }
    return d + "Z";
  }

  function createGearSVG() {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.classList.add("spinner-gear");

    var body = document.createElementNS(ns, "path");
    body.setAttribute("d", gearPathD(10, 44, 34));
    body.classList.add("gear-body");
    svg.appendChild(body);

    var hub = document.createElementNS(ns, "circle");
    hub.setAttribute("cx", "50");
    hub.setAttribute("cy", "50");
    hub.setAttribute("r", "14");
    hub.classList.add("gear-center");
    svg.appendChild(hub);

    var arrow = document.createElementNS(ns, "polygon");
    arrow.setAttribute("points", "50,18 44,30 56,30");
    arrow.classList.add("gear-arrow");
    svg.appendChild(arrow);

    return svg;
  }

  /* ═══════════════════════════════════════
     Face 0 (front): BUTTONS
     5 brass push-buttons in a + pattern
     ═══════════════════════════════════════ */

  function buildButtons(face, faceIdx) {
    var container = el("div", "widget-buttons");
    var btns = [];
    for (var i = 0; i < 5; i++) {
      var btn = el("button", "fidget-btn");
      btn.type = "button";
      if (wState.buttons[i]) btn.classList.add("pressed");
      (function (idx, b) {
        b.addEventListener("click", function (e) {
          e.stopPropagation();
          if (isDragging) return;
          wState.buttons[idx] = !wState.buttons[idx];
          b.classList.toggle("pressed", wState.buttons[idx]);
          onInteract(faceIdx);
        });
      })(i, btn);
      container.appendChild(btn);
      btns.push(btn);
    }
    face.appendChild(container);
    widgetRefs.buttons = btns;
  }

  /* ═══════════════════════════════════════
     Face 1 (right): SWITCH
     Toggle lever with indicator light
     ═══════════════════════════════════════ */

  function buildSwitch(face, faceIdx) {
    var container = el("div", "widget-switch");
    if (wState.switchOn) container.classList.add("on");

    var track = el("div", "switch-track");
    var light = el("div", "switch-light");
    var lever = el("div", "switch-lever");
    track.appendChild(light);
    track.appendChild(lever);
    container.appendChild(track);

    container.addEventListener("click", function (e) {
      e.stopPropagation();
      if (isDragging) return;
      wState.switchOn = !wState.switchOn;
      container.classList.toggle("on", wState.switchOn);
      onInteract(faceIdx);
    });

    face.appendChild(container);
    widgetRefs.switchEl = container;
  }

  /* ═══════════════════════════════════════
     Face 2 (back): SPINNER
     Gear with momentum spin
     ═══════════════════════════════════════ */

  function buildSpinner(face, faceIdx) {
    var gear = createGearSVG();
    syncSpinner(gear);
    face.appendChild(gear);
    widgetRefs.spinnerGear = gear;

    face.addEventListener("click", function () {
      if (isDragging) return;
      wState.spinAngle += 360 + Math.floor(Math.random() * 270);
      syncSpinner(gear);
      onInteract(faceIdx);
    });
  }

  function syncSpinner(gear) {
    if (gear) gear.style.transform = "rotate(" + wState.spinAngle + "deg)";
  }

  /* ═══════════════════════════════════════
     Face 3 (left): ROLLER
     3 ball bearings in grooves
     ═══════════════════════════════════════ */

  function buildRoller(face, faceIdx) {
    var container = el("div", "widget-roller");
    var balls = [];

    for (var i = 0; i < 3; i++) {
      var groove = el("div", "roller-groove");
      var ball = el("div", "roller-ball");
      if (wState.rollers[i]) ball.classList.add("right");
      groove.appendChild(ball);
      container.appendChild(groove);
      balls.push(ball);
    }

    container.addEventListener("click", function (e) {
      e.stopPropagation();
      if (isDragging) return;
      for (var i = 0; i < 3; i++) {
        wState.rollers[i] = !wState.rollers[i];
        balls[i].classList.toggle("right", wState.rollers[i]);
      }
      onInteract(faceIdx);
    });

    face.appendChild(container);
    widgetRefs.rollerBalls = balls;
  }

  /* ═══════════════════════════════════════
     Face 4 (top): DIAL
     Rotary knob with 4 detent positions
     ═══════════════════════════════════════ */

  function buildDial(face, faceIdx) {
    var container = el("div", "widget-dial");

    var base = el("div", "dial-base");
    var dirs = ["n", "e", "s", "w"];
    for (var i = 0; i < 4; i++) {
      var notch = el("div", "dial-notch dial-notch--" + dirs[i]);
      base.appendChild(notch);
    }
    container.appendChild(base);

    var knob = el("div", "dial-knob");
    var indicator = el("div", "dial-indicator");
    knob.appendChild(indicator);
    knob.style.transform = "rotate(" + wState.dialAngle + "deg)";
    container.appendChild(knob);

    container.addEventListener("click", function (e) {
      e.stopPropagation();
      if (isDragging) return;
      wState.dialAngle += 90;
      knob.style.transform = "rotate(" + wState.dialAngle + "deg)";
      onInteract(faceIdx);
    });

    face.appendChild(container);
    widgetRefs.dialKnob = knob;
  }

  /* ═══════════════════════════════════════
     Face 5 (bottom): WORRY PAD
     Smooth brass disc with ripples
     ═══════════════════════════════════════ */

  function buildPad(face, faceIdx) {
    var pad = el("div", "widget-pad");

    function handlePress(x, y) {
      if (isDragging) return;
      var ripple = el("div", "pad-ripple");
      ripple.style.left = x + "px";
      ripple.style.top = y + "px";
      pad.appendChild(ripple);
      ripple.addEventListener("animationend", function () { ripple.remove(); });
      onInteract(faceIdx);
    }

    pad.addEventListener("mousedown", function (e) {
      var rect = pad.getBoundingClientRect();
      handlePress(e.clientX - rect.left, e.clientY - rect.top);
    });

    pad.addEventListener("touchstart", function (e) {
      if (e.touches.length === 1) {
        var rect = pad.getBoundingClientRect();
        handlePress(e.touches[0].clientX - rect.left, e.touches[0].clientY - rect.top);
      }
    }, { passive: true });

    face.appendChild(pad);
  }

  /* ── Cube DOM ── */

  var BUILDERS = [buildButtons, buildSwitch, buildSpinner, buildRoller, buildDial, buildPad];

  function buildCube(wrapper) {
    cubeEl = el("div", "fidget-cube");

    for (var i = 0; i < 6; i++) {
      var face = el("div", "fidget-face fidget-face--" + FACE_NAMES[i]);
      face.style.transform = FACE_TRANSFORMS[i];

      var rivets = ["tl", "tr", "bl", "br"];
      for (var r = 0; r < 4; r++) {
        face.appendChild(el("div", "fidget-rivet fidget-rivet--" + rivets[r]));
      }

      BUILDERS[i](face, i);
      faceEls.push(face);
      cubeEl.appendChild(face);
    }

    wrapper.appendChild(cubeEl);
    syncCubeTransform();
  }

  /* ── Interaction bookkeeping ── */

  function onInteract(faceIdx) {
    wState.clicks++;
    syncClickCounter();
    if (typeof faceIdx === "number") spawnSteamPuff(faceIdx);
    saveState();
    if (wState.clicks > 0 && wState.clicks % 50 === 0) launchFireworks();
  }

  function syncClickCounter() {
    if (!clicksEl) return;
    clicksEl.textContent = wState.clicks > 0 ? wState.clicks + " clicks" : "";
  }

  /* ── Transform helpers ── */

  function syncCubeTransform() {
    if (!cubeEl) return;
    cubeEl.style.transform =
      "translateY(" + bobOffset + "px) rotateX(" + orbitX + "deg) rotateY(" + orbitY + "deg)";
  }

  /* ── Bob animation ── */

  function tickBob(now) {
    if (!bobStart) bobStart = now;
    var t = (now - bobStart) / 4000;
    bobOffset = Math.sin(t * Math.PI * 2) * -8;
    if (!dragStart) syncCubeTransform();
    requestAnimationFrame(tickBob);
  }

  /* ── Orbit drag ── */

  function initDrag(wrapper) {
    function onStart(x, y) {
      isDragging = false;
      dragStart = { x: x, y: y, ox: orbitX, oy: orbitY };
      if (cubeEl) cubeEl.classList.add("dragging");
    }

    function onMove(x, y) {
      if (!dragStart) return;
      var dx = x - dragStart.x;
      var dy = y - dragStart.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragging = true;
      if (isDragging) {
        orbitY = dragStart.oy + dx * 0.5;
        orbitX = Math.max(-89, Math.min(89, dragStart.ox - dy * 0.5));
        syncCubeTransform();
      }
    }

    function onEnd() {
      dragStart = null;
      if (cubeEl) cubeEl.classList.remove("dragging");
    }

    wrapper.addEventListener("mousedown", function (e) {
      onStart(e.clientX, e.clientY);
      e.preventDefault();
    });
    window.addEventListener("mousemove", function (e) { onMove(e.clientX, e.clientY); });
    window.addEventListener("mouseup", onEnd);

    wrapper.addEventListener("touchstart", function (e) {
      if (e.touches.length === 1) onStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    window.addEventListener("touchmove", function (e) {
      if (e.touches.length === 1) onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    window.addEventListener("touchend", onEnd);
  }

  /* ── Steam puff ── */

  function spawnSteamPuff(faceIndex) {
    var face = faceEls[faceIndex];
    if (!face) return;
    var rect = face.getBoundingClientRect();
    var puff = el("div", "steam-puff");
    puff.style.position = "fixed";
    puff.style.left = (rect.left + rect.width / 2 - 10) + "px";
    puff.style.top = (rect.top + rect.height / 2 - 10) + "px";
    document.body.appendChild(puff);
    puff.addEventListener("animationend", function () { puff.remove(); });
  }

  /* ── Fireworks ── */

  function launchFireworks() {
    if (!canvasEl) return;
    var area = canvasEl.parentElement;
    var rect = area.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvasEl.width = rect.width * dpr;
    canvasEl.height = rect.height * dpr;

    var ctx = canvasEl.getContext("2d");
    ctx.scale(dpr, dpr);
    var w = rect.width;
    var h = rect.height;
    var particles = [];

    function burst(delay) {
      setTimeout(function () {
        var bx = w * 0.15 + Math.random() * w * 0.7;
        var by = h * 0.15 + Math.random() * h * 0.45;
        for (var i = 0; i < 35; i++) {
          var angle = Math.random() * Math.PI * 2;
          var speed = 1 + Math.random() * 3;
          particles.push({
            x: bx, y: by,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1,
            decay: 0.006 + Math.random() * 0.01,
            color: FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)],
            size: 2 + Math.random() * 3
          });
        }
      }, delay);
    }

    burst(0);
    burst(350);
    burst(750);
    burst(1200);

    function animate() {
      ctx.clearRect(0, 0, w, h);
      var alive = false;
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        if (p.life <= 0) continue;
        alive = true;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.03;
        p.vx *= 0.99;
        p.life -= p.decay;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (alive || particles.length < 140) {
        requestAnimationFrame(animate);
      } else {
        ctx.clearRect(0, 0, w, h);
      }
    }

    requestAnimationFrame(animate);
  }

  /* ── Persistence ── */

  function storageAPI() {
    return (typeof browser !== "undefined" ? browser : chrome).storage.local;
  }

  function loadState() {
    return new Promise(function (resolve) {
      try {
        storageAPI().get(STORAGE_KEY, function (result) {
          if (result && result[STORAGE_KEY]) {
            var s = result[STORAGE_KEY];
            if (Array.isArray(s.buttons) && s.buttons.length === 5) wState.buttons = s.buttons.slice();
            if (typeof s.switchOn === "boolean") wState.switchOn = s.switchOn;
            if (typeof s.spinAngle === "number") wState.spinAngle = s.spinAngle;
            if (Array.isArray(s.rollers) && s.rollers.length === 3) wState.rollers = s.rollers.slice();
            if (typeof s.dialAngle === "number") wState.dialAngle = s.dialAngle;
            if (typeof s.clicks === "number") wState.clicks = s.clicks;
          }
          resolve();
        });
      } catch (_) {
        resolve();
      }
    });
  }

  function saveState() {
    try {
      var data = {};
      data[STORAGE_KEY] = {
        buttons: wState.buttons.slice(),
        switchOn: wState.switchOn,
        spinAngle: wState.spinAngle,
        rollers: wState.rollers.slice(),
        dialAngle: wState.dialAngle,
        clicks: wState.clicks
      };
      storageAPI().set(data);
    } catch (_) { /* best-effort */ }
  }

  /* ── Public init ── */

  function initFidgetCube() {
    if (initialized) return;
    initialized = true;

    var wrapper = document.getElementById("fidget-cube-wrapper");
    canvasEl = document.getElementById("fireworks-canvas");
    clicksEl = document.getElementById("fidget-clicks");
    if (!wrapper) return;

    var hintEl = document.getElementById("fidget-hint");
    if (hintEl) hintEl.textContent = "Each face is a different fidget.";

    loadState().then(function () {
      buildCube(wrapper);
      initDrag(wrapper);
      syncClickCounter();
      requestAnimationFrame(tickBob);
    });
  }

  self.initFidgetCube = initFidgetCube;
})();
