import { sb } from './supabase.js';
import { config } from './config.js';
import { EventEmitter } from 'node:events';

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['C', 'D', 'H', 'S'];

export const PAIR_ORDER = { ALL: 0, ED: 1, DD: 2, ST: 3, DT: 4, DL: 5, SL: 6, PS: 7, FL: 8, FH: 9, BK: 10 };

export const MULTIPLIERS = { andar: 1.9, bahar: 1.9, tie: 8.2 };

const PHASES = ['idle', 'betting', 'result', 'reset'];

export class GameEngine extends EventEmitter {
  constructor(nowProvider = Date.now) {
    super();
    this.now = nowProvider;
    this.round = null;          // current round data
    this.roundNumber = 0;
    this.phase = 'idle';        // idle | betting | result | reset | completed
    this.phaseEndsAt = 0;
    this.deck = [];
    this.discards = [];
    this.joker = null;
    this.dealt = [];
    this.timer = null;
    this.roundSeq = 0;
    this.reset();
  }

  get totalRoundSeconds() {
    return this.config().bettingTime + this.config().resultTime + this.config().resetTime; // 30
  }

  config() { return config; }

  /** Start the perpetual 30s round loop. */
  start() {
    if (this.timer) return;
    this.startNextRound();
    this.timer = setInterval(() => this.tick(), 250);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async startNextRound() {
    this.roundNumber += 1;
    this.roundSeq += 1;
    this.phase = 'betting';
    this.phaseEndsAt = this.now() + config.bettingTime * 1000;
    this.shuffleDeck();

    this.round = {
      roundId: this.makeRoundId(),
      roundNumber: this.roundNumber,
      status: 'betting',
      joker: null,
      winner: null,
      winningRank: null,
      startedAt: new Date().toISOString(),
      bettingUntil: new Date(this.phaseEndsAt).toISOString(),
      resultAt: null,
      nextRoundAt: null,
    };

    try {
      await sb.from('game_rounds').insert({
        id: this.round.roundId,
        status: 'betting',
        betting_until: this.round.bettingUntil,
      });
    } catch (e) {
      console.error('round insert failed', e.message);
    }

    this.broadcastState('round_started');
  }

  async tick() {
    const now = this.now();
    switch (this.phase) {
      case 'betting':
        if (now >= this.phaseEndsAt) await this.beginResult();
        break;
      case 'result':
        if (now >= this.phaseEndsAt) await this.beginReset();
        break;
      case 'reset':
        if (now >= this.phaseEndsAt) await this.startNextRound();
        break;
    }
  }

  // ---------------- Betting -> Result ----------------
  async beginResult() {
    this.phase = 'result';
    this.phaseEndsAt = this.now() + config.resultTime * 1000;

    // Draw the joker (first card, face up) and then deal until match.
    this.joker = this.drawCard();
    this.dealt = [];
    let andarCount = 0;
    let baharCount = 0;
    let winner = null;
    let matchRank = this.joker.rank;

    // Joker counts as the base; cards alternate A(andar), B(bahar).
    andarCount += 1; // joker conceptually on Andar base per Andar-Bahar rules
    let turn = 'andar';

    while (this.deck.length > 0) {
      const card = this.drawCard();
      this.dealt.push(card);
      if (turn === 'andar') { andarCount += 1; turn = 'bahar'; }
      else { baharCount += 1; turn = 'andar'; }

      if (card.rank === matchRank) {
        winner = turn === 'bahar' ? 'andar' : null; // placeholder replaced below
        // The matching card lands on a side; the round is won by that side.
        winner = this.lastSide(); // side the matched card was dealt to
        break;
      }
    }

    if (!winner) winner = 'bahar'; // deck exhausted fallback (rare)

    const bets = await this.loadBets(this.round.roundId);
    await this.settleBets(bets, winner, matchRank);

    this.round.status = 'result';
    this.round.joker = this.joker;
    this.round.winner = winner;
    this.round.winningRank = matchRank;
    this.round.resultAt = new Date().toISOString();
    this.round.andarCards = andarCount;
    this.round.baharCards = baharCount;
    this.round.dealtCards = this.dealt.map(c => c.label);

    await sb.from('game_rounds').update({
      status: 'result',
      joker_rank: matchRank,
      winner,
      winning_rank: matchRank,
      result_at: this.round.resultAt,
    }).eq('id', this.round.roundId);

    this.broadcastState('result');
  }

  lastSide() {
    // The side the LAST dealt card was placed on.
    const lastTurn = this.dealt.length % 2 === 0 ? 'andar' : 'bahar';
    return lastTurn;
  }

  async settleBets(bets, winner, matchRank) {
    for (const bet of bets) {
      const won = bet.option === winner;
      if (won) {
        const payout = Number(bet.amount) * MULTIPLIERS[bet.option];
        await sb.rpc('settle_bet', { p_bet_id: bet.id, p_status: 'won', p_payout: payout });
      } else if (bet.option === 'tie' && winner === 'tie') {
        const payout = Number(bet.amount) * MULTIPLIERS.tie;
        await sb.rpc('settle_bet', { p_bet_id: bet.id, p_status: 'won', p_payout: payout });
      } else {
        await sb.rpc('settle_bet', { p_bet_id: bet.id, p_status: 'lost', p_payout: 0 });
      }
    }
  }

  // ---------------- Result -> Reset ----------------
  async beginReset() {
    this.phase = 'reset';
    this.phaseEndsAt = this.now() + config.resetTime * 1000;

    this.round.status = 'completed';
    this.round.nextRoundAt = new Date(this.phaseEndsAt).toISOString();

    await sb.from('game_rounds').update({
      status: 'completed',
      next_round_at: this.round.nextRoundAt,
      completed_at: new Date().toISOString(),
    }).eq('id', this.round.roundId);

    this.broadcastState('reset');
  }

  // ---------------- Helpers ----------------
  shuffleDeck() {
    this.deck = [];
    for (const s of SUITS) {
      for (let r = 1; r <= 13; r++) {
        this.deck.push({ rank: r, suit: s, label: RANKS[r - 1] + s });
      }
    }
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  drawCard() {
    return this.deck.pop();
  }

  makeRoundId() {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `AB-${yyyy}${mm}${dd}-${String(this.roundSeq).padStart(4, '0')}`;
  }

  async loadBets(roundId) {
    const { data, error } = await sb
      .from('bets')
      .select('*')
      .eq('round_id', roundId)
      .eq('status', 'pending');
    if (error) { console.error(error.message); return []; }
    return data;
  }

  /** Single source of truth pushed to all clients every phase change. */
  snapshot() {
    const secsLeft = Math.max(0, Math.ceil((this.phaseEndsAt - this.now()) / 1000));
    return {
      service: 'andar-bahar',
      type: 'state',
      roundId: this.round?.roundId ?? null,
      roundNumber: this.round?.roundNumber ?? this.roundNumber,
      phase: this.phase,                 // idle | betting | result | reset
      phaseSeconds: this.totalRoundSeconds,
      remainingSeconds: secsLeft,
      bettingTime: config.bettingTime,
      resultTime: config.resultTime,
      resetTime: config.resetTime,
      joker: this.joker ? this.joker.label : null,
      winner: this.round?.winner ?? null,
      winningRank: this.round?.winningRank != null ? RANKS[this.round.winningRank - 1] : null,
      dealtCards: this.round?.dealtCards ?? [],
      andarCards: this.round?.andarCards ?? 0,
      baharCards: this.round?.baharCards ?? 0,
      serverTime: new Date().toISOString(),
      nextRoundAt: this.round?.nextRoundAt ?? null,
    };
  }

  broadcastState(name) {
    this.emit('broadcast', { type: name, ...this.snapshot() });
  }
}