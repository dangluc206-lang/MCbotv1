'use strict';
// ProfileDomain: thin composition over BotProfileUseCases (no logic move).
class ProfileDomain {
  constructor({ botProfileUseCases } = {}) {
    if (!botProfileUseCases) throw new TypeError('ProfileDomain needs botProfileUseCases.');
    this.botProfileUseCases = botProfileUseCases;
  }
  list() { return this.botProfileUseCases.list(); }
  update(b, f) { return this.botProfileUseCases.update(b, f); }
  create(f) { return this.botProfileUseCases.create(f); }
  clone(b, n) { return this.botProfileUseCases.clone(b, n); }
  remove(b) { return this.botProfileUseCases.remove(b); }
}
module.exports = ProfileDomain;
