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

const Work = require('@ntlab/work/work');
const SipdLogger = require('../sipd/logger');
const { SipdTimer, SipdAbortError } = require('../sipd');

const dtag = 'lock';

/**
 * SIPD user lock manager.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdLockManager {

    /**
     * Get lock for user.
     *
     * @param {string} user User id
     * @returns {SipdUserLock}
     */
    static get(user) {
        if (this.locks === undefined) {
            this.locks = {};
        }
        if (this.locks[user] === undefined) {
            this.locks[user] = new SipdUserLock(user, this.store);
        }
        return this.locks[user];
    }

    /**
     * Get lock store.
     *
     * @returns {typeof SipdLockStore}
     */
    static get store() {
        if (this._store === undefined) {
            this._store = SipdLockStoreMemory;
        }
        return this._store;
    }

    /**
     * Set lock store.
     *
     * @param {typeof SipdLockStore} storeClass Store class
     */
    static set store(storeClass) {
        this._store = storeClass;
    }

    static get STALE_MS() {
        return 5 * 60 * 1000; // 5 minutes
    }
}

/**
 * SIPD user lock.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdUserLock {

    constructor(user, storeClass) {
        /** @type {string} */
        this.user = user;
        const store = new storeClass(this);
        if (!store instanceof SipdLockStore) {
            throw new Error('Lock storage must be instance of SipdLockStore!');
        }
        /** @type {SipdLockStore} */
        this.store = store;
        /** @type {string[]} */
        this.aborts = [];
    }

    /**
     * Acquire lock.
     *
     * @param {string} lock Id
     * @returns {Promise<any>}
     */
    acquire(lock) {
        return new Promise((resolve, reject) => {
            const timer = new SipdTimer({delta: 60});
            const f = () => {
                if (this.aborts.includes(lock)) {
                    this.aborts.splice(this.aborts.indexOf(lock), 1);
                    return reject(new SipdAbortError(`Lock ${this.store.name} ${this.user}:${lock} is aborted!`));
                }
                this.store.free(lock)
                    .then(res => {
                        if (res) {
                            SipdLogger.activity(dtag)(`Lock ${this.store.name} ${this.user}:${lock} is acquired...`);
                            resolve();
                        } else {
                            timer.check(t => SipdLogger.activity(dtag)(`Lock ${this.store.name} ${this.user}:${lock} is still held after ${t.elapsedTime}...`));
                            setTimeout(f, 100);
                        }
                    })
                    .catch(err => reject(err));
            }
            f();
        });
    }

    /**
     * Release lock.
     *
     * @param {string} lock Id
     * @returns {Promise<boolean>}
     */
    release(lock) {
        return Work.works([
            [w => this.store.prune(lock)],
            [w => Promise.resolve(SipdLogger.activity(dtag)(`Lock ${this.store.name} ${this.user}:${lock} is released...`)),
                w => w.getRes(0)],
            [w => Promise.resolve(w.getRes(0))],
        ]);
    }

    /**
     * Abort the lock.
     *
     * @param {string} lock Id
     * @returns {this}
     */
    abort(lock) {
        if (!this.aborts.includes(lock)) {
            this.aborts.push(lock);
        }
        return this;
    }
}

