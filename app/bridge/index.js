/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022-2026 Toha <tohenk@yahoo.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const fs = require('fs');
const Work = require('@ntlab/work/work');
const Queue = require('@ntlab/work/queue');
const SipdLogger = require('../sipd/logger');
const SipdQueue = require('../queue');
const SipdSession = require('../session');
const SipdLpjSession = require('../session/lpj');
const SipdSppSession = require('../session/spp');
const { Sipd, SipdTimer, SipdAnnouncedError, SipdRetryError, SipdCleanAndRetryError } = require('../sipd');
const { SipdRoleSwitcher, SipdRole } = require('../sipd/role');
const { SipdLockManager } = require('./lock');
const { error } = require('selenium-webdriver');

const dtag = 'bridge';

/**
 * @typedef {Object} BridgeWorker
 * @property {BridgeSession} bp BP/BPP session
 * @property {BridgeSession} pptk PPTK session
 * @property {BridgeSession} pa PA/KPA session
 * @property {BridgeSession} ppk PPK session
 */

/**
 * @typedef {SipdLpjSession & SipdSppSession} BridgeSession
 */

/**
 * @callback BridgeWorkFunction
 * @param {BridgeWorker} w Worker
 * @returns {Promise<any>}
 */

/**
 * @typedef {{[index: number]: string | BridgeWorkFunction}} BridgeWork
 */

/**
 * Work finished callback. The callback must returns an array of works to do.
 *
 * @callback WorkFinishedCallback
 * @param {Work} w Worker object
 * @param {Error} err An error or rejection thrown
 * @returns {array}
 */

