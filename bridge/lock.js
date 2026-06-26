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
const { SipdTimer } = require('../sipd');

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
        return 10 * 60 * 1000; // 10 minutes
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
    }

    /**
     * Acquire lock.
     *
     * @param {string} lock Id
     * @returns {Promise<any>}
     */
    acquire(lock) {
        return Work.works([
            [w => this.store.store(lock)],
            [w => new Promise((resolve, reject) => {
                const timer = new SipdTimer({delta: 60});
                const f = () => {
                    this.store.free(lock)
                        .then(res => {
                            if (res) {
                                SipdLogger.activity(dtag)(`Lock ${this.store.name} ${this.user}:${lock} is acquired...`);
                                resolve();
                            } else {
                                timer.check(t => SipdLogger.activity(dtag)(`Lock ${this.store.name} ${this.user}:${lock} is still held after ${t.deltaTime}s...`));
                                setTimeout(f, 100);
                            }
                        })
                        .catch(err => reject(err));
                }
                f();
            })],
        ]);
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
        this.initialize();
    }

    initialize() {
    }

    /**
     * Check if lock is free.
     *
     * @param {string} lock Lock id
     * @returns {Promise<boolean>}
     */
    async free(lock) {
        if (typeof this.isFree === 'function') {
            return await this.isFree(lock);
        }
        return false;
    }

    /**
     * Store lock.
     *
     * @param {string} lock Lock id
     * @returns {Promise<boolean>}
     */
    async store(lock) {
        if (typeof this.doStore === 'function') {
            return await this.doStore(lock);
        }
        return false;
    }

    /**
     * Prune lock and return true if successful, false otherwise.
     *
     * @param {string} lock Lock id
     * @returns {Promise<boolean>}
     */
    async prune(lock) {
        if (typeof this.doPrune === 'function') {
            return await this.doPrune(lock);
        }
        return false;
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
        /** @type {string[]} */
        this.locks = [];
        this.getLock = lock => {
            return this.locks.findIndex(item => item.lock === lock);
        }
        this.cleanStale = () => {
            const time = new Date().getTime() - SipdLockManager.STALE_MS;
            let count = 0;
            while (true) {
                if (!this.locks.length || this.locks[0].time > time) {
                    break;
                }
                this.locks.splice(0, 1);
                count++;
            }
            if (count) {
                SipdLogger.activity(dtag)(`Cleaned ${count} stale ${this.name} lock(s)...`);
            }
            return this;
        }
        this.isFree = async lock => {
            return this.cleanStale().getLock(lock) === 0;
        }
        this.doStore = async lock => {
            this.locks.push({lock, time: new Date().getTime()});
            return true;
        }
        this.doPrune = async lock => {
            if (this.getLock(lock) === 0) {
                this.locks.splice(0, 1);
                return true;
            }
            return false;
        }
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
        this.getRedis = async () => {
            if (this._redis === undefined) {
                if (!SipdLockStoreRedis._con) {
                    throw new Error('Redis connection string is not set!');
                }
                this._ready = false;
                const { createClient } = require('redis');
                this._redis = createClient({url: SipdLockStoreRedis._con});
                this._redis
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
                        timer.check(t => SipdLogger.activity(dtag)(`Still waiting Redis connection to be ready after ${t.deltaTime}s...`));
                        setTimeout(f, 1000);
                    }
                }
                f();
            });
            return this._redis;
        }
        this.getLocks = async () => {
            const redis = await this.getRedis();
            const value = await redis.get(this.key);
            this.locks = value ? JSON.parse(value) : [];
            return redis;
        }
        this.cleanStale = async () => {
            const redis = await this.getLocks();
            const time = new Date().getTime() - SipdLockManager.STALE_MS;
            let count = 0;
            while (true) {
                if (!this.locks.length || this.locks[0].time > time) {
                    break;
                }
                this.locks.splice(0, 1);
                count++;
            }
            if (count) {
                await redis.set(this.key, JSON.stringify(this.locks));
                SipdLogger.activity(dtag)(`Cleaned ${count} stale ${this.name} lock(s)...`);
            }
            return this;
        }
        this.getLock = lock => {
            return this.locks.findIndex(item => item.lock === lock);
        }
        this.isFree = async lock => {
            await this.cleanStale();
            return this.getLock(lock) === 0;
        }
        this.doStore = async lock => {
            const redis = await this.getLocks();
            const locks = [...this.locks, {lock, time: new Date().getTime()}];
            await redis.set(this.key, JSON.stringify(locks));
            return true;
        }
        this.doPrune = async lock => {
            const redis = await this.getLocks();
            if (this.getLock(lock) === 0) {
                this.locks.splice(0, 1);
                await redis.set(this.key, JSON.stringify(this.locks));
                return true;
            }
            return false;
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