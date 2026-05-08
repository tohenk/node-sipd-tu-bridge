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
        this.isFree = async lock => {
            return this.locks.indexOf(lock) === 0;
        }
        this.doStore = async lock => {
            this.locks.push(lock);
            return true;
        }
        this.doPrune = async lock => {
            if (this.locks.indexOf(lock) === 0) {
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
                const { createClient } = require('redis');
                this._redis = await createClient({url: SipdLockStoreRedis._con})
                    .on('error', err => console.error(err))
                    .connect();
            }
            return this._redis;
        }
        this.getLock = async () => {
            const redis = await this.getRedis();
            const value = await redis.get(this.key);
            return value ? JSON.parse(value) : [];
        }
        this.isFree = async lock => {
            return (await this.getLock()).indexOf(lock) === 0;
        }
        this.doStore = async lock => {
            const redis = await this.getRedis();
            const locks = [...(await this.getLock()), lock];
            await redis.set(this.key, JSON.stringify(locks));
            return true;
        }
        this.doPrune = async lock => {
            const redis = await this.getRedis();
            const locks = await this.getLock();
            if (locks.indexOf(lock) === 0) {
                locks.splice(0, 1);
                await redis.set(this.key, JSON.stringify(locks));
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