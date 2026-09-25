'use strict';

const LearningProjection = require('../shared/learningProjection');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildLearningSnapshot(events) {
  let generation = 0;
  const active = new Map();
  const undone = new Set();

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    if (event.type === 'reset') {
      generation += 1;
      active.clear();
      undone.clear();
      continue;
    }
    if (event.type === 'reset_opponent') {
      const opponent = String(event.payload && event.payload.opponent || '').toUpperCase();
      if (opponent) {
        for (const [id, activeEvent] of active) {
          const activeOpponent = String(
            activeEvent.payload && (activeEvent.payload.learningEvent || activeEvent.payload).opponent || '',
          ).toUpperCase();
          if (activeOpponent === opponent) active.delete(id);
        }
      }
      continue;
    }
    if (event.type === 'undo') {
      undone.add(event.payload && event.payload.eventId);
      active.delete(event.payload && event.payload.eventId);
      continue;
    }
    if (event.type === 'snap_correction') {
      for (const [id, prior] of active) {
        if (event.payload?.captureId && prior.payload?.captureId === event.payload.captureId) active.delete(id);
      }
      if (!event.payload?.learningEvent) continue;
    }
    if (event.type === 'snap' || event.type === 'snap_correction' || event.type === 'observation' || event.type === 'feedback') {
      if (!undone.has(event.id)) active.set(event.id, clone(event));
    }
  }

  const samples = Array.from(active.values());
  const projected = LearningProjection.projectEvents(samples.map((event) => {
    const value = clone(event.payload && (event.payload.learningEvent || event.payload) || {});
    if (!value.id) value.id = event.id;
    if (!value.at) value.at = event.at;
    return value;
  }).filter((event) => event.verification && event.verification.learningEligible !== false));
  return {
    ...projected,
    version: 1,
    generation,
    eventCount: events.length,
    samples,
  };
}

class EventLedger {
  constructor(options = {}) {
    if (!options.userData) throw new TypeError('userData is required');
    this.fs = options.fs || require('node:fs/promises');
    this.path = options.path || require('node:path');
    this.userData = options.userData;
    this.ledgerPath = this.path.join(this.userData, options.ledgerFile || 'dc-snap-log-v1.jsonl');
    this.snapshotPath = this.path.join(this.userData, options.snapshotFile || 'dc-learning-v1.json');
    this.now = options.now || (() => Date.now());
    this.randomUUID = options.randomUUID || require('node:crypto').randomUUID;
    this._queue = Promise.resolve();
  }

  async initialize() {
    await this.fs.mkdir(this.userData, { recursive: true });
    await this.fs.appendFile(this.ledgerPath, '', 'utf8');
    return this.rebuild();
  }

  async readEvents() {
    let text;
    try {
      text = await this.fs.readFile(this.ledgerPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid event ledger JSON on line ${index + 1}: ${error.message}`);
      }
    });
  }

  append(type, payload = {}) {
    if (!type || typeof type !== 'string') return Promise.reject(new TypeError('event type is required'));
    return this._serialize(async () => {
      const event = {
        version: 1,
        id: this.randomUUID(),
        type,
        at: this.now(),
        payload: clone(payload),
      };
      await this.fs.mkdir(this.userData, { recursive: true });
      await this.fs.appendFile(this.ledgerPath, `${JSON.stringify(event)}\n`, 'utf8');
      const events = await this.readEvents();
      const snapshot = buildLearningSnapshot(events);
      await this._writeSnapshot(snapshot);
      return { event: clone(event), snapshot: clone(snapshot) };
    });
  }

  recordObservation(payload) {
    return this.append('observation', payload);
  }

  recordSnap(payload) {
    return this.append('snap', payload);
  }

  correctSnap(payload) {
    if (!payload?.captureId) return Promise.reject(new TypeError('captureId is required'));
    return this.append('snap_correction', payload);
  }

  recordFeedback(payload) {
    return this.append('feedback', payload);
  }

  undo(eventId) {
    if (!eventId) return Promise.reject(new TypeError('eventId is required'));
    return this.append('undo', { eventId });
  }

  reset(reason = 'user') {
    return this.append('reset', { reason });
  }

  resetOpponent(opponent) {
    if (!opponent) return Promise.reject(new TypeError('opponent is required'));
    return this.append('reset_opponent', { opponent: String(opponent).toUpperCase() });
  }

  rebuild() {
    return this._serialize(async () => {
      const snapshot = buildLearningSnapshot(await this.readEvents());
      await this._writeSnapshot(snapshot);
      return clone(snapshot);
    });
  }

  async getSnapshot() {
    try {
      return JSON.parse(await this.fs.readFile(this.snapshotPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return this.rebuild();
    }
  }

  async exportTo(destination) {
    if (!destination) throw new TypeError('destination is required');
    const data = {
      version: 1,
      exportedAt: this.now(),
      events: await this.readEvents(),
      snapshot: await this.getSnapshot(),
    };
    await this._writeAtomic(destination, data);
    return { destination, eventCount: data.events.length };
  }

  _serialize(operation) {
    const result = this._queue.then(operation, operation);
    this._queue = result.catch(() => {});
    return result;
  }

  _writeSnapshot(snapshot) {
    return this._writeAtomic(this.snapshotPath, snapshot);
  }

  async _writeAtomic(destination, value) {
    await this.fs.mkdir(this.path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${this.randomUUID()}.tmp`;
    try {
      await this.fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await this.fs.rename(temporary, destination);
    } catch (error) {
      await this.fs.unlink(temporary).catch(() => {});
      throw error;
    }
  }
}

module.exports = {
  EventLedger,
  buildLearningSnapshot,
};