/**
 * Sipd bridge base class.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdBridge {

    STATE_NONE = 1
    STATE_SELF_TEST = 2
    STATE_OPERATIONAL = 3

    /** @type {{[key: string]: SipdSession}} */
    sessions = {}

    /**
     * Constructor.
     *
     * @param {string} name Bridge name
     * @param {object} options Options
     */
    constructor(name, options) {
        /** @type {string} */
        this.name = name;
        /** @type {object} */
        this.options = options;
        /** @type {number} */
        this.state = this.STATE_NONE;
        /** @type {boolean} */
        this.autoClose = this.options.autoClose !== undefined ? this.options.autoClose : true;
        /** @type {boolean} */
        this.singleSession = this.options.singleSession !== undefined ? this.options.singleSession : true;
        /** @type {boolean} */
        this.stopSessionEarly = this.options.stopSessionEarly !== undefined ? this.options.stopSessionEarly : true;
        this.loginfo = {
            tag: this.name,
            onError: () => SipdLogger.logger('error', this.loginfo),
        }
    }

    /**
     * Register bridge handler.
     *
     * @param {typeof SipdBridgeHandler} handler Handler
     * @returns {this}
     */
    addHandler(handlerClass) {
        const handler = new handlerClass(this);
        if (!handler instanceof SipdBridgeHandler) {
            throw new Error('Bridge handler must be instance of SipdBridgeHandler!');
        }
        for (const m of Object.getOwnPropertyNames(handler.constructor.prototype)) {
            if (m.startsWith('_') || ['constructor', 'initialize'].includes(m)) {
                continue;
            }
            if (typeof handler[m] === 'function') {
                this[m] = function(...args) {
                    return handler[m].apply(handler, args);
                }
            }
        }
        return this;
    }

    /**
     * Perform self test.
     *
     * @returns {Promise<any>}
     */
    selfTest() {
        if (this.state < this.STATE_SELF_TEST) {
            this.state = this.STATE_SELF_TEST;
        }
        const f = () => {
            this.state = this.STATE_OPERATIONAL;
            return this.state;
        }
        let role;
        const rs = SipdRoleSwitcher
            .switchTo()
            .load();
        if (Object.keys(rs.roles).length) {
            role = Object.keys(rs.roles)[0];
        }
        if (role) {
            return this.works([
                ['role', s => Promise.resolve(this.switchRole(role))],
                ['bp', s => this.doAs(SipdRole.BP)],
                ['done', s => Promise.resolve(f())],
                ['cleanup', s => s.bp.stop()],
            ], {
                done: (s, err) => {
                    return Promise.resolve(this.purgeSession(s.bp.id));
                }
            });
        } else {
            return Promise.resolve(f());
        }
    }

    /**
     * Is bridge operational?
     *
     * @returns {boolean}
     */
    isOperational() {
        return this.state === this.STATE_OPERATIONAL;
    }

    /**
     * Check if bridge has state?
     *
     * @param {string} state State
     * @returns {boolean}
     */
    hasState(state) {
        let res = false;
        for (const session of this.getSessions()) {
            if (typeof session.state()[state] !== undefined) {
                if (session.state()[state]) {
                    res = true;
                    break;
                }
            }
        }
        return res;
    }

    /**
     * Switch user role.
     *
     * @param {string} role User role
     * @param {string} unit User unit
     * @returns {boolean}
     */
    switchRole(role, unit) {
        this.rs = SipdRoleSwitcher
            .switchTo(unit)
            .load();
        if (this.rs.roles[role]) {
            this.role = role;
            /** @type {SipdRole} */
            this.roles = this.rs.roles[role];
            return true;
        }
    }

    /**
     * Get role title.
     *
     * @param {string} role Role
     * @returns {string}
     */
    getRoleTitle(role) {
        const roles = {
            [SipdRole.BP]: 'Bendahara Pengeluaran',
            [SipdRole.PA]: 'Pengguna Anggaran',
            [SipdRole.PPK]: 'PPK SKPD',
            [SipdRole.PPTK]: 'Pejabat Pelaksana Teknis Kegiatan',
        }
        return roles[role];
    }

    /**
     * Get users which has specified role.
     *
     * @param {string} role Role
     * @returns {string[]}
     */
    getUsers(role) {
        const res = [];
        if (this.rs) {
            for (const [rid, rusers] of Object.entries(this.rs.roles)) {
                if (!role || role === rid) {
                    for (const u of Object.values(rusers)) {
                        if (u.username && !res.includes(u.username)) {
                            res.push(u.username);
                        }
                    }
                }
            }
        }
        return res;
    }

    /**
     * Get user role object.
     *
     * @param {string} role 
     */
    getUser(role) {
        if (this.roles) {
            return this.roles.get(role);
        }
    }

    /**
     * Get sessions.
     *
     * @returns {SipdSession[]}
     */
    getSessions() {
        return Object.values(this.sessions);
    }

    /**
     * Get session for a name.
     *
     * @param {string} name Session name
     * @param {number} seq Session sequence
     * @param {typeof SipdSession} sessionFactory Session factory
     * @returns {SipdSession}
     */
    getSession(name, seq, sessionFactory = null) {
        name = name.replace(/\s/g, '');
        const options = {...this.options, bridge: this, loginfo: this.loginfo};
        const sess = [];
        for (const s of [options.session, name, seq ? seq.toString() : null]) {
            if (s) {
                sess.push(s);
            }
        }
        if (sess.length) {
            options.session = sess.join('-');
        }
        sessionFactory = sessionFactory ?? SipdSession;
        const sessId = options.session ? options.session : '_';
        if (this.sessions[sessId] === undefined || !this.sessions[sessId] instanceof sessionFactory) {
            const session = new sessionFactory(options);
            session.id = sessId;
            session.onStateChange(s => {
                if (typeof this.onState === 'function') {
                    this.onState(s);
                }
            });
            this.sessions[sessId] = session;
        }
        return this.sessions[sessId];
    }

    /**
     * Purge session by its id.
     *
     * @param {string} sessId Session id
     * @returns {SipdSession}
     */
    purgeSession(sessId) {
        let res;
        if (this.sessions[sessId]) {
            res = this.sessions[sessId];
            delete this.sessions[sessId];
        }

        return res;
    }

    /**
     * A proxy function for Work.works.
     *
     * @param {Array} w Work list
     * @param {object} options Work options
     * @returns {Promise<any>}
     * @see Work.works
     */
    works(w, options) {
        options = options || {};
        options.loginfo = this.loginfo;
        options.onWork = (worker, w) => {
            if (worker.name && worker.name.includes('-')) {
                const role = worker.name.substr(0, worker.name.indexOf('-'));
                if ([SipdRole.BP, SipdRole.PA, SipdRole.PPK, SipdRole.PPTK].includes(role)) {
                    this.loginfo.action = worker.name.substr(worker.name.indexOf('-') + 1);
                }
            }
        }
        return new Promise((resolve, reject) => {
            Work.works(w, options)
                .then(res => resolve(res))
                .catch(err => {
                    if (err instanceof error.WebDriverError && err.message.includes('net::ERR_CONNECTION_TIMED_OUT')) {
                        err = new SipdRetryError(err.message);
                    } else if (err instanceof error.SessionNotCreatedError) {
                        err = new SipdCleanAndRetryError(err.message);
                    } else {
                        const prefix = this.loginfo.actor && this.loginfo.action ?
                            `${this.loginfo.actor} (${this.loginfo.action}):` : null;
                        const e = err;
                        err = e instanceof Error ? e.message : `${e}`;
                        if (prefix && !err.startsWith(prefix)) {
                            err = `${prefix} ${err}`;
                        }
                        if (e instanceof Error && e.cause) {
                            err = `${err} ${e.cause.toString()}`;
                        }
                    }
                    reject(err);
                });
        });
    }

    /**
     * Clear loginfo.
     */
    clearLoginfo() {
        delete this.loginfo.actor;
        delete this.loginfo.action;
    }

    /**
     * Check if queue has a role defined.
     *
     * @param {SipdQueue} queue Queue to check
     * @returns {Promise<void>}
     */
    checkRole(queue) {
        return this.works([
            [m => Promise.resolve(queue.getMappedData('info.role'))],
            [m => Promise.reject('Invalid queue, no role specified!'), m => !m.getRes(0)],
            [m => Promise.resolve(this.switchRole(m.getRes(0), queue.getMappedData('info.unit')))],
            [m => Promise.reject(`Role not found ${m.getRes(0)}!`), m => !m.getRes(2)],
        ]);
    }

    /**
     * Do the operation as requested role and returns the session.
     *
     * @param {string} role User role
     * @param {typeof SipdSession} sessionFactory Session factory
     * @returns {Promise<SipdSession>}
     */
    doAs(role, sessionFactory = null) {
        return this.works([
            [w => this.lock.release(this.lockId), w => this.singleSession && this.lock],
            [w => Promise.resolve(this.getUser(role))],
            [w => Promise.reject(`Role not found: ${role}!`), w => !w.getRes(1)],
            [w => new Promise((resolve, reject) => {
                const user = w.getRes(1);
                let title = user.role ?? this.getRoleTitle(role);
                let idx = 0;
                const p = title.indexOf(':');
                if (p > 1) {
                    idx = parseInt(title.substr(p + 1).trim()) - 1;
                    title = title.substr(0, p);
                }
                const session = this.getSession(user.username, idx, sessionFactory);
                if (session) {
                    session.cred = {username: user.username, password: user.password, role: title, idx};
                    this.loginfo.role = role;
                    this.loginfo.actor = {
                        'Pengguna Anggaran': 'PA',
                        'Kuasa Pengguna Anggaran': 'KPA',
                        'Bendahara Pengeluaran': 'BP',
                        'Bendahara Pengeluaran Pembantu': 'BPP',
                        'PPK SKPD': 'PPK',
                        'PPK Unit SKPD': 'PPK',
                        'PPTK': 'PPTK',
                    }[title];
                    resolve(session);
                } else {
                    reject(`Unable to create session for ${user.username}!`);
                }
            })],
            [w => Promise.resolve(this.lock = SipdLockManager.get(w.getRes(1).username)),
                w => this.singleSession && this.lockId],
            [w => this.lock.acquire(this.lockId),
                w => this.singleSession && this.lock],
            [w => new Promise((resolve, reject) => {
                const session = w.getRes(3);
                const sessions = this.getSessions()
                    .filter(s => s !== session);
                const q = new Queue(sessions, s => {
                    s.stop()
                        .then(() => q.next())
                        .catch(() => q.next());
                });
                q.once('done', () => resolve());
            }), w => this.stopSessionEarly],
            [w => Promise.resolve(w.getRes(3))],
        ]);
    }

    /**
     * Perform works.
     *
     * @param {array} works The works array
     * @param {WorkFinishedCallback} callback Finished callback
     * @returns {Promise<any>}
     */
    do(works, callback = null) {
        const _works = [
            [w => Promise.resolve(this.clearLoginfo())]
        ];
        if (Array.isArray(works)) {
            _works.push(...works);
        }
        if (typeof works === 'function') {
            _works.push(works);
        }
        return this.works(_works, {
            done: (w, err) => {
                if (err instanceof SipdAnnouncedError && err._queue) {
                    const queue = err._queue;
                    const callbackQueue = SipdQueue.createCallbackQueue({id: queue.getMappedData('info.id'), error: err.message}, queue.callback);
                    SipdQueue.addQueue(callbackQueue);
                }
                if (typeof callback === 'function') {
                    return this.works(callback(w, err));
                } else {
                    if (err) {
                        return Promise.reject(err);
                    } else {
                        return Promise.resolve();
                    }
                }
            }
        });
    }

    /**
     * End session.
     *
     * @param {SipdQueue} queue Queue
     * @param {boolean} stop Stop session
     * @returns {Promise<any>}
     */
    end(queue, stop = true) {
        const works = [
            [m => Promise.resolve(this.lock.abort(queue.id)),
                m => queue.status === SipdQueue.STATUS_TIMED_OUT && this.lock]
        ];
        for (const session of Object.values(this.sessions)) {
            works.push(
                [m => session.cleanFiles(queue)],
                [m => session.stop(), m => stop],
            );
        }
        return this.works(works);
    }

    /**
     * Process queue.
     *
     * @param {object} param0 Data
     * @param {SipdQueue} param0.queue Queue
     * @param {BridgeWork[]} param0.works Works array
     * @param {Function} param0.sorter Sorter callback
     * @param {Function} param0.done Done callback
     * @param {Function} param0.onResult On result callback
     * @returns {Promise<any>}
     */
    processQueue({queue, works, sorter, done, onResult}) {
        if (this.singleSession) {
            this.lockId = queue.id;
            delete this.lock;
        }
        if (typeof sorter === 'function') {
            works = works.sort(sorter);
        }
        return this.do([
            ['role', w => this.checkRole(queue)],
            ...works,
            ['done', w => new Promise((resolve, reject) => {
                let res = w.res, reply;
                if (typeof done === 'function') {
                    [res, reply] = done(queue, res);
                } else if (typeof onResult === 'function') {
                    [res, reply] = onResult(queue, res);
                }
                if (reply && queue.callback) {
                    queue.sendResult(reply, queue.callback);
                }
                if (res && queue.outdir) {
                    queue.sendResult(res, queue.outdir);
                }
                resolve(res ? res : false);
            })],
        ], (w, err) => {
            return [
                [e => this.lock.release(this.lockId), e => this.lock],
                [e => this.saveScreenshot(queue, err), e => err],
                [e => this.end(queue, this.autoClose)],
            ];
        });
    }
}


/**
 * Bridge command handler.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdBridgeHandler {

    /**
     * Constructor.
     *
     * @param {SipdBridge} bridge Bridge
     */
    constructor(bridge) {
        /** @type {SipdBridge} */
        this.bridge = bridge;
        this.initialize();
    }

    /**
     * Do initialization.
     */
    initialize() {
    }
}

module.exports = { SipdBridge, SipdBridgeHandler };