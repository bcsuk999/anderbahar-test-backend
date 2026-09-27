import { pool } from './db.js';
import { config } from './config.js';
import { EventEmitter } from 'node:events';

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['C', 'D', 'H', 'S'];

export const MULTIPLIERS = { andar: 1.9, bahar: 1.9, tie: 8.2 };

export const PHASES = ['idle', 'betting', 'result', 'reset'];

export class GameEngine extends EventEmitter {
  constructor(nowProvider = Date.now) {
    super();
    this.now = nowProvider;
    this.round = null;
    this.roundNumber = 0;
    this.phase = 'idle';
    this.phaseEndsAt = 0;
    this.deck = [];
    this.joker = null;
    this.dealt = [];
    this.timer = null;
    this.roundSeq = 0;
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
    this.phase = 'betting';
    this.phaseEndsAt = this.now() + config.bettingTime * 1000;
    this.shuffleDeck();
    this.joker = null;
    this.dealt = [];

    const bettingUntil = new Date(this.phaseEndsAt).toISOString();

    try {
      const r = await pool.query(`select nextval('public.round_seq') as seq`);
      this.roundSeq = Number(r.rows[0].seq);
    } catch (e) {
      this.roundSeq += 1;
    }

    const roundId = this.makeRoundId();

    this.round = {
      roundId,
      roundNumber: this.roundNumber,
      status: 'betting',
      joker: null,
      winner: null,
      winningRank: null,
      startedAt: new Date().toISOString(),
      bettingUntil,
      resultAt: null,
      nextRoundAt: null,
    };

    try {
      await pool.query(
        `insert into public.game_rounds (id, status, betting_until) values ($1, 'betting', $2)`,
        [roundId, bettingUntil],
      );
    } catch (e) {
      console.error('round insert failed', e.message);
    }

    this.broadcastState('round_started');
  }

  async tick() {
    const now = this.now();
    try {
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
    } catch (e) {
      console.error('tick error:', e.message);
    }
  }

  // ---------------- Betting -> Result ----------------
  async beginResult() {
    this.phase = 'result';
    this.phaseEndsAt = this.now() + config.resultTime * 1000;

    // Joker is the first card (center). Deal alternates starting on Andar.
    // A card matching the joker's rank ends the round:
    //   - lands on Andar's deal (odd count)        -> Andar wins
    //   - lands on Bahar's deal (even count)       -> counts are equal -> TIE
    //     (Andar/Bahar refunded, TIE pays 8.2)
    this.joker = this.drawCard();
    this.dealt = [];
    let andarCount = 0;
    let baharCount = 0;
    let matchRank = this.joker.rank;
    let winner = null;

    let turn = 'andar';
    while (this.deck.length > 0) {
      const card = this.drawCard();
      this.dealt.push(card);
      if (turn === 'andar') { andarCount += 1; turn = 'bahar'; }
      else { baharCount += 1; turn = 'andar'; }

      if (card.rank === matchRank) {
        winner = this.dealt.length % 2 === 0 ? 'tie' : 'andar';
        break;
      }
    }
    if (!winner) winner = 'andar'; // deck exhausted (practically impossible with 52 cards)

    await this.settleBets(winner, matchRank);

    this.round.status = 'result';
    this.round.joker = this.joker;
    this.round.winner = winner;
    this.round.winningRank = matchRank;
    this.round.resultAt = new Date().toISOString();
    this.round.andarCards = andarCount;
    this.round.baharCards = baharCount;
    this.round.dealtCards = this.dealt.map(c => c.label);

    try {
      await pool.query(
        `update public.game_rounds
            set status = 'result', joker_rank = $2, winner = $3, winning_rank = $4, result_at = $5
          where id = $1`,
        [this.round.roundId, matchRank, winner, matchRank, this.round.resultAt],
      );
    } catch (e) {
      console.error('round update failed', e.message);
    }

    this.broadcastState('result');
  }

  async settleBets(winner, matchRank) {
    const { rows: bets } = await pool.query(
      `select id, user_id, option, amount from public.bets
        where round_id = $1 and status = 'pending'`,
      [this.round.roundId],
    );

    for (const bet of bets) {
      if (winner === 'tie') {
        if (bet.option === 'tie') {
          const payout = Number(bet.amount) * MULTIPLIERS.tie;
          await pool.query(`select public.settle_bet_sql($1, 'won', $2)`, [bet.id, payout]);
        } else {
          // Andar / Bahar bets are REFUNDED on a draw (per official rules).
          await pool.query(`select public.refund_bet_sql($1)`, [bet.id]);
        }
      } else {
        const won = bet.option === winner;
        const payout = won ? Number(bet.amount) * MULTIPLIERS[bet.option] : 0;
        await pool.query(
          `select public.settle_bet_sql($1, $2, $3)`,
          [bet.id, won ? 'won' : 'lost', payout],
        );
      }
    }
  }

  // ---------------- Result -> Reset ----------------
  async beginReset() {
    this.phase = 'reset';
    this.phaseEndsAt = this.now() + config.resetTime * 1000;

    this.round.status = 'completed';
    this.round.nextRoundAt = new Date(this.phaseEndsAt).toISOString();

    try {
      await pool.query(
        `update public.game_rounds
            set status = 'completed', next_round_at = $2, completed_at = now()
          where id = $1`,
        [this.round.roundId, this.round.nextRoundAt],
      );
    } catch (e) {
      console.error('round complete update failed', e.message);
    }

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

  /** Single source of truth pushed to all clients each phase change. */
  snapshot() {
    const nowMs = this.now();
    const secsLeft = Math.max(0, Math.ceil((this.phaseEndsAt - nowMs) / 1000));
    return {
      service: 'andar-bahar',
      type: 'state',
      roundId: this.round?.roundId ?? null,
      roundNumber: this.round?.roundNumber ?? this.roundNumber,
      phase: this.phase,
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
      serverTime: nowMs,
      serverTimeISO: new Date(nowMs).toISOString(),
      phaseEndsAtMs: this.phaseEndsAt,
      nextRoundAtMs: this.round?.nextRoundAt ? Date.parse(this.round.nextRoundAt) : null,
      nextRoundAt: this.round?.nextRoundAt ?? null,
    };
  }

  broadcastState(name) {
    this.emit('broadcast', { ...this.snapshot(), type: name });
  }
}