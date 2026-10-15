import { createApp, computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import './style.css'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const CHARACTERS = {
  ranger: { id: 'ranger', name: 'RANGER RIZ', title: 'THE TRAIL GUARDIAN', ultimate: 'SIGNAL BREAKER', color: '#46b7ff', baseFacing: 1 },
  swift: { id: 'swift', name: 'SWIFT AMIR', title: 'THE QUICKSTEP', ultimate: 'PINK TEMPEST', color: '#ff3f93', baseFacing: -1 }
}

const freshState = (side, character) => ({
  side, character, name: CHARACTERS[character].name, x: side === 'blue' ? 23 : 72, y: 0, vy: 0,
  health: 100, meter: 0, wins: 0, attack: false, attackKind: '', ultimate: false,
  block: false, hit: false, defeated: false, victorious: false, moving: false,
  movingUntil: 0, cooldown: 0, facing: side === 'blue' ? 1 : -1, combo: 0
})

createApp({
  setup() {
    const screen = ref('intro')
    const mode = ref('cpu')
    const time = ref(60)
    const round = ref(1)
    const banner = ref('')
    const winner = ref('')
    const winnerSide = ref('')
    const shake = ref(false)
    const contactFlash = ref(false)
    const ultimateCallout = ref('')
    const particles = ref([])
    const selection = reactive({ blue: 'ranger', pink: 'swift' })
    const fighters = reactive({ blue: freshState('blue', 'ranger'), pink: freshState('pink', 'swift') })
    const pressed = new Set()
    let frame = 0
    let last = performance.now()
    let timerId = 0
    let aiClock = 0
    let hitStopUntil = 0
    let audio = null

    const running = computed(() => screen.value === 'fight')
    const canStartNext = computed(() => screen.value === 'roundover')
    const characterList = Object.values(CHARACTERS)
    const info = (fighter) => CHARACTERS[fighter.character]
    const fighterFlip = (fighter) => fighter.facing * info(fighter).baseFacing

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

    function applyCharacter(fighter, id) {
      fighter.character = id
      fighter.name = CHARACTERS[id].name
    }

    function chooseCharacter(side, id) {
      selection[side] = id
      applyCharacter(fighters[side], id)
      beep(id === 'ranger' ? 230 : 330, .07, 'triangle', .025)
    }

    function openSelect(selectedMode) {
      mode.value = selectedMode
      winner.value = ''
      banner.value = ''
      screen.value = 'select'
    }

    function resetPositions() {
      for (const [side, fighter] of Object.entries(fighters)) {
        Object.assign(fighter, {
          x: side === 'blue' ? 23 : 72, y: 0, vy: 0, health: 100, meter: 0,
          attack: false, attackKind: '', ultimate: false, block: false, hit: false,
          defeated: false, victorious: false, moving: false, movingUntil: 0,
          cooldown: 0, facing: side === 'blue' ? 1 : -1, combo: 0
        })
      }
      particles.value = []
      winnerSide.value = ''
      ultimateCallout.value = ''
      time.value = 60
    }

    async function beginMatch() {
      applyCharacter(fighters.blue, selection.blue)
      applyCharacter(fighters.pink, selection.pink)
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
      if (fighters.blue.wins >= 2 || fighters.pink.wins >= 2) return beginMatch()
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
      if (!running.value || fighter.y > 0 || fighter.hit || fighter.block || fighter.ultimate) return
      fighter.vy = 24
      fighter.moving = false
      beep(260, .05, 'sine', .02)
    }

    function move(fighter, direction, amount = 1.05) {
      if (!running.value || fighter.hit || fighter.attack || fighter.block || fighter.ultimate) return
      fighter.x = clamp(fighter.x + direction * amount, 8, 88)
      fighter.moving = true
      fighter.movingUntil = performance.now() + 120
    }

    function setBlock(fighter, value) {
      if (!running.value || fighter.attack || fighter.hit || fighter.ultimate) return
      fighter.block = value
      fighter.moving = false
    }

    function burst(x, color, type = 'hit', label) {
      const id = Date.now() + Math.random()
      const defaultLabel = type === 'block' ? 'CLANG!' : type === 'dust' ? '' : type === 'ultimate' ? 'ULTIMATE!' : 'HIT!'
      particles.value.push({ id, x, color, type, label: label ?? defaultLabel })
      setTimeout(() => { particles.value = particles.value.filter((p) => p.id !== id) }, type === 'dust' ? 650 : type === 'ultimate' ? 900 : 520)
    }

    function registerImpact(attacker, defender, { damage, blockedDamage, force, kind, color }) {
      const blocked = defender.block
      defender.health = clamp(defender.health - (blocked ? blockedDamage : damage), 0, 100)
      defender.hit = !blocked
      defender.moving = false
      defender.meter = clamp(defender.meter + (blocked ? 5 : 12), 0, 100)
      attacker.meter = clamp(attacker.meter + (blocked ? 5 : kind === 'ultimate' ? 0 : 20), 0, 100)
      defender.x = clamp(defender.x + attacker.facing * (blocked ? 1.2 : force), 8, 88)
      shake.value = true
      contactFlash.value = true
      hitStopUntil = performance.now() + (blocked ? 45 : kind === 'ultimate' ? 165 : kind === 'kick' ? 105 : 75)
      burst((attacker.x + defender.x) / 2, blocked ? '#82f7ff' : color, blocked ? 'block' : kind === 'ultimate' ? 'ultimate' : 'hit')
      if (!blocked) {
        attacker.combo += 1
        defender.combo = 0
        setTimeout(() => { attacker.combo = 0 }, kind === 'ultimate' ? 1350 : 950)
      }
      beep(blocked ? 240 : kind === 'ultimate' ? 52 : 78, blocked ? .07 : kind === 'ultimate' ? .35 : .14, blocked ? 'triangle' : 'square', kind === 'ultimate' ? .07 : .05)
      setTimeout(() => { contactFlash.value = false }, kind === 'ultimate' ? 180 : 90)
      setTimeout(() => { shake.value = false }, kind === 'ultimate' ? 430 : 210)
      setTimeout(() => { defender.hit = false }, blocked ? 140 : kind === 'ultimate' ? 650 : 360)
      if (defender.health <= 0) finishRound(attacker)
    }

    function attack(attacker, defender, kind = 'punch') {
      if (!running.value || attacker.cooldown > 0 || attacker.block || attacker.hit || attacker.ultimate) return
      attacker.attack = true
      attacker.attackKind = kind
      attacker.moving = false
      attacker.cooldown = kind === 'kick' ? 760 : 520
      beep(kind === 'kick' ? 125 : 180, .06, 'sawtooth', .025)
      setTimeout(() => {
        if (!running.value) return
        const distance = Math.abs(attacker.x - defender.x)
        const range = kind === 'kick' ? 18 : 15
        if (distance <= range && Math.abs(attacker.y - defender.y) < 24) {
          registerImpact(attacker, defender, { damage: kind === 'kick' ? 13 : 9, blockedDamage: 2, force: 3, kind, color: '#ffd32a' })
        }
      }, kind === 'kick' ? 190 : 130)
      setTimeout(() => { attacker.attack = false; attacker.attackKind = '' }, kind === 'kick' ? 470 : 340)
    }

    function useUltimate(attacker, defender) {
      if (!running.value || attacker.meter < 100 || attacker.cooldown > 0 || attacker.block || attacker.hit || attacker.attack) return
      attacker.meter = 0
      attacker.ultimate = true
      attacker.attack = true
      attacker.attackKind = 'ultimate'
      attacker.moving = false
      attacker.cooldown = 1650
      ultimateCallout.value = info(attacker).ultimate
      beep(attacker.character === 'ranger' ? 92 : 145, .3, 'sawtooth', .05)
      setTimeout(() => beep(attacker.character === 'ranger' ? 184 : 290, .24, 'square', .045), 180)
      setTimeout(() => {
        if (!running.value) return
        const distance = Math.abs(attacker.x - defender.x)
        if (distance <= 30 && Math.abs(attacker.y - defender.y) < 28) {
          registerImpact(attacker, defender, { damage: 32, blockedDamage: 8, force: 8, kind: 'ultimate', color: attacker.character === 'ranger' ? '#51d8ff' : '#ff45b5' })
        }
      }, 430)
      setTimeout(() => { ultimateCallout.value = '' }, 760)
      setTimeout(() => { attacker.ultimate = false; attacker.attack = false; attacker.attackKind = '' }, 1050)
    }

    async function finishRound(forcedWinner) {
      if (!running.value) return
      clearInterval(timerId)
      screen.value = 'roundover'
      const victor = forcedWinner || (fighters.blue.health === fighters.pink.health ? null : fighters.blue.health > fighters.pink.health ? fighters.blue : fighters.pink)
      if (victor) {
        const loser = victor === fighters.blue ? fighters.pink : fighters.blue
        victor.wins += 1
        victor.victorious = true
        loser.defeated = true
        loser.hit = false
        loser.attack = false
        loser.ultimate = false
        winnerSide.value = victor.side
        banner.value = 'K.O.'
        beep(70, .5, 'sawtooth', .05)
        await sleep(800)
        winner.value = victor.wins >= 2 ? `${victor.name} WINS THE MATCH` : `${victor.name} TAKES THE ROUND`
      } else {
        fighters.blue.defeated = true
        fighters.pink.defeated = true
        banner.value = 'DRAW'
        winner.value = 'EVENLY MATCHED'
      }
    }

    function keydown(event) {
      const key = event.key.toLowerCase()
      if (['a','d','w','f','g','r','arrowleft','arrowright','arrowup','/','.','enter',' '].includes(key)) event.preventDefault()
      pressed.add(key)
      if (event.repeat || !running.value) return
      if (key === 'w') jump(fighters.blue)
      if (key === 'f') attack(fighters.blue, fighters.pink, 'punch')
      if (key === ' ') attack(fighters.blue, fighters.pink, 'kick')
      if (key === 'g') setBlock(fighters.blue, true)
      if (key === 'r') useUltimate(fighters.blue, fighters.pink)
      if (mode.value === 'versus') {
        if (key === 'arrowup') jump(fighters.pink)
        if (key === '/') attack(fighters.pink, fighters.blue, 'punch')
        if (key === '.') setBlock(fighters.pink, true)
        if (key === 'enter') useUltimate(fighters.pink, fighters.blue)
      }
    }

    function keyup(event) {
      const key = event.key.toLowerCase()
      pressed.delete(key)
      if (key === 'g') setBlock(fighters.blue, false)
      if (key === '.') setBlock(fighters.pink, false)
    }

    function mobileAction(action, active = true) {
      if (action === 'left' || action === 'right') active ? pressed.add(`touch-${action}`) : pressed.delete(`touch-${action}`)
      if (!active) return
      if (action === 'jump') jump(fighters.blue)
      if (action === 'hit') attack(fighters.blue, fighters.pink, 'punch')
      if (action === 'kick') attack(fighters.blue, fighters.pink, 'kick')
      if (action === 'block') setBlock(fighters.blue, true)
      if (action === 'ultimate') useUltimate(fighters.blue, fighters.pink)
    }

    function loop(now) {
      const dt = Math.min((now - last) / 16.67, 2)
      last = now
      if (now < hitStopUntil) { frame = requestAnimationFrame(loop); return }
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
          fighter.meter = clamp(fighter.meter + .009 * dt, 0, 100)
          if (fighter.moving && now > fighter.movingUntil) fighter.moving = false
          if (fighter.y > 0 || fighter.vy > 0) {
            const wasAirborne = fighter.y > 0
            fighter.y = Math.max(0, fighter.y + fighter.vy * .55 * dt)
            fighter.vy -= 1.75 * dt
            if (fighter.y === 0) { fighter.vy = 0; if (wasAirborne) burst(fighter.x, '#d9c982', 'dust') }
          }
        }
        if (mode.value === 'cpu') {
          aiClock -= 16.67 * dt
          if (aiClock <= 0) {
            aiClock = 150 + Math.random() * 220
            const gap = fighters.blue.x - fighters.pink.x
            const distance = Math.abs(gap)
            fighters.pink.block = false
            if (fighters.pink.meter >= 100 && distance < 28) useUltimate(fighters.pink, fighters.blue)
            else if (fighters.blue.attack && distance < 18 && Math.random() > .35) {
              fighters.pink.block = true
              setTimeout(() => { fighters.pink.block = false }, 380)
            } else if (distance > 14) move(fighters.pink, Math.sign(gap), 2.4)
            else if (Math.random() > .25) attack(fighters.pink, fighters.blue, Math.random() > .65 ? 'kick' : 'punch')
            else if (Math.random() > .75) jump(fighters.pink)
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

    return { screen, mode, time, round, banner, winner, winnerSide, fighters, particles, shake, contactFlash, ultimateCallout, selection, characterList, info, fighterFlip, openSelect, chooseCharacter, beginMatch, nextRound, mobileAction, setBlock, useUltimate }
  },
  template: `
    <main class="game-shell">
      <section class="topline"><div><span class="live-dot"></span> KAMPUNG ARCADE // MATCH 01</div><button class="sound-note" aria-label="Sound enabled">SOUND ON</button></section>
      <section class="stage" :class="{ shake, 'contact-flash': contactFlash, 'round-finished': screen === 'roundover' }" aria-label="Garden Clash fighting arena">
        <div class="sun"></div><div class="cloud cloud-a"></div><div class="cloud cloud-b"></div><div class="mountain mountain-a"></div><div class="mountain mountain-b"></div><div class="tree-line"></div><div class="fence"></div><div class="ground-lines"></div>
        <header class="hud" v-if="!['intro','select'].includes(screen)">
          <div class="fighter-hud left-hud"><div class="identity"><strong>{{ fighters.blue.name }}</strong><small>{{ info(fighters.blue).title }}</small></div><div class="health-track"><span :style="{ width: fighters.blue.health + '%' }"></span></div><div class="ultimate-meter" :class="{ ready: fighters.blue.meter >= 100 }"><b>ULT</b><i :style="{ width: fighters.blue.meter + '%' }"></i><em>{{ Math.floor(fighters.blue.meter) }}%</em></div><div class="round-pips"><i v-for="n in 2" :key="n" :class="{ won: fighters.blue.wins >= n }"></i></div></div>
          <div class="timer"><small>ROUND {{ round }}</small><strong>{{ time }}</strong></div>
          <div class="fighter-hud right-hud"><div class="identity"><strong>{{ fighters.pink.name }}</strong><small>{{ info(fighters.pink).title }}</small></div><div class="health-track"><span :style="{ width: fighters.pink.health + '%' }"></span></div><div class="ultimate-meter" :class="{ ready: fighters.pink.meter >= 100 }"><b>ULT</b><i :style="{ width: fighters.pink.meter + '%' }"></i><em>{{ Math.floor(fighters.pink.meter) }}%</em></div><div class="round-pips"><i v-for="n in 2" :key="n" :class="{ won: fighters.pink.wins >= n }"></i></div></div>
        </header>
        <div class="stage-title" v-if="screen === 'intro'"><p>AN IJOI GAMES ORIGINAL</p><h1>GARDEN<br><em>CLASH</em></h1><div class="slash"></div><p class="tagline">Two friends. One trail. Zero chill.</p><div class="mode-picker"><button @click="openSelect('cpu')"><span>1P</span> VS CPU</button><button @click="openSelect('versus')"><span>2P</span> LOCAL VERSUS</button></div><small class="start-hint">Choose any fighter · mirror matches allowed · best of 3</small></div>
        <div class="character-select" v-if="screen === 'select'">
          <div class="select-heading"><small>BUILD YOUR MATCH</small><h2>CHOOSE FIGHTERS</h2><p>Same-character battles are allowed.</p></div>
          <div class="select-grid"><section class="select-slot blue-select"><b>PLAYER 1</b><div class="character-cards"><button v-for="char in characterList" :key="'blue-' + char.id" :class="['character-card','char-' + char.id,{ selected: selection.blue === char.id }]" @click="chooseCharacter('blue', char.id)"><i></i><strong>{{ char.name }}</strong><small>{{ char.ultimate }}</small></button></div></section><div class="versus-mark">VS</div><section class="select-slot pink-select"><b>{{ mode === 'cpu' ? 'CPU' : 'PLAYER 2' }}</b><div class="character-cards"><button v-for="char in characterList" :key="'pink-' + char.id" :class="['character-card','char-' + char.id,{ selected: selection.pink === char.id }]" @click="chooseCharacter('pink', char.id)"><i></i><strong>{{ char.name }}</strong><small>{{ char.ultimate }}</small></button></div></section></div>
          <div class="select-actions"><button class="back-btn" @click="screen = 'intro'">BACK</button><button class="battle-btn" @click="beginMatch">START BATTLE</button></div>
        </div>
        <div class="ultimate-callout" v-if="ultimateCallout"><small>ULTIMATE WEAPON</small><strong>{{ ultimateCallout }}</strong></div><div class="banner" v-if="banner"><span>{{ banner }}</span></div>
        <div class="round-result" v-if="screen === 'roundover' && winner"><small v-if="winnerSide">{{ info(fighters[winnerSide]).ultimate }} VICTORY</small><p>{{ winner }}</p><div><button @click="nextRound">{{ fighters.blue.wins >= 2 || fighters.pink.wins >= 2 ? 'REMATCH' : 'NEXT ROUND' }}</button><button class="change-btn" @click="openSelect(mode)">CHANGE FIGHTERS</button></div></div>
        <div v-for="p in particles" :key="p.id" class="hit-burst" :class="'burst-' + p.type" :style="{ left: p.x + '%', '--burst': p.color }"><i></i><span>{{ p.label }}</span></div>
        <div v-for="(fighter, side) in fighters" :key="side" :class="['fighter','fighter-' + side,'char-' + fighter.character,{ attacking: fighter.attack, punching: fighter.attackKind === 'punch', kicking: fighter.attackKind === 'kick', ulting: fighter.ultimate, blocking: fighter.block, hurt: fighter.hit, moving: fighter.moving, jumping: fighter.y > 0, defeated: fighter.defeated, victorious: fighter.victorious }]" :style="{ left: fighter.x + '%', bottom: (7 + fighter.y * .45) + '%', '--flip': fighterFlip(fighter), '--ko-flip': side === 'blue' ? 1 : -1 }"><div class="fighter-shadow"></div><div class="motion-trail"></div><div class="sprite" role="img" :aria-label="fighter.name"></div><div class="ultimate-sprite"></div><div class="ko-sprite"></div><span class="face-lines">!</span><span class="combo" v-if="fighter.combo > 1">{{ fighter.combo }} HIT COMBO</span><span class="guard-effect">GUARD</span><span class="victory-aura" v-if="fighter.victorious">WINNER</span></div>
        <div class="stage-label">STAGE 01 <strong>THE BACKYARD</strong></div>
      </section>
      <section class="controls" v-if="!['intro','select'].includes(screen)"><div class="control-card blue-card"><b>P1 · {{ fighters.blue.name }}</b><span><kbd>A</kbd><kbd>D</kbd> MOVE · <kbd>W</kbd> JUMP · <kbd>F</kbd> PUNCH · <kbd>SPACE</kbd> KICK · <kbd>G</kbd> BLOCK · <kbd>R</kbd> ULT</span></div><div class="control-card pink-card" v-if="mode === 'versus'"><b>P2 · {{ fighters.pink.name }}</b><span><kbd>←</kbd><kbd>→</kbd> MOVE · <kbd>↑</kbd> JUMP · <kbd>/</kbd> PUNCH · <kbd>.</kbd> BLOCK · <kbd>ENTER</kbd> ULT</span></div><div class="control-card pink-card" v-else><b>CPU · {{ fighters.pink.name }}</b><span>Charges and activates its ultimate weapon automatically.</span></div></section>
      <section class="mobile-controls" v-if="screen === 'fight'" aria-label="Touch controls"><div class="dpad"><button @pointerdown="mobileAction('left')" @pointerup="mobileAction('left', false)" @pointerleave="mobileAction('left', false)">←</button><button @pointerdown="mobileAction('right')" @pointerup="mobileAction('right', false)" @pointerleave="mobileAction('right', false)">→</button></div><button class="jump-btn" @pointerdown="mobileAction('jump')">JUMP</button><button class="hit-btn" @pointerdown="mobileAction('hit')">HIT</button><button class="kick-btn" @pointerdown="mobileAction('kick')">KICK</button><button class="block-btn" @pointerdown="mobileAction('block')" @pointerup="setBlock(fighters.blue, false)" @pointerleave="setBlock(fighters.blue, false)">BLOCK</button><button class="ult-btn" :class="{ ready: fighters.blue.meter >= 100 }" :disabled="fighters.blue.meter < 100" @pointerdown="mobileAction('ultimate')">ULT</button></section>
    </main>
  `
}).mount('#app')
