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

  var PATTERNS = [
    { img: "repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(58,47,43,0.18) 8px, rgba(58,47,43,0.18) 10px)", size: "auto" },
    { img: "radial-gradient(circle, rgba(201,176,55,0.22) 2px, transparent 2.5px)", size: "14px 14px" },
    { img: "repeating-linear-gradient(0deg, transparent, transparent 14px, rgba(92,69,16,0.14) 14px, rgba(92,69,16,0.14) 16px)", size: "auto" },
    { img: "repeating-linear-gradient(90deg, transparent, transparent 14px, rgba(92,69,16,0.14) 14px, rgba(92,69,16,0.14) 16px)", size: "auto" },
    { img: "radial-gradient(circle at center, transparent 20px, rgba(139,105,20,0.12) 21px, transparent 22px, transparent 38px, rgba(139,105,20,0.09) 39px, transparent 40px)", size: "auto" }
  ];

  var RGB_INTENSITY = [0, 55, 110, 170, 220];

  var wState = {
    buttons: [false, false, false, false, false],
    switchOn: true,
    spinAngle: 0,
    rollers: [0, 0, 0],
    dialAngle: 0,
    clicks: 0
  };

  var cubeEl = null;
  var canvasEl = null;
  var clicksEl = null;
  var faceEls = [];
  var widgetRefs = { overlays: [], buttons: [], rollerBalls: [] };

  var orbitX = -25, orbitY = 35;
  var vx = 0, vy = 0;
  var bobOffset = 0, bobStart = 0;
  var isDragging = false, dragStart = null;
  var lastMouse = { x: 0, y: 0 };
  var initialized = false;
  var dotPositions = [];
  var spinMomentum = 0;
  var fogClouds = [];

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
     IMPOSSIBLE EFFECT: Surface patterns
     Each button toggles a pattern painted
     across every face of the cube
     ═══════════════════════════════════════ */

  function syncPatterns() {
    var imgs = [], sizes = [];
    for (var i = 0; i < 5; i++) {
      if (wState.buttons[i]) {
        imgs.push(PATTERNS[i].img);
        sizes.push(PATTERNS[i].size);
      }
    }
    var imgStr = imgs.length ? imgs.join(", ") : "none";
    var szStr = sizes.length ? sizes.join(", ") : "auto";
    for (var f = 0; f < widgetRefs.overlays.length; f++) {
      widgetRefs.overlays[f].style.backgroundImage = imgStr;
      widgetRefs.overlays[f].style.backgroundSize = szStr;
    }
  }

  /* ═══════════════════════════════════════
     IMPOSSIBLE EFFECT: RGB tint
     Roller positions mix into a color wash
     ═══════════════════════════════════════ */

  function syncTint() {
    var r = RGB_INTENSITY[wState.rollers[0]] || 0;
    var g = RGB_INTENSITY[wState.rollers[1]] || 0;
    var b = RGB_INTENSITY[wState.rollers[2]] || 0;
    var hasColor = r > 0 || g > 0 || b > 0;
    var tint = hasColor ? "rgba(" + r + "," + g + "," + b + ",0.22)" : "transparent";
    for (var f = 0; f < widgetRefs.overlays.length; f++) {
      widgetRefs.overlays[f].style.backgroundColor = tint;
    }
  }

  /* ═══════════════════════════════════════
     IMPOSSIBLE EFFECT: Night mode
     Switch kills the room lights
     ═══════════════════════════════════════ */

  function syncNightMode() {
    document.documentElement.classList.toggle("night", !wState.switchOn);
    syncBgVisuals();
  }

  /* ═══════════════════════════════════════
     IMPOSSIBLE EFFECT: Background rotation
     Dial spins the world around the cube
     ═══════════════════════════════════════ */

  function syncBgRotation() {
    if (widgetRefs.bgRotate) {
      widgetRefs.bgRotate.style.transform = "rotate(" + wState.dialAngle + "deg)";
    }
  }

  /* ═══════════════════════════════════════
     Pollen / Stars background dots
     Same positions, different brightness
     ═══════════════════════════════════════ */

  function generateDotPositions() {
    dotPositions = [];
    for (var i = 0; i < 35; i++) {
      dotPositions.push({
        x: (Math.random() * 100).toFixed(1),
        y: (Math.random() * 100).toFixed(1),
        r: (0.6 + Math.random() * 1.4).toFixed(1),
        tileW: 110 + Math.floor(Math.random() * 200),
        tileH: 110 + Math.floor(Math.random() * 200),
        baseAlpha: 0.2 + Math.random() * 0.55
      });
    }
  }

  function syncBgVisuals() {
    if (!widgetRefs.bgRotate) return;
    var night = document.documentElement.classList.contains("night");

    var gradients = night ? [
      "radial-gradient(ellipse at 30% 20%, rgba(50,60,120,0.25), transparent 50%)",
      "radial-gradient(ellipse at 75% 75%, rgba(30,40,100,0.18), transparent 45%)",
      "radial-gradient(ellipse at 60% 40%, rgba(40,50,110,0.10), transparent 55%)"
    ] : [
      "radial-gradient(ellipse at 30% 20%, rgba(200,190,235,0.18), transparent 50%)",
      "radial-gradient(ellipse at 75% 75%, rgba(180,170,210,0.12), transparent 45%)",
      "radial-gradient(ellipse at 60% 40%, rgba(190,185,220,0.08), transparent 55%)"
    ];

    var imgs = gradients.slice();
    var sizes = ["100% 100%", "100% 100%", "100% 100%"];

    for (var i = 0; i < dotPositions.length; i++) {
      var d = dotPositions[i];
      var a = night
        ? Math.min(0.9, d.baseAlpha * 1.8).toFixed(2)
        : (d.baseAlpha * 0.55).toFixed(2);
      imgs.push(
        "radial-gradient(" + d.r + "px " + d.r + "px at " +
        d.x + "% " + d.y + "%, rgba(255,255,255," + a +
        ") 50%, transparent 100%)"
      );
      sizes.push(d.tileW + "px " + d.tileH + "px");
    }

    widgetRefs.bgRotate.style.backgroundImage = imgs.join(",");
    widgetRefs.bgRotate.style.backgroundSize = sizes.join(",");
  }

  /* ═══════════════════════════════════════
     Spinner fog — faster = foggier
     ═══════════════════════════════════════ */

  function shadowStr(defs) {
    var parts = [];
    for (var i = 0; i < defs.length; i++) {
      var s = defs[i];
      parts.push(s[0] + "px " + s[1] + "px 0 " + s[2] + "px currentColor");
    }
    return parts.join(", ");
  }

  var CLOUD_DEFS = [
    { x: 220, y: 190, w: 60, h: 45,
      shadows: [[30,-12,15],[-24,6,10],[62,4,20],[44,-22,16],[84,-8,13]],
      curve: function(f) { return Math.min(0.75, f * 2.8); } },
    { x: 370, y: 100, w: 45, h: 35,
      shadows: [[22,-8,11],[-18,4,8],[50,-2,15],[34,-16,12]],
      curve: function(f) { return Math.min(0.75, f * f * 1.6); } },
    { x: 90, y: 310, w: 55, h: 40,
      shadows: [[26,-10,13],[-20,5,9],[56,2,17],[38,-18,14],[70,-4,11]],
      curve: function(f) { return f > 0.45 ? Math.min(0.75, (f - 0.45) * 2.5) : 0; } },
    { x: 390, y: 245, w: 50, h: 38,
      shadows: [[24,-9,12],[-19,4,9],[54,3,16],[36,-17,13]],
      curve: function(f) { return f < 0.3 ? f * 1.4 : (f < 0.55 ? 0.42 : Math.min(0.75, 0.42 + (f - 0.55) * 1.65)); } },
    { x: 180, y: 355, w: 70, h: 50,
      shadows: [[35,-14,18],[-28,7,12],[72,5,22],[50,-24,17],[98,-9,14]],
      curve: function(f) { return Math.min(0.65, f * 0.85); } },
    { x: 120, y: 130, w: 42, h: 33,
      shadows: [[20,-7,10],[-16,3,7],[46,-1,13],[30,-14,11]],
      curve: function(f) { return Math.min(0.45, f * 2.2); } },
    { x: 200, y: 235, w: 80, h: 55,
      shadows: [[40,-16,20],[-32,8,14],[82,6,25],[58,-28,19],[108,-10,16],[-14,-18,12]],
      curve: function(f) { return Math.min(0.75, f * f * f * 2.8); } },
    { x: 430, y: 170, w: 35, h: 28,
      shadows: [[18,-6,9],[-14,3,6],[42,0,12],[28,-12,10]],
      curve: function(f) { return Math.min(0.35, f * 1.4); } }
  ];

  function buildFogClouds(container) {
    fogClouds = [];
    for (var i = 0; i < CLOUD_DEFS.length; i++) {
      var d = CLOUD_DEFS[i];
      var c = el("div", "fog-cloud");
      c.style.left = d.x + "px";
      c.style.top = d.y + "px";
      c.style.width = d.w + "px";
      c.style.height = d.h + "px";
      c.style.boxShadow = shadowStr(d.shadows);
      container.appendChild(c);
      fogClouds.push({ el: c, curve: d.curve });
    }
  }

  function syncFog() {
    var effective = Math.min(0.75, spinMomentum);
    for (var i = 0; i < fogClouds.length; i++) {
      var fc = fogClouds[i];
      fc.el.style.opacity = fc.curve(effective).toFixed(3);
    }
  }

  /* ═══════════════════════════════════════
     Face 0 (front): BUTTONS
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
          syncPatterns();
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
      syncNightMode();
      onInteract(faceIdx);
    });

    face.appendChild(container);
    widgetRefs.switchEl = container;
  }

  /* ═══════════════════════════════════════
     Face 2 (back): SPINNER
     ═══════════════════════════════════════ */

  function buildSpinner(face, faceIdx) {
    var gear = createGearSVG();
    gear.style.transform = "rotate(" + wState.spinAngle + "deg)";
    face.appendChild(gear);
    widgetRefs.spinnerGear = gear;

    face.addEventListener("click", function () {
      if (isDragging) return;
      wState.spinAngle += 360 + Math.floor(Math.random() * 270);
      gear.style.transform = "rotate(" + wState.spinAngle + "deg)";
      spinMomentum = Math.min(3, spinMomentum + 1);
      onInteract(faceIdx);
    });
  }

  /* ═══════════════════════════════════════
     Face 3 (left): ROLLER (RGB)
     ═══════════════════════════════════════ */

  function buildRoller(face, faceIdx) {
    var container = el("div", "widget-roller");
    var balls = [];
    var channels = ["r", "g", "b"];

    for (var i = 0; i < 3; i++) {
      var groove = el("div", "roller-groove roller-groove--" + channels[i]);
      var ball = el("div", "roller-ball");
      ball.style.transform = "translateX(" + (wState.rollers[i] * 17.5) + "px)";
      groove.appendChild(ball);
      (function (idx, b) {
        groove.addEventListener("click", function (e) {
          e.stopPropagation();
          if (isDragging) return;
          var newPos;
          do { newPos = Math.floor(Math.random() * 5); } while (newPos === wState.rollers[idx]);
          wState.rollers[idx] = newPos;
          b.style.transform = "translateX(" + (newPos * 17.5) + "px)";
          syncTint();
          onInteract(faceIdx);
        });
      })(i, ball);
      container.appendChild(groove);
      balls.push(ball);
    }

    face.appendChild(container);
    widgetRefs.rollerBalls = balls;
  }

  /* ═══════════════════════════════════════
     Face 4 (top): DIAL
     ═══════════════════════════════════════ */

  function buildDial(face, faceIdx) {
    var container = el("div", "widget-dial");

    var base = el("div", "dial-base");
    var dirs = ["n", "e", "s", "w"];
    for (var i = 0; i < 4; i++) {
      base.appendChild(el("div", "dial-notch dial-notch--" + dirs[i]));
    }
    container.appendChild(base);

    var knob = el("div", "dial-knob");
    knob.appendChild(el("div", "dial-indicator"));
    knob.style.transform = "rotate(" + wState.dialAngle + "deg)";
    container.appendChild(knob);

    container.addEventListener("click", function (e) {
      e.stopPropagation();
      if (isDragging) return;
      wState.dialAngle += 90;
      knob.style.transform = "rotate(" + wState.dialAngle + "deg)";
      syncBgRotation();
      onInteract(faceIdx);
    });

    face.appendChild(container);
    widgetRefs.dialKnob = knob;
  }

  /* ═══════════════════════════════════════
     Face 5 (bottom): MIRROR
     Reflects you — also a cube, spinning
     ═══════════════════════════════════════ */

  function buildPad(face, faceIdx) {
    var mirror = el("div", "face-mirror");
    var scene = el("div", "mirror-scene");
    var offset = el("div", "mirror-offset");
    var miniCube = el("div", "mirror-cube");
    var hue = Math.floor(Math.random() * 360);
    var MINI_FACES = [
      "translateZ(11px)",
      "rotateY(180deg) translateZ(11px)",
      "rotateY(90deg) translateZ(11px)",
      "rotateY(-90deg) translateZ(11px)",
      "rotateX(90deg) translateZ(11px)",
      "rotateX(-90deg) translateZ(11px)"
    ];
    var MINI_L = [56, 38, 49, 43, 63, 33];
    for (var m = 0; m < 6; m++) {
      var mf = el("div", "mirror-face");
      mf.style.transform = MINI_FACES[m];
      mf.style.backgroundColor = "hsl(" + hue + ",60%," + MINI_L[m] + "%)";
      miniCube.appendChild(mf);
    }
    offset.appendChild(miniCube);
    scene.appendChild(offset);
    mirror.appendChild(scene);
    widgetRefs.mirrorOffset = offset;

    face.appendChild(mirror);
  }

  /* ── Cube DOM ── */

  var BUILDERS = [buildButtons, buildSwitch, buildSpinner, buildRoller, buildDial, buildPad];

  function buildCube(wrapper) {
    cubeEl = el("div", "fidget-cube");

    for (var i = 0; i < 6; i++) {
      var face = el("div", "fidget-face fidget-face--" + FACE_NAMES[i]);
      face.style.transform = FACE_TRANSFORMS[i];

      var overlay = el("div", "face-overlay");
      face.appendChild(overlay);
      widgetRefs.overlays.push(overlay);

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
    syncMirror();
  }

  function syncMirror() {
    if (!widgetRefs.mirrorOffset) return;
    var DEPTH = 120;
    var oxRad = orbitX * Math.PI / 180;
    var oyRad = orbitY * Math.PI / 180;
    var tanOx = Math.tan(oxRad);
    var sx, sy;
    if (Math.abs(tanOx) < 0.08) {
      sx = 200; sy = 200;
    } else {
      sx = DEPTH * Math.sin(oyRad) / tanOx;
      sy = DEPTH * Math.cos(oyRad) / tanOx;
    }
    widgetRefs.mirrorOffset.style.transform =
      "translate(" + sx.toFixed(1) + "px," + sy.toFixed(1) + "px)";
  }

  /* ── Bob animation ── */

  function tickBob(now) {
    if (!bobStart) bobStart = now;
    var t = (now - bobStart) / 4000;
    bobOffset = Math.sin(t * Math.PI * 2) * -8;

    if (!isDragging) {
      // Apply momentum
      if (Math.abs(vx) > 0.01 || Math.abs(vy) > 0.01) {
        orbitY += vx * 0.5;
        orbitX -= vy * 0.5;
        vx *= 0.95;
        vy *= 0.95;
        syncCubeTransform();
      }
    } else {
      syncCubeTransform();
    }

    if (spinMomentum > 0) {
      spinMomentum *= 0.978;
      if (spinMomentum < 0.005) spinMomentum = 0;
      syncFog();
    }

    requestAnimationFrame(tickBob);
  }

  /* ── Orbit drag ── */

  function initDrag(wrapper) {
    function onStart(x, y) {
      isDragging = false;
      dragStart = { x: x, y: y, ox: orbitX, oy: orbitY };
      lastMouse = { x: x, y: y };
      vx = 0; vy = 0;
      if (cubeEl) cubeEl.classList.add("dragging");
    }

    function onMove(x, y) {
      if (!dragStart) return;
      var dx = x - dragStart.x;
      var dy = y - dragStart.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragging = true;
      if (isDragging) {
        vx = x - lastMouse.x;
        vy = y - lastMouse.y;
        lastMouse = { x: x, y: y };

        orbitY = dragStart.oy + dx * 0.5;
        orbitX = dragStart.ox - dy * 0.5;
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

  /* ── Background elements ── */

  function createBackgroundElements() {
    var bgRotate = el("div", "bg-rotate");
    bgRotate.style.transform = "rotate(" + wState.dialAngle + "deg)";
    document.body.insertBefore(bgRotate, document.body.firstChild);
    widgetRefs.bgRotate = bgRotate;

    var bgNight = el("div", "bg-night");
    document.body.insertBefore(bgNight, document.body.firstChild);
    widgetRefs.bgNight = bgNight;

    var area = document.getElementById("fidget-area");
    if (area) {
      var bgFog = el("div", "bg-fog");
      buildFogClouds(bgFog);
      area.appendChild(bgFog);
      widgetRefs.bgFog = bgFog;
    }

    generateDotPositions();
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
    if (hintEl) hintEl.textContent = "Each face bends reality a little.";

    loadState().then(function () {
      createBackgroundElements();
      buildCube(wrapper);
      initDrag(wrapper);
      syncClickCounter();
      syncPatterns();
      syncTint();
      syncNightMode();
      syncBgRotation();
      syncBgVisuals();
      requestAnimationFrame(tickBob);
    });
  }

  self.initFidgetCube = initFidgetCube;
})();
