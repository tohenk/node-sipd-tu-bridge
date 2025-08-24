/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022-2025 Toha <tohenk@yahoo.com>
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

const util = require('util');
const Work = require('@ntlab/work/work');
const SipdQueue = require('../app/queue');
const SipdSession = require('./session');
const { SipdRoleSwitcher, SipdRole } = require('../sipd/role');
const { SipdAnnouncedError } = require('../sipd');

/**
 * Work finished callback. The callback must returns an array of works to do.
 *
 * @callback workFinishedCallback
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

    sessions = {}

    constructor(name, options) {
        this.name = name;
        this.options = options;
        this.state = this.STATE_NONE;
        this.autoClose = this.options.autoClose !== undefined ? this.options.autoClose : true;
    }

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
            return Work.works([
                ['role', s => Promise.resolve(this.switchRole(role))],
                ['bp', s => this.doAs(SipdRole.BP)],
                ['done', s => Promise.resolve(f())],
                ['cleanup', s => s.bp.stop()],
            ]);
        } else {
            return Promise.resolve(f());
        }
    }

    isOperational() {
        return this.state === this.STATE_OPERATIONAL;
    }

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

    getRoleTitle(role) {
        const roles = {
            [SipdRole.BP]: 'Bendahara Pengeluaran',
            [SipdRole.PA]: 'Pengguna Anggaran',
            [SipdRole.PPK]: 'PPK SKPD',
        }
        return roles[role];
    }

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
     * Create a session.
     *
     * @param {object} options Session constructor options
     * @returns {SipdSession}
     */
    createSession(options) {
        return new SipdSession(options);
    }

    /**
     * Get session for a name.
     *
     * @param {string} name Session name
     * @param {number} seq Session sequence
     * @returns {SipdSession}
     */
    getSession(name, seq) {
        name = name.replace(/\s/g, '');
        const options = {...this.options, bridge: this};
        const sess = [];
        for (const s of [options.session, name, seq ? seq.toString() : null]) {
            if (s) {
                sess.push(s);
            }
        }
        if (sess.length) {
            options.session = sess.join('-');
        }
        const sessId = options.session ? options.session : '_';
        if (this.sessions[sessId] === undefined) {
            const session = this.createSession(options);
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
     * Check if queue has a role defined.
     *
     * @param {SipdQueue} queue Queue to check
     * @returns {Promise<void>}
     */
    checkRole(queue) {
        return Work.works([
            [m => Promise.resolve(queue.getMappedData('info.role'))],
            [m => Promise.reject('Invalid queue, no role specified!'), m => !m.getRes(0)],
            [m => Promise.resolve(this.switchRole(m.getRes(0), queue.getMappedData('info.unit')))],
            [m => Promise.reject(`Role not found ${m.getRes(0)}!`), m => !m.getRes(2)],
        ]);
    }

    /**
     * Get captcha image.
     *
     * @returns {Promise<string>|undefined}
     */
    getCaptcha() {
        for (const session of this.getSessions()) {
            if (session.state().captcha) {
                return session.captchaImage();
            }
        }
    }

    /**
     * Solve captcha using code.
     *
     * @param {string} code Captcha code
     * @returns {Promise<any>|undefined}
     */
    solveCaptcha(code) {
        for (const session of this.getSessions()) {
            if (session.state().captcha) {
                return session.solveCaptcha(code);
            }
        }
    }

    /**
     * Save captcha image.
     *
     * @param {string} dir
     * @returns {Promise<string>|undefined}
     */
    saveCaptcha(dir) {
        for (const session of this.getSessions()) {
            if (session.state().captcha) {
                return Work.works([
                    [w => session.captchaImage()],
                    [w => Promise.resolve(session.saveCaptcha(w.getRes(0), dir))],
                ]);
            }
        }
    }

    /**
     * Do the operation as requested role and returns the session.
     *
     * @param {string} role User role
     * @returns {Promise<SipdSession>}
     */
    doAs(role) {
        const user = this.getUser(role);
        if (!user) {
            return Promise.reject(util.format('Role not found: %s!', role));
        }
        role = user.role ?? this.getRoleTitle(role);
        let idx = 0;
        const p = role.indexOf(':');
        if (p > 1) {
            idx = parseInt(role.substr(p + 1).trim()) - 1;
            role = role.substr(0, p);
        }
        const session = this.getSession(user.username, idx);
        session.cred = {username: user.username, password: user.password, role, idx};
        return Promise.resolve(session);
    }

    /**
     * Perform works.
     *
     * @param {array} works The works array
     * @param {workFinishedCallback} callback Finished callback
     * @returns {Promise<any>}
     */
    do(works, callback = null) {
        const _works = [];
        if (Array.isArray(works)) {
            _works.push(...works);
        }
        if (typeof works === 'function') {
            _works.push(works);
        }
        return Work.works(_works, {
            done: (w, err) => {
                if (err instanceof SipdAnnouncedError && err._queue) {
                    const queue = err._queue;
                    const callbackQueue = SipdQueue.createCallbackQueue({id: queue.getMappedData('info.id'), error: err.message}, queue.callback);
                    SipdQueue.addQueue(callbackQueue);
                }
                if (typeof callback === 'function') {
                    return Work.works(callback(w, err));
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

    end(queue, stop = true) {
        const works = [];
        for (const session of Object.values(this.sessions)) {
            works.push(
                [m => session.cleanFiles(queue)],
                [m => session.stop(), m => stop],
            );
        }
        return Work.works(works);
    }

    noop(queue) {
        const sess = this.getSessions()[0];
        if (sess) {
            return this.do([
                [w => sess.login()],
            ], (w, err) => {
                return [
                    [e => this.end(queue, this.autoClose)],
                ];
            });
        } else {
            return Promise.reject('No roles defined!');
        }
    }
}

module.exports = SipdBridge;