/**
 * SIPD lock store.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdLockStore {

    constructor(owner) {
        /** @type {string} */
        this.user = owner.user;
        /** @type {[{lock: string, time: number}]} */
        this.locks = [];
        this.initialize();
    }

    /**
     * Do initialization.
     */
    initialize() {
    }

    /**
     * Find lock index position.
     *
     * @param {string} lock Lock id
     * @returns {number}
     */
    getIndex(lock) {
        return this.locks.findIndex(item => item.lock === lock);
    }

    /**
     * Perform refresh and purge stale locks.
     */
    async refresh(clean = true) {
        if (typeof this.doRefresh === 'function') {
            await this.doRefresh();
        }
        this.stale = 0;
        if (clean) {
            const time = SipdLockStore.getTime() - SipdLockManager.STALE_MS;
            while (true) {
                if (!this.locks.length || this.locks[0].time > time) {
                    break;
                }
                this.locks.splice(0, 1);
                this.stale++;
            }
            if (this.stale) {
                SipdLogger.activity(dtag)(`Cleaned ${this.stale} stale ${this.name} lock(s)...`);
            }
        }
    }

    /**
     * Check if lock is free.
     *
     * @param {string} lock Lock id
     * @returns {Promise<boolean>}
     */
    async free(lock) {
        await this.refresh();
        const idx = this.getIndex(lock);
        if (idx !== 0) {
            if (idx < 0) {
                this.locks.push(SipdLockStore.create(lock));
            } else {
                this.locks[idx].time = SipdLockStore.getTime();
            }
        }
        if ((this.stale || idx !== 0) && typeof this.doStore === 'function') {
            await this.doStore();
        }
        return this.getIndex(lock) === 0;
    }

    /**
     * Prune lock and return true if successful, false otherwise.
     *
     * @param {string} lock Lock id
     * @returns {Promise<boolean>}
     */
    async prune(lock) {
        let res = false;
        await this.refresh(false);
        if (this.getIndex(lock) === 0) {
            this.locks.splice(0, 1);
            res = true;
        }
        if (res && typeof this.doStore === 'function') {
            await this.doStore();
        }
        return res;
    }

    /**
     * Get current time.
     *
     * @returns {number}
     */
    static getTime() {
        return new Date().getTime();
    }

    /**
     * Create lock data.
     *
     * @param {string} lock Lock id
     * @returns {{lock: string, time: number}}
     */
    static create(lock) {
        return {lock, time: this.getTime()};
    }
}

/**
 * SIPD lock store in memory.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdLockStoreMemory extends SipdLockStore {

    initialize() {
        this.name = 'memory';
    }
}

/**
 * SIPD lock store in Redis.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdLockStoreRedis extends SipdLockStore {

    initialize() {
        this.name = 'redis';
        this.key = `sipd:${this.user}:locks`;
        this.refreshInterval = 10;
        this.storeInterval = 10;
        this.getRedis = async () => {
            if (this.redis === undefined) {
                if (!SipdLockStoreRedis._con) {
                    throw new Error('Redis connection string is not set!');
                }
                this._ready = false;
                const { createClient } = require('redis');
                this.redis = createClient({url: SipdLockStoreRedis._con});
                this.redis
                    .on('error', err => {
                        if (this._ready) {
                            this._ready = false;
                        }
                    })
                    .on('ready', () => {
                        this._ready = true;
                    })
                    .connect();
            }
            await new Promise(resolve => {
                const timer = new SipdTimer({delta: 60});
                const f = () => {
                    if (this._ready) {
                        resolve();
                    } else {
                        timer.check(t => SipdLogger.activity(dtag)(`Still waiting Redis connection to be ready after ${t.elapsedTime}...`));
                        setTimeout(f, 1000);
                    }
                }
                f();
            });
        }
        this.doRefresh = async () => {
            const time = SipdLockStore.getTime();
            if (this.refreshTime === undefined || this.refreshTime + this.refreshInterval < time) {
                this.refreshTime = time;
                await this.getRedis();
                const value = await this.redis.get(this.key);
                this.locks = value ? JSON.parse(value) : [];
            }
        }
        this.doStore = async () => {
            const time = SipdLockStore.getTime();
            if (this.storeTime === undefined || this.storeTime + this.storeInterval < time) {
                this.storeTime = time;
                await this.redis.set(this.key, JSON.stringify(this.locks));
            }
        }
    }

    /**
     * Set Redis connection string.
     *
     * @param {string} con Connection string
     * @returns {typeof SipdLockStoreRedis}
     */
    static setConnection(con) {
        this._con = con;
        return this;
    }
}

module.exports = { SipdLockManager, SipdLockStore, SipdLockStoreMemory, SipdLockStoreRedis };