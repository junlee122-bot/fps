/**
 * src/core/events.js — 단일 이벤트 버스.
 *
 * ARCHITECTURE.md §3의 어휘에 없는 이벤트는 발행할 수 없다 (throw).
 * 서브시스템 간 직접 import 금지 — 통신은 이 버스로만 한다.
 */

/** ARCHITECTURE.md §3 이벤트 어휘. 신규 이벤트는 계약 변경 제안을 거친다 */
export const EVENT_VOCABULARY = Object.freeze([
  'weapon:fire',
  'weapon:reload:begin',
  'weapon:reload:end',
  'weapon:ads',

  'ballistic:hit',
  'ballistic:penetrate',
  'ballistic:stop',

  'surface:damage',
  'surface:breach',
  'surface:opacity',

  'light:transient',
  'audio:impact',
  'audio:occlusion',

  'actor:damage',
  'actor:death',

  'world:tod',
  'world:weather',
]);

const VOCAB = new Set(EVENT_VOCABULARY);

class EventBus {
  constructor() {
    this._handlers = new Map();
  }

  on(type, fn) {
    if (!VOCAB.has(type)) throw new Error(`event not in vocabulary: ${type}`);
    let list = this._handlers.get(type);
    if (!list) {
      list = [];
      this._handlers.set(type, list);
    }
    list.push(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const list = this._handlers.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit(type, payload) {
    if (!VOCAB.has(type)) throw new Error(`event not in vocabulary: ${type}`);
    const list = this._handlers.get(type);
    if (!list) return;
    // 발행 중 구독 변경에 흔들리지 않도록 스냅샷 순회 (결정적 순서)
    const snapshot = list.slice();
    for (let i = 0; i < snapshot.length; i++) snapshot[i](payload);
  }

  clearAll() {
    this._handlers.clear();
  }

  /** 부팅 완료 시점의 구독 스냅샷 (감사 A4) */
  markBoot() {
    this._bootCounts = new Map();
    for (const [type, list] of this._handlers) this._bootCounts.set(type, list.length);
  }

  /**
   * 부팅 이후 추가된 구독을 전부 해제한다 (resetState 경로).
   * 구독은 리스트에 순서대로 append되므로 부팅 시점 길이로 절단하면 된다.
   * 페이지 재사용 플로에서 구독 누적(핸들러 n중 실행)을 막는다.
   */
  resetToBoot() {
    if (!this._bootCounts) {
      this._handlers.clear();
      return;
    }
    for (const [type, list] of this._handlers) {
      const keep = this._bootCounts.get(type) ?? 0;
      if (list.length > keep) list.length = keep;
    }
  }
}

export const bus = new EventBus();
