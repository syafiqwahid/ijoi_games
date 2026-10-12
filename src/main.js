import { createApp, computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import './style.css'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

createApp({
  setup() {
    const screen = ref('intro')
    const mode = ref('cpu')
    const time = ref(60)
    const round = ref(1)
    const banner = ref('')
    const winner = ref('')
    const shake = ref(false)
    const particles = ref([])
    const pressed = new Set()
    let frame = 0
    let last = performance.now()
    let timerId = 0
    let aiClock = 0
    let audio = null

    const fighters = reactive({
      blue: { name: 'RANGER RIZ', x: 23, y: 0, vy: 0, health: 100, wins: 0, attack: false, block: false, hit: false, cooldown: 0, facing: 1 },
      pink: { name: 'SWIFT AMIR', x: 72, y: 0, vy: 0, health: 100, wins: 0, attack: false, block: false, hit: false, cooldown: 0, facing: -1 }
    })

    const running = computed(() => screen.value === 'fight')
    const canStartNext = computed(() => screen.value === 'roundover')

    function beep(freq = 160, duration = .07, type = 'square', gain = .035) {
      try {
        audio ||= new AudioContext()
        const oscillator = audio.createOscillator()
        const volume = audio.createGain()
        oscillator.type = type
        oscillator.frequency.setValueAtTime(freq, audio.currentTime)
        volume.gain.setValueAtTime(gain, audio.currentTime)
        volume.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration)
        oscillator.connect(volume).connect(audio.destination)
        oscillator.start()
        oscillator.stop(audio.currentTime + duration)
      } catch {}
    }

    function resetPositions() {
      Object.assign(fighters.blue, { x: 23, y: 0, vy: 0, health: 100, attack: false, block: false, hit: false, cooldown: 0, facing: 1 })
      Object.assign(fighters.pink, { x: 72, y: 0, vy: 0, health: 100, attack: false, block: false, hit: false, cooldown: 0, facing: -1 })
      particles.value = []
      time.value = 60
    }

    async function beginMatch(selected = mode.value) {
      mode.value = selected
      round.value = 1
      fighters.blue.wins = 0
      fighters.pink.wins = 0
      winner.value = ''
      resetPositions()
      screen.value = 'countdown'
      banner.value = `ROUND ${round.value}`
      beep(220, .12)
      await sleep(750)
      banner.value = 'FIGHT!'
      beep(440, .18)
      await sleep(550)
      screen.value = 'fight'
      banner.value = ''
      startTimer()
    }

    async function nextRound() {
      if (!canStartNext.value) return
      if (fighters.blue.wins >= 2 || fighters.pink.wins >= 2) return beginMatch(mode.value)
      round.value += 1
      resetPositions()
      screen.value = 'countdown'
      banner.value = `ROUND ${round.value}`
      await sleep(700)
      banner.value = 'FIGHT!'
      beep(440, .18)
      await sleep(500)
      screen.value = 'fight'
      banner.value = ''
      startTimer()
    }

    function startTimer() {
      clearInterval(timerId)
      timerId = setInterval(() => {
        if (!running.value) return
        time.value -= 1
        if (time.value <= 0) finishRound()
      }, 1000)
    }

    function jump(fighter) {
      if (!running.value || fighter.y > 0) return
      fighter.vy = 24
      beep(260, .05, 'sine', .02)
    }

    function move(fighter, direction, amount = 1.05) {
      if (!running.value || fighter.hit) return
      fighter.x = clamp(fighter.x + direction * amount, 8, 88)
    }

    function setBlock(fighter, value) {
      if (!running.value || fighter.attack || fighter.hit) return
      fighter.block = value
    }

    function burst(x, color) {
      const id = Date.now() + Math.random()
      particles.value.push({ id, x, color })
      setTimeout(() => { particles.value = particles.value.filter((p) => p.id !== id) }, 420)
    }

    function attack(attacker, defender, kind = 'punch') {
      if (!running.value || attacker.cooldown > 0 || attacker.block || attacker.hit) return
      attacker.attack = true
      attacker.cooldown = kind === 'kick' ? 760 : 520
      beep(kind === 'kick' ? 125 : 180, .06, 'sawtooth', .025)
      setTimeout(() => {
        if (!running.value) return
        const distance = Math.abs(attacker.x - defender.x)
        const range = kind === 'kick' ? 18 : 15
        if (distance <= range && Math.abs(attacker.y - defender.y) < 24) {
          const blocked = defender.block
          const damage = blocked ? 2 : (kind === 'kick' ? 13 : 9)
          defender.health = clamp(defender.health - damage, 0, 100)
          defender.hit = !blocked
          defender.x = clamp(defender.x + attacker.facing * (blocked ? 1.2 : 3), 8, 88)
          shake.value = true
          burst((attacker.x + defender.x) / 2, blocked ? '#82f7ff' : '#ffd32a')
          beep(blocked ? 240 : 78, blocked ? .07 : .14, blocked ? 'triangle' : 'square', .05)
          setTimeout(() => { defender.hit = false; shake.value = false }, 180)
          if (defender.health <= 0) finishRound(attacker)
        }
      }, kind === 'kick' ? 190 : 130)
      setTimeout(() => { attacker.attack = false }, kind === 'kick' ? 360 : 260)
    }

    async function finishRound(forcedWinner) {
      if (!running.value) return
      clearInterval(timerId)
      screen.value = 'roundover'
      const victor = forcedWinner || (fighters.blue.health === fighters.pink.health ? null : fighters.blue.health > fighters.pink.health ? fighters.blue : fighters.pink)
      if (victor) {
        victor.wins += 1
        banner.value = 'K.O.'
        beep(70, .5, 'sawtooth', .05)
        await sleep(650)
        const matchWon = victor.wins >= 2
        winner.value = matchWon ? `${victor.name} WINS THE MATCH` : `${victor.name} TAKES THE ROUND`
      } else {
        banner.value = 'DRAW'
        winner.value = 'EVENLY MATCHED'
      }
    }

    function keydown(event) {
      const key = event.key.toLowerCase()
      if (['a','d','w','f','g','arrowleft','arrowright','arrowup','/','.',' '].includes(key)) event.preventDefault()
      pressed.add(key)
      if (event.repeat || !running.value) return
      if (key === 'w') jump(fighters.blue)
      if (key === 'f') attack(fighters.blue, fighters.pink, 'punch')
      if (key === ' ') attack(fighters.blue, fighters.pink, 'kick')
      if (key === 'g') setBlock(fighters.blue, true)
      if (mode.value === 'versus') {
        if (key === 'arrowup') jump(fighters.pink)
        if (key === '/') attack(fighters.pink, fighters.blue, 'punch')
        if (key === '.') setBlock(fighters.pink, true)
      }
    }

    function keyup(event) {
      const key = event.key.toLowerCase()
      pressed.delete(key)
      if (key === 'g') setBlock(fighters.blue, false)
      if (key === '.') setBlock(fighters.pink, false)
    }

    function mobileAction(action, active = true) {
      if (action === 'left' || action === 'right') {
        active ? pressed.add(`touch-${action}`) : pressed.delete(`touch-${action}`)
      }
      if (!active) return
      if (action === 'jump') jump(fighters.blue)
      if (action === 'hit') attack(fighters.blue, fighters.pink, 'punch')
      if (action === 'kick') attack(fighters.blue, fighters.pink, 'kick')
      if (action === 'block') setBlock(fighters.blue, true)
    }

    function loop(now) {
      const dt = Math.min((now - last) / 16.67, 2)
      last = now
      if (running.value) {
        if (pressed.has('a') || pressed.has('touch-left')) move(fighters.blue, -1, 1.05 * dt)
        if (pressed.has('d') || pressed.has('touch-right')) move(fighters.blue, 1, 1.05 * dt)
        if (mode.value === 'versus') {
          if (pressed.has('arrowleft')) move(fighters.pink, -1, 1.05 * dt)
          if (pressed.has('arrowright')) move(fighters.pink, 1, 1.05 * dt)
        }
        for (const fighter of Object.values(fighters)) {
          fighter.facing = fighter === fighters.blue ? (fighters.pink.x >= fighter.x ? 1 : -1) : (fighters.blue.x >= fighter.x ? 1 : -1)
          fighter.cooldown = Math.max(0, fighter.cooldown - 16.67 * dt)
          if (fighter.y > 0 || fighter.vy > 0) {
            fighter.y = Math.max(0, fighter.y + fighter.vy * .55 * dt)
            fighter.vy -= 1.75 * dt
            if (fighter.y === 0) fighter.vy = 0
          }
        }
        if (mode.value === 'cpu') {
          aiClock -= 16.67 * dt
          if (aiClock <= 0) {
            aiClock = 150 + Math.random() * 220
            const gap = fighters.blue.x - fighters.pink.x
            const distance = Math.abs(gap)
            fighters.pink.block = false
            if (fighters.blue.attack && distance < 18 && Math.random() > .35) {
              fighters.pink.block = true
              setTimeout(() => { fighters.pink.block = false }, 380)
            } else if (distance > 14) {
              move(fighters.pink, Math.sign(gap), 2.4)
            } else if (Math.random() > .25) {
              attack(fighters.pink, fighters.blue, Math.random() > .65 ? 'kick' : 'punch')
            } else if (Math.random() > .75) jump(fighters.pink)
          }
        }
      }
      frame = requestAnimationFrame(loop)
    }

    onMounted(() => {
      addEventListener('keydown', keydown, { passive: false })
      addEventListener('keyup', keyup)
      frame = requestAnimationFrame(loop)
    })
    onBeforeUnmount(() => {
      cancelAnimationFrame(frame)
      clearInterval(timerId)
      removeEventListener('keydown', keydown)
      removeEventListener('keyup', keyup)
    })

    return { screen, mode, time, round, banner, winner, fighters, particles, shake, beginMatch, nextRound, mobileAction, setBlock }
  },
  template: `
    <main class="game-shell">
      <section class="topline">
        <div><span class="live-dot"></span> KAMPUNG ARCADE // MATCH 01</div>
        <button class="sound-note" aria-label="Sound enabled">SOUND ON</button>
      </section>

      <section class="stage" :class="{ shake }" aria-label="Garden Clash fighting arena">
        <div class="sun"></div>
        <div class="cloud cloud-a"></div><div class="cloud cloud-b"></div>
        <div class="mountain mountain-a"></div><div class="mountain mountain-b"></div>
        <div class="tree-line"></div>
        <div class="fence"></div>
        <div class="ground-lines"></div>

        <header class="hud" v-if="screen !== 'intro'">
          <div class="fighter-hud left-hud">
            <div class="identity"><strong>{{ fighters.blue.name }}</strong><small>THE TRAIL GUARDIAN</small></div>
            <div class="health-track"><span :style="{ width: fighters.blue.health + '%' }"></span></div>
            <div class="round-pips"><i v-for="n in 2" :key="n" :class="{ won: fighters.blue.wins >= n }"></i></div>
          </div>
          <div class="timer"><small>ROUND {{ round }}</small><strong>{{ time }}</strong></div>
          <div class="fighter-hud right-hud">
            <div class="identity"><strong>{{ fighters.pink.name }}</strong><small>THE QUICKSTEP</small></div>
            <div class="health-track"><span :style="{ width: fighters.pink.health + '%' }"></span></div>
            <div class="round-pips"><i v-for="n in 2" :key="n" :class="{ won: fighters.pink.wins >= n }"></i></div>
          </div>
        </header>

        <div class="stage-title" v-if="screen === 'intro'">
          <p>AN IJOI GAMES ORIGINAL</p>
          <h1>GARDEN<br><em>CLASH</em></h1>
          <div class="slash"></div>
          <p class="tagline">Two friends. One trail. Zero chill.</p>
          <div class="mode-picker">
            <button @click="beginMatch('cpu')"><span>1P</span> VS CPU</button>
            <button @click="beginMatch('versus')"><span>2P</span> LOCAL VERSUS</button>
          </div>
          <small class="start-hint">Best of 3 · first to two rounds</small>
        </div>

        <div class="banner" v-if="banner"><span>{{ banner }}</span></div>
        <div class="round-result" v-if="screen === 'roundover' && winner">
          <p>{{ winner }}</p>
          <button @click="nextRound">{{ fighters.blue.wins >= 2 || fighters.pink.wins >= 2 ? 'REMATCH' : 'NEXT ROUND' }}</button>
        </div>

        <div v-for="p in particles" :key="p.id" class="hit-burst" :style="{ left: p.x + '%', '--burst': p.color }">HIT!</div>

        <div class="fighter fighter-blue" :class="{ attacking: fighters.blue.attack, blocking: fighters.blue.block, hurt: fighters.blue.hit, jumping: fighters.blue.y > 0 }" :style="{ left: fighters.blue.x + '%', bottom: (7 + fighters.blue.y * .45) + '%', '--face': fighters.blue.facing }">
          <div class="fighter-shadow"></div><img src="/assets/ranger-riz.png" alt="Ranger Riz in a navy fighting outfit" draggable="false" />
          <span class="guard-effect">GUARD</span>
        </div>
        <div class="fighter fighter-pink" :class="{ attacking: fighters.pink.attack, blocking: fighters.pink.block, hurt: fighters.pink.hit, jumping: fighters.pink.y > 0 }" :style="{ left: fighters.pink.x + '%', bottom: (7 + fighters.pink.y * .45) + '%', '--face': fighters.pink.facing }">
          <div class="fighter-shadow"></div><img src="/assets/swift-amir.png" alt="Swift Amir in a black and white fighting outfit" draggable="false" />
          <span class="guard-effect">GUARD</span>
        </div>

        <div class="stage-label">STAGE 01 <strong>THE BACKYARD</strong></div>
      </section>

      <section class="controls" v-if="screen !== 'intro'">
        <div class="control-card blue-card"><b>P1 · RANGER RIZ</b><span><kbd>A</kbd><kbd>D</kbd> MOVE · <kbd>W</kbd> JUMP · <kbd>F</kbd> PUNCH · <kbd>SPACE</kbd> KICK · <kbd>G</kbd> BLOCK</span></div>
        <div class="control-card pink-card" v-if="mode === 'versus'"><b>P2 · SWIFT AMIR</b><span><kbd>←</kbd><kbd>→</kbd> MOVE · <kbd>↑</kbd> JUMP · <kbd>/</kbd> PUNCH · <kbd>.</kbd> BLOCK</span></div>
        <div class="control-card pink-card" v-else><b>CPU · SWIFT AMIR</b><span>Reads movement, blocks attacks, and closes distance automatically.</span></div>
      </section>

      <section class="mobile-controls" v-if="screen === 'fight'" aria-label="Touch controls">
        <div class="dpad">
          <button @pointerdown="mobileAction('left')" @pointerup="mobileAction('left', false)" @pointerleave="mobileAction('left', false)">←</button>
          <button @pointerdown="mobileAction('right')" @pointerup="mobileAction('right', false)" @pointerleave="mobileAction('right', false)">→</button>
        </div>
        <button class="jump-btn" @pointerdown="mobileAction('jump')">JUMP</button>
        <button class="hit-btn" @pointerdown="mobileAction('hit')">HIT</button>
        <button class="kick-btn" @pointerdown="mobileAction('kick')">KICK</button>
        <button class="block-btn" @pointerdown="mobileAction('block')" @pointerup="setBlock(fighters.blue, false)" @pointerleave="setBlock(fighters.blue, false)">BLOCK</button>
      </section>
    </main>
  `
}).mount('#app')
