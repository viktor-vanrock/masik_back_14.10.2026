const { readFileSync, writeFileSync } = require('node:fs');

const target = require.resolve('kafkajs/src/network/requestQueue/index.js');
const vulnerable = `    let scheduleAt = this.throttledUntil - Date.now()
    if (!this.throttleCheckTimeoutId) {
      if (this.pending.length > 0) {
        scheduleAt = scheduleAt > 0 ? scheduleAt : CHECK_PENDING_REQUESTS_INTERVAL
      }
      this.throttleCheckTimeoutId = setTimeout(() => {
        this.throttleCheckTimeoutId = null
        this.checkPendingRequests()
      }, scheduleAt)
    }`;
const fixed = `    if (this.pending.length > 0 && !this.throttleCheckTimeoutId) {
      const scheduleAt = Math.max(
        this.throttledUntil - Date.now(),
        CHECK_PENDING_REQUESTS_INTERVAL
      )
      this.throttleCheckTimeoutId = setTimeout(() => {
        this.throttleCheckTimeoutId = null
        this.checkPendingRequests()
      }, scheduleAt)
    }`;

const source = readFileSync(target, 'utf8');
if (source.includes(fixed)) process.exit(0);
if (!source.includes(vulnerable)) {
  throw new Error(
    'Unsupported KafkaJS request queue implementation; review the local timeout patch'
  );
}
writeFileSync(target, source.replace(vulnerable, fixed));
