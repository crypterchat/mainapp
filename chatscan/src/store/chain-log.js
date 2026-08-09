import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Append-only log of chain events. Every accepted record and every sealed block
 * is appended as one JSON line, so a node can be rebuilt by replaying the file
 * in order.
 */
export class ChainLog {
  /**
   * @param {object} options
   * @param {string} options.filePath
   * @param {boolean} [options.enabled]
   */
  constructor({ filePath, enabled = true }) {
    this.filePath = filePath;
    this.enabled = enabled;
    /** @type {Promise<void>} */
    this.queue = Promise.resolve();
  }

  /** Replays the log, oldest event first. @returns {object[]} */
  read() {
    if (!this.enabled || !fs.existsSync(this.filePath)) return [];
    const raw = fs.readFileSync(this.filePath, 'utf8');
    const events = [];
    for (const [index, line] of raw.split('\n').entries()) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed));
      } catch {
        throw new Error(`Corrupt chain log at ${this.filePath}:${index + 1}`);
      }
    }
    return events;
  }

  /**
   * Appends one event. Writes are serialised so log order matches accept order.
   * @param {object} event
   * @returns {Promise<void>}
   */
  append(event) {
    if (!this.enabled) return Promise.resolve();
    const line = `${JSON.stringify(event)}\n`;
    this.queue = this.queue
      .then(async () => {
        await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
        await fsp.appendFile(this.filePath, line, 'utf8');
      })
      .catch((error) => {
        process.emitWarning(`ChatScan chain log write failed: ${error.message}`);
      });
    return this.queue;
  }

  /** Resolves once every queued append has been flushed. */
  flush() {
    return this.queue;
  }
}
