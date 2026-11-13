(() => {
  "use strict";

  const BASE_FPS = 10;
  const FPS_PER_LEVEL = 1;
  const MAX_FPS = 20;
  const SCORE_PER_FRUIT = 10;
  const RIVAL_SPEED_RATIO = 0.65;
  const RIVAL_RESPAWN_SECONDS = 2.5;
  const RIVAL_SHIELD_SECONDS = 2;
  const DIRECTIONS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  const FRUITS = [
    { color: "#fa665f", name: "珊瑚" },
    { color: "#5cbcf1", name: "晴空" },
    { color: "#f4c655", name: "柚子" },
  ];
  const RIVAL_SETUP = [
    { name: "青岚", color: "#64c8dc", hue: 190 },
    { name: "赤羽", color: "#ff8867", hue: 16 },
  ];
  const $ = (selector) => document.querySelector(selector);
  const canvas = $("#arena");
  const ctx = canvas.getContext("2d", { alpha: false });
  const elements = {
    board: $("#boardFrame"),
    overlay: $("#gameOverlay"),
    overlayLabel: $("#overlayLabel"),
    overlayTitle: $("#overlayTitle"),
    overlayCopy: $("#overlayCopy"),
    overlayRules: $("#briefRules"),
    overlayAction: $("#overlayAction"),
    overlayActionLabel: $("#overlayActionLabel"),
    overlayFoot: $("#overlayFoot"),
    score: $("#scoreValue"),
    best: $("#bestValue"),
    level: $("#levelValue"),
    length: $("#lengthValue"),
    ranking: $("#rankingList"),
    message: $("#liveMessage"),
    pause: $("#pauseButton"),
    restart: $("#restartButton"),
    fullscreen: $("#fullscreenButton"),
    difficulty: $("#difficultySelect"),
    grid: $("#gridToggle"),
    sound: $("#soundToggle"),
  };

  function readStored(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function writeStored(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // The game remains playable when browser storage is unavailable.
    }
  }

  const game = {
    mode: "ready",
    roundStarted: false,
    geometry: null,
    columns: 36,
    rows: 24,
    snake: null,
    rivals: [],
    fruits: [],
    particles: [],
    queue: [],
    score: 0,
    best: Number(readStored("snake-duel-best", 0)) || 0,
    level: 1,
    eaten: 0,
    baseFps: BASE_FPS,
    selectedFps: Number(readStored("snake-duel-speed", BASE_FPS)) || BASE_FPS,
    gridOn: readStored("snake-duel-grid", "true") === "true",
    soundOn: readStored("snake-duel-sound", "true") === "true",
    playerAccumulator: 0,
    audio: null,
    lastUiUpdate: 0,
  };

  elements.difficulty.value = String(game.selectedFps);
  setToggle(elements.grid, game.gridOn);
  setToggle(elements.sound, game.soundOn);

  function setToggle(button, enabled) {
    button.setAttribute("aria-pressed", String(enabled));
    button.querySelector("strong").textContent = enabled ? "开启" : "关闭";
  }

  function resizeCanvas() {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(bounds.width * pixelRatio);
    canvas.height = Math.round(bounds.height * pixelRatio);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    if (!game.roundStarted) {
      const cell = Math.min(bounds.width / 36, bounds.height / 24);
      game.columns = Math.max(18, Math.floor(bounds.width / cell));
      game.rows = Math.max(14, Math.floor(bounds.height / cell));
    }
    const cell = Math.min(bounds.width / game.columns, bounds.height / game.rows);
    game.geometry = {
      width: bounds.width,
      height: bounds.height,
      cell,
      columns: game.columns,
      rows: game.rows,
      offsetX: (bounds.width - game.columns * cell) / 2,
      offsetY: (bounds.height - game.rows * cell) / 2,
    };
    render(performance.now());
  }

  function makeSnake(x, y, hue, color, length = 3) {
    const body = Array.from({ length }, (_, index) => ({ x: x - index, y }));
    return {
      body,
      previousBody: body.map((cell) => ({ ...cell })),
      direction: DIRECTIONS.right,
      hue,
      color,
    };
  }

  function occupiedCells(excludeFruit = null, excludeRival = null) {
    const occupied = new Set(game.snake ? game.snake.body.map(cellKey) : []);
    for (const rival of game.rivals) {
      if (rival !== excludeRival && rival.snake) {
        rival.snake.body.forEach((cell) => occupied.add(cellKey(cell)));
      }
    }
    for (const fruit of game.fruits) {
      if (fruit !== excludeFruit && fruit.position) occupied.add(cellKey(fruit.position));
    }
    return occupied;
  }

  function cellKey(cell) {
    return `${cell.x},${cell.y}`;
  }

  function randomFreeCell(occupied) {
    const free = [];
    for (let y = 0; y < game.rows; y += 1) {
      for (let x = 0; x < game.columns; x += 1) {
        if (!occupied.has(`${x},${y}`)) free.push({ x, y });
      }
    }
    return free.length ? free[Math.floor(Math.random() * free.length)] : null;
  }

  function makeFruit(type, position = null) {
    return { type, color: FRUITS[type % FRUITS.length].color, position, phase: Math.random() * Math.PI * 2 };
  }

  function spawnFruit(fruit) {
    fruit.position = randomFreeCell(occupiedCells(fruit));
    return fruit.position !== null;
  }

  function spawnRival(rival) {
    const occupied = occupiedCells(null, rival);
    const candidates = [];
    const playerHead = game.snake.body[0];
    for (let y = 0; y < game.rows; y += 1) {
      for (let x = 2; x < game.columns; x += 1) {
        if (Math.abs(x - playerHead.x) + Math.abs(y - playerHead.y) < 6) continue;
        const body = [{ x, y }, { x: x - 1, y }, { x: x - 2, y }];
        if (body.every((cell) => !occupied.has(cellKey(cell)))) candidates.push({ x, y });
      }
    }
    if (!candidates.length) {
      rival.snake = null;
      rival.respawn = 0.5;
      return false;
    }
    const head = candidates[Math.floor(Math.random() * candidates.length)];
    rival.snake = makeSnake(head.x, head.y, rival.hue, rival.color);
    rival.shield = 2;
    rival.respawn = 0;
    rival.accumulator = 0;
    return true;
  }

  function startRound() {
    game.baseFps = game.selectedFps;
    game.score = 0;
    game.level = 1;
    game.eaten = 0;
    game.won = false;
    game.playerAccumulator = 0;
    game.queue = [];
    game.particles = [];
    game.snake = makeSnake(Math.floor(game.columns / 2), Math.floor(game.rows / 2), 94, "#c1ef62");
    game.fruits = [];
    for (let type = 0; type < 3; type += 1) {
      const fruit = makeFruit(type);
      if (spawnFruit(fruit)) game.fruits.push(fruit);
    }
    game.rivals = RIVAL_SETUP.map((setup) => ({
      ...setup,
      snake: null,
      score: 0,
      respawn: 0,
      shield: 0,
      accumulator: 0,
    }));
    game.rivals.forEach(spawnRival);
    game.roundStarted = true;
    game.mode = "playing";
    showOverlay();
    updateUI();
    elements.message.textContent = "抢果实，留意对手路线";
    elements.pause.textContent = "暂停";
  }

  function currentFps() {
    return Math.min(MAX_FPS, game.baseFps + game.level - 1);
  }

  function opposite(a, b) {
    return a.x === -b.x && a.y === -b.y;
  }

  function queueDirection(direction) {
    if (game.mode !== "playing" || !game.snake) return;
    const last = game.queue.length ? game.queue[game.queue.length - 1] : game.snake.direction;
    if (opposite(direction, last) || (direction.x === last.x && direction.y === last.y)) return;
    if (game.queue.length < 2) game.queue.push(direction);
  }

  function moveSnake(snake, direction, grow = false) {
    snake.previousBody = snake.body.map((cell) => ({ ...cell }));
    snake.direction = direction;
    const head = snake.body[0];
    snake.body.unshift({ x: head.x + direction.x, y: head.y + direction.y });
    if (!grow) snake.body.pop();
  }

  function protectedRival(rival) {
    if (!rival.snake) return false;
    if (rival.shield > 0) return true;
    const playerCells = new Set(game.snake.body.map(cellKey));
    return rival.snake.body.some((cell) => playerCells.has(cellKey(cell)));
  }

  function gameOver(message) {
    game.mode = "over";
    if (game.score > game.best) {
      game.best = game.score;
      writeStored("snake-duel-best", game.best);
    }
    elements.message.textContent = message;
    showOverlay();
    updateUI();
    playTone(150, 0.2);
  }

  function updatePlayer() {
    if (game.queue.length) game.snake.direction = game.queue.shift();
    const head = game.snake.body[0];
    const direction = game.snake.direction;
    const next = { x: head.x + direction.x, y: head.y + direction.y };
    const fruitIndex = game.fruits.findIndex((fruit) => fruit.position && sameCell(fruit.position, next));
    const grows = fruitIndex >= 0;
    const hitsRival = game.rivals.some((rival) =>
      rival.snake && !protectedRival(rival) && rival.snake.body.slice(0, -1).some((cell) => sameCell(cell, next)),
    );
    if (next.x < 0 || next.y < 0 || next.x >= game.columns || next.y >= game.rows || hitsRival) {
      gameOver(hitsRival ? "撞上对手，比赛结束" : "撞到边界，比赛结束");
      return;
    }

    moveSnake(game.snake, direction, grows);
    if (grows) {
      const [fruit] = game.fruits.splice(fruitIndex, 1);
      game.score += SCORE_PER_FRUIT;
      game.eaten += 1;
      burstAt(fruit.position);
      playTone(620 + Math.random() * 240, 0.08);
      if (spawnFruit(fruit)) game.fruits.push(fruit);
      if (game.eaten % 5 === 0) {
        game.level = Math.min(10, game.level + 1);
        elements.message.textContent = `阶段 ${String(game.level).padStart(2, "0")} · 节奏提升`;
        playTone(900, 0.14);
      }
      updateUI();
    }
    if (game.snake.body.length >= game.columns * game.rows) {
      game.won = true;
      gameOver("棋盘已满，你赢了");
    }
  }

  function sameCell(a, b) {
    return a.x === b.x && a.y === b.y;
  }

  function updateRival(rival) {
    if (!rival.snake) return;
    const snake = rival.snake;
    const blocked = new Set();
    if (!protectedRival(rival)) {
      for (const other of game.rivals) {
        if (other !== rival && other.snake && !protectedRival(other)) {
          other.snake.body.slice(0, -1).forEach((cell) => blocked.add(cellKey(cell)));
        }
      }
    }
    const options = Object.values(DIRECTIONS).filter((direction) => {
      if (opposite(direction, snake.direction)) return false;
      const next = { x: snake.body[0].x + direction.x, y: snake.body[0].y + direction.y };
      return next.x >= 0 && next.y >= 0 && next.x < game.columns && next.y < game.rows
        && !snake.body.slice(0, -1).some((cell) => sameCell(cell, next))
        && !blocked.has(cellKey(next));
    });
    if (!options.length) {
      eliminateRival(rival);
      return;
    }
    const distance = (direction) => {
      const next = { x: snake.body[0].x + direction.x, y: snake.body[0].y + direction.y };
      let nearest = Infinity;
      for (const fruit of game.fruits) {
        if (!fruit.position) continue;
        nearest = Math.min(nearest, Math.abs(next.x - fruit.position.x) + Math.abs(next.y - fruit.position.y));
      }
      return Number.isFinite(nearest) ? nearest : 0;
    };
    const ranked = options.map((direction) => ({ direction, distance: distance(direction) }));
    const nearest = Math.min(...ranked.map((entry) => entry.distance));
    const candidates = ranked.filter((entry) => entry.distance === nearest);
    const direction = candidates[Math.floor(Math.random() * candidates.length)].direction;
    const next = { x: snake.body[0].x + direction.x, y: snake.body[0].y + direction.y };
    const playerBody = game.snake.body.slice(0, -1);
    if (!protectedRival(rival) && playerBody.some((cell) => sameCell(cell, next))) {
      eliminateRival(rival);
      return;
    }

    const fruitIndex = game.fruits.findIndex((fruit) => fruit.position && sameCell(fruit.position, next));
    const grows = fruitIndex >= 0;
    moveSnake(snake, direction, grows);
    if (grows) {
      const [fruit] = game.fruits.splice(fruitIndex, 1);
      rival.score += SCORE_PER_FRUIT;
      if (spawnFruit(fruit)) game.fruits.push(fruit);
      updateUI();
    }
  }

  function eliminateRival(rival) {
    if (rival.snake) {
      rival.snake.body.forEach((position, index) => {
        game.fruits.push({
          ...makeFruit(index % FRUITS.length, { ...position }),
          position: { ...position },
        });
      });
    }
    rival.snake = null;
    rival.respawn = RIVAL_RESPAWN_SECONDS;
    rival.shield = 0;
    rival.accumulator = 0;
    updateUI();
  }

  function update(dt) {
    for (const fruit of game.fruits) fruit.phase += dt;
    for (let index = game.particles.length - 1; index >= 0; index -= 1) {
      const particle = game.particles[index];
      particle.age += dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      if (particle.age >= particle.life) game.particles.splice(index, 1);
    }

    const interval = 1 / currentFps();
    for (const rival of game.rivals) {
      if (!rival.snake) {
        rival.respawn -= dt;
        if (rival.respawn <= 0) spawnRival(rival);
      } else {
        rival.shield = Math.max(0, rival.shield - dt);
        rival.accumulator += dt;
      }
    }

    game.playerAccumulator += dt;
    while (game.playerAccumulator >= interval && game.mode === "playing") {
      game.playerAccumulator -= interval;
      updatePlayer();
    }
    if (game.mode !== "playing") return;

    const rivalInterval = interval / RIVAL_SPEED_RATIO;
    for (const rival of game.rivals) {
      while (rival.snake && rival.accumulator >= rivalInterval && game.mode === "playing") {
        rival.accumulator -= rivalInterval;
        updateRival(rival);
      }
    }
  }

  function burstAt(position) {
    const amount = 9 + Math.floor(Math.random() * 4);
    for (let i = 0; i < amount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5;
      game.particles.push({
        x: position.x + 0.5,
        y: position.y + 0.5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: Math.random() > 0.5 ? "#ff805f" : "#f4c655",
        life: 0.55 + Math.random() * 0.25,
        age: 0,
      });
    }
  }

  function roundedRect(context, x, y, width, height, radius) {
    context.beginPath();
    if (typeof context.roundRect === "function") context.roundRect(x, y, width, height, radius);
    else context.rect(x, y, width, height);
    context.fill();
  }

  function drawSnake(snake, interpolation, alpha = 1) {
    const g = game.geometry;
    const cell = g.cell;
    const body = snake.body;
    ctx.save();
    ctx.globalAlpha = alpha;
    body.forEach((current, index) => {
      const previous = snake.previousBody[index] || body[body.length - 1];
      const x = previous.x + (current.x - previous.x) * interpolation;
      const y = previous.y + (current.y - previous.y) * interpolation;
      const inset = Math.max(1.5, cell * 0.07);
      ctx.fillStyle = index === 0
        ? snake.color
        : `hsl(${snake.hue} 58% ${Math.max(27, 59 - index / Math.max(body.length - 1, 1) * 28)}%)`;
      roundedRect(
        ctx,
        g.offsetX + x * cell + inset,
        g.offsetY + y * cell + inset,
        cell - inset * 2,
        cell - inset * 2,
        Math.max(3, cell * 0.22),
      );
    });
    const head = body[0];
    const previousHead = snake.previousBody[0] || head;
    const x = previousHead.x + (head.x - previousHead.x) * interpolation;
    const y = previousHead.y + (head.y - previousHead.y) * interpolation;
    const cx = g.offsetX + (x + 0.5) * cell;
    const cy = g.offsetY + (y + 0.5) * cell;
    const side = { x: -snake.direction.y, y: snake.direction.x };
    for (const sign of [-1, 1]) {
      ctx.fillStyle = "#f5f4e9";
      ctx.beginPath();
      ctx.arc(
        cx + snake.direction.x * cell * 0.18 + side.x * sign * cell * 0.16,
        cy + snake.direction.y * cell * 0.18 + side.y * sign * cell * 0.16,
        Math.max(1.5, cell * 0.075),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFruit(fruit, time) {
    if (!fruit.position) return;
    const g = game.geometry;
    const cell = g.cell;
    const x = g.offsetX + (fruit.position.x + 0.5) * cell;
    const y = g.offsetY + (fruit.position.y + 0.5) * cell;
    const pulse = 1 + Math.sin(time * 3.2 + fruit.phase) * 0.12;
    const radius = cell * 0.27 * pulse;
    ctx.save();
    ctx.shadowColor = fruit.color;
    ctx.shadowBlur = cell * 0.75;
    ctx.fillStyle = fruit.color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.beginPath();
    ctx.arc(x - radius * 0.3, y - radius * 0.34, Math.max(1.5, radius * 0.28), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function render(time = 0) {
    const g = game.geometry;
    if (!g) return;
    ctx.clearRect(0, 0, g.width, g.height);
    ctx.fillStyle = "#101a17";
    ctx.fillRect(0, 0, g.width, g.height);
    if (game.gridOn) {
      ctx.strokeStyle = "rgba(172, 201, 176, .10)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= game.columns; x += 1) {
        const px = Math.round(g.offsetX + x * g.cell) + 0.5;
        ctx.moveTo(px, g.offsetY);
        ctx.lineTo(px, g.offsetY + game.rows * g.cell);
      }
      for (let y = 0; y <= game.rows; y += 1) {
        const py = Math.round(g.offsetY + y * g.cell) + 0.5;
        ctx.moveTo(g.offsetX, py);
        ctx.lineTo(g.offsetX + game.columns * g.cell, py);
      }
      ctx.stroke();
    }
    game.fruits.forEach((fruit) => drawFruit(fruit, time / 1000));
    const playerInterval = 1 / currentFps();
    if (game.snake) drawSnake(game.snake, Math.min(game.playerAccumulator / playerInterval, 1));
    for (const rival of game.rivals) {
      if (!rival.snake) continue;
      const shielded = protectedRival(rival);
      const rivalInterval = playerInterval / RIVAL_SPEED_RATIO;
      const interpolation = Math.min(rival.accumulator / rivalInterval, 1);
      drawSnake(rival.snake, interpolation, shielded ? 0.38 + Math.sin(time / 95) * 0.08 : 1);
    }
    for (const particle of game.particles) {
      const progress = particle.age / particle.life;
      const x = g.offsetX + particle.x * g.cell;
      const y = g.offsetY + particle.y * g.cell;
      ctx.globalAlpha = Math.max(0, 1 - progress);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, g.cell * 0.12 * (1 - progress)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function updateUI() {
    elements.score.textContent = String(game.score).padStart(2, "0");
    elements.best.textContent = String(game.best).padStart(2, "0");
    elements.level.textContent = String(game.level).padStart(2, "0");
    elements.length.textContent = String(game.snake ? game.snake.body.length : 3).padStart(2, "0");
    const players = [
      { name: "你", score: game.score, color: "#c1ef62", alive: true, player: true },
      ...game.rivals.map((rival) => ({ name: rival.name, score: rival.score, color: rival.color, alive: Boolean(rival.snake) })),
    ].sort((a, b) => b.score - a.score);
    elements.ranking.innerHTML = players.map((player, index) => `
      <li class="rank-row ${player.player ? "is-player" : ""} ${player.alive ? "" : "is-out"}">
        <span class="rank-number">${String(index + 1).padStart(2, "0")}</span>
        <span class="rank-name"><i class="rank-dot" style="background:${player.color}"></i>${player.name}${player.alive ? "" : " · 离场"}</span>
        <span class="rank-score">${player.score}</span>
      </li>`).join("");
    elements.pause.textContent = game.mode === "paused" ? "继续" : "暂停";
    elements.pause.disabled = game.mode === "ready" || game.mode === "over";
  }

  function showOverlay() {
    const visible = game.mode !== "playing";
    elements.overlay.hidden = !visible;
    if (!visible) return;
    elements.overlayRules.hidden = game.mode !== "ready";
    if (game.mode === "ready") {
      elements.overlayLabel.textContent = "LOCAL ARENA / READY";
      elements.overlayTitle.textContent = "抢果实，躲开对手。";
      elements.overlayCopy.textContent = "方向键或 WASD 移动。手机可滑动棋盘或点按方向键。";
      elements.overlayActionLabel.textContent = "开始对局";
      elements.overlayFoot.textContent = "Enter 开始 · Space 暂停";
    } else if (game.mode === "paused") {
      elements.overlayLabel.textContent = "MATCH PAUSED";
      elements.overlayTitle.textContent = "先缓一口气。";
      elements.overlayCopy.textContent = "赛场暂停中，准备好了就继续。";
      elements.overlayActionLabel.textContent = "继续比赛";
      elements.overlayFoot.textContent = "按空格继续";
    } else {
      elements.overlayLabel.textContent = game.won ? "ARENA / VICTORY" : "ARENA / FINISHED";
      elements.overlayTitle.textContent = game.won ? "这局拿下了。" : "再来一局？";
      elements.overlayCopy.textContent = `本局 ${game.score} 分 · 个人最佳 ${game.best} 分`;
      elements.overlayActionLabel.textContent = "重新开局";
      elements.overlayFoot.textContent = "Enter 或 R 再来一局";
    }
  }

  function playTone(frequency, duration) {
    if (!game.soundOn) return;
    try {
      game.audio ||= new AudioContext();
      if (game.audio.state === "suspended") game.audio.resume();
      const oscillator = game.audio.createOscillator();
      const gain = game.audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, game.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, game.audio.currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, game.audio.currentTime + duration);
      oscillator.connect(gain).connect(game.audio.destination);
      oscillator.start();
      oscillator.stop(game.audio.currentTime + duration);
    } catch {
      game.soundOn = false;
    }
  }

  function togglePause() {
    if (game.mode === "playing") {
      game.mode = "paused";
      elements.message.textContent = "赛场已暂停";
    } else if (game.mode === "paused") {
      game.mode = "playing";
      elements.message.textContent = "继续比赛";
    } else {
      return;
    }
    showOverlay();
    updateUI();
  }

  function animationFrame(timestamp) {
    const dt = Math.min((timestamp - (game.lastFrame || timestamp)) / 1000, 0.05);
    game.lastFrame = timestamp;
    if (game.mode === "playing") update(dt);
    render(timestamp);
    if (timestamp - game.lastUiUpdate > 180) {
      updateUI();
      game.lastUiUpdate = timestamp;
    }
    requestAnimationFrame(animationFrame);
  }

  elements.overlayAction.addEventListener("click", () => {
    if (game.mode === "paused") togglePause();
    else startRound();
  });
  elements.pause.addEventListener("click", togglePause);
  elements.restart.addEventListener("click", startRound);
  elements.difficulty.addEventListener("change", () => {
    game.selectedFps = Number(elements.difficulty.value) || BASE_FPS;
    writeStored("snake-duel-speed", game.selectedFps);
  });
  elements.grid.addEventListener("click", () => {
    game.gridOn = !game.gridOn;
    setToggle(elements.grid, game.gridOn);
    writeStored("snake-duel-grid", game.gridOn);
  });
  elements.sound.addEventListener("click", () => {
    game.soundOn = !game.soundOn;
    setToggle(elements.sound, game.soundOn);
    writeStored("snake-duel-sound", game.soundOn);
  });
  elements.fullscreen.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await elements.board.requestFullscreen();
    } catch {
      elements.message.textContent = "当前浏览器不支持全屏";
    }
  });

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const direction = ({
      arrowup: DIRECTIONS.up, w: DIRECTIONS.up,
      arrowdown: DIRECTIONS.down, s: DIRECTIONS.down,
      arrowleft: DIRECTIONS.left, a: DIRECTIONS.left,
      arrowright: DIRECTIONS.right, d: DIRECTIONS.right,
    })[key];
    if (direction) {
      event.preventDefault();
      queueDirection(direction);
      return;
    }
    if (key === " " && (game.mode === "playing" || game.mode === "paused")) {
      event.preventDefault();
      togglePause();
    } else if ((key === "enter" || key === "r") && (game.mode === "ready" || game.mode === "over")) {
      startRound();
    } else if (key === "enter" && game.mode === "paused") {
      togglePause();
    }
  });

  document.querySelectorAll("[data-direction]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      queueDirection(DIRECTIONS[button.dataset.direction]);
    });
  });

  let swipeStart = null;
  canvas.addEventListener("pointerdown", (event) => {
    swipeStart = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!swipeStart) return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    if (Math.abs(dx) > Math.abs(dy)) queueDirection(dx > 0 ? DIRECTIONS.right : DIRECTIONS.left);
    else queueDirection(dy > 0 ? DIRECTIONS.down : DIRECTIONS.up);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && game.mode === "playing") togglePause();
  });
  new ResizeObserver(resizeCanvas).observe(elements.board);
  resizeCanvas();
  updateUI();
  showOverlay();
  requestAnimationFrame(animationFrame);
})();