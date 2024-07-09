/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022-2024 Toha <tohenk@yahoo.com>
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

const Work = require('@ntlab/work/work');
const SiapQueue = require('../queue');
const SiapSession = require('./session');
const { SiapAnnouncedError } = require('../siap');

/**
 * Work finished callback. The callback must returns an array of works to do.
 *
 * @callback workFinishedCallback
 * @param {Work} w Worker object
 * @param {Error} err An error or rejection thrown
 * @returns {array}
 */

/**
 * Siap bridge base class.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SiapBridge {

    STATE_NONE = 1
    STATE_SELF_TEST = 2
    STATE_OPERATIONAL = 3

    ROLE_BP = 'bp'
    ROLE_PA = 'pa'
    ROLE_PPK = 'ppk'
    ROLE_PPTK = 'pptk'

    sessions = {}

    constructor(options) {
        this.options = options;
        this.state = this.STATE_NONE;
    }

    selfTest() {
        let sess;
        if (this.state < this.STATE_SELF_TEST) {
            this.state = this.STATE_SELF_TEST;
        }
        const f = () => {
            this.state = this.STATE_OPERATIONAL;
            return this.state;
        }
        const users = this.getUsers(this.ROLE_BP);
        if (users.length) {
            sess = this.getSession(users[0]);
        } else {
            throw new Error('No user available!');
        }
        return Work.works([
            [s => sess.start()],
            [s => Promise.resolve(f())],
            [s => sess.stop()],
        ]);
    }

    isOperational() {
        return this.state === this.STATE_OPERATIONAL;
    }

    switchRole(role) {
        if (this.options.roles && this.options.roles.roles[role]) {
            this.role = role;
            this.roles = this.options.roles.roles[role];
        }
    }

    getRoleTitle(role) {
        const roles = {
            [this.ROLE_BP]: 'Bendahara Pengeluaran',
            [this.ROLE_PA]: 'Pengguna Anggaran',
            [this.ROLE_PPK]: 'PPK SKPD',
        }
        return roles[role];
    }

    getUsers(role) {
        const res = [];
        if (this.options.roles) {
            const roles = this.options.roles.roles ? this.options.roles.roles : {};
            const users = this.options.roles.users ? this.options.roles.users : {};
            for (const k of Object.values(roles)) {
                for (const r of Object.keys(k)) {
                    if (!role || r === role) {
                        const u = k[r];
                        if (users[u]) {
                            if (res.indexOf(users[u].username) < 0) {
                                res.push(users[u].username);
                            }
                        }
                    }
                }
            }
        }
        return res;
    }

    getUser(role) {
        if (this.roles && this.roles[role]) {
            return this.roles[role];
        }
    }

    getCredential(user) {
        if (this.options.roles && this.options.roles.users) {
            return this.options.roles.users[user];
        }
    }

    /**
     * Create a session.
     *
     * @param {object} options Session constructor options
     * @returns {SiapSession}
     */
    createSession(options) {
        return new SiapSession(options);
    }

    /**
     * Get session for a name.
     *
     * @param {string} name Session name
     * @returns {SiapSession}
     */
    getSession(name) {
        name = name.replace(/\s/g, '');
        const options = Object.assign({bridge: this}, this.options);
        const sess = [];
        for (const s of [options.session, name]) {
            if (s) {
                sess.push(s);
            }
        }
        if (sess.length) {
            options.session = sess.join('-');
        }
        const sessId = options.session ? options.session : '_';
        if (this.sessions[sessId] === undefined) {
            this.sessions[sessId] = this.createSession(options);
        }
        return this.sessions[sessId];
    }

    /**
     * Check if queue has a role defined.
     *
     * @param {SiapQueue} queue Queue to check
     * @returns {Promise<void>}
     */
    checkRole(queue) {
        return Work.works([
            [m => Promise.resolve(queue.getMappedData('info.role'))],
            [m => Promise.reject('Invalid queue, no role specified!'), m => !m.getRes(0)],
            [m => Promise.resolve(this.switchRole(m.getRes(0)))],
        ]);
    }

    /**
     * Do the operation as requested role and returns the session.
     *
     * @param {string} role User role
     * @returns {Promise<SiapSession>}
     */
    doAs(role) {
        let user = this.getUser(role);
        if (!user) {
            return Promise.reject(util.format('Role not found: %s!', role));
        }
        let cred = this.getCredential(user);
        if (!cred) {
            return Promise.reject(util.format('User has no credential: %s!', user));
        }
        const session = this.getSession(cred.username);
        session.cred = {username: cred.username, password: cred.password, role: this.getRoleTitle(role)};
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
                if (err instanceof SiapAnnouncedError && err._queue) {
                    const queue = err._queue;
                    const callbackQueue = SiapQueue.createCallbackQueue({id: queue.getMappedData('info.id'), error: err.message}, queue.callback);
                    SiapQueue.addQueue(callbackQueue);
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
}

module.exports = SiapBridge;