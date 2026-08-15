'use strict';

class ConnectionFactory {
    constructor({ botFactory }) {
        if (!botFactory || typeof botFactory.create !== 'function') {
            throw new TypeError('botFactory.create is required');
        }
        this.botFactory = botFactory;
    }

    create(profile, server) {
        if (!profile || typeof profile !== 'object') {
            throw new TypeError('profile is required');
        }
        if (!server || typeof server !== 'object') {
            throw new TypeError('server configuration is required');
        }

        const options = {
            host: server.host,
            port: server.port,
            username: profile.username,
            auth: profile.auth ?? server.auth ?? 'offline',
            version: profile.version !== undefined
                ? profile.version
                : (server.version ?? false)
        };

        if (profile.password) options.password = profile.password;

        return this.botFactory.create(options);
    }
}

module.exports = ConnectionFactory;
